// Pamćenje izbora iz perspektive posla (čiste funkcije osim `stateForNewJob`, kome se upit prosleđuje):
//  - pri pravljenju posla se zapamćeni izbori KOPIRAJU u JobState (`stateForNewJob`), pa kasnija promena pamćenja
//    ne menja stari posao;
//  - pri čuvanju se razlika u odnosu na poslednje sačuvano stanje šalje u pamćenje (`rememberDiff`): pamti se samo
//    ono što je korisnik ručno promenio u ovoj sesiji, ne sve što posao sadrži;
//  - uspešan izvoz potvrđuje sve što je važilo za izvezene materijale (`confirmedByExport`).
import type { WtCatalog } from '@core/catalog';
import { missingFields, type ColumnMapping } from '@core/parts';
import { MEMORY_FIELDS, type JobState, type MaterialChoice, type MemoryField } from '../../shared/job';
import {
  headerSignature,
  mappingFitsColumns,
  rememberable,
  signatureColumns,
  type MaterialMemory,
  type MaterialMemoryUpdate,
  type MemoryFound,
  type MemoryLookup,
  type MemoryUpdate,
} from '../../shared/memory';
import { deriveJob, type DerivedJob, type SourceFile } from './derive';
import { choiceOf } from './state';
import { newJobState, type JobDefaults } from './defaults';

const sameMapping = (a: JobState['mapping'], b: JobState['mapping']): boolean =>
  a === b || (a !== 'auto' && b !== 'auto' && (Object.keys(a) as (keyof ColumnMapping)[]).every((k) => a[k] === b[k]));

/** Potpis zaglavlja izvedenog posla; null za .tab, fajl bez zaglavlja ili neuspelo čitanje. */
export function signatureOf(d: DerivedJob): string | null {
  return d.conv && !d.conv.headerless ? headerSignature(d.source.rows[0]) : null;
}

const sourceNames = (d: DerivedJob): string[] => d.materials.map((m) => m.source).filter(rememberable);

/** Primenjuje zapamćene izbore na stanje novog posla; nepostojeći WT materijal ili traka (nema ih više u katalogu) se preskaču. */
export function applyMaterialMemory(state: JobState, found: Record<string, MaterialMemory>, catalog: WtCatalog): JobState {
  let materials: JobState['materials'] = { ...state.materials };
  for (const name of Object.keys(found)) {
    const m = found[name];
    const c: MaterialChoice = {};
    const from: MemoryField[] = [];
    if (m.wt === null) {
      c.wt = null;
      from.push('wt');
    } else if (typeof m.wt === 'string' && catalog.materials.some((x) => x.code === m.wt)) {
      c.wt = m.wt;
      from.push('wt');
    }
    if (m.band !== undefined) {
      if (m.band === '' || catalog.edgeBands.some((b) => b.code === m.band)) {
        c.band = m.band;
        from.push('band');
      }
    }
    if (m.grain !== undefined) {
      c.grain = m.grain;
      from.push('grain');
    }
    if (from.length) materials = { ...materials, [name]: { ...c, fromMemory: from } };
  }
  return { ...state, materials };
}

/**
 * Stanje novog posla: podešavanja (snimak), pa zapamćeno mapiranje kolona i izbori po materijalu kao izričite
 * odluke u stanju. Mapiranje se primenjuje prvo jer menja spisak materijala. Sve se završava pre prvog čuvanja,
 * pa posao nikad ne postoji u „nebirano" obliku.
 */
