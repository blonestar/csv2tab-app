import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { folderName, fileErrorMessage } from '../src/main/fileNames';

describe('putanje ostaju u glavnom procesu', () => {
  it('prikazuje samo naziv i za Linux i za Windows putanje, uključujući kopiju vraćenu na drugom sistemu', () => {
    expect(folderName('/home/neko/WT folder/')).toBe('WT folder');
    expect(folderName('C:\\Users\\neko\\WT folder\\')).toBe('WT folder');
    expect(folderName('\\\\server\\deljeno\\Kopije')).toBe('Kopije');
    for (const root of ['/', 'C:\\']) expect(folderName(root)).toBe('Izabrani folder');
    expect(folderName('')).toBe('');
  });
  it('čuva razlog greške bez izvorne i odredišne putanje, a obične poruke ostavlja čitljive', () => {
    const error = Object.assign(new Error('ENOENT: rename /privatno/baza /privatno/kopija'), { code: 'ENOENT', path: '/privatno/baza', dest: '/privatno/kopija' });
    expect(fileErrorMessage(error)).toBe('Operacija sa fajlom nije uspela (ENOENT).');
    expect(fileErrorMessage(new Error('Baza je zauzeta.'))).toBe('Baza je zauzeta.');
  });
  it('stvarna SQLite greška otvaranja kopije ne otkriva putanju iz message', () => {
    const file = join(tmpdir(), randomUUID(), 'copy.db');
    const db = new DatabaseSync(':memory:');
    try {
      let error: unknown;
      try { db.prepare('VACUUM INTO ?').run(file); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(Error);
      expect(fileErrorMessage(error)).toBe('Operacija sa fajlom nije uspela (ERR_SQLITE_ERROR).');
      expect(fileErrorMessage(error)).not.toContain(file);
    } finally { db.close(); }
  });
});
