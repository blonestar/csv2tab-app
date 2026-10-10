import { stat } from 'node:fs/promises';
import { getSetting, setSetting } from '../db/settings';
import { openFile, pickFolder } from '../files';
import { isFolderSetting, isSettingKey, type FolderSettingKey } from '../../shared/settings';
import type { OpenPurpose } from '../../shared/api';
import { noArgs, type IpcContext, type Operation } from './types';

export function filesOperations(ctx: IpcContext) {
  return {
    'files.next': {
      validate: noArgs,
      run: () => ctx.windows.nextFile(),
    } satisfies Operation<'files.next'>,
    'files.open': {
      validate(args) {
        if (args.length !== 1 || (args[0] !== 'import' && args[0] !== 'compare')) throw new Error('Očekivana je svrha: import ili compare.');
        return [args[0] as OpenPurpose];
      },
      run: (purpose) => openFile(purpose, ctx.testMode),
    } satisfies Operation<'files.open'>,
    'files.chooseFolder': {
      validate(args) {
        const key = args[0];
        if (args.length !== 1 || !isSettingKey(key) || !isFolderSetting(key)) throw new Error('To podešavanje nije folder.');
        return [key as FolderSettingKey];
      },
      async run(key) {
        const db = ctx.db.sqlite;
        const folder = await pickFolder(ctx.testMode);
        if (!folder) return null;
        if (!(await stat(folder)).isDirectory()) throw new Error('Izabrana putanja nije folder.');
        if (db !== ctx.db.sqlite || ctx.lock.restoring) throw new Error('Baza je promenjena; izaberite folder ponovo.');
        return setSetting(db, key, folder);
      },
    } satisfies Operation<'files.chooseFolder'>,
  };
}

export const wtFolder = (ctx: IpcContext): string => getSetting(ctx.db.sqlite, 'wtFolder');
