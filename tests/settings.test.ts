// Nova podešavanja (tabela kantovanja, pravilo za dekore, spajanje, folder za kopije): stroge provere i granica operacije.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { WtCatalog } from '@core/catalog';
import { DEFAULT_EDGE_RULES } from '@core/parts';
import wtCatalog from '../web/src/data/wt-catalog.json' with { type: 'json' };
import { openDatabase, type AppDatabase } from '../src/main/db';
import { getAllSettings, getSetting, setSetting } from '../src/main/db/settings';
import { settingsOperations } from '../src/main/operations/settings';
import type { IpcContext } from '../src/main/operations/types';
import { EDGE_RULE_LIMITS, edgeRulesProblem, sameEdgeRules } from '../src/shared/edgeRules';
import { SETTINGS, checkSetting, isFolderSetting, isSettingKey } from '../src/shared/settings';

let dir: string;
let db: AppDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csv2tab-set-'));
  db = openDatabase({ file: join(dir, 'csv2tab.db'), migrationsDir: resolve(import.meta.dirname, '../migrations'), catalog: wtCatalog as unknown as WtCatalog });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const R = (a: number, b: number, code: number) => ({ a, b, code });

describe('tabela šifara kantovanja', () => {
  it('podrazumevana tabela jezgra je ispravna i to je podrazumevana vrednost', () => {
    expect(edgeRulesProblem(DEFAULT_EDGE_RULES)).toBeNull();
    expect(sameEdgeRules(SETTINGS.edgeRules.default, DEFAULT_EDGE_RULES)).toBe(true);
    expect(SETTINGS.edgeRules.default).not.toBe(DEFAULT_EDGE_RULES);
  });
  it('prihvata ispravne izmene', () => {
    for (const v of [[R(0, 0, 0)], [R(0, 0, 0), R(0.5, 2, 7), R(2, 2, 255)], [R(0.001, 50, 3)], [...DEFAULT_EDGE_RULES, R(0, 2, 6)]]) {
      expect(edgeRulesProblem(v), JSON.stringify(v)).toBeNull();
      expect(checkSetting('edgeRules', v)).toBe(v);
    }
  });
  it('odbija duplikat istog para, i obrnutog redosleda i sa greškom zaokruživanja', () => {
    expect(edgeRulesProblem([R(0, 0.5, 1), R(0.5, 0, 2)])).toMatch(/Redovi 1 i 2/);
    expect(edgeRulesProblem([R(1, 1, 4), R(1, 1, 4)])).toMatch(/istu kombinaciju/);
    expect(edgeRulesProblem([R(0.5, 1, 5), R(1.0004, 0.5, 6)])).toMatch(/istu kombinaciju/);
    expect(edgeRulesProblem([R(0.5, 1, 5), R(1.01, 0.5, 6)])).toBeNull();
  });
  it('odbija loš oblik, tip i opseg', () => {
    const bad: unknown[] = [
      null, 'x', {}, [], 5,
      [R(0, 0, -1)], [R(0, 0, 256)], [R(0, 0, 1.5)], [R(-1, 0, 1)], [R(0, 51, 1)],
      [{ a: 0, b: 0 }], [{ a: '0', b: 0, code: 1 }], [{ a: Number.NaN, b: 0, code: 1 }], [{ a: Infinity, b: 0, code: 1 }],
      [{ a: 0, b: 0, code: 1, extra: 1 }], [null], [[0, 0, 1]],
      Array.from({ length: EDGE_RULE_LIMITS.rules + 1 }, (_, i) => R(i / 100, 0, i % 256)),
    ];
    for (const v of bad) {
      expect(edgeRulesProblem(v), JSON.stringify(v)).toEqual(expect.any(String));
      expect(() => checkSetting('edgeRules', v)).toThrow();
    }
  });
});

describe('ostala nova podešavanja', () => {
  it('logička podešavanja primaju samo true/false', () => {
    for (const k of ['decorRule', 'mergeDefault'] as const) {
      expect(isSettingKey(k)).toBe(true);
      expect(isFolderSetting(k)).toBe(false);
      expect(settingsDefault(k)).toBe(true);
      expect(checkSetting(k, false)).toBe(false);
      for (const bad of ['da', 1, 0, null, undefined, {}]) expect(() => checkSetting(k, bad), `${k} ${String(bad)}`).toThrow();
    }
  });
  it('folder za rezervne kopije je folder-podešavanje: renderer ga ne zadaje', () => {
    expect(isFolderSetting('backupFolder')).toBe(true);
    expect(isFolderSetting('wtFolder')).toBe(true);
    expect(isFolderSetting('theme')).toBe(false);
    expect(isFolderSetting('edgeRules')).toBe(false);
    const ops = settingsOperations({ db } as unknown as IpcContext);
    expect(() => ops['settings.set'].validate(['backupFolder', '/tmp'])).toThrow(/dijalogu/);
    expect(() => ops['settings.set'].validate(['wtFolder', '/tmp'])).toThrow(/dijalogu/);
    expect(ops['settings.set'].validate(['decorRule', false])).toEqual(['decorRule', false]);
    expect(() => ops['settings.set'].validate(['decorRule', 'ne'])).toThrow();
    expect(() => ops['settings.set'].validate(['edgeRules', [R(1, 1, 4), R(1, 1, 5)]])).toThrow();
    expect(() => ops['settings.set'].validate(['nema', 1])).toThrow(/Nepoznat/);
  });
  it('IPC čitanje vraća samo nazive oba foldera; puna putanja ostaje u bazi', () => {
    const folder = join(dir, 'WT folder');
    setSetting(db.sqlite, 'wtFolder', folder);
    setSetting(db.sqlite, 'backupFolder', 'C:\\Users\\neko\\Kopije');
    const ops = settingsOperations({ db } as unknown as IpcContext);
    expect(ops['settings.get'].run('wtFolder')).toBe('WT folder');
    expect(ops['settings.get'].run('backupFolder')).toBe('Kopije');
    expect(ops['settings.all'].run()).toMatchObject({ wtFolder: 'WT folder', backupFolder: 'Kopije', theme: 'system' });
    expect(getSetting(db.sqlite, 'wtFolder')).toBe(folder);
    expect(getSetting(db.sqlite, 'backupFolder')).toBe('C:\\Users\\neko\\Kopije');
  });
  it('upis i čitanje posle ponovnog otvaranja; oštećena vrednost vraća podrazumevanu', () => {
    const rules = [R(0, 0, 0), R(0.5, 0.5, 2)];
    setSetting(db.sqlite, 'edgeRules', rules);
    setSetting(db.sqlite, 'decorRule', false);
    setSetting(db.sqlite, 'mergeDefault', false);
    const file = db.file;
    db.close();
    db = openDatabase({ file, migrationsDir: resolve(import.meta.dirname, '../migrations') });
    expect(getAllSettings(db.sqlite)).toMatchObject({ edgeRules: rules, decorRule: false, mergeDefault: false });
    db.sqlite.prepare("UPDATE settings SET value = '[{\"a\":1,\"b\":1,\"code\":4},{\"a\":1,\"b\":1,\"code\":5}]' WHERE key = 'edgeRules'").run();
    expect(sameEdgeRules(getSetting(db.sqlite, 'edgeRules'), DEFAULT_EDGE_RULES)).toBe(true);
  });
});

function settingsDefault(k: keyof typeof SETTINGS) {
  return SETTINGS[k].default;
}
