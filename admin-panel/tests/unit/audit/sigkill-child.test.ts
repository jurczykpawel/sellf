/**
 * CHILD of audit-sigkill.integration.test.ts — skipped unless that test spawns it (W256D_SIGKILL_CASE).
 *
 * Runs the real admin action / route against the local database with a fetch that SIGKILLs this
 * process at the request that makes the change: `before` = just before it is sent, `after` = right
 * after its response. SIGKILL runs no handler, so whatever the code wrote before that point stays.
 * A marker file proves the kill happened at that request (no false pass when the code never got there).
 */
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  kase: process.env.W256D_SIGKILL_CASE ?? '',
  when: process.env.W256D_SIGKILL_WHEN ?? 'before',
  marker: process.env.W256D_SIGKILL_MARKER ?? '',
  actor: process.env.W256D_SIGKILL_ACTOR ?? '',
  userId: process.env.W256D_SIGKILL_USER ?? '',
  productId: process.env.W256D_SIGKILL_PRODUCT ?? '',
}));

/** The request that makes the change, old and new shape alike (direct table write or RPC). */
const CHANGE = {
  invoicing: (url: string, method: string) => method !== 'GET' && /\/rest\/v1\/(invoicing_config|rpc\/save_invoicing_config)\b/.test(url),
  grant: (url: string) => /\/rest\/v1\/rpc\/mutate_access/.test(url),
  revoke: (url: string) => /\/rest\/v1\/rpc\/mutate_access/.test(url),
}[env.kase as 'invoicing' | 'grant' | 'revoke'];

function die(point: string): never {
  writeFileSync(env.marker, point);
  process.kill(process.pid, 'SIGKILL');
  throw new Error('unreachable');
}

const killingFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const isChange = CHANGE?.(url, method) ?? false;
  if (isChange && env.when === 'before') die(`before ${method} ${new URL(url).pathname}`);
  const response = await fetch(input, init);
  if (isChange && env.when === 'after') die(`after ${response.status} ${method} ${new URL(url).pathname}`);
  return response;
};

const realClient = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: killingFetch },
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ dataClient: realClient(), user: { id: env.actor } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: realClient, createPlatformClient: realClient }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({ user: { id: env.actor, email: 'admin@example.com' } }) }));

it.skipIf(!env.kase)(`SIGKILL probe: ${env.kase} ${env.when}`, async () => {
  if (env.kase === 'invoicing') {
    const { saveInvoiceSettings } = await import('@/lib/actions/invoicing');
    await saveInvoiceSettings({ provider: 'none', domain: '', mode: 'manual', exemption: '', template: '{product} w256d-sigkill', token: '' });
  } else {
    const { POST, DELETE } = await import('@/app/api/users/[id]/access/route');
    const params = { params: Promise.resolve({ id: env.userId }) };
    if (env.kase === 'grant') {
      await POST(new NextRequest(`http://localhost/api/users/${env.userId}/access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product_id: env.productId }) }), params);
    } else {
      await DELETE(new NextRequest(`http://localhost/api/users/${env.userId}/access?product_id=${env.productId}`, { method: 'DELETE' }), params);
    }
  }
  expect.fail('the change request was never made, so the probe did not run');
});
