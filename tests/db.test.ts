import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WtCatalog } from '@core/catalog';
import wtCatalog from '../web/src/data/wt-catalog.json' with { type: 'json' };
import { DatabaseTooNewError, MigrationError, openDatabase, type AppDatabase } from '../src/main/db';
import { catalogHash, readCatalog, syncCatalog } from '../src/main/db/catalog';
import { getAllSettings, getSetting, setSetting } from '../src/main/db/settings';
import { DEFAULT_EDGE_RULES } from '@core/parts';
import { expectedTables } from '../src/main/db/backup';
import { isSettingKey } from '../src/shared/settings';

const catalog = wtCatalog as unknown as WtCatalog;
const REAL_MIGRATIONS = resolve(import.meta.dirname, '../migrations');

let dir: string;
let opened: AppDatabase[];
const file = () => join(dir, 'csv2tab.db');
const open = (o: Partial<Parameters<typeof openDatabase>[0]> = {}) => {
  const db = openDatabase({ file: file(), migrationsDir: REAL_MIGRATIONS, catalog, ...o });
  opened.push(db);
  return db;
};
const count = (db: AppDatabase, sql: string) => (db.sqlite.prepare(sql).get() as { n: number }).n;

/** Folder sa migracijama iz mape { '0001_a.sql': 'SQL' }. */
function migrationsDir(files: Record<string, string>): string {
  const d = mkdtempSync(join(dir, 'mig-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(d, name), sql);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csv2tab-db-'));
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

describe('prazna baza', () => {
  it('dobija najnoviju šemu i ceo ugrađeni katalog', () => {
    const db = open();
    const latest = readdirSync(REAL_MIGRATIONS).filter((f) => f.endsWith('.sql')).length;
    expect(db.schemaVersion).toBe(latest);
    expect(db.backupPath).toBeNull();
    expect(count(db, 'SELECT count(*) AS n FROM materials')).toBe(catalog.materials.length);
    expect(count(db, 'SELECT count(*) AS n FROM edge_bands')).toBe(catalog.edgeBands.length);
    expect(count(db, "SELECT count(*) AS n FROM materials WHERE source <> 'builtin'")).toBe(0);
    const tables = (db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['jobs', 'job_parts', 'exports', 'material_map', 'column_maps']));
    // spisak očekivanih tabela po verziji (provera kopije pri vraćanju) mora da prati migracije
    expect(tables.filter((t) => !t.startsWith('sqlite_')).sort()).toEqual(expectedTables(latest).sort());
  });
  it('koristi WAL i uključene strane ključeve', () => {
    const db = open();
    expect(db.sqlite.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    expect(db.sqlite.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });
  });
  it('katalog iz baze ima isti oblik i redosled kao JSON', () => {
    const db = open();
    expect(readCatalog(db.sqlite)).toEqual({ materials: catalog.materials, edgeBands: catalog.edgeBands });
  });
  it('ponovno otvaranje ništa ne menja i ne pravi kopiju', () => {
    open().close();
    const db = open();
    expect(db.backupPath).toBeNull();
    expect(count(db, 'SELECT count(*) AS n FROM materials')).toBe(catalog.materials.length);
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toEqual([]);
  });
  it('šifre ugrađenog kataloga su jedinstvene', () => {
    expect(new Set(catalog.materials.map((m) => m.code)).size).toBe(catalog.materials.length);
    expect(new Set(catalog.edgeBands.map((b) => b.code)).size).toBe(catalog.edgeBands.length);
  });
});

