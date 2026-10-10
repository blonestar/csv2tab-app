// Fajlovi iz argumenata procesa. Putanje se razrešavaju u folderu procesa koji ih je poslao.
import { resolve } from 'node:path';
import { kindFromName } from '../shared/job';

export function filesFromArguments(argv: readonly string[], cwd: string, packaged: boolean): string[] {
  return argv.slice(packaged ? 1 : 2).filter((arg) => !arg.startsWith('-') && kindFromName(arg) !== null).map((arg) => resolve(cwd, arg));
}
