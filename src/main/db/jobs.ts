// Poslovi u bazi: izvorni bajtovi + stanje, konačni zapisi, izvozi i stanje izvoza. Bez Electrona, testira se u Node-u.
// Ulaz je već proveren u operacijama (src/main/operations/validate.ts); stanje se ovde ipak serijalizuje i čita
// kroz parseJobState, pa ni stara ni nova baza ne vraćaju neispravno stanje.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { JobState, SourceKind } from '../../shared/job';
import { JobStateError, parseJobStateJson, stringifyJobState } from '../../shared/jobStateCheck';
import type {
  ExportRecord,
  ExportStatus,
  JobDetail,
  JobExports,
  JobListItem,
  JobListQuery,
  JobListResult,
  JobSave,
  JobSavedResult,
  OutputExportState,
  OutputInfo,
} from '../../shared/jobs';
import { applyMemoryUpdate } from './memory';
import { transaction } from './tx';
import { searchPatterns, searchText } from './search';
import { compareText } from '../../shared/sort';
import { folderName } from '../fileNames';

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export interface NewJobFile {
  name: string;
  kind: SourceKind;
  bytes: Uint8Array;
  /** Putanja iz dijaloga za uvoz; null za prevučen fajl. */
  path: string | null;
}

type Row = Record<string, unknown>;

const ITEM_SELECT = `
  SELECT j.id, j.name, j.note, j.created_at, j.updated_at, j.source_name, j.source_kind, j.part_count,
         j.export_status, j.last_export_at,
         (SELECT group_concat(material, char(31)) FROM
            (SELECT material FROM job_parts WHERE job_id = j.id GROUP BY material ORDER BY min(position))) AS materials
  FROM jobs j`;

function toItem(r: Row): JobListItem {
  return {
    id: r.id as number,
    name: r.name as string,
    note: r.note as string,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    sourceName: r.source_name as string,
    sourceKind: r.source_kind as SourceKind,
    partCount: r.part_count as number,
    materials: typeof r.materials === 'string' ? r.materials.split('\u001f') : [],
    exportStatus: r.export_status as ExportStatus,
    lastExportAt: (r.last_export_at as number | null) ?? null,
  };
}

// ---------- stanje izvoza ----------
/**
 * Stanje izvoza posla iz trenutnih izlaznih fajlova i istorije izvoza (najnoviji prvi).
 * Fajl se poredi po imenu (bez razlike u veličini slova) sa NAJNOVIJIM izvozom pod tim imenom:
 *  - nema izvoza pod tim imenom: 'never' (novi materijal, promenjeno ime fajla, preskočeno prepisivanje);
 *  - isti heš: 'current' (i posle izmene i vraćanja izmene, jer se porede bajtovi, ne istorija izmena);
 *  - drugi heš: 'changed'.
 * Posao u celini: nikad ništa izvezeno = 'never'; inače je 'current' samo ako je svaki trenutni fajl 'current'.
 * Izvezeni fajlovi kojih više nema među trenutnim se ne računaju.
 */
export function computeExportStatus(
  outputs: readonly OutputInfo[],
  history: readonly { fileName: string; sha256: string }[],
): { status: ExportStatus; outputs: (OutputInfo & { state: OutputExportState })[] } {
  const latest = new Map<string, string>();
  for (const h of history) {
    const k = h.fileName.toLowerCase();
    if (!latest.has(k)) latest.set(k, h.sha256);
  }
  const per = outputs.map((o) => {
    const last = latest.get(o.name.toLowerCase());
    const state: OutputExportState = last === undefined ? 'never' : last === o.sha256 ? 'current' : 'changed';
    return { ...o, state };
  });
  let status: ExportStatus;
  if (history.length === 0) status = 'never';
  else status = per.length > 0 && per.every((o) => o.state === 'current') ? 'current' : 'changed';
  return { status, outputs: per };
}

function readOutputs(text: string): OutputInfo[] {
  try {
    const v = JSON.parse(text) as unknown;
    if (Array.isArray(v)) return v as OutputInfo[];
  } catch {
    // oštećeno: tretira se kao da nema izlaznih fajlova
  }
  return [];
}

function history(db: DatabaseSync, id: number): ExportRecord[] {
  const rows = db
    .prepare(
      `SELECT id, material, file_name, folder, exported_at, record_count, size, sha256, result
       FROM exports WHERE job_id = ? ORDER BY id DESC`,
    )
    .all(id) as Row[];
  return rows.map((r) => ({
    id: r.id as number,
    material: r.material as string,
    fileName: r.file_name as string,
    folder: folderName(r.folder as string),
    exportedAt: r.exported_at as number,
    recordCount: r.record_count as number,
    size: r.size as number,
    sha256: r.sha256 as string,
    result: r.result as 'written' | 'identical',
  }));
}

