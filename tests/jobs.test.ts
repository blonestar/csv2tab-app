// Poslovi u bazi: čuvanje, lista i pretraga (dijakritici), zamena zapisa u istoj transakciji kao stanje, kaskadno
// brisanje, izvozi i tri stanja izvoza. Svaki test radi nad privremenim fajlom baze, u običnom Node-u.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { WtCatalog } from '@core/catalog';
import { writeWtTab } from '@core/wtTab';
import wtCatalog from '../web/src/data/wt-catalog.json' with { type: 'json' };
import { openDatabase, type AppDatabase } from '../src/main/db';
import {
  computeExportStatus,
  createJob,
  deleteJob,
  findBySource,
  getJob,
  jobExports,
  listJobs,
  recordExports,
  saveJob,
  sha256,
  updateJobMeta,
  type ExportToRecord,
} from '../src/main/db/jobs';
import { foldText, searchPatterns, searchText } from '../src/main/db/search';
import { newJobState } from '../src/renderer/job/defaults';
import type { JobState } from '../src/shared/job';
import type { JobSave, SavedPart } from '../src/shared/jobs';

const catalog = wtCatalog as unknown as WtCatalog;
const MIGRATIONS = resolve(import.meta.dirname, '../migrations');

let dir: string;
let db: AppDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csv2tab-jobs-'));
  db = openDatabase({ file: join(dir, 'csv2tab.db'), migrationsDir: MIGRATIONS, catalog });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const rows = (q: string, ...a: (string | number)[]) => db.sqlite.prepare(q).all(...a) as Record<string, unknown>[];
const n = (q: string, ...a: (string | number)[]) => Object.values(rows(q, ...a)[0])[0] as number;

const state = (extra: Partial<JobState> = {}): JobState => ({ ...newJobState(), ...extra });
const part = (material: string, name: string, dim1 = 1000, qty = 1): SavedPart => ({ material, wt: '', dim1, dim2: 300, edge1: 0, edge2: 0, grain: 0, qty, name });

/** Izlazni fajl za materijal iz zapisa; `variant` menja bajtove (druga količina prvog zapisa). */
function output(material: string, name: string, parts: SavedPart[], variant = 0) {
  const mine = parts.filter((p) => p.material === material).map((p) => ({ dim1: p.dim1, dim2: p.dim2, edge1: p.edge1, edge2: p.edge2, grain: p.grain, qty: p.qty, name: p.name }));
  if (variant) mine[0] = { ...mine[0], qty: mine[0].qty + variant };
  return { material, name, count: mine.length, bytes: writeWtTab(mine) };
}
function save(parts: SavedPart[], names: Record<string, string> = {}, variants: Record<string, number> = {}, st = state()): JobSave {
  const mats = [...new Set(parts.map((p) => p.material))];
  return { state: st, parts, outputs: mats.map((m) => output(m, names[m] ?? `${m || 'zapisi'}.tab`, parts, variants[m] ?? 0)) };
}
const file = (name = 'lista.csv', body = 'a;b') => ({ name, kind: 'csv' as const, bytes: new TextEncoder().encode(body), path: null });
const toRecord = (s: JobSave, only?: string[], result: 'written' | 'identical' = 'written'): ExportToRecord[] =>
  s.outputs.filter((o) => !only || only.includes(o.material)).map((o) => ({ material: o.material, fileName: o.name, folder: '/wt', bytes: o.bytes, count: o.count, result }));

const P3 = [part('A', 'a1'), part('A', 'a2', 1100), part('B', 'b1'), part('C', 'c1')];

