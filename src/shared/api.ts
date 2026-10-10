// Ugovor između glavnog procesa, preloada i renderera. Tipovi se dele, kod ne.
// Nova operacija: dodaj je u IpcOperations, u fajl za svoju oblast u src/main/operations/ (sa proverom argumenata;
// fajl je već spojen u src/main/ipc.ts) i u `api` u src/preload/index.ts.
import type { WtCatalog } from '@core/catalog';
import type { SettingKey, SettingValue, SettingsMap } from './settings';

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

/** Operacije: ključ je ime IPC kanala, `args` su argumenti koje renderer šalje, `result` je odgovor. */
export interface IpcOperations {
  'app.info': { args: []; result: AppInfo };
  'settings.get': { args: [key: SettingKey]; result: SettingsMap[SettingKey] };
  'settings.all': { args: []; result: SettingsMap };
  'settings.set': { args: [key: SettingKey, value: unknown]; result: SettingsMap[SettingKey] };
  'catalog.get': { args: []; result: WtCatalog };
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
}

/** Šema, host i početna adresa izgrađenog interfejsa. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'csv2tab';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
