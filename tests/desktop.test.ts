import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { filesFromArguments } from '../src/main/arguments';
import { restoreWindowState } from '../src/main/windowState';

describe('fajlovi iz argumenata', () => {
  it('razlikuje Electron razvoj i spakovanu aplikaciju, zadržava redosled i putanje sa razmacima', () => {
    const cwd = resolve('privremeni folder');
    expect(filesFromArguments(['electron', '/repo', '--user-data-dir=/tmp/proba.csv', 'Šuma 1.CSV', 'drugi.ods', 'stari.xls'], cwd, false))
      .toEqual([resolve(cwd, 'Šuma 1.CSV'), resolve(cwd, 'drugi.ods')]);
    expect(filesFromArguments(['csv2tab.exe', 'Šuma 1.CSV', '--flag', 'drugi.ods'], cwd, true))
      .toEqual([resolve(cwd, 'Šuma 1.CSV'), resolve(cwd, 'drugi.ods')]);
    expect(filesFromArguments(['electron', '/repo'], cwd, false)).toEqual([]);
  });
});

describe('položaj prozora', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1280, y: 0, width: 1280, height: 1024 }];
  const original = { x: -1200, y: 50, width: 1000, height: 700, maximized: false };
  it('čuva drugi ekran i stanje maksimizacije', () => {
    expect(restoreWindowState(JSON.stringify(original), areas)).toEqual(original);
    expect(restoreWindowState(JSON.stringify({ ...original, maximized: true }), areas)?.maximized).toBe(true);
  });
  it('isključen ekran, prevelik i delimično sakriven prozor vraća u radnu površinu', () => {
    expect(restoreWindowState(JSON.stringify(original), areas.slice(0, 1))).toEqual({ ...original, x: 0 });
    expect(restoreWindowState(JSON.stringify({ ...original, x: 1900, y: 1000, width: 4000, height: 3000 }), areas))
      .toEqual({ x: 0, y: 0, width: 1920, height: 1040, maximized: false });
    expect(restoreWindowState(JSON.stringify({ ...original, width: 10, height: 20 }), areas)?.width).toBe(760);
  });
  it('odbija oštećena stanja i bez ekrana koristi podrazumevani prozor', () => {
    for (const raw of [undefined, 'nije json', 'null', '[]', JSON.stringify({ ...original, x: 0.5 }), JSON.stringify({ ...original, width: -1 }), JSON.stringify({ ...original, maximized: 'da' })])
      expect(restoreWindowState(raw, areas)).toBeNull();
    expect(restoreWindowState(JSON.stringify(original), [])).toBeNull();
  });
});
