import { useEffect, useState } from 'react';
import { THEMES, type Theme } from '../../shared/settings';

const LABELS: Record<Theme, string> = { system: 'Sistemska', light: 'Svetla', dark: 'Tamna' };
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export function Settings() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [wtFolder, setWtFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.settings.get('theme').then(setTheme, (e: unknown) => setError(errText(e)));
    window.api.settings.get('wtFolder').then(setWtFolder, (e: unknown) => setError(errText(e)));
  }, []);

  // Glavni proces upisuje u bazu i odmah primenjuje temu (nativeTheme), pa CSS sam prati izbor.
  function choose(next: Theme) {
    setError(null);
    window.api.settings.set('theme', next).then(setTheme, (e: unknown) => setError(errText(e)));
  }

  // Putanju bira korisnik u sistemskom dijalogu; renderer je ne zadaje.
  function chooseFolder() {
    setError(null);
    window.api.files.chooseFolder('wtFolder').then((f) => { if (f) setWtFolder(f); }, (e: unknown) => setError(errText(e)));
  }

  return (
    <>
      <h1>Podešavanja</h1>
      {error && <p role="alert" className="banner error">Greška: {error}</p>}
      <fieldset className="group" disabled={theme === null}>
        <legend>Tema</legend>
        {THEMES.map((t) => (
          <label key={t} className="choice">
            <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => choose(t)} />
            {LABELS[t]}
          </label>
        ))}
      </fieldset>
      <fieldset className="group" disabled={wtFolder === null}>
        <legend>WT folder</legend>
        <p className="muted small">Folder koji čita WT Input. Izvoz upisuje .tab fajlove pravo u njega.</p>
        <div className="folder-row">
          <code data-testid="wt-folder">{wtFolder === null ? '…' : wtFolder || 'nije zadat'}</code>
          <button type="button" className="btn" data-testid="choose-folder" onClick={chooseFolder}>Izaberi…</button>
        </div>
      </fieldset>
      <p className="muted">Ostali folderi, tabela šifara kantovanja i pravila stižu u fazi 5.</p>
    </>
  );
}
