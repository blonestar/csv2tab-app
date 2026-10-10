// @vitest-environment jsdom
// JobState verzija 2: prevod sa verzije 1 (isti izlaz), snimak pravila u poslu, pravilo za jednobojne dekore,
// stanje iz pamćenja i razlika izbora koja ide u pamćenje.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WtCatalog } from '@core/catalog';
import { DEFAULT_EDGE_RULES, type EdgeRule } from '@core/parts';
import catalogJson from '../web/src/data/wt-catalog.json';
import { BUILT_IN_DEFAULTS, defaultsFromSettings, newJobState } from '../src/renderer/job/defaults';
import { deriveJob, exportFiles, type SourceFile } from '../src/renderer/job/derive';
import { applyMaterialMemory, confirmedByExport, rememberDiff, signatureOf, stateForNewJob } from '../src/renderer/job/memory';
import { rulesDiffer, withChoice, withCurrentRules, withMappingField } from '../src/renderer/job/state';
import { JobStateError, parseJobState, parseJobStateJson, stringifyJobState, upgradeJobStateV1 } from '../src/shared/jobStateCheck';
import { SETTINGS } from '../src/shared/settings';
import type { MemoryFound } from '../src/shared/memory';
import golden from './data/jobStateV1Golden.json';

const catalog = catalogJson as unknown as WtCatalog;
const fx = (n: string) => new Uint8Array(readFileSync(resolve(__dirname, '../web/tests/fixtures', n)));
const kindOf = (n: string) => (n.endsWith('.csv') ? 'csv' : n.endsWith('.xlsx') ? 'xlsx' : 'ods') as SourceFile['kind'];
const file = (name: string): SourceFile => ({ name, kind: kindOf(name), bytes: fx(name) });
const kasmir = () => file('Kasmir Kronospan 012-010.csv');
const sha = (f: SourceFile, s: ReturnType<typeof newJobState>) => {
  const h = createHash('sha256');
  for (const x of exportFiles(deriveJob(f, s, catalog))) {
    h.update(x.name);
    h.update(x.bytes);
  }
  return h.digest('hex');
};

describe('JobState v1 -> v2', () => {
  it('stanja verzije 1 iz baze se čitaju i daju bajt-identičan izlaz kao pre (referentni heševi iz verzije 0.5.0)', () => {
    for (const [label, g] of Object.entries(golden)) {
      const v1 = JSON.stringify(g.state);
      expect(JSON.parse(v1).version, label).toBe(1);
      const s = parseJobStateJson(v1);
      expect(s.version).toBe(2);
      expect(sha(file(g.file), s), `slučaj ${label}`).toBe(g.sha);
      expect(deriveJob(file(g.file), s, catalog).materials.map((m) => [m.source, m.grain]), `slučaj ${label}`).toEqual(g.mats);
    }
  });
  it('prevod je čista funkcija: podrazumevana tabela, pravilo uključeno, ništa se ne gubi', () => {
    const v1 = { ...(golden.B.state as object), version: 1 as const } as Parameters<typeof upgradeJobStateV1>[0];
    const before = JSON.stringify(v1);
    const up = upgradeJobStateV1(v1);
    expect(JSON.stringify(v1)).toBe(before);
    expect(up).toEqual({ ...v1, version: 2, edgeRules: DEFAULT_EDGE_RULES, decorRule: true, mappingFromMemory: false });
    expect(up.edgeRules).not.toBe(DEFAULT_EDGE_RULES); // kopija, ne deljen niz
    expect(parseJobState(up)).toEqual(up); // rezultat prolazi strogu proveru verzije 2
  });
  it('verzija 1 ne sme da nosi polja verzije 2', () => {
    const base = { ...(golden.A.state as Record<string, unknown>) };
    expect(() => parseJobState({ ...base, decorRule: true })).toThrow(JobStateError);
    expect(() => parseJobState({ ...base, materials: { a: { wt: 'x', fromMemory: ['wt'] } } })).toThrow(JobStateError);
  });
  it('čuvanje starog posla upisuje verziju 2', () => {
    const s = parseJobStateJson(JSON.stringify(golden.A.state));
    expect(JSON.parse(stringifyJobState(s)).version).toBe(2);
  });
});

