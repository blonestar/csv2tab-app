// Rezervna kopija baze i vraćanje iz kopije. Putanje bira korisnik u sistemskom dijalogu glavnog procesa.
import { useState } from 'react';
import type { BackupInfo, RestoreOutcome, RestorePreview } from '../../../shared/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errText, formatDateTime, formatSize } from '../../format';
import { useSession } from '../../session';
import { useSettings } from '../../settings';

export function BackupSection() {
  const { settings, reload } = useSettings();
  const { closeJob } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<BackupInfo | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [done, setDone] = useState<RestoreOutcome | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const chooseFolder = () => run(async () => { if (await window.api.files.chooseFolder('backupFolder')) await reload(); });
  const create = () => run(async () => { setMade(null); setMade(await window.api.backup.create()); });
  const inspect = () => run(async () => { setMade(null); setPreview(await window.api.backup.inspect()); });
  const cancel = () => {
    const p = preview;
    setPreview(null);
    if (p) void window.api.backup.cancel(p.token).catch(() => undefined);
  };
  const restore = () =>
    run(async () => {
      const p = preview;
      if (!p) return;
      setPreview(null);
      const out = await window.api.backup.restore(p.token);
      // otvoren posao pripada staroj bazi; baza ga više ne prima, pa se prikaz samo napušta
      await closeJob(true).catch(() => undefined);
      setDone(out);
    });

  const folder = settings?.backupFolder;
  return (
    <section data-testid="backup">
      <p className="muted small">
        Kopija je jedan fajl sa svim poslovima, izvozima, pamćenim izborima i podešavanjima. Pravi se ručno, u folder koji
        izaberete. Kopirajte je i na drugi disk ili računar: baza i kopija na istom disku ne štite od kvara diska.
      </p>
      {error && <p className="banner error" role="alert" data-testid="backup-error">{error}</p>}

      <h2>Pravljenje kopije</h2>
      <div className="folder-row">
        <span className="muted">Folder:</span>
        <code data-testid="backup-folder">{folder === undefined ? '…' : folder || 'nije zadat'}</code>
        <button type="button" className="btn" data-testid="choose-backup-folder" disabled={busy || folder === undefined} onClick={() => void chooseFolder()}>Izaberi…</button>
      </div>
      <div className="row-actions">
        <button type="button" className="btn primary" data-testid="backup-create" disabled={busy || !folder} onClick={() => void create()}>Napravi rezervnu kopiju</button>
        {!folder && <span className="muted small">Prvo izaberite folder.</span>}
      </div>
      {made && (
        <p className="banner ok" role="status" data-testid="backup-made">
          <span>Kopija je napravljena: <b data-testid="backup-made-name">{made.name}</b> ({formatSize(made.size)}, poslova: {made.jobs}) u {made.folder}.</span>
        </p>
      )}

      <h2>Vraćanje iz kopije</h2>
      <p className="muted small">
        Izaberite fajl kopije. Pre zamene se proverava da li je ispravna baza ovog programa i da li je iz iste ili starije
        verzije; trenutna baza se pre zamene sačuva pored svog fajla.
      </p>
      <div className="row-actions">
        <button type="button" className="btn" data-testid="backup-restore" disabled={busy} onClick={() => void inspect()}>Vrati iz kopije…</button>
      </div>

      {preview && (
        <ConfirmDialog
          title="Vratiti bazu iz kopije?"
          testId="restore-dialog"
          actions={[
            { label: 'Zameni trenutnu bazu', testId: 'restore-confirm', kind: 'danger', onClick: () => void restore() },
            { label: 'Odustani', testId: 'restore-cancel', onClick: cancel },
          ]}
        >
          <p><b data-testid="restore-file">{preview.fileName}</b> ({formatSize(preview.size)})</p>
          <ul className="small">
            <li data-testid="restore-jobs">Poslova u kopiji: {preview.jobs}</li>
            <li>Najnoviji posao menjan: {preview.newestJobAt === null ? '—' : formatDateTime(preview.newestJobAt)}</li>
            {preview.schemaVersion < preview.appSchemaVersion && <li>Kopija je iz starije verzije programa i biće prilagođena novoj.</li>}
          </ul>
          <p><b>Trenutna baza će biti zamenjena</b> (poslovi, izvozi, zapamćeni izbori i podešavanja), a njena kopija ostaje pored baze. Nesačuvane izmene otvorenog posla se prvo upisuju.</p>
        </ConfirmDialog>
      )}
      {done && (
        <ConfirmDialog
          title="Baza je vraćena"
          testId="restore-done"
          actions={[{ label: 'Nastavi', testId: 'restore-finish', kind: 'primary', onClick: () => void window.api.backup.finish() }]}
        >
          <p>Baza je zamenjena izabranom kopijom. Prethodna baza je sačuvana kao <b data-testid="restore-safety">{done.safetyName}</b> u folderu programa. Prozor će se ponovo učitati.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
