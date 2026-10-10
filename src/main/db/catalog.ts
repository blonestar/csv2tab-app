// Katalog u bazi: punjenje iz ugrađenog kataloga i čitanje u obliku koji očekuje @core/catalog.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { WtCatalog } from '@core/catalog';
import { transaction } from './tx';

const HASH_KEY = 'catalog_hash';

/** Otisak ugrađenog kataloga; menja se čim se promeni bilo koji materijal ili traka. */
export function catalogHash(catalog: WtCatalog): string {
  return createHash('sha256')
    .update(JSON.stringify({ materials: catalog.materials, edgeBands: catalog.edgeBands }))
    .digest('hex');
}

/**
 * Osvežava ugrađene redove ako se katalog razlikuje od onog u bazi (po otisku). Sve u jednoj transakciji:
 * ugrađeni redovi se dodaju/menjaju po šifri (id ostaje isti), ugrađeni kojih više nema se brišu, korisnikovi se ne diraju.
 * Vraća true ako je nešto upisano.
 */
export function syncCatalog(db: DatabaseSync, catalog: WtCatalog): boolean {
  const hash = catalogHash(catalog);
  const stored = db.prepare('SELECT value FROM meta WHERE key = ?').get(HASH_KEY) as { value: string } | undefined;
  if (stored?.value === hash) return false;

  transaction(db, () => {
    const upMat = db.prepare(
      `INSERT INTO materials (source, code, name, sheet_w, sheet_h, thickness, grain, position)
       VALUES ('builtin', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (code) WHERE source = 'builtin' DO UPDATE SET
         name = excluded.name, sheet_w = excluded.sheet_w, sheet_h = excluded.sheet_h,
         thickness = excluded.thickness, grain = excluded.grain, position = excluded.position`,
    );
    catalog.materials.forEach((m, i) => upMat.run(m.code, m.name, m.sheet[0], m.sheet[1], m.thickness, m.grain, i));
    const upBand = db.prepare(
      `INSERT INTO edge_bands (source, code, name, position) VALUES ('builtin', ?, ?, ?)
       ON CONFLICT (code) WHERE source = 'builtin' DO UPDATE SET name = excluded.name, position = excluded.position`,
    );
    catalog.edgeBands.forEach((b, i) => upBand.run(b.code, b.name, i));

    prune(db, 'materials', catalog.materials.map((m) => m.code));
    prune(db, 'edge_bands', catalog.edgeBands.map((b) => b.code));

    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
      HASH_KEY,
      hash,
    );
  });
  return true;
}

/** Briše ugrađene redove čije šifre nisu u novom katalogu. */
function prune(db: DatabaseSync, table: 'materials' | 'edge_bands', keep: string[]): void {
  const keepSet = new Set(keep);
  const rows = db.prepare(`SELECT code FROM ${table} WHERE source = 'builtin'`).all() as { code: string }[];
  const del = db.prepare(`DELETE FROM ${table} WHERE source = 'builtin' AND code = ?`);
  for (const { code } of rows) if (!keepSet.has(code)) del.run(code);
}

/** Ceo katalog (ugrađeni redovi po redosledu iz fajla, pa korisnikovi) u obliku WtCatalog. */
export function readCatalog(db: DatabaseSync): WtCatalog {
  const materials = db
    .prepare(
      `SELECT code, name, sheet_w, sheet_h, thickness, grain FROM materials
       ORDER BY source = 'user', position, id`,
    )
    .all() as { code: string; name: string; sheet_w: number; sheet_h: number; thickness: number; grain: number }[];
  const edgeBands = db
    .prepare(`SELECT code, name FROM edge_bands ORDER BY source = 'user', position, id`)
    .all() as { code: string; name: string }[];
  return {
    materials: materials.map((m) => ({
      name: m.name,
      code: m.code,
      sheet: [m.sheet_w, m.sheet_h] as [number, number],
      thickness: m.thickness,
      grain: m.grain,
    })),
    edgeBands: edgeBands.map((b) => ({ name: b.name, code: b.code })),
  };
}