/** Preračunava `export_status` i `last_export_at` iz sačuvanih izlaznih fajlova i istorije izvoza. */
function refreshExportStatus(db: DatabaseSync, id: number): JobExports {
  const row = db.prepare('SELECT outputs FROM jobs WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Posao ne postoji.');
  const exports = history(db, id);
  const { status, outputs } = computeExportStatus(readOutputs(row.outputs as string), exports);
  db.prepare('UPDATE jobs SET export_status = ?, last_export_at = ? WHERE id = ?').run(status, exports[0]?.exportedAt ?? null, id);
  return { exports, status, outputs };
}

export function jobExports(db: DatabaseSync, id: number): JobExports {
  const row = db.prepare('SELECT outputs FROM jobs WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Posao ne postoji.');
  const exports = history(db, id);
  const { status, outputs } = computeExportStatus(readOutputs(row.outputs as string), exports);
  return { exports, status, outputs };
}

// ---------- pretraga ----------
/** Sklapa tekst za pretragu iz imena, napomene, fajla, materijala i naziva delova. */
function rebuildSearch(db: DatabaseSync, id: number): void {
  const j = db.prepare('SELECT name, note, source_name, created_at FROM jobs WHERE id = ?').get(id) as Row;
  const names = db.prepare('SELECT DISTINCT name FROM job_parts WHERE job_id = ? AND name <> ?').all(id, '') as { name: string }[];
  const mats = db.prepare('SELECT DISTINCT material, wt_code FROM job_parts WHERE job_id = ?').all(id) as { material: string; wt_code: string }[];
  const text = [
    j.name as string,
    j.note as string,
    j.source_name as string,
    ...mats.flatMap((m) => [m.material, m.wt_code]),
    ...names.map((n) => n.name),
    ...dateTexts(j.created_at as number),
  ].filter(Boolean);
  db.prepare('UPDATE jobs SET search = ? WHERE id = ?').run(searchText(text.join('\n')), id);
}

function dateTexts(ms: number): string[] {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return [`${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`];
}

