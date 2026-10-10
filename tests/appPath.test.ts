import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { resolveAppPath } from '../src/main/appPath';

const root = resolve('/srv/renderer');
const ok = (p: string) => resolveAppPath(root, `app://csv2tab${p}`);

describe('app:// putanje', () => {
  it('služi fajlove iz foldera renderera', () => {
    expect(ok('/')).toBe(resolve(root, 'index.html'));
    expect(ok('/index.html')).toBe(resolve(root, 'index.html'));
    expect(ok('/assets/a.js?x=1')).toBe(resolve(root, 'assets/a.js'));
  });
  it('URL parser skraćuje ".." pre nego što stigne do nas; rezultat ostaje u folderu', () => {
    for (const p of ['/../x', '/%2e%2e/x', '/a/%2e%2e/%2e%2e/x', '//etc/passwd', '/%2Fetc/passwd']) {
      expect(ok(p)?.startsWith(root + '/'), p).toBe(true);
    }
  });
  it('odbija kodirane separatore, prazne i neispravne putanje', () => {
    for (const p of ['/%2E%2E%2Fx', '/assets/..%2f..%2fx', '/..%5cx', '/a%5c..%5cx', '/%00', '/%zz', '/C:/Windows/x']) {
      expect(ok(p), p).toBeNull();
    }
  });
  it('odbija drugu šemu i host', () => {
    expect(resolveAppPath(root, 'app://evil/index.html')).toBeNull();
    expect(resolveAppPath(root, 'file:///etc/passwd')).toBeNull();
  });
});
