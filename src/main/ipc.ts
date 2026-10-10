// Registracija IPC operacija. Svaka operacija ima validate (oblik argumenata) i run; renderer nikad ne stiže
// do run sa neproverenim argumentima. Operacije su u src/main/operations/ po oblastima; nova oblast se spaja ovde.
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { APP_ORIGIN, type IpcChannel } from '../shared/api';
import { appOperations } from './operations/app';
import { backupOperations } from './operations/backup';
import { catalogOperations } from './operations/catalog';
import { compareOperations } from './operations/compare';
import { exportOperations } from './operations/export';
import { filesOperations } from './operations/files';
import { jobsOperations } from './operations/jobs';
import { memoryOperations } from './operations/memory';
import { settingsOperations } from './operations/settings';
import type { IpcContext, Operation } from './operations/types';

export type { IpcContext } from './operations/types';

export function registerIpc(ctx: IpcContext): void {
  const operations: { [K in IpcChannel]: Operation<K> } = {
    ...appOperations(ctx),
    ...settingsOperations(ctx),
    ...catalogOperations(ctx),
    ...filesOperations(ctx),
    ...exportOperations(ctx),
    ...jobsOperations(ctx),
    ...compareOperations(ctx),
    ...memoryOperations(ctx),
    ...backupOperations(ctx),
  };

  const trusted = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? '';
    return url.startsWith(`${APP_ORIGIN}/`) || (!!ctx.devUrl && url.startsWith(ctx.devUrl));
  };

  // Posle zamene baze stari prozor ne sme da piše (njegov otvoreni posao pripada staroj bazi) dok se ponovo ne učita.
  const allowedWhileRestoring: IpcChannel[] = ['backup.finish', 'app.info', 'app.flushed'];

  for (const channel of Object.keys(operations) as IpcChannel[]) {
    const op = operations[channel] as Operation<IpcChannel>;
    ipcMain.handle(channel, (e, ...args: unknown[]) => {
      if (!trusted(e)) throw new Error('Poziv iz nepoznatog okvira.');
      if (ctx.lock.restoring && !allowedWhileRestoring.includes(channel)) throw new Error('Baza je upravo vraćena iz kopije; potvrdite da se prozor ponovo učita.');
      return op.run(...op.validate(args));
    });
  }
}
