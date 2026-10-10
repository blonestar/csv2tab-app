// Putanje fajlova uvezenih kroz dijalog: glavni proces ih pamti uz SHA-256 sadržaja, pa ih jobs.create može upisati
// uz posao bez ikakvog učešća renderera (on putanju nikad ne vidi ni ne zadaje). Prevučen fajl putanju nema.
import { createHash } from 'node:crypto';

const MAX = 32;
const recent = new Map<string, string>();

const key = (name: string, bytes: Uint8Array) => `${name}\0${createHash('sha256').update(bytes).digest('hex')}`;

export function rememberOpenedPath(name: string, bytes: Uint8Array, path: string): void {
  const k = key(name, bytes);
  recent.delete(k);
  recent.set(k, path);
  if (recent.size > MAX) recent.delete(recent.keys().next().value as string);
}

export function openedPathFor(name: string, bytes: Uint8Array): string | null {
  return recent.get(key(name, bytes)) ?? null;
}
