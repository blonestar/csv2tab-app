// Provera oblika argumenata koje šalje renderer; čiste funkcije (bez Electrona), pa se testiraju u Node-u.
import { HEADER_SIZE, RECORD_SIZE, readWtTab } from '../../../web/src/lib/wtTab';
import type { ComparePayload, ExportItem, JobMeta } from '../../shared/api';
import { MAX_OPEN_BYTES, kindFromName, type OpenedFile } from '../../shared/job';
import { STATE_LIMITS, parseJobState } from '../../shared/jobStateCheck';
import {
  MAX_JOB_LIST,
  MAX_JOB_NAME,
  MAX_JOB_NOTE,
  MAX_JOB_PARTS,
  type JobListQuery,
  type JobSave,
  type SavedOutput,
  type SavedPart,
} from '../../shared/jobs';
import { MAX_TAB_BYTES } from '../export';
import { exportFileName } from '../exportName';

export const MAX_EXPORT_ITEMS = 100;
const MAX_NAME = 300;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Kroz IPC bajtovi stižu kao Uint8Array (ili Buffer, što je njegov podtip) ili ArrayBuffer; sve ostalo se odbija. */
export function bytesArg(v: unknown, label: string): Uint8Array {
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  throw new Error(`${label}: očekivani su bajtovi.`);
}

/** Lista fajlova za upis: ime i bajtovi koji su stvarno ispravan WT .tab (zaglavlje, veličina, broj zapisa). */
export function exportItemsArg(v: unknown): ExportItem[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_EXPORT_ITEMS) {
    throw new Error(`Očekivana je lista od 1 do ${MAX_EXPORT_ITEMS} fajlova.`);
  }
  return v.map((it, i) => {
    if (!isObj(it) || typeof it.name !== 'string' || it.name.length === 0 || it.name.length > MAX_NAME) {
      throw new Error(`Fajl ${i + 1}: neispravno ime.`);
    }
    const bytes = bytesArg(it.bytes, `Fajl ${i + 1}`);
    if (bytes.length > MAX_TAB_BYTES) throw new Error(`Fajl ${i + 1}: veći je od najvećeg mogućeg .tab fajla.`);
    let warnings: string[];
    try {
      warnings = readWtTab(bytes).warnings;
    } catch (e) {
      throw new Error(`Fajl ${i + 1}: ${e instanceof Error ? e.message : 'nije WT .tab'}`);
    }
    if (warnings.length) throw new Error(`Fajl ${i + 1}: ${warnings[0]}`);
    if (it.material !== undefined && (typeof it.material !== 'string' || it.material.length > STATE_LIMITS.text)) {
      throw new Error(`Fajl ${i + 1}: neispravan naziv materijala.`);
    }
    return it.material === undefined ? { name: it.name, bytes } : { name: it.name, bytes, material: it.material as string };
  });
}

export function overwriteArg(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_EXPORT_ITEMS) throw new Error('Spisak za prepisivanje nije ispravan.');
  return v.map((n) => {
    if (typeof n !== 'string' || n.length > MAX_NAME) throw new Error('Spisak za prepisivanje nije ispravan.');
    return exportFileName(n);
  });
}

const int = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

function partsArg(v: unknown, label: string) {
  if (!Array.isArray(v) || v.length > 65535) throw new Error(`${label}: neispravan spisak zapisa.`);
  return v.map((p, i) => {
    if (
      !isObj(p) ||
      !int(p.dim1, 0xffffffff) ||
      !int(p.dim2, 0xffffffff) ||
      !int(p.edge1, 255) ||
      !int(p.edge2, 255) ||
      !int(p.grain, 255) ||
      !int(p.qty, 65535) ||
      typeof p.name !== 'string' ||
      p.name.length > 25
    ) {
      throw new Error(`${label}: zapis ${i + 1} nije ispravan.`);
    }
    return { dim1: p.dim1 as number, dim2: p.dim2 as number, edge1: p.edge1 as number, edge2: p.edge2 as number, grain: p.grain as number, qty: p.qty as number, name: p.name };
  });
}

export function comparePayloadArg(v: unknown): ComparePayload {
  if (!isObj(v)) throw new Error('Podaci za poređenje nisu ispravni.');
  for (const k of ['aName', 'bName'] as const) {
    if (typeof v[k] !== 'string' || (v[k] as string).length > MAX_NAME) throw new Error('Naziv u poređenju nije ispravan.');
  }
  return { aName: v.aName as string, bName: v.bName as string, a: partsArg(v.a, 'Prva strana'), b: partsArg(v.b, 'Druga strana') };
}

export function compareIdArg(v: unknown): string {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v)) throw new Error('Neispravan id prozora poređenja.');
  return v;
}

// ---------- poslovi ----------
const MAX_SAVE_BYTES = 128 * 1024 * 1024;

/** Id posla: pozitivan ceo broj. */
export function jobIdArg(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw new Error('Neispravan id posla.');
  return v;
}

export function sha256Arg(v: unknown): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw new Error('Neispravan SHA-256.');
  return v;
}

