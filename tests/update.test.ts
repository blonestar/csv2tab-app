// Ažuriranje bez Electrona: raspored provera, izbor varijante, prelazi stanja sa lažnim driverom i preuzimanje portable fajla.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadPortable, portableFileName, portableUrl } from '../src/main/portable';
import {
  UNSUPPORTED_MESSAGE,
  UpdateFailure,
  chooseVariant,
  createUpdateController,
  isCheckDue,
  shouldCheckOnStartup,
  updateTestUrl,
  type UpdateDriver,
  type UpdateSettings,
} from '../src/main/update';
import type { UpdateInterval } from '../src/shared/settings';
import type { UpdateState, UpdateVariant } from '../src/shared/update';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 11, 12);
const LIMITS: Record<Exclude<UpdateInterval, 'never'>, number> = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY };

describe('raspored provere', () => {
  it('daily, weekly i monthly dospevaju tačno posle svog intervala', () => {
    for (const [interval, ms] of Object.entries(LIMITS) as [Exclude<UpdateInterval, 'never'>, number][]) {
      expect(isCheckDue(NOW, NOW - ms, interval), `${interval} tačno na granici`).toBe(true);
      expect(isCheckDue(NOW, NOW - ms + 1, interval), `${interval} jedna ms pre granice`).toBe(false);
      expect(isCheckDue(NOW, NOW, interval), `${interval} upravo proveren`).toBe(false);
      expect(isCheckDue(NOW, null, interval), `${interval} bez zapisa`).toBe(true);
      expect(isCheckDue(NOW, NOW + 5 * DAY, interval), `${interval} sat unazad`).toBe(true);
    }
  });
  it('never nikad ne dospeva, ni bez zapisa ni posle dugo vremena', () => {
    expect(isCheckDue(NOW, null, 'never')).toBe(false);
    expect(isCheckDue(NOW, NOW - 1000 * DAY, 'never')).toBe(false);
    expect(isCheckDue(NOW, NOW + DAY, 'never')).toBe(false);
  });
  it('pri pokretanju: 4 kombinacije uključenosti i dospelosti', () => {
    const recent = NOW - DAY; // nije dospelo za tjednu proveru
    const old = NOW - 8 * DAY; // dospelo za tjednu proveru
    expect(shouldCheckOnStartup(NOW, old, 'weekly', true)).toBe(true);
    expect(shouldCheckOnStartup(NOW, recent, 'weekly', true)).toBe(true);
    expect(shouldCheckOnStartup(NOW, old, 'weekly', false)).toBe(true);
    expect(shouldCheckOnStartup(NOW, recent, 'weekly', false)).toBe(false);
    expect(shouldCheckOnStartup(NOW, recent, 'never', true)).toBe(true);
    expect(shouldCheckOnStartup(NOW, null, 'never', false)).toBe(false);
  });
});

describe('izbor varijante', () => {
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...extra });
  const test = { CSV2TAB_TEST: '1', CSV2TAB_TEST_UPDATE_URL: 'http://127.0.0.1:9/' };
  const v = (platform: string, packaged: boolean, extra: Record<string, string> = {}): UpdateVariant =>
    chooseVariant({ platform, packaged, env: env(extra) });

  it('upakovana Windows aplikacija: nsis, a portable kad postoji PORTABLE_EXECUTABLE_FILE', () => {
    expect(v('win32', true)).toBe('nsis');
    expect(v('win32', true, { PORTABLE_EXECUTABLE_FILE: 'C:\\Programi\\csv2tab-app.exe' })).toBe('portable');
  });
  it('upakovani Linux: appimage kad postoji APPIMAGE, inače nepodržano', () => {
    expect(v('linux', true, { APPIMAGE: '/opt/csv2tab-app.AppImage' })).toBe('appimage');
    expect(v('linux', true)).toBe('unsupported');
  });
  it('macOS i ostalo su uvek nepodržani', () => {
    expect(v('darwin', true)).toBe('unsupported');
    expect(v('darwin', true, { APPIMAGE: 'x' })).toBe('unsupported');
  });
  it('nespakovana aplikacija je nepodržana bez test adrese', () => {
    for (const platform of ['win32', 'linux', 'darwin']) expect(v(platform, false)).toBe('unsupported');
    expect(v('linux', false, { CSV2TAB_TEST: '1' })).toBe('unsupported');
    expect(v('linux', false, { CSV2TAB_TEST_UPDATE_URL: 'http://x/' })).toBe('unsupported');
  });
  it('test adresa uz CSV2TAB_TEST=1 čini nespakovanu aplikaciju podržanom: appimage na Linuxu, nsis na Windowsu', () => {
    expect(chooseVariant({ platform: 'linux', packaged: false, env: test })).toBe('appimage');
    expect(chooseVariant({ platform: 'win32', packaged: false, env: test })).toBe('nsis');
    expect(chooseVariant({ platform: 'darwin', packaged: false, env: test })).toBe('unsupported');
  });
  it('test adresa se ignoriše u upakovanoj aplikaciji', () => {
    expect(updateTestUrl(test as NodeJS.ProcessEnv, true)).toBeUndefined();
    expect(chooseVariant({ platform: 'linux', packaged: true, env: test })).toBe('unsupported');
    expect(chooseVariant({ platform: 'win32', packaged: true, env: { ...test, PORTABLE_EXECUTABLE_FILE: 'x.exe' } })).toBe('portable');
  });
  it('test adresa se ignoriše kad test režim nije aktivan', () => {
    expect(updateTestUrl({ CSV2TAB_TEST_UPDATE_URL: 'http://x/' } as NodeJS.ProcessEnv, false)).toBeUndefined();
    expect(updateTestUrl({ CSV2TAB_TEST: '0', CSV2TAB_TEST_UPDATE_URL: 'http://x/' } as NodeJS.ProcessEnv, false)).toBeUndefined();
    expect(updateTestUrl({ CSV2TAB_TEST: '1', CSV2TAB_TEST_UPDATE_URL: '' } as NodeJS.ProcessEnv, false)).toBeUndefined();
    expect(updateTestUrl(test as NodeJS.ProcessEnv, false)).toBe('http://127.0.0.1:9/');
  });
});

