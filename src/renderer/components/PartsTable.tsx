// Tabela zapisa sa izmenom u ćelijama. Zbog nekoliko hiljada zapisa se crtaju samo redovi u vidljivom delu
// (fiksna visina reda), pa nema ograničenja broja zapisa kao u webu (3000).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { describeCode, describePair, edgeLabel, type EdgeRule } from '@core/parts';
import type { EditField, JobState } from '../../shared/job';
import { compareText } from '../../shared/sort';
import type { DerivedJob, JobRecord } from '../job/derive';
import { parseEditValue, withEdit, withSwap, withoutEdit, withoutEdits } from '../job/state';
import { SortTh, nextSort, type Sort } from './SortTh';

const ROW_H = 30;
const OVERSCAN = 8;

type SetState = (update: (s: JobState) => JobState) => void;
type SortKey = EditField | 'material';

/** Polje koje se menja tek na Enter / napuštanje ćelije; Esc vraća staro. Nevažeća vrednost se vraća. */
function NumCell({ value, label, field, onCommit, edited, className }: {
  value: number;
  label: string;
  field: EditField;
  onCommit: (v: number) => void;
  edited: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const v = parseEditValue(field, draft);
      if (typeof v === 'number' && v !== value) onCommit(v);
    }
    setDraft(null);
  };
  return (
    <td className={edited ? 'edit edited' : 'edit'}>
      <input
        type="number"
        className={className ?? 'num'}
        aria-label={label}
        data-field={field}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
    </td>
  );
}

function NameCell({ value, edited, onCommit }: { value: string; edited: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const v = parseEditValue('name', draft);
      if (typeof v === 'string' && v !== value) onCommit(v);
    }
    setDraft(null);
  };
  return (
    <td className={edited ? 'edit edited' : 'edit'}>
      <input
        type="text"
        className="name"
        aria-label="Oznaka"
        data-field="name"
        maxLength={25}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
    </td>
  );
}

function EdgeCell({ r, which, rules, onCommit }: { r: JobRecord; which: 1 | 2; rules: readonly EdgeRule[]; onCommit: (v: number) => void }) {
  const field = which === 1 ? 'edge1' : 'edge2';
  const code = r.rec[field];
  const th = which === 1 ? r.base.thick1 : r.base.thick2;
  const desc = th && code === r.base[field] ? describePair(th[0], th[1]) : describeCode(rules, code);
  const codes = [...new Set([...rules.map((x) => x.code), code])].sort((a, b) => a - b);
  return (
    <td className={r.edited.includes(field) ? 'edit edited' : 'edit'} title={desc}>
      <select aria-label={which === 1 ? 'Kant uz dužinu' : 'Kant uz širinu'} data-field={field} value={code} onChange={(e) => onCommit(Number(e.target.value))}>
        {codes.map((c) => (
          <option key={c} value={c}>{c}: {edgeLabel(c)}</option>
        ))}
      </select>
    </td>
  );
}

function Row({ r, index, rules, setState }: { r: JobRecord; index: number; rules: readonly EdgeRule[]; setState: SetState }) {
  const edit = (field: EditField) => (v: number | string) => setState((s) => withEdit(s, r.base, field, v));
  const has = (f: EditField) => r.edited.includes(f);
  return (
    <tr data-key={r.base.key} className={r.edited.length ? 'row-edited' : undefined} style={{ height: ROW_H }}>
      <td className="rn" title={r.rec.srcRows.length ? `Izvorni redovi: ${r.rec.srcRows.join(', ')}` : ''}>{index + 1}</td>
      <NumCell value={r.rec.dim1} label="Dužina (mm)" field="dim1" edited={has('dim1')} onCommit={edit('dim1')} />
      <td>
        <button type="button" className="icon" title="Zameni dimenzije (i kantove)" aria-label="Zameni dimenzije" onClick={() => setState((s) => withSwap(s, r.base, r.rec))}>⇄</button>
      </td>
      <NumCell value={r.rec.dim2} label="Širina (mm)" field="dim2" edited={has('dim2')} onCommit={edit('dim2')} />
      <EdgeCell r={r} which={1} rules={rules} onCommit={edit('edge1')} />
      <EdgeCell r={r} which={2} rules={rules} onCommit={edit('edge2')} />
      <td className={has('grain') ? 'edit edited' : 'edit'}>
        <input type="checkbox" aria-label="Prati teksturu" data-field="grain" checked={r.rec.grain === 1} onChange={(e) => edit('grain')(e.target.checked ? 1 : 0)} />
      </td>
      <NumCell value={r.rec.qty} label="Kom" field="qty" className="qty" edited={has('qty')} onCommit={edit('qty')} />
      <NameCell value={r.rec.name} edited={has('name')} onCommit={edit('name')} />
      <td className="mat" title={r.rec.material}>{r.rec.material}</td>
      <td>{r.rec.issues.length > 0 && <span className="warnmark" title={r.rec.issues.join('\n')}>!</span>}</td>
      <td>
        {r.edited.length > 0 && (
          <button type="button" className="icon" title="Poništi izmene ovog zapisa" aria-label="Poništi izmene zapisa" onClick={() => setState((s) => withoutEdit(s, r.base.key))}>↺</button>
        )}
      </td>
    </tr>
  );
}

