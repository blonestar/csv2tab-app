// Ažuriranje aplikacije, logika bez Electrona: raspored provera, prelazi stanja i poruke za korisnika.
// Sve što dolazi spolja (sat, baza, electron-updater, slanje stanja) stiže kroz zavisnosti, pa je ovo testabilno
// u običnom Node-u. Adapter nad electron-updater je u src/main/updater.ts.
import type { UpdateInterval } from '../shared/settings';
import type { UpdatePhase, UpdateState, UpdateVariant } from '../shared/update';

export type { UpdateVariant } from '../shared/update';

const DAY = 24 * 60 * 60 * 1000;
const INTERVAL_MS: Record<Exclude<UpdateInterval, 'never'>, number> = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY };

/** Promenljiva za test: adresa lokalnog servera izdanja (samo uz CSV2TAB_TEST=1 i nespakovanu aplikaciju). */
export const UPDATE_TEST_URL_ENV = 'CSV2TAB_TEST_UPDATE_URL';
export const UNSUPPORTED_MESSAGE = 'Ažuriranje je dostupno samo u instaliranoj verziji programa.';
const CHECK_FAILED = 'Provera nije uspela. Proverite internet vezu.';
const DOWNLOAD_FAILED = 'Preuzimanje nije uspelo. Proverite internet vezu i pokušajte ponovo.';
const INSTALL_FAILED = 'Instalacija nije uspela. Pokušajte ponovo ili preuzmite program ponovo.';

/** Greška čija je poruka već bezbedna za korisnika (bez putanja i bez tehničkih detalja). */
export class UpdateFailure extends Error {}

/** Da li je provera dospela po učestalosti. Prvi put (nema zapisa) dospeva, osim kad je učestalost `never`. */
export function isCheckDue(now: number, lastCheck: number | null, interval: UpdateInterval): boolean {
  if (interval === 'never') return false;
  if (lastCheck === null) return true;
  // sat je vraćen unazad: zapis iz budućnosti ne sme da odloži proveru zauvek
  if (lastCheck > now) return true;
  return now - lastCheck >= INTERVAL_MS[interval];
}

/** Pri pokretanju: provera ako je uključena pri pokretanju ili ako je interval dospeo. */
export function shouldCheckOnStartup(now: number, lastCheck: number | null, interval: UpdateInterval, onStartup: boolean): boolean {
  return onStartup || isCheckDue(now, lastCheck, interval);
}

/** Adresa test servera ako je test režim aktivan (isto pravilo kao testMode u index.ts); inače undefined. */
export function updateTestUrl(env: NodeJS.ProcessEnv, packaged: boolean): string | undefined {
  if (packaged || env.CSV2TAB_TEST !== '1') return undefined;
  return env[UPDATE_TEST_URL_ENV] || undefined;
}

/** Varijanta po okruženju. U test režimu sa adresom servera tretira se kao podržana (appimage na Linuxu, nsis na Windowsu). */
export function chooseVariant({ platform, packaged, env }: { platform: string; packaged: boolean; env: NodeJS.ProcessEnv }): UpdateVariant {
  if (!packaged) {
    if (!updateTestUrl(env, packaged)) return 'unsupported';
    if (platform === 'win32') return 'nsis';
    return platform === 'linux' ? 'appimage' : 'unsupported';
  }
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis';
  if (platform === 'linux') return env.APPIMAGE ? 'appimage' : 'unsupported';
  return 'unsupported';
}

/** Ono što adapter (electron-updater) daje glavnom toku. Greške može da baci bilo šta; poruka ide kroz mapiranje. */
export interface UpdateDriver {
  /** Verzija novijeg izdanja ili null kad je program najnoviji. */
  check(): Promise<string | null>;
  /** Preuzima izdanje; napredak prosleđuje sirov procenat. Vraća naziv preuzetog fajla (samo portable). */
  download(version: string, onProgress: (percent: number) => void): Promise<string | undefined>;
  /** Pokreće instalaciju preuzetog izdanja. Za nsis/appimage electron-updater zatvara program. */
  install(fileName: string | undefined): Promise<void>;
}

export interface UpdateSettings {
  updateInterval: UpdateInterval;
  updateOnStartup: boolean;
}

export interface UpdateDeps {
  variant: UpdateVariant;
  currentVersion: string;
  now(): number;
  driver: UpdateDriver;
  readLastCheck(): number | null;
  writeLastCheck(time: number): void;
  readSettings(): UpdateSettings;
  /** Stanje za renderer; poziva se pri svakoj promeni. */
  send(state: UpdateState): void;
  /** Čuva sve nesačuvane izmene i zatvara prozor pre instalacije; false ako korisnik odustane. */
  prepareInstall(): Promise<boolean>;
  log(message: string, error: unknown): void;
}

