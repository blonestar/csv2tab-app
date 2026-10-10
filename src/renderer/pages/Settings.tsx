import { useEffect, useState } from 'react';
import { THEMES, type Theme } from '../../shared/settings';

const LABELS: Record<Theme, string> = { system: 'Sistemska', light: 'Svetla', dark: 'Tamna' };

export function Settings() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.settings.get('theme').then(setTheme, (e: unknown) => setError(String(e)));
  }, []);

  // Glavni proces upisuje u bazu i odmah primenjuje temu (nativeTheme), pa CSS sam prati izbor.
  function choose(next: Theme) {
    setError(null);
    window.api.settings.set('theme', next).then(setTheme, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }

  return (
    <>
      <h1>Podešavanja</h1>
      {error && <p role="alert">Greška: {error}</p>}
      <fieldset className="group" disabled={theme === null}>
        <legend>Tema</legend>
        {THEMES.map((t) => (
          <label key={t} className="choice">
            <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => choose(t)} />
            {LABELS[t]}
          </label>
        ))}
      </fieldset>
      <p className="muted">Folderi, tabela šifara kantovanja i pravila stižu u fazi 5.</p>
    </>
  );
}
