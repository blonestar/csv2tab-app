// Ikonice iz postojećeg favicon SVG-a web aplikacije. Potreban je ImageMagick (magick); gotove ikonice su u git-u.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const html = await readFile('web/index.html', 'utf8');
const source = /rel="icon" href="data:image\/svg\+xml,([^"]+)"/.exec(html)?.[1];
if (!source) throw new Error('Logo web aplikacije nije pronađen.');
await mkdir('build/icons', { recursive: true });
await writeFile('build/icon.svg', decodeURIComponent(source) + '\n');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const run = (args) => {
  const result = spawnSync('magick', args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Generisanje ikonice nije uspelo (potreban je ImageMagick).');
};
for (const size of sizes) run(['-background', 'none', '-density', '1152', 'build/icon.svg', '-resize', `${size}x${size}`, `build/icons/${size}x${size}.png`]);
run([...sizes.filter((s) => s <= 256).map((s) => `build/icons/${s}x${s}.png`), 'build/icon.ico']);
