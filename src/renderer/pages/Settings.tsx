// Podešavanja: više odeljaka (kartice) da stranica ostane pregledna. Svaka izmena se čuva čim se napravi.
import { useState } from 'react';
import { THEMES, type Theme } from '../../shared/settings';
import { errText } from '../format';
import { useSession } from '../session';
import { useSettings } from '../settings';
import { BackupSection } from './settings/BackupSection';
import { EdgeRulesEditor } from './settings/EdgeRulesEditor';
import { MemorySection } from './settings/MemorySection';

const LABELS: Record<Theme, string> = { system: 'Sistemska', light: 'Svetla', dark: 'Tamna' };

const SECTIONS = [
  { id: 'general', label: 'Opšte' },
  { id: 'edge', label: 'Šifre kantovanja' },
  { id: 'memory', label: 'Zapamćeni izbori' },
  { id: 'backup', label: 'Rezervna kopija' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

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
        <legend>Folderi</legend>
        <p className="muted small">WT folder je mesto odakle WT Input čita .tab fajlove; izvoz upisuje pravo u njega.</p>
        <div className="folder-row">
          <span className="folder-label">WT folder</span>
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

export function Settings() {
  const { settings, error } = useSettings();
  const { catalog } = useSession();
  const [section, setSection] = useState<SectionId>('general');

  return (
    <div className="settings-page" data-testid="settings-page">
      <h1>Podešavanja</h1>
      {error && <p role="alert" className="banner error">Greška: {error}</p>}
      <div className="tabs" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} data-testid={`settings-tab-${s.id}`} className={section === s.id ? 'tab active' : 'tab'} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="settings-panel" role="tabpanel">
        {section === 'general' && <General />}
        {section === 'edge' && (settings ? <EdgeRulesEditor rules={settings.edgeRules} /> : <p className="muted">Učitavam…</p>)}
        {section === 'memory' && <MemorySection catalog={catalog} />}
        {section === 'backup' && <BackupSection />}
      </div>
    </div>
  );
}
