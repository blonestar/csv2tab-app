// Glavni proces: app:// protokol, prozor, bezbednosna podešavanja.
import { app, BrowserWindow, dialog, Menu, nativeTheme, protocol, screen, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { APP_ORIGIN, APP_SCHEME, type ComparePayload, type MainCommand } from '../shared/api';
import type { UpdateState } from '../shared/update';
import { resolveAppPath } from './appPath';
import { CSP_BUILT, cspDev } from './csp';
import catalog from '../../web/src/data/wt-catalog.json' with { type: 'json' };
import type { WtCatalog } from '@core/catalog';
import { discardStaged } from './db/backup';
import { DatabaseTooNewError, openDatabase, type AppDatabase } from './db';
import { getSetting, setSetting } from './db/settings';
import { registerIpc } from './ipc';
import { filesFromArguments } from './arguments';
import { readOpenedFile } from './files';
import { rememberOpenedPath } from './openedPaths';
import { installMenu } from './menu';
import { restoreWindowState } from './windowState';
import { chooseVariant, createUpdateController, updateTestUrl } from './update';
import { createUpdateDriver } from './updater';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = join(here, '../renderer');
const PRELOAD = join(here, '../preload/index.cjs');
// Migracije su pored dist/ (koren repoa; u paketu koren asara). fs čitanje radi i unutar asara, pa je dovoljna
// putanja relativna u odnosu na izgrađeni main.
const MIGRATIONS = join(here, '../../migrations');

// Razvoj: dev.mjs zadaje adresu Vite servera. Spakovana aplikacija je ignoriše.
const devUrl = app.isPackaged ? undefined : process.env.CSV2TAB_DEV_URL;
const testMode = process.env.CSV2TAB_TEST === '1' && !app.isPackaged;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const pendingFiles = filesFromArguments(process.argv, process.cwd(), app.isPackaged);
const lock = { restoring: false };

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function serveApp(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppPath(RENDERER_ROOT, request.url);
    if (!file) return new Response('Zabranjeno', { status: 403 });
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), {
        headers: {
          'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'content-security-policy': CSP_BUILT,
        },
      });
    } catch {
      return new Response('Nije pronađeno', { status: 404 });
    }
  });
}

