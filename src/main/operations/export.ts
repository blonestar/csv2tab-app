import { checkExport, writeExport } from '../export';
import { exportItemsArg, overwriteArg } from './validate';
import { wtFolder } from './files';
import type { IpcContext, Operation } from './types';

export function exportOperations(ctx: IpcContext) {
  return {
    // Folder uvek dolazi iz baze, nikad iz argumenata renderera.
    'export.check': {
      validate(args) {
        if (args.length !== 1) throw new Error('Očekivana je lista fajlova.');
        return [exportItemsArg(args[0])];
      },
      run: (items) => checkExport(wtFolder(ctx), items),
    } satisfies Operation<'export.check'>,
    'export.write': {
      validate(args) {
        if (args.length !== 2) throw new Error('Očekivani su lista fajlova i spisak za prepisivanje.');
        return [exportItemsArg(args[0]), overwriteArg(args[1])];
      },
      run: (items, overwrite) => writeExport(wtFolder(ctx), items, overwrite),
    } satisfies Operation<'export.write'>,
  };
}
