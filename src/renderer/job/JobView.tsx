import { useState } from 'react';
import { readWtTab } from '@core/wtTab';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PartsTable } from '../components/PartsTable';
import { STATUS_LABEL, errText } from '../format';
import { useSession, type JobSession, type SaveStatus, type TabId } from '../session';
import { EDGE_RULES } from './defaults';
import type { DerivedJob } from './derive';
import { ExportControls } from './ExportControls';
import { ExportsTab, MaterialsTab, SourceTab } from './tabs';

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'Sačuvano',
  dirty: 'Izmene čekaju čuvanje…',
  saving: 'Čuvam…',
  failed: 'Nije sačuvano',
};

/** Polje koje se upisuje tek na Enter / napuštanje; Esc vraća staro. */
function MetaField({ value, label, placeholder, className, testId, maxLength, onCommit }: {
  value: string;
  label: string;
  placeholder?: string;
  className: string;
  testId: string;
  maxLength: number;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      type="text"
      className={className}
      aria-label={label}
      data-testid={testId}
      placeholder={placeholder}
      maxLength={maxLength}
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
  );
}

export function JobView({ session, derived }: { session: JobSession; derived: DerivedJob | null }) {
  const { catalog, setState, setTab, saveStatus, saveError, flush, updateMeta, deleteJob } = useSession();
  const [scope, setScope] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function meta(m: { name?: string; note?: string }) {
    setNote(null);
    try {
      await updateMeta(m);
    } catch (e) {
      setNote(errText(e));
    }
  }

  async function remove() {
    setConfirmDelete(false);
    setNote(null);
    try {
      await deleteJob(session.jobId);
    } catch (e) {
      setNote(errText(e));
    }
  }

  async function compareWithTab() {
    setNote(null);
    try {
      const other = await window.api.files.open('compare');
      if (!other || !derived) return;
      const tab = readWtTab(other.bytes);
      const mine = derived.records.filter((r) => scope === '' || r.rec.material === scope).map(({ rec: p }) => ({
        dim1: p.dim1, dim2: p.dim2, edge1: p.edge1, edge2: p.edge2, grain: p.grain, qty: p.qty, name: p.name,
      }));
      await window.api.compare.open({ aName: `Posao: ${session.name}${scope ? ` / ${scope}` : ''}`, bName: other.name, a: mine, b: tab.parts });
    } catch (e) {
      setNote(errText(e));
    }
  }

  const exportedCount = session.exports.exports.length;
  const head = (
    <>
      <div className="jobhead">
        <MetaField className="jobname" label="Ime posla" testId="job-name" value={session.name} maxLength={200} onCommit={(v) => void meta({ name: v })} />
        <span className="badge">{session.file.kind.toUpperCase()}</span>
        <span className={`status ${session.exports.status}`} data-testid="job-status" data-status={session.exports.status}>{STATUS_LABEL[session.exports.status]}</span>
        <span
          className={`savestate ${saveStatus}`}
          role="status"
          data-testid="save-state"
          data-state={saveStatus}
          title={saveStatus === 'failed' ? saveError ?? undefined : 'Izmene se čuvaju same'}
        >
          {SAVE_LABEL[saveStatus]}
        </span>
        {saveStatus === 'failed' && <button type="button" className="btn small" data-testid="save-retry" onClick={() => void flush()}>Pokušaj ponovo</button>}
        <button type="button" className="btn small danger-text" data-testid="delete-job" onClick={() => setConfirmDelete(true)}>Obriši posao…</button>
      </div>
      <div className="jobsub">
        <MetaField className="jobnote" label="Napomena" testId="job-note" placeholder="Napomena…" value={session.note} maxLength={2000} onCommit={(v) => void meta({ note: v })} />
        <span className="muted small" title={session.file.name}>Izvor: {session.file.name}</span>
      </div>
      {saveStatus === 'failed' && (
        <p className="banner error" role="alert" data-testid="save-error">
          Izmene nisu upisane u bazu i čuvanje se ponavlja: {saveError}
        </p>
      )}
      {note && <p className="banner error" role="alert">{note}</p>}
      {confirmDelete && (
        <ConfirmDialog
          title="Obrisati posao?"
          testId="delete-dialog"
          actions={[
            { label: 'Obriši posao', testId: 'delete-confirm', kind: 'danger', onClick: () => void remove() },
            { label: 'Odustani', testId: 'delete-cancel', onClick: () => setConfirmDelete(false) },
          ]}
        >
          <p>
            Posao „{session.name}" se briše zajedno sa izvornim fajlom, ručnim izmenama i
            {exportedCount ? ` ${exportedCount} sačuvanih izvoza` : ' sačuvanim izvozima'}. Fajlovi koji su već upisani u WT folder ostaju netaknuti.
          </p>
        </ConfirmDialog>
      )}
    </>
  );

  if (session.stateError || !derived || !catalog) {
    return (
      <div className="jobview" data-testid="jobview" data-job={session.jobId} data-session={session.id}>
        {head}
        <p className="banner error" role="alert" data-testid="state-error">
          {session.stateError ?? 'Posao se ne može prikazati.'} Posao se ne menja i ne izvozi dok se ne otvori odgovarajućom verzijom programa; može se obrisati.
        </p>
      </div>
    );
  }

  const tabs: [TabId, string][] = [
    ['parts', `Zapisi (${derived.records.length})`],
    ['materials', `Materijali (${derived.materials.length})`],
    ['source', 'Izvor'],
    ['exports', `Izvozi (${exportedCount})`],
  ];
  const errors = derived.issues.filter((i) => i.level === 'error');
  const warns = derived.issues.filter((i) => i.level === 'warn');
  const props = { file: session.file, state: session.state, derived, setState };

  return (
    <div className="jobview" data-testid="jobview" data-file={session.file.name} data-job={session.jobId} data-session={session.id}>
      {head}
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
        {session.tab === 'exports' && <div className="scroll"><ExportsTab exports={session.exports} /></div>}
      </div>
    </div>
  );
}
