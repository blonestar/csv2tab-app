import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/api';

export function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.app.info().then(setInfo, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <>
      <h1>O programu</h1>
      {error && <p role="alert">Greška: {error}</p>}
      {info && (
        <dl className="facts" data-testid="app-info">
          <dt>Aplikacija</dt>
          <dd>{info.appVersion}</dd>
          <dt>Jezgro konverzije</dt>
          <dd>{info.coreVersion}</dd>
          <dt>Electron</dt>
          <dd>{info.electron}</dd>
          <dt>Chrome</dt>
          <dd>{info.chrome}</dd>
          <dt>Node</dt>
          <dd>{info.node}</dd>
          <dt>Sistem</dt>
          <dd>{info.platform}</dd>
        </dl>
      )}
    </>
  );
}