describe('snimak pravila u poslu', () => {
  const edge5: EdgeRule[] = DEFAULT_EDGE_RULES.map((r) => (r.code === 5 ? { ...r, code: 9 } : r));
  it('tabela šifara u stanju određuje izlaz, ne neka globalna', () => {
    const f = file('Stone oak Kronospan.csv');
    const base = newJobState();
    const alt = { ...newJobState(), edgeRules: DEFAULT_EDGE_RULES.map((r) => ({ ...r, code: r.code + 10 })) };
    expect(sha(f, base)).not.toBe(sha(f, alt));
    const ds = deriveJob(f, alt, catalog).records.map((r) => r.rec.edge1);
    expect(ds.some((c) => c >= 10)).toBe(true);
  });
  it('nova podešavanja menjaju novi posao, a ne postojeći', () => {
    const f = file('Stone oak Kronospan.csv');
    const existing = newJobState();
    const settings = { ...Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [k, d.default])), edgeRules: edge5.map((r) => ({ ...r, code: r.code + 20 })), decorRule: false, mergeDefault: false } as Parameters<typeof defaultsFromSettings>[0];
    const fresh = newJobState(defaultsFromSettings(settings));
    expect(fresh.merge).toBe(false);
    expect(fresh.decorRule).toBe(false);
    // postojeći posao ostaje kakav je
    expect(sha(f, existing)).toBe(sha(f, newJobState(BUILT_IN_DEFAULTS)));
    expect(sha(f, fresh)).not.toBe(sha(f, existing));
    // snimak je kopija: izmena podešavanja posle pravljenja ne dira stanje
    expect(fresh.edgeRules).not.toBe(settings.edgeRules);
    expect(rulesDiffer(existing, settings)).toBe(true);
    expect(rulesDiffer(fresh, settings)).toBe(false);
    // jedna radnja: primena trenutnih podešavanja na posao
    const applied = withCurrentRules(existing, settings);
    expect(rulesDiffer(applied, settings)).toBe(false);
    expect(sha(f, applied)).toBe(sha(f, fresh.merge === applied.merge ? fresh : { ...fresh, merge: applied.merge }));
  });
  it('pravilo za jednobojne dekore: isključeno znači da U702 prati teksturu, ručni izbor ima prednost', () => {
    // bez WT materijala (U702 postoji u katalogu i tada smer dolazi iz kataloga, ne iz pravila po nazivu)
    const noWt = withChoice(newJobState(), 'U702', { wt: null });
    expect(deriveJob(kasmir(), newJobState(), catalog).materials[0]).toMatchObject({ grain: 0, grainFrom: 'catalog' });
    const on = deriveJob(kasmir(), noWt, catalog);
    expect(on.materials[0]).toMatchObject({ source: 'U702', grain: 0, grainFrom: 'default' });
    expect(on.records.every((r) => r.rec.grain === 0)).toBe(true);
    const off = deriveJob(kasmir(), { ...noWt, decorRule: false }, catalog);
    expect(off.materials[0]).toMatchObject({ grain: 1, grainFrom: 'default' });
    expect(off.records.every((r) => r.rec.grain === 1)).toBe(true);
    expect(deriveJob(kasmir(), { ...newJobState(), decorRule: false }, catalog).records.every((r) => r.rec.grain === 1)).toBe(true);
    const manual = deriveJob(kasmir(), withChoice({ ...noWt, decorRule: false }, 'U702', { grain: 0 }), catalog);
    expect(manual.records.every((r) => r.rec.grain === 0)).toBe(true);
    // spajanje istih delova gleda smer teksture, pa isključeno pravilo daje isti broj ili manje redova, nikad izgubljene komade
    const qty = (d: typeof on) => d.records.reduce((s, r) => s + r.rec.qty, 0);
    expect(qty(off)).toBe(qty(on));
  });
});

