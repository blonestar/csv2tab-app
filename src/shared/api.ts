// Ugovor između glavnog procesa, preloada i renderera. Tipovi se dele, kod ne.
// Nova operacija: dodaj je u IpcOperations, u fajl za svoju oblast u src/main/operations/ (sa proverom argumenata;
// fajl je već spojen u src/main/ipc.ts) i u `api` u src/preload/index.ts.
import type { WtCatalog } from '@core/catalog';
import type { WtPart } from '@core/wtTab';
import type { OpenedFile } from './job';
import type { JobDetail, JobExports, JobListItem, JobListQuery, JobListResult, JobSave, JobSavedResult } from './jobs';
import type { MemoryFound, MemoryList, MemoryLookup, MemoryUpdate } from './memory';
import type { FolderSettingKey, SettingKey, SettingValue, SettingsMap } from './settings';

export interface AppInfo {
  /** Verzija aplikacije (`version` u package.json). */
  appVersion: string;
  /** Verzija jezgra konverzije (`version` u web/package.json). */
  coreVersion: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;
  /** true kad je aplikacija pokrenuta sa CSV2TAB_TEST=1 (smoke test); renderer tada izlaže proveru jezgra. */
  testMode: boolean;
  /** Verzija šeme baze (PRAGMA user_version). */
  schemaVersion: number;
  sqliteVersion: string;
}

/** Koji dijalog za otvaranje fajla: uvoz (csv, ods, xlsx, tab) ili samo .tab za poređenje. */
export type OpenPurpose = 'import' | 'compare';

export const MAIN_COMMANDS = ['import', 'export', 'search', 'settings', 'about', 'pending-files', 'theme-changed'] as const;
export type MainCommand = (typeof MAIN_COMMANDS)[number];
export interface MenuRequest { id: number; kind: MainCommand }

/** Fajl za upis u WT folder. Ime je samo predlog: glavni proces ga svodi na osnovno ime sa ekstenzijom .tab. */
export interface ExportItem {
  name: string;
  bytes: Uint8Array;
  /** Naziv materijala iz fajla; obavezan kad se izvoz beleži uz posao. */
  material?: string;
}

/** `folder` u odgovorima je naziv za prikaz, nikad putanja. */
export type ExportFolderProblem = { ok: false; reason: 'no-folder' | 'folder-missing'; folder: string; message: string };

export type ExportCheck =
  | ExportFolderProblem
  | {
      ok: true;
      folder: string;
      items: {
        /** Ime pod kojim će fajl zaista biti upisan. */
        name: string;
        status: 'new' | 'identical' | 'differs';
        /** Bajtovi postojećeg fajla (samo kad `differs` i može da se pročita), za poređenje u rendereru. */
        existing: Uint8Array | null;
      }[];
    };

export type ExportWriteResult =
  | ExportFolderProblem
  | {
      ok: true;
      folder: string;
      items: { name: string; status: 'written' | 'identical' | 'skipped' | 'error'; message?: string }[];
      /** Izvozi posla posle beleženja (samo kad je zadat posao). */
      job?: JobExports;
      /** Fajlovi su upisani, ali izvoz nije zabeležen u bazi. */
      recordError?: string;
    };

/** Podaci za prozor poređenja (a = trenutni zapisi, b = postojeći fajl). */
export interface ComparePayload {
  aName: string;
  bName: string;
  a: WtPart[];
  b: WtPart[];
}

export interface JobCreated {
  id: number;
  name: string;
  createdAt: number;
}

/** Izmena imena i/ili napomene posla. */
export interface JobMeta {
  name?: string;
  note?: string;
}

/** Rezervna kopija koja je upravo napravljena. */
export interface BackupInfo {
  /** Ime fajla (putanju renderer ne vidi). */
  name: string;
  size: number;
  /** Naziv foldera za rezervne kopije (bez putanje). */
  folder: string;
  jobs: number;
}

/** Kopija koju je korisnik izabrao za vraćanje, već proverena; vraćanje čeka potvrdu. */
export interface RestorePreview {
  /** Oznaka pripremljene kopije; šalje se nazad pri potvrdi. */
  token: string;
  fileName: string;
  size: number;
  schemaVersion: number;
  /** Verzija šeme ove aplikacije; ako je veća od `schemaVersion`, kopija se pri vraćanju migrira. */
  appSchemaVersion: number;
  jobs: number;
  /** Vreme izmene najnovijeg posla u kopiji (ms) ili null. */
  newestJobAt: number | null;
}

export interface RestoreOutcome {
  /** Ime sigurnosne kopije zamenjene baze (stoji pored žive baze). */
  safetyName: string;
}

