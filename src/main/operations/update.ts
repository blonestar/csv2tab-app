import { noArgs, type IpcContext, type Operation } from './types';

// Ažuriranje: provera, preuzimanje i instalacija rade u glavnom procesu (src/main/update.ts). Stanje se šalje
// rendereru i događajem `update.state` pri svakoj promeni, pa operacije vraćaju trenutno stanje.
export function updateOperations(ctx: IpcContext) {
  return {
    'update.state': {
      validate: noArgs,
      run: () => ctx.update.state(),
    } satisfies Operation<'update.state'>,
    'update.check': {
      validate: noArgs,
      run: () => ctx.update.check(),
    } satisfies Operation<'update.check'>,
    'update.download': {
      validate: noArgs,
      run: () => ctx.update.download(),
    } satisfies Operation<'update.download'>,
    'update.install': {
      validate: noArgs,
      run: () => ctx.update.install(),
    } satisfies Operation<'update.install'>,
  };
}
