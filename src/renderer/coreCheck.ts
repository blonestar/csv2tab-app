// Pretvara fajl (CSV / ODS / XLSX) u bajtove .tab jezgrom, istim tokom kao web. Koristi ga provera da build ovog
// repoa daje iste bajtove kao jezgro (tests/core.test.ts i smoke test); prave operacije dolaze u fazi 3.
import { parseCsv, detectDelimiter } from '@core/csv';
import { decodeAuto } from '@core/encoding';
import { padRows, parseOds } from '@core/ods';
import { DEFAULT_EDGE_RULES, convertRows } from '@core/parts';
import { parseXlsx } from '@core/xlsx';
import { readWtTab, writeWtTab } from '@core/wtTab';

export type SourceKind = 'csv' | 'ods' | 'xlsx';

export function convertToTab(bytes: Uint8Array, kind: SourceKind, grainByMaterial?: Record<string, 0 | 1>): Uint8Array {
  let rows: string[][];
  if (kind === 'csv') {
    const text = decodeAuto(bytes).text;
    rows = parseCsv(text, detectDelimiter(text));
  } else {
    rows = padRows((kind === 'ods' ? parseOds(bytes) : parseXlsx(bytes))[0].rows);
  }
  const r = convertRows(rows, { rules: DEFAULT_EDGE_RULES, merge: true, grainByMaterial });
  const errors = r.issues.filter((i) => i.level === 'error');
  if (errors.length) throw new Error(errors.map((i) => i.msg).join(' '));
  return writeWtTab(r.parts);
}

/** Čita .tab i piše ga nazad; za ispravan fajl vraća iste bajtove. */
export function roundTripTab(bytes: Uint8Array): Uint8Array {
  const r = readWtTab(bytes);
  return writeWtTab(r.parts, r.materialIndex);
}
