// Poređenje dva skupa zapisa (isto za pitanje pre prepisivanja i za prozor poređenja).
import { useMemo, useState } from 'react';
import { compareParts, type DiffRow } from '@core/compare';
import type { WtPart } from '@core/wtTab';

const MAX_ROWS = 1500;
const MARK: Record<DiffRow['status'], string> = { same: '=', changed: '≠', onlyA: '＋', onlyB: '−' };

export function countDiff(rows: readonly DiffRow[]) {
  const c = { same: 0, changed: 0, onlyA: 0, onlyB: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

const cells = (p?: WtPart) =>
  p ? (
    <>
      <td>{p.dim1} × {p.dim2}</td>
      <td>{p.edge1} / {p.edge2}</td>
      <td>{p.grain ? 'da' : 'ne'}</td>
      <td>{p.qty}</td>
      <td>{p.name}</td>
    </>
  ) : (
    <td colSpan={5} className="muted">—</td>
  );

export function DiffSummary({ rows, aLabel, bLabel }: { rows: readonly DiffRow[]; aLabel: string; bLabel: string }) {
  const c = countDiff(rows);
  return (
    <p className="diff-summary" data-testid="diff-summary" data-same={c.same} data-changed={c.changed} data-only-a={c.onlyA} data-only-b={c.onlyB}>
      <b>{c.same}</b> isto, <mark className="mk">{c.changed}</mark> različito, <b>{c.onlyA}</b> samo u „{aLabel}", <b>{c.onlyB}</b> samo u „{bLabel}".
    </p>
  );
}

export function DiffTable({ a, b, aLabel, bLabel, hideSummary }: { a: readonly WtPart[]; b: readonly WtPart[]; aLabel: string; bLabel: string; hideSummary?: boolean }) {
  const rows = useMemo(() => compareParts(a, b), [a, b]);
  const [all, setAll] = useState(false);
  const c = countDiff(rows);
  const shown = (all ? rows : rows.filter((r) => r.status !== 'same')).slice(0, MAX_ROWS);
  const hidden = (all ? rows.length : rows.length - c.same) - shown.length;
  return (
    <div className="diff">
      {!hideSummary && <DiffSummary rows={rows} aLabel={aLabel} bLabel={bLabel} />}
      {c.same > 0 && (
        <label className="choice">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Prikaži i iste zapise
        </label>
      )}
      <div className="table-scroll diff-scroll">
        <table className="grid diff-table">
          <thead>
            <tr>
              <th />
              <th colSpan={5}>{aLabel}</th>
              <th colSpan={5}>{bLabel}</th>
              <th>Razlike</th>
            </tr>
            <tr>
              <th />
              {[0, 1].flatMap((i) => [
                <th key={`d${i}`}>Dim.</th>,
                <th key={`k${i}`}>Kant</th>,
                <th key={`t${i}`}>Tekst.</th>,
                <th key={`q${i}`}>Kom</th>,
                <th key={`n${i}`}>Oznaka</th>,
              ])}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className={r.status}>
                <td>{MARK[r.status]}</td>
                {cells(r.a)}
                {cells(r.b)}
                <td className="d">{r.diffs.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && <p className="muted">Prikazano prvih {MAX_ROWS} redova; još {hidden} nije prikazano.</p>}
      {rows.length > 0 && shown.length === 0 && <p className="muted">Nema razlika.</p>}
    </div>
  );
}
