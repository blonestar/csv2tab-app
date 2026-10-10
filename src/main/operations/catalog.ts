import { readCatalog } from '../db/catalog';
import { noArgs, type IpcContext, type Operation } from './types';

export function catalogOperations(ctx: IpcContext): { 'catalog.get': Operation<'catalog.get'> } {
  return {
    'catalog.get': { validate: noArgs, run: () => readCatalog(ctx.db.sqlite) },
  };
}
