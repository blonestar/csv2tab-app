import { comparePayloadArg, compareIdArg } from './validate';
import type { IpcContext, Operation } from './types';

export function compareOperations(ctx: IpcContext) {
  return {
    'compare.open': {
      validate(args) {
        if (args.length !== 1) throw new Error('Očekivani su podaci za poređenje.');
        return [comparePayloadArg(args[0])];
      },
      run(payload) {
        ctx.windows.openCompare(payload);
      },
    } satisfies Operation<'compare.open'>,
    'compare.get': {
      validate(args) {
        if (args.length !== 1) throw new Error('Očekivan je id prozora.');
        return [compareIdArg(args[0])];
      },
      run(id) {
        const p = ctx.windows.getCompare(id);
        if (!p) throw new Error('Nepoznat prozor poređenja.');
        return p;
      },
    } satisfies Operation<'compare.get'>,
  };
}
