// Stroga provera JobState-a i argumenata za posao koje šalje renderer.
import { describe, expect, it } from 'vitest';
import { writeWtTab } from '@core/wtTab';
import { JobStateError, STATE_LIMITS, parseJobState, parseJobStateJson, stringifyJobState } from '../src/shared/jobStateCheck';
import { jobFileArg, jobIdArg, jobListQueryArg, jobMetaArg, jobSaveArg, sha256Arg, exportItemsArg } from '../src/main/operations/validate';
import { DEFAULT_EDGE_RULES } from '@core/parts';
import { cloneEdgeRules } from '../src/shared/edgeRules';
import type { JobState } from '../src/shared/job';

const base = (): JobState => ({ version: 2, encoding: 'auto', delimiter: 'auto', sheet: 0, mapping: 'auto', merge: true, materials: {}, edits: {}, edgeRules: cloneEdgeRules(DEFAULT_EDGE_RULES), decorRule: true, mappingFromMemory: false });
const full = (): JobState => ({
  version: 2,
  encoding: 'windows-1250',
  delimiter: ';',
  sheet: 2,
  mapping: { material: 0, length: 1, width: 2, qty: 3, designation: -1, edgeL1: 4, edgeL2: 5, edgeW1: 6, edgeW2: 7 },
  merge: false,
  materials: { U702: { wt: 'U-702', band: 'ABS1', grain: 1, fileName: 'moj fajl', fromMemory: ['wt', 'grain'] }, '': { wt: null }, 'bez izbora': {} },
  edits: { 'U702#1,2': { dim1: 100, dim2: 4294967295, edge1: 255, edge2: 0, grain: 1, qty: 65535, name: 'Šuma Đurđa' } },
  edgeRules: [{ a: 0, b: 0, code: 0 }, { a: 0.5, b: 2, code: 7 }],
  decorRule: false,
  mappingFromMemory: true,
});
const bad = (v: unknown, re?: RegExp) => {
  const run = () => parseJobState(v);
  expect(run).toThrow(JobStateError);
  if (re) expect(run).toThrow(re);
};
const mut = (f: (s: Record<string, unknown>) => void): unknown => {
  const s = JSON.parse(JSON.stringify(full())) as Record<string, unknown>;
  f(s);
  return s;
};

