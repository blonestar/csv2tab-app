// Ime fajla iz renderera -> bezbedno osnovno ime sa ekstenzijom .tab (bez separatora, ".." i rezervisanih imena
// Windowsa). Čista funkcija; poslednja linija odbrane pre upisa na disk.

const MAX_BASE = 120;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

export function exportFileName(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Ime fajla mora biti tekst.');
  // samo poslednja komponenta: bez foldera, ma kakvi separatori bili
  let base = input.split(/[\\/]/).pop() ?? '';
  base = base.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, '_');
  // ekstenzija .tab se forsira; ako je već ima, ne udvaja se
  base = base.replace(/(\.tab)+$/i, '');
  // Windows ne dozvoljava tačku ni razmak na kraju; razmak na početku se takođe skida
  base = base.replace(/[. ]+$/, '').replace(/^\s+/, '');
  if (base.length > MAX_BASE) base = base.slice(0, MAX_BASE).replace(/[. ]+$/, '');
  // rezervisano ime važi i sa ekstenzijom ("CON.x"), pa se proverava deo do prve tačke
  if (RESERVED.test(base.split('.')[0].trimEnd())) base = `_${base}`;
  if (!base || /^\.+$/.test(base)) base = 'list';
  return `${base}.tab`;
}
