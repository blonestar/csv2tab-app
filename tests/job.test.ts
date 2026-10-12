// @vitest-environment jsdom
// Izvođenje stanja posla: JSON-serijalizovan state daje iste bajtove, izmene se primenjuju, promena mapiranja ih odbacuje.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WtCatalog } from '@core/catalog';
import { readWtTab } from '@core/wtTab';
import catalogJson from '../web/src/data/wt-catalog.json';
import { convertToTab } from '../src/renderer/coreCheck';
import { newJobState } from '../src/renderer/job/defaults';
import { deriveJob, exportFiles, type DeriveCache, type SourceFile } from '../src/renderer/job/derive';
import {
  choiceOf,
  parseEditValue,
  withAutoMapping,
  withChoice,
  withEdit,
  withEncoding,
  withMappingField,
  withMerge,
  withSheet,
  withSwap,
  withoutEdit,
} from '../src/renderer/job/state';
import type { JobState } from '../src/shared/job';

const catalog = catalogJson as unknown as WtCatalog;
const fx = (n: string) => new Uint8Array(readFileSync(resolve(__dirname, '../web/tests/fixtures', n)));
const file = (name: string, kind: SourceFile['kind']): SourceFile => ({ name, kind, bytes: fx(name) });
const kasmir = () => file('Kasmir Kronospan 012-010.csv', 'csv');
const derive = (f: SourceFile, s: JobState, cache?: DeriveCache) => deriveJob(f, s, catalog, cache);
const bytesOf = (f: SourceFile, s: JobState) => exportFiles(derive(f, s)).map((x) => [x.name, Buffer.from(x.bytes).toString('hex')]);
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('deriveJob: Kašmir CSV', () => {
  it('14 zapisa, jedan materijal U702, bajtovi kao jezgro', () => {
    const d = derive(kasmir(), newJobState());
    expect(d.records).toHaveLength(14);
    expect(d.materials.map((m) => m.source)).toEqual(['U702']);
    expect(d.materials[0].wt?.code).toBe('U-702');
    expect(d.materials[0].fileName).toBe('U-702 18 mm.tab');
    expect(d.source.encoding?.used).toBe('utf-8');
    expect(d.source.delimiter?.used).toBe(';');
    const out = exportFiles(d);
    expect(out).toHaveLength(1);
    expect(Buffer.from(out[0].bytes).equals(Buffer.from(convertToTab(kasmir().bytes, 'csv')))).toBe(true);
  });
  it('ODS i XLSX daju iste zapise', () => {
    // u ODS / XLSX fajlovima je materijal "012-010" (kao u core.test.ts), pa se vlakno zadaje ručno
    const plain = (f: SourceFile) => {
      const m = derive(f, newJobState()).materials[0].source;
      return bytesOf(f, withChoice(newJobState(), m, { grain: 0 }))[0][1];
    };
    const csv = plain(kasmir());
    expect(plain(file('Kasmir Kronospan 012-010.ods', 'ods'))).toBe(csv);
    expect(plain(file('Kasmir Kronospan 012-010.xlsx', 'xlsx'))).toBe(csv);
  });
  it('Stone oak: 40 zapisa', () => {
    expect(derive(file('Stone oak Kronospan.csv', 'csv'), newJobState()).records).toHaveLength(40);
  });
});

describe('state je običan JSON', () => {
  it('preživljava JSON.parse(JSON.stringify()) i daje iste bajtove', () => {
    const f = kasmir();
    const d0 = derive(f, newJobState());
    let s = newJobState();
    s = withEdit(s, d0.records[2].base, 'qty', 7);
    s = withSwap(s, d0.records[0].base, d0.records[0].rec);
    s = withChoice(s, 'U702', { band: 'MEL', fileName: 'Moj fajl', grain: 1 });
    const copy = json(s);
    expect(copy).toEqual(s);
    expect(bytesOf(f, copy)).toEqual(bytesOf(f, s));
    expect(bytesOf(f, s)).not.toEqual(bytesOf(f, newJobState()));
  });
  it('nema Map, Set ni Uint8Array', () => {
    const s = withEdit(newJobState(), derive(kasmir(), newJobState()).records[0].base, 'qty', 9);
    const bad: string[] = [];
    (function walk(v: unknown, path: string) {
      if (v && typeof v === 'object') {
        if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) bad.push(path);
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      }
    })(s, 'state');
    expect(bad).toEqual([]);
  });
});

