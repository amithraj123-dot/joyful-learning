import type { Term, Snippet } from './flow-core.ts';
export function validResources(v: unknown): { terms: Term[]; snippets: Snippet[] } {
  const x = v as { terms: Term[]; snippets: Snippet[] };
  if (
    !x ||
    !Array.isArray(x.terms) ||
    !Array.isArray(x.snippets) ||
    x.terms.length > 500 ||
    x.snippets.length > 200
  )
    throw Error('A dictionary supports 500 terms and 200 snippets.');
  const str = (v: unknown, n: number) => typeof v === 'string' && v.length > 0 && v.length <= n;
  if (
    !x.terms.every((t) => t && str(t.id, 100) && str(t.phrase, 80) && str(t.replacement, 80)) ||
    !x.snippets.every((t) => t && str(t.id, 100) && str(t.trigger, 80) && str(t.text, 5000))
  )
    throw Error('Invalid dictionary or snippet.');
  if (
    new Set(x.terms.map((t) => t.id)).size !== x.terms.length ||
    new Set(x.snippets.map((t) => t.id)).size !== x.snippets.length
  )
    throw Error('Dictionary IDs must be unique.');
  return {
    terms: x.terms.map(({ id, phrase, replacement }) => ({ id, phrase, replacement })),
    snippets: x.snippets.map(({ id, trigger, text }) => ({ id, trigger, text })),
  };
}
