// Tipovi sačuvanih poslova: ono što renderer šalje pri čuvanju i ono što dobija iz glavnog procesa.
// Bajtovi izvora i izvoza se čuvaju u bazi; renderer nikad ne dobija putanje.
import type { JobState, SourceKind } from './job';
import type { MemoryUpdate } from './memory';

/** nikad izvezen / izvezen i nepromenjen / menjan posle poslednjeg izvoza */
export type ExportStatus = 'never' | 'current' | 'changed';

/** Konačan zapis posla (posle ručnih izmena). `wt` je šifra WT materijala, prazno = nijedan. */
export interface SavedPart {
  material: string;
  wt: string;
  dim1: number;
  dim2: number;
  edge1: number;
  edge2: number;
  grain: number;
  qty: number;
  name: string;
}

/** Izlazni .tab fajl koji posao trenutno daje. Glavni proces sam računa heš iz bajtova. */
export interface SavedOutput {
  material: string;
  /** Konačno ime sa .tab. */
  name: string;
  count: number;
  bytes: Uint8Array;
}

/** Sve što se čuva pri svakoj izmeni posla. */
export interface JobSave {
  state: JobState;
  parts: SavedPart[];
  outputs: SavedOutput[];
  /** Izbori koje je korisnik u ovoj izmeni ručno promenio; upisuju se u pamćenje u istoj transakciji (samo `jobs.save`). */
  remember?: MemoryUpdate;
}

/** Izlazni fajl onako kako je upisan u bazu (bez bajtova). */
export interface OutputInfo {
  material: string;
  name: string;
  sha256: string;
  count: number;
}

export interface JobListItem {
  id: number;
  name: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  sourceName: string;
  sourceKind: SourceKind;
  partCount: number;
  /** Nazivi materijala iz fajla ('' = zapisi bez materijala). */
  materials: string[];
  exportStatus: ExportStatus;
  lastExportAt: number | null;
}

export const JOB_SORT_KEYS = ['name', 'source', 'parts', 'date', 'status'] as const;
export type JobSortKey = (typeof JOB_SORT_KEYS)[number];

export interface JobListQuery {
  text: string;
  offset: number;
  limit: number;
  /** Bez ovoga: najnoviji prvi. Poslovi sa istom vrednošću ostaju najnoviji prvi. */
  sort?: { by: JobSortKey; dir: 'asc' | 'desc' };
}

export interface JobListResult {
  /** Ukupno poslova koji odgovaraju pretrazi (ne samo na ovoj strani). */
  total: number;
  items: JobListItem[];
}

export interface ExportRecord {
  id: number;
  material: string;
  fileName: string;
  /** Naziv foldera za prikaz; puna putanja ostaje u bazi. */
  folder: string;
  exportedAt: number;
  recordCount: number;
  size: number;
  sha256: string;
  result: 'written' | 'identical';
}

/** Stanje izvoza jednog trenutnog izlaznog fajla posla. */
export type OutputExportState = 'never' | 'current' | 'changed';

export interface JobExports {
  /** Najnoviji prvi. */
  exports: ExportRecord[];
  status: ExportStatus;
  /** Trenutni izlazni fajlovi posla i da li je svaki izvezen u ovom obliku. */
  outputs: (OutputInfo & { state: OutputExportState })[];
}

/** Odgovor na čuvanje: vreme i stanje izvoza posle ponovnog računanja nad novim izlaznim fajlovima. */
export type JobSavedResult = JobExports & { updatedAt: number };

/** Posao otvoren iz liste. `state` je null kad sačuvano stanje ne prolazi proveru; tada je `stateError` poruka. */
export interface JobDetail extends JobListItem, JobExports {
  file: { name: string; kind: SourceKind; bytes: Uint8Array };
  state: JobState | null;
  stateError: string | null;
}

export const MAX_JOB_NAME = 200;
export const MAX_JOB_NOTE = 2000;
export const MAX_JOB_PARTS = 300_000;
export const MAX_JOB_LIST = 200;
