// Ugovor između glavnog procesa, preloada i renderera. Tipovi se dele, kod ne.
// Nova operacija: dodaj je u IpcOperations, u fajl za svoju oblast u src/main/operations/ (sa proverom argumenata;
// fajl je već spojen u src/main/ipc.ts) i u `api` u src/preload/index.ts.
import type { WtCatalog } from '@core/catalog';
import type { WtPart } from '@core/wtTab';
import type { OpenedFile } from './job';
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

/** Fajl za upis u WT folder. Ime je samo predlog: glavni proces ga svodi na osnovno ime sa ekstenzijom .tab. */
export interface ExportItem {
  name: string;
  bytes: Uint8Array;
}

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
    };

/** Podaci za prozor poređenja (a = trenutni zapisi, b = postojeći fajl). */
export interface ComparePayload {
  aName: string;
  bName: string;
  a: WtPart[];
  b: WtPart[];
}

/** Operacije: ključ je ime IPC kanala, `args` su argumenti koje renderer šalje, `result` je odgovor. */
export interface IpcOperations {
  'app.info': { args: []; result: AppInfo };
  'settings.get': { args: [key: SettingKey]; result: SettingsMap[SettingKey] };
  'settings.all': { args: []; result: SettingsMap };
  'settings.set': { args: [key: SettingKey, value: unknown]; result: SettingsMap[SettingKey] };
  'catalog.get': { args: []; result: WtCatalog };
  'files.open': { args: [purpose: OpenPurpose]; result: OpenedFile | null };
  'files.chooseFolder': { args: [key: FolderSettingKey]; result: string | null };
  'export.check': { args: [items: ExportItem[]]; result: ExportCheck };
  'export.write': { args: [items: ExportItem[], overwrite: string[]]; result: ExportWriteResult };
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
    /** Dijalog za izbor foldera; izabrana putanja se upisuje u bazu. null kad korisnik odustane. */
    chooseFolder(key: FolderSettingKey): Promise<string | null>;
  };
  export: {
    /** Gde fajlovi već postoje i da li su isti; ništa ne upisuje. */
    check(items: ExportItem[]): Promise<ExportCheck>;
    /** Upisuje u WT folder. Postojeći različit fajl se prepisuje samo ako mu je ime u `overwrite`. */
    write(items: ExportItem[], overwrite: string[]): Promise<ExportWriteResult>;
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
