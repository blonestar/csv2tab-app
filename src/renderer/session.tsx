// Jedan otvoren posao u memoriji (trajno čuvanje stiže u fazi 4). Sve što korisnik odlučuje je u `state`
// (JobState); ovde su još samo izvorni fajl, spisak izvoza iz ove sesije i aktivna kartica.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { WtCatalog } from '@core/catalog';
import type { JobState } from '../shared/job';
import { newJobState } from './job/defaults';
import type { SourceFile } from './job/derive';

export type TabId = 'parts' | 'materials' | 'source' | 'exports';

export interface ExportLogEntry {
  name: string;
  time: number;
  count: number;
  folder: string;
  /** 'identical': u folderu je već bio isti fajl, ništa nije upisano. */
  result: 'written' | 'identical';
}

export interface JobSession {
  id: number;
  file: SourceFile;
  state: JobState;
  /** JSON stanja pri uvozu; razlika od trenutnog znači da ima neodbačenih izmena. */
  initial: string;
  log: ExportLogEntry[];
  tab: TabId;
}

interface SessionApi {
  catalog: WtCatalog | null;
  catalogError: string | null;
  session: JobSession | null;
  open(file: SourceFile): void;
  close(): void;
  setState(update: (s: JobState) => JobState): void;
  setTab(tab: TabId): void;
  addLog(entries: ExportLogEntry[]): void;
  isDirty: boolean;
}

const Ctx = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider nedostaje.');
  return v;
}

let nextId = 1;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<WtCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [session, setSession] = useState<JobSession | null>(null);

  useEffect(() => {
    window.api.catalog.get().then(setCatalog, (e: unknown) => setCatalogError(e instanceof Error ? e.message : String(e)));
  }, []);

  const open = useCallback((file: SourceFile) => {
    const state = newJobState();
    setSession({ id: nextId++, file, state, initial: JSON.stringify(state), log: [], tab: 'parts' });
  }, []);
  const close = useCallback(() => setSession(null), []);
  const setState = useCallback((update: (s: JobState) => JobState) => setSession((s) => (s ? { ...s, state: update(s.state) } : s)), []);
  const setTab = useCallback((tab: TabId) => setSession((s) => (s ? { ...s, tab } : s)), []);
  const addLog = useCallback((entries: ExportLogEntry[]) => setSession((s) => (s ? { ...s, log: [...entries, ...s.log] } : s)), []);

  const isDirty = !!session && JSON.stringify(session.state) !== session.initial;
  const value = useMemo(
    () => ({ catalog, catalogError, session, open, close, setState, setTab, addLog, isDirty }),
    [catalog, catalogError, session, open, close, setState, setTab, addLog, isDirty],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
