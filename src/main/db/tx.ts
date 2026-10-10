import type { DatabaseSync } from 'node:sqlite';

let nested = 0;

/**
 * Izvršava fn u jednoj transakciji: COMMIT ako prođe, ROLLBACK i ista greška ako ne. Pozvana unutar druge
 * transakcije (npr. čuvanje posla zajedno sa pamćenjem izbora) koristi SAVEPOINT: greška poništava samo svoj deo,
 * a spoljna transakcija odlučuje o celini.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const inner = db.isTransaction;
  const sp = `sp_${++nested}`;
  db.exec(inner ? `SAVEPOINT ${sp}` : 'BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec(inner ? `RELEASE ${sp}` : 'COMMIT');
    return result;
  } catch (e) {
    try {
      if (inner) db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      else db.exec('ROLLBACK');
    } catch {
      // SQLite je transakciju možda već sam poništio
    }
    throw e;
  } finally {
    nested--;
  }
}
