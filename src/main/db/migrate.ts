// Migracije: numerisani SQL fajlovi (0001_ime.sql ...), verzija šeme je PRAGMA user_version.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './tx';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Baza je novija od aplikacije: ne otvara se i ne menja. */
export class DatabaseTooNewError extends Error {
  constructor(
    readonly dbVersion: number,
    readonly appVersion: number,
  ) {
    super(`Baza ima šemu ${dbVersion}, a ova verzija aplikacije zna samo do ${appVersion}.`);
    this.name = 'DatabaseTooNewError';
  }
}

export class MigrationError extends Error {
  constructor(
    readonly version: number,
    cause: unknown,
  ) {
    super(`Migracija ${version} nije uspela: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'MigrationError';
  }
}

/** Čita migracije iz foldera. Brojevi moraju da idu bez rupa od 1; drugačiji .sql fajl je greška. */
export function loadMigrations(dir: string): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  return files.map((file, i) => {
    const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
    if (!m || Number(m[1]) !== i + 1) throw new Error(`Neispravno ime ili redosled migracije: ${file}`);
    return { version: i + 1, name: file, sql: readFileSync(join(dir, file), 'utf8') };
  });
}

export function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

/** Primenjuje migracije novije od trenutne verzije, svaku u svojoj transakciji (verzija se podiže u istoj). */
export function applyMigrations(db: DatabaseSync, migrations: Migration[]): void {
  const current = schemaVersion(db);
  for (const m of migrations) {
    if (m.version <= current) continue;
    try {
      transaction(db, () => {
        db.exec(m.sql);
        db.exec(`PRAGMA user_version = ${m.version}`);
      });
    } catch (e) {
      throw new MigrationError(m.version, e);
    }
  }
}
