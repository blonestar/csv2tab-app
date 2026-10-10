import { useEffect, useRef, useState } from 'react';
import type { MenuRequest } from '../shared/api';
import { About } from './pages/About';
import { Catalog } from './pages/Catalog';
import { Jobs } from './pages/Jobs';
import { Settings } from './pages/Settings';
import { SessionProvider } from './session';
import { SettingsProvider } from './settings';

const PAGES = [
  { id: 'jobs', label: 'Poslovi', view: Jobs },
  { id: 'catalog', label: 'Katalog', view: Catalog },
  { id: 'settings', label: 'Podešavanja', view: Settings },
  { id: 'about', label: 'O programu', view: About },
] as const;

type PageId = (typeof PAGES)[number]['id'];

export function App() {
  const [page, setPage] = useState<PageId>('jobs');
  const [request, setRequest] = useState<MenuRequest | null>(null);
  const serial = useRef(0);
  useEffect(() => window.api.lifecycle.onCommand((kind) => {
    if (kind === 'theme-changed') return;
    if (kind === 'settings' || kind === 'about') setPage(kind);
    else {
      setPage('jobs');
      setRequest({ kind, id: ++serial.current });
    }
  }), []);
  const View = PAGES.find((p) => p.id === page)!.view;
  return (
    <SettingsProvider>
    <SessionProvider>
      <div className="shell">
        <nav className="sidebar" aria-label="Glavni meni">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === page ? 'nav active' : 'nav'}
              aria-current={p.id === page ? 'page' : undefined}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <main className="content">
          {page === 'jobs' ? <Jobs request={request} onHandled={(id) => setRequest((r) => r?.id === id ? null : r)} /> : <View />}
        </main>
      </div>
    </SessionProvider>
    </SettingsProvider>
  );
}