describe('čuvanje i čitanje posla', () => {
  it('izvorni bajtovi, stanje, zapisi i izlazni fajlovi se čuvaju; lista daje sažetak bez zapisa', () => {
    const st = state({ merge: false, edits: { 'A#2': { qty: 7 } } });
    const id = createJob(db.sqlite, 'Kuhinja', { ...file('Kuhinja.csv', 'x;y;z'), path: '/tmp/Kuhinja.csv' }, save(P3, {}, {}, st), 1_700_000_000_000);
    const j = getJob(db.sqlite, id)!;
    expect(j.name).toBe('Kuhinja');
    expect(j.state).toEqual(st);
    expect(j.stateError).toBeNull();
    expect(new TextDecoder().decode(j.file.bytes)).toBe('x;y;z');
    expect(j.file).toMatchObject({ name: 'Kuhinja.csv', kind: 'csv' });
    expect(j.partCount).toBe(4);
    expect(j.materials).toEqual(['A', 'B', 'C']);
    expect(j.status).toBe('never');
    expect(j.outputs.map((o) => [o.material, o.name, o.count, o.state])).toEqual([['A', 'A.tab', 2, 'never'], ['B', 'B.tab', 1, 'never'], ['C', 'C.tab', 1, 'never']]);
    const raw = rows('SELECT source_path, source_size, source_sha256, created_at FROM jobs WHERE id = ?', id)[0];
    expect(raw).toEqual({ source_path: '/tmp/Kuhinja.csv', source_size: 5, source_sha256: sha256(new TextEncoder().encode('x;y;z')), created_at: 1_700_000_000_000 });
    const parts = rows('SELECT * FROM job_parts WHERE job_id = ? ORDER BY position', id);
    expect(parts).toHaveLength(4);
    expect(parts[1]).toMatchObject({ position: 1, material: 'A', dim1: 1100, dim2: 300, qty: 1, name: 'a2' });
    const list = listJobs(db.sqlite, { text: '', offset: 0, limit: 10 });
    expect(list.items[0]).not.toHaveProperty('parts');
    expect(list.items[0]).not.toHaveProperty('file');
  });

  it('prevučen fajl nema putanju', () => {
    const id = createJob(db.sqlite, 'X', file(), save([part('A', 'a')]));
    expect(rows('SELECT source_path FROM jobs WHERE id = ?', id)[0].source_path).toBeNull();
  });

  it('čuvanje zamenjuje stanje i zapise, a izvorni bajtovi i heš ostaju isti', () => {
    const id = createJob(db.sqlite, 'X', file('l.csv', 'bajtovi'), save(P3), 1000);
    const before = rows('SELECT source_bytes, source_sha256, created_at FROM jobs WHERE id = ?', id)[0];
    const r = saveJob(db.sqlite, id, save([part('A', 'novo'), part('A', 'novo2')], {}, {}, state({ merge: false })), 2000);
    expect(r.updatedAt).toBe(2000);
    updateJobMeta(db.sqlite, id, { name: 'Preimenovan', note: 'napomena' }, 3000);
    expect(rows('SELECT source_bytes, source_sha256, created_at FROM jobs WHERE id = ?', id)[0]).toEqual(before);
    const j = getJob(db.sqlite, id)!;
    expect(j.state?.merge).toBe(false);
    expect(j.partCount).toBe(2);
    expect(rows('SELECT name FROM job_parts WHERE job_id = ? ORDER BY position', id).map((x) => x.name)).toEqual(['novo', 'novo2']);
    expect(j.materials).toEqual(['A']);
    expect([j.name, j.note, j.updatedAt]).toEqual(['Preimenovan', 'napomena', 3000]);
  });

  it('neuspelo čuvanje ne ostavlja pola posla: stanje i zapisi ostaju stari', () => {
    const id = createJob(db.sqlite, 'X', file(), save(P3, {}, {}, state({ merge: true })));
    const broken = save([part('A', 'x'), part('A', 'y')], {}, {}, state({ merge: false }));
    broken.parts[1] = { ...broken.parts[1], name: undefined as unknown as string }; // SQLite odbija undefined usred upisa
    expect(() => saveJob(db.sqlite, id, broken)).toThrow();
    const j = getJob(db.sqlite, id)!;
    expect(j.state?.merge).toBe(true);
    expect(rows('SELECT name FROM job_parts WHERE job_id = ? ORDER BY position', id).map((x) => x.name)).toEqual(['a1', 'a2', 'b1', 'c1']);
    expect(() => saveJob(db.sqlite, 9999, save([part('A', 'a')]))).toThrow(/ne postoji/);
  });

  it('neuspelo kreiranje ne ostavlja posao ni zapise', () => {
    const broken = save([part('A', 'x'), part('A', 'y')]);
    broken.parts[1] = { ...broken.parts[1], qty: undefined as unknown as number };
    expect(() => createJob(db.sqlite, 'X', file(), broken)).toThrow();
    expect(n('SELECT count(*) FROM jobs')).toBe(0);
    expect(n('SELECT count(*) FROM job_parts')).toBe(0);
  });

  it('brisanje posla briše zapise i izvoze (kaskadno); ostali poslovi ostaju', () => {
    const s = save(P3);
    const a = createJob(db.sqlite, 'A', file('a.csv', '1'), s);
    const b = createJob(db.sqlite, 'B', file('b.csv', '2'), s);
    recordExports(db.sqlite, a, toRecord(s));
    recordExports(db.sqlite, b, toRecord(s));
    expect(n('SELECT count(*) FROM exports')).toBe(6);
    deleteJob(db.sqlite, a);
    expect(n('SELECT count(*) FROM jobs')).toBe(1);
    expect(n('SELECT count(*) FROM job_parts WHERE job_id = ?', a)).toBe(0);
    expect(n('SELECT count(*) FROM exports WHERE job_id = ?', a)).toBe(0);
    expect(n('SELECT count(*) FROM job_parts WHERE job_id = ?', b)).toBe(4);
    expect(n('SELECT count(*) FROM exports WHERE job_id = ?', b)).toBe(3);
    expect(() => deleteJob(db.sqlite, a)).toThrow(/ne postoji/);
  });

  it('isti izvorni fajl: findBySource nalazi poslove po SHA-256, najnoviji prvi', () => {
    const s = save([part('A', 'a')]);
    const a = createJob(db.sqlite, 'prvi', file('l.csv', 'isto'), s, 1000);
    const b = createJob(db.sqlite, 'drugi', file('druga.csv', 'isto'), s, 2000);
    createJob(db.sqlite, 'treći', file('t.csv', 'drugo'), s, 3000);
    expect(findBySource(db.sqlite, sha256(new TextEncoder().encode('isto'))).map((j) => j.id)).toEqual([b, a]);
    expect(findBySource(db.sqlite, sha256(new TextEncoder().encode('nema')))).toEqual([]);
  });

  it('stanje koje ne prolazi proveru daje poruku, ne grešku; posao se i dalje čita i briše', () => {
    const id = createJob(db.sqlite, 'X', file(), save([part('A', 'a')]));
    db.sqlite.prepare('UPDATE jobs SET state = ? WHERE id = ?').run(JSON.stringify({ ...state(), version: 3 }), id);
    let j = getJob(db.sqlite, id)!;
    expect(j.state).toBeNull();
    expect(j.stateError).toMatch(/novijom verzijom/);
    expect(j.file.bytes.length).toBeGreaterThan(0);
    db.sqlite.prepare('UPDATE jobs SET state = ? WHERE id = ?').run('{nije json', id);
    j = getJob(db.sqlite, id)!;
    expect(j.state).toBeNull();
    expect(j.stateError).toMatch(/oštećeno/);
    db.sqlite.prepare('UPDATE jobs SET state = ? WHERE id = ?').run(JSON.stringify({ ...state(), merge: 'da' }), id);
    expect(getJob(db.sqlite, id)!.stateError).toMatch(/merge/);
    deleteJob(db.sqlite, id);
  });
});

