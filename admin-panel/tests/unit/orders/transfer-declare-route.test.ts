/** Buyer "I have sent the transfer": only the signed order link may declare, once, and the integrator hears about it. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const rpc = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock('@/lib/orders/bank-transfer-service', () => ({ dispatchTransferEvent: dispatch }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: limit }));
import { POST } from '@/app/api/orders/bank-transfer/declare/route';
import { signTransferToken } from '@/lib/orders/transfer-token';
const id = '10000000-0000-4000-8000-000000000001';
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/orders/bank-transfer/declare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('CHECKOUT_BINDING_SECRET', 'test-binding-secret'); limit.mockResolvedValue(true); dispatch.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: { success: true, already_declared: false, releaseAt: '2026-02-06T12:00:00.000Z', declaredAt: '2026-02-03T12:00:00.000Z' }, error: null });
});
describe('transfer declaration', () => {
  it('rejects a forged or foreign link without touching the order', async () => {
    expect((await post({ orderId: id, token: '1.bad' })).status).toBe(404);
    expect((await post({ orderId: '10000000-0000-4000-8000-000000000002', token: signTransferToken(id) })).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('declares with the server clock, extends the hold and emits order.transfer_declared', async () => {
    const response = await post({ orderId: id, token: signTransferToken(id), note: 'Przelew z konta firmowego' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ declaredAt: '2026-02-03T12:00:00.000Z', releaseAt: '2026-02-06T12:00:00.000Z' });
    expect(rpc).toHaveBeenCalledWith('declare_transfer', { p_id: id, p_note: 'Przelew z konta firmowego', p_now: expect.any(String) });
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), id, 'order.transfer_declared');
  });
  it('a repeated click does not emit a second event', async () => {
    rpc.mockResolvedValue({ data: { success: true, already_declared: true, releaseAt: null, declaredAt: '2026-02-03T12:00:00.000Z' }, error: null });
    expect((await post({ orderId: id, token: signTransferToken(id) })).status).toBe(200);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('refuses an order that is no longer unpaid and limits requests', async () => {
    rpc.mockResolvedValue({ data: { success: false, error: 'not_awaiting_payment' }, error: null });
    expect((await post({ orderId: id, token: signTransferToken(id) })).status).toBe(409);
    limit.mockResolvedValue(false);
    expect((await post({ orderId: id, token: signTransferToken(id) })).status).toBe(429);
  });
  it('rejects a note longer than 200 characters', async () => {
    expect((await post({ orderId: id, token: signTransferToken(id), note: 'x'.repeat(201) })).status).toBe(400);
  });
});
