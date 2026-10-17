/** Registered account list. @see app/api/v1/users/route.ts */
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), authenticate: async () => ({ supabase: { from: mocks.from } }) }));
import { GET } from '@/app/api/v1/users/route';
import { GET as getUser } from '@/app/api/v1/users/[id]/route';
function mockRegisteredAccount() {
  mocks.from.mockImplementation((table: string) => {
    let head = false;
    const rows = table === 'user_access_stats' ? [{ user_id: 'dddddddd-0000-4000-a000-000000000001', email: 'registered@example.com', user_created_at: '2026-10-01T00:00:00Z', total_products: 0, total_value: 0 }] : [];
    const query = { select: (_fields: string, options?: { head?: boolean }) => { head = options?.head ?? false; return query; },
      eq: () => query, single: async () => ({ data: rows[0], error: rows.length ? null : { code: 'PGRST116' } }),
      ilike: () => query, order: () => query, limit: () => query, in: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: head ? null : rows, count: rows.length, error: null }).then(resolve) };
    return query;
  });
}
it('includes registered accounts without purchases or product access', async () => {
  mockRegisteredAccount();
  const response = await GET(new NextRequest('http://localhost/api/v1/users'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.map((user: { email: string }) => user.email)).toContain('registered@example.com');
  expect(body.pagination.total).toBe(1);
});

it('opens the details of a registered account with no purchases', async () => {
  mockRegisteredAccount();
  const response = await getUser(new NextRequest('http://localhost/api/v1/users/dddddddd-0000-4000-a000-000000000001'), { params: Promise.resolve({ id: 'dddddddd-0000-4000-a000-000000000001' }) });
  expect(response.status).toBe(200);
  expect((await response.json()).data.email).toBe('registered@example.com');
});
