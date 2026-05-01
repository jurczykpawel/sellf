/**
 * Asserts that the user_product_access helpers in
 * subscription-handlers.ts capture and surface DB errors instead of
 * silently swallowing them. The earlier code path
 * (`await supabase.from(...).update(...)` discarded) hid legitimate
 * write failures; the helpers now return `{ ok, reason }` so callers
 * can decide whether to escalate (force a Stripe retry) or log and
 * continue.
 */
import { describe, it, expect } from 'vitest';
import {
  upsertUserProductAccess,
  revokeUserProductAccessForSubscription,
} from '@/app/api/webhooks/stripe/subscription-handlers';

interface QueryStub {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

function buildSupabaseStub(stubs: {
  selectAccess?: QueryStub;
  selectSiblings?: QueryStub;
  updateAccess?: QueryStub;
  insertAccess?: QueryStub;
  deleteAccess?: QueryStub;
}) {
  const access = (op: 'select' | 'update' | 'insert' | 'delete') => {
    if (op === 'select') {
      const stub = stubs.selectAccess ?? { data: null, error: null };
      return {
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => stub,
          }),
        }),
      };
    }
    if (op === 'update') {
      const stub = stubs.updateAccess ?? { error: null };
      return { eq: async () => stub };
    }
    if (op === 'insert') {
      const stub = stubs.insertAccess ?? { error: null };
      return Promise.resolve(stub);
    }
    // delete
    const stub = stubs.deleteAccess ?? { error: null };
    return { eq: async () => stub };
  };

  const subscriptions = () => {
    const stub = stubs.selectSiblings ?? { data: [], error: null };
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              in: () => ({
                order: () => ({
                  limit: async () => stub,
                }),
              }),
            }),
          }),
        }),
      }),
    };
  };

  return {
    from: (table: string) => {
      if (table === 'user_product_access') {
        return {
          select: () => access('select'),
          update: () => access('update'),
          insert: (..._: unknown[]) => access('insert'),
          delete: () => access('delete'),
        };
      }
      if (table === 'subscriptions') return subscriptions();
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

describe('upsertUserProductAccess error surfacing', () => {
  it('returns ok:true when row already exists and update succeeds', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: { id: 'access-1' }, error: null },
      updateAccess: { error: null },
    });
    const r = await upsertUserProductAccess(supabase as never, 'u1', 'p1', 'sub-row-1');
    expect(r.ok).toBe(true);
  });

  it('returns ok:false when access lookup errors', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { error: { message: 'connection lost' } },
    });
    const r = await upsertUserProductAccess(supabase as never, 'u1', 'p1', 'sub-row-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/lookup/i);
  });

  it('returns ok:false when update errors', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: { id: 'access-1' }, error: null },
      updateAccess: { error: { message: 'rls denied' } },
    });
    const r = await upsertUserProductAccess(supabase as never, 'u1', 'p1', 'sub-row-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/update/i);
  });

  it('returns ok:false when insert errors (no existing row)', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: null, error: null },
      insertAccess: { error: { code: '23503', message: 'fk violation' } },
    });
    const r = await upsertUserProductAccess(supabase as never, 'u1', 'p1', 'sub-row-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/insert/i);
  });
});

describe('revokeUserProductAccessForSubscription error surfacing', () => {
  it('returns ok:true and is a no-op when no access row exists', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: null, error: null },
    });
    const r = await revokeUserProductAccessForSubscription(supabase as never, 'u1', 'p1', 'sub-1');
    expect(r.ok).toBe(true);
  });

  it('returns ok:true and is a no-op when access points at a different sub', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: { id: 'a-1', subscription_id: 'OTHER-sub' }, error: null },
    });
    const r = await revokeUserProductAccessForSubscription(supabase as never, 'u1', 'p1', 'sub-1');
    expect(r.ok).toBe(true);
  });

  it('returns ok:false when access lookup errors', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { error: { message: 'connection lost' } },
    });
    const r = await revokeUserProductAccessForSubscription(supabase as never, 'u1', 'p1', 'sub-1');
    expect(r.ok).toBe(false);
  });

  it('returns ok:false when sibling lookup errors', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: { id: 'a-1', subscription_id: 'sub-1' }, error: null },
      selectSiblings: { error: { message: 'rls denied' } },
    });
    const r = await revokeUserProductAccessForSubscription(supabase as never, 'u1', 'p1', 'sub-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sibling/i);
  });

  it('relinks to a sibling when one is active', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: { id: 'a-1', subscription_id: 'sub-1' }, error: null },
      selectSiblings: { data: [{ id: 'sub-2', status: 'active' }], error: null },
      updateAccess: { error: null },
    });
    const r = await revokeUserProductAccessForSubscription(supabase as never, 'u1', 'p1', 'sub-1');
    expect(r.ok).toBe(true);
  });

  it('returns ok:false when relink update errors', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: { id: 'a-1', subscription_id: 'sub-1' }, error: null },
      selectSiblings: { data: [{ id: 'sub-2', status: 'active' }], error: null },
      updateAccess: { error: { message: 'unique violation' } },
    });
    const r = await revokeUserProductAccessForSubscription(supabase as never, 'u1', 'p1', 'sub-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/relink/i);
  });

  it('deletes when no sibling and returns ok:true on success', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: { id: 'a-1', subscription_id: 'sub-1' }, error: null },
      selectSiblings: { data: [], error: null },
      deleteAccess: { error: null },
    });
    const r = await revokeUserProductAccessForSubscription(supabase as never, 'u1', 'p1', 'sub-1');
    expect(r.ok).toBe(true);
  });

  it('returns ok:false when delete errors', async () => {
    const supabase = buildSupabaseStub({
      selectAccess: { data: { id: 'a-1', subscription_id: 'sub-1' }, error: null },
      selectSiblings: { data: [], error: null },
      deleteAccess: { error: { message: 'rls denied' } },
    });
    const r = await revokeUserProductAccessForSubscription(supabase as never, 'u1', 'p1', 'sub-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/delete/i);
  });
});
