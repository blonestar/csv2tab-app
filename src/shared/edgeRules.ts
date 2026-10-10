// Tabela šifara kantovanja: provera, poređenje i opis. Čiste funkcije bez Electrona; koriste je podešavanja (glavni
// proces i renderer) i JobState (snimak tabele u poslu). Značenje redova je isto kao u jezgru (`sanitizeRules`):
// debljine dve stranice (redosled nije bitan, 0 = bez kanta) i šifra 0 do 255.
import { sanitizeRules, type EdgeRule } from '../../web/src/lib/parts';

export const EDGE_RULE_LIMITS = {
  /** Najviše redova u tabeli. */
  rules: 100,
  /** Najveća debljina kanta u mm. */
  thickness: 50,
} as const;

/** Debljine se poredu kao u jezgru (lookupEdgeCode): razlika manja od 0,001 mm je ista debljina. */
const same = (x: number, y: number) => Math.abs(x - y) < 0.001;
const samePair = (p: EdgeRule, q: EdgeRule) => (same(p.a, q.a) && same(p.b, q.b)) || (same(p.a, q.b) && same(p.b, q.a));

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Poruka na srpskom ako tabela nije ispravna, inače null. Strogo: tačno polja a, b, code. */
export function edgeRulesProblem(v: unknown): string | null {
  if (!Array.isArray(v)) return 'Tabela šifara kantovanja mora biti spisak.';
  if (v.length === 0) return 'Tabela mora imati bar jedan red.';
  if (v.length > EDGE_RULE_LIMITS.rules) return `Tabela može imati najviše ${EDGE_RULE_LIMITS.rules} redova.`;
  for (let i = 0; i < v.length; i++) {
    const r = v[i];
    if (!isPlain(r) || Object.keys(r).some((k) => k !== 'a' && k !== 'b' && k !== 'code')) return `Red ${i + 1}: neispravan oblik.`;
  }
  const rules = sanitizeRules(v);
  if (!rules) return 'Tabela šifara kantovanja nije ispravna (debljine moraju biti brojevi, a šifra ceo broj od 0 do 255).';
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.a < 0 || r.b < 0 || r.a > EDGE_RULE_LIMITS.thickness || r.b > EDGE_RULE_LIMITS.thickness) {
      return `Red ${i + 1}: debljina mora biti od 0 do ${EDGE_RULE_LIMITS.thickness} mm.`;
    }
    for (let j = 0; j < i; j++) {
      if (samePair(rules[j], r)) return `Redovi ${j + 1} i ${i + 1} imaju istu kombinaciju debljina.`;
    }
  }
  return null;
}

export function isEdgeRules(v: unknown): v is EdgeRule[] {
  return edgeRulesProblem(v) === null;
}

/** Iste debljine i šifre istim redom. */
export function sameEdgeRules(x: readonly EdgeRule[], y: readonly EdgeRule[]): boolean {
  return x.length === y.length && x.every((r, i) => r.a === y[i].a && r.b === y[i].b && r.code === y[i].code);
}

/** Nezavisna kopija (JobState i podešavanja ne smeju da dele nizove sa podrazumevanom tabelom). */
export const cloneEdgeRules = (rules: readonly EdgeRule[]): EdgeRule[] => rules.map((r) => ({ a: r.a, b: r.b, code: r.code }));
