// Renderer: root je src/renderer, izlaz dist/renderer (to servira app:// protokol).
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const alias = {
  '@core': r('./web/src/lib'),
  // fflate se uvek razrešava iz ovog repoa, i za fajlove iz web/ (web/node_modules se ne koristi)
  fflate: r('./node_modules/fflate/esm/browser.js'),
};

export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  plugins: [react()],
  resolve: { alias },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: r('./dist/renderer'), emptyOutDir: true, target: 'es2022' },
});
