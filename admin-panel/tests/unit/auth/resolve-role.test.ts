import { describe, it, expect, vi } from 'vitest';

import { resolveUserRole } from '@/lib/auth/resolve-role';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

function fakeSupabase(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe('resolveUserRole', () => {
  it('resolves via the uncached is_admin RPC, not is_admin_cached', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    const role = await resolveUserRole(fakeSupabase(rpc));

    expect(rpc).toHaveBeenCalledWith('is_admin');
    expect(rpc).not.toHaveBeenCalledWith('is_admin_cached');
    expect(role).toBe('platform_admin');
  });

  it('returns "user" when is_admin resolves false', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    const role = await resolveUserRole(fakeSupabase(rpc));

    expect(role).toBe('user');
  });

  it('retries on error and returns "user" after exhausting retries', async () => {
    vi.useFakeTimers();
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') });

    const rolePromise = resolveUserRole(fakeSupabase(rpc), 2);
    await vi.runAllTimersAsync();
    const role = await rolePromise;

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(role).toBe('user');
    vi.useRealTimers();
  });

  it('recovers after a transient error on a later attempt', async () => {
    vi.useFakeTimers();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('transient') })
      .mockResolvedValueOnce({ data: true, error: null });

    const rolePromise = resolveUserRole(fakeSupabase(rpc), 3);
    await vi.runAllTimersAsync();
    const role = await rolePromise;

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(role).toBe('platform_admin');
    vi.useRealTimers();
  });
});