function isInternal(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`) || (!!devUrl && url.startsWith(devUrl));
}

/** Glavni prozor i prozori poređenja učitavaju isti renderer, sa istim bezbednosnim podešavanjima i preloadom;
 *  prozor poređenja se razlikuje samo po `#compare=<id>` u adresi. */
function createWindow(hash = '', title = 'csv2tab'): BrowserWindow {
  const stored = !hash ? database?.sqlite.prepare("SELECT value FROM meta WHERE key = 'window_state'").get() as { value: string } | undefined : undefined;
  const bounds = restoreWindowState(stored?.value, screen.getAllDisplays().map((d) => d.workArea));
  const win = new BrowserWindow({
    width: hash ? 1000 : 1100,
    height: 720,
    ...(bounds ?? {}),
    minWidth: 760,
    minHeight: 480,
    title,
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(here, '../../build/icons/256x256.png'),
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => {
    if (bounds?.maximized) win.maximize();
    win.show();
  });

  // Navigacija van interfejsa se blokira, spoljni linkovi idu u sistemski browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  void win.loadURL((devUrl ?? `${APP_ORIGIN}/`) + hash);
  return win;
}

let database: AppDatabase | undefined;
let mainWindow: BrowserWindow | undefined;
const compares = new Map<string, ComparePayload>();

const windows = {
  async nextFile() {
    const path = pendingFiles.shift();
    if (!path) return null;
    try {
      const file = await readOpenedFile(path);
      rememberOpenedPath(file.name, file.bytes, path);
      return file;
    } catch {
      throw new Error(`Fajl „${basename(path)}“ ne može da se uveze. Proverite da postoji i nije veći od 50 MB.`);
    }
  },
  openCompare(payload: ComparePayload): void {
    const id = randomUUID();
    compares.set(id, payload);
    const win = createWindow(`#compare=${id}`, `Poređenje: ${payload.aName} / ${payload.bName}`);
    win.on('closed', () => compares.delete(id));
  },
  getCompare: (id: string) => compares.get(id),
  flushMain: () => (mainWindow && !mainWindow.isDestroyed() ? requestFlush(mainWindow) : Promise.resolve(true)),
  reloadAfterRestore(): void {
    // prozori poređenja nose podatke iz stare baze; glavni prozor se učitava ispočetka nad novom
    for (const w of BrowserWindow.getAllWindows()) if (w !== mainWindow) w.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  },
  flushed(ok: boolean): void {
    pendingFlush?.(ok);
  },
};

// Zatvaranje glavnog prozora čeka da renderer upiše nesačuvane izmene posla (automatsko čuvanje je odloženo).
let pendingFlush: ((ok: boolean) => void) | null = null;
let flushingRequest: Promise<boolean> | null = null;
const FLUSH_TIMEOUT_MS = 8000;

function requestFlush(win: BrowserWindow): Promise<boolean> {
  if (win.webContents.isDestroyed() || win.webContents.isCrashed()) return Promise.resolve(true);
  if (flushingRequest) return flushingRequest;
  flushingRequest = new Promise((resolve) => {
    const timer = setTimeout(() => done(false), FLUSH_TIMEOUT_MS);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      pendingFlush = null;
      flushingRequest = null;
      resolve(ok);
    };
    pendingFlush = done;
    win.webContents.send('app.flush');
  });
  return flushingRequest;
}

/** Podešavanja koja menjaju samu aplikaciju. Tema ide kroz nativeTheme, pa CSS (prefers-color-scheme) prati izbor
 *  bez ikakve skripte i bez treperenja pri pokretanju. */
function applySetting(key: string, value: unknown): void {
  if (key === 'theme') {
    nativeTheme.themeSource = value as 'system' | 'light' | 'dark';
    const item = Menu.getApplicationMenu()?.getMenuItemById(`theme-${String(value)}`);
    if (item) item.checked = true;
  }
}

function command(kind: MainCommand): void {
  if (!mainWindow || mainWindow.isDestroyed() || lock.restoring) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app.command', kind);
}

if (gotLock) app.on('second-instance', (_event, argv, cwd) => {
  pendingFiles.push(...filesFromArguments(argv, cwd, app.isPackaged));
  command('pending-files');
});

// Prozor koji je prošao prepareClose sme da se zatvori bez novog pitanja (zatvaranje ili instalacija ažuriranja).
const closeReady = new WeakSet<BrowserWindow>();
let closing: Promise<boolean> | null = null;

/** Čuva nesačuvano, pita ako čuvanje nije uspelo i upisuje položaj prozora. Vraća true kad sme da se zatvori. */
function prepareClose(win: BrowserWindow): Promise<boolean> {
  closing ??= confirmClose(win).finally(() => {
    closing = null;
  });
  return closing;
}

async function confirmClose(win: BrowserWindow): Promise<boolean> {
  const ok = await requestFlush(win);
  if (!ok) {
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Poslednje izmene posla nisu sačuvane.',
      detail: 'Čuvanje u bazu nije uspelo. Ako zatvorite program, te izmene se gube.',
      buttons: ['Ostani u programu', 'Zatvori bez čuvanja'],
      defaultId: 0,
      cancelId: 0,
    });
    if (r.response !== 1) return false;
  }
  database?.sqlite.prepare("INSERT INTO meta (key, value) VALUES ('window_state', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  closeReady.add(win);
  return true;
}

/** Stanje ažuriranja ide u glavni prozor (renderer ga prikazuje). */
function sendUpdateState(state: UpdateState): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('update.state', state);
}

