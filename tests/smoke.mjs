// Smoke test izgrađene aplikacije (Playwright _electron): prozor učitava app://csv2tab/, most radi, jezgro u
// rendereru daje iste bajtove za CSV, ODS i XLSX, a .tab round trip je bajt-identičan. Tema promenjena kroz interfejs
// preživljava restart (baza), a katalog se prikazuje. Faza 3: uvoz (dijalog i prevlačenje), izvoz u WT folder,
// pitanje sa razlikama pre prepisivanja i prozor za poređenje. Dijalozi se zaobilaze promenljivama okruženja
// (CSV2TAB_TEST_*) koje glavni proces poštuje samo uz CSV2TAB_TEST=1. Pokreće se posle `npm run build`.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { _electron } from 'playwright-core';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixturePath = (n) => join(root, 'web/tests/fixtures', n);
const fx = (n) => [...readFileSync(fixturePath(n))];
const env = { ...process.env, CSV2TAB_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE; // nasleđen iz Electron alata bi pretvorio Electron u Node
delete env.CSV2TAB_DEV_URL;

const userData = mkdtempSync(join(tmpdir(), 'csv2tab-smoke-'));
const extraDirs = [];
// colorScheme: null — Playwright inače nameće "light" i prefers-color-scheme ne bi pratio nativeTheme.
const launch = () => _electron.launch({ executablePath: electron, args: [root, `--user-data-dir=${userData}`], env, timeout: 30000, colorScheme: null });
const isDark = (page) => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
let app = await launch();
try {
  const page = await app.firstWindow();
  const problems = []; // CSP prekršaji i neuhvaćene greške u bilo kom prozoru
  const watch = (p) => {
    p.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
    p.on('pageerror', (e) => problems.push(String(e)));
  };
  watch(page);
  await page.waitForURL('app://csv2tab/**', { timeout: 15000 });
  await page.waitForSelector('nav.sidebar');
  console.log('url:', page.url());

  // most: samo imenovane operacije
  const surface = await page.evaluate(() => ({
    api: Object.keys(window.api).sort(),
    node: typeof require + typeof process,
    ipc: typeof window.ipcRenderer,
  }));
  assert.deepEqual(surface, { api: ['app', 'catalog', 'compare', 'export', 'files', 'settings'], node: 'undefinedundefined', ipc: 'undefined' });
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

  // tema kroz interfejs: odmah se primenjuje. Čuva se tema suprotna sistemskoj, da restart ne prođe slučajno.
  await page.click('nav button:has-text("Podešavanja")');
  const systemDark = await isDark(page);
  const [keep, other] = systemDark ? ['light', 'dark'] : ['dark', 'light'];
  const LABEL = { light: 'Svetla', dark: 'Tamna' };
  const waitTheme = (p, theme) =>
    p.waitForFunction((dark) => matchMedia('(prefers-color-scheme: dark)').matches === dark, theme === 'dark');
  await page.click(`label:has-text("${LABEL[keep]}")`);
  await waitTheme(page, keep);
  const keepBg = await bodyBg(page);
  assert.equal(await page.evaluate(() => window.api.settings.get('theme')), keep);
  await page.click(`label:has-text("${LABEL[other]}")`);
  await waitTheme(page, other);
  assert.notEqual(await bodyBg(page), keepBg);
  await page.click(`label:has-text("${LABEL[keep]}")`);
  await waitTheme(page, keep);
  console.log(`tema promenjena na ${keep} (sistemska je ${systemDark ? 'dark' : 'light'}), pozadina:`, keepBg);

  // ---------- faza 3: uvoz, izvoz, poređenje ----------
  const wtA = mkdtempSync(join(tmpdir(), 'csv2tab-wt-a-'));
  const wtB = mkdtempSync(join(tmpdir(), 'csv2tab-wt-b-'));
  extraDirs.push(wtA, wtB);
  const setEnv = (k, v) => app.evaluate((_, [key, val]) => { process.env[key] = val; }, [k, v]);
  const nav = (name) => page.click(`nav button:has-text("${name}")`);
  const sessionId = () => page.evaluate(() => document.querySelector('[data-testid=jobview]')?.dataset.session ?? null);
  // uvoz kroz dijalog; čeka se NOV posao (id sesije se menja), ne samo ime fajla
  const importFile = async (path) => {
    const before = await sessionId();
    await setEnv('CSV2TAB_TEST_IMPORT', path);
    await page.click('[data-testid=import]');
    await page.waitForFunction((b) => {
      const id = document.querySelector('[data-testid=jobview]')?.dataset.session;
      return id && id !== b;
    }, before);
  };
  const waitRecords = (n) =>
    page.waitForFunction((c) => document.querySelector('[data-testid=parts-summary]')?.dataset.count === String(c), n);
  const waitEdited = (n) =>
    page.waitForFunction((c) => document.querySelector('[data-testid=parts-summary]')?.dataset.edited === String(c), n);
  const openTab = async (id) => {
    await page.click(`[data-testid=tab-${id}]`);
    await page.waitForSelector(`[data-testid=tab-${id}][aria-selected=true]`);
  };
  const waitBanner = (kind) => page.waitForSelector(`[data-testid=export-banner][data-kind=${kind}]`);
  const summary = () =>
    page.evaluate(() => {
      const d = document.querySelector('[data-testid=overwrite-dialog] [data-testid=diff-summary]').dataset;
      return { same: +d.same, changed: +d.changed, onlyA: +d.onlyA, onlyB: +d.onlyB };
    });
  const direct = (name, kind, bytes) =>
    page.evaluate(({ b, k }) => Array.from(window.__csv2tab.convertToTab(new Uint8Array(b), k)), { b: bytes, k: kind });
  const disk = (dir, name) => [...readFileSync(join(dir, name))];
  const KASMIR = 'Kasmir Kronospan 012-010';
  const HAND = 'Kronospan Kasmir.tab';

  // renderer ne može da zada folder ni da prođe pogrešne argumente
  await nav('Podešavanja');
  const guard = await page.evaluate(async () => {
    const t = (fn) => fn().then(() => 'ok', (e) => String(e.message));
    return [
      await t(() => window.api.settings.set('wtFolder', '/tmp')),
      await t(() => window.api.files.chooseFolder('theme')),
      await t(() => window.api.files.open('bilo-sta')),
      await t(() => window.api.export.write([{ name: '../x', bytes: new Uint8Array(300) }], [])),
      await t(() => window.api.export.check([{ name: 'x', bytes: 'nije bajt' }])),
      await t(() => window.api.compare.get('../../etc/passwd')),
      await t(() => window.api.compare.open({ aName: 'a', bName: 'b', a: [{ dim1: -1 }], b: [] })),
    ];
  });
  assert.ok(guard.every((m) => m !== 'ok'), `neispravan poziv prošao: ${guard}`);
  assert.match(guard[0], /izborom foldera/);
  assert.equal(await page.evaluate(() => window.api.settings.get('wtFolder')), '');

  // 1. uvoz CSV kroz dijalog; WT folder još nije zadat
  await nav('Poslovi');
  await importFile(fixturePath(`${KASMIR}.csv`));
  await waitRecords(14);
  await openTab('materials');
  await page.waitForSelector('[data-testid=materials-table] tr[data-material=U702]');
  const outName = (await page.textContent('[data-testid=out-name]')).trim();
  assert.match(outName, /\.tab$/);
  console.log(`uvoz CSV: 14 zapisa, materijal U702, izlazni fajl "${outName}"`);
  await openTab('parts');
  await page.click('[data-testid=export]');
  await waitBanner('problem');
  assert.match(await page.textContent('[data-testid=export-banner]'), /nije zadat/);
  // iz poruke se bira folder (dijalog zaobiđen), pa se izvoz nastavlja sam
  await setEnv('CSV2TAB_TEST_FOLDER', wtA);
  await page.click('[data-testid=choose-wt-folder]');
  await waitBanner('ok');
  assert.deepEqual(readdirSync(wtA), [outName]);
  const kasmirCsv = fx(`${KASMIR}.csv`);
  const expected = await direct(KASMIR, 'csv', kasmirCsv);
  assert.deepEqual(disk(wtA, outName), expected, 'izvezeni fajl != bajtovi jezgra');
  console.log(`izvoz: ${outName} (${expected.length} B) jednak bajtovima jezgra`);
  await openTab('exports');
  await page.waitForSelector('[data-testid=exports-table] tbody tr');
  await openTab('parts');

  // 2. izmena ćelije: pitanje sa razlikama; odustajanje ne dira fajl, potvrda ga prepisuje
  const qty0 = page.locator('tr[data-key] input[data-field=qty]').first();
  await qty0.fill('5');
  await qty0.press('Enter');
  await waitEdited(1);
  await page.waitForSelector('tr[data-key] td.edited');
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=overwrite-dialog] [data-testid=diff-summary]');
  assert.deepEqual(await summary(), { same: 13, changed: 1, onlyA: 0, onlyB: 0 });
  assert.deepEqual(disk(wtA, outName), expected, 'fajl izmenjen pre potvrde');
  await page.click('[data-testid=overwrite-cancel]');
  await page.waitForSelector('[data-testid=overwrite-dialog]', { state: 'detached' });
  assert.deepEqual(disk(wtA, outName), expected, 'fajl izmenjen posle odustajanja');
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=overwrite-confirm]');
  await page.click('[data-testid=overwrite-confirm]');
  await waitBanner('ok');
  const edited = [...expected];
  edited[165 + 31] = 5; // qty prvog zapisa (uint16 LE, pomeraj 31) 1 -> 5
  assert.deepEqual(disk(wtA, outName), edited, 'fajl ne odražava izmenu');
  assert.deepEqual(readdirSync(wtA), [outName], 'zaostao privremeni fajl');
  console.log('izmena ćelije: pitanje sa razlikama, odustajanje ne menja fajl, potvrda upisuje izmenu');

  // 3. prozor za poređenje: posao naspram ručno pravljenog .tab-a (u prozoru sa istim bezbednosnim podešavanjima)
  await setEnv('CSV2TAB_TEST_COMPARE', fixturePath(HAND));
  const cmpPromise = app.waitForEvent('window');
  await page.click('[data-testid=compare]');
  const cmp = await cmpPromise;
  watch(cmp);
  await cmp.waitForURL(/^app:\/\/csv2tab\/#compare=[0-9a-f-]{36}$/);
  await cmp.waitForSelector('[data-testid=compare-page] [data-testid=diff-summary]');
  const cmpSum = await cmp.evaluate(() => ({ ...document.querySelector('[data-testid=diff-summary]').dataset }));
  assert.equal(cmpSum.onlyA, '0');
  assert.equal(cmpSum.onlyB, '0');
  // ručni .tab se namerno razlikuje od CSV-a u 10 zapisa (zamenjene dimenzije, 2423 umesto 2323, kantovi 4/4 umesto
  // 2/2, drugačija imena), plus naša izmena količine
  assert.equal(cmpSum.changed, '11', `poređenje: ${JSON.stringify(cmpSum)}`);
  assert.equal(cmpSum.same, '3');
  assert.deepEqual(await cmp.evaluate(() => ({ node: typeof require + typeof process, api: Object.keys(window.api).sort() })), {
    node: 'undefinedundefined',
    api: ['app', 'catalog', 'compare', 'export', 'files', 'settings'],
  });
  assert.equal(await cmp.locator('.diff-table tr.changed').count(), 11);
  console.log('prozor poređenja:', JSON.stringify(cmpSum));
  await cmp.close();

  // 4. novi uvoz istog fajla nad izmenjenim poslom: traži potvrdu; potvrda ga zamenjuje
  await setEnv('CSV2TAB_TEST_IMPORT', fixturePath(`${KASMIR}.csv`));
  const idBefore = await sessionId();
  await page.click('[data-testid=import]');
  await page.waitForSelector('[data-testid=discard-dialog]');
  assert.equal(await sessionId(), idBefore, 'posao zamenjen bez potvrde');
  await page.click('[data-testid=discard-cancel]');
  await page.waitForSelector('[data-testid=discard-dialog]', { state: 'detached' });
  assert.equal(await sessionId(), idBefore);
  await page.click('[data-testid=import]');
  await page.waitForSelector('[data-testid=discard-confirm]');
  await page.click('[data-testid=discard-confirm]');
  await page.waitForFunction((b) => document.querySelector('[data-testid=jobview]')?.dataset.session !== b, idBefore);
  await waitRecords(14);
  await waitEdited(0);

  // 5. u WT folderu je ručno pravljen .tab pod ciljnim imenom: razlike se prikazuju, ništa se ne prepisuje bez potvrde
  copyFileSync(fixturePath(HAND), join(wtB, outName));
  await nav('Podešavanja');
  await setEnv('CSV2TAB_TEST_FOLDER', wtB);
  await page.click('[data-testid=choose-folder]');
  await page.waitForFunction((d) => document.querySelector('[data-testid=wt-folder]')?.textContent === d, wtB);
  await nav('Poslovi');
  await waitRecords(14); // posao je preživeo odlazak na drugu stranicu
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=overwrite-dialog] [data-testid=diff-summary]');
  assert.deepEqual(await summary(), { same: 4, changed: 10, onlyA: 0, onlyB: 0 });
  const handBytes = fx(HAND);
  assert.deepEqual(disk(wtB, outName), handBytes);
  const diffText = await page.textContent('[data-testid=overwrite-dialog]');
  assert.ok(diffText.includes(outName));
  await page.click('[data-testid=overwrite-dialog] summary');
  await page.waitForSelector('[data-testid=overwrite-dialog] .diff-table tr.changed');
  const changedText = await page.locator('[data-testid=overwrite-dialog] .diff-table tr.changed').allTextContents();
  assert.equal(changedText.length, 10);
  assert.ok(changedText.some((t) => t.includes('2323 × 414 ≠ 2423 × 414')), changedText.join(' | '));
  assert.ok(changedText.some((t) => t.includes('kant 1: 2 ≠ 4')), changedText.join(' | '));
  assert.ok(changedText.some((t) => t.includes('dimenzije su zamenjene')), changedText.join(' | '));
  // otkačen fajl se ne prepisuje
  await page.uncheck('[data-testid=diff-item] input[type=checkbox]');
  await page.click('[data-testid=overwrite-confirm]');
  await waitBanner('error');
  assert.deepEqual(disk(wtB, outName), handBytes, 'otkačen fajl je prepisan');
  // posebno okno iz pitanja
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=overwrite-dialog]');
  const cmp2Promise = app.waitForEvent('window');
  await page.click('[data-testid=overwrite-dialog] button:has-text("Otvori u posebnom prozoru")');
  const cmp2 = await cmp2Promise;
  watch(cmp2);
  await cmp2.waitForSelector('[data-testid=compare-page] [data-testid=diff-summary]');
  assert.equal(await cmp2.getAttribute('[data-testid=diff-summary]', 'data-changed'), '10');
  await cmp2.close();
  await page.click('[data-testid=overwrite-confirm]');
  await waitBanner('ok');
  assert.deepEqual(disk(wtB, outName), expected, 'potvrđeno prepisivanje nije upisalo novi fajl');
  console.log('postojeći ručni .tab: poznate razlike (10 zapisa) prikazane, nepotvrđen i otkačen nije prepisan, potvrđen jeste');

  // 6. ODS kroz dijalog, XLSX prevlačenjem; pogrešan tip se odbija
  await importFile(fixturePath(`${KASMIR}.ods`));
  await waitRecords(14);
  const dropOnPage = (name, bytes) =>
    page.evaluate(
      ({ name, bytes }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], name));
        const z = document.querySelector('[data-testid=jobs-page]');
        z.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      { name, bytes },
    );
  const odsId = await sessionId();
  await dropOnPage(`${KASMIR}.xlsx`, fx(`${KASMIR}.xlsx`));
  await page.waitForFunction((b) => {
    const j = document.querySelector('[data-testid=jobview]');
    return j && j.dataset.session !== b && j.dataset.file.endsWith('.xlsx');
  }, odsId);
  await waitRecords(14);
  await dropOnPage('slika.png', [1, 2, 3]);
  await page.waitForSelector('[data-testid=import-error]');
  console.log('uvoz ODS (dijalog) i XLSX (prevlačenje): po 14 zapisa; .png odbijen');

  // 7. .tab kao posao: zapisi se prikazuju, Izvor kaže da nema izvora
  await importFile(fixturePath(HAND));
  await openTab('source');
  await page.waitForFunction(() => /već gotovi zapisi/.test(document.querySelector('[data-testid=jobview]')?.textContent ?? ''));
  await openTab('parts');
  await page.waitForSelector('tr[data-key]');
  console.log('.tab uvezen kao posao');

  // 8. veliki spisak: 6000 zapisa, a u DOM-u samo vidljivi redovi; kraj spiska se dostiže skrolovanjem
  const N = 6000;
  const big = ['Material;Length - raw;Width - raw;Quantity;Designation']
    .concat(Array.from({ length: N }, (_, i) => `U702;${1000 + i} mm;${300 + (i % 50)} mm;1;P${i}`))
    .join('\n');
  await dropOnPage('veliki.csv', [...new TextEncoder().encode(big)]);
  await page.waitForFunction((n) => document.querySelector('[data-testid=parts-summary]')?.dataset.count === String(n), N, { timeout: 30000 });
  const rendered = await page.locator('tr[data-key]').count();
  assert.ok(rendered > 5 && rendered < 120, `u DOM-u ${rendered} redova`);
  await page.evaluate(() => { const s = document.querySelector('[data-testid=parts-scroll]'); s.scrollTop = s.scrollHeight; });
  await page.waitForFunction((n) => [...document.querySelectorAll('tr[data-key] td.rn')].some((td) => td.textContent === String(n)), N);
  assert.ok((await page.locator('tr[data-key]').count()) < 120);
  console.log(`veliki spisak: ${N} zapisa, u DOM-u ${rendered} redova, kraj dostupan skrolom`);

  assert.deepEqual(problems, [], `CSP ili greške u konzoli: ${problems.join(' | ')}`);

  // restart sa istim userData: podešavanje i tema moraju da ostanu
  await app.close();
  app = await launch();
  const page2 = await app.firstWindow();
  await page2.waitForURL('app://csv2tab/**', { timeout: 15000 });
  await page2.waitForSelector('nav.sidebar');
  assert.equal(await page2.evaluate(() => window.api.settings.get('theme')), keep);
  assert.equal(await isDark(page2), keep === 'dark', 'tema nije primenjena posle restarta');
  assert.equal(await bodyBg(page2), keepBg);
  await page2.click('nav button:has-text("Podešavanja")');
  // stranica učitava podešavanje asinhrono, pa se čeka na označeno polje
  await page2.waitForSelector(`input[value=${keep}]:checked`);
  assert.equal((await page2.evaluate(() => window.api.app.info())).schemaVersion, 1);
  assert.equal(await page2.evaluate(() => window.api.settings.get('wtFolder')), wtB, 'WT folder nije preživeo restart');
  console.log(`posle restarta: tema = ${keep}, primenjena`);

  console.log('SMOKE OK');
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
  for (const d of extraDirs) rmSync(d, { recursive: true, force: true });
}
