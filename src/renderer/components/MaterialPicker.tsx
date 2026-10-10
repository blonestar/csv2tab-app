// Izbor WT materijala: polje za pretragu kataloga sa spiskom poklapanja.
import { useId, useState } from 'react';
import { materialLabel, searchMaterials, type WtCatalog, type WtMaterial } from '@core/catalog';

export function MaterialPicker({ catalog, value, auto, onPick, label }: {
  catalog: WtCatalog;
  value: WtMaterial | undefined;
  auto: boolean;
  /** string = šifra, null = nijedan, undefined = vrati automatski predlog */
  onPick: (code: string | null | undefined) => void;
  label: string;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const listId = useId();
  const found = query ? searchMaterials(catalog, query, 12) : [];
  const close = () => setQuery(null);
  return (
    <div className="picker">
      <input
        type="text"
        role="combobox"
        aria-expanded={query !== null && found.length > 0}
        aria-controls={listId}
        aria-label={label}
        data-testid="wt-material"
        placeholder="šifra ili naziv iz kataloga…"
        autoComplete="off"
        value={query ?? (value ? materialLabel(value) : '')}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(close, 120)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && found[0]) {
            onPick(found[0].code);
            close();
          }
        }}
      />
      {auto && value && <span className="muted tag" title="Predlog po šifri iz fajla">predlog</span>}
      {value && (
        <button type="button" className="icon" title="Bez WT materijala" aria-label="Ukloni WT materijal" onClick={() => onPick(null)}>×</button>
      )}
      {!auto && (
        <button type="button" className="icon" title="Vrati automatski predlog" aria-label="Vrati predlog" onClick={() => onPick(undefined)}>↺</button>
      )}
      {query !== null && found.length > 0 && (
        <ul className="picker-list" id={listId} role="listbox">
          {found.map((m, i) => (
            <li key={`${m.code}-${i}`} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); onPick(m.code); close(); }}>
              {materialLabel(m)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
