// Kartice posla: Materijali, Izvor, Izvozi. (Zapisi su u components/PartsTable.tsx.)
import { FIELDS, FIELD_LABELS, REQUIRED_FIELDS } from '@core/parts';
import type { WtCatalog } from '@core/catalog';
import type { InputEncoding } from '@core/encoding';
import type { JobState } from '../../shared/job';
import { MaterialPicker } from '../components/MaterialPicker';
import type { JobExports } from '../../shared/jobs';
import { formatDateTime } from '../format';
import { useSettings } from '../settings';
import { sameEdgeRules } from '../../shared/edgeRules';
import type { DerivedJob, SourceFile } from './derive';
import { choiceOf, rulesDiffer, withAutoMapping, withChoice, withCurrentRules, withDelimiter, withEncoding, withMappingField, withMerge, withSheet } from './state';
import { columnResize } from '../columnResize';

type SetState = (update: (s: JobState) => JobState) => void;
interface TabProps {
  file: SourceFile;
  state: JobState;
  derived: DerivedJob;
  setState: SetState;
}

// ---------- Materijali ----------
export function MaterialsTab({ catalog, state, derived, setState }: TabProps & { catalog: WtCatalog }) {
  if (!derived.materials.length) return <p className="muted">Nema materijala: posao nema zapisa.</p>;
  const isTab = derived.source.tab !== undefined;
  return (
    <>
    <p className="muted small" data-testid="materials-legend">
      Oznake uz izbor: <b>iz pamćenja</b> = preuzeto iz prethodnih uvoza, <b>predlog</b> = automatski iz kataloga, <b>ručno</b> = izabrano u ovom poslu.
    </p>
    <table className="grid materials-table" ref={columnResize('job-materials')} data-testid="materials-table">
      <colgroup>
        <col className="c-src" />
        <col className="c-n" />
        <col className="c-wt" />
        <col className="c-band" />
        <col className="c-grain" />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>Materijal iz fajla</th>
          <th>Zapisa</th>
          <th>WT materijal</th>
          <th>Traka u imenu</th>
          <th>Prati teksturu</th>
          <th>Ime izlaznog fajla</th>
        </tr>
      </thead>
      <tbody>
        {derived.materials.map((m) => {
          const c = choiceOf(state, m.source);
          const name = m.source || '(bez materijala)';
          return (
            <tr key={m.source} data-material={m.source}>
              <td>{name}</td>
              <td>{m.count}</td>
              <td>
                {isTab ? (
                  <span className="muted">—</span>
                ) : (
                  <MaterialPicker
                    catalog={catalog}
                    value={m.wt}
                    auto={c.wt === undefined}
                    memory={c.fromMemory?.includes('wt')}
                    label={`WT materijal za ${name}`}
                    onPick={(code) => setState((s) => withChoice(s, m.source, { wt: code, grain: undefined }))}
                  />
                )}
              </td>
              <td>
                <select aria-label={`Traka za ${name}`} value={m.band} onChange={(e) => setState((s) => withChoice(s, m.source, { band: e.target.value || undefined }))}>
                  <option value="">— bez trake —</option>
                  {catalog.edgeBands.map((b) => (
                    <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
                  ))}
                </select>
                {c.fromMemory?.includes('band') ? <span className="muted tag" data-origin="memory" title="Preuzeto iz pamćenja izbora pri uvozu">iz pamćenja</span> : c.band ? <span className="muted tag" data-origin="manual" title="Izabrano ručno u ovom poslu">ručno</span> : null}
              </td>
              <td>
                {!isTab ? (
                  <label className="choice">
                    <input
                      type="checkbox"
                      aria-label={`Prati teksturu: ${name}`}
                      checked={m.grain === 1}
                      onChange={(e) => setState((s) => withChoice(s, m.source, { grain: e.target.checked ? 1 : 0 }))}
                    />{' '}
                    <span className="muted" data-origin={c.fromMemory?.includes('grain') ? 'memory' : m.grainFrom}>
                      {c.fromMemory?.includes('grain') ? 'iz pamćenja' : m.grainFrom === 'manual' ? 'ručno' : m.grainFrom === 'catalog' ? 'iz kataloga' : 'podrazumevano'}
                    </span>
                    {c.grain !== undefined && (
                      <button type="button" className="icon" title="Vrati na podrazumevano" aria-label="Vrati teksturu" onClick={() => setState((s) => withChoice(s, m.source, { grain: undefined }))}>↺</button>
                    )}
                  </label>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <div className="fname">
                  <input
                    type="text"
                    aria-label={`Ime fajla za ${name}`}
                    data-testid="file-name"
                    placeholder={m.suggested}
                    value={c.fileName ?? ''}
                    onChange={(e) => setState((s) => withChoice(s, m.source, { fileName: e.target.value || undefined }))}
                  />
                  <span className="muted">.tab</span>
                </div>
                <div className="muted small" data-testid="out-name">{m.fileName}</div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </>
  );
}

// ---------- Izvor ----------
const ENCODINGS: InputEncoding[] = ['utf-8', 'windows-1250', 'latin-1'];
const DELIMS: [string, string][] = [[',', 'zarez ,'], [';', 'tačka-zarez ;'], ['\t', 'tabulator'], ['|', 'uspravna crta |']];
const PREVIEW_ROWS = 200;
const PREVIEW_COLS = 30;

function colLetters(c: number): string {
  let s = '';
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Snimak pravila u poslu naspram trenutnih podešavanja: obaveštenje i jedna radnja za primenu na ovaj posao. */
function RulesNotice({ state, setState }: { state: JobState; setState: SetState }) {
  const { settings } = useSettings();
  if (!settings) return null;
  const differs = rulesDiffer(state, settings);
  return (
    <section className="rules-box" data-testid="rules-box" data-differs={differs}>
      <h2>Pravila kantovanja i teksture u ovom poslu</h2>
      <p className="muted small">
        Posao čuva svoju kopiju tabele šifara kantovanja i pravila za jednobojne dekore iz trenutka uvoza, pa kasnija
        promena podešavanja ne menja njegove zapise.
      </p>
      <ul className="small">
        <li data-testid="rules-edge">Tabela šifara kantovanja: {state.edgeRules.length} {state.edgeRules.length === 1 ? 'red' : 'redova'}{sameEdgeRules(state.edgeRules, settings.edgeRules) ? ' (isto kao u podešavanjima)' : ' (razlikuje se od podešavanja)'}</li>
        <li data-testid="rules-decor">Jednobojni dekori ne prate teksturu po zadatku: {state.decorRule ? 'da' : 'ne'}{state.decorRule === settings.decorRule ? ' (isto kao u podešavanjima)' : ' (razlikuje se od podešavanja)'}</li>
      </ul>
      {differs ? (
        <p className="banner warn" role="status" data-testid="rules-differ">
          <span>Pravila u ovom poslu se razlikuju od trenutnih podešavanja.</span>
          <button type="button" className="btn small" data-testid="rules-apply" onClick={() => setState((s) => withCurrentRules(s, settings))}>
            Primeni trenutna podešavanja na ovaj posao
          </button>
        </p>
      ) : (
        <p className="muted small" data-testid="rules-same">Pravila u poslu odgovaraju trenutnim podešavanjima.</p>
      )}
    </section>
  );
}

export function SourceTab({ file, state, derived, setState }: TabProps) {
  const src = derived.source;
  if (src.tab) {
    return (
      <div className="source">
        <p className="muted">
          Fajl je otvoren kao WT Input .tab. Nema izvornih redova ni mapiranja kolona: u .tab-u su već gotovi zapisi.
        </p>
        {src.tab.warnings.map((w) => <p key={w} className="warn-line">{w}</p>)}
      </div>
    );
  }
  const header = src.rows[0] ?? [];
  const rows = src.rows.slice(0, PREVIEW_ROWS);
  const cols = Math.min(PREVIEW_COLS, Math.max(0, ...rows.map((r) => r.length)));
  const m = derived.mapping;
  return (
    <div className="source">
      <RulesNotice state={state} setState={setState} />
      <div className="toolbar">
        {file.kind === 'csv' && src.encoding && src.delimiter && (
          <>
            <label>
              Kodiranje{' '}
              <select aria-label="Kodiranje" value={state.encoding} onChange={(e) => setState((s) => withEncoding(s, e.target.value as JobState['encoding']))}>
                <option value="auto">automatski ({src.encoding.detected})</option>
                {ENCODINGS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
            <label>
              Separator{' '}
              <select aria-label="Separator" value={state.delimiter} onChange={(e) => setState((s) => withDelimiter(s, e.target.value))}>
                <option value="auto">automatski ({DELIMS.find((d) => d[0] === src.delimiter!.detected)?.[1] ?? src.delimiter.detected})</option>
                {DELIMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </>
        )}
        {src.sheets.length > 0 && (
          <label>
            List{' '}
            <select aria-label="List" value={src.sheet} onChange={(e) => setState((s) => withSheet(s, Number(e.target.value)))}>
              {src.sheets.map((sh, i) => <option key={i} value={i}>{sh.name || `List ${i + 1}`} ({sh.rows} redova)</option>)}
            </select>
          </label>
        )}
        <label className="choice">
          <input type="checkbox" checked={state.merge} onChange={(e) => setState((s) => withMerge(s, e.target.checked))} /> Spoji iste delove
        </label>
      </div>
      <p className="muted small">Promena kodiranja, separatora, lista, mapiranja ili spajanja računa zapise ispočetka i odbacuje ručne izmene.</p>

      {derived.conv?.headerless && <p className="muted">Nema zaglavlja: uzet je podrazumevani raspored kolona.</p>}
      {m && !derived.conv?.headerless && (
        <fieldset className="group mapping" data-testid="mapping">
          <legend>Mapiranje kolona{state.mappingFromMemory && <span className="muted tag" data-testid="mapping-memory" title="Preuzeto iz pamćenja pri uvozu"> iz pamćenja </span>}{state.mapping !== 'auto' && <> <button type="button" className="btn small" onClick={() => setState(withAutoMapping)}>Vrati automatsko</button></>}</legend>
          <div className="mapping-grid">
            {FIELDS.map((f) => {
              const required = REQUIRED_FIELDS.includes(f);
              const missing = required && m[f] < 0;
              return (
                <label key={f} className={missing ? 'missing' : undefined}>
                  <span>{FIELD_LABELS[f]}{required && ' *'}</span>
                  <select
                    aria-label={FIELD_LABELS[f]}
                    aria-invalid={missing}
                    value={m[f]}
                    onChange={(e) => setState((s) => withMappingField(s, m, f, Number(e.target.value)))}
                  >
                    <option value={-1}>— nema —</option>
                    {header.map((h, i) => <option key={i} value={i}>{colLetters(i)}: {h.replace(/^﻿/, '').slice(0, 30)}</option>)}
                  </select>
                  {missing && <span className="err small">obavezno</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <h2>Sirovi redovi <span className="muted">({src.rows.length})</span></h2>
      <div className="table-scroll raw-scroll">
        <table key={cols} className="grid raw-table" ref={columnResize('raw')}>
          <thead>
            <tr><th>#</th>{Array.from({ length: cols }, (_, c) => <th key={c}>{colLetters(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="rn">{i + 1}</td>
                {Array.from({ length: cols }, (_, c) => <td key={c} title={r[c]}>{r[c] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(src.rows.length > PREVIEW_ROWS) && <p className="muted">Prikazano prvih {PREVIEW_ROWS} redova od {src.rows.length}.</p>}
    </div>
  );
}

// ---------- Izvozi ----------
const OUTPUT_LABEL = { never: 'nije izvezen', current: 'izvezen, nepromenjen', changed: 'menjan posle izvoza' } as const;

export function ExportsTab({ exports }: { exports: JobExports }) {
  return (
    <div className="exports">
      <h2>Fajlovi posla</h2>
      {exports.outputs.length === 0 ? (
        <p className="muted">Posao trenutno nema nijedan izlazni fajl.</p>
      ) : (
        <table className="grid" ref={columnResize('outputs')} data-testid="outputs-table">
          <thead>
            <tr><th>Fajl</th><th>Materijal</th><th>Zapisa</th><th>Stanje</th></tr>
          </thead>
          <tbody>
            {exports.outputs.map((o) => (
              <tr key={o.name} data-name={o.name} data-state={o.state}>
                <td>{o.name}</td>
                <td>{o.material || '(bez materijala)'}</td>
                <td>{o.count}</td>
                <td><span className={`status ${o.state}`}>{OUTPUT_LABEL[o.state]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Istorija izvoza</h2>
      {exports.exports.length === 0 ? (
        <p className="muted">Ovaj posao još nije izvožen.</p>
      ) : (
        <table className="grid exports-history" ref={columnResize('exports')} data-testid="exports-table">
          <thead>
            <tr><th>Vreme</th><th>Fajl</th><th>Zapisa</th><th>Ishod</th><th>Folder</th></tr>
          </thead>
          <tbody>
            {exports.exports.map((e) => (
              <tr key={e.id} data-name={e.fileName}>
                <td>{formatDateTime(e.exportedAt)}</td>
                <td title={e.fileName}>{e.fileName}</td>
                <td>{e.recordCount}</td>
                <td>{e.result === 'written' ? 'upisano' : 'isti fajl već postoji'}</td>
                <td title={e.folder}>{e.folder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
