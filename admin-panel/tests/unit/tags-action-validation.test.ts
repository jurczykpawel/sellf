/**
 * createTag/updateTag server actions must validate input with the same Zod DTO
 * the public v1 /api/v1/tags route uses (slug ^[a-zA-Z0-9_-]+$, trim, max 50,
 * .strict() to block extra keys), and persist the PARSED object — not the raw
 * argument — so an admin can't store an invalid slug or inject extra columns by
 * spreading arbitrary data into .insert()/.update(). (Security review Low.)
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

import { createTag, updateTag } from '@/lib/actions/tags';

beforeEach(() => { h.inserted = undefined; h.updated = undefined; h.dbCalls = 0; });

describe('createTag input validation', () => {
  it('rejects an invalid slug without touching the DB', async () => {
    const res = await createTag({ name: 'Marketing', slug: 'bad slug!' });
    expect(res.success).toBe(false);
    expect(h.dbCalls).toBe(0);
  });

  it('rejects extra keys (column-injection) without touching the DB', async () => {
    const res = await createTag({ name: 'X', slug: 'ok', is_admin: true } as unknown as { name: string; slug: string });
    expect(res.success).toBe(false);
    expect(h.dbCalls).toBe(0);
  });

  it('persists the parsed (trimmed) object for valid input', async () => {
    const res = await createTag({ name: '  Marketing  ', slug: 'marketing' });
    expect(res.success).toBe(true);
    expect(h.inserted).toEqual({ name: 'Marketing', slug: 'marketing' });
  });
});

describe('updateTag input validation', () => {
  it('rejects an invalid slug without touching the DB', async () => {
    const res = await updateTag('00000000-0000-4000-a000-000000000000', { name: 'Y', slug: 'NOPE!' });
    expect(res.success).toBe(false);
    expect(h.dbCalls).toBe(0);
  });

  it('persists the parsed object for valid input', async () => {
    const res = await updateTag('00000000-0000-4000-a000-000000000000', { name: 'Sales', slug: 'sales' });
    expect(res.success).toBe(true);
    expect(h.updated).toEqual({ name: 'Sales', slug: 'sales' });
  });
});