describe('parseJobState', () => {
  it('prihvata prazno i puno stanje i vraća jednaku kopiju', () => {
    expect(parseJobState(base())).toEqual(base());
    const f = full();
    const out = parseJobState(f);
    expect(out).toEqual(f);
    expect(out).not.toBe(f);
    expect(out.materials).not.toBe(f.materials);
  });
  it('JSON round trip: stringify pa parse daje isto', () => {
    expect(parseJobStateJson(stringifyJobState(full()))).toEqual(full());
  });
  it('odbija ono što nije objekat', () => {
    for (const v of [null, undefined, 1, 'x', [], [base()], true]) bad(v);
  });
  it('nepoznata verzija: novija ima posebnu poruku', () => {
    bad(mut((s) => { s.version = 3; }), /novijom verzijom/);
    bad(mut((s) => { s.version = 0; }), /nepoznatu verziju/);
    bad(mut((s) => { delete s.version; }), /nepoznatu verziju/);
    bad(mut((s) => { s.version = '1'; }), /nepoznatu verziju/);
  });
  it('odbija nepoznata polja na svakom nivou', () => {
    bad(mut((s) => { s.extra = 1; }), /extra/);
    bad(mut((s) => { (s.materials as Record<string, Record<string, unknown>>).U702.boja = 'x'; }), /boja/);
    bad(mut((s) => { ((s.edits as Record<string, Record<string, unknown>>)['U702#1,2']).color = 1; }), /color/);
    bad(mut((s) => { (s.mapping as Record<string, number>).nepoznato = 1; }), /nepoznato/);
  });
  it('odbija pogrešne tipove i vrednosti van opsega', () => {
    const cases: [string, (s: Record<string, unknown>) => void][] = [
      ['encoding', (s) => { s.encoding = 'utf-16'; }],
      ['encoding', (s) => { s.encoding = 1; }],
      ['delimiter', (s) => { s.delimiter = 'x'; }],
      ['delimiter', (s) => { s.delimiter = ';;'; }],
      ['sheet', (s) => { s.sheet = -1; }],
      ['sheet', (s) => { s.sheet = 1.5; }],
      ['sheet', (s) => { s.sheet = '0'; }],
      ['sheet', (s) => { s.sheet = STATE_LIMITS.sheet + 1; }],
      ['merge', (s) => { s.merge = 'da'; }],
      ['merge', (s) => { s.merge = 1; }],
      ['mapping', (s) => { s.mapping = 'manual'; }],
      ['mapping', (s) => { s.mapping = null; }],
      ['mapping.qty', (s) => { (s.mapping as Record<string, unknown>).qty = '3'; }],
      ['mapping.qty', (s) => { (s.mapping as Record<string, unknown>).qty = -2; }],
      ['mapping.width', (s) => { delete (s.mapping as Record<string, unknown>).width; }],
      ['edgeRules', (s) => { s.edgeRules = []; }],
      ['edgeRules', (s) => { s.edgeRules = 'x'; }],
      ['edgeRules', (s) => { (s.edgeRules as unknown[]).push({ a: 2, b: 0.5, code: 8 }); }],
      ['edgeRules', (s) => { (s.edgeRules as unknown[]).push({ a: 1, b: 1, code: 256 }); }],
      ['edgeRules', (s) => { (s.edgeRules as unknown[]).push({ a: 1, b: 1, code: 8, extra: 1 }); }],
      ['decorRule', (s) => { s.decorRule = 1; }],
      ['decorRule', (s) => { delete s.decorRule; }],
      ['mappingFromMemory', (s) => { s.mappingFromMemory = 'da'; }],
      ['mappingFromMemory', (s) => { s.mapping = 'auto'; }],
      ['materials.fromMemory', (s) => { (s.materials as Record<string, Record<string, unknown>>).U702.fromMemory = []; }],
      ['materials.fromMemory', (s) => { (s.materials as Record<string, Record<string, unknown>>).U702.fromMemory = ['fileName']; }],
      ['materials.fromMemory', (s) => { (s.materials as Record<string, Record<string, unknown>>).U702.fromMemory = ['wt', 'wt']; }],
      ['materials.fromMemory', (s) => { delete (s.materials as Record<string, Record<string, unknown>>).U702.band; (s.materials as Record<string, Record<string, unknown>>).U702.fromMemory = ['band']; }],
      ['materials', (s) => { s.materials = []; }],
      ['materials', (s) => { s.materials = null; }],
      ['materials.wt', (s) => { (s.materials as Record<string, Record<string, unknown>>).U702.wt = 5; }],
      ['materials.grain', (s) => { (s.materials as Record<string, Record<string, unknown>>).U702.grain = 2; }],
      ['materials.band', (s) => { (s.materials as Record<string, Record<string, unknown>>).U702.band = null; }],
      ['materials.fileName', (s) => { (s.materials as Record<string, Record<string, unknown>>).U702.fileName = 'x'.repeat(STATE_LIMITS.text + 1); }],
      ['materials', (s) => { (s.materials as Record<string, unknown>).U702 = 'U-702'; }],
      ['edits', (s) => { s.edits = []; }],
      ['edits.dim1', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].dim1 = -1; }],
      ['edits.dim1', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].dim1 = 4294967296; }],
      ['edits.dim2', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].dim2 = 1.5; }],
      ['edits.edge1', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].edge1 = 256; }],
      ['edits.grain', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].grain = 2; }],
      ['edits.qty', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].qty = 65536; }],
      ['edits.qty', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].qty = Number.NaN; }],
      ['edits.name', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].name = 'x'.repeat(26); }],
      ['edits.name', (s) => { (s.edits as Record<string, Record<string, unknown>>)['U702#1,2'].name = 5; }],
    ];
    for (const [where, f] of cases) {
      const v = mut(f);
      expect(() => parseJobState(v), where).toThrow(JobStateError);
      expect(() => parseJobState(v), where).toThrow(new RegExp(where.replace('.', '\\.')));
    }
  });
  it('besmislene veličine se odbijaju', () => {
    bad(mut((s) => { s.materials = Object.fromEntries(Array.from({ length: STATE_LIMITS.materials + 1 }, (_, i) => [`m${i}`, {}])); }), /previše materijala/);
    bad(mut((s) => { s.materials = { ['x'.repeat(STATE_LIMITS.text + 1)]: {} }; }), /predugačak/);
    bad(mut((s) => { s.edits = { ['k'.repeat(STATE_LIMITS.editKey + 1)]: {} }; }), /predugačak/);
    const huge = JSON.stringify({ ...base(), materials: { a: { fileName: 'x'.repeat(10) } }, pad: 'p'.repeat(STATE_LIMITS.json) });
    expect(() => parseJobStateJson(huge)).toThrow(/neočekivano veliko/);
  });
  it('JSON koji nije ispravan ili je oštećen daje poruku, ne izuzetak drugog tipa', () => {
    for (const t of ['', '{', 'nije json', 'null', '[]']) expect(() => parseJobStateJson(t)).toThrow(JobStateError);
  });
  it('ključ "__proto__" je običan ključ i ne menja prototip', () => {
    const json = JSON.stringify({ ...base() }).replace('"materials":{}', '"materials":{"__proto__":{"wt":"X"}}').replace('"edits":{}', '"edits":{"__proto__":{"qty":3}}');
    const s = parseJobStateJson(json);
    expect(Object.hasOwn(s.materials, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(s.materials)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).wt).toBeUndefined();
    expect(Object.hasOwn(s.edits, '__proto__')).toBe(true);
    expect(JSON.parse(stringifyJobState(s)).materials).toEqual(JSON.parse(json).materials);
  });
});

