// Iz bajtova izvora i JobState-a izvodi sve ostalo: redove, kodiranje, mapiranje, zapise sa izmenama, materijale,
// imena izlaznih fajlova i upozorenja. Čista funkcija: ista ulazna vrednost daje isti izlaz, bez ičega van `state`.
// Posao u bazi čuva `bajtovi + state`; `deriveJob` se poziva pri svakom otvaranju i pri svakom čuvanju (src/renderer/session.tsx).
import { matchMaterial, safeFileName, suggestFilename, type WtCatalog, type WtMaterial } from '@core/catalog';
import { DELIMITERS, detectDelimiter, parseCsv } from '@core/csv';
import { decodeAs, detectEncoding, type InputEncoding } from '@core/encoding';
import { padRows, parseOds } from '@core/ods';
import {
  convertRows,
  defaultGrain,
  missingFields,
  partsFromTab,
  type ColumnMapping,
  type ConvertResult,
  type Field,
  type Issue,
  type PartRecord,
} from '@core/parts';
import { parseXlsx } from '@core/xlsx';
import { readWtTab, writeWtTab } from '@core/wtTab';
import { EDIT_FIELDS, type EditField, type JobState, type SourceKind } from '../../shared/job';
import { choiceOf } from './state';

export interface SourceFile {
  name: string;
  kind: SourceKind;
  bytes: Uint8Array;
}

export interface ParsedSource {
  error?: string;
  encoding?: { detected: InputEncoding; used: InputEncoding; hadBom: boolean };
  delimiter?: { detected: string; used: string };
  /** Listovi ODS / XLSX (za CSV prazno). */
  sheets: { name: string; rows: number }[];
  /** Stvarno korišćen list (izbor je sveden na postojeći). */
  sheet: number;
  rows: string[][];
  tab?: { parts: PartRecord[]; warnings: string[] };
}

export interface JobRecord {
  /** Zapis sa primenjenim ručnim izmenama. */
  rec: PartRecord;
  /** Izračunati zapis, bez izmena. */
  base: PartRecord;
  edited: EditField[];
}

export interface MaterialView {
  /** Naziv iz fajla ('' = bez materijala / .tab). */
  source: string;
  count: number;
  qty: number;
  wt?: WtMaterial;
  /** true: WT materijal je automatski predlog, korisnik ga nije dirao. */
  wtAuto: boolean;
  band: string;
  grain: 0 | 1;
  grainFrom: 'manual' | 'catalog' | 'default';
  /** Predlog imena (bez .tab) i konačno ime fajla (sa .tab, jedinstveno u poslu). */
  suggested: string;
  fileName: string;
}

export interface DerivedJob {
  source: ParsedSource;
  conv: ConvertResult | null;
  /** Mapiranje koje se primenjuje (izračunato ili izabrano); null za .tab i neuspelo čitanje. */
  mapping: ColumnMapping | null;
  missing: Field[];
  records: JobRecord[];
  materials: MaterialView[];
  issues: Issue[];
  /** Ključevi izmena koji ne odgovaraju nijednom zapisu (npr. posle promene vlakna koja menja spajanje). */
  orphanEdits: string[];
  /** Ima zapisa za izvoz (preskočen red je greška u spisku upozorenja, ali ne zaustavlja ostale zapise). */
  canExport: boolean;
}

export interface ExportFile {
  material: string;
  /** Konačno ime sa .tab. */
  name: string;
  bytes: Uint8Array;
  count: number;
}

// ---------- keš po fazama (neobavezan; čist rezultat je isti sa kešom i bez njega) ----------
export type DeriveCache = Record<string, { deps: unknown[]; value: unknown } | undefined>;

function memo<T>(cache: DeriveCache | undefined, name: string, deps: unknown[], make: () => T): T {
  const hit = cache?.[name];
  if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => Object.is(d, deps[i]))) return hit.value as T;
  const value = make();
  if (cache) cache[name] = { deps, value };
  return value;
}

// ODS / XLSX se parsiraju jednom po bajtovima, ne pri svakoj promeni lista.
const sheetCache = new WeakMap<Uint8Array, { name: string; rows: string[][] }[]>();