/** Izvorni fajl posla: ime, tip koji odgovara imenu i bajtovi do najveće dozvoljene veličine. */
export function jobFileArg(v: unknown): OpenedFile {
  if (!isObj(v) || typeof v.name !== 'string' || v.name.length === 0 || v.name.length > MAX_NAME) throw new Error('Izvorni fajl: neispravno ime.');
  const kind = kindFromName(v.name);
  if (!kind || v.kind !== kind) throw new Error('Izvorni fajl: tip ne odgovara imenu.');
  const bytes = bytesArg(v.bytes, 'Izvorni fajl');
  if (bytes.length > MAX_OPEN_BYTES) throw new Error('Izvorni fajl je veći od 50 MB.');
  return { name: v.name, kind, bytes };
}

function savedPartsArg(v: unknown): SavedPart[] {
  if (!Array.isArray(v) || v.length > MAX_JOB_PARTS) throw new Error('Spisak zapisa posla nije ispravan.');
  return v.map((p, i) => {
    if (
      !isObj(p) ||
      typeof p.material !== 'string' ||
      p.material.length > STATE_LIMITS.text ||
      typeof p.wt !== 'string' ||
      p.wt.length > STATE_LIMITS.text ||
      !int(p.dim1, 0xffffffff) ||
      !int(p.dim2, 0xffffffff) ||
      !int(p.edge1, 255) ||
      !int(p.edge2, 255) ||
      !int(p.grain, 1) ||
      !int(p.qty, 65535) ||
      typeof p.name !== 'string' ||
      p.name.length > 25
    ) {
      throw new Error(`Zapis ${i + 1} posla nije ispravan.`);
    }
    return { material: p.material, wt: p.wt, dim1: p.dim1 as number, dim2: p.dim2 as number, edge1: p.edge1 as number, edge2: p.edge2 as number, grain: p.grain as number, qty: p.qty as number, name: p.name };
  });
}

function savedOutputsArg(v: unknown): SavedOutput[] {
  if (!Array.isArray(v) || v.length > MAX_EXPORT_ITEMS) throw new Error('Spisak izlaznih fajlova posla nije ispravan.');
  let total = 0;
  return v.map((o, i) => {
    if (!isObj(o) || typeof o.name !== 'string' || !/\.tab$/i.test(o.name) || o.name.length > MAX_NAME || typeof o.material !== 'string' || o.material.length > STATE_LIMITS.text || !int(o.count, 65535)) {
      throw new Error(`Izlazni fajl ${i + 1} posla nije ispravan.`);
    }
    const bytes = bytesArg(o.bytes, `Izlazni fajl ${i + 1}`);
    if (bytes.length !== HEADER_SIZE + (o.count as number) * RECORD_SIZE) throw new Error(`Izlazni fajl ${i + 1}: veličina ne odgovara broju zapisa.`);
    total += bytes.length;
    if (total > MAX_SAVE_BYTES) throw new Error('Izlazni fajlovi su preveliki.');
    return { name: o.name, material: o.material, count: o.count as number, bytes };
  });
}

/** Sve što renderer šalje pri čuvanju posla: stanje (strogo), zapisi (opsezi) i izlazni fajlovi (veličine). */
export function jobSaveArg(v: unknown): JobSave {
  if (!isObj(v)) throw new Error('Podaci posla nisu ispravni.');
  return { state: parseJobState(v.state), parts: savedPartsArg(v.parts), outputs: savedOutputsArg(v.outputs) };
}

export function jobListQueryArg(v: unknown): JobListQuery {
  if (!isObj(v) || typeof v.text !== 'string' || v.text.length > 200) throw new Error('Neispravna pretraga.');
  if (!int(v.offset, 1_000_000) || typeof v.limit !== 'number' || !Number.isInteger(v.limit) || v.limit < 1 || v.limit > MAX_JOB_LIST) {
    throw new Error('Neispravna stranica liste.');
  }
  return { text: v.text, offset: v.offset as number, limit: v.limit };
}

/** Ime (neprazno, bez razmaka na krajevima) i/ili napomena; nepoznato polje se odbija. */
export function jobMetaArg(v: unknown): JobMeta {
  if (!isObj(v)) throw new Error('Neispravna izmena posla.');
  for (const k of Object.keys(v)) if (k !== 'name' && k !== 'note') throw new Error('Neispravna izmena posla.');
  const out: JobMeta = {};
  if (v.name !== undefined) {
    if (typeof v.name !== 'string' || v.name.trim().length === 0 || v.name.length > MAX_JOB_NAME) throw new Error('Ime posla mora imati 1 do 200 znakova.');
    out.name = v.name.trim();
  }
  if (v.note !== undefined) {
    if (typeof v.note !== 'string' || v.note.length > MAX_JOB_NOTE) throw new Error('Napomena može imati najviše 2000 znakova.');
    out.note = v.note;
  }
  if (out.name === undefined && out.note === undefined) throw new Error('Nema šta da se izmeni.');
  return out;
}
