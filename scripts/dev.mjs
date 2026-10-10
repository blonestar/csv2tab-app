// Razvoj: Vite dev server za renderer (HMR), esbuild watch za main i preload, pa Electron koji učitava dev server.
import { context } from 'esbuild';
import { createServer } from 'vite';
import { mainOptions, preloadOptions } from './build.mjs';
import { runElectron } from './electron.mjs';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite server nije dao adresu.');

// watch() sam radi prvi build; čekamo da se završi pre pokretanja Electrona (inače preload može biti upola prepisan).
const firstBuild = (opts) => {
  let done;
  const ready = new Promise((res) => (done = res));
  const plugin = { name: 'first-build', setup: (b) => b.onEnd(() => done()) };
  return { opts: { ...opts, plugins: [plugin] }, ready };
};
const builds = [mainOptions, preloadOptions].map(firstBuild);
const ctxs = await Promise.all(builds.map((b) => context(b.opts)));
await Promise.all(ctxs.map((c) => c.watch()));
await Promise.all(builds.map((b) => b.ready));

const child = runElectron(['.'], { CSV2TAB_DEV_URL: url });
child.on('exit', async (code) => {
  await Promise.all(ctxs.map((c) => c.dispose()));
  await server.close();
  process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
