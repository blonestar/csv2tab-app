// Fajlovi iz argumenata procesa. Putanje se razrešavaju u folderu procesa koji ih je poslao.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kindFromName } from '../shared/job';

export function filesFromArguments(argv: readonly string[], cwd: string, packaged: boolean): string[] {
  return argv.slice(packaged ? 1 : 2).flatMap((arg) => {
    if (arg.startsWith('-')) return [];
    let file = arg;
    if (arg.startsWith('file:')) {
      try { file = fileURLToPath(arg); } catch { return []; }
    }
    return kindFromName(file) !== null ? [resolve(cwd, file)] : [];
  });
}
