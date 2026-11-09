import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ row: { payment_provider: 'bank_transfer', stripe_payment_intent_id: null as string | null, status: 'completed', amount: 1000, refunded_amount: 0 }, stripe: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), authenticate: async () => ({ admin: { userId: 'admin' }, supabase: mocks.client() }) }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: mocks.stripe }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApiWithRequest: async () => ({ user: { id: 'admin' } }) }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, RATE_LIMITS: { ADMIN_REFUND: {} } }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ user: { id: 'admin' }, dataClient: mocks.client() }) }));
import { POST } from '@/app/api/admin/payments/refund/route';
import { POST as refundV1 } from '@/app/api/v1/payments/[id]/refund/route';
import { processRefund } from '@/lib/actions/payment';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row.stripe_payment_intent_id = null;
  const query = { select: () => query, eq: () => query, in: () => query, single: async () => ({ data: mocks.row, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  mocks.stripe.mockRejectedValue(new Error('No Stripe configuration'));
});
it('rejects a bank transfer via the API before consulting Stripe configuration', async () => {
  const result = await POST(new NextRequest('http://localhost/api/admin/payments/refund', { method: 'POST', body: JSON.stringify({ transactionId: 'tx' }) }));
  expect(result.status).toBe(400);
  expect((await result.json()).error).toMatch(/bank transfer/i);
  expect(mocks.stripe).not.toHaveBeenCalled();
});
it('rejects a bank transfer via the action before consulting Stripe configuration', async () => {
  const result = await processRefund({ transactionId: 'tx' });
  expect(result.success).toBe(false);
  expect(result.message).toMatch(/bank transfer/i);
  expect(mocks.stripe).not.toHaveBeenCalled();
});

it('rejects a bank transfer via API v1 before consulting Stripe configuration', async () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const result = await refundV1(new NextRequest(`http://localhost/api/v1/payments/${id}/refund`, { method: 'POST', body: '{}' }), { params: Promise.resolve({ id }) });
  expect(result.status).toBe(400);
  expect((await result.json()).error.message).toMatch(/bank transfer/i);
  expect(mocks.stripe).not.toHaveBeenCalled();
});

it('allows a transfer order settled online to reach the Stripe refund operation', async () => {
  mocks.row.stripe_payment_intent_id = 'pi_settled_online';
  const result = await processRefund({ transactionId: 'tx' });
  expect(mocks.stripe).toHaveBeenCalledOnce();
  expect(result.message).toBe('Payment system unavailable');
});
