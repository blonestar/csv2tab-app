import { applyMemoryUpdate, forgetMemory, listMemory, lookupMemory } from '../db/memory';
import { memoryLookupArg, memoryUpdateArg } from '../../shared/memory';
import { noArgs, type IpcContext, type Operation } from './types';

export function memoryOperations(ctx: IpcContext) {
  return {
    'memory.lookup': {
      validate(args) {
        if (args.length !== 1) throw new Error('Očekivan je upit.');
        return [memoryLookupArg(args[0])];
      },
      run: (q) => lookupMemory(ctx.db.sqlite, q),
    } satisfies Operation<'memory.lookup'>,
    'memory.remember': {
      validate(args) {
        if (args.length !== 1) throw new Error('Očekivan je upis.');
        return [memoryUpdateArg(args[0])];
      },
      run: (u) => applyMemoryUpdate(ctx.db.sqlite, u),
    } satisfies Operation<'memory.remember'>,
    'memory.list': {
      validate: noArgs,
      run: () => listMemory(ctx.db.sqlite),
    } satisfies Operation<'memory.list'>,
    'memory.forget': {
      validate(args) {
        if (args.length !== 2 || (args[0] !== 'material' && args[0] !== 'mapping')) throw new Error('Očekivani su vrsta (material ili mapping) i ključ.');
        const key = args[1];
        if (key !== null && (typeof key !== 'string' || key.length === 0 || key.length > 2000)) throw new Error('Neispravan ključ.');
        return [args[0], key as string | null];
      },
      run: (kind, key) => forgetMemory(ctx.db.sqlite, kind, key),
    } satisfies Operation<'memory.forget'>,
  };
}
