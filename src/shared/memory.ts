// Pamćenje izbora: tipovi, ključevi i provera. Čiste funkcije bez Electrona (koriste ih glavni proces i renderer).
//  - izbor po materijalu: ključ je naziv materijala iz fajla sveden na `memoryKey`;
//  - mapiranje kolona: ključ je potpis zaglavlja (`headerSignature`).
// Pamćenje utiče samo na NOVE poslove: pri pravljenju posla se izbori kopiraju u JobState (vidi PROJECT.md).
import { FIELDS, missingFields, normHeader, type ColumnMapping } from '../../web/src/lib/parts';
import { MEMORY_FIELDS, type MemoryField } from './job';

export const MEMORY_LIMITS = {
  /** Naziv materijala i šifre. */
  text: 300,
  /** Potpis zaglavlja u znakovima. */
  signature: 2000,
  /** Najviše materijala u jednom upitu ili upisu. */
  batch: 2000,
} as const;

/** Razdvajač ćelija u potpisu zaglavlja (znak koji se ne pojavljuje u običnom tekstu). */
export const SIGNATURE_SEP = '\u001f';

/** Zapamćen izbor za materijal; odsutno polje = ništa nije zapamćeno (važi predlog). `wt: null` = izričito „nijedan"; `band: ''` = izričito bez trake. */
export interface MaterialMemory {
  wt?: string | null;
  band?: string;
  grain?: 0 | 1;
}

/** Upis u pamćenje: zadata polja se postavljaju, polja iz `clear` se brišu. */
export interface MaterialMemoryUpdate extends MaterialMemory {
  /** Naziv materijala iz fajla (ključ se izvodi iz njega). */
  name: string;
  clear?: MemoryField[];
}

export interface MemoryUpdate {
  materials: MaterialMemoryUpdate[];
  mapping?: { signature: string; mapping: ColumnMapping };
}

export interface MemoryLookup {
  names: string[];
  signature: string | null;
}

/** Odgovor na upit: ključ je naziv onako kako je poslat (ne normalizovan). */
export interface MemoryFound {
  materials: Record<string, MaterialMemory>;
  mapping: ColumnMapping | null;
}

export interface MaterialMemoryEntry extends MaterialMemory {
  key: string;
  /** Naziv materijala kako je poslednji put viđen u fajlu. */
  label: string;
  updatedAt: number;
}

export interface MappingMemoryEntry {
  signature: string;
  /** Zaglavlje (svedeno) razloženo na kolone, za prikaz. */
  header: string[];
  mapping: ColumnMapping;
  updatedAt: number;
}

export interface MemoryList {
  materials: MaterialMemoryEntry[];
  mappings: MappingMemoryEntry[];
}

/** Ključ materijala: Unicode NFC, razmaci na krajevima skinuti, više razmaka u jedan, mala slova. Dijakritici se NE skidaju. */
export function memoryKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Naziv se pamti samo ako ima sadržaj (zapisi bez materijala nemaju šta da pamte). */
export const rememberable = (name: string): boolean => memoryKey(name) !== '';

/**
 * Potpis zaglavlja: ćelije prvog reda svedene `normHeader` (BOM, razmaci, veličina slova), prazne ćelije na kraju
 * skinute (ODS/XLSX redovi su dopunjeni do iste širine). Isti potpis = ista zaglavlja istim redosledom, pa isti
 * indeksi kolona znače isto. null = nema zaglavlja za pamćenje (prazan red ili preveliko).
 */
export function headerSignature(header: readonly string[] | undefined): string | null {
  if (!header) return null;
  const cells = header.map(normHeader);
  if (cells.some((c) => c.includes(SIGNATURE_SEP))) return null;
  while (cells.length && cells[cells.length - 1] === '') cells.pop();
  if (cells.length === 0 || cells.length > 200) return null;
  const sig = cells.join(SIGNATURE_SEP);
  return sig.length > MEMORY_LIMITS.signature ? null : sig;
}

export const signatureColumns = (signature: string): number => signature.split(SIGNATURE_SEP).length;

/** Mapiranje koje se sme primeniti na zaglavlje sa tolikim brojem kolona: indeksi u opsegu, obavezne kolone zadate. */
export function mappingFitsColumns(m: ColumnMapping, columns: number): boolean {
  return FIELDS.every((f) => Number.isInteger(m[f]) && m[f] >= -1 && m[f] < columns) && missingFields(m).length === 0;
}

// ---------- provera argumenata ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, what: string, max: number = MEMORY_LIMITS.text): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error(`${what}: očekivan je tekst do ${max} znakova.`);
  return v;
};

