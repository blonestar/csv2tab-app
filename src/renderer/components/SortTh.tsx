// Zaglavlje kolone po kojoj tabela može da se sortira: klik menja rastuće / opadajuće (i, gde ima smisla, bez sortiranja).
import type { ReactNode } from 'react';

export interface Sort<K extends string> {
  by: K;
  dir: 'asc' | 'desc';
}

/** Nova kolona kreće rastuće; ista kolona ide rastuće → opadajuće → (ako je `clearable`) bez sortiranja. */
export function nextSort<K extends string>(cur: Sort<K> | null, by: K, clearable: boolean): Sort<K> | null {
  if (cur?.by !== by) return { by, dir: 'asc' };
  if (cur.dir === 'asc') return { by, dir: 'desc' };
  return clearable ? null : { by, dir: 'asc' };
}

export function SortTh<K extends string>({ id, sort, onSort, className, children }: {
  id: K;
  sort: Sort<K> | null;
  onSort: (by: K) => void;
  className?: string;
  children: ReactNode;
}) {
  const dir = sort?.by === id ? sort.dir : null;
  return (
    <th className={className} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
      <button type="button" className="sort" data-sort={id} data-dir={dir ?? undefined} title="Sortiraj po ovoj koloni" onClick={() => onSort(id)}>
        {children}
        {dir && <span aria-hidden="true" className="sort-mark">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}
