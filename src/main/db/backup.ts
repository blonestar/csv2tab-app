// Rezervna kopija i vraćanje baze na nivou fajlova. Bez Electrona, testira se u običnom Node-u.
//  - createBackup: celovita kopija u jedan fajl (VACUUM INTO) u zadat folder, sa datumom u imenu;
//  - stageBackup / inspectDatabaseFile: provera fajla koji korisnik nudi za vraćanje (ništa se ne menja);
//  - restoreDatabase: zamena baze proverenom kopijom, sa sigurnosnom kopijom stare i vraćanjem na staro ako zamena ne uspe.
import { closeSync, copyFileSync, existsSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, type AppDatabase, type OpenOptions } from './index';
import { loadMigrations } from './migrate';
import { fileErrorMessage } from '../fileNames';

/** Greška sa porukom na srpskom, bez tehničkih detalja; bezbedna za prikaz korisniku. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Tabele koje baza ove aplikacije ima po verziji šeme (zbirno). Nova migracija sa novom tabelom dodaje red ovde. */
export const TABLES_BY_VERSION: Record<number, string[]> = {
  1: ['settings', 'meta', 'materials', 'edge_bands'],
  2: ['jobs', 'job_parts', 'exports'],
  3: ['material_map', 'column_maps'],
};

const COLUMNS: Record<string, string[]> = {
  settings: ['key', 'value'], meta: ['key', 'value'],
  materials: ['id', 'source', 'code', 'name', 'sheet_w', 'sheet_h', 'thickness', 'grain', 'position'],
  edge_bands: ['id', 'source', 'code', 'name', 'position'],
  jobs: ['id', 'name', 'note', 'created_at', 'updated_at', 'source_name', 'source_kind', 'source_size', 'source_sha256', 'source_path', 'state', 'part_count', 'outputs', 'export_status', 'last_export_at', 'search', 'source_bytes'],
  job_parts: ['job_id', 'position', 'material', 'wt_code', 'dim1', 'dim2', 'edge1', 'edge2', 'grain', 'qty', 'name'],
  exports: ['id', 'job_id', 'material', 'file_name', 'folder', 'exported_at', 'record_count', 'size', 'sha256', 'result', 'bytes'],
  material_map: ['name', 'label', 'wt_code', 'band', 'grain', 'updated_at'],
  column_maps: ['signature', 'mapping', 'updated_at'],
};

export function expectedTables(version: number): string[] {
  return Object.entries(TABLES_BY_VERSION)
    .filter(([v]) => Number(v) <= version)
    .flatMap(([, t]) => t);
}

export interface BackupSummary {
  schemaVersion: number;
  jobs: number;
  /** Vreme izmene najnovijeg posla (updated_at), ms; null kad nema poslova. */
  newestJobAt: number | null;
  size: number;
}

const SQLITE_MAGIC = 'SQLite format 3\u0000';

function hasSqliteHeader(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    return readSync(fd, buf, 0, 16, 0) === 16 && buf.toString('latin1') === SQLITE_MAGIC;
  } finally {
    closeSync(fd);
  }
}

/**
 * Proverava da je fajl SQLite baza OVE aplikacije čija šema nije novija od `latestVersion`. Ne menja ništa;
 * baca BackupError sa razlogom. Fajl se otvara samo za čitanje.
 */
export function inspectDatabaseFile(file: string, latestVersion: number): BackupSummary {
  let st;
  try {
    st = statSync(file);
  } catch {
    throw new BackupError('Fajl ne postoji ili se ne može pročitati.');
  }
  if (!st.isFile()) throw new BackupError('Izabrana putanja nije fajl.');
  if (st.size === 0 || !hasSqliteHeader(file)) throw new BackupError('Fajl nije SQLite baza, pa se ne može vratiti.');

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    throw new BackupError('Fajl se ne može otvoriti kao baza (oštećen je ili nije SQLite).');
  }
  try {
    let integrity: string[];
    try {
      integrity = (db.prepare('PRAGMA integrity_check').all() as Record<string, string>[]).map((r) => Object.values(r)[0]);
    } catch {
      throw new BackupError('Fajl se ne može proveriti kao baza (oštećen je ili nije SQLite).');
    }
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new BackupError('Provera celovitosti baze nije prošla: kopija je oštećena.');
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > latestVersion) {
      throw new BackupError(`Kopija je napravljena novijom verzijom programa (šema ${version}, ova verzija zna do ${latestVersion}). Instalirajte noviju verziju programa.`);
    }
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    if (version < 1 || expectedTables(version).some((t) => !tables.has(t))) {
      throw new BackupError('Fajl je SQLite baza, ali nije baza ovog programa.');
    }
    for (const table of expectedTables(version)) {
      const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name));
      if (COLUMNS[table].some((c) => !columns.has(c))) throw new BackupError('Fajl nema očekivanu šemu baze ovog programa.');
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new BackupError('Kopija sadrži nepovezane podatke i ne može se vratiti.');
    let jobs = 0;
    let newest: number | null = null;
    if (version >= 2) {
      const r = db.prepare('SELECT count(*) AS n, max(updated_at) AS t FROM jobs').get() as { n: number; t: number | null };
      jobs = r.n;
      newest = r.t;
    }
    return { schemaVersion: version, jobs, newestJobAt: newest, size: st.size };
  } finally {
    db.close();
  }
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** Datum i vreme (lokalno) za ime fajla: 2026-10-10_14-03-09. */
export const stamp = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;