describe('pamćenje u novom poslu', () => {
  const lookupWith = (found: MemoryFound) => async () => found;
  const wt = catalog.materials.find((m) => m.code === 'U702') ?? catalog.materials[0];
  const band = catalog.edgeBands[0].code;

  it('zapamćeni izbori ulaze u stanje kao izričite odluke, sa oznakom porekla', async () => {
    const found: MemoryFound = { materials: { U702: { wt: wt.code, band, grain: 1 } }, mapping: null };
    const { state, derived } = await stateForNewJob(kasmir(), BUILT_IN_DEFAULTS, catalog, lookupWith(found));
    expect(state.materials.U702).toEqual({ wt: wt.code, band, grain: 1, fromMemory: ['wt', 'band', 'grain'] });
    expect(derived.materials[0]).toMatchObject({ wt, band, grain: 1, grainFrom: 'manual', wtAuto: false });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(parseJobState(state)).toEqual(state);
  });
  it('izričito „nijedan WT materijal" je izbor; šifra koje nema u katalogu se preskače', async () => {
    const none = await stateForNewJob(kasmir(), BUILT_IN_DEFAULTS, catalog, lookupWith({ materials: { U702: { wt: null } }, mapping: null }));
    expect(none.state.materials.U702).toEqual({ wt: null, fromMemory: ['wt'] });
    expect(none.derived.materials[0].wt).toBeUndefined();
    const gone = await stateForNewJob(kasmir(), BUILT_IN_DEFAULTS, catalog, lookupWith({ materials: { U702: { wt: 'NEMA-TAKVE', band: 'NEMA' } }, mapping: null }));
    expect(gone.state.materials).toEqual({}); // predlog iz kataloga ostaje
  });
  it('zapamćeno mapiranje se primenjuje na isto zaglavlje, a nepodobno se preskače', async () => {
    const f = kasmir();
    const d0 = deriveJob(f, newJobState(), catalog);
    const sig = signatureOf(d0);
    expect(sig).toBeTruthy();
    const m = { ...d0.mapping!, designation: -1 };
    const lookup = async (q: { names: string[]; signature: string | null }): Promise<MemoryFound> => ({ materials: {}, mapping: q.signature === sig ? m : null });
    const { state, derived } = await stateForNewJob(f, BUILT_IN_DEFAULTS, catalog, lookup);
    expect(state.mapping).toEqual(m);
    expect(state.mappingFromMemory).toBe(true);
    expect(derived.mapping).toEqual(m);
    const same = await stateForNewJob(f, BUILT_IN_DEFAULTS, catalog, lookupWith({ materials: {}, mapping: d0.mapping! }));
    expect(same.state.mappingFromMemory).toBe(true);
    expect(same.state.mapping).toEqual(d0.mapping);
    // indeks kolone kojeg fajl nema: mapiranje se ne primenjuje
    const far = { ...d0.mapping!, qty: 200 };
    const skipped = await stateForNewJob(f, BUILT_IN_DEFAULTS, catalog, async () => ({ materials: {}, mapping: far }));
    expect(skipped.state.mapping).toBe('auto');
    // ručna izmena mapiranja uklanja oznaku porekla
    expect(withMappingField(state, m, 'qty', 3).mappingFromMemory).toBe(false);
  });
  it('fajl bez zaglavlja i .tab nemaju potpis', async () => {
    const d = deriveJob({ name: 'x.csv', kind: 'csv', bytes: new TextEncoder().encode('U702;1000;300;2;;;;;;\nU702;800;300;1;;;;;;\n') }, newJobState(), catalog);
    expect(d.conv?.headerless).toBe(true);
    expect(signatureOf(d)).toBeNull();
  });
  it('ručna izmena polja uklanja oznaku „iz pamćenja" samo za to polje', () => {
    let s = applyMaterialMemory(newJobState(), { U702: { wt: wt.code, band, grain: 1 } }, catalog);
    s = withChoice(s, 'U702', { band: undefined });
    expect(s.materials.U702.fromMemory).toEqual(['wt', 'grain']);
    s = withChoice(s, 'U702', { wt: null, grain: undefined });
    expect(s.materials.U702).toEqual({ wt: null });
    expect(parseJobState(s)).toEqual(s);
  });
  it('prazna traka se pamti; isti naziv koristi izbor i kad je debljina druga', async () => {
    const found: MemoryFound = { materials: { U702: { wt: null, band: '', grain: 1 } }, mapping: null };
    const first = await stateForNewJob(kasmir(), BUILT_IN_DEFAULTS, catalog, lookupWith(found));
    expect(first.state.materials.U702).toEqual({ wt: null, band: '', grain: 1, fromMemory: ['wt', 'band', 'grain'] });
    const changed = { ...kasmir(), bytes: new TextEncoder().encode(new TextDecoder().decode(kasmir().bytes).replaceAll(';18,0 mm;', ';22,0 mm;')) };
    const second = await stateForNewJob(changed, BUILT_IN_DEFAULTS, catalog, lookupWith(found));
    expect(second.state.materials.U702).toEqual(first.state.materials.U702);
    const before = sha(kasmir(), first.state);
    await stateForNewJob(kasmir(), BUILT_IN_DEFAULTS, catalog, lookupWith({ materials: { U702: { wt: wt.code, grain: 0 } }, mapping: null }));
    expect(sha(kasmir(), first.state)).toBe(before);
  });
});