// Lažni driver i zavisnosti: sat, zapis poslednje provere, podešavanja i sve poruke stanja.
function harness(opts: { variant?: UpdateVariant; driver?: Partial<UpdateDriver>; lastCheck?: number | null; settings?: Partial<UpdateSettings>; prepare?: boolean } = {}) {
  let now = NOW;
  let last: number | null = opts.lastCheck ?? null;
  const writes: number[] = [];
  const sent: UpdateState[] = [];
  const logs: unknown[] = [];
  const prepares: number[] = [];
  const calls = { check: 0, download: [] as string[], install: [] as (string | undefined)[] };
  const driver: UpdateDriver = {
    check: async () => {
      calls.check++;
      return null;
    },
    download: async () => undefined,
    install: async (fileName) => {
      calls.install.push(fileName);
    },
    ...opts.driver,
  };
  const ctl = createUpdateController({
    variant: opts.variant ?? 'appimage',
    currentVersion: '0.8.1',
    now: () => now,
    driver,
    readLastCheck: () => last,
    writeLastCheck: (t) => {
      last = t;
      writes.push(t);
    },
    readSettings: () => ({ updateInterval: 'weekly', updateOnStartup: true, ...opts.settings }),
    send: (s) => sent.push(s),
    prepareInstall: async () => {
      prepares.push(now);
      return opts.prepare ?? true;
    },
    log: (message, error) => logs.push([message, error]),
  });
  return {
    ctl,
    calls,
    writes,
    sent,
    logs,
    prepares,
    setNow: (t: number) => (now = t),
    /** Čeka da pozadinski posao (preuzimanje) završi. */
    settle: () => new Promise((r) => setTimeout(r, 0)),
  };
}

describe('stanje provere', () => {
  it('nema novije verzije: none i upisan lastCheck', async () => {
    const h = harness();
    const state = await h.ctl.check();
    expect(state.phase).toEqual({ kind: 'none' });
    expect(state.currentVersion).toBe('0.8.1');
    expect(state.lastCheck).toBe(NOW);
    expect(h.writes).toEqual([NOW]);
    expect(h.sent.map((s) => s.phase.kind)).toEqual(['checking', 'none']);
  });
  it('novija verzija: available', async () => {
    const h = harness({ driver: { check: async () => '0.9.0' } });
    const state = await h.ctl.check();
    expect(state.phase).toEqual({ kind: 'available', version: '0.9.0' });
    expect(state.variant).toBe('appimage');
    expect(h.writes).toEqual([NOW]);
  });
  it('greška mreže: error bez putanje i bez tehničkih detalja, lastCheck nije upisan', async () => {
    const h = harness({
      driver: { check: async () => { throw new Error('getaddrinfo ENOTFOUND github.com /home/korisnik/.config/csv2tab-app/x.yml'); } },
    });
    const state = await h.ctl.check();
    expect(state.phase).toEqual({ kind: 'error', message: 'Provera nije uspela. Proverite internet vezu.' });
    expect(JSON.stringify(state)).not.toMatch(/\/|github|ENOTFOUND/);
    expect(state.lastCheck).toBeNull();
    expect(h.writes).toEqual([]);
    expect(h.logs.length).toBe(1);
  });
  it('dve istovremene provere ne pokreću driver dvaput', async () => {
    let resolveCheck: (v: string | null) => void = () => {};
    const h = harness({
      driver: {
        check: () => {
          h.calls.check++;
          return new Promise((r) => (resolveCheck = r));
        },
      },
    });
    const a = h.ctl.check();
    const b = h.ctl.check();
    resolveCheck('0.9.0');
    const [ra, rb] = await Promise.all([a, b]);
    expect(h.calls.check).toBe(1);
    expect(ra).toEqual(rb);
    expect(ra.phase).toEqual({ kind: 'available', version: '0.9.0' });
  });
  it('nepodržana varijanta: provera, preuzimanje i instalacija bacaju navedenu grešku', async () => {
    const h = harness({ variant: 'unsupported' });
    await expect(h.ctl.check()).rejects.toThrow(UNSUPPORTED_MESSAGE);
    await expect(h.ctl.download()).rejects.toThrow(UNSUPPORTED_MESSAGE);
    await expect(h.ctl.install()).rejects.toThrow(UNSUPPORTED_MESSAGE);
    expect(h.calls.check).toBe(0);
    expect(h.ctl.state().variant).toBe('unsupported');
  });
});

