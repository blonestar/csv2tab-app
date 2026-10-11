import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { searchMaterials, type WtCatalog } from '@core/catalog';
import { columnResize } from '../columnResize';

const MAX_ROWS = 100;
const norm = (s: string) => s.toLowerCase();

export function Catalog() {
  const [catalog, setCatalog] = useState<WtCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Polje za pretragu se ažurira odmah, a tabela sa zakašnjenjem, da kucanje ne zastaje.
  const deferred = useDeferredValue(query);

  useEffect(() => {
    window.api.catalog.get().then(setCatalog, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const { materials, matched, bands } = useMemo(() => {
    if (!catalog) return { materials: [], matched: 0, bands: [] };
    const q = deferred.trim();
    const all = q ? searchMaterials(catalog, q, catalog.materials.length) : catalog.materials;
    const lq = norm(q);
    const bands = q ? catalog.edgeBands.filter((b) => norm(b.code).includes(lq) || norm(b.name).includes(lq)) : catalog.edgeBands;
    return { materials: all.slice(0, MAX_ROWS), matched: all.length, bands };
  }, [catalog, deferred]);

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
          <table className="grid" ref={columnResize('catalog-materials')} data-testid="materials">
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Debljina</th>
                <th>Ploča</th>
                <th>Tekstura</th>
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
          <table className="grid" ref={columnResize('catalog-bands')} data-testid="bands">
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
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
