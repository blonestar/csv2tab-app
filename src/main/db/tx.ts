import type { DatabaseSync } from 'node:sqlite';

/** Izvršava fn u jednoj transakciji: COMMIT ako prođe, ROLLBACK i ista greška ako ne. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite je transakciju možda već sam poništio
    }
    throw e;
  }
}
