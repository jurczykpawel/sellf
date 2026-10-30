/** Journey catalogue and deterministic exploration contract. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pick, testTitles, uncoveredPairs } from '../helpers/journeys';
import type { JourneyMap, TestTitle } from '../helpers/journeys';

const root = path.resolve(import.meta.dirname, '..');
const files = readdirSync(root, { recursive: true }).filter((file): file is string => typeof file === 'string' && /\.(?:test|spec|http)\.tsx?$/.test(file));
const titles = files.flatMap(file => testTitles(readFileSync(path.join(root, file), 'utf8'), file));
function errors(map: JourneyMap, tests: TestTitle[]): string[] {
  const result: string[] = [];
  const check = (condition: boolean, message: string) => { if (!condition) result.push(message); };
  check(map.journeys.length > 0 && Object.keys(map.dimensions).length >= 2, 'empty journey map');
  const ids = map.journeys.map(j => j.id);
  check(new Set(ids).size === ids.length, 'duplicate journey ID');
  for (const [dimension, values] of Object.entries(map.dimensions)) {
    check(values.length > 0 && new Set(values).size === values.length, `duplicate/empty dimension: ${dimension}`);
  }
  const signatures = map.journeys.map(j => JSON.stringify(Object.keys(map.dimensions).sort().map(key => j.values[key])));
  check(new Set(signatures).size === signatures.length, 'duplicate journey values');
  for (const journey of map.journeys) {
    check(/^J(?:0[1-9]|[1-9]\d+)$/.test(journey.id), `invalid ID: ${journey.id}`);
    check(['automated', 'manual', 'retired'].includes(journey.status), `invalid status: ${journey.id}`);
    check(Object.keys(journey.values).sort().join() === Object.keys(map.dimensions).sort().join(), `dimension keys: ${journey.id}`);
    for (const [key, values] of Object.entries(map.dimensions)) check(values.includes(journey.values[key]), `unknown dimension value: ${journey.id}/${key}`);
    for (const party of ['buyer', 'seller', 'integrator'] as const) check(Boolean(journey.end_state[party]?.trim()), `missing end state: ${journey.id}/${party}`);
    if (journey.status !== 'automated') check(Boolean(journey.reason?.trim()), `missing reason: ${journey.id}`);
    else check(tests.some(test => !test.skipped && test.tags.includes(journey.id)), `no active test: ${journey.id}`);
  }
  for (const test of tests) for (const tag of test.tags) {
    check(map.journeys.some(j => j.id === tag && j.status !== 'retired'), `orphan tag: ${test.file}/${tag}`);
  }
  check(new Set(map.escapes.map(e => e.id)).size === map.escapes.length, 'duplicate escape ID');
  for (const escape of map.escapes) {
    check(map.journeys.some(j => j.id === escape.journey && j.status !== 'retired'), `escape target: ${escape.id}`);
    check(Boolean(escape.why_missed.trim()) && Boolean(escape.source.trim()), `escape context: ${escape.id}`);
  }
  return result;
}
const fixture: JourneyMap = {
  dimensions: { persona: ['new', 'signed_in'], payment: ['none', 'card'] },
  journeys: [{ id: 'J01', title: 'Free access', values: { persona: 'new', payment: 'none' }, status: 'automated', end_state: { buyer: 'access', seller: 'grant', integrator: 'lead' } }],
  escapes: [{ id: 'E01', source: 'checkout review', journey: 'J01', why_missed: 'new account was absent' }],
};
const evidence: TestTitle[] = [{ file: 'flow.spec.ts', tags: ['J01'], skipped: false }];
it('keeps the maintained map and executable test titles consistent', () => {
  const map = JSON.parse(readFileSync(path.join(root, 'journeys.yaml'), 'utf8')) as JourneyMap;
  expect(errors(map, titles)).toEqual([]);
});
it('accepts a complete consumer journey', () => expect(errors(fixture, evidence)).toEqual([]));
it.each([
  ['invalid ID', (m: JourneyMap) => { m.journeys[0].id = 'J1'; }],
  ['invalid status', (m: JourneyMap) => { (m.journeys[0] as { status: string }).status = 'planned'; }],
  ['duplicate journey ID', (m: JourneyMap) => { m.journeys.push(structuredClone(m.journeys[0])); }],
  ['unknown dimension value', (m: JourneyMap) => { m.journeys[0].values.persona = 'other'; }],
  ['dimension keys', (m: JourneyMap) => { delete m.journeys[0].values.payment; }],
  ['duplicate/empty dimension', (m: JourneyMap) => { m.dimensions.persona.push('new'); }],
  ['missing reason: J01', (m: JourneyMap) => { m.journeys[0].status = 'manual'; }],
  ['missing reason: J01', (m: JourneyMap) => { m.journeys[0].status = 'retired'; }],
  ['missing end state:', (m: JourneyMap) => { m.journeys[0].end_state.integrator = ''; }],
  ['escape target', (m: JourneyMap) => { m.escapes[0].journey = 'J99'; }],
  ['duplicate journey values', (m: JourneyMap) => { m.journeys.push({ ...structuredClone(m.journeys[0]), id: 'J02' }); }],
] as const)('rejects %s', (problem, mutate) => {
  const map = structuredClone(fixture); mutate(map); expect(errors(map, evidence)).toContainEqual(expect.stringContaining(problem));
});
it('rejects missing evidence, skipped-only evidence and orphan or retired tags', () => {
  expect(errors(fixture, []).length).toBeGreaterThan(0);
  expect(errors(fixture, [{ ...evidence[0], skipped: true }]).length).toBeGreaterThan(0);
  expect(errors(fixture, [{ ...evidence[0], tags: ['J99'] }]).length).toBeGreaterThan(0);
  const retired = structuredClone(fixture); retired.journeys[0].status = 'retired'; retired.journeys[0].reason = 'replaced';
  expect(errors(retired, evidence).length).toBeGreaterThan(0);
});
it('reads tags from test titles, excluding comments, hooks, steps and skipped suites as evidence', () => {
  const source = `// test('comment @J99', () => {});
    const text = '@J98'; test.beforeAll(() => {}); test.step('step @J97', () => {});
    test('real @J01', () => {}); it.each([1])('case @J02', () => {});
    test.skip('later @J03', () => {}); describe.skip('suite', () => { it('inner @J04', () => {}); });`;
  expect(testTitles(source, 'example.ts')).toEqual([
    { file: 'example.ts', tags: ['J01'], skipped: false }, { file: 'example.ts', tags: ['J02'], skipped: false },
    { file: 'example.ts', tags: ['J03'], skipped: true }, { file: 'example.ts', tags: ['J04'], skipped: true },
  ]);
});
describe('exploration pool', () => {
  it('returns exact missing cross-dimension pairs and ignores retired journeys', () => {
    const pool = uncoveredPairs(fixture.dimensions, fixture.journeys);
    expect(pool).toEqual([{ persona: 'new', payment: 'card' }, { persona: 'signed_in', payment: 'none' }, { persona: 'signed_in', payment: 'card' }]);
    expect(uncoveredPairs(fixture.dimensions, [{ ...fixture.journeys[0], status: 'retired' }])).toHaveLength(4);
    expect(uncoveredPairs(fixture.dimensions, [{ ...fixture.journeys[0], status: 'manual', reason: 'sandbox unavailable' }])).toHaveLength(3);
    expect(uncoveredPairs({}, [])).toEqual([]);
  });
  it('repeats a seeded selection without changing the input or losing any pair', () => {
    const pool = uncoveredPairs(fixture.dimensions, fixture.journeys); const before = structuredClone(pool);
    expect(pick(pool, '2026.10.7-r1')).toEqual(pick(pool, '2026.10.7-r1'));
    expect(pick(pool, '2026.10.7-r1')).not.toEqual(pick(pool, '2026.10.7-r2'));
    expect(pick(pool, '2026.10.7-r1')).toHaveLength(pool.length);
    expect(new Set(pick(pool, '2026.10.7-r1').map(pair => JSON.stringify(pair))).size).toBe(pool.length);
    expect(pool).toEqual(before); expect(pick([], 'seed')).toEqual([]);
  });
});
