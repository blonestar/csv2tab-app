import { useEffect, useRef, useState } from 'react';
import type { MenuRequest } from '../shared/api';
import { About } from './pages/About';
import { Catalog } from './pages/Catalog';
import { Jobs } from './pages/Jobs';
import { Settings, type SettingsSection } from './pages/Settings';
import { SessionProvider } from './session';
import { SettingsProvider } from './settings';
import { useUpdateState, waitingVersion } from './update';

const PAGES = [
  { id: 'jobs', label: 'Poslovi' },
  { id: 'catalog', label: 'Katalog' },
  { id: 'settings', label: 'Podešavanja' },
  { id: 'about', label: 'O programu' },
] as const;

type PageId = (typeof PAGES)[number]['id'];

export function App() {
  const [page, setPage] = useState<PageId>('jobs');
  const [request, setRequest] = useState<MenuRequest | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const update = useUpdateState();
  // Podešavanja iz bočne trake i menija otvaraju Opšte; kartica Ažuriranja se otvara samo iz obaveštenja i menija
  const showPage = (id: PageId) => {
    if (id === 'settings') setSettingsSection('general');
    setPage(id);
  };
  const newVersion = waitingVersion(update);
  const serial = useRef(0);
  useEffect(() => window.api.lifecycle.onCommand((kind) => {
    if (kind === 'theme-changed') return;
    if (kind === 'settings' || kind === 'about') showPage(kind);
    else if (kind === 'updates') {
      openUpdates();
      // ručna provera iz menija; nepodržana varijanta samo prikazuje objašnjenje u kartici
      void window.api.update.state()
        .then((s) => (s.variant === 'unsupported' ? undefined : window.api.update.check()))
        .catch(() => undefined);
    } else {
      setPage('jobs');
      setRequest({ kind, id: ++serial.current });
    }
  }), []);

  function openUpdates() {
    setSettingsSection('updates');
    setPage('settings');
  }

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
              onClick={() => showPage(p.id)}
            >
              {p.label}
            </button>
          ))}
          {newVersion && (
            <button type="button" className="nav update-notice" data-testid="update-notice" onClick={openUpdates}>
              Dostupna je nova verzija {newVersion}
            </button>
          )}
        </nav>
        <main className="content">
          {page === 'jobs' && <Jobs request={request} onHandled={(id) => setRequest((r) => r?.id === id ? null : r)} />}
          {page === 'catalog' && <Catalog />}
          {page === 'settings' && <Settings section={settingsSection} onSection={setSettingsSection} />}
          {page === 'about' && <About />}
        </main>
      </div>
    </SessionProvider>
    </SettingsProvider>
  );
}
