// Smoke test izgrađene aplikacije (Playwright _electron): prozor učitava app://csv2tab/, most radi, jezgro u
// rendereru daje iste bajtove za CSV, ODS i XLSX, a .tab round trip je bajt-identičan. Tema promenjena kroz interfejs
// preživljava restart (baza), a katalog se prikazuje. Uvoz (dijalog i prevlačenje), izvoz u WT folder, pitanje sa
// razlikama pre prepisivanja i prozor za poređenje. Poslovi: automatsko čuvanje, lista sa pretragom, ponovno otvaranje
// posle restarta bez originalnog fajla (isti .tab), stanje izvoza, isti fajl dvaput, brisanje, greška čuvanja i
// neispravno sačuvano stanje. Dijalozi se zaobilaze promenljivama okruženja (CSV2TAB_TEST_*) koje glavni proces
// poštuje samo uz CSV2TAB_TEST=1. Čeka se na uslove na stranici (indikator „sačuvano“), nikad na fiksno vreme.
// Pokreće se posle `npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
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
// Wayland ne dozvoljava pouzdan programski fokus/položaj; automatizacija koristi X11 na zadatom DISPLAY-u.
// Faktor 1: sa razlomljenim skaliranjem Electron na X11 zaokružuje veličinu prozora pri svakom pokretanju.
const displayArgs = process.platform === 'linux' ? ['--ozone-platform=x11', '--force-device-scale-factor=1'] : [];
const launch = (files = []) => _electron.launch({ executablePath: electron, args: [root, `--user-data-dir=${userData}`, ...displayArgs, ...files], env, timeout: 30000, colorScheme: null });
const isDark = (page) => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
let app = await launch();
try {
  let page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720));
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
  assert.deepEqual(surface, { api: ['app', 'backup', 'catalog', 'compare', 'export', 'files', 'jobs', 'lifecycle', 'memory', 'settings'], node: 'undefinedundefined', ipc: 'undefined' });
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
  assert.equal(await app.evaluate(({ BrowserWindow }) => new Promise((done) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.once('will-navigate', (event) => done(event.defaultPrevented));
    void contents.executeJavaScript("location.href = 'https://example.com/'");
  })), true);
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
  assert.equal(info.schemaVersion, 3);
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

  // ---------- poslovi: uvoz, automatsko čuvanje, izvoz ----------
  const wtA = mkdtempSync(join(tmpdir(), 'csv2tab-wt-a-'));
  const wtB = mkdtempSync(join(tmpdir(), 'csv2tab-wt-b-'));
  const wtC = mkdtempSync(join(tmpdir(), 'csv2tab-wt-c-'));
  const wtD = mkdtempSync(join(tmpdir(), 'csv2tab-wt-d-'));
  const srcDir = mkdtempSync(join(tmpdir(), 'csv2tab-src-'));
  extraDirs.push(wtA, wtB, wtC, wtD, srcDir);
  const setEnv = (k, v) => app.evaluate((_, [key, val]) => { process.env[key] = val; }, [k, v]);
  const nav = (name) => page.click(`nav button:has-text("${name}")`);
  const sessionId = () => page.evaluate(() => document.querySelector('[data-testid=jobview]')?.dataset.session ?? null);
  const jobId = () => page.evaluate(() => document.querySelector('[data-testid=jobview]')?.dataset.job ?? null);
  const waitSaved = () => page.waitForSelector('[data-testid=save-state][data-state=saved]');
  const jobsApi = (text = '') => page.evaluate((t) => window.api.jobs.list({ text: t, offset: 0, limit: 200 }), text);
  // povratak na listu (zatvaranje posla ga prvo čuva)
  const toList = async () => {
    await nav('Poslovi');
    if (await page.$('[data-testid=jobview]')) await page.click('[data-testid=close-job]');
    await page.waitForSelector('[data-testid=import]');
  };
  // uvoz kroz dijalog; vraća id novog (ili otvorenog) posla
  const importFile = async (path) => {
    await toList();
    await setEnv('CSV2TAB_TEST_IMPORT', path);
    await page.click('[data-testid=import]');
    await page.waitForSelector('[data-testid=jobview]');
    return jobId();
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
  const chooseWtFolder = async (dir) => {
    await nav('Podešavanja');
    await setEnv('CSV2TAB_TEST_FOLDER', dir);
    await page.click('[data-testid=choose-folder]');
    await page.waitForFunction((d) => document.querySelector('[data-testid=wt-folder]')?.textContent === d, basename(dir));
    assert.equal(await page.evaluate(() => window.api.settings.get('wtFolder')), basename(dir));
    assert.equal((await page.evaluate(() => window.api.settings.all())).wtFolder, basename(dir));
    assert.equal(await page.evaluate(() => window.api.files.chooseFolder('wtFolder')), basename(dir));
  };
  const KASMIR = 'Kasmir Kronospan 012-010';
  const HAND = 'Kronospan Kasmir.tab';

  // renderer ne može da zada folder ni da prođe pogrešne argumente (stare i nove operacije)
  await nav('Podešavanja');
  const guard = await page.evaluate(async (handTab) => {
    const t = (fn) => fn().then(() => 'ok', (e) => String(e.message));
    const goodState = { version: 2, encoding: 'auto', delimiter: 'auto', sheet: 0, mapping: 'auto', merge: true, materials: {}, edits: {}, edgeRules: [{ a: 0, b: 0, code: 0 }], decorRule: true, mappingFromMemory: false };
    const csv = (kind) => ({ name: 'a.csv', kind, bytes: new Uint8Array(3) });
    return [
      await t(() => window.api.settings.set('wtFolder', '/tmp')),
      await t(() => window.api.files.chooseFolder('theme')),
      await t(() => window.api.files.open('bilo-sta')),
      await t(() => window.api.export.write([{ name: '../x', bytes: new Uint8Array(300) }], [], null)),
      await t(() => window.api.export.check([{ name: 'x', bytes: 'nije bajt' }])),
      await t(() => window.api.compare.get('../../etc/passwd')),
      await t(() => window.api.compare.open({ aName: 'a', bName: 'b', a: [{ dim1: -1 }], b: [] })),
      await t(() => window.api.jobs.get(0)),
      await t(() => window.api.jobs.get('1')),
      await t(() => window.api.jobs.get(12345)),
      await t(() => window.api.jobs.list({ text: '', offset: 0, limit: 9999 })),
      await t(() => window.api.jobs.list({ text: 'x', offset: -1, limit: 10 })),
      await t(() => window.api.jobs.update(1, { ime: 'x' })),
      await t(() => window.api.jobs.update(1, { name: '   ' })),
      await t(() => window.api.jobs.delete(-5)),
      await t(() => window.api.jobs.delete(12345)),
      await t(() => window.api.jobs.findBySource('nije-hes')),
      await t(() => window.api.jobs.create(csv('xlsx'), { state: goodState, parts: [], outputs: [] })),
      await t(() => window.api.jobs.create(csv('csv'), { state: { ...goodState, version: 3 }, parts: [], outputs: [] })),
      await t(() => window.api.jobs.create(csv('csv'), { state: goodState, parts: [{ dim1: -1 }], outputs: [] })),
      await t(() => window.api.jobs.save(12345, { state: goodState, parts: [], outputs: [] })),
      await t(() => window.api.export.write([{ name: 'x.tab', bytes: new Uint8Array(handTab), material: 'm' }], [], 12345)),
      await t(() => window.api.settings.set('backupFolder', '/tmp')),
      await t(() => window.api.settings.set('edgeRules', [{ a: 1, b: 1, code: 4 }, { a: 1, b: 1, code: 5 }])),
      await t(() => window.api.settings.set('decorRule', 'da')),
      await t(() => window.api.memory.remember({ materials: [{ name: 'x', grain: 5 }] })),
      await t(() => window.api.memory.lookup({ names: 'x', signature: null })),
      await t(() => window.api.memory.forget('nesto', null)),
      await t(() => window.api.backup.restore('nije-oznaka')),
      await t(() => window.api.backup.restore('00000000-0000-0000-0000-000000000000')),
      await t(() => window.api.jobs.save(12345, { state: goodState, parts: [], outputs: [], remember: { materials: [{ name: '', wt: 'X' }] } })),
      await t(() => window.api.files.next('/tmp/fajl.csv')),
    ];
  }, fx(HAND));
  assert.ok(guard.every((m) => m !== 'ok'), `neispravan poziv prošao: ${guard.map((m, i) => `${i}:${m}`).filter((m) => m.endsWith(':ok'))}`);
  assert.match(guard[0], /izborom foldera/);
  assert.match(guard[20], /Posao ne postoji/);
  assert.equal(await page.evaluate(() => window.api.settings.get('wtFolder')), '');
  await setEnv('CSV2TAB_TEST_IMPORT', join(srcDir, 'ne-postoji.csv'));
  const missingFile = await page.evaluate(async () => {
    try { await window.api.files.open('import'); } catch (error) { return String(error); }
  });
  assert.match(missingFile, /ENOENT/);
  assert.equal(missingFile.includes(srcDir), false, 'putanja u grešci prelazi IPC');
  assert.equal((await jobsApi()).total, 0, 'neispravni pozivi su napravili posao');
  await nav('Poslovi');
  await page.waitForSelector('[data-testid=job-empty]');

  // 1. uvoz CSV kroz dijalog: odmah postaje posao u bazi; WT folder još nije zadat
  const idKasmir = await importFile(fixturePath(`${KASMIR}.csv`));
  await waitRecords(14);
  await waitSaved();
  assert.equal((await jobsApi()).total, 1);
  assert.equal(await page.inputValue('[data-testid=job-name]'), KASMIR);
  await openTab('materials');
  await page.waitForSelector('[data-testid=materials-table] tr[data-material=U702]');
  const outName = (await page.textContent('[data-testid=out-name]')).trim();
  assert.match(outName, /\.tab$/);
  console.log(`uvoz CSV: odmah posao #${idKasmir} u bazi, 14 zapisa, materijal U702, izlazni fajl "${outName}"`);
  await openTab('parts');
  await page.click('[data-testid=export]');
  await waitBanner('problem');
  assert.match(await page.textContent('[data-testid=export-banner]'), /nije zadat/);
  // iz poruke se bira folder (dijalog zaobiđen), pa se izvoz nastavlja sam
  await setEnv('CSV2TAB_TEST_FOLDER', wtA);
  await page.click('[data-testid=choose-wt-folder]');
  await waitBanner('ok');
  assert.equal((await page.textContent('[data-testid=export-banner]')).includes(wtA), false);
  const history = await page.evaluate((id) => window.api.jobs.exports(+id), idKasmir);
  assert.equal(history.exports[0].folder, basename(wtA));
  assert.deepEqual(readdirSync(wtA), [outName]);
  const kasmirCsv = fx(`${KASMIR}.csv`);
  const expected = await direct(KASMIR, 'csv', kasmirCsv);
  const checked = await page.evaluate(({ name, bytes }) => window.api.export.check([{ name, bytes: new Uint8Array(bytes) }]), { name: outName, bytes: expected });
  assert.equal(checked.folder, basename(wtA));
  assert.deepEqual(disk(wtA, outName), expected, 'izvezeni fajl != bajtovi jezgra');
  console.log(`izvoz: ${outName} (${expected.length} B) jednak bajtovima jezgra`);
  await page.waitForSelector('[data-testid=job-status][data-status=current]');
  await openTab('exports');
  await page.waitForSelector('[data-testid=exports-table] tbody tr');
  assert.equal(await page.locator('[data-testid=exports-table] tbody tr').count(), 1);
  assert.doesNotMatch(await page.textContent('[data-testid=jobview]'), /faz[aei] \d/i, 'broj faze u interfejsu');
  await openTab('parts');

  // 2. izmena ćelije: pitanje sa razlikama; odustajanje ne dira fajl, potvrda ga prepisuje; izmena se čuva sama
  const qty0 = page.locator('tr[data-key] input[data-field=qty]').first();
  await qty0.fill('5');
  await qty0.press('Enter');
  await waitEdited(1);
  await page.waitForSelector('tr[data-key] td.edited');
  await waitSaved();
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=overwrite-dialog] [data-testid=diff-summary]');
  assert.deepEqual(await summary(), { same: 13, changed: 1, onlyA: 0, onlyB: 0 });
  assert.deepEqual(disk(wtA, outName), expected, 'fajl izmenjen pre potvrde');
  await page.click('[data-testid=overwrite-cancel]');
  await page.waitForSelector('[data-testid=overwrite-dialog]', { state: 'detached' });
  assert.deepEqual(disk(wtA, outName), expected, 'fajl izmenjen posle odustajanja');
  // odustajanje nije izvoz: posao je i dalje menjan posle poslednjeg izvoza
  await page.waitForSelector('[data-testid=job-status][data-status=changed]');
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=overwrite-confirm]');
  await page.click('[data-testid=overwrite-confirm]');
  await waitBanner('ok');
  const edited = [...expected];
  edited[165 + 31] = 5; // qty prvog zapisa (uint16 LE, pomeraj 31) 1 -> 5
  assert.deepEqual(disk(wtA, outName), edited, 'fajl ne odražava izmenu');
  assert.deepEqual(readdirSync(wtA), [outName], 'zaostao privremeni fajl');
  await page.waitForSelector('[data-testid=job-status][data-status=current]');
  await openTab('exports');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=exports-table] tbody tr').length === 2);
  await openTab('parts');
  console.log('izmena ćelije: sačuvana sama, pitanje sa razlikama, odustajanje ne menja fajl ni stanje izvoza, potvrda upisuje izmenu');

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
    api: ['app', 'backup', 'catalog', 'compare', 'export', 'files', 'jobs', 'lifecycle', 'memory', 'settings'],
  });
  assert.equal(await cmp.locator('.diff-table tr.changed').count(), 11);
  console.log('prozor poređenja:', JSON.stringify(cmpSum));
  await cmp.close();
  // zatvaranje prozora poređenja ne dira glavni prozor ni čuvanje
  assert.equal(await jobId(), idKasmir);
  await waitSaved();

  // 4. isti fajl ponovo: pitanje (ne tiho dupliranje, ne tiha zabrana); otvaranje postojećeg čuva izmene
  await toList();
  await setEnv('CSV2TAB_TEST_IMPORT', fixturePath(`${KASMIR}.csv`));
  await page.click('[data-testid=import]');
  await page.waitForSelector('[data-testid=duplicate-dialog]');
  assert.ok((await page.textContent('[data-testid=duplicate-dialog]')).includes(KASMIR));
  assert.equal(await page.$('[data-testid=jobview]'), null, 'posao otvoren pre odgovora');
  assert.equal((await jobsApi()).total, 1, 'dupli posao napravljen pre odgovora');
  await page.click('[data-testid=duplicate-cancel]');
  await page.waitForSelector('[data-testid=duplicate-dialog]', { state: 'detached' });
  assert.equal((await jobsApi()).total, 1);
  await page.click('[data-testid=import]');
  await page.waitForSelector('[data-testid=duplicate-open]');
  await page.click('[data-testid=duplicate-open]');
  await page.waitForSelector('[data-testid=jobview]');
  assert.equal(await jobId(), idKasmir);
  await waitRecords(14);
  await waitEdited(1); // ručna izmena je u sačuvanom poslu
  await toList();
  await page.click('[data-testid=import]');
  await page.waitForSelector('[data-testid=duplicate-new]');
  await page.click('[data-testid=duplicate-new]');
  await page.waitForFunction((id) => { const j = document.querySelector('[data-testid=jobview]'); return j && j.dataset.job !== id; }, idKasmir);
  const idNew = await jobId();
  await waitRecords(14);
  await waitEdited(0);
  await waitSaved();
  assert.equal((await jobsApi()).total, 2);
  console.log(`isti fajl ponovo: pitanje; odustani ne pravi posao, "otvori postojeći" vraća #${idKasmir} sa izmenom, "novi posao" pravi #${idNew}`);

  // 5. u WT folderu je ručno pravljen .tab pod ciljnim imenom: razlike se prikazuju, ništa se ne prepisuje bez potvrde
  copyFileSync(fixturePath(HAND), join(wtB, outName));
  await chooseWtFolder(wtB);
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
  // otkačen fajl se ne prepisuje i ne beleži kao izvoz
  await page.uncheck('[data-testid=diff-item] input[type=checkbox]');
  await page.click('[data-testid=overwrite-confirm]');
  await waitBanner('error');
  assert.deepEqual(disk(wtB, outName), handBytes, 'otkačen fajl je prepisan');
  assert.equal((await jobsApi()).items.find((j) => j.id === Number(idNew)).exportStatus, 'never', 'preskočen izvoz je zabeležen');
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
  console.log('postojeći ručni .tab: poznate razlike (10 zapisa) prikazane, nepotvrđen i otkačen nije prepisan ni zabeležen, potvrđen jeste');

  // 6. ODS kroz dijalog, XLSX prevlačenjem; pogrešan tip se odbija
  const idOds = await importFile(fixturePath(`${KASMIR}.ods`));
  await waitRecords(14);
  const odsSession = await sessionId();
  await dropOnPage(`${KASMIR}.xlsx`, fx(`${KASMIR}.xlsx`));
  await page.waitForFunction((b) => {
    const j = document.querySelector('[data-testid=jobview]');
    return j && j.dataset.session !== b && j.dataset.file.endsWith('.xlsx');
  }, odsSession);
  await waitRecords(14);
  const idXlsx = await jobId();
  await dropOnPage('slika.png', [1, 2, 3]);
  await page.waitForSelector('[data-testid=import-error]');
  assert.equal((await jobsApi()).total, 4);
  console.log('uvoz ODS (dijalog) i XLSX (prevlačenje): po 14 zapisa, svaki svoj posao; .png odbijen');

  // 7. .tab kao posao: zapisi se prikazuju, Izvor kaže da nema izvora
  await importFile(fixturePath(HAND));
  await openTab('source');
  await page.waitForFunction(() => /već gotovi zapisi/.test(document.querySelector('[data-testid=jobview]')?.textContent ?? ''));
  await openTab('parts');
  await page.waitForSelector('tr[data-key]');
  console.log('.tab uvezen kao posao');

  // 8. veliki spisak: 6000 zapisa, a u DOM-u samo vidljivi redovi; izmena ostaje brza i čuva se sama
  const N = 6000;
  const big = ['Material;Length - raw;Width - raw;Quantity;Designation']
    .concat(Array.from({ length: N }, (_, i) => `U702;${1000 + i} mm;${300 + (i % 50)} mm;1;P${i}`))
    .join('\n');
  const t0 = Date.now();
  await dropOnPage('veliki.csv', [...new TextEncoder().encode(big)]);
  await page.waitForFunction((n) => document.querySelector('[data-testid=parts-summary]')?.dataset.count === String(n), N, { timeout: 30000 });
  await waitSaved();
  const createMs = Date.now() - t0;
  const rendered = await page.locator('tr[data-key]').count();
  assert.ok(rendered > 5 && rendered < 120, `u DOM-u ${rendered} redova`);
  await page.evaluate(() => { const s = document.querySelector('[data-testid=parts-scroll]'); s.scrollTop = s.scrollHeight; });
  await page.waitForFunction((n) => [...document.querySelectorAll('tr[data-key] td.rn')].some((td) => td.textContent === String(n)), N);
  assert.ok((await page.locator('tr[data-key]').count()) < 120);
  console.log(`veliki spisak: ${N} zapisa, u DOM-u ${rendered} redova, kraj dostupan skrolom; uvoz do sačuvanog posla ${createMs} ms`);
  // sonda: vreme od Enter do prikaza izmene, dugi zadaci glavne niti i trajanje čuvanja
  await page.evaluate(() => { const s = document.querySelector('[data-testid=parts-scroll]'); s.scrollTop = 0; });
  // tabela crta samo vidljive redove: pre izmene se čeka da se prikaže početak spiska (inače bi ćelija nestala usred izmene)
  await page.waitForFunction(() => document.querySelector('tr[data-key] td.rn')?.textContent === '1');
  await page.evaluate(() => {
    const probe = (window.__probe = { states: [], long: [], keyAt: 0, shownAt: 0 });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) probe.long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
    const ind = document.querySelector('[data-testid=save-state]');
    new MutationObserver(() => probe.states.push([ind.dataset.state, performance.now()])).observe(ind, { attributes: true, attributeFilter: ['data-state'] });
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter') probe.keyAt = performance.now(); }, true);
    const sum = document.querySelector('[data-testid=parts-summary]');
    new MutationObserver(() => { if (sum.dataset.edited === '1' && !probe.shownAt) probe.shownAt = performance.now(); }).observe(sum, { attributes: true, attributeFilter: ['data-edited'] });
  });
  const bigQty = page.locator('tr[data-key] input[data-field=qty]').first();
  await bigQty.fill('3');
  await bigQty.press('Enter');
  await waitEdited(1);
  await page.waitForFunction(() => window.__probe.states.some(([s]) => s === 'saved'));
  const pr = await page.evaluate(() => window.__probe);
  const at = (s) => pr.states.find(([x]) => x === s)?.[1];
  const shown = pr.shownAt - pr.keyAt;
  const saveMs = at('saved') - at('saving');
  console.log(
    `veliki posao, izmena ćelije: Enter -> prikaz ${shown.toFixed(0)} ms; stanja ${pr.states.map(([s, t]) => `${s}@${(t - pr.keyAt).toFixed(0)}`).join(' ')}; ` +
      `upis ${saveMs.toFixed(0)} ms; dugi zadaci glavne niti: ${pr.long.length ? pr.long.join(', ') + ' ms' : 'nijedan'}`,
  );
  assert.ok(shown < 1500, `izmena u velikom poslu se prikazuje ${shown} ms`);
  assert.ok(saveMs < 3000, `čuvanje velikog posla ${saveMs} ms`);
  assert.ok(pr.states.map(([s]) => s).join() === 'dirty,saving,saved' || pr.states.map(([s]) => s).includes('saved'), JSON.stringify(pr.states));

  // širina kolona mišem: ivica zaglavlja prati miša, ostale kolone se ne pomeraju, a širina se pamti po tabeli
  const colWidths = () =>
    page.evaluate(() => [...document.querySelectorAll('.parts-table thead th')].map((th) => Math.round(th.getBoundingClientRect().width)));
  const colEdge = (i) =>
    page.evaluate((n) => {
      const r = document.querySelectorAll('.parts-table thead th')[n].getBoundingClientRect();
      return { x: r.right - 2, y: r.top + r.height / 2 };
    }, i);
  const savedCols = () => page.evaluate(() => JSON.parse(localStorage.getItem('cols:parts')));
  const w0 = await colWidths();
  const edge = await colEdge(1);
  await page.mouse.move(edge.x, edge.y);
  assert.equal(await page.evaluate(() => document.querySelector('.parts-table').style.cursor), 'col-resize');
  await page.mouse.down();
  await page.mouse.move(edge.x + 60, edge.y, { steps: 4 });
  await page.mouse.up();
  const w1 = await colWidths();
  assert.equal(w1[1], w0[1] + 60, `kolona Dužina: ${w0[1]} -> ${w1[1]}`);
  w1.forEach((w, i) => i !== 1 && assert.ok(Math.abs(w - w0[i]) <= 1, `kolona ${i} se pomerila: ${w0[i]} -> ${w1[i]}`));
  assert.equal((await savedCols())[1], w1[1]);
  await openTab('materials');
  await openTab('parts');
  await page.waitForSelector('.parts-table[data-resized]');
  assert.deepEqual(await colWidths(), w1, 'širine kolona nisu vraćene posle promene kartice');
  console.log(`širina kolona: Dužina ${w0[1]} -> ${w1[1]} px, ostale iste, zapamćeno`);

  assert.deepEqual(problems, [], `CSP ili greške u konzoli: ${problems.join(' | ')}`);

  // ---------- poslovi: trajnost, stanje izvoza, pretraga ----------
  // 9. nov posao od privremene kopije fajla (ime sa dijakritikom): ručna izmena, izbor materijala, izvoz
  const SRC = join(srcDir, 'Šupa Đurđevak.csv');
  copyFileSync(fixturePath('Stone oak Kronospan.csv'), SRC);
  await chooseWtFolder(wtC);
  const idP = await importFile(SRC);
  await waitSaved();
  assert.equal(await page.inputValue('[data-testid=job-name]'), 'Šupa Đurđevak');
  const countP = Number(await page.getAttribute('[data-testid=parts-summary]', 'data-count'));
  assert.ok(countP > 10, `zapisa: ${countP}`);
  const nameCell = page.locator('tr[data-key] input[data-field=name]').first();
  await nameCell.fill('Šifonjer đak');
  await nameCell.press('Enter');
  await waitEdited(1);
  await waitSaved();

  // greška čuvanja je vidljiva, ne gubi izmenu i ponavlja se; napuštanje posla traži odluku
  await setEnv('CSV2TAB_TEST_FAIL_SAVE', '1');
  const qty1 = page.locator('tr[data-key] input[data-field=qty]').nth(1);
  await qty1.fill('4');
  await qty1.press('Enter');
  await waitEdited(2);
  await page.waitForSelector('[data-testid=save-state][data-state=failed]');
  await page.waitForSelector('[data-testid=save-error]');
  assert.match(await page.textContent('[data-testid=save-error]'), /Simulirana greška/);
  await page.click('[data-testid=close-job]');
  await page.waitForSelector('[data-testid=blocked-dialog]');
  await page.click('[data-testid=blocked-cancel]');
  await page.waitForSelector('[data-testid=blocked-dialog]', { state: 'detached' });
  assert.equal(await jobId(), idP, 'posao je zatvoren uprkos nesačuvanim izmenama');
  assert.equal(await page.getAttribute('[data-testid=save-state]', 'data-state'), 'failed');
  await setEnv('CSV2TAB_TEST_FAIL_SAVE', '');
  await page.click('[data-testid=save-retry]');
  await waitSaved();
  await page.waitForSelector('[data-testid=save-error]', { state: 'detached' });
  console.log('greška čuvanja: indikator i poruka vidljivi, napuštanje posla traži odluku, ponovni pokušaj upisuje izmenu');

  // izbor materijala: WT materijal iz kataloga, traka i ime fajla
  await openTab('materials');
  await page.fill('[data-testid=wt-material]', '103-ME3');
  await page.press('[data-testid=wt-material]', 'Enter');
  await page.waitForFunction(() => /103-ME3/.test(document.querySelector('[data-testid=wt-material]').value));
  await page.selectOption('select[aria-label^="Traka za"]', { index: 1 });
  await page.fill('[data-testid=file-name]', 'Trajni izvoz');
  await page.waitForFunction(() => document.querySelector('[data-testid=out-name]').textContent.trim() === 'Trajni izvoz.tab');
  await waitSaved();
  const wtMaterialLabel = await page.inputValue('[data-testid=wt-material]');
  await openTab('parts');
  await page.click('[data-testid=export]');
  await waitBanner('ok');
  const FIRST = disk(wtC, 'Trajni izvoz.tab');
  assert.deepEqual(readdirSync(wtC), ['Trajni izvoz.tab']);
  await page.waitForSelector('[data-testid=job-status][data-status=current]');
  await waitSaved();
  console.log(`posao #${idP}: ${countP} zapisa, izmena imena, WT materijal "${wtMaterialLabel}", izvezeno ${FIRST.length} B`);

  // lista bez otvaranja posla: izvezen i nepromenjen; originalni fajl se briše pre zatvaranja programa
  await toList();
  await page.waitForSelector(`tr[data-job-id="${idP}"][data-status=current]`);
  rmSync(SRC);
  assert.equal(existsSync(SRC), false);
  const colors = (await jobsApi()).items;
  assert.equal(colors.find((j) => j.id === Number(idKasmir)).exportStatus, 'current');
  assert.equal(colors.find((j) => j.id === Number(idNew)).exportStatus, 'current'); // izvezen u koraku 5 (potvrđeno prepisivanje)
  assert.equal(colors.find((j) => j.id === Number(idOds)).exportStatus, 'never');

  // 10. restart bez originalnog fajla
  await app.close();
  {
    const db = new DatabaseSync(join(userData, 'csv2tab.db'), { readOnly: true });
    const one = (q, ...a) => db.prepare(q).get(...a);
    assert.equal(one('SELECT source_path FROM jobs WHERE id = ?', Number(idP)).source_path, SRC, 'putanja iz dijaloga nije zapamćena');
    assert.equal(one('SELECT source_path FROM jobs WHERE id = ?', Number(idOds)).source_path, fixturePath(`${KASMIR}.ods`));
    assert.equal(one('SELECT source_path FROM jobs WHERE id = ?', Number(idXlsx)).source_path, null, 'prevučen fajl ima putanju');
    const saved = one('SELECT bytes, folder FROM exports WHERE job_id = ? ORDER BY id DESC', Number(idP));
    assert.equal(saved.folder, wtC, 'puna putanja izvoza nije ostala u bazi');
    assert.deepEqual([...saved.bytes], FIRST, 'sačuvani bajtovi izvoza != fajl u folderu');
    assert.equal(one('SELECT count(*) AS n FROM job_parts WHERE job_id = ?', Number(idP)).n, countP);
    assert.equal(one("SELECT count(*) AS n FROM job_parts WHERE job_id = ? AND name = 'Šifonjer đak'", Number(idP)).n, 1);
    db.close();
    // neispravno stanje (npr. iz buduće verzije) se mora prikazati porukom, ne rušenjem
    const rw = new DatabaseSync(join(userData, 'csv2tab.db'));
    rw.prepare('UPDATE jobs SET state = ? WHERE id = ?').run(JSON.stringify({ version: 99, nesto: 'novo' }), Number(idNew));
    rw.close();
  }
  app = await launch();
  page = await app.firstWindow();
  watch(page);
  await page.waitForURL('app://csv2tab/**', { timeout: 15000 });
  await page.waitForSelector('nav.sidebar');
  assert.equal(await page.evaluate(() => window.api.settings.get('theme')), keep);
  assert.equal(await isDark(page), keep === 'dark', 'tema nije primenjena posle restarta');
  assert.equal(await bodyBg(page), keepBg);
  await page.click('nav button:has-text("Podešavanja")');
  // stranica učitava podešavanje asinhrono, pa se čeka na označeno polje
  await page.waitForSelector(`input[value=${keep}]:checked`);
  assert.equal((await page.evaluate(() => window.api.app.info())).schemaVersion, 3);
  assert.equal(await page.evaluate(() => window.api.settings.get('wtFolder')), basename(wtC), 'WT folder nije preživeo restart');
  console.log(`posle restarta: tema = ${keep}, primenjena`);

  await nav('Poslovi');
  await page.waitForSelector('[data-testid=job-list]');
  await page.waitForSelector(`tr[data-job-id="${idP}"][data-status=current]`);
  assert.equal((await jobsApi()).total, 7);
  await page.click(`tr[data-job-id="${idP}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=jobview]');
  await waitRecords(countP);
  await waitEdited(2); // ime i količina drugog zapisa
  assert.equal(await page.inputValue('tr[data-key] input[data-field=name]'), 'Šifonjer đak');
  await openTab('materials');
  await page.waitForSelector('[data-testid=out-name]');
  assert.equal((await page.textContent('[data-testid=out-name]')).trim(), 'Trajni izvoz.tab');
  assert.equal(await page.inputValue('[data-testid=wt-material]'), wtMaterialLabel);
  await openTab('exports');
  await page.waitForSelector('[data-testid=exports-table] tbody tr');
  assert.equal(await page.locator('[data-testid=exports-table] tbody tr').count(), 1);
  await openTab('parts');
  // širina kolone preživljava restart; dvoklik na ivicu zaglavlja vraća podrazumevane širine
  await page.waitForSelector('.parts-table[data-resized]');
  assert.equal((await colWidths())[1], w1[1], 'širina kolone nije preživela restart');
  const edge2 = await colEdge(1);
  await page.mouse.dblclick(edge2.x, edge2.y);
  await page.waitForSelector('.parts-table:not([data-resized])');
  assert.equal(await savedCols(), null);
  assert.equal(await page.evaluate(() => document.querySelector('.parts-table').style.width), '');
  console.log('širina kolona: preživela restart, dvoklik vratio podrazumevane');
  // izvoz u sveži, prazan WT folder: isti bajtovi kao prvi izvoz, bez originalnog fajla na disku
  await chooseWtFolder(wtD);
  assert.deepEqual(readdirSync(wtD), []);
  await nav('Poslovi');
  await waitRecords(countP);
  await page.click('[data-testid=export]');
  await waitBanner('ok');
  assert.deepEqual(readdirSync(wtD), ['Trajni izvoz.tab']);
  assert.deepEqual(disk(wtD, 'Trajni izvoz.tab'), FIRST, 'izvoz posle restarta nije bajt-identičan prvom izvozu');
  await page.waitForSelector('[data-testid=job-status][data-status=current]');
  await openTab('exports');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=exports-table] tbody tr').length === 2);
  await openTab('parts');
  console.log(`posle restarta bez originalnog fajla: posao #${idP} otvoren sa izmenom i izborom, izvoz u prazan folder bajt-identičan (${FIRST.length} B)`);

  // izmena posle izvoza: lista je pokazuje kao menjanu; vraćanje izmene vraća "nepromenjen"
  const qty0b = page.locator('tr[data-key] input[data-field=qty]').first();
  const qtyBefore = await qty0b.inputValue();
  await qty0b.fill('9');
  await qty0b.press('Enter');
  await waitEdited(3);
  await waitSaved();
  await toList();
  await page.waitForSelector(`tr[data-job-id="${idP}"][data-status=changed]`);
  await page.click(`tr[data-job-id="${idP}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=jobview]');
  await waitEdited(3);
  const qty0c = page.locator('tr[data-key] input[data-field=qty]').first();
  await qty0c.fill(qtyBefore);
  await qty0c.press('Enter');
  await waitEdited(2); // vraćena izračunata vrednost briše izmenu
  await waitSaved();
  await toList();
  await page.waitForSelector(`tr[data-job-id="${idP}"][data-status=current]`);
  console.log('izmena posle izvoza: lista pokazuje "menjan posle izvoza", vraćanje izmene vraća "izvezen"');
  await page.click(`tr[data-job-id="${idP}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=jobview]');
  await waitEdited(2);
  const qty0d = page.locator('tr[data-key] input[data-field=qty]').first();
  await qty0d.fill('9');
  await qty0d.press('Enter');
  await waitEdited(3);
  await waitSaved();
  await toList();
  await page.waitForSelector(`tr[data-job-id="${idP}"][data-status=changed]`);

  // pretraga: naziv dela (bez dijakritika i sa njima), ime posla, materijal, datum, bez pogotka
  const search = async (text) => {
    await page.fill('[data-testid=job-search]', text);
    await page.waitForFunction((q) => document.querySelector('[data-testid=job-count]')?.dataset.loaded === q, text);
  };
  const rowsNow = () => page.locator('[data-testid=job-list] tbody tr').evaluateAll((trs) => trs.map((t) => t.dataset.name));
  await search('sifonjer');
  assert.deepEqual(await rowsNow(), ['Šupa Đurđevak']);
  await search('ŠIFONJER ĐAK');
  assert.deepEqual(await rowsNow(), ['Šupa Đurđevak']);
  await search('djak');
  assert.deepEqual(await rowsNow(), ['Šupa Đurđevak']);
  await search('supa djurdjevak');
  assert.deepEqual(await rowsNow(), ['Šupa Đurđevak']);
  await search('Drvo_dezen');
  assert.deepEqual(await rowsNow(), ['Šupa Đurđevak']);
  const d = new Date();
  const today = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  await search(today);
  assert.equal((await rowsNow()).length, 7);
  await search('zzzqqq');
  await page.waitForSelector('[data-testid=job-empty]');
  await search('');
  assert.equal((await rowsNow()).length, 7);
  console.log('pretraga: naziv dela, ime posla, materijal i datum nalaze posao; "sifonjer"/"ŠIFONJER ĐAK"/"djak" i "supa djurdjevak" rade bez obzira na dijakritike');

  // izmena pa odmah zatvaranje programa, bez čekanja na indikator: glavni proces traži čuvanje pre zatvaranja
  await page.click(`tr[data-job-id="${idP}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=jobview]');
  await waitEdited(3);
  const qty2 = page.locator('tr[data-key] input[data-field=qty]').nth(2);
  await qty2.fill('7');
  await qty2.press('Enter');
  await waitEdited(4);
  const stateAtClose = await page.getAttribute('[data-testid=save-state]', 'data-state');
  await app.close();
  console.log(`zatvaranje odmah posle izmene (indikator je tada bio "${stateAtClose}")`);
  app = await launch();
  page = await app.firstWindow();
  watch(page);
  await page.waitForURL('app://csv2tab/**', { timeout: 15000 });
  await page.waitForSelector('nav.sidebar');
  await page.waitForSelector(`tr[data-job-id="${idP}"]`);
  await page.click(`tr[data-job-id="${idP}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=jobview]');
  await waitEdited(4); // izmena iz poslednjeg trenutka pre zatvaranja je sačuvana
  console.log('izmena neposredno pred zatvaranje programa je sačuvana');

  // brisanje: potvrda kaže šta se briše; fajlovi u WT folderu ostaju
  await page.click('[data-testid=delete-job]');
  await page.waitForSelector('[data-testid=delete-dialog]');
  const delText = await page.textContent('[data-testid=delete-dialog]');
  assert.match(delText, /2 sačuvanih izvoza/);
  assert.match(delText, /ostaju netaknuti/);
  await page.click('[data-testid=delete-cancel]');
  await page.waitForSelector('[data-testid=delete-dialog]', { state: 'detached' });
  assert.equal((await jobsApi()).total, 7);
  await page.click('[data-testid=delete-job]');
  await page.click('[data-testid=delete-confirm]');
  await page.waitForSelector('[data-testid=import]');
  await page.waitForSelector(`tr[data-job-id="${idP}"]`, { state: 'detached' });
  assert.equal((await jobsApi()).total, 6);
  assert.deepEqual(disk(wtC, 'Trajni izvoz.tab'), FIRST, 'brisanje posla je dirnulo fajl u WT folderu');
  assert.deepEqual(disk(wtD, 'Trajni izvoz.tab'), FIRST);
  console.log('brisanje: potvrda pominje izvoze i da WT folder ostaje netaknut; posao nestaje, fajlovi ostaju');

  // posao sa stanjem koje se ne može pročitati: poruka u prikazu posla, bez rušenja i bez tihog resetovanja
  await page.click(`tr[data-job-id="${idNew}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=state-error]');
  assert.match(await page.textContent('[data-testid=state-error]'), /novijom verzijom/);
  assert.equal(await page.$('[data-testid=export]'), null, 'neispravan posao može da se izveze');
  await page.waitForSelector('[data-testid=save-state][data-state=saved]');
  await page.click('[data-testid=close-job]');
  await page.waitForSelector('[data-testid=job-list]');
  {
    const check = new DatabaseSync(join(userData, 'csv2tab.db'), { readOnly: true });
    assert.equal(JSON.parse(check.prepare('SELECT state FROM jobs WHERE id = ?').get(Number(idNew)).state).version, 99, 'stanje je tiho promenjeno');
    check.close();
  }
  await page.click(`tr[data-job-id="${idNew}"] [data-testid=job-open]`);
  await page.click('[data-testid=delete-job]');
  await page.click('[data-testid=delete-confirm]');
  await page.waitForSelector('[data-testid=import]');
  assert.equal((await jobsApi()).total, 5);
  console.log('neispravno sačuvano stanje: poruka u prikazu posla, posao se ne menja ni ne izvozi, može da se obriše');

  // ---------- pamćenje, snimak podešavanja i rezervna kopija ----------
  const settingsTab = async (id) => {
    await nav('Podešavanja');
    await page.click(`[data-testid=settings-tab-${id}]`);
  };
  const screenshots = async (name) => {
    if (!process.env.CSV2TAB_SCREENSHOTS) return;
    mkdirSync(process.env.CSV2TAB_SCREENSHOTS, { recursive: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720));
    await page.waitForFunction(() => innerWidth === 1100 && innerHeight === 720);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => window.api.settings.set('theme', t), theme);
      await waitTheme(page, theme);
      await page.screenshot({ path: join(process.env.CSV2TAB_SCREENSHOTS, `${name}-${theme}.png`) });
    }
    await page.evaluate((t) => window.api.settings.set('theme', t), keep);
    await waitTheme(page, keep);
  };
  await page.evaluate(async () => {
    await window.api.memory.forget('material', null);
    await window.api.memory.forget('mapping', null);
  });
  const wtMemory = mkdtempSync(join(tmpdir(), 'csv2tab-wt-memory-'));
  const backupFolder = mkdtempSync(join(tmpdir(), 'csv2tab-backups-'));
  extraDirs.push(wtMemory, backupFolder);
  await chooseWtFolder(wtMemory);
  const copies = [2437, 2438, 2439].map((n) => {
    const path = join(srcDir, `Ponovljeni uvoz ${n}.csv`);
    writeFileSync(path, readFileSync(fixturePath(`${KASMIR}.csv`), 'utf8').replace('2436,0 mm', `${n},0 mm`));
    return path;
  });
  const rememberedFirst = await importFile(copies[0]);
  await waitSaved();
  await openTab('materials');
  await page.fill('[data-testid=wt-material]', 'U-702');
  await page.locator('.picker-list li').first().click();
  const bands = page.locator('[data-testid=materials-table] select');
  const bandCode = await bands.locator('option').nth(1).getAttribute('value');
  await bands.selectOption(bandCode);
  await page.getByRole('checkbox', { name: 'Prati teksturu: U702', exact: true }).check();
  await page.fill('[data-testid=file-name]', 'Samo ovaj posao');
  await waitSaved();
  await openTab('source');
  await page.locator('[data-testid=mapping] select').nth(4).selectOption('-1');
  await waitSaved();
  await openTab('parts');
  await page.click('[data-testid=export]');
  await waitBanner('ok');
  await waitSaved();
  assert.ok(existsSync(join(wtMemory, 'Samo ovaj posao.tab')));
  const rememberedSecond = await importFile(copies[1]);
  assert.notEqual(rememberedSecond, rememberedFirst);
  await waitSaved();
  const secondState = (await page.evaluate((id) => window.api.jobs.get(+id), rememberedSecond)).state;
  assert.deepEqual(secondState.materials.U702, { wt: 'U-702', band: bandCode, grain: 1, fromMemory: ['wt', 'band', 'grain'] });
  assert.equal(secondState.mapping.designation, -1);
  assert.equal(secondState.mappingFromMemory, true);
  await openTab('materials');
  assert.equal(await page.inputValue('[data-testid=file-name]'), '', 'ručno ime fajla je zapamćeno');
  assert.equal(await page.locator('[data-origin=memory]').count(), 3);
  const rememberedName = (await page.textContent('[data-testid=out-name]')).trim();
  assert.match(rememberedName, /^U-702 /);
  await screenshots('materijali');
  await openTab('source');
  await page.waitForSelector('[data-testid=mapping-memory]');
  await openTab('parts');
  await page.click('[data-testid=export]');
  await waitBanner('ok');
  await waitSaved();
  const oldBytes = disk(wtMemory, rememberedName);
  const oldJob = await page.evaluate((id) => window.api.jobs.get(+id), rememberedSecond);
  console.log('drugi različit fajl: WT materijal, traka, tekstura i mapiranje preuzeti bez ručnog izbora; ime fajla nije zapamćeno');

  await settingsTab('edge');
  const codes = page.locator('[data-testid=edge-rule] input[type=number]');
  for (let i = 0; i < await codes.count(); i++) {
    const value = +(await codes.nth(i).inputValue());
    await codes.nth(i).fill(String(value + 20));
    await page.waitForSelector('[data-testid=edge-saved][data-saved=true]');
  }
  await screenshots('kantovanje');
  await nav('Poslovi');
  await openTab('source');
  await page.waitForSelector('[data-testid=rules-differ]');
  await screenshots('izvor');
  await openTab('parts');
  await waitSaved();
  assert.deepEqual((await page.evaluate((id) => window.api.jobs.get(+id), rememberedSecond)).outputs, oldJob.outputs);
  await page.click('[data-testid=export]');
  await waitBanner('ok');
  assert.deepEqual(disk(wtMemory, rememberedName), oldBytes, 'podešavanja su promenila izlaz starog posla');
  await waitSaved();
  const newest = await importFile(copies[2]);
  await waitSaved();
  const newJob = await page.evaluate((id) => window.api.jobs.get(+id), newest);
  assert.notEqual(newJob.outputs[0].sha256, oldJob.outputs[0].sha256);
  assert.notDeepEqual(newJob.state.edgeRules, oldJob.state.edgeRules);
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=overwrite-confirm]');
  await page.click('[data-testid=overwrite-confirm]');
  await waitBanner('ok');
  assert.notDeepEqual(disk(wtMemory, rememberedName), oldBytes);
  await waitSaved();
  await toList();
  await page.click(`tr[data-job-id="${rememberedSecond}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=jobview]');
  await openTab('source');
  await page.click('[data-testid=rules-apply]');
  await page.waitForSelector('[data-testid=rules-same]');
  await waitSaved();
  assert.deepEqual((await page.evaluate((id) => window.api.jobs.get(+id), rememberedSecond)).state.edgeRules, newJob.state.edgeRules);
  console.log('promena pravila: stari izlaz je isti i ima napomenu; nov posao koristi nova pravila; akcija primene se automatski čuva');

  await settingsTab('memory');
  await page.waitForSelector('[data-testid=memory-materials] tbody tr');
  await page.waitForSelector('[data-testid=memory-mappings] tbody tr');
  await screenshots('pamcenje');
  await page.click('[data-testid=memory-forget-mapping]');
  await page.waitForSelector('[data-testid=memory-mappings-empty]');
  assert.equal((await page.evaluate(() => window.api.memory.list())).mappings.length, 0);
  await settingsTab('backup');
  await setEnv('CSV2TAB_TEST_FOLDER', backupFolder);
  await page.click('[data-testid=choose-backup-folder]');
  await page.waitForFunction((dir) => document.querySelector('[data-testid=backup-folder]')?.textContent === dir, basename(backupFolder));
  await page.click('[data-testid=backup-create]');
  await page.waitForSelector('[data-testid=backup-made]');
  assert.equal((await page.textContent('[data-testid=backup-made]')).includes(backupFolder), false);
  const backupName = await page.textContent('[data-testid=backup-made-name]');
  const backupPath = join(backupFolder, backupName);
  const beforeRestore = (await jobsApi()).total;
  {
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    assert.equal(backup.prepare('SELECT count(*) AS n FROM jobs').get().n, beforeRestore);
    backup.close();
  }
  await toList();
  await page.click(`tr[data-job-id="${newest}"] [data-testid=job-open]`);
  await page.waitForSelector('[data-testid=jobview]');
  await page.click('[data-testid=delete-job]');
  await page.click('[data-testid=delete-confirm]');
  await page.waitForSelector('[data-testid=import]');
  assert.equal((await jobsApi()).total, beforeRestore - 1);
  await settingsTab('backup');
  await setEnv('CSV2TAB_TEST_RESTORE', backupPath);
  await page.click('[data-testid=backup-restore]');
  await page.waitForSelector('[data-testid=restore-dialog]');
  assert.match(await page.textContent('[data-testid=restore-jobs]'), new RegExp(`: ${beforeRestore}$`));
  await screenshots('vracanje');
  await page.click('[data-testid=restore-cancel]');
  await page.waitForSelector('[data-testid=restore-dialog]', { state: 'detached' });
  assert.equal((await jobsApi()).total, beforeRestore - 1);
  await page.click('[data-testid=backup-restore]');
  await page.click('[data-testid=restore-confirm]');
  await page.waitForSelector('[data-testid=restore-done]');
  assert.ok(existsSync(join(userData, await page.textContent('[data-testid=restore-safety]'))));
  await page.click('[data-testid=restore-finish]');
  await page.waitForSelector('[data-testid=import]');
  assert.equal((await jobsApi()).total, beforeRestore);
  assert.ok(await page.evaluate((id) => window.api.jobs.get(+id), newest));
  await settingsTab('backup');
  assert.equal(await page.textContent('[data-testid=backup-folder]'), basename(backupFolder));
  console.log('rezervna kopija kroz interfejs: otvara se i ima poslove; odustajanje ostavlja bazu, vraćanje zamenjuje podatke i čuva prethodnu bazu');

  // ---------- meni, prečice, argumenti, jedna instanca i prozor ----------
  const menuClick = (id) => app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu().getMenuItemById(id);
    if (!item) throw new Error(`Nema stavke menija ${id}`);
    item.click();
  }, id);
  // CDP keyboard.press zaobilazi Electronove native akceleratore; sendInputEvent prolazi istim putem kao tastatura.
  const shortcut = async (key) => {
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win.isFocused()) {
        await new Promise((resolve, reject) => {
          const focused = () => { clearTimeout(timer); resolve(); };
          const timer = setTimeout(() => { win.removeListener('focus', focused); reject(new Error('Prozor nije dobio fokus.')); }, 30000);
          win.once('focus', focused);
          win.focus();
        });
      }
      win.webContents.focus();
    });
    await page.waitForFunction(() => document.hasFocus());
    await app.evaluate(({ BrowserWindow }, key) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] });
      contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] });
    }, key);
  };
  await menuClick('about');
  await page.waitForSelector('[data-testid=app-info]');
  await menuClick(`theme-${other}`);
  await waitTheme(page, other);
  await menuClick('settings');
  await page.waitForSelector(`input[name=theme][value=${other}]:checked`);
  await menuClick(`theme-${keep}`);
  await waitTheme(page, keep);
  const shortcuts = join(srcDir, 'Prečice.csv');
  writeFileSync(shortcuts, readFileSync(copies[0], 'utf8').replace('2437,0 mm', '2440,0 mm'));
  await setEnv('CSV2TAB_TEST_IMPORT', shortcuts);
  await shortcut('O');
  await page.waitForSelector('[data-testid=jobview][data-file="Prečice.csv"]');
  await waitSaved();
  const shortcutId = await jobId();
  const shortcutWt = mkdtempSync(join(tmpdir(), 'csv2tab-shortcuts-'));
  extraDirs.push(shortcutWt);
  await chooseWtFolder(shortcutWt);
  await nav('Poslovi');
  const shortQty = page.locator('tr[data-key] input[data-field=qty]').first();
  await shortQty.fill('8'); // prečica mora da prihvati i unos koji još nije potvrđen tasterom Enter
  await shortcut('S');
  await waitBanner('ok');
  await waitSaved();
  const shortcutJob = await page.evaluate((id) => window.api.jobs.get(+id), shortcutId);
  assert.ok(Object.values(shortcutJob.state.edits).some((edit) => edit.qty === 8));
  assert.ok(existsSync(join(shortcutWt, shortcutJob.outputs[0].name)));
  await shortcut('F');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'job-search');
  assert.equal(await page.$('[data-testid=jobview]'), null);
  console.log('meni i Ctrl+O / Ctrl+S / Ctrl+F: uvoz, izvoz sa potvrdom unosa, čuvanje i fokus pretrage rade');

  const argvFiles = ['Prvi argument.csv', 'Drugi argument.csv', 'Drugi proces.csv'].map((name, i) => {
    const file = join(srcDir, name);
    writeFileSync(file, readFileSync(copies[0], 'utf8').replace('2437,0 mm', `${2450 + i},0 mm`));
    return file;
  });
  const beforeArguments = (await jobsApi()).total;
  await app.close();
  app = await launch(argvFiles.slice(0, 2));
  page = await app.firstWindow();
  watch(page);
  await page.waitForSelector('[data-testid=jobview][data-file="Drugi argument.csv"]');
  await waitSaved();
  assert.equal((await jobsApi()).total, beforeArguments + 2);
  const secondInstance = (file) => new Promise((resolve, reject) => {
    // Playwright dodaje --no-sandbox prvoj instanci; ista testna zastavica je potrebna drugoj na CI runneru.
    const child = spawn(electron, [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, ...displayArgs, file], { cwd: srcDir, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Druga instanca nije izašla za 30 s.')); }, 30000);
    child.on('error', (e) => { clearTimeout(timeout); reject(e); });
    child.on('exit', (code, signal) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Druga instanca: exit ${code}, signal ${signal}\n${stderr}`)); });
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await secondInstance('Drugi proces.csv'); // relativna putanja razrešava se u folderu drugog procesa
  await page.waitForSelector('[data-testid=jobview][data-file="Drugi proces.csv"]');
  await waitSaved();
  assert.equal((await jobsApi()).total, beforeArguments + 3);
  assert.deepEqual(await app.evaluate(({ app, BrowserWindow }) => ({ locked: app.hasSingleInstanceLock(), windows: BrowserWindow.getAllWindows().length, minimized: BrowserWindow.getAllWindows()[0].isMinimized() })), { locked: true, windows: 1, minimized: false });
  await secondInstance('Prvi argument.csv');
  await page.waitForSelector('[data-testid=duplicate-dialog]');
  await page.click('[data-testid=duplicate-cancel]');
  await page.waitForSelector('[data-testid=duplicate-dialog]', { state: 'detached' });
  assert.equal((await jobsApi()).total, beforeArguments + 3);
  await waitSaved();
  const finalTotal = (await jobsApi()).total;
  const expectedBounds = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const current = win.getBounds();
    // Novi okvir ostaje unutar položaja koji je menadžer prozora već prihvatio: staje i na mali CI ekran, a menadžer
    // ga pri sledećem pokretanju ne pomera (npr. ispod panela). Vraćanje van ekrana već ima zasebne testove.
    win.setBounds({ x: current.x + 20, y: current.y + 20, width: Math.min(980, current.width - 40), height: Math.min(650, current.height - 40) });
    return win.getNormalBounds();
  });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  watch(page);
  await page.waitForSelector('[data-testid=import]');
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds()), expectedBounds);
  assert.equal((await jobsApi()).total, finalTotal);
  console.log('argumenti: dva fajla pri pokretanju, relativna putanja iz druge instance, fokus i duplikat; položaj i veličina preživljavaju restart');

  assert.deepEqual(problems, [], `CSP ili greške u konzoli: ${problems.join(' | ')}`);
  await app.close();
  {
    const db = new DatabaseSync(join(userData, 'csv2tab.db'), { readOnly: true });
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM job_parts WHERE job_id NOT IN (SELECT id FROM jobs)').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM exports WHERE job_id NOT IN (SELECT id FROM jobs)').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n, finalTotal);
    db.close();
  }

  console.log('SMOKE OK');
} catch (error) {
  const page = app.windows()[0];
  if (page && !page.isClosed()) {
    console.log('Stanje pri neuspehu:', await page.evaluate(() => ({ url: location.href, focus: document.hasFocus(), text: document.body.innerText.slice(-1800) })).catch(() => null));
    const folder = process.env.CSV2TAB_SCREENSHOTS || join(root, 'test-results');
    mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: join(folder, 'smoke-neuspeh.png'), scale: 'css' }).catch(() => {});
  }
  throw error;
} finally {
  await app.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
  for (const d of extraDirs) rmSync(d, { recursive: true, force: true });
}
