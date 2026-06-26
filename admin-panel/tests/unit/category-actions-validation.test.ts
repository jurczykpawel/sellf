/**
 * createCategory/updateCategory server actions must validate input with a Zod DTO
 * (slug ^[a-zA-Z0-9_-]+$, trim, max lengths, .strict() to block extra keys) and
 * persist the PARSED object — not the raw argument — for parity with the tag
 * actions (commit f0a8dd7b) and defense-in-depth against an admin storing an
 * invalid slug or injecting extra columns via spread.
 *
 * Auth (withAdminClient) and demo-guard are mocked so we exercise only the
 * validation wiring — invalid input must short-circuit before any DB call.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ inserted: undefined as unknown, updated: undefined as unknown, dbCalls: 0 }));

vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false, DEMO_MODE_ERROR: 'demo' }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminClient: async (fn: (ctx: { dataClient: unknown }) => unknown) =>
    fn({
      dataClient: {
        from: () => ({
          insert: (d: unknown) => { h.dbCalls++; h.inserted = d; return Promise.resolve({ error: null }); },
          update: (d: unknown) => ({ eq: () => { h.dbCalls++; h.updated = d; return Promise.resolve({ error: null }); } }),
        }),
      },
    }),
}));

import { createCategory, updateCategory } from '@/lib/actions/categories';

beforeEach(() => { h.inserted = undefined; h.updated = undefined; h.dbCalls = 0; });

describe('createCategory input validation', () => {
  it('rejects an invalid slug without touching the DB', async () => {
    const res = await createCategory({ name: 'Workflows', slug: 'bad slug!' });
    expect(res.success).toBe(false);
    expect(h.dbCalls).toBe(0);
  });

  it('rejects extra keys (column-injection) without touching the DB', async () => {
    const res = await createCategory(
      { name: 'X', slug: 'ok', parent_id: 'evil' } as unknown as { name: string; slug: string },
    );
    expect(res.success).toBe(false);
    expect(h.dbCalls).toBe(0);
  });

  it('persists the parsed (trimmed) object for valid input', async () => {
    const res = await createCategory({ name: '  Workflows  ', slug: 'workflows', description: '  hi  ' });
    expect(res.success).toBe(true);
    expect(h.inserted).toEqual({ name: 'Workflows', slug: 'workflows', description: 'hi' });
  });
});

describe('updateCategory input validation', () => {
  it('rejects an invalid slug without touching the DB', async () => {
    const res = await updateCategory('00000000-0000-4000-a000-000000000000', { name: 'Y', slug: 'NOPE!' });
    expect(res.success).toBe(false);
    expect(h.dbCalls).toBe(0);
  });

  it('persists the parsed object for valid input', async () => {
    const res = await updateCategory('00000000-0000-4000-a000-000000000000', { name: 'Sales', slug: 'sales' });
    expect(res.success).toBe(true);
    expect(h.updated).toEqual({ name: 'Sales', slug: 'sales' });
  });
});
