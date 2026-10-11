// Širina kolona mišem: povlačenje desne ivice zaglavlja menja kolonu, dvoklik na ivicu vraća podrazumevane širine.
// Radi direktno nad DOM-om tabele (ref), bez stanja u Reactu, pa se tabela sa hiljadama zapisa ne crta ponovo dok se
// vuče. Pri prvom povlačenju se sve kolone zamrzavaju na trenutnu širinu u pikselima (table-layout: fixed), tako da
// ivica prati miša, a tabela može da bude i šira od okvira (vodoravni skrol). Širine se pamte u localStorage po imenu
// tabele: to je stanje prikaza na ovom računaru, ne podešavanje, pa ne ide u bazu ni u rezervnu kopiju.
import type { RefCallback } from 'react';

const EDGE = 5;
const MIN = 28;
const KEY = 'cols:';

const shown = (el: Element) => getComputedStyle(el).display !== 'none';
const total = (w: readonly number[]) => w.reduce((s, x) => s + x, 0);

function load(id: string): number[] | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY + id) ?? 'null');
    return Array.isArray(v) && v.every((x) => typeof x === 'number' && x > 0) ? v : null;
  } catch {
    return null;
  }
}

function store(id: string, widths: readonly number[] | null) {
  try {
    if (widths) localStorage.setItem(KEY + id, JSON.stringify(widths));
    else localStorage.removeItem(KEY + id);
  } catch {
    // bez localStorage širine važe samo dok je tabela prikazana
  }
}

/** Broj vidljivih kolona po prvom redu zaglavlja (sakrivene ćelije ne zauzimaju kolonu). */
function columnCount(table: HTMLTableElement): number {
  const row = table.tHead?.rows[0];
  return row ? total([...row.cells].filter(shown).map((c) => c.colSpan)) : 0;
}

/** Vidljivi <col> elementi; tabela bez svog <colgroup> dobija jedan koji React ne vidi. */
function columns(table: HTMLTableElement, n: number): HTMLElement[] | null {
  let group = table.querySelector<HTMLElement>(':scope > colgroup');
  if (!group) {
    group = document.createElement('colgroup');
    group.dataset.own = '';
    table.prepend(group);
  }
  if (group.dataset.own !== undefined) {
    while (group.children.length > n) group.lastElementChild!.remove();
    while (group.children.length < n) group.append(document.createElement('col'));
  }
  const cols = [...group.children].filter(shown) as HTMLElement[];
  return cols.length === n ? cols : null;
}

/** Trenutne širine kolona, iz prvog reda u kome nijedna ćelija ne spaja kolone. */
function measure(table: HTMLTableElement, n: number): number[] | null {
  for (const row of table.rows) {
    const cells = [...row.cells].filter(shown);
    if (cells.length === n && cells.every((c) => c.colSpan === 1)) return cells.map((c) => Math.round(c.getBoundingClientRect().width));
  }
  return null;
}

function apply(table: HTMLTableElement, cols: readonly HTMLElement[], widths: readonly number[]) {
  cols.forEach((c, i) => { c.style.width = `${widths[i]}px`; });
  table.style.tableLayout = 'fixed';
  table.style.minWidth = '0';
  table.style.width = `${total(widths)}px`;
  table.dataset.resized = '';
}

function clear(table: HTMLTableElement) {
  for (const c of table.querySelectorAll<HTMLElement>(':scope > colgroup > col')) c.style.width = '';
  table.style.tableLayout = '';
  table.style.minWidth = '';
  table.style.width = '';
  delete table.dataset.resized;
}

function attach(table: HTMLTableElement, id: string): () => void {
  const off = new AbortController();
  let drag: AbortController | null = null;

  const restore = () => {
    const n = columnCount(table);
    const saved = load(id);
    const cols = saved?.length === n ? columns(table, n) : null;
    if (saved && cols) apply(table, cols, saved);
    else if (table.dataset.resized !== undefined) clear(table);
  };
  restore();

  /** Kolona čija je desna ivica pod mišem, ili null. */
  const hit = (e: MouseEvent): number | null => {
    const th = e.target instanceof Element ? e.target.closest('th') : null;
    if (!th || th.parentElement?.parentElement !== table.tHead) return null;
    let start = 0;
    for (let p = th.previousElementSibling; p; p = p.previousElementSibling) if (shown(p)) start += (p as HTMLTableCellElement).colSpan;
    const r = th.getBoundingClientRect();
    if (r.right - e.clientX <= EDGE) return start + th.colSpan - 1;
    if (e.clientX - r.left < EDGE && start > 0) return start - 1;
    return null;
  };

  const opts = { signal: off.signal };
  table.addEventListener('pointermove', (e) => { if (!drag) table.style.cursor = hit(e) === null ? '' : 'col-resize'; }, opts);
  table.addEventListener('pointerleave', () => { if (!drag) table.style.cursor = ''; }, opts);

  table.addEventListener('pointerdown', (e) => {
    const i = e.button === 0 ? hit(e) : null;
    if (i === null) return;
    const n = columnCount(table);
    const cols = columns(table, n);
    const widths = measure(table, n);
    if (!cols || !widths) return;
    e.preventDefault(); // bez označavanja teksta dok se vuče
    const x0 = e.clientX;
    const w0 = widths[i];
    let moved = false;
    drag = new AbortController();
    const d = { signal: drag.signal };
    document.body.classList.add('col-resizing');
    const end = () => {
      drag?.abort();
      drag = null;
      document.body.classList.remove('col-resizing');
      table.style.cursor = '';
      if (moved) store(id, widths);
    };
    window.addEventListener('pointermove', (m) => {
      // kolona koja je već uža od najmanje širine (oznaka upozorenja) ne skače na nju
      const w = Math.max(Math.min(MIN, w0), Math.round(w0 + m.clientX - x0));
      // kolone se zamrzavaju tek kad se miš pomeri: običan klik na ivicu ne menja raspored
      if (!moved && w === w0) return;
      moved = true;
      widths[i] = w;
      apply(table, cols, widths);
    }, d);
    window.addEventListener('pointerup', end, d);
    window.addEventListener('pointercancel', end, d);
  }, opts);

  table.addEventListener('dblclick', (e) => {
    if (hit(e) === null) return;
    store(id, null);
    clear(table);
  }, opts);

  // kolona sakrivena u uskom prozoru (.hide-narrow) menja broj kolona, pa se sačuvane širine ponovo proveravaju
  window.addEventListener('resize', () => { if (!drag) restore(); }, opts);

  return () => {
    drag?.abort();
    drag = null;
    document.body.classList.remove('col-resizing');
    off.abort();
  };
}

const refs = new Map<string, RefCallback<HTMLTableElement>>();

/** `ref` za <table>: kolone se menjaju mišem, a širine pamte pod imenom `id`. */
export function columnResize(id: string): RefCallback<HTMLTableElement> {
  let ref = refs.get(id);
  if (!ref) {
    ref = (table) => (table ? attach(table, id) : undefined);
    refs.set(id, ref);
  }
  return ref;
}
