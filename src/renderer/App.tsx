import { useState } from 'react';
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
          <View />
        </main>
      </div>
    </SessionProvider>
    </SettingsProvider>
  );
}
