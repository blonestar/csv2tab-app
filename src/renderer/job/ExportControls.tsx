// Izvoz: dva toka. Podrazumevano (podešavanje exportAsk) program pita gde i kako da nazove svaki .tab (sistemski
// dijalog). Inače: provera šta u folderu za izvoz već postoji, pitanje (sa razlikama) samo kad se fajl razlikuje, upis.
import { useEffect, useMemo, useRef, useState } from 'react';
import { compareParts } from '@core/compare';
import { readWtTab, type WtPart } from '@core/wtTab';
import type { ExportWriteResult } from '../../shared/api';
import { DiffSummary, DiffTable } from '../components/DiffTable';
import { useSession } from '../session';
import { exportFiles, type DerivedJob, type ExportFile } from './derive';
import { confirmedByExport } from './memory';
import { withChoice } from './state';

interface Pending {
  files: ExportFile[];
  items: { name: string; status: 'new' | 'identical' | 'differs'; existing: Uint8Array | null }[];
  folder: string;
}

type Banner = { kind: 'ok' | 'error' | 'problem'; text: string } | null;

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

function readParts(bytes: Uint8Array | null): { parts: WtPart[] } | { error: string } {
  if (!bytes) return { error: 'Postojeći fajl se ne može pročitati.' };
  try {
    return { parts: readWtTab(bytes).parts };
  } catch (e) {
    return { error: errText(e) };
  }
}

