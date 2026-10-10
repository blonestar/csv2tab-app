// Prelazi stanja posla (čiste funkcije nad JobState). Pravilo iz weba: promena izvora (kodiranje, separator, list),
// mapiranja ili spajanja menja ključeve zapisa, pa se ručne izmene odbacuju; promena smera vlakna ili
// materijala ih ne dira.
import { fitName } from '@core/wtTab';
import type { ColumnMapping, Field, PartRecord } from '@core/parts';
import type { EditField, JobState, MaterialChoice, PartEdit } from '../../shared/job';

const resetDerived = (s: JobState): JobState => ({ ...s, mapping: 'auto', edits: {} });

export const withEncoding = (s: JobState, encoding: JobState['encoding']): JobState => ({ ...resetDerived(s), encoding });
export const withDelimiter = (s: JobState, delimiter: string): JobState => ({ ...resetDerived(s), delimiter });
export const withSheet = (s: JobState, sheet: number): JobState => ({ ...resetDerived(s), sheet });
export const withMerge = (s: JobState, merge: boolean): JobState => ({ ...s, merge, edits: {} });
/** `current` je mapiranje koje se trenutno primenjuje (iz izvedenih podataka). */
export const withMappingField = (s: JobState, current: ColumnMapping, field: Field, column: number): JobState => ({
  ...s,
  mapping: { ...current, [field]: column },
  edits: {},
});
export const withAutoMapping = (s: JobState): JobState => ({ ...s, mapping: 'auto', edits: {} });

/** Pristup bez prototipa: naziv materijala može biti bilo šta (i "__proto__"). */
export function choiceOf(s: Pick<JobState, 'materials'>, material: string): MaterialChoice {
  return Object.hasOwn(s.materials, material) ? s.materials[material] : {};
}

/** `undefined` u izmeni briše polje (vraća na podrazumevano). */
export function withChoice(s: JobState, material: string, patch: Partial<Record<keyof MaterialChoice, unknown>>): JobState {
  const next: Record<string, unknown> = { ...choiceOf(s, material), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  const materials = { ...s.materials };
  delete (materials as Record<string, unknown>)[material];
  if (Object.keys(next).length) return { ...s, materials: { ...materials, [material]: next as MaterialChoice } };
  return { ...s, materials };
}

/** Vrednost polja koja je prošla proveru opsega, ili null. Ime se skraćuje kao pri upisu u .tab. */
export function parseEditValue(field: EditField, raw: string | number): number | string | null {
  if (field === 'name') return fitName(String(raw)).name;
  const n = typeof raw === 'number' ? raw : raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n)) return null;
  const v = Math.round(n);
  const max = field === 'qty' ? 65535 : field === 'edge1' || field === 'edge2' ? 255 : field === 'grain' ? 1 : 4294967295;
  return v < 0 || v > max ? null : v;
}

/** Beleži izmenu; ako je vrednost jednaka izračunatoj, izmena se briše. */
export function withEdit(s: JobState, base: PartRecord, field: EditField, value: number | string): JobState {
  const e: PartEdit = { ...(Object.hasOwn(s.edits, base.key) ? s.edits[base.key] : {}) };
  if (value === base[field]) delete e[field];
  else (e as Record<string, unknown>)[field] = value;
  return storeEdit(s, base.key, e);
}

function storeEdit(s: JobState, key: string, e: PartEdit): JobState {
  const edits = { ...s.edits };
  delete (edits as Record<string, unknown>)[key];
  return Object.keys(e).length ? { ...s, edits: { ...edits, [key]: e } } : { ...s, edits };
}

/** Zamena dimenzija u redu: izmene dim1/dim2/edge1/edge2 (vlakno se ne menja), kao u webu. */
export function withSwap(s: JobState, base: PartRecord, current: PartRecord): JobState {
  let out = withEdit(s, base, 'dim1', current.dim2);
  out = withEdit(out, base, 'dim2', current.dim1);
  out = withEdit(out, base, 'edge1', current.edge2);
  return withEdit(out, base, 'edge2', current.edge1);
}

export function withoutEdit(s: JobState, key: string): JobState {
  return storeEdit(s, key, {});
}

export const withoutEdits = (s: JobState): JobState => ({ ...s, edits: {} });