describe('preuzimanje i instalacija', () => {
  it('napredak je ceo procenat, bez ponavljanja, a kraj daje downloaded sa nazivom fajla', async () => {
    const h = harness({
      variant: 'portable',
      driver: {
        check: async () => '0.9.0',
        download: async (_version, progress) => {
          progress(0.4);
          progress(33.7);
          progress(33.9);
          progress(100);
          return 'csv2tab-app-0.9.0-windows-x64-portable.exe';
        },
      },
    });
    await h.ctl.check();
    const started = await h.ctl.download();
    expect(started.phase).toMatchObject({ kind: 'downloading', version: '0.9.0' });
    await h.settle();
    // 33.9 i 0.4 se zaokružuju na već prikazane vrednosti, pa ne šalju novo stanje
    const percents = h.sent.flatMap((s) => (s.phase.kind === 'downloading' ? [s.phase.percent] : []));
    expect(percents).toEqual([0, 33, 100]);
    expect(h.ctl.state().phase).toEqual({ kind: 'downloaded', version: '0.9.0', fileName: 'csv2tab-app-0.9.0-windows-x64-portable.exe' });
  });
  it('nsis/appimage: downloaded bez naziva fajla', async () => {
    const h = harness({ driver: { check: async () => '0.9.0' } });
    await h.ctl.check();
    await h.ctl.download();
    await h.settle();
    expect(h.ctl.state().phase).toEqual({ kind: 'downloaded', version: '0.9.0' });
  });
  it('neuspelo preuzimanje: error, a ponovni pokušaj je moguć', async () => {
    let fail = true;
    const h = harness({
      driver: {
        check: async () => '0.9.0',
        download: async () => {
          if (fail) throw new Error('socket hang up /tmp/x');
          return undefined;
        },
      },
    });
    await h.ctl.check();
    await h.ctl.download();
    await h.settle();
    expect(h.ctl.state().phase).toEqual({ kind: 'error', message: 'Preuzimanje nije uspelo. Proverite internet vezu i pokušajte ponovo.' });
    fail = false;
    await h.ctl.download();
    await h.settle();
    expect(h.ctl.state().phase.kind).toBe('downloaded');
  });
  it('preuzimanje bez prethodno nađenog izdanja se odbija', async () => {
    const h = harness();
    await h.ctl.check();
    await expect(h.ctl.download()).rejects.toBeInstanceOf(UpdateFailure);
  });
  it('instalacija traži preuzeto izdanje i čuvanje; odustajanje ne poziva driver', async () => {
    const h = harness({ driver: { check: async () => '0.9.0' }, prepare: false });
    await expect(h.ctl.install()).rejects.toThrow('Nema preuzetog ažuriranja.');
    await h.ctl.check();
    await h.ctl.download();
    await h.settle();
    await h.ctl.install();
    expect(h.prepares.length).toBe(1);
    expect(h.calls.install).toEqual([]);
  });
  it('instalacija posle čuvanja poziva driver sa nazivom fajla', async () => {
    const h = harness({
      variant: 'portable',
      driver: { check: async () => '0.9.0', download: async () => 'novi.exe' },
    });
    await h.ctl.check();
    await h.ctl.download();
    await h.settle();
    await h.ctl.install();
    expect(h.prepares.length).toBe(1);
    expect(h.calls.install).toEqual(['novi.exe']);
  });
  it('greška pri pokretanju instalacije javlja grešku bez tehničkih detalja', async () => {
    const h = harness({
      driver: {
        check: async () => '0.9.0',
        install: async () => {
          throw new Error('EPERM /mnt/drive/x');
        },
      },
    });
    await h.ctl.check();
    await h.ctl.download();
    await h.settle();
    await expect(h.ctl.install()).rejects.toThrow('Instalacija nije uspela.');
    expect(h.ctl.state().phase).toEqual({ kind: 'error', message: 'Instalacija nije uspela. Pokušajte ponovo ili preuzmite program ponovo.' });
  });
});

