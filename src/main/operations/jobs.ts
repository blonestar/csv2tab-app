import { app } from 'electron';
import { createJob, deleteJob, findBySource, getJob, jobExports, listJobs, saveJobRemembering, updateJobMeta } from '../db/jobs';
import { openedPathFor } from '../openedPaths';
import { TEST_ENV, testOverride } from '../testHooks';
import { defaultJobName } from '../../shared/jobs';
import { jobFileArg, jobIdArg, jobListQueryArg, jobMetaArg, jobSaveArg, sha256Arg } from './validate';
import type { Operation } from './types';
import type { IpcContext } from './types';

export function jobsOperations(ctx: IpcContext) {
  // ctx.db.sqlite se čita pri svakom pozivu (ne čuva se): vraćanje iz kopije ga zamenjuje
  const one = (what: string) => (args: unknown[]) => {
    if (args.length !== 1) throw new Error(what);
    return args[0];
  };
  return {
    'jobs.list': {
      validate: (args) => [jobListQueryArg(one('Očekivana je pretraga.')(args))],
      run: (q) => listJobs(ctx.db.sqlite, q),
    } satisfies Operation<'jobs.list'>,
    'jobs.findBySource': {
      validate: (args) => [sha256Arg(one('Očekivan je SHA-256.')(args))],
      run: (sha) => findBySource(ctx.db.sqlite, sha),
    } satisfies Operation<'jobs.findBySource'>,
    'jobs.get': {
      validate: (args) => [jobIdArg(one('Očekivan je id posla.')(args))],
      run(id) {
        const job = getJob(ctx.db.sqlite, id);
        if (!job) throw new Error('Posao ne postoji.');
        return job;
      },
    } satisfies Operation<'jobs.get'>,
    'jobs.create': {
      validate(args) {
        if (args.length !== 2) throw new Error('Očekivani su fajl i podaci posla.');
        return [jobFileArg(args[0]), jobSaveArg(args[1])];
      },
      run(file, save) {
        const name = defaultJobName(file.name);
        const id = createJob(ctx.db.sqlite, name, { ...file, path: openedPathFor(file.name, file.bytes) }, save);
        const item = ctx.db.sqlite.prepare('SELECT created_at FROM jobs WHERE id = ?').get(id) as { created_at: number };
        return { id, name, createdAt: item.created_at };
      },
    } satisfies Operation<'jobs.create'>,
    'jobs.save': {
      validate(args) {
        if (args.length !== 2) throw new Error('Očekivani su id i podaci posla.');
        return [jobIdArg(args[0]), jobSaveArg(args[1])];
      },
      run(id, save) {
        // samo u test režimu: simulirana greška čuvanja, za proveru vidljivosti i ponavljanja
        if (testOverride(TEST_ENV.failSave, { env: process.env, testMode: ctx.testMode, packaged: app.isPackaged })) {
          throw new Error('Simulirana greška čuvanja (test).');
        }
        // pamćenje izbora ide u istoj transakciji kao čuvanje: ili oba ili ni jedno
        return saveJobRemembering(ctx.db.sqlite, id, save);
      },
    } satisfies Operation<'jobs.save'>,
    'jobs.update': {
      validate(args) {
        if (args.length !== 2) throw new Error('Očekivani su id i izmena.');
        return [jobIdArg(args[0]), jobMetaArg(args[1])];
      },
      run: (id, meta) => updateJobMeta(ctx.db.sqlite, id, meta),
    } satisfies Operation<'jobs.update'>,
    'jobs.delete': {
      validate: (args) => [jobIdArg(one('Očekivan je id posla.')(args))],
      run: (id) => deleteJob(ctx.db.sqlite, id),
    } satisfies Operation<'jobs.delete'>,
    'jobs.exports': {
      validate: (args) => [jobIdArg(one('Očekivan je id posla.')(args))],
      run: (id) => jobExports(ctx.db.sqlite, id),
    } satisfies Operation<'jobs.exports'>,
  };
}
