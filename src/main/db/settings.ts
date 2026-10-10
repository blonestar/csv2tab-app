// Podešavanja u bazi: ključevi i tipovi dolaze iz src/shared/settings.ts, vrednost se čuva kao JSON.
import type { DatabaseSync } from 'node:sqlite';
import { SETTINGS, checkSetting, settingDefault, type SettingKey, type SettingValue, type SettingsMap } from '../../shared/settings';

export function getSetting<K extends SettingKey>(db: DatabaseSync, key: K): SettingValue<K> {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (row) {
    try {
      return checkSetting(key, JSON.parse(row.value));
    } catch {
      // oštećena ili zastarela vrednost: važi podrazumevana
    }
  }
  return settingDefault(key);
}

export function setSetting<K extends SettingKey>(db: DatabaseSync, key: K, value: unknown): SettingValue<K> {
  const v = checkSetting(key, value);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(v),
  );
  return v;
}

export function getAllSettings(db: DatabaseSync): SettingsMap {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS) as SettingKey[]) out[key] = getSetting(db, key);
  return out as SettingsMap;
}
