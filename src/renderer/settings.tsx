// Podešavanja u rendereru: jedan izvor istine za stranicu Podešavanja i za poslove (obaveštenje da se snimak pravila
// u poslu razlikuje od trenutnih). Vrednosti se upisuju odmah, kroz glavni proces koji ih proverava.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SettingKey, SettingValue, SettingsMap } from '../shared/settings';

interface SettingsApi {
  /** null dok se podešavanja ne učitaju. */
  settings: SettingsMap | null;
  error: string | null;
  /** Upisuje podešavanje (proverava ga glavni proces) i vraća sačuvanu vrednost. Folder-ključevi idu kroz `files.chooseFolder` + `reload`. */
  set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<SettingValue<K>>;
  reload(): Promise<void>;
}

const Ctx = createContext<SettingsApi | null>(null);

export function useSettings(): SettingsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('SettingsProvider nedostaje.');
  return v;
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSettings(await window.api.settings.all());
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  useEffect(() => window.api.lifecycle.onCommand((c) => { if (c === 'theme-changed') void reload(); }), [reload]);

  const set = useCallback(async <K extends SettingKey>(key: K, value: SettingValue<K>) => {
    const saved = await window.api.settings.set(key, value);
    setSettings((s) => (s ? { ...s, [key]: saved } : s));
    return saved;
  }, []);

  const value = useMemo(() => ({ settings, error, set, reload }), [settings, error, set, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
