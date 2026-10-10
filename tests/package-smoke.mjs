// Pravi paket, bez testnih prečica: migracija stare baze, uvoz iz argumenta, izvoz i ponovno otvaranje bez izvora.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { _electron } from 'playwright-core';

const executablePath = process.argv[2] && resolve(process.argv[2]);
if (!executablePath || !existsSync(executablePath)) throw new Error('Zadajte putanju AppImage-a ili raspakovane aplikacije.');
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'csv2tab-package-'));
const userData = join(temp, 'podaci');
const wt = join(temp, 'WT folder');
mkdirSync(userData); mkdirSync(wt);
const source = join(temp, 'Šuma Đurđevak.csv');
copyFileSync(join(root, 'web/tests/fixtures/Kasmir Kronospan 012-010.csv'), source);
// Paket mora sam da nađe migracije i sačuva podatke stare šeme.
const old = new DatabaseSync(join(userData, 'csv2tab.db'));
old.exec(readFileSync(join(root, 'migrations/0001_init.sql'), 'utf8'));
old.exec('PRAGMA user_version = 1');
old.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('wtFolder', JSON.stringify(wt));
old.close();
const env = { ...process.env, CSV2TAB_TEST: '1', CSV2TAB_DEV_URL: 'http://127.0.0.1:1', CSV2TAB_TEST_IMPORT: join(temp, 'nema.csv') };
delete env.ELECTRON_RUN_AS_NODE;
const launch = (files = []) => _electron.launch({ executablePath, args: [`--user-data-dir=${userData}`, ...files], env, timeout: 60000, colorScheme: null });
let app;
try {
  app = await launch([pathToFileURL(source).href]);
  let page = await app.firstWindow();
  const errors = [];
  const watch = (p) => p.on('pageerror', (e) => errors.push(String(e)));
  watch(page);
  await page.waitForSelector('[data-testid=jobview][data-file="Šuma Đurđevak.csv"]');
  await page.waitForSelector('[data-testid=save-state][data-state=saved]');
  assert.ok(page.url().startsWith('app://csv2tab/'));
  const info = await page.evaluate(() => window.api.app.info());
  assert.equal(info.testMode, false);
  assert.equal(info.schemaVersion, 3);
  assert.equal(await page.evaluate(() => typeof window.__csv2tab), 'undefined');
  assert.deepEqual(await app.evaluate(({ app }) => ({ packaged: app.isPackaged, name: app.getName(), userData: app.getPath('userData') })), { packaged: true, name: 'csv2tab-app', userData });
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=export-banner][data-kind=ok]');
  const id = +(await page.getAttribute('[data-testid=jobview]', 'data-job'));
  const job = await page.evaluate((id) => window.api.jobs.get(id), id);
  const output = join(wt, job.outputs[0].name);
  const bytes = readFileSync(output);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), job.outputs[0].sha256);
  assert.equal(job.status, 'current');
  await page.click('nav button:has-text("Podešavanja")');
  await page.click('label:has-text("Tamna")');
  await page.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches);
  if (process.env.CSV2TAB_SCREENSHOTS) {
    mkdirSync(process.env.CSV2TAB_SCREENSHOTS, { recursive: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720));
    for (const [theme, label] of [['light', 'Svetla'], ['dark', 'Tamna']]) {
      await page.click(`label:has-text("${label}")`);
      await page.waitForFunction((dark) => matchMedia('(prefers-color-scheme: dark)').matches === dark, theme === 'dark');
      await page.screenshot({ path: join(process.env.CSV2TAB_SCREENSHOTS, `paket-${theme}.png`), scale: 'css' });
    }
  }
  await app.close();
  rmSync(source);
  rmSync(output);
  app = await launch();
  page = await app.firstWindow(); watch(page);
  await page.waitForSelector(`tr[data-job-id="${id}"] [data-testid=job-open]`);
  assert.equal(await page.evaluate(() => window.api.settings.get('theme')), 'dark');
  await page.click(`tr[data-job-id="${id}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=save-state][data-state=saved]');
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=export-banner][data-kind=ok]');
  assert.deepEqual(readFileSync(output), bytes);
  assert.deepEqual(errors, []);
  console.log(`PACKAGE OK: ${info.appVersion}, ${info.platform}, šema ${info.schemaVersion}, ${bytes.length} B; migracije, uvoz i isti izvoz posle restarta, bez testnih prečica`);
} finally {
  await app?.close().catch(() => {});
  rmSync(temp, { recursive: true, force: true });
}
