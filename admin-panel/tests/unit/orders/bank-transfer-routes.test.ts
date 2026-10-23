import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const auth = vi.hoisted(() => vi.fn());
const operate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orders/bank-transfer-admin', () => ({ operateTransfer: operate }));
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), authenticate: auth }));
import { POST as markPaid } from '@/app/api/v1/payments/[id]/mark-paid/route';
import { POST as cancel } from '@/app/api/v1/payments/[id]/cancel/route';
const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ supabase: {}, admin: { userId: 'session-actor' } }); operate.mockResolvedValue({ success: true }); });
describe('transfer administration API', () => {
  it.each([['mark-paid', markPaid, { amount: 9400, paidAt: '2026-01-01T00:00:00Z' }],
    ['cancel', cancel, { reason: 'Customer request' }]] as const)('requires payments:write for %s and uses the verified actor', async (action, handler, body) => {
    const request = new NextRequest(`http://localhost/api/v1/payments/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await handler(request, { params: Promise.resolve({ id }) });
    expect(auth).toHaveBeenCalledWith(request, ['payments:write']);
    expect(operate).toHaveBeenCalledWith({}, 'session-actor', id, { ...body, action });
    expect(response.status).toBe(200);
  });
  it('reports an amount rejection as validation error', async () => {
    operate.mockResolvedValue({ success: false, error: 'Amount mismatch' });
    const response = await markPaid(new NextRequest('http://localhost/api/v1/payments/id/mark-paid', { method: 'POST', body: JSON.stringify({ amount: 1 }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400);
  });
});
