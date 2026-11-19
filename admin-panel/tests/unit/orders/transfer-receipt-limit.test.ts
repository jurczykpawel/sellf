/** Independent signed receipts do not consume one shared refresh budget. */
import { expect, it, vi } from 'vitest';
const limit = vi.hoisted(() => vi.fn(async () => true));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: limit }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { id: 'order', status: 'completed', amount: 1000, currency: 'PLN', transfer_details: {}, payment_provider: 'bank_transfer' } }) }) }) }) }) }) }));
import TransferPage from '@/app/[locale]/order/[orderId]/transfer/page';
import { signTransferToken } from '@/lib/orders/transfer-token';
it('uses the validated order identity for receipt refreshes', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  await TransferPage({ params: Promise.resolve({ orderId: id, locale: 'pl' }), searchParams: Promise.resolve({ token: signTransferToken(id) }) });
  expect(limit).toHaveBeenCalledWith('transfer_instructions', 60, 1, `order:${id}`);
});