function DiffItem({ file, existing, name, checked, onCheck }: { file: ExportFile; existing: Uint8Array | null; name: string; checked: boolean; onCheck: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const mine = useMemo(() => readWtTab(file.bytes).parts, [file]);
  const theirs = useMemo(() => readParts(existing), [existing]);
  const rows = useMemo(() => ('parts' in theirs ? compareParts(mine, theirs.parts) : []), [mine, theirs]);
  const openWindow = () => {
    if ('parts' in theirs) void window.api.compare.open({ aName: `Novi: ${name}`, bName: `Postojeći: ${name}`, a: mine, b: theirs.parts });
  };
  return (
    <section className="diff-item" data-testid="diff-item" data-name={name}>
      <label className="choice">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Prepiši ${name}`} /> <b>{name}</b>{' '}
        <span className="muted">novi: {mine.length} zapisa{'parts' in theirs ? `, postojeći: ${theirs.parts.length}` : ''}</span>
      </label>
      {'parts' in theirs ? (
        <>
          <DiffSummary rows={rows} aLabel="novi" bLabel="postojeći" />
          <details onToggle={(e) => setOpen(e.currentTarget.open)}>
            <summary>Razlike po zapisima</summary>
            {open && <DiffTable a={mine} b={theirs.parts} aLabel="Novi zapisi" bLabel="Postojeći fajl" hideSummary />}
          </details>
          <button type="button" className="btn small" onClick={openWindow}>Otvori u posebnom prozoru</button>
        </>
      ) : (
        <p className="warn-line">Postojeći fajl nije ispravan WT .tab ({theirs.error}); biće zamenjen novim ako potvrdite.</p>
      )}
    </section>
  );
}

export function ExportControls({ derived, exportRequest }: { derived: DerivedJob; exportRequest?: number }) {
  const { session, flush, applyExports, setState } = useSession();
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const handled = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (exportRequest === undefined || handled.current === exportRequest) return;
    handled.current = exportRequest;
    if (!busy && !pending && derived.canExport) void run();
  }, [exportRequest]);

  async function finish(files: ExportFile[], overwrite: string[]) {
    const res = await window.api.export.write(files.map((f) => ({ name: f.name, bytes: f.bytes, material: f.material })), overwrite, session?.jobId ?? null);
    if (!res.ok) {
      setBanner({ kind: 'problem', text: res.message });
      return;
    }
    await report(files, res);
  }

  // izvoz sa pitanjem: korisnik je u dijalogu mogao da promeni ime, pa posao pamti novo ime (izlazni fajl i izvoz idu uz to)
  async function finishAsk(files: ExportFile[]) {
    const res = await window.api.export.save(files.map((f) => ({ name: f.name, bytes: f.bytes, material: f.material })), session?.jobId ?? null);
    let renamed = false;
    res.items.forEach((it, i) => {
      if ((it.status === 'written' || it.status === 'identical') && it.name !== files[i].name) {
        renamed = true;
        setState((s) => withChoice(s, files[i].material, { fileName: it.name.replace(/\.tab$/i, '') }));
      }
    });
    await report(files, res);
    // izvoz se preračunava nad novim imenima pri čuvanju, pa se čuva odmah
    if (renamed) await flush();
  }

  async function report(files: ExportFile[], res: Extract<ExportWriteResult, { ok: true }>) {
    if (res.job) applyExports(res.job);
    // upisan (ili već isti) fajl potvrđuje izbore za svoj materijal; pamćenje je pomoćno i ne sme da pokvari izvoz
    if (session && session.jobId !== null) {
      const done = new Set<string>();
      res.items.forEach((it, i) => {
        if (it.status === 'written' || it.status === 'identical') done.add(files[i].material);
      });
      const update = confirmedByExport(derived, done);
      if (update) {
        try {
          await window.api.memory.remember(update);
        } catch (e) {
          setBanner({ kind: 'error', text: `Fajlovi su izvezeni, ali izbori nisu zapamćeni: ${errText(e)}` });
          return;
        }
      }
    }
    const bad = res.items.filter((it) => it.status === 'error' || it.status === 'skipped');
    const written = res.items.filter((it) => it.status === 'written').length;
    const same = res.items.filter((it) => it.status === 'identical').length;
    // odustajanje u dijalogu nije greška: ako ništa nije upisano i nema problema, poruke nema
    if (!written && !same && !bad.length && !res.recordError) {
      setBanner(null);
      return;
    }
    const text =
      `Upisano: ${written} ${written === 1 ? 'fajl' : 'fajlova'} u ${res.folder}` +
      (same ? `; ${same} već postoji isti` : '') +
      (bad.length ? `. Nije upisano: ${bad.map((b) => `${b.name} (${b.message ?? b.status})`).join('; ')}` : '.') +
      (res.recordError ? ` Izvoz nije zabeležen u poslu: ${res.recordError}` : '');
    setBanner({ kind: bad.length || res.recordError ? 'error' : 'ok', text });
  }

  async function run() {
    setBusy(true);
    setBanner(null);
    try {
      // izvoz se beleži uz sačuvano stanje posla, pa se prvo upisuje sve nesačuvano
      if (!(await flush())) {
        setBanner({ kind: 'error', text: 'Posao nije sačuvan u bazi, pa izvoz nije pokrenut. Pokušajte ponovo.' });
        return;
      }
      const files = exportFiles(derived);
      if (await window.api.settings.get('exportAsk')) {
        await finishAsk(files);
        return;
      }
      const check = await window.api.export.check(files.map((f) => ({ name: f.name, bytes: f.bytes })));
      if (!check.ok) {
        setBanner({ kind: 'problem', text: check.message });
      } else if (check.items.some((i) => i.status === 'differs')) {
        setSelected(new Set(check.items.filter((i) => i.status === 'differs').map((i) => i.name)));
        setPending({ files, items: check.items, folder: check.folder });
      } else {
        await finish(files, []);
      }
    } catch (e) {
      setBanner({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    const p = pending;
    setPending(null);
    setBusy(true);
    try {
      await finish(p.files, [...selected]);
    } catch (e) {
      setBanner({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder() {
    try {
      if (await window.api.files.chooseFolder('wtFolder')) await run();
    } catch (e) {
      setBanner({ kind: 'error', text: errText(e) });
    }
  }

  const differing = pending?.items.filter((i) => i.status === 'differs') ?? [];
  return (
    <>
      <button type="button" className="btn primary" data-testid="export" disabled={busy || !derived.canExport} onClick={() => void run()} title={derived.canExport ? 'Sačuvaj jedan .tab po materijalu' : 'Nema zapisa za izvoz'}>
        Izvezi
      </button>
      {banner && (
        <div className={`banner ${banner.kind}`} role={banner.kind === 'ok' ? 'status' : 'alert'} data-testid="export-banner" data-kind={banner.kind}>
          <span>{banner.text}</span>
          {banner.kind === 'problem' && (
            <button type="button" className="btn small" data-testid="choose-wt-folder" onClick={() => void chooseFolder()}>Izaberi folder za izvoz…</button>
          )}
          <button type="button" className="icon" aria-label="Zatvori poruku" onClick={() => setBanner(null)}>×</button>
        </div>
      )}
      {pending && (
        <div className="overlay">
          <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Prepisivanje postojećih fajlova" data-testid="overwrite-dialog">
            <h2>U folderu za izvoz već postoje različiti fajlovi</h2>
            <p className="muted">{pending.folder}</p>
            <div className="dialog-body">
              {differing.map((it) => {
                const i = pending.items.indexOf(it);
                return (
                  <DiffItem
                    key={it.name}
                    file={pending.files[i]}
                    existing={it.existing}
                    name={it.name}
                    checked={selected.has(it.name)}
                    onCheck={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(it.name); else n.delete(it.name); return n; })}
                  />
                );
              })}
              {pending.items.length > differing.length && (
                <p className="muted">
                  Ostali fajlovi ({pending.items.length - differing.length}) su novi ili već postoje isti, pa se upisuju bez pitanja.
                </p>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn primary" data-testid="overwrite-confirm" onClick={() => void confirm()}>
                {selected.size === differing.length ? 'Prepiši sve' : `Prepiši izabrane (${selected.size})`}
              </button>
              <button type="button" className="btn" data-testid="overwrite-cancel" onClick={() => setPending(null)}>Odustani</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
