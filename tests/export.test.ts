// Provera i atomičan upis u WT folder (Node, privremeni folderi) i provera argumenata operacija.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeWtTab } from '@core/wtTab';
import { checkExport, writeExport } from '../src/main/export';
import { TEST_ENV, testOverride } from '../src/main/testHooks';
import { bytesArg, comparePayloadArg, compareIdArg, exportItemsArg, overwriteArg } from '../src/main/operations/validate';
import { isFolderSetting, isSettingKey, checkSetting } from '../src/shared/settings';

const part = (n: number) => ({ dim1: 100 + n, dim2: 50, edge1: 1, edge2: 2, grain: 0, qty: 1, name: `D${n}` });
const tab = (n = 2) => writeWtTab(Array.from({ length: n }, (_, i) => part(i)));
const fixture = (n: string) => new Uint8Array(readFileSync(resolve(__dirname, '../web/tests/fixtures', n)));

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'csv2tab-export-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('export.check / export.write', () => {
  it('novi fajl se upisuje bez pitanja, bez privremenih ostataka', async () => {
    const items = [{ name: 'A 18 mm', bytes: tab() }];
    const c = await checkExport(dir, items);
    expect(c).toMatchObject({ ok: true, items: [{ name: 'A 18 mm.tab', status: 'new', existing: null }] });
    const w = await writeExport(dir, items, []);
    expect(w).toMatchObject({ ok: true, items: [{ name: 'A 18 mm.tab', status: 'written' }] });
    expect(readdirSync(dir)).toEqual(['A 18 mm.tab']);
    expect(Buffer.from(readFileSync(join(dir, 'A 18 mm.tab'))).equals(Buffer.from(items[0].bytes))).toBe(true);
  });
  it('isti fajl je "identical" i ne dira se', async () => {
    writeFileSync(join(dir, 'a.tab'), tab());
    const c = await checkExport(dir, [{ name: 'a', bytes: tab() }]);
    expect(c).toMatchObject({ ok: true, items: [{ status: 'identical' }] });
    expect(await writeExport(dir, [{ name: 'a', bytes: tab() }], [])).toMatchObject({ items: [{ status: 'identical' }] });
  });
  it('različit fajl: provera vraća njegove bajtove; bez potvrde se ne prepisuje', async () => {
    const old = tab(3);
    writeFileSync(join(dir, 'a.tab'), old);
    const items = [{ name: 'a', bytes: tab(2) }];
    const c = await checkExport(dir, items);
    expect(c.ok && c.items[0].status).toBe('differs');
    expect(c.ok && Buffer.from(c.items[0].existing!).equals(Buffer.from(old))).toBe(true);
    const w = await writeExport(dir, items, []);
    expect(w).toMatchObject({ ok: true, items: [{ status: 'skipped' }] });
    expect(Buffer.from(readFileSync(join(dir, 'a.tab'))).equals(Buffer.from(old))).toBe(true);
    // potvrda po konačnom imenu (i kad je poslata bez ekstenzije)
    const w2 = await writeExport(dir, items, [exportName('a')]);
    expect(w2).toMatchObject({ items: [{ status: 'written' }] });
    expect(Buffer.from(readFileSync(join(dir, 'a.tab'))).equals(Buffer.from(items[0].bytes))).toBe(true);
    expect(readdirSync(dir)).toEqual(['a.tab']);
  });
  it('ručno pravljen referentni .tab naspram izvoza se prepoznaje kao različit', async () => {
    writeFileSync(join(dir, 'Kronospan Kasmir.tab'), fixture('Kronospan Kasmir.tab'));
    const c = await checkExport(dir, [{ name: 'Kronospan Kasmir', bytes: tab() }]);
    expect(c.ok && c.items[0].status).toBe('differs');
  });
  it('ime sa putanjom ostaje u folderu', async () => {
    await writeExport(dir, [{ name: '../../izlaz', bytes: tab() }], []);
    expect(readdirSync(dir)).toEqual(['izlaz.tab']);
  });
  it('dva imena koja se svode na isto (i po veličini slova) se odbijaju', async () => {
    await expect(checkExport(dir, [{ name: 'a', bytes: tab() }, { name: 'A.tab', bytes: tab() }])).rejects.toThrow(/isto ime/);
  });
  it('folder nije zadat ili ne postoji: jasna poruka, ništa se ne upisuje', async () => {
    expect(await checkExport('', [{ name: 'a', bytes: tab() }])).toMatchObject({ ok: false, reason: 'no-folder' });
    const gone = join(dir, 'nema');
    expect(await writeExport(gone, [{ name: 'a', bytes: tab() }], [])).toMatchObject({ ok: false, reason: 'folder-missing' });
    // fajl umesto foldera
    writeFileSync(join(dir, 'f'), 'x');
    expect(await checkExport(join(dir, 'f'), [{ name: 'a', bytes: tab() }])).toMatchObject({ ok: false, reason: 'folder-missing' });
  });
  it('odredište koje je folder daje grešku za tu stavku, ostale se upisuju', async () => {
    mkdirSync(join(dir, 'a.tab'));
    const w = await writeExport(dir, [{ name: 'a', bytes: tab() }, { name: 'b', bytes: tab() }], ['a']);
    expect(w).toMatchObject({ ok: true, items: [{ name: 'a.tab', status: 'error' }, { name: 'b.tab', status: 'written' }] });
    expect(readdirSync(dir).sort()).toEqual(['a.tab', 'b.tab']);
  });
});
const exportName = (n: string) => `${n}.tab`;

