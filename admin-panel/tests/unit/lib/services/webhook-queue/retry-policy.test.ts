import { describe, it, expect } from 'vitest';
import {
  computeNextRetry,
  hasMoreAttempts,
  RETRY_DELAYS_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
} from '@/lib/services/webhook-queue/retry-policy';

describe('retry-policy', () => {
  const FIXED_NOW = new Date('2026-05-23T12:00:00.000Z');

  it('exposes the documented backoff sequence: 1m, 5m, 30m, 2h, 12h', () => {
    expect(RETRY_DELAYS_SECONDS).toEqual([60, 300, 1800, 7200, 43200]);
  });

  it('default max attempts equals delay table length', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(RETRY_DELAYS_SECONDS.length);
  });

  it.each([
    [1, 60],
    [2, 300],
    [3, 1800],
    [4, 7200],
    [5, 43200],
  ])('computeNextRetry(%i) returns now + %is', (attempt, secs) => {
    const next = computeNextRetry(attempt, FIXED_NOW);
    expect(next.getTime() - FIXED_NOW.getTime()).toBe(secs * 1000);
  });

  it('caps the delay at the last entry for attempts beyond the table', () => {
    const next = computeNextRetry(99, FIXED_NOW);
    expect(next.getTime() - FIXED_NOW.getTime()).toBe(43200 * 1000);
  });

  it('clamps attempts < 1 to the first delay slot', () => {
    const next = computeNextRetry(0, FIXED_NOW);
    expect(next.getTime() - FIXED_NOW.getTime()).toBe(60 * 1000);
  });

  it('hasMoreAttempts true when below max', () => {
    expect(hasMoreAttempts(1, 5)).toBe(true);
    expect(hasMoreAttempts(4, 5)).toBe(true);
  });

  it('hasMoreAttempts false at or above max', () => {
    expect(hasMoreAttempts(5, 5)).toBe(false);
    expect(hasMoreAttempts(6, 5)).toBe(false);
  });
});
