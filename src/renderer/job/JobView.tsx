import { useMemo, useRef, useState } from 'react';
import { readWtTab } from '@core/wtTab';
import { PartsTable } from '../components/PartsTable';
import { useSession, type JobSession, type TabId } from '../session';
import { EDGE_RULES } from './defaults';
import { deriveJob, type DeriveCache } from './derive';
import { ExportControls } from './ExportControls';
import { ExportsTab, MaterialsTab, SourceTab } from './tabs';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export function JobView({ session }: { session: JobSession }) {
  const { catalog, setState, setTab } = useSession();
  const cache = useRef<DeriveCache>({});
  const derived = useMemo(
    () => (catalog ? deriveJob(session.file, session.state, catalog, EDGE_RULES, cache.current) : null),
    [catalog, session.file, session.state],
  );
  const [scope, setScope] = useState('');
  const [note, setNote] = useState<string | null>(null);

  if (!catalog || !derived) return <p className="muted">Učitavam katalog…</p>;

  async function compareWithTab() {
    setNote(null);
    try {
      const other = await window.api.files.open('compare');
      if (!other || !derived) return;
      const tab = readWtTab(other.bytes);
      const mine = derived.records.filter((r) => scope === '' || r.rec.material === scope).map(({ rec: p }) => ({
        dim1: p.dim1, dim2: p.dim2, edge1: p.edge1, edge2: p.edge2, grain: p.grain, qty: p.qty, name: p.name,
      }));
      await window.api.compare.open({ aName: `Posao: ${session.file.name}${scope ? ` / ${scope}` : ''}`, bName: other.name, a: mine, b: tab.parts });
    } catch (e) {
      setNote(errText(e));
    }
  }

  const tabs: [TabId, string][] = [
    ['parts', `Zapisi (${derived.records.length})`],
    ['materials', `Materijali (${derived.materials.length})`],
    ['source', 'Izvor'],
    ['exports', `Izvozi (${session.log.length})`],
  ];
  const errors = derived.issues.filter((i) => i.level === 'error');
  const warns = derived.issues.filter((i) => i.level === 'warn');
  const props = { file: session.file, state: session.state, derived, setState };

  return (
    <div className="jobview" data-testid="jobview" data-file={session.file.name} data-session={session.id}>
      <div className="jobhead">
        <div className="jobtitle">
          <b>{session.file.name}</b> <span className="badge">{session.file.kind.toUpperCase()}</span>
        </div>
        <div className="jobactions">
          {derived.materials.length > 1 && (
            <select aria-label="Šta se poredi" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">Svi zapisi</option>
              {derived.materials.map((m) => <option key={m.source} value={m.source}>{m.source || '(bez materijala)'}</option>)}
            </select>
          )}
          <button type="button" className="btn" data-testid="compare" disabled={!derived.records.length} onClick={() => void compareWithTab()}>Uporedi sa .tab…</button>
          <ExportControls derived={derived} />
        </div>
      </div>
      {note && <p className="banner error" role="alert">{note}</p>}
      {errors.length > 0 && (
        <ul className="issues errors" data-testid="issues-errors">
          {errors.map((i, k) => <li key={k}>{i.msg}</li>)}
        </ul>
      )}
      {warns.length > 0 && (
        <details className="issues" data-testid="issues-warns">
          <summary>Upozorenja ({warns.length})</summary>
          <ul>{warns.map((i, k) => <li key={k}>{i.msg}</li>)}</ul>
        </details>
      )}
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={session.tab === id} data-testid={`tab-${id}`} className={session.tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel">
        {session.tab === 'parts' && <PartsTable derived={derived} setState={setState} rules={EDGE_RULES} />}
        {session.tab === 'materials' && <div className="scroll"><MaterialsTab {...props} catalog={catalog} /></div>}
        {session.tab === 'source' && <div className="scroll"><SourceTab {...props} /></div>}
        {session.tab === 'exports' && <div className="scroll"><ExportsTab log={session.log} /></div>}
      </div>
    </div>
  );
}
