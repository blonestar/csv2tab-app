// Preuzimanje portable izdanja: electron-updater tu ne radi, pa fajl skida sam program u folder portable exe-a.
// Fajl stiže pod privremenim imenom (.part) i preimenuje se tek kad je ceo stigao; stari fajl se ne dira.
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { UpdateFailure } from './update';

/** Javni izvor izdanja (isti kao `publish` u electron-builder.yml). */
export const PORTABLE_REPO = 'blonestar/csv2tab-app';
const DOWNLOAD_FAILED = 'Preuzimanje nije uspelo. Proverite internet vezu i pokušajte ponovo.';

export function portableFileName(version: string): string {
  return `csv2tab-app-${version}-windows-x64-portable.exe`;
}

export function portableUrl(version: string): string {
  return `https://github.com/${PORTABLE_REPO}/releases/download/v${version}/${portableFileName(version)}`;
}

/** Skida portable izdanje u `dir` i vraća naziv fajla. Greške su UpdateFailure sa porukom bez putanja. */
export async function downloadPortable(
  version: string,
  dir: string,
  onProgress: (percent: number) => void,
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<string> {
  const name = portableFileName(version);
  const finalPath = join(dir, name);
  const partPath = `${finalPath}.part`;
  // fetch prati preusmerenja (GitHub šalje na svoj server za fajlove)
  const response = await fetchFn(portableUrl(version)).catch(() => null);
  if (!response || response.status !== 200 || !response.body) {
    await response?.body?.cancel().catch(() => {});
    throw new UpdateFailure(DOWNLOAD_FAILED);
  }
  const length = Number(response.headers.get('content-length'));
  const total = Number.isSafeInteger(length) && length > 0 ? length : 0;
  let received = 0;
  async function* chunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      received += value.byteLength;
      if (total) onProgress(Math.min(100, Math.floor((received * 100) / total)));
      yield value;
    }
  }
  try {
    await pipeline(chunks(response.body), createWriteStream(partPath));
    // bez dužine u odgovoru ne može se proveriti, pa se proverava samo da je prenos stigao do kraja
    if (total && received !== total) throw new UpdateFailure(DOWNLOAD_FAILED);
    await rename(partPath, finalPath);
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => {});
    throw error instanceof UpdateFailure ? error : new UpdateFailure(DOWNLOAD_FAILED);
  }
  return name;
}