describe('stanje izvoza', () => {
  const setup = () => {
    const s = save(P3);
    const id = createJob(db.sqlite, 'X', file(), s);
    return { s, id };
  };
  const status = (id: number) => getJob(db.sqlite, id)!.status;
  const listStatus = (id: number) => listJobs(db.sqlite, { text: '', offset: 0, limit: 50 }).items.find((j) => j.id === id)!.exportStatus;

  it('nikad izvezen -> izvezen i nepromenjen (isto i u listi, bez otvaranja posla)', () => {
    const { s, id } = setup();
    expect(listStatus(id)).toBe('never');
    recordExports(db.sqlite, id, toRecord(s));
    expect(listStatus(id)).toBe('current');
    expect(getJob(db.sqlite, id)!.lastExportAt).not.toBeNull();
  });

  it('tri materijala, jedan izmenjen: posao je menjan, a samo taj fajl je "changed"', () => {
    const { s, id } = setup();
    recordExports(db.sqlite, id, toRecord(s));
    saveJob(db.sqlite, id, save(P3, {}, { B: 1 }));
    expect(listStatus(id)).toBe('changed');
    const per = Object.fromEntries(jobExports(db.sqlite, id).outputs.map((o) => [o.material, o.state]));
    expect(per).toEqual({ A: 'current', B: 'changed', C: 'current' });
    // izvoz samo izmenjenog materijala vraća posao u "nepromenjen"
    recordExports(db.sqlite, id, toRecord(save(P3, {}, { B: 1 }), ['B']));
    expect(listStatus(id)).toBe('current');
  });

  it('izmena pa vraćanje izmene vraća na "nepromenjen" (porede se bajtovi, ne istorija)', () => {
    const { s, id } = setup();
    recordExports(db.sqlite, id, toRecord(s));
    saveJob(db.sqlite, id, save(P3, {}, { A: 3 }));
    expect(status(id)).toBe('changed');
    saveJob(db.sqlite, id, save(P3));
    expect(status(id)).toBe('current');
  });

  it('izvoz izmenjenog pa vraćanje na staro daje "changed" (poslednji izvoz je merodavan)', () => {
    const { s, id } = setup();
    recordExports(db.sqlite, id, toRecord(s));
    const v1 = save(P3, {}, { A: 1 });
    saveJob(db.sqlite, id, v1);
    recordExports(db.sqlite, id, toRecord(v1, ['A']));
    expect(status(id)).toBe('current');
    saveJob(db.sqlite, id, s);
    expect(status(id)).toBe('changed');
  });

  it('promenjeno ime izlaznog fajla posle izvoza: novi fajl nije izvezen, posao je "changed"; izvoz pod novim imenom ga vraća', () => {
    const { s, id } = setup();
    recordExports(db.sqlite, id, toRecord(s));
    const renamed = save(P3, { A: 'Novo ime.tab' });
    saveJob(db.sqlite, id, renamed);
    expect(status(id)).toBe('changed');
    expect(jobExports(db.sqlite, id).outputs.find((o) => o.material === 'A')?.state).toBe('never');
    recordExports(db.sqlite, id, toRecord(renamed, ['A']));
    expect(status(id)).toBe('current');
    // stari izvoz pod starim imenom ostaje u istoriji, ali se ne računa
    expect(jobExports(db.sqlite, id).exports.map((e) => e.fileName).sort()).toEqual(['A.tab', 'B.tab', 'C.tab', 'Novo ime.tab']);
  });

  it('ime fajla se poredi bez razlike u veličini slova', () => {
    const { s, id } = setup();
    recordExports(db.sqlite, id, toRecord(s));
    saveJob(db.sqlite, id, save(P3, { A: 'a.TAB' }));
    expect(status(id)).toBe('current');
  });

  it('preskočen izvoz (korisnik nije potvrdio prepisivanje) se ne beleži: delimično izvezen posao je "changed"', () => {
    const { s, id } = setup();
    recordExports(db.sqlite, id, toRecord(s, ['A', 'C'])); // B je preskočen
    expect(status(id)).toBe('changed');
    expect(jobExports(db.sqlite, id).outputs.find((o) => o.material === 'B')?.state).toBe('never');
    // preskočeno prepisivanje posle izmene: stari izvoz ostaje merodavan, pa je posao i dalje "changed"
    recordExports(db.sqlite, id, toRecord(s, ['B']));
    expect(status(id)).toBe('current');
    saveJob(db.sqlite, id, save(P3, {}, { C: 2 }));
    expect(status(id)).toBe('changed');
    // nikakav novi zapis u istoriji (preskočeno) ne menja stanje
    expect(jobExports(db.sqlite, id).exports).toHaveLength(3);
    expect(status(id)).toBe('changed');
  });

  it('isti fajl već u folderu se beleži kao "identical" i važi kao izvoz', () => {
    const { s, id } = setup();
    const j = recordExports(db.sqlite, id, toRecord(s, undefined, 'identical'));
    expect(j.status).toBe('current');
    expect(j.exports.map((e) => e.result)).toEqual(['identical', 'identical', 'identical']);
    expect(rows('SELECT size, record_count FROM exports WHERE job_id = ? AND material = ?', id, 'A')[0]).toEqual({ size: 165 + 2 * 79, record_count: 2 });
  });

  it('tačni bajtovi izvoza su sačuvani (heš odgovara bajtovima)', () => {
    const { s, id } = setup();
    recordExports(db.sqlite, id, toRecord(s, ['A']));
    const r = rows('SELECT sha256, bytes FROM exports WHERE job_id = ?', id)[0];
    expect(sha256(r.bytes as Uint8Array)).toBe(r.sha256);
    expect(Buffer.from(r.bytes as Uint8Array).equals(Buffer.from(s.outputs[0].bytes))).toBe(true);
  });

  it('posao koji je izvezen, a sad nema izlaznih fajlova, je "changed"', () => {
    const { s, id } = setup();
    recordExports(db.sqlite, id, toRecord(s));
    saveJob(db.sqlite, id, { state: state(), parts: [], outputs: [] });
    expect(status(id)).toBe('changed');
  });

  it('čista funkcija: poslednji izvoz pod imenom je merodavan', () => {
    const o = { material: 'A', name: 'A.tab', sha256: 'h2', count: 1 };
    expect(computeExportStatus([o], []).status).toBe('never');
    expect(computeExportStatus([o], [{ fileName: 'A.tab', sha256: 'h2' }, { fileName: 'A.tab', sha256: 'h1' }]).status).toBe('current');
    expect(computeExportStatus([o], [{ fileName: 'A.tab', sha256: 'h1' }, { fileName: 'A.tab', sha256: 'h2' }]).status).toBe('changed');
  });

  it('beleženje izvoza za nepostojeći posao ne upisuje ništa', () => {
    const s = save(P3);
    expect(() => recordExports(db.sqlite, 4242, toRecord(s))).toThrow(/ne postoji/);
    expect(n('SELECT count(*) FROM exports')).toBe(0);
  });
});