export function PartsTable({ derived, setState, rules }: { derived: DerivedJob; setState: SetState; rules: readonly EdgeRule[] }) {
  const [material, setMaterial] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  // Sortiranje menja samo prikaz: redni broj i redosled u .tab fajlu ostaju izvorni.
  const [sort, setSort] = useState<Sort<SortKey> | null>(null);
  const onSort = (by: SortKey) => setSort((cur) => nextSort(cur, by, true));

  const filtered = useMemo(() => {
    const idx: number[] = [];
    derived.records.forEach((r, i) => {
      if (material === null || r.rec.material === material) idx.push(i);
    });
    return idx;
  }, [derived.records, material]);

  // Redosled se računa pri izboru kolone, a ne pri svakoj izmeni ćelije: izmenjen red ne beži ispod kursora.
  // Ponovo se računa tek kad se promeni skup zapisa (ključevi), filter ili izbor kolone.
  const keys = useMemo(() => derived.records.map((r) => r.base.key).join('\u001f'), [derived.records]);
  const order = useMemo(() => {
    if (!sort) return null;
    const { by, dir } = sort;
    const sign = dir === 'asc' ? 1 : -1;
    const value = (i: number) => derived.records[i].rec[by];
    return derived.records
      .map((_, i) => i)
      .sort((a, b) => {
        const x = value(a);
        const y = value(b);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : compareText(String(x), String(y))) * sign || a - b;
      });
  }, [keys, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    if (!order) return filtered;
    const shown = new Set(filtered);
    return order.filter((i) => shown.has(i));
  }, [filtered, order]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView((v) => (v.height === el.clientHeight ? v : { ...v, height: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);
  const editedCells = derived.records.reduce((s, r) => s + r.edited.length, 0);
  const warn = derived.records.filter((r) => r.rec.issues.length).length;
  const qty = derived.records.reduce((s, r) => s + r.rec.qty, 0);

  return (
    <div className="parts">
      <p className="sum" data-testid="parts-summary" data-count={derived.records.length} data-edited={editedCells}>
        <b>{derived.records.length}</b> zapisa, ukupno <b>{qty}</b> kom
        {derived.conv ? `, iz ${derived.conv.pieces.length} izvornih redova` : ''}.
        {editedCells > 0 && (
          <>
            {' '}Ručno izmenjeno ćelija: <mark className="mk">{editedCells}</mark>{' '}
            <button type="button" className="btn small" data-testid="reset-all" onClick={() => setState(withoutEdits)}>Poništi sve izmene</button>
          </>
        )}
        {warn > 0 && <> Zapisa sa upozorenjem: <b className="err">{warn}</b>.</>}
        {derived.materials.length > 1 && (
          <>
            {' '}
            <select aria-label="Filter po materijalu" value={material ?? ''} onChange={(e) => setMaterial(e.target.value === '' ? null : e.target.value)}>
              <option value="">Svi materijali</option>
              {derived.materials.map((m) => (
                <option key={m.source} value={m.source}>{m.source || '(bez materijala)'}</option>
              ))}
            </select>
          </>
        )}
      </p>
      {derived.orphanEdits.length > 0 && (
        <p className="warn-line">
          {derived.orphanEdits.length} ručnih izmena se više ne odnosi ni na jedan zapis (promenjeno je spajanje zapisa).{' '}
          <button type="button" className="btn small" onClick={() => setState((s) => ({ ...s, edits: Object.fromEntries(Object.entries(s.edits).filter(([k]) => !derived.orphanEdits.includes(k))) }))}>
            Ukloni ih
          </button>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="muted">Nema zapisa za prikaz.</p>
      ) : (
        <div className="table-scroll" ref={scroller} onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })} data-testid="parts-scroll">
          <table className="grid parts-table">
            <colgroup>
              <col className="c-rn" />
              <col className="c-dim" />
              <col className="c-swap" />
              <col className="c-dim" />
              <col className="c-edge" />
              <col className="c-edge" />
              <col className="c-tex" />
              <col className="c-qty" />
              <col />
              <col className="c-mat" />
              <col className="c-mark" />
              <col className="c-act" />
            </colgroup>
            <thead>
              <tr>
                <th className="rn">
                  {sort ? (
                    <button type="button" className="sort" data-sort="" title="Vrati izvorni redosled" onClick={() => setSort(null)}>Rb.</button>
                  ) : 'Rb.'}
                </th>
                <SortTh id="dim1" sort={sort} onSort={onSort}>Dužina</SortTh>
                <th />
                <SortTh id="dim2" sort={sort} onSort={onSort}>Širina</SortTh>
                <SortTh id="edge1" sort={sort} onSort={onSort}>Kant uz dužinu</SortTh>
                <SortTh id="edge2" sort={sort} onSort={onSort}>Kant uz širinu</SortTh>
                <SortTh id="grain" sort={sort} onSort={onSort}>Tekstura</SortTh>
                <SortTh id="qty" sort={sort} onSort={onSort}>Kom</SortTh>
                <SortTh id="name" sort={sort} onSort={onSort}>Oznaka</SortTh>
                <SortTh id="material" sort={sort} onSort={onSort}>Materijal</SortTh>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW_H }} />}
              {rows.slice(first, last).map((i) => (
                <Row key={derived.records[i].base.key} r={derived.records[i]} index={i} rules={rules} setState={setState} />
              ))}
              {last < rows.length && <tr aria-hidden="true" style={{ height: (rows.length - last) * ROW_H }} />}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
