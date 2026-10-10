// Tabela šifara kantovanja: izmena se čuva čim je cela tabela ispravna (kao jezgro: `sanitizeRules`, bez duplikata istog
// para debljina). Dok je neispravna, poruka kaže zašto i prethodna ispravna tabela ostaje u podešavanjima.
import { useRef, useState } from 'react';
import { DEFAULT_EDGE_RULES, describePair, edgeLabel, type EdgeRule } from '@core/parts';
import { cloneEdgeRules, edgeRulesProblem, sameEdgeRules } from '../../../shared/edgeRules';
import { errText } from '../../format';
import { useSettings } from '../../settings';

interface Draft {
  a: string;
  b: string;
  code: string;
}

const toText = (n: number) => String(n).replace('.', ',');
const toDraft = (r: EdgeRule): Draft => ({ a: toText(r.a), b: toText(r.b), code: String(r.code) });
// decimalni zarez je običan unos; prazno polje nije broj
const toNum = (s: string) => (s.trim() === '' ? NaN : Math.round(Number(s.trim().replace(',', '.')) * 1000) / 1000);
const parse = (rows: Draft[]): EdgeRule[] | string => {
  const rules = rows.map((r) => ({ a: toNum(r.a), b: toNum(r.b), code: r.code.trim() === '' ? NaN : Number(r.code) }));
  if (rules.some((r) => !Number.isFinite(r.a) || !Number.isFinite(r.b))) return 'Debljina mora biti broj (npr. 0,5).';
  return edgeRulesProblem(rules) ?? rules;
};

export function EdgeRulesEditor({ rules }: { rules: EdgeRule[] }) {
  const { set } = useSettings();
  const [rows, setRows] = useState<Draft[]>(() => rules.map(toDraft));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const revision = useRef(0);

  function edit(next: Draft[]) {
    const mine = ++revision.current;
    setRows(next);
    setSaved(false);
    const parsed = parse(next);
    if (typeof parsed === 'string') {
      setError(parsed);
      setSaved(false);
      return;
    }
    setError(null);
    set('edgeRules', parsed).then(
      () => { if (mine === revision.current) setSaved(true); },
      (e: unknown) => { if (mine === revision.current) setError(errText(e)); },
    );
  }

  const change = (i: number, patch: Partial<Draft>) => edit(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const nextCode = Math.max(-1, ...rows.map((r) => Number(r.code)).filter(Number.isFinite)) + 1;
  const parsed = parse(rows);

  return (
    <section data-testid="edge-rules">
      <p className="muted small">
        Šifra kantovanja iz debljina kanta na dve stranice dela (0 = bez kanta; redosled strana nije bitan). Menja se samo za
        nove poslove: posao čuva svoju kopiju tabele iz trenutka uvoza.
      </p>
      <table className="grid edge-table">
        <thead>
          <tr><th>Debljina a (mm)</th><th>Debljina b (mm)</th><th>Šifra</th><th>Značenje</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const ok = typeof parsed !== 'string';
            const rule = ok ? parsed[i] : null;
            return (
              <tr key={i} data-testid="edge-rule">
                <td><input type="text" inputMode="decimal" aria-label={`Debljina a, red ${i + 1}`} value={r.a} onChange={(e) => change(i, { a: e.target.value })} /></td>
                <td><input type="text" inputMode="decimal" aria-label={`Debljina b, red ${i + 1}`} value={r.b} onChange={(e) => change(i, { b: e.target.value })} /></td>
                <td><input type="number" min={0} max={255} aria-label={`Šifra, red ${i + 1}`} value={r.code} onChange={(e) => change(i, { code: e.target.value })} /></td>
                <td className="muted">{rule ? `${describePair(rule.a, rule.b)} → ${edgeLabel(rule.code)}` : '…'}</td>
                <td><button type="button" className="icon" title="Ukloni red" aria-label={`Ukloni red ${i + 1}`} onClick={() => edit(rows.filter((_, k) => k !== i))}>×</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row-actions">
        <button type="button" className="btn" data-testid="edge-add" onClick={() => edit([...rows, { a: '', b: '', code: String(nextCode) }])} disabled={rows.length >= 100}>Dodaj red</button>
        <button
          type="button"
          className="btn"
          data-testid="edge-reset"
          disabled={sameEdgeRules(rules, DEFAULT_EDGE_RULES) && saved && !error}
          onClick={() => edit(cloneEdgeRules(DEFAULT_EDGE_RULES).map(toDraft))}
        >
          Vrati podrazumevanu tabelu
        </button>
        {error ? <span className="err" role="alert" data-testid="edge-error">{error} Izmena nije sačuvana.</span> : <span className="muted small" data-testid="edge-saved" data-saved={saved}>{saved ? 'Sačuvano' : 'Čuvam…'}</span>}
      </div>
    </section>
  );
}
