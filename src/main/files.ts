// Dijalozi za fajlove i folder u glavnom procesu. Renderer nikad ne vidi putanju: dobija ime i bajtove.
import { app, BrowserWindow, dialog } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { OpenPurpose } from '../shared/api';
import { MAX_OPEN_BYTES, UNSUPPORTED_MSG, kindFromName, type OpenedFile } from '../shared/job';
import { rememberOpenedPath } from './openedPaths';
import { TEST_ENV, testOverride, type TestHookContext } from './testHooks';

const hookCtx = (testMode: boolean): TestHookContext => ({ env: process.env, testMode, packaged: app.isPackaged });
const parent = () => BrowserWindow.getFocusedWindow() ?? undefined;

export async function readOpenedFile(path: string): Promise<OpenedFile> {
  const name = basename(path);
  const kind = kindFromName(name);
  if (!kind) throw new Error(UNSUPPORTED_MSG);
  if ((await stat(path)).size > MAX_OPEN_BYTES) throw new Error('Fajl je veći od 50 MB.');
  // kopija u običan Uint8Array: Buffer iz zajedničkog bazena ima pomeraj i ne treba da stigne do renderera
  return { name, kind, bytes: new Uint8Array(await readFile(path)) };
}

export async function openFile(purpose: OpenPurpose, testMode: boolean): Promise<OpenedFile | null> {
  const forced = testOverride(purpose === 'compare' ? TEST_ENV.compare : TEST_ENV.import, hookCtx(testMode));
  let path = forced;
  if (!path) {
    const filters =
      purpose === 'compare'
        ? [{ name: 'WT Input (.tab)', extensions: ['tab'] }]
        : [
            { name: 'Krojne liste', extensions: ['csv', 'ods', 'xlsx', 'tab', 'txt', 'tsv'] },
            { name: 'Svi fajlovi', extensions: ['*'] },
          ];
    const opts = { title: purpose === 'compare' ? 'Izaberite .tab za poređenje' : 'Uvoz krojne liste', properties: ['openFile' as const], filters };
    const win = parent();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    path = r.filePaths[0];
  }
  const file = await readOpenedFile(path);
  if (purpose === 'compare' && file.kind !== 'tab') throw new Error('Za poređenje je potreban .tab fajl.');
  if (purpose === 'import') rememberOpenedPath(file.name, file.bytes, path);
  return file;
}

/** Sistemski dijalog za izbor foldera; vraća putanju (u testu je zadaje promenljiva okruženja) ili null. */
export async function pickFolder(testMode: boolean): Promise<string | null> {
  const forced = testOverride(TEST_ENV.folder, hookCtx(testMode));
  if (forced) return forced;
  const opts = { title: 'Izaberite folder', properties: ['openDirectory' as const, 'createDirectory' as const] };
  const win = parent();
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

/** Sistemski dijalog za izbor rezervne kopije baze; vraća putanju (u testu je zadaje promenljiva okruženja) ili null. */
export async function pickBackupFile(testMode: boolean): Promise<string | null> {
  const forced = testOverride(TEST_ENV.restore, hookCtx(testMode));
  if (forced) return forced;
  const opts = {
    title: 'Izaberite rezervnu kopiju baze',
    properties: ['openFile' as const],
    filters: [{ name: 'Rezervna kopija (.db)', extensions: ['db'] }, { name: 'Svi fajlovi', extensions: ['*'] }],
  };
  const win = parent();
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}
