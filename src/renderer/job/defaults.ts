// Početne vrednosti novog posla: tabela šifara kantovanja, pravilo za jednobojne dekore i spajanje. Jedino mesto
// odakle ih renderer uzima. Novi posao dobija KOPIJU trenutnih podešavanja (`defaultsFromSettings`); posle toga se
// podešavanja i posao ne vezuju (JobState.edgeRules, JobState.decorRule).
import { DEFAULT_EDGE_RULES, type EdgeRule } from '@core/parts';
import { cloneEdgeRules } from '../../shared/edgeRules';
import type { JobState } from '../../shared/job';
import type { SettingsMap } from '../../shared/settings';

export interface JobDefaults {
  edgeRules: readonly EdgeRule[];
  decorRule: boolean;
  merge: boolean;
}

/** Ugrađene vrednosti (isto što podešavanja daju dok ništa nije menjano). */
export const BUILT_IN_DEFAULTS: JobDefaults = { edgeRules: DEFAULT_EDGE_RULES, decorRule: true, merge: true };

export const defaultsFromSettings = (s: Pick<SettingsMap, 'edgeRules' | 'decorRule' | 'mergeDefault'>): JobDefaults => ({
  edgeRules: s.edgeRules,
  decorRule: s.decorRule,
  merge: s.mergeDefault,
});

export function newJobState(d: JobDefaults = BUILT_IN_DEFAULTS): JobState {
  return {
    version: 2,
    encoding: 'auto',
    delimiter: 'auto',
    sheet: 0,
    mapping: 'auto',
    merge: d.merge,
    materials: {},
    edits: {},
    edgeRules: cloneEdgeRules(d.edgeRules),
    decorRule: d.decorRule,
    mappingFromMemory: false,
  };
}