export const BACKUP_PREFIX = 'csv2tab-';

export interface BackupResult extends BackupSummary {
  file: string;
  name: string;
}

/** Celovita kopija baze u `folder`; ime nosi datum i vreme. Kopija se proverava pre nego što se prijavi. */
export function createBackup(app: AppDatabase, folder: string, latestVersion: number, now = new Date()): BackupResult {
  let st;
  try {
    st = statSync(folder);
  } catch {
    throw new BackupError('Folder za rezervne kopije ne postoji.');
  }
  if (!st.isDirectory()) throw new BackupError('Folder za rezervne kopije nije folder.');

  let name = `${BACKUP_PREFIX}${stamp(now)}.db`;
  for (let i = 2; existsSync(join(folder, name)); i++) name = `${BACKUP_PREFIX}${stamp(now)}-${i}.db`;
  const file = join(folder, name);
  const part = `${file}.part`;
  try {
    rmSync(part, { force: true });
    app.sqlite.prepare('VACUUM INTO ?').run(part);
    renameSync(part, file);
    return { file, name, ...inspectDatabaseFile(file, latestVersion) };
  } catch (e) {
    rmSync(part, { force: true });
    rmSync(file, { force: true });
    if (e instanceof BackupError) throw new BackupError(`Kopija nije ispravna: ${e.message}`);
    throw new BackupError(`Kopija nije napravljena: ${fileErrorMessage(e)}`);
  }
}

/** Kopira ponuđeni fajl na `staged` (pored žive baze, isti disk) i proverava kopiju. Original se ne dira. */
export function stageBackup(source: string, staged: string, latestVersion: number): BackupSummary {
  for (const f of [staged, `${staged}-wal`, `${staged}-shm`]) rmSync(f, { force: true });
  try {
    if (!statSync(source).isFile()) throw new BackupError('Izabrana putanja nije fajl.');
    copyFileSync(source, staged);
    return inspectDatabaseFile(staged, latestVersion);
  } catch (e) {
    discardStaged(staged);
    if (e instanceof BackupError) throw e;
    throw new BackupError('Fajl se ne može pročitati.');
  }
}

export function discardStaged(staged: string): void {
  for (const f of [staged, `${staged}-wal`, `${staged}-shm`]) rmSync(f, { force: true });
}

export interface RestoreResult {
  db: AppDatabase;
  /** Putanja sigurnosne kopije baze koja je zamenjena. */
  safetyCopy: string;
}

/**
 * Zamenjuje bazu `current` proverenom kopijom `staged` (iz stageBackup). Redosled:
 *  1. kopija se ponovo proverava i MIGRIRA na svom mestu (starija kopija se dovodi na tekuću šemu); do ovde se
 *     tekuća baza ne dira, pa svaka greška ostavlja sve kako jeste;
 *  2. tekuća baza se zatvara (checkpoint), uklanjaju se zaostali -wal/-shm;
 *  3. tekući fajl se preimenuje u sigurnosnu kopiju pored njega, a kopija postaje tekući fajl;
 *  4. baza se otvara iz novog fajla. Ako bilo šta od 3 i 4 padne, vraća se stari fajl i otvara se on.
 * `afterSwap` je samo za testove (simulira grešku posle zamene fajlova).
 * Pozivalac mora da obezbedi da niko ne piše u bazu dok traje poziv (sve je sinhrono) i da zameni `current` vraćenom bazom.
 */
export function restoreDatabase(current: AppDatabase, staged: string, opts: OpenOptions, now = new Date(), afterSwap?: () => void): RestoreResult {
  const latest = loadMigrations(opts.migrationsDir).length;
  try {
    inspectDatabaseFile(staged, latest);
    const migrated = openDatabase({ ...opts, file: staged });
    migrated.close();
  } catch (e) {
    discardStaged(staged);
    if (e instanceof BackupError) throw e;
    throw new BackupError(`Kopija se ne može dovesti na tekuću šemu: ${fileErrorMessage(e)}`);
  } finally {
    // openDatabase pravi .v<N>.bak pored kopije pre migracije; kopija je privremena, original ostaje kod korisnika
    for (let v = 1; v <= latest; v++) rmSync(`${staged}.v${v}.bak`, { force: true });
  }

  const file = current.file;
  let safetyCopy = `${file}.pre-restore-${stamp(now)}`;
  for (let i = 2; existsSync(safetyCopy); i++) safetyCopy = `${file}.pre-restore-${stamp(now)}-${i}`;

  let swapped = false;
  let closed = false;
  try {
    current.close();
    closed = true;
    for (const f of [`${file}-wal`, `${file}-shm`, `${staged}-wal`, `${staged}-shm`]) rmSync(f, { force: true });
    renameSync(file, safetyCopy);
    try {
      renameSync(staged, file);
      swapped = true;
    } catch (e) {
      renameSync(safetyCopy, file);
      throw e;
    }
    afterSwap?.();
    return { db: openDatabase({ ...opts, file }), safetyCopy };
  } catch (e) {
    // vraćanje na staro stanje: stari fajl na svoje mesto, pa ga otvoriti
    if (swapped) {
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
      renameSync(safetyCopy, file);
    }
    if (closed) Object.assign(current, openDatabase({ ...opts, file }));
    discardStaged(staged);
    throw new BackupError(`Vraćanje nije uspelo, ostala je trenutna baza: ${fileErrorMessage(e)}`);
  }
}
