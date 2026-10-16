/** Portal session boundaries. @see src/lib/affiliates/portal/service.ts */
import { beforeEach, expect, it, vi } from 'vitest';
import { readPartnerPortal, readAdminPortal, portalResponse, portalMetadata } from '@/lib/affiliates/portal/service';
const mocks = vi.hoisted(() => ({ user: vi.fn(), guard: vi.fn(), admin: vi.fn(), connection: vi.fn() }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), connection: mocks.connection }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: mocks.guard }));
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: null }, error: null }); });
it('returns unauthorized before opening a data client', async () => {
  expect(await readPartnerPortal({})).toEqual({ success: false, error: 'unauthorized' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('checks admin session before opening a data client', async () => {
  mocks.guard.mockRejectedValue(new Error('Forbidden'));
  expect(await readAdminPortal('af000000-0000-4000-a000-000000000001', {})).toEqual({ success: false, error: 'forbidden' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('rejects member selection in own query and oversized pages', async () => {
  for (const query of [{ member_id: 'other' }, { limit: 101 }, { cursor: 'x' }]) expect(await readPartnerPortal(query)).toEqual({ success: false, error: 'invalid_input' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('provides private HTTP and metadata defaults on failures too', () => {
  const response = portalResponse({ success: false, error: 'unavailable' });
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(portalMetadata.robots).toEqual({ index: false, follow: false });
});
