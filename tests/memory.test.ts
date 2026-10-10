// Pamćenje izbora: ključevi, upisi (postavi / obriši polje), uzimanje, brisanje, provera argumenata i atomično čuvanje posla.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { WtCatalog } from '@core/catalog';
import { FIELDS, type ColumnMapping } from '@core/parts';
import wtCatalog from '../web/src/data/wt-catalog.json' with { type: 'json' };
import { openDatabase, type AppDatabase } from '../src/main/db';
import { createJob, saveJobRemembering } from '../src/main/db/jobs';
import { applyMemoryUpdate, forgetMemory, listMemory, lookupMemory } from '../src/main/db/memory';
import { newJobState } from '../src/renderer/job/defaults';
import {
  SIGNATURE_SEP,
  headerSignature,
  mappingFitsColumns,
  memoryKey,
  memoryLookupArg,
  memoryUpdateArg,
  signatureColumns,
  type MemoryUpdate,
} from '../src/shared/memory';
import { jobSaveArg } from '../src/main/operations/validate';

let dir: string;
let db: AppDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csv2tab-mem-'));
  db = openDatabase({ file: join(dir, 'csv2tab.db'), migrationsDir: resolve(import.meta.dirname, '../migrations'), catalog: wtCatalog as unknown as WtCatalog });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const mapping = (over: Partial<ColumnMapping> = {}): ColumnMapping => ({ material: 0, length: 1, width: 2, qty: 3, designation: -1, edgeL1: -1, edgeL2: -1, edgeW1: -1, edgeW2: -1, ...over });
const upd = (...m: MemoryUpdate['materials']): MemoryUpdate => ({ materials: m });

describe('ključevi', () => {
  it('naziv materijala: razmaci, veličina slova i Unicode oblik ne prave novi ključ, dijakritici ostaju', () => {
    expect(memoryKey('  U702  ')).toBe('u702');
    expect(memoryKey('Kronospan   Stone\tOak')).toBe('kronospan stone oak');
    expect(memoryKey('ŠUMA')).toBe('šuma');
    expect(memoryKey('Suma')).not.toBe(memoryKey('Šuma'));
    expect(memoryKey('é')).toBe(memoryKey('é'));
    expect(memoryKey('   ')).toBe('');
  });
  it('potpis zaglavlja: BOM, razmaci i veličina slova se svode, prazne ćelije na kraju otpadaju, redosled je bitan', () => {
    const a = headerSignature(['﻿Material', ' Length  - RAW', 'Width - raw', '', '']);
    expect(a).toBe(['material', 'length - raw', 'width - raw'].join(SIGNATURE_SEP));
    expect(headerSignature(['material', 'length - raw', 'width - raw'])).toBe(a);
    expect(headerSignature(['length - raw', 'material', 'width - raw'])).not.toBe(a);
    expect(headerSignature(['material', '', 'length - raw'])).not.toBe(headerSignature(['material', 'length - raw']));
    expect(headerSignature(['', ' '])).toBeNull();
    expect(headerSignature([])).toBeNull();
    expect(headerSignature(undefined)).toBeNull();
    expect(signatureColumns(a!)).toBe(3);
    expect(headerSignature([`material${SIGNATURE_SEP}length`, 'width'])).toBeNull();
  });
  it('mapiranje mora da stane u zaglavlje', () => {
    expect(mappingFitsColumns(mapping(), 4)).toBe(true);
    expect(mappingFitsColumns(mapping({ qty: 4 }), 4)).toBe(false);
    expect(mappingFitsColumns(mapping({ length: -1 }), 4)).toBe(false); // obavezna kolona
    expect(mappingFitsColumns(mapping({ qty: -2 }), 4)).toBe(false);
  });
});

