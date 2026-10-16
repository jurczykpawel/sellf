/** App integration acceptance. @see app/api/cron/route.ts */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ drain: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/affiliates/sync/worker', () => ({ drainAffiliateWork: mocks.drain }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimitForIdentifier: mocks.limit }));
import { GET } from '@/app/api/cron/route';
beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 'local-affiliate-cron'; mocks.limit.mockResolvedValue(true); });
it('runs affiliate sync only after cron authorization', async () => {
  const request = (secret?: string) => new NextRequest('http://localhost/api/cron?job=affiliate-sync', { headers: secret ? { Authorization: `Bearer ${secret}` } : {} });
  for (const secret of [undefined, 'different']) expect((await GET(request(secret))).status).toBe(401);
  expect(mocks.drain).not.toHaveBeenCalled(); expect(mocks.limit).not.toHaveBeenCalled();
  mocks.drain.mockResolvedValue({ success: true, data: { claimed: 4, applied: 2, deferred: 1, failed: 1 } });
  const response = await GET(request('local-affiliate-cron'));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ job: 'affiliate-sync', processed: 2, errors: 1 });
  mocks.drain.mockResolvedValue({ success: false, error: 'queue_unavailable' });
  expect((await GET(request('local-affiliate-cron'))).status).toBe(500);
});
it('mounts the private affiliate routes and coupon settings', () => {
  for (const route of ['dashboard/affiliates', 'dashboard/affiliates/payouts', 'dashboard/affiliates/earnings', 'my-affiliate', 'affiliates/apply']) expect(existsSync(`src/app/[locale]/${route}/page.tsx`)).toBe(true);
  expect(readFileSync('src/components/CouponFormModal.tsx', 'utf8')).toContain('AffiliateCouponEditor');
});
it('keeps affiliate attribution outside checkout and Stripe metadata handling', () => {
  const paths = ['src/lib/services/checkout.ts', 'src/lib/actions/payment.ts', 'src/app/api/update-payment-metadata', 'src/app/api/create-payment-intent', 'src/app/api/embed', 'src/app/api/webhooks/stripe', 'src/app/api/verify-payment', 'src/lib/stripe'];
  const check = (path: string): void => {
    if (path.endsWith('.ts')) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/\baffiliate(?:_|[A-Z])/);
      return;
    }
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.name.endsWith('.ts')) check(`${path}/${entry.name}`);
    }
  };
  paths.forEach(check);
});