export async function stateForNewJob(
  file: SourceFile,
  defaults: JobDefaults,
  catalog: WtCatalog,
  lookup: (q: MemoryLookup) => Promise<MemoryFound>,
): Promise<{ state: JobState; derived: DerivedJob }> {
  let state = newJobState(defaults);
  let derived = deriveJob(file, state, catalog);
  if (file.kind === 'tab') return { state, derived };

  const signature = signatureOf(derived);
  let found = await lookup({ names: sourceNames(derived), signature });
  if (signature && found.mapping && mappingFitsColumns(found.mapping, signatureColumns(signature))) {
    const withMapping: JobState = { ...state, mapping: found.mapping, mappingFromMemory: true };
    const d = deriveJob(file, withMapping, catalog);
    if (d.conv && missingFields(d.conv.mapping).length === 0) {
      state = withMapping;
      derived = d;
      // drugo mapiranje može dati drugi spisak materijala
      const names = sourceNames(d);
      found = { materials: names.length ? (await lookup({ names, signature: null })).materials : {}, mapping: found.mapping };
    }
  }
  if (Object.keys(found.materials).length) {
    const names = new Set(sourceNames(derived));
    const own = Object.fromEntries(Object.entries(found.materials).filter(([n]) => names.has(n)));
    state = applyMaterialMemory(state, own, catalog);
    derived = deriveJob(file, state, catalog);
  }
  return { state, derived };
}

/** Razlika dva izbora u pamćenju: postavlja promenjena polja, a polje vraćeno na predlog briše iz pamćenja (traka: „bez trake"). */
function choiceDiff(name: string, prev: MaterialChoice, next: MaterialChoice): MaterialMemoryUpdate | null {
  const u: MaterialMemoryUpdate = { name };
  const clear: MemoryField[] = [];
  let changed = false;
  for (const f of MEMORY_FIELDS) {
    if (prev[f] === next[f]) continue;
    changed = true;
    if (next[f] === undefined) {
      if (f === 'band') u.band = '';
      else clear.push(f);
    } else if (f === 'wt') u.wt = next.wt as string | null;
    else if (f === 'band') u.band = next.band;
    else u.grain = next.grain;
  }
  if (clear.length) u.clear = clear;
  return changed ? u : null;
}

/**
 * Šta u pamćenje: izbori po materijalu koji su se promenili između `prev` (poslednje sačuvano) i `next`, i mapiranje
 * kolona ako je ručno promenjeno (samo za fajl sa zaglavljem i samo ako su obavezne kolone zadate).
 * null = nema šta da se pamti.
 */
export function rememberDiff(prev: JobState, next: JobState, derived: DerivedJob): MemoryUpdate | null {
  const materials: MaterialMemoryUpdate[] = [];
  const names = new Set([...Object.keys(prev.materials), ...Object.keys(next.materials)]);
  for (const name of names) {
    if (!rememberable(name)) continue;
    const u = choiceDiff(name, choiceOf(prev, name), choiceOf(next, name));
    if (u) materials.push(u);
  }
  const update: MemoryUpdate = { materials };
  if (next.mapping !== 'auto' && !sameMapping(prev.mapping, next.mapping)) {
    const signature = signatureOf(derived);
    if (signature && mappingFitsColumns(next.mapping, signatureColumns(signature))) update.mapping = { signature, mapping: next.mapping };
  }
  return materials.length || update.mapping ? update : null;
}

/**
 * Izvoz potvrđuje izbore: za izvezene materijale se pamti ono što je zaista važilo, i predlog iz kataloga koji
 * korisnik nije dirao, uključujući podrazumevani smer teksture i odsustvo WT materijala. Potvrđeni izbor ima
 * prednost nad podrazumevanim pravilom u sledećem poslu; može se zaboraviti u podešavanjima.
 */
export function confirmedByExport(d: DerivedJob, exported: ReadonlySet<string>): MemoryUpdate | null {
  const materials: MaterialMemoryUpdate[] = [];
  for (const m of d.materials) {
    if (!exported.has(m.source) || !rememberable(m.source)) continue;
    const u: MaterialMemoryUpdate = { name: m.source, wt: m.wt?.code ?? null, band: m.band, grain: m.grain };
    materials.push(u);
  }
  return materials.length ? { materials } : null;
}
