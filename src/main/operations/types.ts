import type { AppDatabase, OpenOptions } from '../db';
import type { ComparePayload, IpcChannel, IpcOperations } from '../../shared/api';
import type { OpenedFile } from '../../shared/job';
import type { UpdateController } from '../update';

export interface Operation<K extends IpcChannel> {
  /** Baca grešku ako argumenti nemaju očekivani oblik; inače ih vraća sa tačnim tipom. */
  validate(args: unknown[]): IpcOperations[K]['args'];
  run(...args: IpcOperations[K]['args']): IpcOperations[K]['result'] | Promise<IpcOperations[K]['result']>;
}

export interface IpcContext {
  /** Adresa Vite dev servera (samo u razvoju), da se prihvate i pozivi sa nje. */
  devUrl?: string;
  testMode: boolean;
  /** Baza živi samo u glavnom procesu; renderer joj pristupa isključivo kroz operacije. */
  db: AppDatabase;
  /** Kako se baza otvara (putanja, migracije, katalog); vraćanje iz kopije je ponovo otvara. */
  dbOptions: OpenOptions;
  /** Dok je true, sve operacije osim završetka vraćanja se odbijaju (baza je upravo zamenjena, a stari prozor još nije ponovo učitan). */
  lock: { restoring: boolean };
  /** Primenjuje podešavanje na samu aplikaciju (npr. temu prozora). */
  applySetting(key: string, value: unknown): void;
  /** Provera, preuzimanje i instalacija izdanja (src/main/update.ts). */
  update: UpdateController;
  /** Prozori poređenja; podaci stoje u glavnom procesu, prozor dobija samo id u adresi. */
  windows: {
    nextFile(): Promise<OpenedFile | null>;
    openCompare(payload: ComparePayload): void;
    getCompare(id: string): ComparePayload | undefined;
    /** Traži od glavnog prozora da upiše nesačuvano; true ako je sve u bazi (ili prozora nema). */
    flushMain(): Promise<boolean>;
    /** Zatvara prozore poređenja i ponovo učitava glavni prozor (posle vraćanja baze). */
    reloadAfterRestore(): void;
    /** Renderer javlja da je sve nesačuvano upisano (ok) ili da nije uspelo. */
    flushed(ok: boolean): void;
  };
}

export function noArgs(args: unknown[]): [] {
  if (args.length !== 0) throw new Error('Operacija ne prima argumente.');
  return [];
}
