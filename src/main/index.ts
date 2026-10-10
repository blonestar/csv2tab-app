// Glavni proces: app:// protokol, prozor, bezbednosna podešavanja.
import { app, BrowserWindow, dialog, nativeTheme, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { APP_ORIGIN, APP_SCHEME, type ComparePayload } from '../shared/api';
import { resolveAppPath } from './appPath';
import { CSP_BUILT, cspDev } from './csp';
import catalog from '../../web/src/data/wt-catalog.json' with { type: 'json' };
import type { WtCatalog } from '@core/catalog';
import { DatabaseTooNewError, openDatabase, type AppDatabase } from './db';
import { getSetting } from './db/settings';
import { registerIpc } from './ipc';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = join(here, '../renderer');
const PRELOAD = join(here, '../preload/index.cjs');
// Migracije su pored dist/ (koren repoa; u paketu koren asara). fs čitanje radi i unutar asara, pa je dovoljna
// putanja relativna u odnosu na izgrađeni main.
const MIGRATIONS = join(here, '../../migrations');

// Razvoj: dev.mjs zadaje adresu Vite servera. Spakovana aplikacija je ignoriše.
const devUrl = app.isPackaged ? undefined : process.env.CSV2TAB_DEV_URL;
const testMode = process.env.CSV2TAB_TEST === '1';

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
  const win = new BrowserWindow({
    width: hash ? 1000 : 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    title,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());

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
const compares = new Map<string, ComparePayload>();

const windows = {
  openCompare(payload: ComparePayload): void {
    const id = randomUUID();
    compares.set(id, payload);
    const win = createWindow(`#compare=${id}`, `Poređenje: ${payload.aName} / ${payload.bName}`);
    win.on('closed', () => compares.delete(id));
  },
  getCompare: (id: string) => compares.get(id),
  flushed(ok: boolean): void {
    pendingFlush?.(ok);
  },
};

// Zatvaranje glavnog prozora čeka da renderer upiše nesačuvane izmene posla (automatsko čuvanje je odloženo).
let pendingFlush: ((ok: boolean) => void) | null = null;
const FLUSH_TIMEOUT_MS = 8000;

function requestFlush(win: BrowserWindow): Promise<boolean> {
  if (win.webContents.isDestroyed() || win.webContents.isCrashed()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), FLUSH_TIMEOUT_MS);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      pendingFlush = null;
      resolve(ok);
    };
    pendingFlush = done;
    win.webContents.send('app.flush');
  });
}

/** Podešavanja koja menjaju samu aplikaciju. Tema ide kroz nativeTheme, pa CSS (prefers-color-scheme) prati izbor
 *  bez ikakve skripte i bez treperenja pri pokretanju. */
function applySetting(key: string, value: unknown): void {
  if (key === 'theme') nativeTheme.themeSource = value as 'system' | 'light' | 'dark';
}

function openMainWindow(): void {
  const win = createWindow();
  let flushed = false;
  let flushing = false;
  win.on('close', (e) => {
    if (flushed) return;
    e.preventDefault();
    if (flushing) return;
    flushing = true;
    void requestFlush(win).then(async (ok) => {
      if (!ok) {
        const r = await dialog.showMessageBox(win, {
          type: 'warning',
          message: 'Poslednje izmene posla nisu sačuvane.',
          detail: 'Čuvanje u bazu nije uspelo. Ako zatvorite program, te izmene se gube.',
          buttons: ['Ostani u programu', 'Zatvori bez čuvanja'],
          defaultId: 0,
          cancelId: 0,
        });
        if (r.response !== 1) {
          flushing = false;
          return;
        }
      }
      flushed = true;
      win.close();
    });
  });
  // zatvaranjem glavnog prozora zatvaraju se i prozori poređenja, pa aplikacija izlazi
  win.on('closed', () => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
}

function openDb(): AppDatabase | undefined {
  try {
    return openDatabase({
      file: join(app.getPath('userData'), 'csv2tab.db'),
      migrationsDir: MIGRATIONS,
      catalog: catalog as unknown as WtCatalog,
    });
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
  database = openDb();
  if (!database) {
    app.exit(1);
    return;
  }
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
  registerIpc({ devUrl, testMode, db: database, applySetting, windows });
  openMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


// Čisto zatvaranje baze (checkpoint WAL-a), da restart i rezervna kopija vide celovit fajl.
app.on('will-quit', () => {
  database?.close();
  database = undefined;
});
