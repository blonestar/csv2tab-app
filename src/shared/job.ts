// Stanje jednog uvezenog fajla: sve što korisnik odlučuje, kao običan JSON (bez Map, Set, Uint8Array, klasa).
// Baza čuva tačno `bajtovi izvora + JobState` (jobs.state, proverava ga parseJobState u src/shared/jobStateCheck.ts);
// zapisi se ponovo računaju iz toga funkcijom `deriveJob` (src/renderer/job/derive.ts). Ništa što utiče na izlaz ne sme da živi van ovog objekta.
import type { InputEncoding } from '@core/encoding';
import type { ColumnMapping, EdgeRule } from '@core/parts';

export type SourceKind = 'csv' | 'ods' | 'xlsx' | 'tab';

/** Polja zapisa koja korisnik može ručno da izmeni. */
export const EDIT_FIELDS = ['dim1', 'dim2', 'edge1', 'edge2', 'grain', 'qty', 'name'] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

/** Ručna izmena jednog zapisa; čuva se samo ono što se razlikuje od izračunatog. */
export interface PartEdit {
  dim1?: number;
  dim2?: number;
  edge1?: number;
  edge2?: number;
  grain?: number;
  qty?: number;
  name?: string;
}

/** Izbor za jedan materijal iz fajla. Odsutno polje = podrazumevano (predlog iz kataloga). */
export interface MaterialChoice {
  /** Šifra WT materijala; `null` = korisnik je izričito izabrao „nijedan"; odsutno = automatski predlog. */
  wt?: string | null;
  /** Šifra trake u imenu fajla; odsutno = bez trake. */
  band?: string;
  /** „Prati teksturu"; odsutno = iz kataloga (izabrani materijal), inače podrazumevano po nazivu. */
  grain?: 0 | 1;
  /** Ime izlaznog fajla (bez .tab); odsutno = predlog. */
  fileName?: string;
  /** Polja koja su pri pravljenju posla preuzeta iz pamćenja izbora (ne ručno u ovom poslu); ručna izmena polja ga uklanja. */
  fromMemory?: MemoryField[];
}

export const MEMORY_FIELDS = ['wt', 'band', 'grain'] as const;
export type MemoryField = (typeof MEMORY_FIELDS)[number];

/**
 * Novo polje ili promena značenja = nova verzija i prelaz sa stare (`upgradeJobStateV1` u jobStateCheck.ts);
 * parseJobState zna samo verzije koje poznaje.
 *
 * Verzija 2 (faza 5): sve što utiče na izlaz posla je u stanju. Tabela šifara kantovanja i pravilo za jednobojne
 * dekore su SNIMAK iz trenutka pravljenja posla (ili poslednje primene podešavanja), pa kasnija promena podešavanja
 * ne menja stari posao; isto važi za izbore preuzete iz pamćenja (`fromMemory`) i mapiranje iz pamćenja.
 */
export interface JobState {
  version: 2;
  /** Kodiranje CSV-a; 'auto' = prepoznato. */
  encoding: 'auto' | InputEncoding;
  /** Separator CSV-a; 'auto' = prepoznat. */
  delimiter: 'auto' | string;
  /** Redni broj lista (ODS, XLSX). */
  sheet: number;
  /** 'auto' = po zaglavlju; inače izbor korisnika (indeks kolone po polju, -1 = nema). */
  mapping: 'auto' | ColumnMapping;
  /** Spajanje istih delova. */
  merge: boolean;
  /** Ključ je naziv materijala iz fajla ('' = zapisi bez materijala i zapisi iz .tab fajla). */
  materials: Record<string, MaterialChoice>;
  /** Ključ je `PartRecord.key`. */
  edits: Record<string, PartEdit>;
  /** Snimak tabele šifara kantovanja (jezgro: `EdgeRule`). */
  edgeRules: EdgeRule[];
  /** Snimak pravila: materijal imenovan kao „U" + cifre (jednobojni dekor) podrazumevano ne prati teksturu. false = prate svi. */
  decorRule: boolean;
  /** `mapping` je preuzet iz pamćenja mapiranja kolona, ne izabran ručno u ovom poslu. */
  mappingFromMemory: boolean;
}

/** Fajl onako kako ga renderer dobija (dijalog, prevlačenje). Putanje nema. */
export interface OpenedFile {
  name: string;
  kind: SourceKind;
  bytes: Uint8Array;
}

export const MAX_OPEN_BYTES = 50 * 1024 * 1024;

/** Vrsta fajla po ekstenziji; null = nepodržano. */
export function kindFromName(name: string): SourceKind | null {
  const ext = /\.([^.\\/]+)$/.exec(name)?.[1].toLowerCase();
  if (ext === 'ods' || ext === 'xlsx' || ext === 'tab') return ext;
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return 'csv';
  return null;
}

export const UNSUPPORTED_MSG = 'Nepodržan tip fajla. Podržani su .csv, .ods, .xlsx i .tab (stari .xls sačuvajte kao .xlsx).';
