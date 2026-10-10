// Jedan otvoren posao i njegovo automatsko čuvanje. Sve što korisnik odlučuje je u `state` (JobState); ovde su još
// izvorni fajl, izvozi iz baze i aktivna kartica. Svaka izmena stanja se čuva sama, odloženo (SAVE_DELAY_MS), a
// odmah se čuva pre zatvaranja posla, otvaranja drugog, izvoza i zatvaranja prozora (zahtev glavnog procesa).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WtCatalog } from '@core/catalog';
import type { JobState, OpenedFile } from '../shared/job';
import type { JobDetail, JobExports, JobListItem } from '../shared/jobs';
import { defaultsFromSettings, newJobState } from './job/defaults';
import { deriveJob, type DeriveCache, type DerivedJob, type SourceFile } from './job/derive';
import { rememberDiff, stateForNewJob } from './job/memory';
import { buildSave, sha256Hex } from './job/save';

export type TabId = 'parts' | 'materials' | 'source' | 'exports';

/** saved: sve upisano; dirty: ima izmena koje još čekaju; saving: upis traje; failed: upis nije uspeo (ponavlja se). */
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'failed';

/** Ishod pokušaja da se napusti otvoreni posao: false = izmene se nisu mogle sačuvati. */
export type LeaveResult = 'ok' | 'blocked';

export interface JobSession {
  /** Redni broj otvaranja (ključ za React); isti posao otvoren dvaput ima različit. */
  id: number;
  jobId: number;
  name: string;
  note: string;
  createdAt: number;
  file: SourceFile;
  state: JobState;
  /** Poruka kad sačuvano stanje ne prolazi proveru; posao se tada samo prikazuje (bez izmena i izvoza). */
  stateError: string | null;
  tab: TabId;
  exports: JobExports;
}

export type ImportOutcome = { kind: 'opened' } | { kind: 'blocked' } | { kind: 'exists'; existing: JobListItem[] };

interface SessionApi {
  catalog: WtCatalog | null;
  catalogError: string | null;
  session: JobSession | null;
  /** Izvedeni podaci otvorenog posla (null dok se katalog ne učita ili kad je stanje neispravno). */
  derived: DerivedJob | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  /** Otvara sačuvan posao; prethodni se pre toga čuva. `force`: izmene koje se ne mogu sačuvati se odbacuju. */
  openJob(id: number, force?: boolean): Promise<LeaveResult>;
  /** Uvozi fajl kao nov posao; ako isti fajl već postoji kao posao, vraća ga umesto da pravi dupli. */
  importFile(file: OpenedFile, force?: boolean): Promise<ImportOutcome>;
  /** Nov posao od fajla, bez provere duplikata (korisnik je izabrao „napravi novi"). */
  createFromFile(file: OpenedFile, force?: boolean): Promise<LeaveResult>;
  closeJob(force?: boolean): Promise<LeaveResult>;
  deleteJob(id: number): Promise<void>;
  updateMeta(meta: { name?: string; note?: string }): Promise<void>;
  setState(update: (s: JobState) => JobState): void;
  setTab(tab: TabId): void;
  /** Čuva odmah sve nesačuvano; true ako je sve u bazi. */
  flush(): Promise<boolean>;
  applyExports(j: JobExports): void;
}

const Ctx = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider nedostaje.');
  return v;
}

