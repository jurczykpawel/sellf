import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApiWithRequest: async () => ({ user: { id: 'admin' } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mock.db }));
import { GET } from '@/app/api/admin/licenses/route';

it.each([null, { name: 'Updated product', license_tier: 'basic' }])('lists the original license tier without sending its token: %j', async products => {
  const license_key = `${Buffer.from(JSON.stringify({ v: 1, kid: 'key', product: 'product', email: 'buyer@example.com', order: 'order', tier: 'pro', iat: 1, exp: null })).toString('base64url')}.signature`;
  const rows = [{ id: 'license', license_key, products }];
  mock.db.mockReturnValue({ from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, order: () => chain, range: () => chain, then: (resolve: (value: unknown) => void) => resolve({ data: table === 'issued_licenses' ? rows : [], error: null, count: 1 }) };
    return chain;
  } });
  const response = await GET(new NextRequest('http://localhost/api/admin/licenses'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.licenses[0].tier).toBe('pro');
  expect(body.licenses[0]).not.toHaveProperty('license_key');
  expect(JSON.stringify(body)).not.toContain(license_key);
});
