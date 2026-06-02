/**
 * Unit tests for the pure endpoint-selection logic used by webhook dispatch.
 * Pure function: no DB, no mocks.
 */

import { describe, it, expect } from 'vitest';
import { selectEligibleEndpoints } from '@/lib/webhooks/endpoint-selection';

const ALL_A = { id: 'a', product_filter_mode: 'all' as const };
const SEL_B = { id: 'b', product_filter_mode: 'selected' as const };
const SEL_C = { id: 'c', product_filter_mode: 'selected' as const };

describe('selectEligibleEndpoints', () => {
  it('returns every candidate when the event has no product context', () => {
    const ids = selectEligibleEndpoints([ALL_A, SEL_B], new Set(), false);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('returns every candidate without product context even if some are linked', () => {
    const ids = selectEligibleEndpoints([ALL_A, SEL_B], new Set(['b']), false);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('keeps all-mode endpoints and drops unlinked selected endpoints', () => {
    const ids = selectEligibleEndpoints([ALL_A, SEL_B, SEL_C], new Set(), true);
    expect(ids).toEqual(['a']);
  });

  it('includes a selected endpoint when it is linked to one of the products', () => {
    const ids = selectEligibleEndpoints([ALL_A, SEL_B, SEL_C], new Set(['b']), true);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('returns an empty list when there are no candidates', () => {
    expect(selectEligibleEndpoints([], new Set(), true)).toEqual([]);
  });

  it('does not mutate the input candidate list', () => {
    const candidates = [ALL_A, SEL_B];
    selectEligibleEndpoints(candidates, new Set(['b']), true);
    expect(candidates).toEqual([ALL_A, SEL_B]);
  });
});
