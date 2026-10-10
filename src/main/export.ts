// Upis .tab fajlova u WT folder: provera šta već postoji i atomičan upis. Bez Electrona, radi i u Node-u (testovi).
import { randomBytes } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExportCheck, ExportItem, ExportWriteResult } from '../shared/api';
import { exportFileName } from './exportName';
import { fileErrorMessage, folderName } from './fileNames';

/** .tab ima najviše 65535 zapisa: 165 + 65535 * 79 bajtova. */
export const MAX_TAB_BYTES = 165 + 65535 * 79;

type FolderState = { ok: true; folder: string } | Extract<ExportCheck, { ok: false }>;

export async function folderState(folder: string): Promise<FolderState> {
  const label = folderName(folder);
  if (!folder) {
    return { ok: false, reason: 'no-folder', folder, message: 'WT folder nije zadat. Izaberite ga u podešavanjima.' };
  }
  try {
    if ((await stat(folder)).isDirectory()) return { ok: true, folder: label };
  } catch {
    /* ne postoji ili nije dostupan */
  }
  return { ok: false, reason: 'folder-missing', folder: label, message: `WT folder „${label}" ne postoji ili nije dostupan. Izaberite ga ponovo.` };
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(a, b) === 0;

interface Existing {
  exists: boolean;
  bytes: Uint8Array | null;
}

async function readExisting(path: string): Promise<Existing> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return { exists: false, bytes: null };
  }
  if (!st.isFile() || st.size > MAX_TAB_BYTES) return { exists: true, bytes: null };
  try {
    return { exists: true, bytes: new Uint8Array(await readFile(path)) };
  } catch {
    return { exists: true, bytes: null };
  }
}

/** Svaka stavka dobija konačno ime; dve stavke sa istim imenom (bez obzira na veličinu slova) se odbijaju. */
export function finalNames(items: readonly ExportItem[]): string[] {
  const names = items.map((i) => exportFileName(i.name));
  const seen = new Set<string>();
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) throw new Error(`Dva fajla bi dobila isto ime: ${n}.`);
    seen.add(k);
  }
  return names;
}

export async function checkExport(folder: string, items: readonly ExportItem[]): Promise<ExportCheck> {
  const names = finalNames(items);
  const fs = await folderState(folder);
  if (!fs.ok) return fs;
  const out: Extract<ExportCheck, { ok: true }>['items'] = [];
  for (let i = 0; i < items.length; i++) {
    const ex = await readExisting(join(folder, names[i]));
    if (!ex.exists) out.push({ name: names[i], status: 'new', existing: null });
    else if (ex.bytes && same(ex.bytes, items[i].bytes)) out.push({ name: names[i], status: 'identical', existing: null });
    else out.push({ name: names[i], status: 'differs', existing: ex.bytes });
  }
  return { ok: true, folder: fs.folder, items: out };
}

/** Privremeni fajl u istom folderu, pa rename: na disku je uvek ili stari ili ceo novi fajl. */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const fh = await open(tmp, 'wx');
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/** Postojeći različit fajl se prepisuje samo ako je njegovo konačno ime u `overwrite` (korisnik je video razlike). */
export async function writeExport(folder: string, items: readonly ExportItem[], overwrite: readonly string[]): Promise<ExportWriteResult> {
  const names = finalNames(items);
  const allowed = new Set(overwrite.map((n) => exportFileName(n).toLowerCase()));
  const fs = await folderState(folder);
  if (!fs.ok) return fs;
  const out: Extract<ExportWriteResult, { ok: true }>['items'] = [];
  for (let i = 0; i < items.length; i++) {
    const name = names[i];
    const path = join(folder, name);
    try {
      const ex = await readExisting(path);
      if (ex.exists && ex.bytes && same(ex.bytes, items[i].bytes)) out.push({ name, status: 'identical' });
      else if (ex.exists && !allowed.has(name.toLowerCase())) {
        out.push({ name, status: 'skipped', message: 'Fajl već postoji i nije potvrđeno prepisivanje.' });
      } else {
        await writeAtomic(path, items[i].bytes);
        out.push({ name, status: 'written' });
      }
    } catch (e) {
      out.push({ name, status: 'error', message: fileErrorMessage(e) });
    }
  }
  return { ok: true, folder: fs.folder, items: out };
}
