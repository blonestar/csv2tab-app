import { describe, expect, it } from 'vitest';
import { exportFileName } from '../src/main/exportName';

describe('exportFileName: ime iz renderera -> osnovno ime sa .tab', () => {
  it('običan naziv dobija .tab; postojeća ekstenzija se ne udvaja', () => {
    expect(exportFileName('H1137 18 mm ABS')).toBe('H1137 18 mm ABS.tab');
    expect(exportFileName('U-702 18 mm.tab')).toBe('U-702 18 mm.tab');
    expect(exportFileName('x.TAB')).toBe('x.tab');
    expect(exportFileName('x.tab.tab')).toBe('x.tab');
    expect(exportFileName('Šareni dekor č ć ž')).toBe('Šareni dekor č ć ž.tab');
  });
  it('odseca foldere i separatore bilo koje vrste', () => {
    expect(exportFileName('../../etc/passwd')).toBe('passwd.tab');
    expect(exportFileName('..\\..\\Windows\\win.ini')).toBe('win.ini.tab');
    expect(exportFileName('C:\\Users\\x\\a.tab')).toBe('a.tab');
    expect(exportFileName('/abs/path/a')).toBe('a.tab');
    expect(exportFileName('a/b/')).toBe('list.tab');
  });
  it('".." i tačke ne ostaju kao ime', () => {
    for (const n of ['..', '.', '...', '. . .', ' ', '', '/', '\\']) expect(exportFileName(n), JSON.stringify(n)).toBe('list.tab');
    expect(exportFileName('a..b')).toBe('a..b.tab');
  });
  it('nedozvoljeni znakovi Windowsa i kontrolni znakovi postaju _', () => {
    expect(exportFileName('a:b*c?"d<e>f|g')).toBe('a_b_c_d_e_f_g.tab');
    expect(exportFileName('a\u0000b\nc\u007f')).toBe('a_b_c_.tab');
    expect(exportFileName('C:x')).toBe('C_x.tab');
  });
  it('tačka i razmak na kraju (Windows ih guta) se skidaju', () => {
    expect(exportFileName('naziv. . ')).toBe('naziv.tab');
    expect(exportFileName('   naziv  ')).toBe('naziv.tab');
    expect(exportFileName('naziv.')).toBe('naziv.tab');
  });
  it('rezervisana imena Windowsa, i sa ekstenzijom, dobijaju prefiks', () => {
    for (const n of ['CON', 'con', 'PRN', 'aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9', 'CON.tab', 'nul.txt', 'COM1 ']) {
      expect(exportFileName(n), n).toMatch(/^_/);
    }
    expect(exportFileName('CONSOLE')).toBe('CONSOLE.tab');
    expect(exportFileName('COM10')).toBe('COM10.tab');
    expect(exportFileName('COM0')).toBe('_COM0.tab');
  });
  it('predugačko ime se skraćuje', () => {
    const n = exportFileName('a'.repeat(500));
    expect(n.length).toBeLessThanOrEqual(124);
    expect(n.endsWith('.tab')).toBe(true);
  });
  it('nije tekst: greška', () => {
    for (const bad of [undefined, null, 1, {}, ['a'], new Uint8Array(2)]) expect(() => exportFileName(bad)).toThrow();
  });
  it('rezultat nikad ne sadrži separator ni počinje tačkom koja izlazi iz foldera', () => {
    const nasty = ['..%2f..', 'a/../b', '....//....//x', '..\\', '\\\\server\\share\\f', '.hidden', 'a\\..\\..\\b'];
    for (const n of nasty) {
      const r = exportFileName(n);
      expect(r, n).not.toMatch(/[\\/]/);
      expect(r, n).not.toBe('..tab');
      expect(r.replace(/\.tab$/, ''), n).not.toMatch(/^\.+$/);
    }
  });
});
