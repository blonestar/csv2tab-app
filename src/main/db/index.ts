// Baza: jedan SQLite fajl preko ugrađenog node:sqlite. Ne uvozi ništa iz Electrona, pa radi i u običnom Node-u (testovi).
// Putanja fajla i folder migracija dolaze kao argumenti.
import { existsSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { WtCatalog } from '@core/catalog';
import { syncCatalog } from './catalog';
import { DatabaseTooNewError, applyMigrations, loadMigrations, schemaVersion, type Migration } from './migrate';

export { DatabaseTooNewError, MigrationError } from './migrate';

export interface AppDatabase {
  sqlite: DatabaseSync;
  file: string;
  /** Verzija šeme posle migracija. */
  schemaVersion: number;
  /** Putanja kopije pravljene pre migracije, ili null ako migracije nije bilo. */
  backupPath: string | null;
  /** Checkpoint WAL-a i zatvaranje. */
  close(): void;
}

export interface OpenOptions {
  file: string;
  migrationsDir: string;
  /** Ugrađeni katalog; ako je zadat, baza se puni/osvežava njime. */
  catalog?: WtCatalog;
}

/** Verzija šeme postojećeg fajla, bez ikakve izmene (otvaranje samo za čitanje). */
function peekVersion(file: string): number {
  if (!existsSync(file) || statSync(file).size === 0) return 0;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return schemaVersion(db);
  } finally {
    db.close();
  }
}

export function backupPathFor(file: string, fromVersion: number): string {
  return `${file}.v${fromVersion}.bak`;
}

export function openDatabase(opts: OpenOptions): AppDatabase {
  const migrations: Migration[] = loadMigrations(opts.migrationsDir);
  const latest = migrations.length;

  const existing = peekVersion(opts.file);
  if (existing > latest) throw new DatabaseTooNewError(existing, latest);

  const db = new DatabaseSync(opts.file);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 3000');

    let backupPath: string | null = null;
    if (existing > 0 && existing < latest) {
      // Kopija pre migracije; VACUUM INTO daje celovit fajl i kad deo podataka još stoji u WAL-u.
      backupPath = backupPathFor(opts.file, existing);
      rmSync(backupPath, { force: true });
      db.prepare('VACUUM INTO ?').run(backupPath);
    }
    applyMigrations(db, migrations);
    if (opts.catalog) syncCatalog(db, opts.catalog);

    return {
      sqlite: db,
      file: opts.file,
      schemaVersion: schemaVersion(db),
      backupPath,
      close() {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.close();
      },
    };
  } catch (e) {
    db.close();
    throw e;
  }
}