describe('migracije', () => {
  const v1 = { '0001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT);' };
  const v2 = { ...v1, '0002_b.sql': 'ALTER TABLE a ADD COLUMN y TEXT DEFAULT \'novo\'; CREATE TABLE b (id INTEGER);' };

  it('prethodna šema se podiže, podaci prežive, kopija je napravljena', () => {
    const first = openDatabase({ file: file(), migrationsDir: migrationsDir(v1) });
    first.sqlite.prepare('INSERT INTO a (x) VALUES (?)').run('staro');
    first.close();

    const db = openDatabase({ file: file(), migrationsDir: migrationsDir(v2) });
    opened.push(db);
    expect(db.schemaVersion).toBe(2);
    expect(db.sqlite.prepare('SELECT x, y FROM a').all()).toEqual([{ x: 'staro', y: 'novo' }]);

    expect(db.backupPath).toBe(`${file()}.v1.bak`);
    const copy = new DatabaseSync(db.backupPath!, { readOnly: true });
    expect(copy.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
    expect(copy.prepare('SELECT x FROM a').all()).toEqual([{ x: 'staro' }]);
    expect(() => copy.prepare('SELECT y FROM a').all()).toThrow();
    copy.close();
  });

  it('neuspela migracija se poništava, verzija ostaje, dalje se ne ide', () => {
    openDatabase({ file: file(), migrationsDir: migrationsDir(v1) }).close();
    const bad = migrationsDir({
      ...v1,
      '0002_b.sql': 'CREATE TABLE b (id INTEGER); INSERT INTO nema_tabele VALUES (1);',
      '0003_c.sql': 'CREATE TABLE c (id INTEGER);',
    });
    expect(() => openDatabase({ file: file(), migrationsDir: bad })).toThrow(MigrationError);

    const raw = new DatabaseSync(file());
    expect(raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
    const names = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(names).toContain('a');
    expect(names).not.toContain('b');
    expect(names).not.toContain('c');
    raw.close();
  });

  it('odbija pogrešan redosled ili ime migracije', () => {
    expect(() => openDatabase({ file: file(), migrationsDir: migrationsDir({ '0002_a.sql': 'SELECT 1;' }) })).toThrow(/redosled/);
    expect(() => openDatabase({ file: file(), migrationsDir: migrationsDir({ 'init.sql': 'SELECT 1;' }) })).toThrow(/redosled/);
  });
});

describe('migracija 0001 -> 0002 (poslovi)', () => {
  it('podešavanja i katalog iz šeme 1 prežive, kopija šeme 1 je napravljena, tabele poslova postoje', () => {
    // prava prva migracija, bez druge
    const only1 = mkdtempSync(join(dir, 'real1-'));
    writeFileSync(join(only1, '0001_init.sql'), readFileSync(join(REAL_MIGRATIONS, '0001_init.sql')));
    const old = openDatabase({ file: file(), migrationsDir: only1, catalog });
    expect(old.schemaVersion).toBe(1);
    setSetting(old.sqlite, 'theme', 'dark');
    old.sqlite.prepare("INSERT INTO materials (source, code, name, sheet_w, sheet_h, thickness, grain) VALUES ('user', 'MOJ', 'Moj materijal', 2800, 2070, 18, 1)").run();
    old.close();

    const db = open();
    expect(db.schemaVersion).toBe(3); // sve do tekuće; ovde se proverava samo da šema 1 prežive i ima tabele poslova
    expect(db.backupPath).toBe(`${file()}.v1.bak`);
    expect(getSetting(db.sqlite, 'theme')).toBe('dark');
    expect(count(db, 'SELECT count(*) AS n FROM materials')).toBe(catalog.materials.length + 1);
    expect(count(db, 'SELECT count(*) AS n FROM edge_bands')).toBe(catalog.edgeBands.length);
    expect(count(db, 'SELECT count(*) AS n FROM jobs')).toBe(0);
    const copy = new DatabaseSync(db.backupPath!, { readOnly: true });
    expect(copy.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'jobs'").all()).toEqual([]);
    expect(copy.prepare("SELECT value FROM settings WHERE key = 'theme'").get()).toMatchObject({ value: '"dark"' });
    copy.close();
    // ponovno otvaranje: nema nove kopije ni izmena
    db.close();
    expect(open().backupPath).toBeNull();
  });
});

describe('migracija 0002 -> 0003 (pamćenje izbora)', () => {
  it('poslovi, izvozi i podešavanja prežive, kopija šeme 2 je napravljena, nove tabele su prazne', () => {
    const only12 = mkdtempSync(join(dir, 'real12-'));
    for (const f of ['0001_init.sql', '0002_poslovi.sql']) writeFileSync(join(only12, f), readFileSync(join(REAL_MIGRATIONS, f)));
    const old = openDatabase({ file: file(), migrationsDir: only12, catalog });
    expect(old.schemaVersion).toBe(2);
    setSetting(old.sqlite, 'theme', 'light');
    const state = JSON.stringify({ version: 1, encoding: 'auto', delimiter: 'auto', sheet: 0, mapping: 'auto', merge: true, materials: { U702: { wt: 'U-702' } }, edits: {} });
    old.sqlite
      .prepare(
        `INSERT INTO jobs (name, created_at, updated_at, source_name, source_kind, source_size, source_sha256, state, source_bytes)
         VALUES ('Stari posao', 1, 2, 'a.csv', 'csv', 3, 'ab', ?, ?)`,
      )
      .run(state, new Uint8Array([1, 2, 3]));
    old.sqlite.prepare("INSERT INTO job_parts (job_id, position, material, wt_code, dim1, dim2, edge1, edge2, grain, qty, name) VALUES (1, 0, 'U702', 'U-702', 1, 2, 0, 0, 0, 1, 'x')").run();
    old.sqlite.prepare("INSERT INTO exports (job_id, material, file_name, folder, exported_at, record_count, size, sha256, result, bytes) VALUES (1, 'U702', 'x.tab', '/wt', 2, 1, 3, 'ab', 'written', ?)").run(new Uint8Array([4, 5, 6]));
    old.close();

    const db = open();
    expect(db.schemaVersion).toBe(3);
    expect(db.backupPath).toBe(`${file()}.v2.bak`);
    expect(getSetting(db.sqlite, 'theme')).toBe('light');
    expect(db.sqlite.prepare('SELECT name, state FROM jobs').all()).toEqual([{ name: 'Stari posao', state }]); // stanje se ne prepisuje u migraciji
    expect(count(db, 'SELECT count(*) AS n FROM job_parts')).toBe(1);
    expect(db.sqlite.prepare('SELECT bytes FROM exports').get()).toMatchObject({ bytes: new Uint8Array([4, 5, 6]) });
    expect(count(db, 'SELECT count(*) AS n FROM material_map')).toBe(0);
    expect(count(db, 'SELECT count(*) AS n FROM column_maps')).toBe(0);
    const copy = new DatabaseSync(db.backupPath!, { readOnly: true });
    expect(copy.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE name IN ('material_map', 'column_maps')").all()).toEqual([]);
    expect(copy.prepare('SELECT count(*) AS n FROM jobs').get()).toMatchObject({ n: 1 });
    copy.close();
  });
});

describe('novija baza', () => {
  it('se ne otvara i fajl ostaje bajt-po-bajt isti', () => {
    const raw = new DatabaseSync(file());
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1);');
    raw.exec('PRAGMA user_version = 99');
    raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    raw.close();
    const before = readFileSync(file());

    let err: unknown;
    try {
      openDatabase({ file: file(), migrationsDir: REAL_MIGRATIONS, catalog });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DatabaseTooNewError);
    expect((err as DatabaseTooNewError).dbVersion).toBe(99);
    expect(readFileSync(file()).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toEqual([]);
    expect(existsSync(`${file()}-wal`) && readFileSync(`${file()}-wal`).length > 0).toBe(false);
  });
});

describe('katalog', () => {
  it('izmenjen katalog osvežava ugrađene redove i ne dira korisnikove', () => {
    const db = open();
    db.sqlite
      .prepare("INSERT INTO materials (source, code, name, sheet_w, sheet_h, thickness, grain) VALUES ('user', ?, 'Moj', 2800, 2070, 18, 0)")
      .run(catalog.materials[0].code); // ista šifra kao ugrađeni red je dozvoljena
    db.sqlite.prepare("INSERT INTO edge_bands (source, code, name) VALUES ('user', 'MOJA', 'Moja traka')").run();
    const firstId = (db.sqlite.prepare("SELECT id FROM materials WHERE source = 'builtin' AND code = ?").get(catalog.materials[0].code) as { id: number }).id;

    const [a, b, ...rest] = catalog.materials;
    const changed: WtCatalog = {
      materials: [{ ...a, name: 'PROMENJEN NAZIV', thickness: 25 }, ...rest.slice(0, 3), { name: 'NOVI', code: 'NOVI-1', sheet: [2800, 2070], thickness: 18, grain: 1 }],
      edgeBands: catalog.edgeBands.slice(0, 2),
    };
    expect(b).toBeDefined();
    expect(catalogHash(changed)).not.toBe(catalogHash(catalog));
    expect(syncCatalog(db.sqlite, changed)).toBe(true);
    expect(syncCatalog(db.sqlite, changed)).toBe(false); // isti otisak: nema posla

    const rows = db.sqlite.prepare("SELECT code, name, thickness FROM materials WHERE source = 'builtin' ORDER BY position").all();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ code: a.code, name: 'PROMENJEN NAZIV', thickness: 25 });
    expect(rows[4]).toMatchObject({ code: 'NOVI-1' });
    expect(count(db, "SELECT count(*) AS n FROM edge_bands WHERE source = 'builtin'")).toBe(2);
    // id ugrađenog reda ostaje isti
    expect((db.sqlite.prepare("SELECT id FROM materials WHERE source = 'builtin' AND code = ?").get(a.code) as { id: number }).id).toBe(firstId);
    // korisnikovi redovi su tu, na kraju
    expect(count(db, "SELECT count(*) AS n FROM materials WHERE source = 'user'")).toBe(1);
    expect(count(db, "SELECT count(*) AS n FROM edge_bands WHERE source = 'user'")).toBe(1);
    const cat = readCatalog(db.sqlite);
    expect(cat.materials.at(-1)?.name).toBe('Moj');
    expect(cat.edgeBands.at(-1)?.code).toBe('MOJA');
  });

  it('neuspelo osvežavanje ne ostavlja pola posla', () => {
    const db = open();
    const broken = { materials: [{ ...catalog.materials[0], name: 'X' }, { ...catalog.materials[1], grain: 7 }], edgeBands: [] } as WtCatalog;
    expect(() => syncCatalog(db.sqlite, broken)).toThrow();
    expect(count(db, 'SELECT count(*) AS n FROM materials')).toBe(catalog.materials.length);
    expect(readCatalog(db.sqlite).materials[0].name).toBe(catalog.materials[0].name);
  });

  it('restart sa istim katalogom ne dira bazu', () => {
    open().close();
    const db = open();
    expect(syncCatalog(db.sqlite, catalog)).toBe(false);
  });
});

describe('podešavanja', () => {
  it('podrazumevana vrednost, upis i čitanje posle ponovnog otvaranja', () => {
    let db = open();
    expect(getSetting(db.sqlite, 'theme')).toBe('system');
    expect(setSetting(db.sqlite, 'theme', 'dark')).toBe('dark');
    db.close();
    db = open();
    expect(getSetting(db.sqlite, 'theme')).toBe('dark');
    expect(getAllSettings(db.sqlite)).toEqual({ theme: 'dark', wtFolder: '', backupFolder: '', edgeRules: DEFAULT_EDGE_RULES, decorRule: true, mergeDefault: true });
  });
  it('odbija pogrešan tip i nepoznatu vrednost, a stara vrednost ostaje', () => {
    const db = open();
    setSetting(db.sqlite, 'theme', 'light');
    for (const bad of ['plava', 1, null, undefined, {}, ['dark']]) expect(() => setSetting(db.sqlite, 'theme', bad)).toThrow();
    expect(getSetting(db.sqlite, 'theme')).toBe('light');
  });
  it('nepoznat ključ nije dozvoljen', () => {
    for (const k of ['nema', '__proto__', 'constructor', 'toString', '', 1, null]) expect(isSettingKey(k), String(k)).toBe(false);
    expect(isSettingKey('theme')).toBe(true);
    const db = open();
    expect(() => setSetting(db.sqlite, 'nema' as never, 'x')).toThrow();
  });
  it('oštećena upisana vrednost se tumači kao podrazumevana', () => {
    const db = open();
    db.sqlite.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'nije json')").run();
    expect(getSetting(db.sqlite, 'theme')).toBe('system');
  });
});

