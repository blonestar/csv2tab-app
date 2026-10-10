// Pamćenje izbora u bazi (material_map, column_maps). Bez Electrona, testira se u Node-u. Ulaz je već proveren
// u operacijama (src/shared/memory.ts); ovde se čita i oštećen red tako da ne ruši ostale.
import type { DatabaseSync } from 'node:sqlite';
import { FIELDS, type ColumnMapping } from '../../../web/src/lib/parts';
import {
  SIGNATURE_SEP,
  mappingFitsColumns,
  mappingArg,
  memoryKey,
  signatureColumns,
  type MappingMemoryEntry,
  type MaterialMemory,
  type MaterialMemoryEntry,
  type MemoryFound,
  type MemoryList,
  type MemoryLookup,
  type MemoryUpdate,
} from '../../shared/memory';
import { transaction } from './tx';

type Row = Record<string, unknown>;

function toMemory(r: Row): MaterialMemory {
  const m: MaterialMemory = {};
  if (r.wt_code !== null) m.wt = r.wt_code === '' ? null : (r.wt_code as string);
  if (r.band !== null) m.band = r.band as string;
  if (r.grain !== null) m.grain = r.grain as 0 | 1;
  return m;
}

/** Zapamćeni izbori za nazive iz fajla (po normalizovanom ključu); ključ rezultata je naziv kako je poslat. */
export function lookupMaterials(db: DatabaseSync, names: readonly string[]): Record<string, MaterialMemory> {
  const sel = db.prepare('SELECT wt_code, band, grain FROM material_map WHERE name = ?');
  const out: Record<string, MaterialMemory> = Object.create(null) as Record<string, MaterialMemory>;
  for (const n of names) {
    const key = memoryKey(n);
    if (key === '') continue;
    const r = sel.get(key) as Row | undefined;
    if (!r) continue;
    const m = toMemory(r);
    if (Object.keys(m).length) out[n] = m;
  }
  return out;
}

function parseMapping(text: string): ColumnMapping | null {
  try {
    return mappingArg(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Mapiranje za potpis; oštećen ili neprimenljiv zapis (npr. izmenjen ručno u bazi) se ne vraća. */
export function lookupMapping(db: DatabaseSync, signature: string): ColumnMapping | null {
  const r = db.prepare('SELECT mapping FROM column_maps WHERE signature = ?').get(signature) as Row | undefined;
  if (!r) return null;
  const m = parseMapping(r.mapping as string);
  return m && mappingFitsColumns(m, signatureColumns(signature)) ? m : null;
}

export function lookupMemory(db: DatabaseSync, q: MemoryLookup): MemoryFound {
  return { materials: lookupMaterials(db, q.names), mapping: q.signature ? lookupMapping(db, q.signature) : null };
}

/** Upisuje izmene: zadata polja se postavljaju, ostala ostaju kakva su (ili NULL za novi red); `clear` briše polje. Red bez ijednog polja se briše. */
export function applyMemoryUpdate(db: DatabaseSync, u: MemoryUpdate, now = Date.now()): void {
  if (u.materials.length === 0 && !u.mapping) return;
  transaction(db, () => {
    const sel = db.prepare('SELECT wt_code, band, grain FROM material_map WHERE name = ?');
    const up = db.prepare(
      `INSERT INTO material_map (name, label, wt_code, band, grain, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET label = excluded.label, wt_code = excluded.wt_code, band = excluded.band,
                                        grain = excluded.grain, updated_at = excluded.updated_at`,
    );
    const del = db.prepare('DELETE FROM material_map WHERE name = ?');
    for (const m of u.materials) {
      const key = memoryKey(m.name);
      const cur = (sel.get(key) as Row | undefined) ?? { wt_code: null, band: null, grain: null };
      let wt = cur.wt_code as string | null;
      let band = cur.band as string | null;
      let grain = cur.grain as number | null;
      if (m.wt !== undefined) wt = m.wt === null ? '' : m.wt;
      if (m.band !== undefined) band = m.band;
      if (m.grain !== undefined) grain = m.grain;
      for (const f of m.clear ?? []) {
        if (f === 'wt') wt = null;
        else if (f === 'band') band = null;
        else grain = null;
      }
      if (wt === null && band === null && grain === null) del.run(key);
      else up.run(key, m.name.trim().replace(/\s+/g, ' '), wt, band, grain, now);
    }
    if (u.mapping) {
      db.prepare(
        'INSERT INTO column_maps (signature, mapping, updated_at) VALUES (?, ?, ?) ON CONFLICT (signature) DO UPDATE SET mapping = excluded.mapping, updated_at = excluded.updated_at',
      ).run(u.mapping.signature, JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, u.mapping!.mapping[f]]))), now);
    }
  });
}

/** Sve zapamćeno, za prikaz u podešavanjima (najnovije prvo). */
export function listMemory(db: DatabaseSync): MemoryList {
  const materials: MaterialMemoryEntry[] = (
    db.prepare('SELECT name, label, wt_code, band, grain, updated_at FROM material_map ORDER BY updated_at DESC, name').all() as Row[]
  ).map((r) => ({ key: r.name as string, label: r.label as string, updatedAt: r.updated_at as number, ...toMemory(r) }));
  const mappings: MappingMemoryEntry[] = [];
  for (const r of db.prepare('SELECT signature, mapping, updated_at FROM column_maps ORDER BY updated_at DESC, signature').all() as Row[]) {
    const mapping = parseMapping(r.mapping as string);
    if (mapping) mappings.push({ signature: r.signature as string, header: (r.signature as string).split(SIGNATURE_SEP), mapping, updatedAt: r.updated_at as number });
  }
  return { materials, mappings };
}

/** Briše jedan zapis (po ključu / potpisu) ili sve zapise te vrste (key = null). Vraća broj obrisanih. */
export function forgetMemory(db: DatabaseSync, kind: 'material' | 'mapping', key: string | null): number {
  const table = kind === 'material' ? 'material_map' : 'column_maps';
  const col = kind === 'material' ? 'name' : 'signature';
  const r = key === null ? db.prepare(`DELETE FROM ${table}`).run() : db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(key);
  return Number(r.changes);
}
