import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { convertToTab, roundTripTab } from './coreCheck';
import './styles.css';

// Samo u test režimu (CSV2TAB_TEST=1): smoke test iz Playwrighta poziva jezgro u pravom rendereru.
void window.api.app.info().then((info) => {
  if (info.testMode) (window as unknown as { __csv2tab: unknown }).__csv2tab = { convertToTab, roundTripTab };
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
