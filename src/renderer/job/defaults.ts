// Podrazumevane vrednosti koje faza 5 zamenjuje sačuvanim podešavanjima (tabela šifara kantovanja, spajanje).
// Jedino mesto odakle ih renderer uzima.
import { DEFAULT_EDGE_RULES, type EdgeRule } from '@core/parts';
import type { JobState } from '../../shared/job';

export const EDGE_RULES: readonly EdgeRule[] = DEFAULT_EDGE_RULES;
export const DEFAULT_MERGE = true;

export function newJobState(): JobState {
  return { version: 1, encoding: 'auto', delimiter: 'auto', sheet: 0, mapping: 'auto', merge: DEFAULT_MERGE, materials: {}, edits: {} };
}