/** Operacije: ključ je ime IPC kanala, `args` su argumenti koje renderer šalje, `result` je odgovor. */
export interface IpcOperations {
  'app.info': { args: []; result: AppInfo };
  'settings.get': { args: [key: SettingKey]; result: SettingsMap[SettingKey] };
  'settings.all': { args: []; result: SettingsMap };
  'settings.set': { args: [key: SettingKey, value: unknown]; result: SettingsMap[SettingKey] };
  'catalog.get': { args: []; result: WtCatalog };
  'files.open': { args: [purpose: OpenPurpose]; result: OpenedFile | null };
  'files.next': { args: []; result: OpenedFile | null };
  'files.chooseFolder': { args: [key: FolderSettingKey]; result: string | null };
  'export.check': { args: [items: ExportItem[]]; result: ExportCheck };
  'export.write': { args: [items: ExportItem[], overwrite: string[], jobId: number | null]; result: ExportWriteResult };
  'jobs.list': { args: [query: JobListQuery]; result: JobListResult };
  'jobs.findBySource': { args: [sha256: string]; result: JobListItem[] };
  'jobs.get': { args: [id: number]; result: JobDetail };
  'jobs.create': { args: [file: OpenedFile, save: JobSave]; result: JobCreated };
  'jobs.save': { args: [id: number, save: JobSave]; result: JobSavedResult };
  'jobs.update': { args: [id: number, meta: JobMeta]; result: JobListItem };
  'jobs.delete': { args: [id: number]; result: void };
  'jobs.exports': { args: [id: number]; result: JobExports };
  'memory.lookup': { args: [query: MemoryLookup]; result: MemoryFound };
  'memory.remember': { args: [update: MemoryUpdate]; result: void };
  'memory.list': { args: []; result: MemoryList };
  'memory.forget': { args: [kind: 'material' | 'mapping', key: string | null]; result: number };
  'backup.create': { args: []; result: BackupInfo };
  'backup.inspect': { args: []; result: RestorePreview | null };
  'backup.restore': { args: [token: string]; result: RestoreOutcome };
  'backup.cancel': { args: [token: string]; result: void };
  'backup.finish': { args: []; result: void };
  'app.flushed': { args: [ok: boolean]; result: void };
  'compare.open': { args: [payload: ComparePayload]; result: void };
  'compare.get': { args: [id: string]; result: ComparePayload };
}

export type IpcChannel = keyof IpcOperations;

/** Ono što renderer vidi kao `window.api`. Samo imenovane operacije, nikad `ipcRenderer`. */
export interface Api {
  app: {
    info(): Promise<AppInfo>;
  };
  settings: {
    /** Folder-podešavanja vraćaju samo naziv; pune putanje ostaju u glavnom procesu. */
    get<K extends SettingKey>(key: K): Promise<SettingValue<K>>;
    all(): Promise<SettingsMap>;
    /** Vrednost se proverava u glavnom procesu; neispravna se odbija. */
    set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<SettingValue<K>>;
  };
  catalog: {
    get(): Promise<WtCatalog>;
  };
  files: {
    /** Dijalog za otvaranje fajla u glavnom procesu; null kad korisnik odustane. */
    open(purpose: OpenPurpose): Promise<OpenedFile | null>;
    /** Sledeći fajl iz argumenata procesa; putanja ostaje u glavnom procesu. */
    next(): Promise<OpenedFile | null>;
    /** Dijalog za izbor foldera; putanja se upisuje u bazu, vraća se samo naziv. null kad korisnik odustane. */
    chooseFolder(key: FolderSettingKey): Promise<string | null>;
  };
  export: {
    /** Gde fajlovi već postoje i da li su isti; ništa ne upisuje. */
    check(items: ExportItem[]): Promise<ExportCheck>;
    /** Upisuje u WT folder. Postojeći različit fajl se prepisuje samo ako mu je ime u `overwrite`. */
    write(items: ExportItem[], overwrite: string[], jobId: number | null): Promise<ExportWriteResult>;
  };
  jobs: {
    /** Lista sa pretragom i stranicama; zapisi se ne šalju. */
    list(query: JobListQuery): Promise<JobListResult>;
    /** Poslovi sa istim izvornim fajlom (SHA-256). */
    findBySource(sha256: string): Promise<JobListItem[]>;
    get(id: number): Promise<JobDetail>;
    /** Novi posao od uvezenog fajla; ime je ime fajla bez ekstenzije. */
    create(file: OpenedFile, save: JobSave): Promise<JobCreated>;
    /** Stanje, zapisi i izlazni fajlovi posla; izvorni bajtovi se ne menjaju. */
    save(id: number, save: JobSave): Promise<JobSavedResult>;
    update(id: number, meta: JobMeta): Promise<JobListItem>;
    /** Briše posao i njegove sačuvane izvoze (fajlovi u WT folderu ostaju). */
    delete(id: number): Promise<void>;
    exports(id: number): Promise<JobExports>;
  };
  memory: {
    /** Zapamćeni izbori za nazive materijala iz fajla i za potpis zaglavlja. */
    lookup(query: MemoryLookup): Promise<MemoryFound>;
    /** Upisuje izbore u pamćenje (npr. potvrđene izvozom). */
    remember(update: MemoryUpdate): Promise<void>;
    list(): Promise<MemoryList>;
    /** Briše jedan zapis (po ključu materijala / potpisu zaglavlja) ili sve zapise te vrste (`null`). Vraća broj obrisanih. */
    forget(kind: 'material' | 'mapping', key: string | null): Promise<number>;
  };
  backup: {
    /** Rezervna kopija baze u folder za rezervne kopije. */
    create(): Promise<BackupInfo>;
    /** Dijalog za izbor kopije (main proces); proverava je i vraća šta sadrži. null kad korisnik odustane. */
    inspect(): Promise<RestorePreview | null>;
    /** Zamenjuje bazu pripremljenom kopijom (posle potvrde). Interfejs se zatim ponovo učitava preko `finish`. */
    restore(token: string): Promise<RestoreOutcome>;
    /** Odustajanje: briše pripremljenu kopiju. */
    cancel(token: string): Promise<void>;
    /** Posle vraćanja: ponovo učitava prozor nad novom bazom. */
    finish(): Promise<void>;
  };
  lifecycle: {
    onCommand(handler: (command: MainCommand) => void): () => void;
    /** Glavni proces traži da se sve nesačuvano upiše pre zatvaranja prozora; poziv vraća funkciju za odjavu. */
    onFlushRequest(handler: () => Promise<boolean>): () => void;
  };
  compare: {
    /** Otvara poseban prozor poređenja. */
    open(payload: ComparePayload): Promise<void>;
    /** Podaci prozora poređenja (adresa prozora nosi samo njegov id). */
    get(id: string): Promise<ComparePayload>;
  };
}

/** Šema, host i početna adresa izgrađenog interfejsa. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'csv2tab';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
