/**
 * /payment/success is a pure return hop: without a purchase to resolve it never claims success.
 * @see src/app/payment/success/page.tsx
 */
import { describe, expect, it, vi } from 'vitest';
import PaymentSuccessPage from '@/app/payment/success/page';

vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));

const visit = (params: Record<string, string>) => PaymentSuccessPage({ searchParams: Promise.resolve(params) });

describe('payment success route', () => {
  it.each([{}, { locale: 'pl' }, { session_id: 'cs_test_1' }])('redirects %j to the shop instead of showing a success page', async params => {
    await expect(visit(params)).rejects.toThrow(`REDIRECT /${params.locale ?? 'en'}`);
  });
  it('still forwards a checkout return to the payment status page', async () => {
    await expect(visit({ session_id: 'cs_test_1', product: 'demo', locale: 'pl' })).rejects.toThrow(/REDIRECT \/pl\/.*demo.*session_id=cs_test_1/);
  });
});
