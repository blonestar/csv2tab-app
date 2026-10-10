// Pretraga poslova: SQLite-ov lower() i LIKE ne svode slova van ASCII (š, č, ć, ž, đ), pa se tekst za pretragu
// sklapa u JavaScript-u: mala slova, bez dijakritika (NFD bez kombinujućih znakova). Upit se svodi na isti način,
// pa "sto" nalazi "što", a "ŠTO" nalazi "sto". Đ: latinica ga piše i kao "dj", pa tekst sa đ ide u indeks u oba
// oblika (đ → d i đ → dj), a upit "dorde" i "djordje" nalaze "Đorđe".

const MAX_TERMS = 8;
const MAX_TERM = 100;

export function foldText(s: string, dj: boolean): string {
  return s
    .toLowerCase()
    .replace(/đ/g, dj ? 'dj' : 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Tekst koji se čuva u `jobs.search`. */
export function searchText(s: string): string {
  const plain = foldText(s, false);
  return /đ/i.test(s) ? `${plain}\n${foldText(s, true)}` : plain;
}

/** LIKE uzorci za upit: jedan po reči (sve moraju da se nađu). Prazan upit = nema uslova. */
export function searchPatterns(query: string): string[] {
  return foldText(query, true)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .map((t) => `%${t.slice(0, MAX_TERM).replace(/[\\%_]/g, '\\$&')}%`);
}
