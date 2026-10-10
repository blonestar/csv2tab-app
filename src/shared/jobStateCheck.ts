// Stroga provera JobState-a: čista funkcija bez Electrona, koristi se u glavnom procesu pri upisu i pri čitanju iz baze.
// Vraća NOV objekat sa tačno poznatim poljima (nepoznato polje, pogrešan tip, nepoznata verzija ili preveliki spisak
// se odbijaju), pa ni stanje iz renderera ni staro stanje iz baze ne stiže dalje neproverno.
import { DELIMITERS } from '../../web/src/lib/csv';
import { FIELDS } from '../../web/src/lib/parts';
import { EDIT_FIELDS, type EditField, type JobState, type MaterialChoice, type PartEdit } from './job';

export const JOB_STATE_VERSION = 1;

/** Ograničenja protiv besmislenih veličina (jedan .tab ima najviše 65535 zapisa). */
export const STATE_LIMITS = {
  /** Naziv materijala, šifra, ime fajla. */
  text: 300,
  materials: 2000,
  edits: 200_000,
  /** Ključ zapisa je `<materijal>#<redovi>` ili `<materijal>|...`; materijal je ograničen posebno. */
  editKey: 2000,
  sheet: 10_000,
  /** Dužina serijalizovanog stanja u bajtovima. */
  json: 32 * 1024 * 1024,
} as const;

const ENCODINGS = ['utf-8', 'windows-1250', 'latin-1'];
const EDIT_MAX: Record<EditField, number> = { dim1: 0xffffffff, dim2: 0xffffffff, edge1: 255, edge2: 255, grain: 1, qty: 65535, name: 0 };

/** Greška sa porukom na srpskom, bez tehničkih detalja. */
export class JobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobStateError';
  }
}

/** Običan objekat (JSON ili strukturna kopija iz IPC-a): prototip je Object.prototype ili ga nema. */
function isObj(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function fail(path: string, what: string): never {
  throw new JobStateError(`Stanje posla nije ispravno (${path}: ${what}).`);
}

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(path, `nepoznato polje „${k.slice(0, 40)}"`);
}

const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function parseChoice(v: unknown, path: string): MaterialChoice {
  if (!isObj(v)) fail(path, 'očekivan je objekat');
  onlyKeys(v, ['wt', 'band', 'grain', 'fileName'], path);
  const out: MaterialChoice = {};
  if (Object.hasOwn(v, 'wt')) {
    if (v.wt !== null && !(typeof v.wt === 'string' && v.wt.length <= STATE_LIMITS.text)) fail(`${path}.wt`, 'očekivana je šifra ili null');
    out.wt = v.wt as string | null;
  }
  if (Object.hasOwn(v, 'band')) {
    if (typeof v.band !== 'string' || v.band.length > STATE_LIMITS.text) fail(`${path}.band`, 'očekivan je tekst');
    out.band = v.band;
  }
  if (Object.hasOwn(v, 'grain')) {
    if (v.grain !== 0 && v.grain !== 1) fail(`${path}.grain`, 'očekivano je 0 ili 1');
    out.grain = v.grain;
  }
  if (Object.hasOwn(v, 'fileName')) {
    if (typeof v.fileName !== 'string' || v.fileName.length > STATE_LIMITS.text) fail(`${path}.fileName`, 'očekivan je tekst');
    out.fileName = v.fileName;
  }
  return out;
}

function parseEdit(v: unknown, path: string): PartEdit {
  if (!isObj(v)) fail(path, 'očekivan je objekat');
  onlyKeys(v, EDIT_FIELDS, path);
  const out: Record<string, number | string> = {};
  for (const f of EDIT_FIELDS) {
    if (!Object.hasOwn(v, f)) continue;
    const x = v[f];
    if (f === 'name') {
      if (typeof x !== 'string' || x.length > 25) fail(`${path}.name`, 'očekivan je tekst do 25 znakova');
    } else if (!int(x, 0, EDIT_MAX[f])) fail(`${path}.${f}`, 'vrednost je van opsega');
    out[f] = x as number | string;
  }
  return out as PartEdit;
}

