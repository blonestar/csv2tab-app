// Podešavanja: zatvoren skup ključeva sa tipom vrednosti i proverom. Renderer ne šalje proizvoljne ključeve.
// Novo podešavanje se dodaje samo ovde (u SETTINGS); tipovi, provera u glavnom procesu i most ga prate sami.

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

interface SettingDef<T> {
  /** true: vrednost zadaje samo glavni proces (dijalog za izbor foldera); `settings.set` iz renderera je odbija. */
  folder?: true;
  /** Vrednost dok ništa nije upisano (i kad je upisana vrednost neispravna). */
  default: T;
  is(value: unknown): value is T;
}

function def<T>(d: SettingDef<T>): SettingDef<T> {
  return d;
}

/** Folder: putanju bira korisnik kroz sistemski dijalog u glavnom procesu; renderer je može samo da pročita. Novi
 *  folder (npr. za rezervne kopije) se dodaje kao `folderSetting()` ovde, bez izmene u operacijama. */
function folderSetting(): SettingDef<string> & { folder: true } {
  return { default: '', is: (v): v is string => typeof v === 'string' && v.length <= 1024, folder: true };
}

export const SETTINGS = {
  theme: def<Theme>({ default: 'system', is: (v): v is Theme => THEMES.includes(v as Theme) }),
  /** Folder u koji WT Input čita .tab fajlove. Prazno = nije zadat. */
  wtFolder: folderSetting(),
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K] extends SettingDef<infer T> ? T : never;
export type SettingsMap = { [K in SettingKey]: SettingValue<K> };

export type FolderSettingKey = { [K in SettingKey]: (typeof SETTINGS)[K] extends { folder: true } ? K : never }[SettingKey];

export function isFolderSetting(key: SettingKey): key is FolderSettingKey {
  return (SETTINGS[key] as SettingDef<unknown>).folder === true;
}

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && Object.hasOwn(SETTINGS, key);
}

/** Vrednost ili greška; koristi se pri upisu. */
export function checkSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  const d = SETTINGS[key] as SettingDef<SettingValue<K>>;
  if (!d.is(value)) throw new Error(`Neispravna vrednost podešavanja "${key}".`);
  return value;
}

export function settingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS[key].default as SettingValue<K>;
}
