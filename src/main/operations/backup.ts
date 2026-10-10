// Rezervna kopija i vraćanje baze. Putanje ne prelaze granicu: folder za kopije dolazi iz podešavanja (bira ga
// korisnik dijalogom), a kopija za vraćanje se bira dijalogom u glavnom procesu; renderer dobija samo imena i brojeve.
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { createBackup, discardStaged, stageBackup, restoreDatabase } from '../db/backup';
import { loadMigrations } from '../db/migrate';
import { getSetting } from '../db/settings';
import { folderName } from '../fileNames';
import { pickBackupFile } from '../files';
import { noArgs, type IpcContext, type Operation } from './types';

const tokenArg = (args: unknown[]): [string] => {
  if (args.length !== 1 || typeof args[0] !== 'string' || !/^[0-9a-f-]{36}$/.test(args[0])) throw new Error('Neispravna oznaka kopije.');
  return [args[0]];
};

export function backupOperations(ctx: IpcContext) {
  const latest = () => loadMigrations(ctx.dbOptions.migrationsDir).length;
  // ime privremene kopije: pored žive baze, na istom disku, da zamena bude preimenovanje
  const stagedPath = () => `${ctx.db.file}.restore-tmp`;
  let pending: { token: string; staged: string } | null = null;

  const drop = () => {
    if (pending) discardStaged(pending.staged);
    pending = null;
  };

  return {
    'backup.create': {
      validate: noArgs,
      async run() {
        if (!(await ctx.windows.flushMain())) throw new Error('Izmene otvorenog posla nisu sačuvane, pa kopija nije napravljena.');
        const folder = getSetting(ctx.db.sqlite, 'backupFolder');
        if (!folder) throw new Error('Folder za rezervne kopije nije zadat. Izaberite ga u podešavanjima.');
        const r = createBackup(ctx.db, folder, latest());
        return { name: r.name, size: r.size, folder: folderName(folder), jobs: r.jobs };
      },
    } satisfies Operation<'backup.create'>,
    'backup.inspect': {
      validate: noArgs,
      async run() {
        const file = await pickBackupFile(ctx.testMode);
        if (!file) return null;
        drop();
        const staged = stagedPath();
        const s = stageBackup(file, staged, latest());
        pending = { token: randomUUID(), staged };
        return {
          token: pending.token,
          fileName: basename(file),
          size: s.size,
          schemaVersion: s.schemaVersion,
          appSchemaVersion: latest(),
          jobs: s.jobs,
          newestJobAt: s.newestJobAt,
        };
      },
    } satisfies Operation<'backup.inspect'>,
    'backup.restore': {
      validate: tokenArg,
      async run(token) {
        if (!pending || pending.token !== token) throw new Error('Kopija za vraćanje nije pripremljena. Izaberite je ponovo.');
        // nesačuvane izmene otvorenog posla se upisuju pre zamene (zamena ih inače nosi sa sobom)
        if (!(await ctx.windows.flushMain())) throw new Error('Izmene otvorenog posla nisu sačuvane u bazu, pa vraćanje nije pokrenuto.');
        if (!pending || pending.token !== token) throw new Error('Kopija za vraćanje nije pripremljena. Izaberite je ponovo.');
        const staged = pending.staged;
        // Od ovog mesta do kraja je sve sinhrono: nijedna druga operacija ne može da piše u bazu usred zamene.
        ctx.lock.restoring = true;
        try {
          const r = restoreDatabase(ctx.db, staged, ctx.dbOptions);
          Object.assign(ctx.db, r.db);
          pending = null;
          ctx.applySetting('theme', getSetting(ctx.db.sqlite, 'theme'));
          return { safetyName: basename(r.safetyCopy) };
        } catch (e) {
          ctx.lock.restoring = false;
          pending = null;
          throw e;
        }
      },
    } satisfies Operation<'backup.restore'>,
    'backup.cancel': {
      validate: tokenArg,
      run(token) {
        if (pending?.token === token) drop();
      },
    } satisfies Operation<'backup.cancel'>,
    'backup.finish': {
      validate: noArgs,
      run() {
        ctx.lock.restoring = false;
        ctx.windows.reloadAfterRestore();
      },
    } satisfies Operation<'backup.finish'>,
  };
}
