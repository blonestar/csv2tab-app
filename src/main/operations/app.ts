import { app } from 'electron';
import coreInfo from '../../../web/package.json' with { type: 'json' };
import { schemaVersion } from '../db/migrate';
import type { AppInfo, IpcOperations } from '../../shared/api';
import { noArgs, type IpcContext, type Operation } from './types';

export function appOperations(ctx: IpcContext): { 'app.info': Operation<'app.info'> } {
  return {
    'app.info': {
      validate: noArgs,
      run: (): AppInfo => {
        const sqlite = ctx.db.sqlite;
        const v = sqlite.prepare('SELECT sqlite_version() AS v').get() as { v: string };
        return {
          appVersion: app.getVersion(),
          coreVersion: coreInfo.version,
          electron: process.versions.electron,
          node: process.versions.node,
          chrome: process.versions.chrome,
          platform: process.platform,
          testMode: ctx.testMode,
          schemaVersion: schemaVersion(sqlite),
          sqliteVersion: v.v,
        } satisfies IpcOperations['app.info']['result'];
      },
    },
  };
}