function openMainWindow(): void {
  const win = createWindow();
  mainWindow = win;
  win.on('close', (e) => {
    if (closeReady.has(win)) return;
    e.preventDefault();
    void prepareClose(win).then((ok) => {
      if (ok) win.close();
    });
  });
  // zatvaranjem glavnog prozora zatvaraju se i prozori poređenja, pa aplikacija izlazi
  win.on('closed', () => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
}

const dbOptions = () => ({
  file: join(app.getPath('userData'), 'csv2tab.db'),
  migrationsDir: MIGRATIONS,
  catalog: catalog as unknown as WtCatalog,
});

function openDb(): AppDatabase | undefined {
  try {
    return openDatabase(dbOptions());
  } catch (e) {
    if (e instanceof DatabaseTooNewError) {
      dialog.showErrorBox(
        'Baza je novija od programa',
        `Baza podataka je napravljena novijom verzijom csv2tab (šema ${e.dbVersion}, ovaj program zna do ${e.appVersion}). ` +
          'Instalirajte noviju verziju programa. Baza nije otvorena niti izmenjena.',
      );
    } else {
      dialog.showErrorBox('Baza se ne može otvoriti', e instanceof Error ? e.message : String(e));
    }
    return undefined;
  }
}

app.whenReady().then(() => {
  if (!gotLock) return;
  database = openDb();
  if (!database) {
    app.exit(1);
    return;
  }
  discardStaged(`${database.file}.restore-tmp`); // privremena kopija od prekinutog vraćanja
  applySetting('theme', getSetting(database.sqlite, 'theme'));
  if (devUrl) {
    // Samo razvoj: Vite servira stranicu sa http://, pa CSP zadaje main.
    const csp = cspDev(devUrl);
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  } else {
    serveApp();
  }
  const db = database;
  // Ažuriranje: varijanta po okruženju; u test režimu adresa lokalnog servera (vidi update.ts).
  const variant = chooseVariant({ platform: process.platform, packaged: app.isPackaged, env: process.env, execPath: process.execPath });
  const update = createUpdateController({
    variant,
    currentVersion: app.getVersion(),
    now: () => Date.now(),
    driver: createUpdateDriver(variant, updateTestUrl(process.env, app.isPackaged), process.env),
    readLastCheck() {
      const row = db.sqlite.prepare("SELECT value FROM meta WHERE key = 'update_last_check'").get() as { value: string } | undefined;
      const n = row ? Number(row.value) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : null;
    },
    writeLastCheck(time) {
      db.sqlite.prepare("INSERT INTO meta (key, value) VALUES ('update_last_check', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(time));
    },
    readSettings: () => ({ updateInterval: getSetting(db.sqlite, 'updateInterval'), updateOnStartup: getSetting(db.sqlite, 'updateOnStartup') }),
    send: sendUpdateState,
    prepareInstall: () => (mainWindow && !mainWindow.isDestroyed() ? prepareClose(mainWindow) : Promise.resolve(true)),
    abortInstall: () => {
      if (mainWindow && !mainWindow.isDestroyed()) closeReady.delete(mainWindow);
    },
    log: (message, error) => console.error(message, error),
  });
  registerIpc({ devUrl, testMode, db: database, dbOptions: dbOptions(), lock, applySetting, windows, update });
  installMenu(command, getSetting(database.sqlite, 'theme'), (theme) => {
    if (lock.restoring || !database) return;
    setSetting(database.sqlite, 'theme', theme);
    applySetting('theme', theme);
    command('theme-changed');
  });
  openMainWindow();
  // Automatska provera: nekoliko sekundi posle otvaranja (da ne uspori pokretanje), pa jednom na sat dok radi.
  const autoCheck = (run: () => Promise<boolean>) => void run().catch((error) => console.error('Automatska provera ažuriranja nije uspela.', error));
  setTimeout(() => autoCheck(() => update.startupCheck()), 5000);
  setInterval(() => autoCheck(() => update.tick()), 60 * 60 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


// Čisto zatvaranje baze (checkpoint WAL-a), da restart i rezervna kopija vide celovit fajl.
app.on('will-quit', () => {
  if (database) discardStaged(`${database.file}.restore-tmp`);
  database?.close();
  database = undefined;
});
