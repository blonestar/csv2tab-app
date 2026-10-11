// Gradi tri cilja: main (ESM) i preload (CJS, sandbox) esbuild-om, renderer Vite-om.
import { pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';

export const mainOptions = {
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // electron-updater ostaje u node_modules (uključuje ga electron-builder kao produkcionu zavisnost), a ne u bundle-u
  external: ['electron', 'electron-updater'],
  sourcemap: true,
  logLevel: 'info',
};

// Preload u sandbox-u ne sme da bude ESM: jedan CommonJS fajl, ekstenzija .cjs zbog "type": "module".
export const preloadOptions = {
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await Promise.all([esbuild(mainOptions), esbuild(preloadOptions)]);
  await vite();
}