describe('provera argumenata', () => {
  it('lista fajlova: oblik, veličina, tip i sadržaj', () => {
    expect(exportItemsArg([{ name: 'a', bytes: tab() }])).toHaveLength(1);
    expect(exportItemsArg([{ name: 'a', bytes: Buffer.from(tab()) }])[0].bytes).toBeInstanceOf(Uint8Array);
    expect(exportItemsArg([{ name: 'a', bytes: tab().buffer }])).toHaveLength(1);
    for (const bad of [
      undefined, null, 'x', [], {}, Array(101).fill({ name: 'a', bytes: tab() }),
      [{ name: 'a' }], [{ bytes: tab() }], [{ name: '', bytes: tab() }], [{ name: 5, bytes: tab() }],
      [{ name: 'a'.repeat(301), bytes: tab() }],
      [{ name: 'a', bytes: 'abc' }], [{ name: 'a', bytes: [1, 2, 3] }], [{ name: 'a', bytes: new Uint8Array(10) }],
      [{ name: 'a', bytes: new Uint8Array(7_000_000) }],
      [null],
    ]) expect(() => exportItemsArg(bad), JSON.stringify(bad)?.slice(0, 40)).toThrow();
    // zaglavlje kaže 3 zapisa, a ima ih 2
    const cut = tab(3).slice(0, tab(3).length - 79);
    expect(() => exportItemsArg([{ name: 'a', bytes: cut }])).toThrow(/zapisa/);
  });
  it('bajtovi: Uint8Array, Buffer i ArrayBuffer da; ostalo ne', () => {
    expect(bytesArg(new Uint8Array(3), 'x')).toHaveLength(3);
    expect(bytesArg(new ArrayBuffer(4), 'x')).toHaveLength(4);
    for (const bad of [null, 'abc', 1, [1], {}, undefined]) expect(() => bytesArg(bad, 'x')).toThrow();
  });
  it('spisak za prepisivanje se svodi na konačna imena', () => {
    expect(overwriteArg(['a', '../b.tab'])).toEqual(['a.tab', 'b.tab']);
    for (const bad of [null, 'a', [1], Array(101).fill('a')]) expect(() => overwriteArg(bad)).toThrow();
  });
  it('podaci za poređenje', () => {
    const ok = { aName: 'A', bName: 'B', a: [part(1)], b: [] };
    expect(comparePayloadArg(ok)).toEqual(ok);
    // dodatna polja se odbacuju
    expect(Object.keys(comparePayloadArg({ ...ok, a: [{ ...part(1), key: 'x', issues: [] }] }).a[0]).sort()).toEqual(['dim1', 'dim2', 'edge1', 'edge2', 'grain', 'name', 'qty']);
    for (const bad of [
      null, [], { ...ok, aName: 1 }, { ...ok, a: 'x' }, { ...ok, a: [{ ...part(1), qty: 70000 }] }, { ...ok, a: [{ ...part(1), dim1: -1 }] },
      { ...ok, a: [{ ...part(1), dim1: 1.5 }] }, { ...ok, b: [{ ...part(1), name: 'x'.repeat(26) }] }, { ...ok, b: [{ ...part(1), edge1: 256 }] },
      { ...ok, a: Array(65536).fill(part(1)) },
    ]) expect(() => comparePayloadArg(bad)).toThrow();
  });
  it('id prozora poređenja', () => {
    expect(compareIdArg('123e4567-e89b-42d3-a456-426614174000')).toBeTruthy();
    for (const bad of ['', 'x', 5, null, '../../x', '123e4567-e89b-42d3-a456-42661417400g']) expect(() => compareIdArg(bad)).toThrow();
  });
});

describe('WT folder se ne zadaje iz renderera', () => {
  it('wtFolder je folder-podešavanje, theme nije', () => {
    expect(isSettingKey('wtFolder')).toBe(true);
    expect(isFolderSetting('wtFolder')).toBe(true);
    expect(isFolderSetting('theme')).toBe(false);
    expect(checkSetting('wtFolder', '/x')).toBe('/x');
    expect(() => checkSetting('wtFolder', 5)).toThrow();
  });
});

describe('zaobilaženje dijaloga u testu', () => {
  const env = { [TEST_ENV.import]: '/tmp/a.csv', [TEST_ENV.folder]: '/tmp/wt' };
  it('važi samo u test režimu i nikad u spakovanoj aplikaciji', () => {
    expect(testOverride(TEST_ENV.import, { env, testMode: true, packaged: false })).toBe('/tmp/a.csv');
    expect(testOverride(TEST_ENV.import, { env, testMode: false, packaged: false })).toBeUndefined();
    expect(testOverride(TEST_ENV.import, { env, testMode: true, packaged: true })).toBeUndefined();
    expect(testOverride(TEST_ENV.compare, { env, testMode: true, packaged: false })).toBeUndefined();
    expect(testOverride(TEST_ENV.folder, { env: { [TEST_ENV.folder]: '' }, testMode: true, packaged: false })).toBeUndefined();
  });
});
