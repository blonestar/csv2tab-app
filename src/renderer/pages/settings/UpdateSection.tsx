// Ažuriranje programa: učestalost i pokretanje provere, stanje i preuzimanje. Sve ide kroz window.api.update; izbori
// učestalosti se upisuju odmah, kao tema. Instalaciju uvek pokreće korisnik (dugme), nikad automatski.
import { useState } from 'react';
import { UPDATE_INTERVALS, type UpdateInterval } from '../../../shared/settings';
import type { UpdatePhase, UpdateVariant } from '../../../shared/update';
import { errText, formatDateTime } from '../../format';
import { useSettings } from '../../settings';
import { useUpdateState } from '../../update';

const INTERVAL_LABEL: Record<UpdateInterval, string> = {
  daily: 'Svakog dana',
  weekly: 'Jednom nedeljno',
  monthly: 'Jednom mesečno',
  never: 'Nikad',
};

const UNSUPPORTED =
  'Ažuriranje je dostupno samo u instaliranoj verziji programa (Windows instalacija, portable ili AppImage).';

function StatusMessage({ phase, variant, onDownload, onInstall }: {
  phase: UpdatePhase;
  variant: UpdateVariant;
  onDownload: () => void;
  onInstall: () => void;
}) {
  switch (phase.kind) {
    case 'idle':
      return null;
    case 'checking':
      return <span>Proveravam…</span>;
    case 'none':
      return <span>Imate najnoviju verziju.</span>;
    case 'available':
      return (
        <>
          <span>Dostupna je verzija {phase.version}.</span>
          <button type="button" className="btn primary" data-testid="update-download" onClick={onDownload}>Preuzmi</button>
        </>
      );
    case 'downloading':
      return (
        <>
          <span>Preuzimanje verzije {phase.version}: {phase.percent}%</span>
          <progress value={phase.percent} max={100} />
        </>
      );
    case 'downloaded':
      if (variant === 'portable') {
        return (
          <>
            <span>Verzija {phase.version} je sačuvana kao <b>{phase.fileName ?? ''}</b> pored ovog programa.</span>
            <button type="button" className="btn primary" data-testid="update-install" onClick={onInstall}>Pokreni novu verziju</button>
          </>
        );
      }
      return (
        <>
          <span>Verzija {phase.version} je preuzeta.</span>
          <button type="button" className="btn primary" data-testid="update-install" onClick={onInstall}>Restartuj i instaliraj</button>
        </>
      );
    case 'error':
      return <p role="alert" className="banner error">{phase.message}</p>;
  }
}

export function UpdateSection() {
  const { settings, set } = useSettings();
  const state = useUpdateState();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e: unknown) => setError(errText(e)));
  };

  const phase: UpdatePhase = state?.phase ?? { kind: 'idle' };
  const busy = phase.kind === 'checking' || phase.kind === 'downloading';

  return (
    <section data-testid="updates">
      {error && <p role="alert" className="banner error">Greška: {error}</p>}

      <fieldset className="group">
        <legend>Provera novih verzija</legend>
        <p className="muted small">Učestalost određuje koliko često program sam proverava da li postoji novije izdanje. Checkbox ispod ne zavisi od učestalosti: ako je uključen, provera ide pri svakom pokretanju.</p>
        {UPDATE_INTERVALS.map((i) => (
          <label key={i} className="choice">
            <input
              type="radio"
              name="updateInterval"
              value={i}
              checked={settings?.updateInterval === i}
              disabled={!settings}
              onChange={() => act(() => set('updateInterval', i))}
            />
            {INTERVAL_LABEL[i]}
          </label>
        ))}
        <label className="choice">
          <input
            type="checkbox"
            data-testid="update-on-startup"
            checked={settings?.updateOnStartup ?? false}
            disabled={!settings}
            onChange={(e) => act(() => set('updateOnStartup', e.target.checked))}
          />{' '}
          Proveri ažuriranja pri pokretanju
        </label>
      </fieldset>

      <fieldset className="group">
        <legend>Stanje</legend>
        <div className="folder-row">
          <span className="folder-label">Instalirana verzija</span>
          <code data-testid="update-current">{state?.currentVersion ?? '…'}</code>
        </div>
        <div className="folder-row">
          <span className="folder-label">Poslednja provera</span>
          <span data-testid="update-last-check">
            {state ? (state.lastCheck === null ? 'još nije proveravano' : formatDateTime(state.lastCheck)) : '…'}
          </span>
        </div>
        {state?.variant === 'unsupported' ? (
          <p className="muted" data-testid="update-unsupported">{UNSUPPORTED}</p>
        ) : (
          <>
            <div className="row-actions">
              <button
                type="button"
                className="btn"
                data-testid="update-check"
                disabled={!state || busy}
                onClick={() => act(() => window.api.update.check())}
              >
                Proveri sada
              </button>
            </div>
            <div className="row-actions" data-testid="update-status" data-state={phase.kind}>
              <StatusMessage
                phase={phase}
                variant={state?.variant ?? 'unsupported'}
                onDownload={() => act(() => window.api.update.download())}
                onInstall={() => act(() => window.api.update.install())}
              />
            </div>
          </>
        )}
      </fieldset>
    </section>
  );
}
