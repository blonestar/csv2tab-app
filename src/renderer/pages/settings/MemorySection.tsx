// Zapamćeni izbori: pregled i brisanje. Izmena u mestu nije predviđena (izbor se menja novim izborom u poslu).
import { useEffect, useState } from 'react';
import { FIELDS, FIELD_LABELS } from '@core/parts';
import type { WtCatalog } from '@core/catalog';
import type { MemoryList } from '../../../shared/memory';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errText, formatDateTime } from '../../format';
import { columnResize } from '../../columnResize';

function colLetters(c: number): string {
  let s = '';
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function MemorySection({ catalog }: { catalog: WtCatalog | null }) {
  const [list, setList] = useState<MemoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<'material' | 'mapping' | null>(null);

  const load = () => window.api.memory.list().then(setList, (e: unknown) => setError(errText(e)));
  useEffect(() => void load(), []);

  const forget = (kind: 'material' | 'mapping', key: string | null) =>
    window.api.memory.forget(kind, key).then(() => load(), (e: unknown) => setError(errText(e)));

  const wtText = (code: string | null | undefined) => {
    if (code === undefined) return <span className="muted">—</span>;
    if (code === null) return <span>bez WT materijala</span>;
    const m = catalog?.materials.find((x) => x.code === code);
    return m ? <span>{code} <span className="muted">({m.name})</span></span> : <span className="err" title="Šifre više nema u katalogu; pri uvozu se ne primenjuje">{code} (nema u katalogu)</span>;
  };
  const bandText = (code: string | undefined) => {
    if (code === undefined) return <span className="muted">—</span>;
    if (code === '') return <span>bez trake</span>;
    const b = catalog?.edgeBands.find((x) => x.code === code);
    return b ? <span>{code}</span> : <span className="err" title="Trake više nema u katalogu; pri uvozu se ne primenjuje">{code} (nema u katalogu)</span>;
  };

  if (!list) return error ? <p className="banner error" role="alert">{error}</p> : <p className="muted">Učitavam…</p>;

  return (
    <section data-testid="memory">
      {error && <p className="banner error" role="alert">{error}</p>}
      <p className="muted small">
        Program pamti izbore da bi sledeći uvoz isti materijal ili isto zaglavlje već imao izabrano. Zapamćeno važi samo za
        nove poslove; postojeći poslovi se ne menjaju.
      </p>

      <h2>Materijali <span className="muted small">({list.materials.length})</span></h2>
      {list.materials.length === 0 ? (
        <p className="muted" data-testid="memory-materials-empty">Još ništa nije zapamćeno. Izbor se pamti kad se materijal ručno izabere u poslu ili kad se posao izveze.</p>
      ) : (
        <>
          <table className="grid memory-table" ref={columnResize('memory-materials')} data-testid="memory-materials">
            <thead>
              <tr><th>Naziv iz fajla</th><th>WT materijal</th><th>Traka</th><th>Prati teksturu</th><th>Promenjeno</th><th /></tr>
            </thead>
            <tbody>
              {list.materials.map((m) => (
                <tr key={m.key} data-key={m.key}>
                  <td title={m.label}>{m.label}</td>
                  <td>{wtText(m.wt)}</td>
                  <td>{bandText(m.band)}</td>
                  <td>{m.grain === undefined ? <span className="muted">—</span> : m.grain ? 'da' : 'ne'}</td>
                  <td className="muted">{formatDateTime(m.updatedAt)}</td>
                  <td><button type="button" className="btn small" data-testid="memory-forget-material" onClick={() => void forget('material', m.key)}>Zaboravi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-actions"><button type="button" className="btn small" data-testid="memory-clear-materials" onClick={() => setClearing('material')}>Zaboravi sve materijale…</button></div>
        </>
      )}

      <h2>Mapiranje kolona <span className="muted small">({list.mappings.length})</span></h2>
      {list.mappings.length === 0 ? (
        <p className="muted" data-testid="memory-mappings-empty">Još ništa nije zapamćeno. Mapiranje se pamti kad ga ručno promenite u kartici Izvor.</p>
      ) : (
        <>
          <table className="grid memory-table" ref={columnResize('memory-mappings')} data-testid="memory-mappings">
            <thead>
              <tr><th>Zaglavlje fajla</th><th>Mapiranje</th><th>Promenjeno</th><th /></tr>
            </thead>
            <tbody>
              {list.mappings.map((m) => (
                <tr key={m.signature}>
                  <td className="wrap" title={m.header.join(' | ')}>{m.header.join(' | ')}</td>
                  <td className="wrap small">
                    {FIELDS.filter((f) => m.mapping[f] >= 0).map((f) => `${FIELD_LABELS[f]}: ${colLetters(m.mapping[f])}`).join('; ')}
                  </td>
                  <td className="muted">{formatDateTime(m.updatedAt)}</td>
                  <td><button type="button" className="btn small" data-testid="memory-forget-mapping" onClick={() => void forget('mapping', m.signature)}>Zaboravi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-actions"><button type="button" className="btn small" data-testid="memory-clear-mappings" onClick={() => setClearing('mapping')}>Zaboravi sva mapiranja…</button></div>
        </>
      )}

      {clearing && (
        <ConfirmDialog
          title="Zaboraviti sve?"
          testId="memory-clear-dialog"
          actions={[
            { label: 'Zaboravi sve', testId: 'memory-clear-confirm', kind: 'danger', onClick: () => { const k = clearing; setClearing(null); void forget(k, null); } },
            { label: 'Odustani', testId: 'memory-clear-cancel', onClick: () => setClearing(null) },
          ]}
        >
          <p>{clearing === 'material' ? 'Brišu se svi zapamćeni izbori materijala.' : 'Brišu se sva zapamćena mapiranja kolona.'} Postojeći poslovi ostaju kakvi jesu.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
