// Provera oblika argumenata koje šalje renderer; čiste funkcije (bez Electrona), pa se testiraju u Node-u.
import { readWtTab } from '../../../web/src/lib/wtTab';
import type { ComparePayload, ExportItem } from '../../shared/api';
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
    return { name: it.name, bytes };
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
