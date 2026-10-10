// Zaobilaženje dijaloga u testu: putanju zadaje promenljiva okruženja. Važi samo kad je CSV2TAB_TEST=1 i aplikacija
// nije spakovana; u običnom radu se promenljive ignorišu. Čita se pri svakom pozivu, pa test može da je menja
// preko `electronApp.evaluate` između koraka.

export interface TestHookContext {
  env: NodeJS.ProcessEnv;
  testMode: boolean;
  packaged: boolean;
}

export const TEST_ENV = {
  /** Fajl koji "izabere" dijalog za uvoz. */
  import: 'CSV2TAB_TEST_IMPORT',
  /** .tab koji "izabere" dijalog za poređenje. */
  compare: 'CSV2TAB_TEST_COMPARE',
  /** Folder koji "izabere" dijalog za izbor foldera. */
  folder: 'CSV2TAB_TEST_FOLDER',
} as const;

/** Putanja iz promenljive ili undefined (dijalog se tada prikazuje normalno). */
export function testOverride(name: (typeof TEST_ENV)[keyof typeof TEST_ENV], ctx: TestHookContext): string | undefined {
  if (!ctx.testMode || ctx.packaged) return undefined;
  const v = ctx.env[name];
  return v ? v : undefined;
}
