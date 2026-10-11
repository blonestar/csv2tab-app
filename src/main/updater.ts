// Adapter nad electron-updater: jedino mesto gde glavni proces dodiruje tu biblioteku. Logika je u update.ts.
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import electronUpdater from 'electron-updater';
import { downloadPortable } from './portable';
import type { UpdateDriver, UpdateVariant } from './update';

const { autoUpdater } = electronUpdater;

/** Driver za podržanu varijantu. Za portable electron-updater samo proverava verziju; preuzima i pokreće naš kod. */
export function createUpdateDriver(variant: UpdateVariant, testUrl: string | undefined, env: NodeJS.ProcessEnv): UpdateDriver {
  if (variant !== 'unsupported') {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // AppUpdater je EventEmitter: emit("error") bez slušaoca baca izuzetak. Greške stižu i kroz promise.
    autoUpdater.on('error', () => {});
    if (testUrl) {
      // test režim: nespakovana aplikacija, provera ide na lokalni server iz testa. Preuzimanje u nespakovanoj
      // aplikaciji inače čita dev-app-update.yml iz korena repoa, pa se podešavanje zadaje iz privremenog fajla.
      const configPath = join(app.getPath('temp'), 'csv2tab-update-test.yml');
      writeFileSync(configPath, `provider: generic\nurl: ${JSON.stringify(testUrl)}\nupdaterCacheDirName: csv2tab-app-updater\n`);
      // electron-updater zamenjuje fajl na putanji iz APPIMAGE. Taj podatak može da stigne iz pokretača (tuđi AppImage),
      // pa u test režimu pokazuje na zamenski fajl u privremenom folderu: instalacija tada može da prepiše samo njega.
      process.env.APPIMAGE = join(app.getPath('temp'), 'csv2tab-test-program.AppImage');
      autoUpdater.updateConfigPath = configPath;
      autoUpdater.forceDevUpdateConfig = true;
      autoUpdater.setFeedURL({ provider: 'generic', url: testUrl });
    }
  }
  const portableDir = () => {
    const dir = env.PORTABLE_EXECUTABLE_DIR;
    if (!dir) throw new Error('Nepoznat folder portable programa.');
    return dir;
  };
  return {
    async check() {
      const result = await autoUpdater.checkForUpdates();
      return result?.isUpdateAvailable ? result.updateInfo.version : null;
    },
    async download(version, onProgress) {
      if (variant === 'portable') return downloadPortable(version, portableDir(), onProgress);
      const onDownload = (info: { percent: number }) => onProgress(info.percent);
      autoUpdater.on('download-progress', onDownload);
      try {
        await autoUpdater.downloadUpdate();
      } finally {
        autoUpdater.off('download-progress', onDownload);
      }
      return undefined;
    },
    async install(fileName) {
      if (variant !== 'portable') {
        // čuvanje je već urađeno (prepareInstall); quitAndInstall zatvara program i pokreće instalaciju
        autoUpdater.quitAndInstall(true, true);
        return;
      }
      if (!fileName) throw new Error('Nema preuzetog fajla.');
      // novi fajl se pokreće odvojeno, pa program izlazi
      await new Promise<void>((resolve, reject) => {
        const child = spawn(join(portableDir(), fileName), { detached: true, stdio: 'ignore' });
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
      app.quit();
    },
  };
}