describe('argumenti za posao (granica glavnog procesa)', () => {
  const part = { material: 'U702', wt: 'U-702', dim1: 1000, dim2: 300, edge1: 0, edge2: 0, grain: 0, qty: 1, name: 'a' };
  const tab = (n: number) => writeWtTab(Array.from({ length: n }, () => ({ dim1: 1, dim2: 1, edge1: 0, edge2: 0, grain: 0, qty: 1, name: 'x' })));
  const out = { material: 'U702', name: 'U702.tab', count: 2, bytes: tab(2) };
  const ok = () => ({ state: base(), parts: [part], outputs: [out] });

  it('ispravno čuvanje prolazi', () => {
    const v = jobSaveArg(ok());
    expect(v.parts).toEqual([part]);
    expect(v.outputs[0].count).toBe(2);
    expect(jobSaveArg({ state: base(), parts: [], outputs: [] }).parts).toEqual([]);
  });
  it('odbija neispravno stanje, zapise i izlazne fajlove', () => {
    const cases: unknown[] = [
      null,
      { ...ok(), state: { ...base(), version: 3 } },
      { ...ok(), parts: 'x' },
      { ...ok(), parts: [{ ...part, dim1: -1 }] },
      { ...ok(), parts: [{ ...part, dim1: 2 ** 32 }] },
      { ...ok(), parts: [{ ...part, edge1: 256 }] },
      { ...ok(), parts: [{ ...part, grain: 2 }] },
      { ...ok(), parts: [{ ...part, qty: 65536 }] },
      { ...ok(), parts: [{ ...part, qty: 1.5 }] },
      { ...ok(), parts: [{ ...part, name: 'x'.repeat(26) }] },
      { ...ok(), parts: [{ ...part, material: 'x'.repeat(301) }] },
      { ...ok(), parts: [{ ...part, wt: 3 }] },
      { ...ok(), parts: [{ ...part, material: undefined }] },
      { ...ok(), outputs: [{ ...out, name: 'bez-ekstenzije' }] },
      { ...ok(), outputs: [{ ...out, count: 3 }] }, // veličina ne odgovara broju zapisa
      { ...ok(), outputs: [{ ...out, count: -1 }] },
      { ...ok(), outputs: [{ ...out, bytes: 'tekst' }] },
      { ...ok(), outputs: [{ ...out, bytes: new Uint8Array(10) }] },
      { ...ok(), outputs: Array.from({ length: 101 }, () => out) },
    ];
    for (const [i, c] of cases.entries()) expect(() => jobSaveArg(c), `slučaj ${i}`).toThrow();
  });
  it('previše zapisa se odbija', () => {
    expect(() => jobSaveArg({ ...ok(), parts: Array.from({ length: 300_001 }, () => part) })).toThrow(/zapisa/);
  });
  it('izvorni fajl: tip mora da odgovara imenu, veličina je ograničena', () => {
    expect(jobFileArg({ name: 'a.csv', kind: 'csv', bytes: new Uint8Array(3) }).kind).toBe('csv');
    expect(jobFileArg({ name: 'a.TXT', kind: 'csv', bytes: Buffer.from('ab') }).bytes.length).toBe(2);
    for (const v of [
      { name: 'a.csv', kind: 'xlsx', bytes: new Uint8Array(3) },
      { name: 'a.png', kind: 'csv', bytes: new Uint8Array(3) },
      { name: '', kind: 'csv', bytes: new Uint8Array(3) },
      { name: 'a.csv', kind: 'csv', bytes: 'abc' },
      { name: 'a.csv', kind: 'csv', bytes: new Uint8Array(50 * 1024 * 1024 + 1) },
      { name: 'x'.repeat(301) + '.csv', kind: 'csv', bytes: new Uint8Array(1) },
      null,
    ]) expect(() => jobFileArg(v)).toThrow();
  });
  it('id, SHA-256, lista i izmena imena', () => {
    expect(jobIdArg(5)).toBe(5);
    for (const v of [0, -1, 1.5, '1', null, NaN, Infinity, 2 ** 60]) expect(() => jobIdArg(v)).toThrow();
    expect(sha256Arg('a'.repeat(64))).toBe('a'.repeat(64));
    for (const v of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), 5]) expect(() => sha256Arg(v)).toThrow();
    expect(jobListQueryArg({ text: 'x', offset: 0, limit: 50 })).toEqual({ text: 'x', offset: 0, limit: 50 });
    for (const v of [{ text: 'x', offset: -1, limit: 50 }, { text: 'x', offset: 0, limit: 0 }, { text: 'x', offset: 0, limit: 201 }, { text: 'x'.repeat(201), offset: 0, limit: 5 }, { text: 5, offset: 0, limit: 5 }, null]) {
      expect(() => jobListQueryArg(v)).toThrow();
    }
    expect(jobMetaArg({ name: '  Novo  ' })).toEqual({ name: 'Novo' });
    expect(jobMetaArg({ note: '' })).toEqual({ note: '' });
    for (const v of [{}, { name: '   ' }, { name: 'x'.repeat(201) }, { note: 'x'.repeat(2001) }, { ime: 'x' }, { name: 5 }, null]) expect(() => jobMetaArg(v)).toThrow();
  });
  it('stavka izvoza uz posao: materijal se proverava', () => {
    const items = exportItemsArg([{ name: 'a.tab', bytes: tab(1), material: 'U702' }]);
    expect(items[0].material).toBe('U702');
    expect(exportItemsArg([{ name: 'a.tab', bytes: tab(1) }])[0].material).toBeUndefined();
    expect(() => exportItemsArg([{ name: 'a.tab', bytes: tab(1), material: 5 }])).toThrow();
  });
});