describe('lista i pretraga', () => {
  const make = (name: string, parts: SavedPart[], at: number, extra: { note?: string; file?: string } = {}) => {
    const id = createJob(db.sqlite, name, file(extra.file ?? `${name}.csv`, name), save(parts), at);
    if (extra.note) updateJobMeta(db.sqlite, id, { note: extra.note }, at);
    return id;
  };
  const find = (text: string) => listJobs(db.sqlite, { text, offset: 0, limit: 50 }).items.map((j) => j.name);

  it('najnoviji prvi, sa stranicama i ukupnim brojem', () => {
    for (let i = 1; i <= 7; i++) make(`posao ${i}`, [part('A', 'x')], i * 1000);
    const p1 = listJobs(db.sqlite, { text: '', offset: 0, limit: 3 });
    expect(p1.total).toBe(7);
    expect(p1.items.map((j) => j.name)).toEqual(['posao 7', 'posao 6', 'posao 5']);
    expect(listJobs(db.sqlite, { text: '', offset: 6, limit: 3 }).items.map((j) => j.name)).toEqual(['posao 1']);
  });

  it('dijakritici i velika slova: "sto" nalazi "što" i obrnuto, č/ć/š/ž/đ', () => {
    make('Što je to', [part('A', 'a')], 1);
    make('ČAMAC', [part('A', 'a')], 2);
    make('ćošak', [part('A', 'a')], 3);
    make('Žaluzine', [part('A', 'a')], 4);
    make('Radnja', [part('A', 'a')], 5);
    expect(find('sto')).toEqual(['Što je to']);
    expect(find('ŠTO')).toEqual(['Što je to']);
    expect(find('što')).toEqual(['Što je to']);
    expect(find('camac')).toEqual(['ČAMAC']);
    expect(find('čamac')).toEqual(['ČAMAC']);
    expect(find('cosak')).toEqual(['ćošak']);
    expect(find('ĆOŠAK')).toEqual(['ćošak']);
    expect(find('zaluzine')).toEqual(['Žaluzine']);
    expect(find('ŽALUZ')).toEqual(['Žaluzine']);
  });

  it('SQLite sam ne svodi slova van ASCII (zato se tekst sklapa u JS)', () => {
    const r = db.sqlite.prepare("SELECT lower('Š') AS l, 'ŠTO' LIKE 'što' AS lk").get() as { l: string; lk: number };
    expect(r.l).toBe('Š');
    expect(r.lk).toBe(0);
  });

  it('đ: nalazi se i kao "d" i kao "dj", u imenu posla i u nazivu dela', () => {
    make('Đorđe kuhinja', [part('A', 'Pod Đurđa')], 1);
    make('Drugi', [part('A', 'stranica')], 2);
    for (const q of ['dorde', 'djordje', 'ĐORĐE', 'đorđe', 'durda', 'djurdja', 'ĐURĐA']) expect(find(q), q).toEqual(['Đorđe kuhinja']);
    expect(foldText('Đorđe', true)).toBe('djordje');
    expect(searchText('Đ')).toBe('d\ndj');
  });

  it('nalazi po materijalu, nazivu dela, imenu fajla, napomeni i WT šifri', () => {
    const p = { ...part('Egger H1145', 'Polica žuta'), wt: 'U-702' };
    make('Prvi', [p], 1, { file: 'ormar_spavaća.csv', note: 'Za Mileta, hitno' });
    make('Drugi', [part('Kronospan 018', 'Vrata')], 2);
    expect(find('egger')).toEqual(['Prvi']);
    expect(find('polica zuta')).toEqual(['Prvi']);
    expect(find('spavaca')).toEqual(['Prvi']);
    expect(find('mileta hitno')).toEqual(['Prvi']);
    expect(find('u-702')).toEqual(['Prvi']);
    expect(find('vrata')).toEqual(['Drugi']);
    expect(find('egger vrata')).toEqual([]); // sve reči moraju da se nađu u istom poslu
  });

  it('nalazi po datumu (dd.mm.gggg i gggg-mm-dd)', () => {
    const at = new Date(2026, 2, 5, 12, 0).getTime();
    make('Martovski', [part('A', 'a')], at);
    make('Drugi', [part('A', 'a')], new Date(2026, 9, 10, 12, 0).getTime());
    expect(find('05.03.2026')).toEqual(['Martovski']);
    expect(find('2026-03')).toEqual(['Martovski']);
    expect(find('10.10.2026')).toEqual(['Drugi']);
  });

  it('% i _ se tretiraju kao obični znaci, a prazan upit vraća sve', () => {
    make('Popust 50%', [part('A', 'a')], 1);
    make('Popust 500', [part('A', 'a')], 2);
    make('a_b', [part('A', 'a')], 3);
    make('axb', [part('A', 'a')], 4);
    expect(find('50%')).toEqual(['Popust 50%']);
    expect(find('a_b')).toEqual(['a_b']);
    expect(find('   ')).toHaveLength(4);
    expect(searchPatterns("a\\b'c")).toEqual(["%a\\\\b'c%"]);
  });

  it('preimenovanje i napomena odmah ulaze u pretragu, stari naziv se ne nalazi', () => {
    const id = make('Stari naziv', [part('A', 'a')], 1, { file: 'izvor.csv' });
    updateJobMeta(db.sqlite, id, { name: 'Novi naziv', note: 'čekić' });
    expect(find('stari')).toEqual([]);
    expect(find('novi')).toEqual(['Novi naziv']);
    expect(find('cekic')).toEqual(['Novi naziv']);
  });

  it('izmena zapisa menja pretragu po nazivu dela', () => {
    const id = make('Posao', [part('A', 'staro ime')], 1);
    saveJob(db.sqlite, id, save([part('A', 'novo ime')]));
    expect(find('staro')).toEqual([]);
    expect(find('novo ime')).toEqual(['Posao']);
  });

  it('nekoliko hiljada poslova: lista i pretraga ostaju brze od pola sekunde', () => {
    const t0 = performance.now();
    for (let i = 0; i < 3000; i++) {
      const parts = Array.from({ length: 20 }, (_, k) => part(['Egger H1145', 'Kronospan K001', 'U702'][k % 3], `Deo ${i}-${k}`, 500 + k, 1));
      createJob(db.sqlite, `Posao ${i}`, file(`p${i}.csv`, `bajt${i}`), { state: state(), parts, outputs: [] }, 1_700_000_000_000 + i * 60000);
    }
    const built = performance.now() - t0;
    const time = (text: string, offset = 0) => {
      const t = performance.now();
      const r = listJobs(db.sqlite, { text, offset, limit: 50 });
      return { ms: performance.now() - t, total: r.total, first: r.items[0]?.name };
    };
    const all = time('');
    const deep = time('', 2950);
    const hit = time('Deo 2999-19');
    const wide = time('kronospan');
    const miss = time('nema nigde');
    console.log(
      `3000 poslova (20 zapisa): upis ${Math.round(built)} ms; lista ${all.ms.toFixed(1)} ms, kraj liste ${deep.ms.toFixed(1)} ms, ` +
        `pogodak ${hit.ms.toFixed(1)} ms, svi ${wide.ms.toFixed(1)} ms (${wide.total}), bez pogotka ${miss.ms.toFixed(1)} ms`,
    );
    expect(all.total).toBe(3000);
    expect(all.first).toBe('Posao 2999');
    expect(hit.total).toBe(1);
    expect(wide.total).toBe(3000);
    expect(miss.total).toBe(0);
    for (const t of [all, deep, hit, wide, miss]) expect(t.ms).toBeLessThan(500);
  }, 120_000);
});