function sheetsOf(file: SourceFile): { name: string; rows: string[][] }[] {
  let s = sheetCache.get(file.bytes);
  if (!s) {
    s = (file.kind === 'xlsx' ? parseXlsx(file.bytes) : parseOds(file.bytes)).map((x) => ({ name: x.name, rows: padRows(x.rows) }));
    sheetCache.set(file.bytes, s);
  }
  return s;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function parseSource(file: SourceFile, o: Pick<JobState, 'encoding' | 'delimiter' | 'sheet'>): ParsedSource {
  const empty: ParsedSource = { sheets: [], sheet: 0, rows: [] };
  try {
    if (file.kind === 'tab') {
      const r = readWtTab(file.bytes);
      return { ...empty, tab: { parts: partsFromTab(r.parts), warnings: r.warnings } };
    }
    if (file.kind === 'csv') {
      const detected = detectEncoding(file.bytes);
      const used = o.encoding === 'auto' ? detected : o.encoding;
      const dec = decodeAs(file.bytes, used);
      const detDelim = detectDelimiter(dec.text);
      const delim = o.delimiter !== 'auto' && (DELIMITERS as readonly string[]).includes(o.delimiter) ? o.delimiter : detDelim;
      return {
        ...empty,
        encoding: { detected, used, hadBom: dec.hadBom },
        delimiter: { detected: detDelim, used: delim },
        rows: parseCsv(dec.text, delim),
      };
    }
    const sheets = sheetsOf(file);
    if (!sheets.length) return { ...empty, error: `${file.kind === 'xlsx' ? 'Excel' : 'ODS'} fajl ne sadrži nijedan list.` };
    const sheet = Math.min(Math.max(0, Math.trunc(o.sheet) || 0), sheets.length - 1);
    return { ...empty, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })), sheet, rows: sheets[sheet].rows };
  } catch (e) {
    return { ...empty, error: errMsg(e) };
  }
}

// ---------- materijali ----------
/** WT materijal za naziv iz fajla: izbor korisnika, `null` = nijedan, inače automatski predlog iz kataloga. */
export function resolveWt(catalog: WtCatalog, state: Pick<JobState, 'materials'>, material: string): { wt?: WtMaterial; auto: boolean } {
  const c = choiceOf(state, material);
  if (c.wt === null) return { auto: false };
  if (typeof c.wt === 'string') return { wt: catalog.materials.find((m) => m.code === c.wt), auto: false };
  return { wt: material === '' ? undefined : matchMaterial(catalog, material), auto: true };
}

/** Podrazumevani smer vlakna po nazivu: jezgrov `defaultGrain` dok važi pravilo za jednobojne dekore, inače svi prate teksturu. */
export function nameGrain(state: Pick<JobState, 'decorRule'>, material: string): 0 | 1 {
  return state.decorRule ? defaultGrain(material) : 1;
}

