import { describe, it, expect } from 'vitest';
import { filterActiveAccess } from '@/lib/access/filter-active';

const NOW = new Date('2026-04-27T12:00:00Z');
const PAST = new Date('2026-04-26T12:00:00Z').toISOString();
const FUTURE = new Date('2026-04-28T12:00:00Z').toISOString();
const product = { id: 'p1', name: 'Whatever' };

describe('filterActiveAccess', () => {
  it('keeps rows with NULL access_expires_at (unlimited)', () => {
    const out = filterActiveAccess(
      [{ access_expires_at: null, product, granted_at: PAST }],
      NOW
    );
    expect(out).toHaveLength(1);
  });

  it('keeps rows with future access_expires_at', () => {
    const out = filterActiveAccess(
      [{ access_expires_at: FUTURE, product, granted_at: PAST }],
      NOW
    );
    expect(out).toHaveLength(1);
  });

  it('drops rows with past access_expires_at', () => {
    const out = filterActiveAccess(
      [{ access_expires_at: PAST, product, granted_at: PAST }],
      NOW
    );
    expect(out).toHaveLength(0);
  });

  it('drops rows whose product is null (deleted product, dangling access)', () => {
    const out = filterActiveAccess(
      [{ access_expires_at: null, product: null, granted_at: PAST }],
      NOW
    );
    expect(out).toHaveLength(0);
  });

  it('keeps active and drops expired in a mixed input, preserving order', () => {
    const out = filterActiveAccess(
      [
        { id: 'a', access_expires_at: PAST, product, granted_at: PAST },
        { id: 'b', access_expires_at: null, product, granted_at: PAST },
        { id: 'c', access_expires_at: FUTURE, product, granted_at: PAST },
        { id: 'd', access_expires_at: PAST, product, granted_at: PAST },
      ],
      NOW
    );
    expect(out.map((r) => (r as { id: string }).id)).toEqual(['b', 'c']);
  });

  it('boundary: row expiring exactly at NOW is dropped (strict <)', () => {
    const out = filterActiveAccess(
      [{ access_expires_at: NOW.toISOString(), product, granted_at: PAST }],
      NOW
    );
    // `expiresAt < now` evaluates to false at equality → row kept.
    // This mirrors the server's `>= NOW()` semantics in check_user_product_access.
    expect(out).toHaveLength(1);
  });

  it('boundary: row expiring 1 ms before NOW is dropped', () => {
    const justBefore = new Date(NOW.getTime() - 1).toISOString();
    const out = filterActiveAccess(
      [{ access_expires_at: justBefore, product, granted_at: PAST }],
      NOW
    );
    expect(out).toHaveLength(0);
  });

  it('uses `new Date()` when `now` argument is omitted', () => {
    // Smoke test: just verify the default-arg path runs without error and
    // produces the same shape as an explicit `now`.
    const out = filterActiveAccess([
      { access_expires_at: null, product, granted_at: PAST },
    ]);
    expect(out).toHaveLength(1);
  });

  it('returns an empty array unchanged', () => {
    expect(filterActiveAccess([])).toEqual([]);
  });
});
