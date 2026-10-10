// Poslovi: lista sačuvanih poslova (uvoz i prevlačenje fajla) ili otvoren posao. Uvoz uvek pravi posao u bazi;
// ako je isti fajl već uvezen, korisnik bira između postojećeg i novog posla.
import { useEffect, useRef, useState } from 'react';
import type { MenuRequest } from '../../shared/api';
import { MAX_OPEN_BYTES, UNSUPPORTED_MSG, kindFromName, type OpenedFile } from '../../shared/job';
import type { JobListItem } from '../../shared/jobs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { errText, formatDateTime } from '../format';
import { JobList } from '../job/JobList';
import { JobView } from '../job/JobView';
import { useSession } from '../session';

type Retry = (force: boolean) => Promise<void>;

export function Jobs({ request, onHandled }: { request?: MenuRequest | null; onHandled?: (id: number) => void }) {
  const { session, derived, openJob, importFile, createFromFile, closeJob, catalog, catalogError } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [duplicate, setDuplicate] = useState<{ file: OpenedFile; existing: JobListItem[] } | null>(null);
  // radnja koju je zaustavilo neuspelo čuvanje otvorenog posla; korisnik bira ponovni pokušaj ili nastavak bez čuvanja
  const [blocked, setBlocked] = useState<Retry | null>(null);
  const handled = useRef(0);
  const consuming = useRef(false);
  const pumpAgain = useRef(false);
  const [queueTick, setQueueTick] = useState(0);
  const [searchRequest, setSearchRequest] = useState(0);
  const [exportRequest, setExportRequest] = useState<{ id: number; session: number } | null>(null);

  async function guarded(retry: Retry, force = false) {
    setError(null);
    try {
      await retry(force);
    } catch (e) {
      setError(errText(e));
    }
  }

  const doImport =
    (file: OpenedFile): Retry =>
    async (force) => {
      const r = await importFile(file, force);
      if (r.kind === 'blocked') setBlocked(() => doImport(file));
      else if (r.kind === 'exists') setDuplicate({ file, existing: r.existing });
    };
  const doOpen =
    (id: number): Retry =>
    async (force) => {
      if ((await openJob(id, force)) === 'blocked') setBlocked(() => doOpen(id));
    };
  const doCreate =
    (file: OpenedFile): Retry =>
    async (force) => {
      if ((await createFromFile(file, force)) === 'blocked') setBlocked(() => doCreate(file));
    };
  const doClose: Retry = async (force) => {
    if ((await closeJob(force)) === 'blocked') setBlocked(() => doClose);
  };

  async function importDialog() {
    setError(null);
    try {
      const f = await window.api.files.open('import');
      if (f) await guarded(doImport(f));
    } catch (e) {
      setError(errText(e));
    }
  }

  useEffect(() => {
    if (!request || !catalog || handled.current === request.id) return;
    handled.current = request.id;
    if (document.querySelector('[role=dialog]')) { onHandled?.(request.id); return; }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (request.kind === 'import') void importDialog();
    if (request.kind === 'export') {
      if (session && derived?.canExport) setExportRequest({ id: request.id, session: session.id });
      else setError('Otvorite posao sa zapisima pre izvoza.');
    }
    if (request.kind === 'search') {
      const search: Retry = async (force) => {
        if (await closeJob(force) === 'blocked') setBlocked(() => search);
        else setSearchRequest(request.id);
      };
      void guarded(search);
    }
    onHandled?.(request.id);
  }, [request, catalog]);

  // Red se čita tek kad je katalog spreman; duplikat ili neuspelo čuvanje zaustavlja sledeći uvoz do odluke.
  useEffect(() => {
    if (!catalog || duplicate || blocked || document.querySelector('[role=dialog]')) return;
    if (consuming.current) { pumpAgain.current = true; return; }
    consuming.current = true;
    pumpAgain.current = false;
    let consumed = false;
    void (async () => {
      try {
        const file = await window.api.files.next();
        if (file) {
          consumed = true;
          await guarded(doImport(file));
        }
      } catch (e) {
        consumed = true;
        setError(errText(e));
      } finally {
        consuming.current = false;
        if (consumed || pumpAgain.current) setQueueTick((n) => n + 1);
      }
    })();
  }, [catalog, request?.id, queueTick, duplicate, blocked, session]);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setError(null);
    const kind = kindFromName(f.name);
    if (!kind) return setError(UNSUPPORTED_MSG);
    if (f.size > MAX_OPEN_BYTES) return setError('Fajl je veći od 50 MB.');
    try {
      await guarded(doImport({ name: f.name, kind, bytes: new Uint8Array(await f.arrayBuffer()) }));
    } catch (err) {
      setError(errText(err));
    }
  }

  const dup = duplicate?.existing[0];
  return (
    <div
      className={dragging ? 'jobs-page dragging' : 'jobs-page'}
      data-testid="jobs-page"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => void onDrop(e)}
    >
      {session ? (
        <div className="pagehead">
          <button type="button" className="btn" data-testid="close-job" onClick={() => void guarded(doClose)}>← Poslovi</button>
        </div>
      ) : (
        <>
          <h1>Poslovi</h1>
          <div className="dropzone" data-testid="dropzone">
            <button type="button" className="btn primary" data-testid="import" onClick={() => void importDialog()}>Uvezi fajl…</button>
            <span className="muted">ili prevucite .csv, .ods, .xlsx ili .tab ovde</span>
          </div>
        </>
      )}
      {catalogError && <p role="alert" className="banner error">Katalog se ne može učitati: {catalogError}</p>}
      {error && <p role="alert" className="banner error" data-testid="import-error">{error}</p>}
      {session ? (
        derived || session.stateError ? <JobView key={session.id} session={session} derived={derived} exportRequest={exportRequest?.session === session.id ? exportRequest.id : undefined} /> : <p className="muted">Učitavam katalog…</p>
      ) : (
        <JobList onOpen={(id) => void guarded(doOpen(id))} focusRequest={searchRequest} />
      )}
      {duplicate && dup && (
        <ConfirmDialog
          title="Ovaj fajl je već uvezen"
          testId="duplicate-dialog"
          actions={[
            { label: 'Otvori postojeći posao', testId: 'duplicate-open', kind: 'primary', onClick: () => { setDuplicate(null); void guarded(doOpen(dup.id)); } },
            { label: 'Napravi novi posao', testId: 'duplicate-new', onClick: () => { const f = duplicate.file; setDuplicate(null); void guarded(doCreate(f)); } },
            { label: 'Odustani', testId: 'duplicate-cancel', onClick: () => setDuplicate(null) },
          ]}
        >
          <p>
            Fajl „{duplicate.file.name}" je isti kao izvor posla „{dup.name}" ({formatDateTime(dup.createdAt)})
            {duplicate.existing.length > 1 ? ` i još ${duplicate.existing.length - 1} ${duplicate.existing.length === 2 ? 'posla' : 'poslova'}` : ''}.
            Možete otvoriti postojeći posao sa svim izmenama ili napraviti nov od početka.
          </p>
        </ConfirmDialog>
      )}
      {blocked && (
        <ConfirmDialog
          title="Izmene posla nisu sačuvane"
          testId="blocked-dialog"
          actions={[
            { label: 'Pokušaj ponovo', testId: 'blocked-retry', kind: 'primary', onClick: () => { const r = blocked; setBlocked(null); void guarded(r); } },
            { label: 'Nastavi bez čuvanja', testId: 'blocked-force', kind: 'danger', onClick: () => { const r = blocked; setBlocked(null); void guarded(r, true); } },
            { label: 'Ostani u poslu', testId: 'blocked-cancel', onClick: () => setBlocked(null) },
          ]}
        >
          <p>Poslednje izmene otvorenog posla nisu upisane u bazu. Ako nastavite bez čuvanja, te izmene se gube.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
