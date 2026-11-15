import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const auth = vi.hoisted(() => vi.fn());
const operate = vi.hoisted(() => vi.fn());
const preview = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orders/bank-transfer-admin', () => ({ operateTransfer: operate }));
vi.mock('@/lib/orders/late-transfer-preview', () => ({ previewLateTransfer: preview }));
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), authenticate: auth }));
import { POST as markPaid } from '@/app/api/v1/payments/[id]/mark-paid/route';
import { POST as cancel } from '@/app/api/v1/payments/[id]/cancel/route';
import { POST as invoiceIssued } from '@/app/api/v1/payments/[id]/invoice-issued/route';
import { GET as latePreview } from '@/app/api/v1/payments/[id]/late-transfer-preview/route';
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
  it('lets an integrator mark an externally issued invoice with payments:write', async () => {
    const request = new NextRequest(`http://localhost/api/v1/payments/${id}/invoice-issued`, { method: 'POST' });
    const response = await invoiceIssued(request, { params: Promise.resolve({ id }) });
    expect(auth).toHaveBeenCalledWith(request, ['payments:write']);
    expect(operate).toHaveBeenCalledWith({}, 'session-actor', id, { action: 'invoice-issued' });
    expect(response.status).toBe(200);
  });
  it('reports an amount rejection as validation error', async () => {
    operate.mockResolvedValue({ success: false, error: 'Amount mismatch' });
    const response = await markPaid(new NextRequest('http://localhost/api/v1/payments/id/mark-paid', { method: 'POST', body: JSON.stringify({ amount: 1 }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400);
  });
  // W254c: the request is valid, it conflicts with the current seat state; the integrator resends with acceptOversold: true.
  it('reports an over-the-limit refusal as 409 CONFLICT naming the refusal', async () => {
    operate.mockResolvedValue({ success: false, error: 'Accepting this order goes over the seat limit', code: 'oversold_confirmation_required' });
    const response = await markPaid(new NextRequest(`http://localhost/api/v1/payments/${id}/mark-paid`, { method: 'POST',
      body: JSON.stringify({ amount: 9400, paidAt: '2026-01-01T00:00:00Z', acceptCancelled: true, reason: 'Late' }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: 'CONFLICT', details: { code: ['oversold_confirmation_required'] } });
  });
  it('keeps other named refusals (e.g. a cancelled order without acceptCancelled) as validation errors', async () => {
    operate.mockResolvedValue({ success: false, error: 'The order is cancelled', code: 'order_cancelled' });
    const response = await markPaid(new NextRequest(`http://localhost/api/v1/payments/${id}/mark-paid`, { method: 'POST',
      body: JSON.stringify({ amount: 9400, paidAt: '2026-01-01T00:00:00Z' }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: 'VALIDATION_ERROR', details: { code: ['order_cancelled'] } });
  });
});

// W254b (owner 15.11): the facts the administrator sees before accepting a late transfer are also available to integrators.
describe('late transfer preview API', () => {
  const facts = { amount: 5000, currency: 'PLN', unitPrice: 50, unitPriceToday: 80, priceChanged: true,
    seats: { remaining: 4, tierRemaining: 0, quantity: 1, oversold: true, started: false }, coupon: null, invoiceCorrected: false };
  const get = (orderId = id) => latePreview(new NextRequest(`http://localhost/api/v1/payments/${orderId}/late-transfer-preview`), { params: Promise.resolve({ id: orderId }) });
  it('requires payments:read and returns the read-only preview', async () => {
    preview.mockResolvedValue(facts);
    const response = await get();
    expect(auth).toHaveBeenCalledWith(expect.any(NextRequest), ['payments:read']);
    expect(preview).toHaveBeenCalledWith({}, id, expect.any(Date));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(facts);
    expect(operate).not.toHaveBeenCalled();
  });
  it('only a cancelled transfer order has a preview', async () => {
    preview.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });
  it('rejects a malformed id before reading anything', async () => {
    expect((await get('not-a-uuid')).status).toBe(400);
    expect(preview).not.toHaveBeenCalled();
  });
});
