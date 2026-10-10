// Glavni proces: app:// protokol, prozor, bezbednosna podešavanja.
import { app, BrowserWindow, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ORIGIN, APP_SCHEME } from '../shared/api';
import { resolveAppPath } from './appPath';
import { CSP_BUILT, cspDev } from './csp';
import { registerIpc } from './ipc';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = join(here, '../renderer');
const PRELOAD = join(here, '../preload/index.cjs');

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

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    title: 'csv2tab',
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

  void win.loadURL(devUrl ?? `${APP_ORIGIN}/`);
  return win;
}

app.whenReady().then(() => {
  if (devUrl) {
    // Samo razvoj: Vite servira stranicu sa http://, pa CSP zadaje main.
    const csp = cspDev(devUrl);
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  } else {
    serveApp();
  }
  registerIpc({ devUrl, testMode });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

