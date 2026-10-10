// Smoke test izgrađene aplikacije (Playwright _electron): prozor učitava app://csv2tab/, most radi, jezgro u
// rendereru daje iste bajtove za CSV, ODS i XLSX, a .tab round trip je bajt-identičan. Tema promenjena kroz interfejs
// preživljava restart (baza), a katalog se prikazuje. Pokreće se posle `npm run build`.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { _electron } from 'playwright-core';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fx = (n) => [...readFileSync(join(root, 'web/tests/fixtures', n))];
const env = { ...process.env, CSV2TAB_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE; // nasleđen iz Electron alata bi pretvorio Electron u Node
delete env.CSV2TAB_DEV_URL;

const userData = mkdtempSync(join(tmpdir(), 'csv2tab-smoke-'));
// colorScheme: null — Playwright inače nameće "light" i prefers-color-scheme ne bi pratio nativeTheme.
const launch = () => _electron.launch({ executablePath: electron, args: [root, `--user-data-dir=${userData}`], env, timeout: 30000, colorScheme: null });
const isDark = (page) => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
let app = await launch();
try {
  const page = await app.firstWindow();
  await page.waitForURL('app://csv2tab/**', { timeout: 15000 });
  await page.waitForSelector('nav.sidebar');
  console.log('url:', page.url());

  // most: samo imenovane operacije
  const surface = await page.evaluate(() => ({
    api: Object.keys(window.api).sort(),
    node: typeof require + typeof process,
    ipc: typeof window.ipcRenderer,
  }));
  assert.deepEqual(surface, { api: ['app', 'catalog', 'settings'], node: 'undefinedundefined', ipc: 'undefined' });
  const info = await page.evaluate(() => window.api.app.info());
  assert.equal(info.testMode, true);
  assert.match(info.electron, /^44\./);
  assert.match(info.coreVersion, /^\d+\.\d+\.\d+$/);
  console.log('info:', JSON.stringify(info));

  // protokol: CSP zaglavlje, odbijanje izlaska iz foldera
  const probe = await page.evaluate(async () => {
    const get = async (p) => {
      const r = await fetch(`app://csv2tab${p}`);
      return { status: r.status, csp: r.headers.get('content-security-policy') };
    };
    return { index: await get('/'), up: await get('/..%2fmain/index.js'), absent: await get('/nema.js') };
  });
  assert.equal(probe.index.status, 200);
  assert.ok(probe.index.csp && !probe.index.csp.includes('unsafe-eval') && !probe.index.csp.includes('unsafe-inline'));
  assert.equal(probe.up.status, 403);
  assert.equal(probe.absent.status, 404);

  // navigacija van interfejsa se blokira
  await page.evaluate(() => { location.href = 'https://example.com/'; });
  await page.waitForTimeout(1000);
  assert.ok(page.url().startsWith('app://csv2tab/'), `navigacija nije blokirana: ${page.url()}`);
  await page.reload(); // posle blokirane navigacije Playwright čeka završetak; ponovno učitavanje vraća čist početak
  await page.waitForSelector('nav.sidebar');
  await page.waitForFunction(() => window.__csv2tab);

  // jezgro u rendereru
  const res = await page.evaluate(
    ({ cases, tabs }) => {
      const core = window.__csv2tab;
      const out = { converted: {}, roundTrip: {} };
      for (const [name, c] of Object.entries(cases)) {
        out.converted[name] = Object.entries(c.files).map(([kind, bytes]) =>
          Array.from(core.convertToTab(new Uint8Array(bytes), kind, c.grain)),
        );
      }
      for (const [name, bytes] of Object.entries(tabs)) out.roundTrip[name] = Array.from(core.roundTripTab(new Uint8Array(bytes)));
      return out;
    },
    {
      cases: {
        kasmir: {
          files: { csv: fx('Kasmir Kronospan 012-010.csv'), ods: fx('Kasmir Kronospan 012-010.ods'), xlsx: fx('Kasmir Kronospan 012-010.xlsx') },
          grain: { '012-010': 0, U702: 0 },
        },
        stoneOak: {
          files: { csv: fx('Stone oak Kronospan.csv'), ods: fx('Stone oak Kronospan 012-140.ods'), xlsx: fx('Stone oak Kronospan 012-140.xlsx') },
        },
      },
      tabs: { 'Kronospan Kasmir.tab': fx('Kronospan Kasmir.tab'), 'STONE OAK Kronospan.tab': fx('STONE OAK Kronospan.tab') },
    },
  );
  for (const [name, [csv, ods, xlsx]] of Object.entries(res.converted)) {
    assert.ok(csv.length > 165, name);
    assert.deepEqual(ods, csv, `${name}: ODS != CSV`);
    assert.deepEqual(xlsx, csv, `${name}: XLSX != CSV`);
    console.log(`${name}: CSV = ODS = XLSX, ${csv.length} B`);
  }
  for (const [name, bytes] of Object.entries(res.roundTrip)) {
    assert.deepEqual(bytes, fx(name), `${name}: round trip`);
    console.log(`${name}: round trip bajt-identičan`);
  }

  // baza: verzija šeme i SQLite u "O programu"
  assert.equal(info.schemaVersion, 1);
  assert.match(info.sqliteVersion, /^3\.\d+\.\d+/);
  await page.click('nav button:has-text("O programu")');
  await page.waitForSelector('[data-testid=app-info]');
  const about = await page.textContent('[data-testid=app-info]');
  assert.ok(about.includes('Šema baze') && about.includes(info.sqliteVersion), about);

  // renderer ne može da traži nepoznat ključ ni pogrešnu vrednost
  const bad = await page.evaluate(async () => {
    const tryCall = (fn) => fn().then(() => 'ok', (e) => String(e.message));
    return [
      await tryCall(() => window.api.settings.get('nema')),
      await tryCall(() => window.api.settings.get('__proto__')),
      await tryCall(() => window.api.settings.set('theme', 'plava')),
    ];
  });
  assert.ok(bad.every((m) => m !== 'ok'), `neispravan poziv prošao: ${bad}`);
  assert.equal(await page.evaluate(() => window.api.settings.get('theme')), 'system');

  // katalog iz baze
  await page.click('nav button:has-text("Katalog")');
  await page.waitForSelector('[data-testid=materials] tbody tr');
  assert.match(await page.textContent('[data-testid=material-count]'), /860 od 860/);
  assert.equal(await page.locator('[data-testid=bands] tbody tr').count(), 10);
  await page.fill('input[type=search]', '103-ME3');
  await page.waitForFunction(() => /\(\d+ od 860\)/.test(document.querySelector('[data-testid=material-count]')?.textContent ?? '') && !/860 od 860/.test(document.querySelector('[data-testid=material-count]').textContent));
  assert.ok((await page.textContent('[data-testid=materials] tbody')).includes('103-ME3'));
  console.log('katalog: prikaz i pretraga rade');

  // tema kroz interfejs: odmah se primenjuje
  await page.click('nav button:has-text("Podešavanja")');
  await page.click('label:has-text("Tamna")');
  await page.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const darkBg = await bodyBg(page);
  assert.equal(await page.evaluate(() => window.api.settings.get('theme')), 'dark');
  await page.click('label:has-text("Svetla")');
  await page.waitForFunction(() => !matchMedia('(prefers-color-scheme: dark)').matches);
  assert.notEqual(await bodyBg(page), darkBg);
  await page.click('label:has-text("Tamna")');
  await page.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches);
  console.log('tema promenjena na tamnu, pozadina:', darkBg);

  // restart sa istim userData: podešavanje i tema moraju da ostanu
  await app.close();
  app = await launch();
  const page2 = await app.firstWindow();
  await page2.waitForURL('app://csv2tab/**', { timeout: 15000 });
  await page2.waitForSelector('nav.sidebar');
  assert.equal(await page2.evaluate(() => window.api.settings.get('theme')), 'dark');
  assert.equal(await isDark(page2), true, 'tema nije primenjena posle restarta');
  assert.equal(await bodyBg(page2), darkBg);
  await page2.click('nav button:has-text("Podešavanja")');
  assert.equal(await page2.isChecked('input[value=dark]'), true);
  assert.equal((await page2.evaluate(() => window.api.app.info())).schemaVersion, 1);
  console.log('posle restarta: tema = dark, primenjena');

  console.log('SMOKE OK');
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