function grainOf(catalog: WtCatalog, state: Pick<JobState, 'materials' | 'decorRule'>, material: string): { grain: 0 | 1; from: MaterialView['grainFrom'] } {
  const c = choiceOf(state, material);
  if (c.grain !== undefined) return { grain: c.grain, from: 'manual' };
  if (!state.decorRule) return { grain: 1, from: 'default' };
  const { wt } = resolveWt(catalog, state, material);
  if (wt) return { grain: wt.grain ? 1 : 0, from: 'catalog' };
  return { grain: nameGrain(state, material), from: 'default' };
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

// ---------- izvođenje ----------
export function deriveJob(file: SourceFile, state: JobState, catalog: WtCatalog, cache?: DeriveCache, jobName = ''): DerivedJob {
  const rules = state.edgeRules;
  const source = memo(cache, 'parse', [file.bytes, file.kind, state.encoding, state.delimiter, state.sheet], () => parseSource(file, state));
  const issues: Issue[] = [];
  if (source.error) issues.push({ level: 'error', msg: source.error });

  // zapisi i spisak materijala; za csv/ods/xlsx jezgrom, za .tab direktno
  let conv: ConvertResult | null = null;
  let baseParts: PartRecord[] = source.tab?.parts ?? [];
  let sourceMaterials: string[] = source.tab ? [''] : [];
  if (source.tab) {
    for (const w of source.tab.warnings) issues.push({ level: 'warn', msg: w });
  } else if (!source.error) {
    const mapping = state.mapping === 'auto' ? undefined : state.mapping;
    const plain = memo(cache, 'convPlain', [source, mapping, state.merge, rules], () =>
      convertRows(source.rows, { rules, merge: state.merge }, mapping),
    );
    // Smer vlakna po materijalu zavisi od izabranog WT materijala (i od pravila za jednobojne dekore), a spisak
    // materijala se zna tek posle prve konverzije (koja koristi jezgrov defaultGrain); druga se radi samo ako se
    // neki smer razlikuje od njega.
    const grain: Record<string, 0 | 1> = Object.create(null) as Record<string, 0 | 1>;
    for (const m of plain.materials) grain[m] = grainOf(catalog, state, m).grain;
    const differs = plain.materials.some((m) => grain[m] !== defaultGrain(m));
    const grainKey = JSON.stringify(grain);
    conv = differs
      ? memo(cache, 'convGrain', [plain, grainKey], () => convertRows(source.rows, { rules, merge: state.merge, grainByMaterial: grain }, mapping))
      : plain;
    baseParts = conv.parts;
    sourceMaterials = conv.materials;
    issues.push(...conv.issues);
  }

  // ručne izmene preko izračunatih zapisa
  const keys = new Set<string>();
  const records: JobRecord[] = baseParts.map((base) => {
    keys.add(base.key);
    const rec: PartRecord = { ...base };
    const edited: EditField[] = [];
    const e = Object.hasOwn(state.edits, base.key) ? state.edits[base.key] : undefined;
    if (e) {
      for (const f of EDIT_FIELDS) {
        const v = e[f];
        if (v !== undefined && v !== base[f]) {
          (rec as unknown as Record<string, unknown>)[f] = v;
          edited.push(f);
        }
      }
    }
    return { rec, base, edited };
  });
  const orphanEdits = Object.keys(state.edits).filter((k) => !keys.has(k));

  // pregled po materijalu + jedinstvena imena fajlova
  // predlog imena: ime posla; kad posao daje više fajlova, uz njega ide i oznaka materijala
  const job = safeFileName(jobName).replace(/[. ]+$/, '');
  const fileCount = sourceMaterials.filter((m) => records.some((r) => r.rec.material === m)).length;
  const used = new Set<string>();
  const materials: MaterialView[] = [];
  for (const m of sourceMaterials) {
    const list = records.filter((r) => r.rec.material === m);
    if (!list.length) continue;
    const c = choiceOf(state, m);
    const { wt, auto } = resolveWt(catalog, state, m);
    const band = c.band && catalog.edgeBands.some((b) => b.code === c.band) ? c.band : '';
    const g = grainOf(catalog, state, m);
    const own = wt
      ? suggestFilename(wt, catalog.edgeBands.find((b) => b.code === band))
      : m || baseName(file.name) + (source.sheets.length > 1 ? `_${safeFileName(source.sheets[source.sheet].name)}` : '');
    const suggested = safeFileName(job ? (fileCount > 1 ? `${job} ${own}` : job) : own) || 'zapisi';
    const stem = safeFileName((c.fileName ?? '').replace(/\.tab$/i, '')) || suggested;
    let name = `${stem}.tab`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}_${i}.tab`;
    used.add(name.toLowerCase());
    materials.push({
      source: m,
      count: list.length,
      qty: list.reduce((s, r) => s + r.rec.qty, 0),
      wt,
      wtAuto: auto && !!wt,
      band,
      grain: g.grain,
      grainFrom: g.from,
      suggested,
      fileName: name,
    });
  }

  return {
    source,
    conv,
    mapping: conv?.mapping ?? null,
    missing: conv ? missingFields(conv.mapping) : [],
    records,
    materials,
    issues,
    orphanEdits,
    canExport: records.length > 0,
  };
}

/** Jedan .tab po materijalu, sa imenima iz `derived.materials`. Bez `materialIndex`, kao web. */
export function exportFiles(d: DerivedJob): ExportFile[] {
  return d.materials.map((m) => {
    const recs = d.records.filter((r) => r.rec.material === m.source).map((r) => r.rec);
    return { material: m.source, name: m.fileName, bytes: writeWtTab(recs), count: recs.length };
  });
}
