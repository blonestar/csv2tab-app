import { app } from 'electron';
import coreInfo from '../../../web/package.json' with { type: 'json' };
import { schemaVersion } from '../db/migrate';
import type { AppInfo, IpcOperations } from '../../shared/api';
import { noArgs, type IpcContext, type Operation } from './types';

export function appOperations(ctx: IpcContext): { 'app.info': Operation<'app.info'>; 'app.flushed': Operation<'app.flushed'> } {
  return {
    // Odgovor renderera na zahtev za čuvanje pre zatvaranja prozora (vidi src/main/index.ts).
    'app.flushed': {
      validate(args) {
        if (args.length !== 1 || typeof args[0] !== 'boolean') throw new Error('Očekivan je ishod čuvanja.');
        return [args[0]];
      },
      run: (ok) => ctx.windows.flushed(ok),
    },
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
