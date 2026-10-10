import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { convertToTab, roundTripTab } from './coreCheck';
import { Compare } from './pages/Compare';
import './styles.css';

// Samo u test režimu (CSV2TAB_TEST=1): smoke test iz Playwrighta poziva jezgro u pravom rendereru.
void window.api.app.info().then((info) => {
  if (info.testMode) (window as unknown as { __csv2tab: unknown }).__csv2tab = { convertToTab, roundTripTab };
});

// Isti bundle služi glavni prozor i prozor poređenja (#compare=<id>).
const compareId = /^#compare=([0-9a-f-]{36})$/.exec(location.hash)?.[1];
if (compareId) document.title = 'csv2tab — poređenje';

// Pušten fajl van zone za prevlačenje ne sme da pokrene navigaciju prozora.
for (const ev of ['dragover', 'drop'] as const) window.addEventListener(ev, (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(<StrictMode>{compareId ? <Compare id={compareId} /> : <App />}</StrictMode>);