export const SAVE_DELAY_MS = 700;
const RETRY_DELAY_MS = 4000;
let nextId = 1;

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export function SessionProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<WtCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [session, setSession] = useState<JobSession | null>(null);
  const [phase, setPhase] = useState<{ kind: 'idle' | 'saving' | 'failed'; error?: string }>({ kind: 'idle' });

  // Poslednja vrednost za imperativne pozive (zahtev za čuvanje, zatvaranje); React stanje kasni za jedan render.
  const sessionRef = useRef<JobSession | null>(null);
  const catalogRef = useRef<WtCatalog | null>(null);
  /** Stanje (po identitetu) koje je poslednje upisano u bazu. */
  const savedRef = useRef<JobState | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const cache = useRef<DeriveCache>({});
  const last = useRef<{ file: SourceFile; state: JobState; catalog: WtCatalog; value: DerivedJob } | null>(null);

  const mutate = useCallback((fn: (s: JobSession | null) => JobSession | null) => {
    const next = fn(sessionRef.current);
    sessionRef.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    window.api.catalog.get().then(
      (c) => {
        catalogRef.current = c;
        setCatalog(c);
      },
      (e: unknown) => setCatalogError(errText(e)),
    );
  }, []);

  const derive = useCallback((file: SourceFile, state: JobState, cat: WtCatalog): DerivedJob => {
    const l = last.current;
    if (l && l.file === file && l.state === state && l.catalog === cat) return l.value;
    const value = deriveJob(file, state, cat, cache.current);
    last.current = { file, state, catalog: cat, value };
    return value;
  }, []);

  const derived = useMemo(
    () => (session && catalog && !session.stateError ? derive(session.file, session.state, catalog) : null),
    [session?.file, session?.state, session?.stateError, catalog, derive], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---------- čuvanje ----------
  const doSave = useCallback(async (): Promise<boolean> => {
    const s = sessionRef.current;
    const cat = catalogRef.current;
    if (!s || s.stateError || !cat || savedRef.current === s.state) return true;
    const { state, jobId, id } = s;
    setPhase({ kind: 'saving' });
    try {
      const derivedNow = derive(s.file, state, cat);
      // ručne promene izbora od poslednjeg uspešnog čuvanja idu u pamćenje u istoj transakciji
      const remember = rememberDiff(savedRef.current ?? state, state, derivedNow);
      const res = await window.api.jobs.save(jobId, { ...buildSave(state, derivedNow), ...(remember ? { remember } : {}) });
      if (sessionRef.current?.id === id) {
        savedRef.current = state;
        mutate((cur) => (cur && cur.id === id ? { ...cur, exports: res } : cur));
        setPhase({ kind: 'idle' });
      }
      return true;
    } catch (e) {
      if (sessionRef.current?.id === id) setPhase({ kind: 'failed', error: errText(e) });
      return false;
    }
  }, [derive, mutate]);

  /** Upisi idu jedan za drugim; svaki proverava da li je još nešto nesačuvano. */
  const enqueue = useCallback((): Promise<boolean> => {
    const p = chain.current.then(() => doSave());
    chain.current = p.catch(() => false);
    return p;
  }, [doSave]);

  const flush = useCallback(() => enqueue(), [enqueue]);

  // odloženo čuvanje: tajmer važi dok se stanje ne promeni ponovo
  useEffect(() => {
    if (!session || session.stateError || savedRef.current === session.state) return;
    const t = setTimeout(() => void enqueue(), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [session?.state, session?.id, session?.stateError, enqueue]); // eslint-disable-line react-hooks/exhaustive-deps

  // neuspelo čuvanje se ponavlja, a greška ostaje vidljiva dok ne uspe
  useEffect(() => {
    if (phase.kind !== 'failed') return;
    const t = setTimeout(() => void enqueue(), RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase, enqueue]);

  // glavni proces traži čuvanje pre zatvaranja prozora; ponovno učitavanje stranice pokušava isto
  useEffect(() => {
    const off = window.api.lifecycle.onFlushRequest(() => flush());
    const onUnload = () => void doSave();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      off();
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [flush, doSave]);

  // ---------- otvaranje i zatvaranje ----------
  /** Čuva otvoreni posao pre odlaska; sa `force` odbacuje ono što se ne može sačuvati. */
  const leave = useCallback(
    async (force: boolean): Promise<boolean> => {
      if (!sessionRef.current) return true;
      if (await flush()) return true;
      if (!force) return false;
      savedRef.current = sessionRef.current.state;
      return true;
    },
    [flush],
  );

  const begin = useCallback(
    (d: Pick<JobSession, 'jobId' | 'name' | 'note' | 'createdAt' | 'file' | 'stateError' | 'exports'> & { state: JobState | null }) => {
      const state = d.state ?? newJobState();
      savedRef.current = state;
      setPhase({ kind: 'idle' });
      mutate(() => ({ ...d, state, id: nextId++, tab: 'parts' }));
    },
    [mutate],
  );

  const fromDetail = (d: JobDetail) => ({
    jobId: d.id,
    name: d.name,
    note: d.note,
    createdAt: d.createdAt,
    file: d.file,
    state: d.state,
    stateError: d.stateError,
    exports: { exports: d.exports, status: d.status, outputs: d.outputs },
  });

  const openJob = useCallback(
    async (id: number, force = false): Promise<LeaveResult> => {
      if (!(await leave(force))) return 'blocked';
      begin(fromDetail(await window.api.jobs.get(id)));
      return 'ok';
    },
    [leave, begin],
  );

  const createFromFile = useCallback(
    async (file: OpenedFile, force = false): Promise<LeaveResult> => {
      if (!(await leave(force))) return 'blocked';
      const cat = catalogRef.current;
      if (!cat) throw new Error('Katalog nije učitan.');
      // Podešavanja i zapamćeni izbori se kopiraju u stanje pre prvog čuvanja (posao ostaje ponovljiv); ako pamćenje
      // ne odgovori, uvoz ide dalje sa predlozima.
      const settings = await window.api.settings.all();
      const { state, derived: derivedNew } = await stateForNewJob(file, defaultsFromSettings(settings), cat, (q) =>
        window.api.memory.lookup(q).catch(() => ({ materials: {}, mapping: null })),
      );
      const created = await window.api.jobs.create(file, buildSave(state, derivedNew));
      begin({
        jobId: created.id,
        name: created.name,
        note: '',
        createdAt: created.createdAt,
        file: { name: file.name, kind: file.kind, bytes: file.bytes },
        state,
        stateError: null,
        exports: await window.api.jobs.exports(created.id),
      });
      return 'ok';
    },
    [leave, begin],
  );

  const importFile = useCallback(
    async (file: OpenedFile, force = false): Promise<ImportOutcome> => {
      if (!(await leave(force))) return { kind: 'blocked' };
      const existing = await window.api.jobs.findBySource(await sha256Hex(file.bytes));
      if (existing.length) return { kind: 'exists', existing };
      return (await createFromFile(file, true)) === 'ok' ? { kind: 'opened' } : { kind: 'blocked' };
    },
    [leave, createFromFile],
  );

  const closeJob = useCallback(
    async (force = false): Promise<LeaveResult> => {
      if (!(await leave(force))) return 'blocked';
      setPhase({ kind: 'idle' });
      mutate(() => null);
      return 'ok';
    },
    [leave, mutate],
  );

  const deleteJob = useCallback(
    async (id: number) => {
      const cur = sessionRef.current;
      const isCurrent = cur?.jobId === id;
      if (isCurrent) {
        await chain.current; // upis u toku ne sme da stigne posle brisanja
        savedRef.current = cur.state;
      }
      await window.api.jobs.delete(id);
      if (isCurrent) {
        setPhase({ kind: 'idle' });
        mutate(() => null);
      }
    },
    [mutate],
  );

  const updateMeta = useCallback(
    async (meta: { name?: string; note?: string }) => {
      const cur = sessionRef.current;
      if (!cur) return;
      const item = await window.api.jobs.update(cur.jobId, meta);
      mutate((s) => (s && s.jobId === item.id ? { ...s, name: item.name, note: item.note } : s));
    },
    [mutate],
  );

  const setState = useCallback(
    (update: (s: JobState) => JobState) => mutate((s) => (s && !s.stateError ? { ...s, state: update(s.state) } : s)),
    [mutate],
  );
  const setTab = useCallback((tab: TabId) => mutate((s) => (s ? { ...s, tab } : s)), [mutate]);
  const applyExports = useCallback((j: JobExports) => mutate((s) => (s ? { ...s, exports: j } : s)), [mutate]);

  const dirty = !!session && !session.stateError && savedRef.current !== session.state;
  const saveStatus: SaveStatus = phase.kind === 'failed' ? 'failed' : phase.kind === 'saving' ? 'saving' : dirty ? 'dirty' : 'saved';

  const value = useMemo(
    () => ({
      catalog,
      catalogError,
      session,
      derived,
      saveStatus,
      saveError: phase.error ?? null,
      openJob,
      importFile,
      createFromFile,
      closeJob,
      deleteJob,
      updateMeta,
      setState,
      setTab,
      flush,
      applyExports,
    }),
    [catalog, catalogError, session, derived, saveStatus, phase.error, openJob, importFile, createFromFile, closeJob, deleteJob, updateMeta, setState, setTab, flush, applyExports],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