describe('šta se šalje u pamćenje', () => {
  const d = (s: ReturnType<typeof newJobState>) => deriveJob(kasmir(), s, catalog);
  const s0 = newJobState();
  it('samo promenjeni izbori, ne sve što posao sadrži', () => {
    expect(rememberDiff(s0, s0, d(s0))).toBeNull();
    const s1 = withChoice(s0, 'U702', { wt: 'U-702', grain: undefined });
    expect(rememberDiff(s0, s1, d(s1))).toEqual({ materials: [{ name: 'U702', wt: 'U-702' }] });
    const s2 = withChoice(s1, 'U702', { band: 'ABS1' });
    expect(rememberDiff(s1, s2, d(s2))).toEqual({ materials: [{ name: 'U702', band: 'ABS1' }] });
    // vraćanje na predlog briše polje iz pamćenja (traka: „bez trake")
    const s3 = withChoice(s2, 'U702', { wt: undefined, band: undefined });
    expect(rememberDiff(s2, s3, d(s3))).toEqual({ materials: [{ name: 'U702', band: '', clear: ['wt'] }] });
    // izričito „nijedan"
    const s4 = withChoice(s0, 'U702', { wt: null });
    expect(rememberDiff(s0, s4, d(s4))).toEqual({ materials: [{ name: 'U702', wt: null }] });
    // ime izlaznog fajla se ne pamti
    const s5 = withChoice(s0, 'U702', { fileName: 'moj' });
    expect(rememberDiff(s0, s5, d(s5))).toBeNull();
    // materijal bez naziva se ne pamti
    const s6 = withChoice(s0, '', { wt: 'X' });
    expect(rememberDiff(s0, s6, d(s6))).toBeNull();
  });
  it('mapiranje se pamti kad se ručno promeni, uz potpis zaglavlja', () => {
    const d0 = d(s0);
    const s1 = withMappingField(s0, d0.mapping!, 'designation', -1);
    const u = rememberDiff(s0, s1, d(s1));
    expect(u?.mapping?.signature).toBe(signatureOf(d0));
    expect(u?.mapping?.mapping.designation).toBe(-1);
    // obavezna kolona bez izbora se ne pamti
    const s2 = withMappingField(s0, d0.mapping!, 'length', -1);
    expect(rememberDiff(s0, s2, d(s2))?.mapping).toBeUndefined();
  });
  it('izvoz potvrđuje sve važeće izbore, uključujući predloge i pravilo po nazivu', () => {
    const f = file('Stone oak Kronospan.csv');
    const dd = deriveJob(f, newJobState(), catalog);
    const m = dd.materials[0];
    const u = confirmedByExport(dd, new Set([m.source]))!;
    expect(u.materials[0].name).toBe(m.source);
    expect(u.materials[0].band).toBe('');
    if (m.wt) expect(u.materials[0].wt).toBe(m.wt.code);
    // U702: pamti se i smer određen pravilom, kao i izričito „nijedan".
    const noWt = withChoice(newJobState(), 'U702', { wt: null });
    const k = deriveJob(kasmir(), noWt, catalog);
    expect(confirmedByExport(k, new Set(['U702']))!.materials[0]).toEqual({ name: 'U702', band: '', wt: null, grain: 0 });
    // predlog iz kataloga (U702 je u katalogu) se pamti, zajedno sa smerom iz kataloga
    const auto = confirmedByExport(deriveJob(kasmir(), newJobState(), catalog), new Set(['U702']))!.materials[0];
    expect(auto).toMatchObject({ name: 'U702', band: '', grain: 0 });
    expect(typeof auto.wt).toBe('string');
    const k2 = withChoice(newJobState(), 'U702', { wt: null, grain: 1 });
    expect(confirmedByExport(deriveJob(kasmir(), k2, catalog), new Set(['U702']))!.materials[0]).toMatchObject({ wt: null, grain: 1 });
    // nije izvezen = nema potvrde
    expect(confirmedByExport(k, new Set())).toBeNull();
  });
});
