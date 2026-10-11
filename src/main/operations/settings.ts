import { getAllSettings, getSetting, setSetting } from '../db/settings';
import { folderName } from '../fileNames';
import { SETTINGS, checkSetting, isFolderSetting, isSettingKey, type SettingKey } from '../../shared/settings';
import { noArgs, type IpcContext, type Operation } from './types';

function keyArg(v: unknown): SettingKey {
  if (!isSettingKey(v)) throw new Error('Nepoznat ključ podešavanja.');
  return v;
}

export function settingsOperations(ctx: IpcContext) {
  return {
    'settings.get': {
      validate(args) {
        if (args.length !== 1) throw new Error('Očekivan je jedan argument: ključ.');
        return [keyArg(args[0])];
      },
      run(key) {
        const value = getSetting(ctx.db.sqlite, key);
        return isFolderSetting(key) ? folderName(value as string) : value;
      },
    } satisfies Operation<'settings.get'>,
    'settings.all': {
      validate: noArgs,
      run() {
        const settings = getAllSettings(ctx.db.sqlite);
        for (const key of Object.keys(SETTINGS) as SettingKey[]) {
          if (isFolderSetting(key)) settings[key] = folderName(settings[key]);
        }
        return settings;
      },
    } satisfies Operation<'settings.all'>,
    'settings.set': {
      validate(args) {
        if (args.length !== 2) throw new Error('Očekivana su dva argumenta: ključ i vrednost.');
        const key = keyArg(args[0]);
        // Folder bira korisnik kroz dijalog u glavnom procesu (files.chooseFolder); renderer ne zadaje putanju.
        if (isFolderSetting(key)) throw new Error(`Podešavanje "${key}" se zadaje samo izborom foldera u dijalogu.`);
        return [key, checkSetting(key, args[1])];
      },
      run(key, value) {
        const saved = setSetting(ctx.db.sqlite, key, value);
        ctx.applySetting(key, saved);
        return saved;
      },
    } satisfies Operation<'settings.set'>,
  };
}
