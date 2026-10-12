// Podešavanja: više odeljaka (kartice) da stranica ostane pregledna. Svaka izmena se čuva čim se napravi.
import { useState } from 'react';
import { THEMES, type Theme } from '../../shared/settings';
import { errText } from '../format';
import { useSession } from '../session';
import { useSettings } from '../settings';
import { BackupSection } from './settings/BackupSection';
import { EdgeRulesEditor } from './settings/EdgeRulesEditor';
import { MemorySection } from './settings/MemorySection';
import { UpdateSection } from './settings/UpdateSection';

const LABELS: Record<Theme, string> = { system: 'Sistemska', light: 'Svetla', dark: 'Tamna' };

const SECTIONS = [
  { id: 'general', label: 'Opšte' },
  { id: 'edge', label: 'Šifre kantovanja' },
  { id: 'memory', label: 'Zapamćeni izbori' },
  { id: 'backup', label: 'Rezervna kopija' },
  { id: 'updates', label: 'Ažuriranja' },
] as const;
export type SettingsSection = (typeof SECTIONS)[number]['id'];

function General() {
  const { settings, set, reload } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(errText(e));
  if (!settings) return <p className="muted">Učitavam…</p>;

  return (
    <>
      {error && <p role="alert" className="banner error">Greška: {error}</p>}
      <fieldset className="group">
        <legend>Izgled</legend>
        {THEMES.map((t) => (
          <label key={t} className="choice">
            <input type="radio" name="theme" value={t} checked={settings.theme === t} onChange={() => { setError(null); set('theme', t).catch(fail); }} />
            {LABELS[t]}
          </label>
        ))}
      </fieldset>
      <fieldset className="group">
        <legend>Izvoz</legend>
        <label className="choice">
          <input type="checkbox" data-testid="export-ask" checked={settings.exportAsk} onChange={(e) => { setError(null); set('exportAsk', e.target.checked).catch(fail); }} />{' '}
          Pitaj me gde da sačuvam i kako da nazovem fajl pri svakom izvozu
        </label>
        <div className="folder-row">
          <span className="folder-label">Folder za izvoz</span>
          <code data-testid="wt-folder">{settings.wtFolder || 'nije zadat'}</code>
          <button
            type="button"
            className="btn"
            data-testid="choose-folder"
            onClick={() => { setError(null); window.api.files.chooseFolder('wtFolder').then((f) => (f ? reload() : undefined), fail); }}
          >
            Izaberi…
          </button>
        </div>
        <p className="muted small">
          {settings.exportAsk
            ? 'Dijalog za čuvanje se otvara u ovom folderu; pamti se poslednji u koji ste sačuvali.'
            : 'Izvoz upisuje .tab fajlove pravo u ovaj folder, bez pitanja; pita samo pre prepisivanja fajla koji se razlikuje.'}
        </p>
        <p className="muted small">Folder za rezervne kopije se bira u odeljku Rezervna kopija.</p>
      </fieldset>
      <fieldset className="group">
        <legend>Novi poslovi</legend>
        <p className="muted small">Važi za poslove koji se tek uvoze. Posao čuva svoja pravila iz trenutka uvoza; u kartici Izvor se vidi kad se razlikuju od ovih.</p>
        <label className="choice">
          <input type="checkbox" data-testid="merge-default" checked={settings.mergeDefault} onChange={(e) => { setError(null); set('mergeDefault', e.target.checked).catch(fail); }} />{' '}
          Spajaj iste delove
        </label>
        <label className="choice">
          <input type="checkbox" data-testid="decor-rule" checked={settings.decorRule} onChange={(e) => { setError(null); set('decorRule', e.target.checked).catch(fail); }} />{' '}
          Jednobojni dekori (naziv oblika „U" i cifre, npr. U702) podrazumevano ne prate teksturu
        </label>
        <p className="muted small">Isključeno: svi materijali podrazumevano prate teksturu. Izbor „Prati teksturu" za pojedinačni materijal uvek ima prednost.</p>
      </fieldset>
    </>
  );
}

/** Odeljak se drži u App (meni može da otvori određeni, npr. Ažuriranja), pa se pamti i kad se stranica zatvori. */
export function Settings({ section, onSection }: { section: SettingsSection; onSection: (s: SettingsSection) => void }) {
  const { settings, error } = useSettings();
  const { catalog } = useSession();

  return (
    <div className="settings-page" data-testid="settings-page">
      <h1>Podešavanja</h1>
      {error && <p role="alert" className="banner error">Greška: {error}</p>}
      <div className="tabs" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} data-testid={`settings-tab-${s.id}`} className={section === s.id ? 'tab active' : 'tab'} onClick={() => onSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="settings-panel" role="tabpanel">
        {section === 'general' && <General />}
        {section === 'edge' && (settings ? <EdgeRulesEditor rules={settings.edgeRules} /> : <p className="muted">Učitavam…</p>)}
        {section === 'memory' && <MemorySection catalog={catalog} />}
        {section === 'backup' && <BackupSection />}
        {section === 'updates' && <UpdateSection />}
      </div>
    </div>
  );
}
