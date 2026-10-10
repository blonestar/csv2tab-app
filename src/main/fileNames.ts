// Za prikaz u rendereru: samo naziv foldera i poruke bez putanja iz grešaka fajl sistema.
import { posix } from 'node:path';

export function folderName(path: string): string {
  if (!path) return '';
  const name = posix.basename(path.replaceAll('\\', '/'));
  return !name || /^[a-z]:$/i.test(name) ? 'Izabrani folder' : name;
}

export function fileErrorMessage(error: unknown): string {
  // SQLite CANTOPEN takođe upisuje putanju u message, ali nema polje path.
  const sqlitePath = error instanceof Error && 'code' in error && error.code === 'ERR_SQLITE_ERROR' && 'errcode' in error && error.errcode === 14;
  if (error instanceof Error && ('path' in error || 'dest' in error || sqlitePath)) {
    const code = 'code' in error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : '';
    return `Operacija sa fajlom nije uspela${code}.`;
  }
  return error instanceof Error ? error.message : String(error);
}