export interface UpdateController {
  readonly variant: UpdateVariant;
  state(): UpdateState;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<void>;
  /** Automatska provera pri pokretanju; vraća true ako je provera pokrenuta. */
  startupCheck(): Promise<boolean>;
  /** Periodična provera (jednom na sat); vraća true ako je provera pokrenuta. */
  tick(): Promise<boolean>;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof UpdateFailure ? error.message : fallback;
}

export function createUpdateController(deps: UpdateDeps): UpdateController {
  const supported = deps.variant !== 'unsupported';
  let phase: UpdatePhase = { kind: 'idle' };
  let lastCheck = deps.readLastCheck();
  // najnovije izdanje koje je poslednja provera našla (cilj za preuzimanje)
  let version: string | null = null;
  let checking: Promise<UpdateState> | null = null;

  const snapshot = (): UpdateState => ({ variant: deps.variant, currentVersion: deps.currentVersion, lastCheck, phase });
  const setPhase = (next: UpdatePhase) => {
    phase = next;
    deps.send(snapshot());
  };
  const requireSupported = () => {
    if (!supported) throw new UpdateFailure(UNSUPPORTED_MESSAGE);
  };
  const busy = () => phase.kind === 'downloading' || phase.kind === 'downloaded';

  async function runCheck(): Promise<UpdateState> {
    // preuzeto ili u toku preuzimanja: provera ne menja to stanje
    if (busy()) return snapshot();
    setPhase({ kind: 'checking' });
    try {
      const found = await deps.driver.check();
      lastCheck = deps.now();
      deps.writeLastCheck(lastCheck);
      version = found;
      setPhase(found ? { kind: 'available', version: found } : { kind: 'none' });
    } catch (error) {
      deps.log('Provera ažuriranja nije uspela.', error);
      setPhase({ kind: 'error', message: messageFor(error, CHECK_FAILED) });
    }
    return snapshot();
  }

  async function check(): Promise<UpdateState> {
    requireSupported();
    // istovremene provere dele jednu, da driver ne krene dvaput
    checking ??= runCheck().finally(() => {
      checking = null;
    });
    return checking;
  }

  async function download(): Promise<UpdateState> {
    requireSupported();
    if (busy()) return snapshot();
    if (phase.kind === 'checking') throw new UpdateFailure('Provera je u toku. Sačekajte kraj pa pokrenite preuzimanje.');
    if (!version) throw new UpdateFailure('Nema novijeg izdanja za preuzimanje. Prvo proverite ažuriranja.');
    const target = version;
    setPhase({ kind: 'downloading', version: target, percent: 0 });
    void deps.driver
      .download(target, (raw) => {
        const percent = Math.min(100, Math.max(0, Math.floor(raw)));
        if (phase.kind === 'downloading' && phase.percent !== percent) setPhase({ kind: 'downloading', version: target, percent });
      })
      .then(
        (fileName) => setPhase({ kind: 'downloaded', version: target, fileName }),
        (error) => {
          deps.log('Preuzimanje ažuriranja nije uspelo.', error);
          setPhase({ kind: 'error', message: messageFor(error, DOWNLOAD_FAILED) });
        },
      );
    return snapshot();
  }

  async function install(): Promise<void> {
    requireSupported();
    if (phase.kind !== 'downloaded') throw new UpdateFailure('Nema preuzetog ažuriranja.');
    const { fileName } = phase;
    // prvo čuvanje i zatvaranje prozora; ako korisnik odustane, instalacije nema
    if (!(await deps.prepareInstall())) return;
    try {
      await deps.driver.install(fileName);
    } catch (error) {
      deps.log('Instalacija ažuriranja nije uspela.', error);
      setPhase({ kind: 'error', message: INSTALL_FAILED });
      throw new UpdateFailure(INSTALL_FAILED);
    }
  }

  return {
    variant: deps.variant,
    state: snapshot,
    check,
    download,
    install,
    async startupCheck() {
      if (!supported) return false;
      const { updateInterval, updateOnStartup } = deps.readSettings();
      if (!shouldCheckOnStartup(deps.now(), lastCheck, updateInterval, updateOnStartup)) return false;
      await check();
      return true;
    },
    async tick() {
      if (!supported) return false;
      const { updateInterval } = deps.readSettings();
      if (!isCheckDue(deps.now(), lastCheck, updateInterval)) return false;
      await check();
      return true;
    },
  };
}