describe('automatske provere', () => {
  it('pri pokretanju: provera prema updateOnStartup i dospelosti (4 kombinacije)', async () => {
    const recent = NOW - DAY;
    const cases: [boolean, number | null, boolean][] = [
      [true, recent, true],
      [true, NOW - 8 * DAY, true],
      [false, NOW - 8 * DAY, true],
      [false, recent, false],
    ];
    for (const [onStartup, lastCheck, expected] of cases) {
      const h = harness({ lastCheck, settings: { updateOnStartup: onStartup, updateInterval: 'weekly' } });
      expect(await h.ctl.startupCheck(), `pokretanje ${onStartup} ${lastCheck}`).toBe(expected);
      expect(h.calls.check).toBe(expected ? 1 : 0);
    }
  });
  it('učestalost never ne dospeva, ali updateOnStartup i dalje pokreće proveru', async () => {
    const off = harness({ lastCheck: NOW - 400 * DAY, settings: { updateInterval: 'never', updateOnStartup: false } });
    expect(await off.ctl.startupCheck()).toBe(false);
    expect(await off.ctl.tick()).toBe(false);
    const on = harness({ lastCheck: NOW - 400 * DAY, settings: { updateInterval: 'never', updateOnStartup: true } });
    expect(await on.ctl.startupCheck()).toBe(true);
  });
  it('periodična provera (tick) radi samo kad je interval dospeo', async () => {
    const h = harness({ lastCheck: NOW - DAY / 2, settings: { updateInterval: 'daily' } });
    expect(await h.ctl.tick()).toBe(false);
    h.setNow(NOW + DAY);
    expect(await h.ctl.tick()).toBe(true);
    expect(h.calls.check).toBe(1);
  });
  it('nepodržana varijanta nikad ne proverava automatski', async () => {
    const h = harness({ variant: 'unsupported', lastCheck: null });
    expect(await h.ctl.startupCheck()).toBe(false);
    expect(await h.ctl.tick()).toBe(false);
    expect(h.calls.check).toBe(0);
  });
});

describe('preuzimanje portable fajla', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'csv2tab-portable-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const body = new Uint8Array(new ArrayBuffer(8));
  body.set([1, 2, 3, 4, 5, 6, 7, 8]);
  const response = (status: number, length: number | null, data: Uint8Array<ArrayBuffer> = body) =>
    new Response(data, { status, headers: length === null ? {} : { 'content-length': String(length) } });

  it('adresa i naziv prate izdanje', () => {
    expect(portableFileName('0.9.0')).toBe('csv2tab-app-0.9.0-windows-x64-portable.exe');
    expect(portableUrl('0.9.0')).toBe(`https://github.com/blonestar/csv2tab-app/releases/download/v0.9.0/${portableFileName('0.9.0')}`);
  });
  it('ceo fajl stiže, pa se preimenuje; napredak dolazi do 100', async () => {
    const progress: number[] = [];
    const name = await downloadPortable('0.9.0', dir, (p) => progress.push(p), async () => response(200, body.length));
    expect(name).toBe(portableFileName('0.9.0'));
    expect(readdirSync(dir)).toEqual([name]);
    expect(progress.at(-1)).toBe(100);
  });
  it('odgovor različit od 200 ne pravi fajl, a poruka nema putanje', async () => {
    const err = await downloadPortable('0.9.0', dir, () => {}, async () => response(404, null)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpdateFailure);
    expect((err as Error).message).not.toContain(dir);
    expect(readdirSync(dir)).toEqual([]);
  });
  it('nepotpun prenos se odbija i ne ostavlja .part fajl', async () => {
    const err = await downloadPortable('0.9.0', dir, () => {}, async () => response(200, body.length + 3, body)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpdateFailure);
    expect(readdirSync(dir)).toEqual([]);
  });
  it('mrežna greška ne ostavlja fajl ni u privremenom imenu', async () => {
    writeFileSync(join(dir, 'postojeci.txt'), 'ostaje');
    await expect(downloadPortable('0.9.0', dir, () => {}, async () => { throw new Error('ECONNRESET'); })).rejects.toThrow(/Preuzimanje nije uspelo/);
    expect(readdirSync(dir)).toEqual(['postojeci.txt']);
  });
});
