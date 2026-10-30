/** Pure catalogue helpers; importing this module never starts a test or service. */
import ts from 'typescript';

export interface Journey {
  id: string;
  title: string;
  values: Record<string, string>;
  status: 'automated' | 'manual' | 'retired';
  reason?: string;
  end_state: { buyer: string; seller: string; integrator: string };
  layers?: string[];
  limits?: string;
}
export interface JourneyMap {
  dimensions: Record<string, string[]>;
  journeys: Journey[];
  escapes: { id: string; source: string; journey: string; why_missed: string }[];
}
export interface TestTitle { file: string; tags: string[]; skipped: boolean }
export type Pair = Record<string, string>;
export function uncoveredPairs(dimensions: JourneyMap['dimensions'], journeys: Journey[]): Pair[] {
  const entries = Object.entries(dimensions);
  return entries.flatMap(([left, values], i) => entries.slice(i + 1).flatMap(([right, others]) =>
    values.flatMap(a => others.filter(b => !journeys.some(j => j.status !== 'retired' && j.values[left] === a && j.values[right] === b))
      .map(b => ({ [left]: a, [right]: b })))));
}
/** Return the whole pool in seeded order so callers can take their time-budgeted prefix. */
export function pick<T>(pool: readonly T[], seed: string): T[] {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const result = [...pool];
  for (let i = result.length - 1; i > 0; i--) {
    state = (state + 0x6D2B79F5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    const j = Math.floor((((n ^ (n >>> 14)) >>> 0) / 4294967296) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
/** Read actual declaration titles without evaluating modules or treating comments as tests. */
export function testTitles(source: string, file: string): TestTitle[] {
  const result: TestTitle[] = [];
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function callee(node: ts.Node): string[] {
    if (ts.isIdentifier(node)) return [node.text];
    if (ts.isCallExpression(node)) return callee(node.expression);
    if (ts.isPropertyAccessExpression(node)) return [...callee(node.expression), node.name.text];
    return [];
  }
  function visit(node: ts.Node, skipped = false): void {
    if (ts.isCallExpression(node)) {
      const [name, ...methods] = callee(node.expression);
      if (name === 'describe' || (name === 'test' && methods.includes('describe'))) skipped ||= methods.includes('skip') || methods.includes('fixme');
      const title = node.arguments[0];
      if (['test', 'it'].includes(name) && methods.every(m => ['each', 'skip', 'only', 'concurrent', 'sequential', 'todo', 'fixme'].includes(m)) && title && (ts.isStringLiteralLike(title) || ts.isTemplateExpression(title))) {
        const tags = [...title.getText(syntax).matchAll(/@J\d+\b/g)].map(match => match[0].slice(1));
        if (tags.length) result.push({ file, tags, skipped: skipped || methods.some(m => ['skip', 'todo', 'fixme'].includes(m)) });
      }
    }
    ts.forEachChild(node, child => visit(child, skipped));
  }
  visit(syntax);
  return result;
}
