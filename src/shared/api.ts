// Ugovor između glavnog procesa, preloada i renderera. Tipovi se dele, kod ne.
// Nova operacija: dodaj je u IpcOperations, u `operations` u src/main/ipc.ts (sa proverom argumenata)
// i u `api` u src/preload/index.ts.

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
}

/** Operacije: ključ je ime IPC kanala, `args` su argumenti koje renderer šalje, `result` je odgovor. */
export interface IpcOperations {
  'app.info': { args: []; result: AppInfo };
}

export type IpcChannel = keyof IpcOperations;

/** Ono što renderer vidi kao `window.api`. Samo imenovane operacije, nikad `ipcRenderer`. */
export interface Api {
  app: {
    info(): Promise<AppInfo>;
  };
}

/** Šema, host i početna adresa izgrađenog interfejsa. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'csv2tab';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
