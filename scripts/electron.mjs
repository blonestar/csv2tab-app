// Pokreće Electron bez ELECTRON_RUN_AS_NODE (nasleđen iz alata koji je i sam Electron aplikacija bi ga pretvorio u Node).
import { spawn } from 'node:child_process';
import electron from 'electron';
import { pathToFileURL } from 'node:url';

export function runElectron(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electron, args, { stdio: 'inherit', env });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runElectron(process.argv.slice(2)).on('exit', (code) => process.exit(code ?? 0));
}
