import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { searchMaterials, type WtCatalog, type WtBand, type WtMaterial } from '@core/catalog';
import { compareText } from '../../shared/sort';
import { SortTh, nextSort, type Sort } from '../components/SortTh';

const MAX_ROWS = 100;
const norm = (s: string) => s.toLowerCase();

type MaterialKey = 'code' | 'name' | 'thickness' | 'sheet' | 'grain';
type BandKey = 'code' | 'name';
const MATERIAL_ORDER: Record<MaterialKey, (a: WtMaterial, b: WtMaterial) => number> = {
  code: (a, b) => compareText(a.code, b.code),
  name: (a, b) => compareText(a.name, b.name),
  thickness: (a, b) => a.thickness - b.thickness,
  sheet: (a, b) => a.sheet[0] - b.sheet[0] || a.sheet[1] - b.sheet[1],
  grain: (a, b) => Number(a.grain) - Number(b.grain),
};
const BAND_ORDER: Record<BandKey, (a: WtBand, b: WtBand) => number> = {
  code: (a, b) => compareText(a.code, b.code),
  name: (a, b) => compareText(a.name, b.name),
};

/** Kopija niza po izabranoj koloni; bez izbora ostaje redosled kataloga (odnosno pretrage). */
function sorted<T, K extends string>(items: readonly T[], sort: Sort<K> | null, order: Record<K, (a: T, b: T) => number>): readonly T[] {
  if (!sort) return items;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => order[sort.by](a, b) * sign);
}

export function Catalog() {
  const [catalog, setCatalog] = useState<WtCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Polje za pretragu se ažurira odmah, a tabela sa zakašnjenjem, da kucanje ne zastaje.
  const deferred = useDeferredValue(query);
  const [materialSort, setMaterialSort] = useState<Sort<MaterialKey> | null>(null);
  const [bandSort, setBandSort] = useState<Sort<BandKey> | null>(null);
  const onMaterialSort = (by: MaterialKey) => setMaterialSort((cur) => nextSort(cur, by, true));
  const onBandSort = (by: BandKey) => setBandSort((cur) => nextSort(cur, by, true));

  useEffect(() => {
    window.api.catalog.get().then(setCatalog, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const { materials, matched, bands } = useMemo(() => {
    if (!catalog) return { materials: [], matched: 0, bands: [] };
    const q = deferred.trim();
    const all = q ? searchMaterials(catalog, q, catalog.materials.length) : catalog.materials;
    const lq = norm(q);
    const bands = q ? catalog.edgeBands.filter((b) => norm(b.code).includes(lq) || norm(b.name).includes(lq)) : catalog.edgeBands;
    return { materials: sorted(all, materialSort, MATERIAL_ORDER).slice(0, MAX_ROWS), matched: all.length, bands: sorted(bands, bandSort, BAND_ORDER) };
  }, [catalog, deferred, materialSort, bandSort]);

  return (
    <>
      <h1>Katalog</h1>
      {error && <p role="alert">Greška: {error}</p>}
      {catalog && (
        <>
          <input
            type="search"
            className="search"
            placeholder="Šifra ili naziv"
            aria-label="Pretraga kataloga"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <h2>
            Materijali <span className="muted" data-testid="material-count">({matched} od {catalog.materials.length})</span>
          </h2>
          <table className="grid" data-testid="materials">
            <thead>
              <tr>
                <SortTh id="code" sort={materialSort} onSort={onMaterialSort}>Šifra</SortTh>
                <SortTh id="name" sort={materialSort} onSort={onMaterialSort}>Naziv</SortTh>
                <SortTh id="thickness" sort={materialSort} onSort={onMaterialSort}>Debljina</SortTh>
                <SortTh id="sheet" sort={materialSort} onSort={onMaterialSort}>Ploča</SortTh>
                <SortTh id="grain" sort={materialSort} onSort={onMaterialSort}>Tekstura</SortTh>
              </tr>
            </thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={`${m.code}-${i}`}>
                  <td>{m.code}</td>
                  <td>{m.name}</td>
                  <td>{m.thickness} mm</td>
                  <td>{m.sheet[0]} × {m.sheet[1]}</td>
                  <td>{m.grain ? 'prati' : 'ne prati'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {matched > MAX_ROWS && <p className="muted">Prikazano prvih {MAX_ROWS}; suzite pretragu.</p>}
          <h2>Trake ({bands.length})</h2>
          <table className="grid" data-testid="bands">
            <thead>
              <tr>
                <SortTh id="code" sort={bandSort} onSort={onBandSort}>Šifra</SortTh>
                <SortTh id="name" sort={bandSort} onSort={onBandSort}>Naziv</SortTh>
              </tr>
            </thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={`${b.code}-${i}`}>
                  <td>{b.code}</td>
                  <td>{b.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
