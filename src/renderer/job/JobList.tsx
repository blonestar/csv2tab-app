// Lista sačuvanih poslova: najnoviji prvi, pretraga (ime, materijal, naziv dela, datum), stranice po PAGE poslova.
// Upit i stranice rade u bazi; renderer dobija samo red po poslu, nikad zapise.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobListItem, JobSortKey } from '../../shared/jobs';
import { SortTh, nextSort, type Sort } from '../components/SortTh';
import { STATUS_LABEL, errText, formatDateTime } from '../format';

const PAGE = 50;
const SEARCH_DELAY_MS = 250;
const NEWEST_FIRST: Sort<JobSortKey> = { by: 'date', dir: 'desc' };
/** Izbor kolone važi dok aplikacija radi: lista se ponovo pravi pri svakom povratku iz posla. */
let lastSort = NEWEST_FIRST;

export function JobList({ onOpen, focusRequest = 0 }: { onOpen: (id: number) => void; focusRequest?: number }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(lastSort);
  // datum prvo opadajuće (najnoviji prvi), ostale kolone rastuće
  const onSort = (by: JobSortKey) => {
    lastSort = sort.by !== by && by === 'date' ? NEWEST_FIRST : nextSort(sort, by, false) ?? NEWEST_FIRST;
    setSort(lastSort);
  };
  const [items, setItems] = useState<JobListItem[]>([]);
  const [total, setTotal] = useState(0);
  /** Upit na koji se odnosi prikazana lista (test čeka na ovo, ne na vreme). */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const token = useRef(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusRequest) { search.current?.focus(); search.current?.select(); } }, [focusRequest]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(text), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [text]);

  const load = useCallback(async (q: string, s: Sort<JobSortKey>, offset: number) => {
    const mine = ++token.current;
    setError(null);
    try {
      const r = await window.api.jobs.list({ text: q, offset, limit: PAGE, sort: s });
      if (mine !== token.current) return;
      setItems((cur) => (offset === 0 ? r.items : [...cur, ...r.items]));
      setTotal(r.total);
      setLoadedFor(q);
      setMore(false);
    } catch (e) {
      if (mine === token.current) {
        setError(errText(e));
        setMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(query, sort, 0);
  }, [query, sort, load]);

  return (
    <div className="joblist">
      <div className="listbar">
        <input
          ref={search}
          type="search"
          className="search"
          data-testid="job-search"
          aria-label="Pretraga poslova"
          placeholder="Pretraga: ime, materijal, naziv dela, datum…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="muted" data-testid="job-count" data-total={total} data-loaded={loadedFor ?? ""}>
          {query ? `Pronađeno ${total}` : `Ukupno ${total}`}
        </span>
      </div>
      {error && <p role="alert" className="banner error">{error}</p>}
      {loadedFor !== null && items.length === 0 && !error && (
        <p className="muted" data-testid="job-empty">
          {query ? 'Nijedan posao ne odgovara pretrazi.' : 'Još nema sačuvanih poslova. Uvezite krojnu listu dugmetom iznad ili je prevucite u prozor.'}
        </p>
      )}
      {items.length > 0 && (
        <div className="table-scroll list-scroll">
          <table className="grid job-table" data-testid="job-list" data-loaded={loadedFor ?? ''}>
            <colgroup>
              <col className="c-name" />
              <col className="c-src hide-narrow" />
              <col className="c-mat" />
              <col className="c-n" />
              <col className="c-date" />
              <col className="c-status" />
            </colgroup>
            <thead>
              <tr>
                <SortTh id="name" sort={sort} onSort={onSort}>Posao</SortTh>
                <SortTh id="source" sort={sort} onSort={onSort} className="hide-narrow">Fajl</SortTh>
                <th>Materijali</th>
                <SortTh id="parts" sort={sort} onSort={onSort} className="r">Zapisa</SortTh>
                <SortTh id="date" sort={sort} onSort={onSort}>Datum</SortTh>
                <SortTh id="status" sort={sort} onSort={onSort}>Izvoz</SortTh>
              </tr>
            </thead>
            <tbody>
              {items.map((j) => {
                const mats = j.materials.map((m) => m || '(bez materijala)').join(', ');
                return (
                  <tr key={j.id} className="job-row" data-job-id={j.id} data-name={j.name} data-status={j.exportStatus} onDoubleClick={() => onOpen(j.id)}>
                    <td title={j.note ? `${j.name}\n${j.note}` : j.name}>
                      <button type="button" className="link" data-testid="job-open" onClick={() => onOpen(j.id)}>{j.name}</button>
                    </td>
                    <td className="hide-narrow" title={j.sourceName}>{j.sourceName}</td>
                    <td title={mats}>{mats}</td>
                    <td className="r">{j.partCount}</td>
                    <td>{formatDateTime(j.createdAt)}</td>
                    <td>
                      <span className={`status ${j.exportStatus}`} title={j.lastExportAt ? `Poslednji izvoz: ${formatDateTime(j.lastExportAt)}` : undefined}>
                        {STATUS_LABEL[j.exportStatus]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {items.length < total && (
        <p>
          <button type="button" className="btn" data-testid="job-more" disabled={more} onClick={() => { setMore(true); void load(query, sort, items.length); }}>
            Prikaži još ({total - items.length})
          </button>
        </p>
      )}
    </div>
  );
}
