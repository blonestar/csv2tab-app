import { checkExport, writeExport, writeExportAsk } from '../export';
import { getJobItem, jobExports, recordExports, type ExportToRecord } from '../db/jobs';
import { setSetting } from '../db/settings';
import { pickSaveFile } from '../files';
import { folderName } from '../fileNames';
import { exportItemsArg, jobIdArg, overwriteArg } from './validate';
import { HEADER_SIZE, RECORD_SIZE } from '../../../web/src/lib/wtTab';
import { wtFolder } from './files';
import type { ExportWriteResult } from '../../shared/api';
import type { IpcContext, Operation } from './types';

export function exportOperations(ctx: IpcContext) {
  return {
    // Folder uvek dolazi iz baze, nikad iz argumenata renderera.
    'export.check': {
      validate(args) {
        if (args.length !== 1) throw new Error('Očekivana je lista fajlova.');
        return [exportItemsArg(args[0])];
      },
      run: (items) => checkExport(wtFolder(ctx), items),
    } satisfies Operation<'export.check'>,
    'export.write': {
      validate(args) {
        if (args.length !== 3) throw new Error('Očekivani su lista fajlova, spisak za prepisivanje i posao.');
        const items = exportItemsArg(args[0]);
        const jobId = args[2] === null ? null : jobIdArg(args[2]);
        if (jobId !== null && items.some((i) => i.material === undefined)) throw new Error('Uz posao svaki fajl mora imati materijal.');
        return [items, overwriteArg(args[1]), jobId];
      },
      async run(items, overwrite, jobId) {
        const db = ctx.db.sqlite;
        // posao se proverava pre upisa: ne upisuje se fajl koji posle ne može da se zabeleži
        if (jobId !== null && !getJobItem(ctx.db.sqlite, jobId)) throw new Error('Posao ne postoji.');
        const folder = wtFolder(ctx);
        const res = await writeExport(folder, items, overwrite);
        if (!res.ok || jobId === null) return res;
        if (db !== ctx.db.sqlite || ctx.lock.restoring) return { ...res, recordError: 'Baza je promenjena tokom izvoza; izvoz nije zabeležen u vraćenoj bazi.' };
        // Beleži se samo ono što je zaista upisano ili već postoji bajt-identično; preskočeno i neuspelo se ne beleži.
        const toRecord: ExportToRecord[] = [];
        res.items.forEach((it, i) => {
          if (it.status !== 'written' && it.status !== 'identical') return;
          const bytes = items[i].bytes;
          toRecord.push({
            material: items[i].material ?? '',
            fileName: it.name,
            folder,
            bytes,
            count: (bytes.length - HEADER_SIZE) / RECORD_SIZE,
            result: it.status,
          });
        });
        const out: Extract<ExportWriteResult, { ok: true }> = res;
        try {
          out.job = toRecord.length ? recordExports(ctx.db.sqlite, jobId, toRecord) : jobExports(ctx.db.sqlite, jobId);
        } catch (e) {
          out.recordError = e instanceof Error ? e.message : String(e);
        }
        return out;
      },
    } satisfies Operation<'export.write'>,
    'export.save': {
      validate(args) {
        if (args.length !== 2) throw new Error('Očekivani su lista fajlova i posao.');
        const items = exportItemsArg(args[0]);
        const jobId = args[1] === null ? null : jobIdArg(args[1]);
        if (jobId !== null && items.some((i) => i.material === undefined)) throw new Error('Uz posao svaki fajl mora imati materijal.');
        return [items, jobId];
      },
      async run(items, jobId) {
        // posao se proverava pre dijaloga: ne upisuje se fajl koji posle ne može da se zabeleži
        if (jobId !== null && !getJobItem(ctx.db.sqlite, jobId)) throw new Error('Posao ne postoji.');
        const db = ctx.db.sqlite;
        const res = await writeExportAsk(wtFolder(ctx), items, (p) => pickSaveFile(ctx.testMode, p));
        const out: Extract<ExportWriteResult, { ok: true }> = {
          ok: true,
          folder: folderName(res.dir),
          items: res.items.map(({ name, status, message }) => (message === undefined ? { name, status } : { name, status, message })),
        };
        if (db !== ctx.db.sqlite || ctx.lock.restoring) {
          if (jobId !== null) out.recordError = 'Baza je promenjena tokom izvoza; izvoz nije zabeležen u vraćenoj bazi.';
          return out;
        }
        if (res.items.some((it) => it.status === 'written' || it.status === 'identical')) {
          // sledeći dijalog se otvara u poslednjem folderu; pamćenje je pomoćno, pa greška ne sme da pokvari izvoz
          try {
            setSetting(db, 'wtFolder', res.dir);
          } catch {
            /* ništa: folder se tada samo ne pamti */
          }
        }
        if (jobId === null) return out;
        // Beleži se samo ono što je zaista upisano ili već postoji bajt-identično; odustalo i neuspelo se ne beleži.
        const toRecord: ExportToRecord[] = [];
        res.items.forEach((it, i) => {
          if ((it.status !== 'written' && it.status !== 'identical') || !it.dir) return;
          const bytes = items[i].bytes;
          toRecord.push({
            material: items[i].material ?? '',
            fileName: it.name,
            folder: it.dir,
            bytes,
            count: (bytes.length - HEADER_SIZE) / RECORD_SIZE,
            result: it.status,
          });
        });
        try {
          out.job = toRecord.length ? recordExports(ctx.db.sqlite, jobId, toRecord) : jobExports(ctx.db.sqlite, jobId);
        } catch (e) {
          out.recordError = e instanceof Error ? e.message : String(e);
        }
        return out;
      },
    } satisfies Operation<'export.save'>,
  };
}