// ---------- čuvanje ----------
function writeParts(db: DatabaseSync, id: number, save: JobSave): void {
  db.prepare('DELETE FROM job_parts WHERE job_id = ?').run(id);
  const ins = db.prepare(
    'INSERT INTO job_parts (job_id, position, material, wt_code, dim1, dim2, edge1, edge2, grain, qty, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  save.parts.forEach((p, i) => ins.run(id, i, p.material, p.wt, p.dim1, p.dim2, p.edge1, p.edge2, p.grain, p.qty, p.name));
}

function outputsJson(save: JobSave): string {
  const outs: OutputInfo[] = save.outputs.map((o) => ({ material: o.material, name: o.name, sha256: sha256(o.bytes), count: o.count }));
  return JSON.stringify(outs);
}

export function createJob(db: DatabaseSync, name: string, file: NewJobFile, save: JobSave, now = Date.now()): number {
  const state = stringifyJobState(save.state);
  return transaction(db, () => {
    const r = db
      .prepare(
        `INSERT INTO jobs (name, created_at, updated_at, source_name, source_kind, source_size, source_sha256, source_path,
                           state, part_count, outputs, source_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, now, now, file.name, file.kind, file.bytes.length, sha256(file.bytes), file.path, state, save.parts.length, outputsJson(save), file.bytes);
    const id = Number(r.lastInsertRowid);
    writeParts(db, id, save);
    refreshExportStatus(db, id);
    rebuildSearch(db, id);
    return id;
  });
}

/** Zamenjuje stanje, zapise i izlazne fajlove posla u jednoj transakciji. Izvorni bajtovi se ne diraju. */
export function saveJob(db: DatabaseSync, id: number, save: JobSave, now = Date.now()): JobSavedResult {
  const state = stringifyJobState(save.state);
  return transaction(db, () => {
    const r = db
      .prepare('UPDATE jobs SET state = ?, part_count = ?, outputs = ?, updated_at = ? WHERE id = ?')
      .run(state, save.parts.length, outputsJson(save), now, id);
    if (r.changes === 0) throw new Error('Posao ne postoji.');
    writeParts(db, id, save);
    const exports = refreshExportStatus(db, id);
    rebuildSearch(db, id);
    return { ...exports, updatedAt: now };
  });
}

/** Čuvanje posla i upis ručno promenjenih izbora u pamćenje u istoj transakciji: ili oba ili nijedno. */
export function saveJobRemembering(db: DatabaseSync, id: number, save: JobSave, now = Date.now()): JobSavedResult {
  return transaction(db, () => {
    const res = saveJob(db, id, save, now);
    if (save.remember) applyMemoryUpdate(db, save.remember, now);
    return res;
  });
}

export function updateJobMeta(db: DatabaseSync, id: number, meta: { name?: string; note?: string }, now = Date.now()): JobListItem {
  transaction(db, () => {
    const r = db
      .prepare('UPDATE jobs SET name = coalesce(?, name), note = coalesce(?, note), updated_at = ? WHERE id = ?')
      .run(meta.name ?? null, meta.note ?? null, now, id);
    if (r.changes === 0) throw new Error('Posao ne postoji.');
    rebuildSearch(db, id);
  });
  return getJobItem(db, id)!;
}

export function deleteJob(db: DatabaseSync, id: number): void {
  const r = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  if (r.changes === 0) throw new Error('Posao ne postoji.');
}

export interface ExportToRecord {
  material: string;
  fileName: string;
  folder: string;
  bytes: Uint8Array;
  count: number;
  result: 'written' | 'identical';
}

/** Beleži izvoze (tačne bajtove) i osvežava stanje izvoza posla. */
export function recordExports(db: DatabaseSync, id: number, items: readonly ExportToRecord[], now = Date.now()): JobExports {
  return transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) throw new Error('Posao ne postoji.');
    const ins = db.prepare(
      `INSERT INTO exports (job_id, material, file_name, folder, exported_at, record_count, size, sha256, result, bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const it of items) ins.run(id, it.material, it.fileName, it.folder, now, it.count, it.bytes.length, sha256(it.bytes), it.result, it.bytes);
    return refreshExportStatus(db, id);
  });
}

// ---------- čitanje ----------
export function getJobItem(db: DatabaseSync, id: number): JobListItem | null {
  const r = db.prepare(`${ITEM_SELECT} WHERE j.id = ?`).get(id) as Row | undefined;
  return r ? toItem(r) : null;
}

export function getJob(db: DatabaseSync, id: number): JobDetail | null {
  const item = getJobItem(db, id);
  if (!item) return null;
  const r = db.prepare('SELECT state, source_bytes FROM jobs WHERE id = ?').get(id) as Row;
  let state: JobState | null = null;
  let stateError: string | null = null;
  try {
    state = parseJobStateJson(r.state as string);
  } catch (e) {
    stateError = e instanceof JobStateError ? e.message : 'Sačuvano stanje posla se ne može pročitati.';
  }
  return {
    ...item,
    ...jobExports(db, id),
    file: { name: item.sourceName, kind: item.sourceKind, bytes: r.source_bytes as Uint8Array },
    state,
    stateError,
  };
}

/** Poslovi sa istim izvornim fajlom (po SHA-256), najnoviji prvi. */
export function findBySource(db: DatabaseSync, hash: string): JobListItem[] {
  return (db.prepare(`${ITEM_SELECT} WHERE j.source_sha256 = ? ORDER BY j.created_at DESC, j.id DESC LIMIT 10`).all(hash) as Row[]).map(toItem);
}

const NEWEST_FIRST = 'j.created_at DESC, j.id DESC';
/** Kolone koje sortira SQLite. Stanje izvoza ide redom: nije izvezen, menjan, izvezen. */
const SORT_SQL = {
  parts: 'j.part_count',
  date: 'j.created_at',
  status: "CASE j.export_status WHEN 'never' THEN 0 WHEN 'changed' THEN 1 ELSE 2 END",
} as const;
/** Tekstualne kolone sortira JavaScript: SQLite ne zna redosled slova č, ć, đ, š, ž. */
const SORT_TEXT = { name: 'j.name', source: 'j.source_name' } as const;

/**
 * Lista poslova sa stranicama; bez `sort` najnoviji prvi. Pretraga: svaka reč mora da se nađe u sklopljenom
 * tekstu posla.
 */
export function listJobs(db: DatabaseSync, q: JobListQuery): JobListResult {
  const patterns = searchPatterns(q.text);
  const where = patterns.length ? `WHERE ${patterns.map(() => "j.search LIKE ? ESCAPE '\\'").join(' AND ')}` : '';
  const by = q.sort?.by;
  if (by === 'name' || by === 'source') {
    const all = db.prepare(`SELECT j.id, ${SORT_TEXT[by]} AS v FROM jobs j ${where} ORDER BY ${NEWEST_FIRST}`).all(...patterns) as { id: number; v: string }[];
    const sign = q.sort?.dir === 'desc' ? -1 : 1;
    all.sort((a, b) => compareText(a.v, b.v) * sign);
    const ids = all.slice(q.offset, q.offset + q.limit).map((r) => r.id);
    if (!ids.length) return { total: all.length, items: [] };
    const found = new Map((db.prepare(`${ITEM_SELECT} WHERE j.id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Row[]).map((r) => [r.id as number, r]));
    return { total: all.length, items: ids.flatMap((id) => { const r = found.get(id); return r ? [toItem(r)] : []; }) };
  }
  const total = (db.prepare(`SELECT count(*) AS n FROM jobs j ${where}`).get(...patterns) as { n: number }).n;
  const order = by ? `${SORT_SQL[by]} ${q.sort?.dir === 'desc' ? 'DESC' : 'ASC'}, ${NEWEST_FIRST}` : NEWEST_FIRST;
  const rows = db
    .prepare(`${ITEM_SELECT} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...patterns, q.limit, q.offset) as Row[];
  return { total, items: rows.map(toItem) };
}
