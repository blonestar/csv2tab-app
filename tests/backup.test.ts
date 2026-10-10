// Rezervna kopija i vraćanje baze na nivou fajlova (bez Electrona): kopija se otvara i ima poslove; vraćanje zamenjuje
// podatke, migrira stariju kopiju, odbija novu/tuđu/oštećenu i pri odbijanju ostavlja tekuću bazu netaknutu.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WtCatalog } from '@core/catalog';
import wtCatalog from '../web/src/data/wt-catalog.json' with { type: 'json' };
import { openDatabase, type AppDatabase, type OpenOptions } from '../src/main/db';
import { BackupError, createBackup, discardStaged, inspectDatabaseFile, restoreDatabase, stageBackup } from '../src/main/db/backup';
import { createJob } from '../src/main/db/jobs';
import { applyMemoryUpdate, listMemory } from '../src/main/db/memory';
import { getSetting, setSetting } from '../src/main/db/settings';
import { newJobState } from '../src/renderer/job/defaults';
import { getJob } from '../src/main/db/jobs';

const catalog = wtCatalog as unknown as WtCatalog;
const MIGRATIONS = resolve(import.meta.dirname, '../migrations');
const LATEST = 3;

let dir: string;
let opened: AppDatabase[];
const live = () => join(dir, 'userData', 'csv2tab.db');
const opts = (): OpenOptions => ({ file: live(), migrationsDir: MIGRATIONS, catalog });
const open = (o: Partial<OpenOptions> = {}) => {
  const db = openDatabase({ ...opts(), ...o });
  opened.push(db);
  return db;
};
const save = { state: newJobState(), parts: [], outputs: [] };
const file = (name: string) => ({ name, kind: 'csv' as const, bytes: new TextEncoder().encode(name), path: null });
const jobNames = (db: AppDatabase) => (db.sqlite.prepare('SELECT name FROM jobs ORDER BY id').all() as { name: string }[]).map((r) => r.name);
const staged = () => `${live()}.restore-tmp`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csv2tab-bak-'));
  mkdirSync(join(dir, 'userData'));
  mkdirSync(join(dir, 'kopije'));
  opened = [];
});
afterEach(() => {
  for (const db of opened) {
    try {
      db.close();
    } catch {
      // već zatvorena
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/** Tekuća baza sa dva posla i jednim zapamćenim izborom; vraća se otvorena. */
function currentDb() {
  const db = open();
  createJob(db.sqlite, 'Tekući A', file('a.csv'), save, 1000);
  createJob(db.sqlite, 'Tekući B', file('b.csv'), save, 2000);
  setSetting(db.sqlite, 'theme', 'dark');
  return db;
}

/** Fajl kopije sa drugim sadržajem (jedan posao), napravljen običnom kopijom. */
function makeBackup(name: string, jobs: string[], theme: 'light' | 'dark' = 'light'): string {
  const other = join(dir, `src-${name}`);
  mkdirSync(other);
  const db = openDatabase({ file: join(other, 'csv2tab.db'), migrationsDir: MIGRATIONS, catalog });
  jobs.forEach((j, i) => createJob(db.sqlite, j, file(`${j}.csv`), save, 5000 + i));
  setSetting(db.sqlite, 'theme', theme);
  applyMemoryUpdate(db.sqlite, { materials: [{ name: 'Iz kopije', wt: 'X' }] });
  const r = createBackup(db, join(dir, 'kopije'), LATEST, new Date(2026, 9, 10, 8, 30, 0));
  db.close();
  return r.file;
}

describe('rezervna kopija', () => {
  it('pravi celovit fajl sa datumom u imenu koji se otvara i ima poslove i pamćenje', () => {
    const db = currentDb();
    applyMemoryUpdate(db.sqlite, { materials: [{ name: 'U702', wt: 'U-702' }] });
    const r = createBackup(db, join(dir, 'kopije'), LATEST, new Date(2026, 9, 10, 14, 3, 9));
    expect(r.name).toBe('csv2tab-2026-10-10_14-03-09.db');
    expect(r.jobs).toBe(2);
    expect(r.schemaVersion).toBe(LATEST);
    expect(r.size).toBeGreaterThan(0);
    expect(readdirSync(join(dir, 'kopije'))).toEqual([r.name]); // bez .part ostataka
    // kopija je samostalan fajl (bez -wal) i radi bez originala
    const copy = new DatabaseSync(r.file, { readOnly: true });
    expect((copy.prepare('SELECT name FROM jobs ORDER BY id').all() as { name: string }[]).map((x) => x.name)).toEqual(['Tekući A', 'Tekući B']);
    expect(copy.prepare('SELECT count(*) AS n FROM material_map').get()).toMatchObject({ n: 1 });
    expect(copy.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    copy.close();
    expect(r.newestJobAt).toBe(2000);
  });
  it('isto ime u istoj sekundi dobija sufiks, ne prepisuje staru kopiju', () => {
    const db = currentDb();
    const when = new Date(2026, 0, 2, 3, 4, 5);
    const a = createBackup(db, join(dir, 'kopije'), LATEST, when);
    const b = createBackup(db, join(dir, 'kopije'), LATEST, when);
    expect(b.name).toBe('csv2tab-2026-01-02_03-04-05-2.db');
    expect(existsSync(a.file) && existsSync(b.file)).toBe(true);
  });
  it('folder koji ne postoji ili nije folder je greška na srpskom', () => {
    const db = currentDb();
    expect(() => createBackup(db, join(dir, 'nema'), LATEST)).toThrow(/ne postoji/);
    writeFileSync(join(dir, 'fajl'), 'x');
    expect(() => createBackup(db, join(dir, 'fajl'), LATEST)).toThrow(/nije folder/);
  });
  it('tekuća baza ostaje upotrebljiva i neizmenjena posle kopiranja', () => {
    const db = currentDb();
    createBackup(db, join(dir, 'kopije'), LATEST);
    createJob(db.sqlite, 'Posle', file('c.csv'), save);
    expect(jobNames(db)).toEqual(['Tekući A', 'Tekući B', 'Posle']);
  });
});

describe('provera fajla za vraćanje', () => {
  const refuses = (f: string, re: RegExp, version = LATEST) => {
    expect(() => inspectDatabaseFile(f, version)).toThrow(BackupError);
    expect(() => inspectDatabaseFile(f, version)).toThrow(re);
  };
  it('ispravna kopija: broj poslova i datum najnovijeg', () => {
    const b = makeBackup('ok', ['P1', 'P2', 'P3']);
    expect(inspectDatabaseFile(b, LATEST)).toMatchObject({ schemaVersion: LATEST, jobs: 3, newestJobAt: 5002 });
  });
  it('fajl koji nije baza (tekst, prazan, ne postoji, folder)', () => {
    writeFileSync(join(dir, 'tekst.db'), 'ovo nije baza, samo tekst koji je dovoljno dug');
    writeFileSync(join(dir, 'prazan.db'), '');
    refuses(join(dir, 'tekst.db'), /nije SQLite/);
    refuses(join(dir, 'prazan.db'), /nije SQLite/);
    refuses(join(dir, 'nema.db'), /ne postoji/);
    refuses(dir, /nije fajl/);
  });
  it('oštećena baza (odsečen fajl) ne prolazi', () => {
    const b = makeBackup('kvar', ['P1']);
    const big = join(dir, 'ostecena.db');
    copyFileSync(b, big);
    truncateSync(big, 4096 + 100);
    expect(() => inspectDatabaseFile(big, LATEST)).toThrow(BackupError);
  });
  it('tuđa SQLite baza: bez korisničke verzije ili bez tabela ove aplikacije', () => {
    const foreign = join(dir, 'tudja.db');
    const f = new DatabaseSync(foreign);
    f.exec('CREATE TABLE kontakti (id INTEGER PRIMARY KEY, ime TEXT); INSERT INTO kontakti VALUES (1, \'Pera\');');
    f.close();
    refuses(foreign, /nije baza ovog programa/);
    // tuđa baza koja slučajno ima user_version kao naša šema
    const f2 = new DatabaseSync(foreign);
    f2.exec('PRAGMA user_version = 2');
    f2.close();
    refuses(foreign, /nije baza ovog programa/);
    // naše tabele iz šeme 1, ali oglašava šemu 3: nedostaju tabele
    const half = join(dir, 'pola.db');
    const h = new DatabaseSync(half);
    h.exec(readFileSync(join(MIGRATIONS, '0001_init.sql'), 'utf8'));
    h.exec('PRAGMA user_version = 3');
    h.close();
    refuses(half, /nije baza ovog programa/);
    const fake = join(dir, 'lazna.db');
    const f3 = new DatabaseSync(fake);
    f3.exec('CREATE TABLE settings (x); CREATE TABLE meta (x); CREATE TABLE materials (x); CREATE TABLE edge_bands (x); PRAGMA user_version = 1;');
    f3.close();
    refuses(fake, /očekivanu šemu/);
  });
  it('kopija iz novije verzije programa se odbija sa jasnom porukom', () => {
    const b = makeBackup('nova', ['P1']);
    const nova = join(dir, 'nova.db');
    copyFileSync(b, nova);
    const n = new DatabaseSync(nova);
    n.exec('PRAGMA user_version = 99');
    n.close();
    refuses(nova, /novijom verzijom programa \(šema 99/);
  });
});

describe('vraćanje', () => {
  it('zamenjuje podatke i podešavanja, čuva sigurnosnu kopiju stare baze, nema zaostalih -wal/-shm', () => {
    const db = currentDb();
    const backup = makeBackup('vrati', ['Iz kopije 1', 'Iz kopije 2'], 'light');
    stageBackup(backup, staged(), LATEST);
    expect(existsSync(staged())).toBe(true);
    const r = restoreDatabase(db, staged(), opts(), new Date(2026, 9, 10, 15, 0, 0));
    Object.assign(db, r.db);

    expect(jobNames(db)).toEqual(['Iz kopije 1', 'Iz kopije 2']);
    expect(getSetting(db.sqlite, 'theme')).toBe('light');
    expect(listMemory(db.sqlite).materials.map((m) => m.key)).toEqual(['iz kopije']);
    expect(db.schemaVersion).toBe(LATEST);
    // otvoren i upotrebljiv za pisanje
    createJob(db.sqlite, 'Novi posle', file('n.csv'), save);
    expect(jobNames(db)).toHaveLength(3);

    // sigurnosna kopija stare baze pored žive
    expect(r.safetyCopy).toBe(`${live()}.pre-restore-2026-10-10_15-00-00`);
    const safe = new DatabaseSync(r.safetyCopy, { readOnly: true });
    expect((safe.prepare('SELECT name FROM jobs ORDER BY id').all() as { name: string }[]).map((x) => x.name)).toEqual(['Tekući A', 'Tekući B']);
    safe.close();
    expect(existsSync(staged())).toBe(false);
    // original kopije korisnika je netaknut
    expect(inspectDatabaseFile(backup, LATEST).jobs).toBe(2);
  });
  it('stariju kopiju (šema 2) migrira na tekuću šemu', () => {
    const db = currentDb();
    const old = join(dir, 'stara.db');
    const only12 = mkdtempSync(join(dir, 'm12-'));
    for (const f of ['0001_init.sql', '0002_poslovi.sql']) copyFileSync(join(MIGRATIONS, f), join(only12, f));
    const o = openDatabase({ file: old, migrationsDir: only12, catalog });
    const id = createJob(o.sqlite, 'Iz stare', file('s.csv'), save);
    const { edgeRules: _rules, decorRule: _decor, mappingFromMemory: _memory, ...oldState } = save.state;
    const raw = JSON.stringify({ ...oldState, version: 1 });
    o.sqlite.prepare('UPDATE jobs SET state = ? WHERE id = ?').run(raw, id);
    o.close();
    // stanje u staroj kopiji je verzija 1: ostaje čitljivo posle vraćanja
    expect(inspectDatabaseFile(old, LATEST).schemaVersion).toBe(2);
    const s = stageBackup(old, staged(), LATEST);
    expect(s).toMatchObject({ schemaVersion: 2, jobs: 1 });
    const r = restoreDatabase(db, staged(), opts());
    Object.assign(db, r.db);
    expect(db.schemaVersion).toBe(3);
    expect(jobNames(db)).toEqual(['Iz stare']);
    expect(db.sqlite.prepare('SELECT state FROM jobs').get()).toMatchObject({ state: raw });
    expect(getJob(db.sqlite, id)?.state?.version).toBe(2);
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM material_map').get()).toMatchObject({ n: 0 });
    // pomoćni .bak koji migracija pravi pored privremene kopije ne ostaje
    expect(readdirSync(join(dir, 'userData')).filter((f) => f.includes('.v') && f.endsWith('.bak'))).toEqual([]);
    expect(readdirSync(join(dir, 'userData')).filter((f) => f.includes('restore-tmp'))).toEqual([]);
  });

  /** Sve što se tiče tekuće baze: bajtovi fajla posle zatvaranja i sadržaj. */
  const snapshot = (db: AppDatabase) => ({ jobs: jobNames(db), theme: getSetting(db.sqlite, 'theme') });

  it('odbijanje (tuđa, oštećena, nova, tekst) ostavlja tekuću bazu tačno kakva je bila', () => {
    const db = currentDb();
    const before = snapshot(db);
    const nova = join(dir, 'nova.db');
    copyFileSync(makeBackup('n', ['X']), nova);
    const n = new DatabaseSync(nova);
    n.exec('PRAGMA user_version = 99');
    n.close();
    const foreign = join(dir, 'tudja.db');
    const f = new DatabaseSync(foreign);
    f.exec('CREATE TABLE t (x)');
    f.close();
    writeFileSync(join(dir, 'tekst.db'), 'tekst');
    for (const bad of [nova, foreign, join(dir, 'tekst.db'), join(dir, 'nema.db')]) {
      expect(() => stageBackup(bad, staged(), LATEST), bad).toThrow(BackupError);
      expect(existsSync(staged())).toBe(false);
    }
    expect(snapshot(db)).toEqual(before);
    db.close();
    // fajl žive baze je neizmenjen u smislu sadržaja posle ponovnog otvaranja, i nema sigurnosnih kopija
    const again = open();
    expect(snapshot(again)).toEqual(before);
    expect(readdirSync(join(dir, 'userData')).filter((x) => x.includes('pre-restore'))).toEqual([]);
  });
  it('neuspela migracija kopije ne dira tekuću bazu', () => {
    const db = currentDb();
    const before = snapshot(db);
    const old = join(dir, 'stara.db');
    const only12 = mkdtempSync(join(dir, 'm12-'));
    for (const f of ['0001_init.sql', '0002_poslovi.sql']) copyFileSync(join(MIGRATIONS, f), join(only12, f));
    openDatabase({ file: old, migrationsDir: only12, catalog }).close();
    stageBackup(old, staged(), LATEST);
    // migracije sa pokvarenom trećom
    const broken = mkdtempSync(join(dir, 'mbad-'));
    for (const f of ['0001_init.sql', '0002_poslovi.sql']) copyFileSync(join(MIGRATIONS, f), join(broken, f));
    writeFileSync(join(broken, '0003_x.sql'), 'INSERT INTO nema_tabele VALUES (1);');
    expect(() => restoreDatabase(db, staged(), { ...opts(), migrationsDir: broken })).toThrow(BackupError);
    expect(existsSync(staged())).toBe(false);
    expect(snapshot(db)).toEqual(before);
    createJob(db.sqlite, 'Još radi', file('r.csv'), save); // i dalje otvorena
    expect(jobNames(db)).toHaveLength(3);
  });
  it('greška posle zamene fajlova vraća staru bazu i otvara je', () => {
    const db = currentDb();
    const before = snapshot(db);
    stageBackup(makeBackup('r', ['Iz kopije']), staged(), LATEST);
    expect(() => restoreDatabase(db, staged(), opts(), new Date(), () => { throw new Error('simulirana greška'); })).toThrow(/ostala je trenutna baza/);
    expect(snapshot(db)).toEqual(before); // `db` je ponovo otvoren nad starim fajlom
    createJob(db.sqlite, 'Piše se', file('p.csv'), save);
    expect(jobNames(db)).toEqual(['Tekući A', 'Tekući B', 'Piše se']);
    expect(existsSync(staged())).toBe(false);
  });
  it('zauzet WAL ne sme da se ukloni niti trenutna baza da se zameni', () => {
    const db = currentDb();
    const reader = new DatabaseSync(live(), { readOnly: true });
    reader.exec('BEGIN');
    reader.prepare('SELECT * FROM jobs').all();
    createJob(db.sqlite, 'U WAL-u', file('wal.csv'), save);
    const before = jobNames(db);
    db.sqlite.exec('PRAGMA busy_timeout = 0');
    stageBackup(makeBackup('busy', ['Iz kopije']), staged(), LATEST);
    try {
      expect(() => restoreDatabase(db, staged(), opts())).toThrow(/Baza je zauzeta/);
      expect(jobNames(db)).toEqual(before);
      expect(existsSync(`${live()}-wal`)).toBe(true);
      expect(readdirSync(join(dir, 'userData')).some((n) => n.includes('pre-restore'))).toBe(false);
    } finally {
      reader.exec('ROLLBACK');
      reader.close();
    }
    db.close();
    expect(jobNames(open())).toEqual(before);
  });
  it('privremena kopija se briše na zahtev', () => {
    currentDb();
    stageBackup(makeBackup('c', ['X']), staged(), LATEST);
    discardStaged(staged());
    expect(existsSync(staged())).toBe(false);
  });
});
