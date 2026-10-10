// Registracija IPC operacija. Svaka operacija ima validate (oblik argumenata) i run; renderer nikad ne stiže
// do run sa neproverenim argumentima. Operacije su u src/main/operations/ po oblastima; nova oblast se spaja ovde.
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { APP_ORIGIN, type IpcChannel } from '../shared/api';
import { appOperations } from './operations/app';
import { catalogOperations } from './operations/catalog';
import { compareOperations } from './operations/compare';
import { exportOperations } from './operations/export';
import { filesOperations } from './operations/files';
import { jobsOperations } from './operations/jobs';
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
  };

  const trusted = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? '';
    return url.startsWith(`${APP_ORIGIN}/`) || (!!ctx.devUrl && url.startsWith(ctx.devUrl));
  };

  for (const channel of Object.keys(operations) as IpcChannel[]) {
    const op = operations[channel] as Operation<IpcChannel>;
    ipcMain.handle(channel, (e, ...args: unknown[]) => {
      if (!trusted(e)) throw new Error('Poziv iz nepoznatog okvira.');
      return op.run(...op.validate(args));
    });
  }
}