describe('material_map', () => {
  it('upis i čitanje po normalizovanom ključu; ključ rezultata je naziv kako je poslat', () => {
    applyMemoryUpdate(db.sqlite, upd({ name: ' U702 ', wt: 'U-702', band: 'ABS1', grain: 0 }), 1000);
    const found = lookupMemory(db.sqlite, { names: ['u702', 'U702  ', 'U703', ''], signature: null });
    expect(found.materials).toEqual({ u702: { wt: 'U-702', band: 'ABS1', grain: 0 }, 'U702  ': { wt: 'U-702', band: 'ABS1', grain: 0 } });
    expect(found.mapping).toBeNull();
    expect(listMemory(db.sqlite).materials).toEqual([{ key: 'u702', label: 'U702', wt: 'U-702', band: 'ABS1', grain: 0, updatedAt: 1000 }]);
  });
  it('„nijedan WT materijal" je zapamćen izbor, različit od „ništa nije zapamćeno"', () => {
    applyMemoryUpdate(db.sqlite, upd({ name: 'A', wt: null }, { name: 'B', band: '' }));
    expect(lookupMemory(db.sqlite, { names: ['A', 'B'], signature: null }).materials).toEqual({ A: { wt: null }, B: { band: '' } });
    expect(db.sqlite.prepare("SELECT wt_code FROM material_map WHERE name = 'a'").get()).toEqual({ wt_code: '' });
  });
  it('upis menja samo zadata polja; clear briše polje; red bez polja nestaje', () => {
    applyMemoryUpdate(db.sqlite, upd({ name: 'A', wt: 'X', band: 'B1', grain: 1 }), 1);
    applyMemoryUpdate(db.sqlite, upd({ name: 'a', band: 'B2' }), 2);
    expect(listMemory(db.sqlite).materials[0]).toMatchObject({ wt: 'X', band: 'B2', grain: 1, updatedAt: 2 });
    applyMemoryUpdate(db.sqlite, upd({ name: 'A', clear: ['wt', 'grain'] }), 3);
    expect(listMemory(db.sqlite).materials[0]).toEqual({ key: 'a', label: 'A', band: 'B2', updatedAt: 3 });
    applyMemoryUpdate(db.sqlite, upd({ name: 'A', clear: ['band'] }), 4);
    expect(listMemory(db.sqlite).materials).toEqual([]);
  });
  it('brisanje jednog i svih', () => {
    applyMemoryUpdate(db.sqlite, upd({ name: 'A', wt: 'X' }, { name: 'B', wt: 'Y' }));
    expect(forgetMemory(db.sqlite, 'material', 'a')).toBe(1);
    expect(forgetMemory(db.sqlite, 'material', 'a')).toBe(0);
    expect(listMemory(db.sqlite).materials.map((m) => m.key)).toEqual(['b']);
    expect(forgetMemory(db.sqlite, 'material', null)).toBe(1);
  });
  it('nepoznata šifra u bazi se vraća kakva je (renderer odlučuje da li je u katalogu)', () => {
    applyMemoryUpdate(db.sqlite, upd({ name: 'A', wt: 'NEMA-TAKVE' }));
    expect(lookupMemory(db.sqlite, { names: ['A'], signature: null }).materials.A.wt).toBe('NEMA-TAKVE');
  });
});

describe('column_maps', () => {
  const sig = headerSignature(['material', 'length - raw', 'width - raw', 'quantity'])!;
  it('upis, čitanje, zamena i brisanje', () => {
    applyMemoryUpdate(db.sqlite, { materials: [], mapping: { signature: sig, mapping: mapping() } }, 5);
    expect(lookupMemory(db.sqlite, { names: [], signature: sig }).mapping).toEqual(mapping());
    expect(lookupMemory(db.sqlite, { names: [], signature: sig + 'x' }).mapping).toBeNull();
    applyMemoryUpdate(db.sqlite, { materials: [], mapping: { signature: sig, mapping: mapping({ qty: -1 }) } }, 6);
    const list = listMemory(db.sqlite);
    expect(list.mappings).toEqual([{ signature: sig, header: ['material', 'length - raw', 'width - raw', 'quantity'], mapping: mapping({ qty: -1 }), updatedAt: 6 }]);
    expect(forgetMemory(db.sqlite, 'mapping', sig)).toBe(1);
    expect(listMemory(db.sqlite).mappings).toEqual([]);
  });
  it('zapis koji ne stane u zaglavlje ili je oštećen se ne primenjuje (indeks kolone koje fajl nema)', () => {
    const run = db.sqlite.prepare('INSERT INTO column_maps (signature, mapping, updated_at) VALUES (?, ?, 1)');
    run.run(sig, JSON.stringify(mapping({ qty: 9 })));
    expect(lookupMemory(db.sqlite, { names: [], signature: sig }).mapping).toBeNull();
    db.sqlite.prepare('UPDATE column_maps SET mapping = ?').run('nije json');
    expect(lookupMemory(db.sqlite, { names: [], signature: sig }).mapping).toBeNull();
    expect(listMemory(db.sqlite).mappings).toEqual([]);
  });
});

