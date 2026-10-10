// Registracija IPC operacija. Svaka operacija ima validate (oblik argumenata) i run; renderer nikad ne stiže
// do run sa neproverenim argumentima. Nova operacija se dodaje u `operations`, bez posebne registracije.
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import coreInfo from '../../web/package.json' with { type: 'json' };
import { APP_ORIGIN, type AppInfo, type IpcChannel, type IpcOperations } from '../shared/api';

interface Operation<K extends IpcChannel> {
  /** Baca grešku ako argumenti nemaju očekivani oblik; inače ih vraća sa tačnim tipom. */
  validate(args: unknown[]): IpcOperations[K]['args'];
  run(...args: IpcOperations[K]['args']): IpcOperations[K]['result'] | Promise<IpcOperations[K]['result']>;
}

function noArgs(args: unknown[]): [] {
  if (args.length !== 0) throw new Error('Operacija ne prima argumente.');
  return [];
}

export interface IpcContext {
  /** Adresa Vite dev servera (samo u razvoju), da se prihvate i pozivi sa nje. */
  devUrl?: string;
  testMode: boolean;
}

export function registerIpc(ctx: IpcContext): void {
  const operations: { [K in IpcChannel]: Operation<K> } = {
    'app.info': {
      validate: noArgs,
      run: (): AppInfo => ({
        appVersion: app.getVersion(),
        coreVersion: coreInfo.version,
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        platform: process.platform,
        testMode: ctx.testMode,
      }),
    },
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
