// Pretvara app:// adresu u putanju fajla unutar foldera renderera; sve što izlazi iz njega vraća null.
import { isAbsolute, relative, resolve } from 'node:path';
import { APP_HOST, APP_SCHEME } from '../shared/api';

export function resolveAppPath(root: string, address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (path.includes('\0') || path.includes('\\')) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || /^[a-zA-Z]:$/.test(p))) return null;
  const file = resolve(root, parts.join('/') || 'index.html');
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return file;
}
