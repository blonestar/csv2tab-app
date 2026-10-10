import type { AppDatabase } from '../db';
import type { ComparePayload, IpcChannel, IpcOperations } from '../../shared/api';

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
  /** Primenjuje podešavanje na samu aplikaciju (npr. temu prozora). */
  applySetting(key: string, value: unknown): void;
  /** Prozori poređenja; podaci stoje u glavnom procesu, prozor dobija samo id u adresi. */
  windows: {
    openCompare(payload: ComparePayload): void;
    getCompare(id: string): ComparePayload | undefined;
    /** Renderer javlja da je sve nesačuvano upisano (ok) ili da nije uspelo. */
    flushed(ok: boolean): void;
  };
}

export function noArgs(args: unknown[]): [] {
  if (args.length !== 0) throw new Error('Operacija ne prima argumente.');
  return [];
}