describe('provera argumenata', () => {
  const sig = headerSignature(['material', 'length - raw', 'width - raw', 'quantity'])!;
  it('ispravan upis prolazi', () => {
    const u: MemoryUpdate = { materials: [{ name: 'U702', wt: null, band: '', grain: 1 }, { name: 'A', clear: ['wt'] }], mapping: { signature: sig, mapping: mapping() } };
    expect(memoryUpdateArg(u)).toEqual(u);
    expect(memoryUpdateArg({ materials: [] })).toEqual({ materials: [] });
  });
  it('odbija loše oblike', () => {
    const bad: unknown[] = [
      null, [], 5, { materials: 'x' }, { materials: [], extra: 1 },
      { materials: [{ name: '' }] }, { materials: [{ name: '   ' }] }, { materials: [{ name: 5 }] }, { materials: [{ name: 'x'.repeat(301) }] },
      { materials: [{ name: 'A', wt: '' }] }, { materials: [{ name: 'A', wt: 3 }] }, { materials: [{ name: 'A', band: 3 }] },
      { materials: [{ name: 'A', grain: 2 }] }, { materials: [{ name: 'A', boja: 'x' }] },
      { materials: [{ name: 'A', clear: ['fileName'] }] }, { materials: [{ name: 'A', clear: 'wt' }] }, { materials: [{ name: 'A', wt: 'X', clear: ['wt'] }] },
      { materials: Array.from({ length: 2001 }, (_, i) => ({ name: `m${i}`, wt: 'X' })) },
      { materials: [], mapping: { signature: '', mapping: mapping() } },
      { materials: [], mapping: { signature: sig, mapping: mapping({ qty: 4 }) } }, // kolona koje nema
      { materials: [], mapping: { signature: sig, mapping: mapping({ length: -1 }) } },
      { materials: [], mapping: { signature: sig, mapping: { ...mapping(), nepoznato: 1 } } },
      { materials: [], mapping: { signature: sig, mapping: { ...mapping(), qty: 1.5 } } },
      { materials: [], mapping: { signature: sig, mapping: mapping(), extra: 1 } },
      { materials: [], mapping: { signature: 'x'.repeat(2001), mapping: mapping() } },
    ];
    for (const [i, v] of bad.entries()) expect(() => memoryUpdateArg(v), `slučaj ${i}`).toThrow();
    for (const v of [null, {}, { names: 'x', signature: null }, { names: [5], signature: null }, { names: [], signature: 5 }, { names: [], signature: '' }, { names: [], signature: null, extra: 1 }]) expect(() => memoryLookupArg(v)).toThrow();
    expect(memoryLookupArg({ names: ['a'], signature: null })).toEqual({ names: ['a'], signature: null });
    expect(FIELDS.length).toBe(9);
  });
  it('pamćenje stiže i kroz čuvanje posla i tamo se proverava', () => {
    const base = { state: newJobState(), parts: [], outputs: [] };
    expect(jobSaveArg({ ...base, remember: { materials: [{ name: 'A', wt: 'X' }] } }).remember).toEqual({ materials: [{ name: 'A', wt: 'X' }] });
    expect(jobSaveArg(base).remember).toBeUndefined();
    expect(() => jobSaveArg({ ...base, remember: { materials: [{ name: 'A', grain: 7 }] } })).toThrow();
  });
});

describe('čuvanje posla zajedno sa pamćenjem', () => {
  const file = { name: 'a.csv', kind: 'csv' as const, bytes: new Uint8Array([1]), path: null };
  const save = { state: newJobState(), parts: [], outputs: [] };
  it('oba se upisuju u istoj transakciji', () => {
    const id = createJob(db.sqlite, 'X', file, save);
    saveJobRemembering(db.sqlite, id, { ...save, remember: upd({ name: 'A', wt: 'X' }) });
    expect(listMemory(db.sqlite).materials).toHaveLength(1);
  });
  it('ako čuvanje posla padne, pamćenje se ne upisuje', () => {
    expect(() => saveJobRemembering(db.sqlite, 9999, { ...save, remember: upd({ name: 'A', wt: 'X' }) })).toThrow(/ne postoji/);
    expect(listMemory(db.sqlite).materials).toEqual([]);
    expect(db.sqlite.isTransaction).toBe(false);
  });
  it('ako pamćenje padne, ni posao se ne menja', () => {
    const id = createJob(db.sqlite, 'X', file, save);
    const before = db.sqlite.prepare('SELECT updated_at FROM jobs WHERE id = ?').get(id);
    const broken = { ...save, state: { ...save.state, merge: false }, remember: { materials: [{ name: 'A', grain: 5 as 0 }] } };
    expect(() => saveJobRemembering(db.sqlite, id, broken, 5_000_000_000_000)).toThrow();
    expect(db.sqlite.prepare('SELECT updated_at FROM jobs WHERE id = ?').get(id)).toEqual(before);
    expect(JSON.parse((db.sqlite.prepare('SELECT state FROM jobs WHERE id = ?').get(id) as { state: string }).state).merge).toBe(true);
  });
});