describe('ručne izmene', () => {
  it('izmena se primenjuje, označava i upisuje u .tab', () => {
    const f = kasmir();
    const d0 = derive(f, newJobState());
    const s = withEdit(newJobState(), d0.records[1].base, 'dim1', 2423);
    const d = derive(f, s);
    expect(d.records[1].rec.dim1).toBe(2423);
    expect(d.records[1].edited).toEqual(['dim1']);
    expect(d.records[1].base.dim1).toBe(d0.records[1].base.dim1);
    const tab = readWtTab(exportFiles(d)[0].bytes);
    expect(tab.parts[1].dim1).toBe(2423);
  });
  it('izmena jednaka izračunatoj vrednosti se briše; poništavanje po zapisu', () => {
    const d0 = derive(kasmir(), newJobState());
    const b = d0.records[0].base;
    let s = withEdit(newJobState(), b, 'qty', b.qty + 1);
    expect(Object.keys(s.edits)).toEqual([b.key]);
    s = withEdit(s, b, 'qty', b.qty);
    expect(s.edits).toEqual({});
    s = withoutEdit(withEdit(s, b, 'name', 'X'), b.key);
    expect(s.edits).toEqual({});
  });
  it('zamena dimenzija menja dim1/dim2/edge1/edge2, ne vlakno', () => {
    const f = kasmir();
    const d0 = derive(f, newJobState());
    const { base, rec } = d0.records[0];
    const d = derive(f, withSwap(newJobState(), base, rec));
    const r = d.records[0].rec;
    expect([r.dim1, r.dim2, r.edge1, r.edge2, r.grain]).toEqual([base.dim2, base.dim1, base.edge2, base.edge1, base.grain]);
    expect(d.records[0].edited.every((x) => x !== 'grain')).toBe(true);
    // dvostruka zamena vraća izmene na ništa
    const back = withSwap(withSwap(newJobState(), base, rec), base, r);
    expect(back.edits).toEqual({});
  });
  it('provera vrednosti polja', () => {
    expect(parseEditValue('qty', '70000')).toBeNull();
    expect(parseEditValue('qty', '')).toBeNull();
    expect(parseEditValue('edge1', '5')).toBe(5);
    expect(parseEditValue('dim1', -1)).toBeNull();
    expect(parseEditValue('name', 'a'.repeat(40))).toBe('a'.repeat(25));
  });
  it('izmene koje ne odgovaraju zapisu se prijavljuju kao zaostale', () => {
    const d = derive(kasmir(), { ...newJobState(), edits: { 'U702#999': { qty: 3 } } });
    expect(d.orphanEdits).toEqual(['U702#999']);
    expect(d.records.every((r) => r.edited.length === 0)).toBe(true);
  });
});

describe('promena izvora odbacuje izmene', () => {
  const edited = () => {
    const d0 = derive(kasmir(), newJobState());
    return withEdit(newJobState(), d0.records[0].base, 'qty', 5);
  };
  it('mapiranje, spajanje, kodiranje i list brišu izmene; izbor materijala ne', () => {
    const s = edited();
    const d = derive(kasmir(), s);
    expect(Object.keys(s.edits)).toHaveLength(1);
    expect(withMappingField(s, d.mapping!, 'qty', -1).edits).toEqual({});
    expect(withAutoMapping(s).edits).toEqual({});
    expect(withMerge(s, false).edits).toEqual({});
    expect(withEncoding(s, 'windows-1250').edits).toEqual({});
    expect(withSheet(s, 1).edits).toEqual({});
    expect(Object.keys(withChoice(s, 'U702', { band: 'MEL' }).edits)).toHaveLength(1);
  });
  it('izmenjeno mapiranje menja zapise (bez kolone količine svi imaju kom = 1)', () => {
    const f = kasmir();
    const d = derive(f, newJobState());
    const s = withMerge(withMappingField(newJobState(), d.mapping!, 'qty', -1), false);
    const d2 = derive(f, s);
    expect(d2.mapping!.qty).toBe(-1);
    expect(d2.records.every((r) => r.rec.qty === 1)).toBe(true);
    expect(d2.records).toHaveLength(18);
  });
  it('nedostajuća obavezna kolona daje grešku i ništa za izvoz', () => {
    const f = kasmir();
    const d = derive(f, newJobState());
    const d2 = derive(f, withMappingField(newJobState(), d.mapping!, 'length', -1));
    expect(d2.missing).toEqual(['length']);
    expect(d2.canExport).toBe(false);
    expect(d2.issues.some((i) => i.level === 'error')).toBe(true);
  });
  it('spajanje isključeno daje 18 zapisa', () => {
    expect(derive(kasmir(), withMerge(newJobState(), false)).records).toHaveLength(18);
  });
});

