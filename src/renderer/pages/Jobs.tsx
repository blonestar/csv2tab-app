import { useState } from 'react';
import { MAX_OPEN_BYTES, UNSUPPORTED_MSG, kindFromName, type OpenedFile } from '../../shared/job';
import { JobView } from '../job/JobView';
import { useSession } from '../session';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export function Jobs() {
  const { session, open, close, isDirty, catalogError } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // fajl koji čeka potvrdu jer bi zamenio posao sa neodbačenim izmenama
  const [waiting, setWaiting] = useState<OpenedFile | 'close' | null>(null);

  function request(file: OpenedFile | 'close') {
    if (session && isDirty) setWaiting(file);
    else apply(file);
  }
  function apply(file: OpenedFile | 'close') {
    setWaiting(null);
    if (file === 'close') close();
    else open(file);
  }

  async function importDialog() {
    setError(null);
    try {
      const f = await window.api.files.open('import');
      if (f) request(f);
    } catch (e) {
      setError(errText(e));
    }
  }

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
      request({ name: f.name, kind, bytes: new Uint8Array(await f.arrayBuffer()) });
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <div
      className={dragging ? 'jobs-page dragging' : 'jobs-page'}
      data-testid="jobs-page"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => void onDrop(e)}
    >
      <h1>Poslovi</h1>
      <div className="dropzone" data-testid="dropzone">
        <button type="button" className="btn primary" data-testid="import" onClick={() => void importDialog()}>Uvezi fajl…</button>
        <span className="muted">ili prevucite .csv, .ods, .xlsx ili .tab ovde</span>
        {session && <button type="button" className="btn" data-testid="close-job" onClick={() => request('close')}>Zatvori posao</button>}
      </div>
      {catalogError && <p role="alert" className="banner error">Katalog se ne može učitati: {catalogError}</p>}
      {error && <p role="alert" className="banner error" data-testid="import-error">{error}</p>}
      {session ? (
        <JobView key={session.id} session={session} />
      ) : (
        <p className="muted">Nema otvorenog posla. Lista sačuvanih poslova stiže u fazi 4; za sada se radi s jednim uvezenim fajlom.</p>
      )}
      {waiting && (
        <div className="overlay">
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Neodbačene izmene" data-testid="discard-dialog">
            <h2>Odbaciti izmene?</h2>
            <p>Otvoreni posao ima izmene koje nisu sačuvane (čuvanje poslova stiže u fazi 4). {waiting === 'close' ? 'Zatvaranjem' : 'Uvozom drugog fajla'} one se gube.</p>
            <div className="dialog-actions">
              <button type="button" className="btn primary" data-testid="discard-confirm" onClick={() => apply(waiting)}>Odbaci izmene</button>
              <button type="button" className="btn" data-testid="discard-cancel" onClick={() => setWaiting(null)}>Odustani</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
