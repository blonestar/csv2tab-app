// Smoke test izgrađene aplikacije (Playwright _electron): prozor učitava app://csv2tab/, most radi, jezgro u
// rendereru daje iste bajtove za CSV, ODS i XLSX, a .tab round trip je bajt-identičan. Pokreće se posle `npm run build`.
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
const app = await _electron.launch({ executablePath: electron, args: [root, `--user-data-dir=${userData}`], env, timeout: 30000 });
try {
  const page = await app.firstWindow();
  await page.waitForURL('app://csv2tab/**', { timeout: 15000 });
  await page.waitForSelector('nav.sidebar');
  console.log('url:', page.url());

  // most: samo imenovane operacije
  const surface = await page.evaluate(() => ({
    api: Object.keys(window.api),
    node: typeof require + typeof process,
    ipc: typeof window.ipcRenderer,
  }));
  assert.deepEqual(surface, { api: ['app'], node: 'undefinedundefined', ipc: 'undefined' });
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
  console.log('SMOKE OK');
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