describe('materijali', () => {
  it('izbor WT materijala određuje ime i vlakno; null isključuje predlog', () => {
    const f = file('Stone oak Kronospan.csv', 'csv');
    const d0 = derive(f, newJobState());
    expect(d0.materials[0].source).toBe('Drvo_dezen');
    const wt = catalog.materials.find((m) => m.grain === 1)!;
    const d = derive(f, withChoice(newJobState(), 'Drvo_dezen', { wt: wt.code, band: catalog.edgeBands[0].code }));
    expect(d.materials[0].wt?.code).toBe(wt.code);
    expect(d.materials[0].grain).toBe(1);
    expect(d.materials[0].fileName).toBe(`${wt.code} ${String(wt.thickness).replace('.', ',')} mm ${catalog.edgeBands[0].code}.tab`);
    const none = derive(kasmir(), withChoice(newJobState(), 'U702', { wt: null }));
    expect(none.materials[0].wt).toBeUndefined();
    expect(none.materials[0].fileName).toBe('U702.tab');
    expect(choiceOf(withChoice(newJobState(), 'U702', { wt: null }), 'U702').wt).toBeNull();
  });
  it('smer vlakna po materijalu menja zapise; ručni ima prednost nad katalogom', () => {
    const f = kasmir();
    expect(derive(f, newJobState()).records.every((r) => r.rec.grain === 0)).toBe(true);
    const d = derive(f, withChoice(newJobState(), 'U702', { grain: 1 }));
    expect(d.records.every((r) => r.rec.grain === 1)).toBe(true);
    expect(d.materials[0].grainFrom).toBe('manual');
  });
  it('ime fajla: ručno ime se čisti, a dva ista imena dobijaju sufiks', () => {
    const f = file('Stone oak Kronospan.csv', 'csv');
    const d = derive(f, withChoice(newJobState(), 'Drvo_dezen', { fileName: 'a/b:c.tab' }));
    expect(d.materials[0].fileName).toBe('a_b_c.tab');
  });
  it('naziv materijala "__proto__" ne kvari stanje', () => {
    const s = withChoice(newJobState(), '__proto__', { band: 'X' });
    expect(Object.getPrototypeOf(s.materials)).toBe(Object.prototype);
    expect(choiceOf(json(s), '__proto__').band).toBe('X');
    expect(choiceOf(newJobState(), '__proto__')).toEqual({});
  });
});

describe('.tab kao izvor', () => {
  it('zapisi iz .tab-a se prikazuju i izvoze', () => {
    const f = file('Kronospan Kasmir.tab', 'tab');
    const d = derive(f, newJobState());
    expect(d.records.length).toBe(readWtTab(f.bytes).parts.length);
    expect(d.conv).toBeNull();
    expect(d.mapping).toBeNull();
    expect(d.materials[0].fileName).toBe('Kronospan Kasmir.tab');
    expect(readWtTab(exportFiles(d)[0].bytes).parts).toEqual(readWtTab(f.bytes).parts);
  });
  it('neispravan .tab daje grešku, ne izuzetak', () => {
    const d = derive({ name: 'x.tab', kind: 'tab', bytes: new Uint8Array(10) }, newJobState());
    expect(d.canExport).toBe(false);
    expect(d.issues[0].level).toBe('error');
  });
});

describe('keš po fazama ne menja rezultat', () => {
  it('isti izlaz sa kešom i bez njega, i posle izmene stanja', () => {
    const f = kasmir();
    const cache: DeriveCache = {};
    const s1 = newJobState();
    const d1 = derive(f, s1, cache);
    const s2 = withEdit(s1, d1.records[3].base, 'qty', 11);
    expect(bytesOf(f, s2)).toEqual(exportFiles(derive(f, s2, cache)).map((x) => [x.name, Buffer.from(x.bytes).toString('hex')]));
    expect(derive(f, s1, cache).records.map((r) => r.rec)).toEqual(d1.records.map((r) => r.rec));
  });
});

describe('ime posla u predlogu imena fajla', () => {
  // isti Kašmir, ali je u jednom redu drugi materijal: dva fajla u poslu
  const twoMaterials = (): SourceFile => {
    const lines = Buffer.from(fx('Kasmir Kronospan 012-010.csv')).toString('utf8').split('\n');
    lines[2] = lines[2].replace(/^U702;/, 'HRAST;');
    return { name: 'Kasmir Kronospan 012-010.csv', kind: 'csv', bytes: new Uint8Array(Buffer.from(lines.join('\n'), 'utf8')) };
  };
  it('jedan materijal: ime fajla je ime posla', () => {
    expect(deriveJob(kasmir(), newJobState(), catalog, undefined, 'Kuhinja Petrović').materials[0].fileName).toBe('Kuhinja Petrović.tab');
  });
  it('ručno ime ima prednost nad imenom posla', () => {
    const s = withChoice(newJobState(), 'U702', { fileName: 'Moj fajl' });
    expect(deriveJob(kasmir(), s, catalog, undefined, 'Kuhinja Petrović').materials[0].fileName).toBe('Moj fajl.tab');
  });
  it('nedozvoljen znak i tačka na kraju se čiste', () => {
    expect(deriveJob(kasmir(), newJobState(), catalog, undefined, 'a/b.').materials[0].fileName).toBe('a_b.tab');
  });
  it('više materijala: svako ime počinje imenom posla, a imena su različita', () => {
    const d = deriveJob(twoMaterials(), newJobState(), catalog, undefined, 'Kuhinja Petrović');
    expect(d.materials).toHaveLength(2);
    const names = d.materials.map((m) => m.fileName);
    for (const n of names) expect(n.startsWith('Kuhinja Petrović ')).toBe(true);
    expect(new Set(names).size).toBe(2);
  });
  it('bez imena posla ime ostaje kao do sada', () => {
    expect(deriveJob(kasmir(), newJobState(), catalog).materials[0].fileName).toBe('U-702 18 mm.tab');
  });
});