export function mappingArg(v: unknown): ColumnMapping {
  if (!isObj(v) || Object.keys(v).length !== FIELDS.length) throw new Error('Mapiranje kolona nije ispravno.');
  const out = {} as ColumnMapping;
  for (const f of FIELDS) {
    const x = v[f];
    if (typeof x !== 'number' || !Number.isInteger(x) || x < -1 || x > 1000) throw new Error('Mapiranje kolona nije ispravno.');
    out[f] = x;
  }
  return out;
}

export function signatureArg(v: unknown): string {
  const s = text(v, 'Potpis zaglavlja', MEMORY_LIMITS.signature);
  if (s === '') throw new Error('Potpis zaglavlja je prazan.');
  return s;
}

export function materialMemoryArg(v: unknown, what = 'Pamćenje materijala'): MaterialMemory {
  if (!isObj(v)) throw new Error(`${what}: očekivan je objekat.`);
  for (const k of Object.keys(v)) if (!(MEMORY_FIELDS as readonly string[]).includes(k)) throw new Error(`${what}: nepoznato polje.`);
  const out: MaterialMemory = {};
  if (Object.hasOwn(v, 'wt')) {
    if (v.wt !== null && !(typeof v.wt === 'string' && v.wt.length > 0 && v.wt.length <= MEMORY_LIMITS.text)) throw new Error(`${what}: neispravan WT materijal.`);
    out.wt = v.wt as string | null;
  }
  if (Object.hasOwn(v, 'band')) out.band = text(v.band, `${what}: traka`);
  if (Object.hasOwn(v, 'grain')) {
    if (v.grain !== 0 && v.grain !== 1) throw new Error(`${what}: „Prati teksturu" mora biti 0 ili 1.`);
    out.grain = v.grain;
  }
  return out;
}

export function memoryUpdateArg(v: unknown): MemoryUpdate {
  if (!isObj(v)) throw new Error('Upis u pamćenje nije ispravan.');
  for (const k of Object.keys(v)) if (k !== 'materials' && k !== 'mapping') throw new Error('Upis u pamćenje nije ispravan.');
  if (!Array.isArray(v.materials) || v.materials.length > MEMORY_LIMITS.batch) throw new Error('Spisak materijala za pamćenje nije ispravan.');
  const materials = v.materials.map((m: unknown): MaterialMemoryUpdate => {
    if (!isObj(m)) throw new Error('Materijal za pamćenje nije ispravan.');
    for (const k of Object.keys(m)) if (!['name', 'wt', 'band', 'grain', 'clear'].includes(k)) throw new Error('Materijal za pamćenje nije ispravan.');
    const { name, clear: _clear, ...choice } = m;
    const out: MaterialMemoryUpdate = { name: text(name, 'Naziv materijala'), ...materialMemoryArg(choice) };
    if (!rememberable(out.name)) throw new Error('Materijal bez naziva se ne pamti.');
    if (m.clear !== undefined) {
      const c = m.clear;
      if (!Array.isArray(c) || c.length > MEMORY_FIELDS.length || !c.every((x) => (MEMORY_FIELDS as readonly unknown[]).includes(x))) throw new Error('Spisak polja za brisanje nije ispravan.');
      out.clear = [...new Set(c as MemoryField[])];
      for (const f of out.clear) if (Object.hasOwn(out, f)) throw new Error('Polje ne može biti i postavljeno i obrisano.');
    }
    return out;
  });
  const out: MemoryUpdate = { materials };
  if (v.mapping !== undefined) {
    if (!isObj(v.mapping)) throw new Error('Mapiranje za pamćenje nije ispravno.');
    for (const k of Object.keys(v.mapping)) if (k !== 'signature' && k !== 'mapping') throw new Error('Mapiranje za pamćenje nije ispravno.');
    const signature = signatureArg(v.mapping.signature);
    const mapping = mappingArg(v.mapping.mapping);
    if (!mappingFitsColumns(mapping, signatureColumns(signature))) throw new Error('Mapiranje ne odgovara zaglavlju.');
    out.mapping = { signature, mapping };
  }
  return out;
}

export function memoryLookupArg(v: unknown): MemoryLookup {
  if (!isObj(v) || !Array.isArray(v.names) || v.names.length > MEMORY_LIMITS.batch) throw new Error('Upit u pamćenje nije ispravan.');
  for (const k of Object.keys(v)) if (k !== 'names' && k !== 'signature') throw new Error('Upit u pamćenje nije ispravan.');
  const names = v.names.map((n: unknown) => text(n, 'Naziv materijala'));
  return { names, signature: v.signature === null ? null : signatureArg(v.signature) };
}
