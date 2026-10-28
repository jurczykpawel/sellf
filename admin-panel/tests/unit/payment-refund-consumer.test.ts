/** Payment reconciliation must expose the observed processor refund status. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import refunds from '../fixtures/stripe/refund_list_full.json';
const mock = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), authenticate: mock.authenticate }));
import { GET } from '@/app/api/v1/payments/[id]/route';
const refund = refunds.data[0];
let row: Record<string, unknown>;
beforeEach(() => {
  row = { id: 'e5000000-0000-4000-a000-000000000010', refund_id: refund.id,
    refund_status: refund.status, refunded_amount: refund.amount, amount: refund.amount,
    user_id: null, products: { id: 'product', custom_checkout_fields: [] } };
  const query = { select: () => query, eq: () => query, single: async () => ({ data: row, error: null }) };
  mock.authenticate.mockResolvedValue({ scopes: ['payments:read'], supabase: { from: () => query } });
});
describe('payment refund reconciliation', () => {
  it.each(['succeeded', 'pending', 'failed', null])('returns the observed %s without deriving it from payment status', async (status) => {
    row.refund_status = status;
    row.status = 'refunded';
    const response = await GET(new NextRequest('http://localhost/api/v1/payments/'+row.id), { params: Promise.resolve({ id: String(row.id) }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.refund).toMatchObject({ id: refund.id, status, amount: refund.amount });
    const canConfirm = body.data.refund.status === 'succeeded' && body.data.refund.amount >= body.data.amount;
    expect(canConfirm).toBe(status === 'succeeded');
  });
});
