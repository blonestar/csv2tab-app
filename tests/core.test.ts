// @vitest-environment jsdom
// Jezgro preko @core alias-a i fflate iz ovog repoa: isti bajtovi bez obzira na format ulaza.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareParts } from '@core/compare';
import { parseCsv } from '@core/csv';
import { decodeAuto } from '@core/encoding';
import { padRows, parseOds } from '@core/ods';
import { DEFAULT_EDGE_RULES, convertRows } from '@core/parts';
import { readWtTab } from '@core/wtTab';
import { convertToTab, roundTripTab, type SourceKind } from '../src/renderer/coreCheck';

const fx = (n: string) => new Uint8Array(readFileSync(resolve(__dirname, '../web/tests/fixtures', n)));
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe('.tab: čitanje pa pisanje je bajt-identično', () => {
  for (const file of ['Kronospan Kasmir.tab', 'STONE OAK Kronospan.tab']) {
    it(file, () => {
      const data = fx(file);
      expect(same(roundTripTab(data), data)).toBe(true);
    });
  }
});

describe('CSV, ODS i XLSX daju iste bajtove', () => {
  const cases: { name: string; files: Record<SourceKind, string>; grain?: Record<string, 0 | 1> }[] = [
    {
      name: 'Kašmir',
      files: { csv: 'Kasmir Kronospan 012-010.csv', ods: 'Kasmir Kronospan 012-010.ods', xlsx: 'Kasmir Kronospan 012-010.xlsx' },
      grain: { '012-010': 0, U702: 0 },
    },
    {
      name: 'Stone oak',
      files: { csv: 'Stone oak Kronospan.csv', ods: 'Stone oak Kronospan 012-140.ods', xlsx: 'Stone oak Kronospan 012-140.xlsx' },
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const out = (Object.keys(c.files) as SourceKind[]).map((k) => convertToTab(fx(c.files[k]), k, c.grain));
      expect(out[0].length).toBeGreaterThan(165);
      expect(same(out[1], out[0])).toBe(true);
      expect(same(out[2], out[0])).toBe(true);
    });
  }
});

describe('Kašmir: zapisi se poklapaju sa ručno pravljenim .tab-om', () => {
  it('nema zapisa samo na jednoj strani, količine su iste', () => {
    const rows = parseCsv(decodeAuto(fx('Kasmir Kronospan 012-010.csv')).text, ';');
    const csv = convertRows(rows, { rules: DEFAULT_EDGE_RULES, merge: true });
    const diff = compareParts(csv.parts, readWtTab(fx('Kronospan Kasmir.tab')).parts);
    expect(diff.filter((d) => d.status === 'onlyA' || d.status === 'onlyB')).toEqual([]);
    for (const d of diff) expect(d.a!.qty, d.a!.name).toBe(d.b!.qty);
  });
  it('ODS i dalje daje iste zapise (provera da je DOMParser dostupan)', () => {
    expect(padRows(parseOds(fx('Kasmir Kronospan 012-010.ods'))[0].rows).length).toBeGreaterThan(1);
  });
});