function parseMapping(v: unknown): JobState['mapping'] {
  if (v === 'auto') return 'auto';
  if (!isObj(v)) fail('mapping', 'očekivano je "auto" ili mapiranje kolona');
  onlyKeys(v, FIELDS, 'mapping');
  const out: Record<string, number> = {};
  for (const f of FIELDS) {
    if (!int(v[f], -1, 1000)) fail(`mapping.${f}`, 'očekivan je indeks kolone');
    out[f] = v[f];
  }
  return out as JobState['mapping'];
}

/** Proverava i vraća JobState; baca JobStateError. */
export function parseJobState(v: unknown): JobState {
  if (!isObj(v)) fail('stanje', 'očekivan je objekat');
  if (v.version !== JOB_STATE_VERSION) {
    throw new JobStateError(
      typeof v.version === 'number' && v.version > JOB_STATE_VERSION
        ? `Posao je sačuvan novijom verzijom programa (stanje verzije ${v.version}); ova verzija zna samo verziju ${JOB_STATE_VERSION}.`
        : 'Stanje posla ima nepoznatu verziju.',
    );
  }
  onlyKeys(v, ['version', 'encoding', 'delimiter', 'sheet', 'mapping', 'merge', 'materials', 'edits'], 'stanje');
  if (v.encoding !== 'auto' && !(typeof v.encoding === 'string' && ENCODINGS.includes(v.encoding))) fail('encoding', 'nepoznato kodiranje');
  if (v.delimiter !== 'auto' && !(typeof v.delimiter === 'string' && (DELIMITERS as readonly string[]).includes(v.delimiter))) fail('delimiter', 'nepoznat separator');
  if (!int(v.sheet, 0, STATE_LIMITS.sheet)) fail('sheet', 'očekivan je redni broj lista');
  if (typeof v.merge !== 'boolean') fail('merge', 'očekivano je da/ne');
  const mapping = parseMapping(v.mapping);

  if (!isObj(v.materials)) fail('materials', 'očekivan je objekat');
  const matKeys = Object.keys(v.materials);
  if (matKeys.length > STATE_LIMITS.materials) fail('materials', 'previše materijala');
  const materials = Object.fromEntries(
    matKeys.map((k) => {
      if (k.length > STATE_LIMITS.text) fail('materials', 'predugačak naziv materijala');
      return [k, parseChoice((v.materials as Record<string, unknown>)[k], 'materials')];
    }),
  );

  if (!isObj(v.edits)) fail('edits', 'očekivan je objekat');
  const editKeys = Object.keys(v.edits);
  if (editKeys.length > STATE_LIMITS.edits) fail('edits', 'previše ručnih izmena');
  const edits = Object.fromEntries(
    editKeys.map((k) => {
      if (k.length > STATE_LIMITS.editKey) fail('edits', 'predugačak ključ zapisa');
      return [k, parseEdit((v.edits as Record<string, unknown>)[k], 'edits')];
    }),
  );

  return { version: 1, encoding: v.encoding as JobState['encoding'], delimiter: v.delimiter as string, sheet: v.sheet, mapping, merge: v.merge, materials, edits };
}

/** Stanje iz JSON teksta (iz baze). */
export function parseJobStateJson(text: string): JobState {
  if (text.length > STATE_LIMITS.json) throw new JobStateError('Stanje posla je neočekivano veliko.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JobStateError('Stanje posla je oštećeno (nije ispravan JSON).');
  }
  return parseJobState(raw);
}

/** Serijalizacija proverenog stanja; odbija previše veliko. */
export function stringifyJobState(state: JobState): string {
  const text = JSON.stringify(state);
  if (text.length > STATE_LIMITS.json) throw new JobStateError('Stanje posla je neočekivano veliko.');
  return text;
}
