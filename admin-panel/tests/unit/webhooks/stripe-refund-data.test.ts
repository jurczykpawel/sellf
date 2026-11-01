/** Stripe refund data and repeat-delivery contract. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyWebhookSignature: vi.fn(), getStripeServer: vi.fn(), createAdminClient: vi.fn(),
  list: vi.fn(), refundRetrieve: vi.fn(), retrieve: vi.fn(), trigger: vi.fn(), lookup: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/stripe/server', () => mocks);
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient, createPlatformClient: vi.fn() }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true,
  RATE_LIMITS: { STRIPE_WEBHOOK: { maxRequests: 100, windowMinutes: 1, actionType: 'stripe_webhook' } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'stripe-signature': 'test' }) }));
vi.mock('@/lib/services/transaction-lookup', () => ({ findTransactionByOrderId: mocks.lookup }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: mocks.trigger } }));
vi.mock('@/lib/services/access-revocation', () => ({ revokeTransactionAccess: async () => ({ warnings: [] }) }));
vi.mock('@/lib/license-keys/revoke', () => ({ revokeLicensesForOrder: async () => ({ rows: [] }) }));
vi.mock('@/lib/services/subscription-refund-cancel', () => ({ scheduleSubscriptionCancelAfterFullRefund: async () => ({ ok: true }) }));

import recordedPayment from '../../fixtures/stripe/dispute_payment_intent_refund.json';
import recordedCharge from '../../fixtures/stripe/charge_refunded_full.json';
import recordedFullCurrent from '../../fixtures/stripe/charge_full_current.json';
import recordedPartialCurrent from '../../fixtures/stripe/charge_partial_current.json';
import recordedRefunds from '../../fixtures/stripe/refund_list_full.json';
import recordedPending from '../../fixtures/stripe/refund_pending.json';
import recordedPendingCurrent from '../../fixtures/stripe/refund_pending_current.json';
import recordedPendingCharge from '../../fixtures/stripe/charge_pending.json';
import recordedFailed from '../../fixtures/stripe/refund_failed_current.json';
import recordedFailedCharge from '../../fixtures/stripe/charge_failed_current.json';
import recordedFailedBeforeCharge from '../../fixtures/stripe/charge_failed.json';
import recordedRefundEvent from '../../fixtures/stripe/refund_updated.json';
import recordedChargeUpdate from '../../fixtures/stripe/async_charge_updated_0.json';
import recordedPartial from '../../fixtures/stripe/charge_refunded_partial.json';
import recordedPartialRefunds from '../../fixtures/stripe/refund_list_partial.json';
import event0 from '../../fixtures/stripe/async_charge_refunded_0.json';
import event1 from '../../fixtures/stripe/async_charge_refunded_1.json';
import event2 from '../../fixtures/stripe/async_refund_created_0.json';
import event3 from '../../fixtures/stripe/async_refund_created_1.json';
import event4 from '../../fixtures/stripe/async_refund_updated_0.json';
import event5 from '../../fixtures/stripe/async_refund_updated_1.json';
import event6 from '../../fixtures/stripe/async_refund_failed_0.json';
import { WEBHOOK_EVENTS } from '@/types/webhooks';
import { WEBHOOK_EVENT_TYPES } from '@/lib/validations/webhook';

import { POST } from '@/app/api/webhooks/stripe/route';

const refund = recordedRefunds.data[0];
const charge = recordedCharge.data.object;
function confirmsFullRefund(payload: { payment: { amount: number }; refund: { stripeRefundId: string | null; status: string | null; isFullRefund: boolean; totalRefunded: number } }): boolean {
  return !!payload.refund.stripeRefundId && payload.refund.status === 'succeeded'
    && payload.payment.amount > 0 && payload.refund.isFullRefund
    && payload.refund.totalRefunded >= payload.payment.amount;
}
let transaction: Record<string, unknown>;
interface Observation { status: string; previous_status: string | null; refund_version: number; notified_version: number }
let observations = new Map<string, Observation[]>();
async function deliver(type = 'charge.refunded', object: unknown = charge) {
  const id = (object as { id?: string })?.id;
  const events = [recordedCharge, recordedPartial, recordedChargeUpdate, recordedRefundEvent,
    event0, event1, event2, event3, event4, event5, event6];
  const event = events.find(item => item.type === type && item.data.object.id === id)
    ?? events.find(item => item.data.object.id === id);
  if (!event) throw new Error('A recorded event envelope is required');
  mocks.verifyWebhookSignature.mockResolvedValue({ ...event, type, data: { ...event.data, object } });
  return POST(new NextRequest('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  observations = new Map();
  transaction = { id: 'tx', product_id: 'prod', user_id: null, customer_email: 'test@example.com',
    status: 'completed', amount: charge.amount, currency: charge.currency, refunded_amount: 0, refund_id: null, refund_status: null };
  mocks.lookup.mockImplementation(async () => ({ ...transaction }));
  mocks.list.mockResolvedValue({ data: [refund] });
  mocks.retrieve.mockImplementation(async (id) => {
    const value = [recordedFullCurrent, recordedPartialCurrent, recordedPendingCharge, recordedFailedCharge].find(item => item.id === id);
    if (!value) throw new Error('No recorded charge for this ID');
    return value;
  });
  mocks.refundRetrieve.mockResolvedValue(refund);
  mocks.getStripeServer.mockResolvedValue({ refunds: { list: mocks.list, retrieve: mocks.refundRetrieve }, charges: { retrieve: mocks.retrieve }, paymentIntents: { retrieve: async () => recordedPayment }, checkout: { sessions: { list: async () => ({ data: [] }) } } });
  mocks.trigger.mockResolvedValue(undefined);
  mocks.update.mockImplementation((values) => {
    const commit = () => { Object.assign(transaction, values); return { data: [{ id: transaction.id }], error: null }; };
    const chain = { eq: () => chain, is: () => chain, select: async () => commit(),
      then: (resolve: (value: unknown) => unknown) => resolve(commit()) };
    return chain;
  });
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }) };
  mocks.createAdminClient.mockReturnValue({ from: () => ({ ...query, update: mocks.update }),
    rpc: async (name: string, args: Record<string, any>) => {
      const history = observations.get(args.p_refund_id) ?? [];
      if (name === 'confirm_refund_notification') {
        history.find(row => row.refund_version === args.p_version)!.notified_version = args.p_version;
        return { error: null };
      }
      let state = history.at(-1);
      if (!state) {
        state = { status: args.p_initial_status ?? args.p_status, previous_status: null, refund_version: 1, notified_version: 0 };
        history.push(state); observations.set(args.p_refund_id, history);
      }
      if (state.status !== args.p_status) {
        state = { status: args.p_status, previous_status: state.status, refund_version: state.refund_version + 1, notified_version: 0 };
        history.push(state);
      }
      const pendingStates = history.filter(row => row.notified_version < row.refund_version);
      return { data: (pendingStates.length ? pendingStates : [state]).map(row => ({ ...row, refund_status: row.status })), error: null };
    },
  });
});

describe('Stripe refund authoritative data', () => {
  it.each(['charge.refunded', 'charge.updated'])('loads missing refunds for %s and persists processor status @J34', async (type) => {
    expect((await deliver(type)).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ charge: charge.id }));
    expect(transaction).toMatchObject({ refund_id: refund.id, refund_status: 'succeeded', refunded_amount: charge.amount_refunded });
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(true);
    expect(mocks.trigger).toHaveBeenCalledWith('refund.issued', expect.objectContaining({
      refund: expect.objectContaining({ stripeRefundId: refund.id, status: 'succeeded', amount: charge.amount_refunded }),
    }), expect.anything(), 'prod');
  });
  it('publishes one issuance and one separate update for a pending refund @J34', async () => {
    mocks.list.mockResolvedValue({ data: [recordedPendingCurrent] });
    mocks.list.mockResolvedValueOnce({ data: [recordedPending] });
    await deliver('charge.refunded', recordedPendingCharge);
    expect(transaction.refund_status).toBe('pending');
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(false);
    await deliver('charge.refunded', recordedPendingCharge);
    expect(confirmsFullRefund(mocks.trigger.mock.calls[1][1])).toBe(true);
    expect(mocks.trigger).toHaveBeenCalledTimes(2);
    expect(mocks.trigger.mock.calls[1][0]).toBe('refund.updated');
    expect(mocks.trigger.mock.calls[1][1].refund).toMatchObject({ status: 'succeeded', previousStatus: 'pending', amount: recordedPending.amount, totalRefunded: recordedPendingCharge.amount_refunded });
    await deliver('charge.refunded', recordedPendingCharge);
    expect(mocks.trigger).toHaveBeenCalledTimes(2);
  });
  it('preserves a recorded pending creation and emits a separate update when already succeeded by delivery time @J34', async () => {
    mocks.refundRetrieve.mockResolvedValue(recordedPendingCurrent);
    mocks.retrieve.mockResolvedValue(recordedPendingCharge);
    await deliver('refund.created', recordedPending);
    expect(mocks.trigger.mock.calls.map(call => call[0])).toEqual(['refund.issued', 'refund.updated']);
    expect(mocks.trigger.mock.calls[0][1].refund).toMatchObject({ status: 'pending', amount: recordedPending.amount, statusVersion: 1 });
    expect(mocks.trigger.mock.calls[1][1].refund).toMatchObject({ previousStatus: 'pending', status: 'succeeded', amount: recordedPending.amount, statusVersion: 2 });
    await deliver('refund.created', recordedPending);
    expect(mocks.trigger).toHaveBeenCalledTimes(2);
  });
  it('loads the processor refund when the optional expanded refund list is empty @J34', async () => {
    await deliver('charge.refunded', { ...charge, refunds: { data: [] } });
    expect(mocks.list).toHaveBeenCalledWith({ charge: charge.id, created: { lte: recordedCharge.created }, limit: 1 });
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(true);
  });
  it('keeps payment state unchanged when the processor has not returned a refund yet @J34', async () => {
    mocks.list.mockResolvedValue({ data: [] });
    expect((await deliver()).status).toBe(500);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
  it('keeps an actual failed refund unconfirmed for the receiver @J34', async () => {
    mocks.retrieve.mockResolvedValue(recordedFailedCharge);
    mocks.refundRetrieve.mockResolvedValue(recordedFailed);
    transaction.status = 'refunded';
    transaction.refund_id = recordedFailed.id;
    transaction.refund_status = 'succeeded';
    transaction.refunded_amount = recordedFailed.amount;
    await deliver('refund.failed', recordedFailed);
    expect(transaction.refund_status).toBe('failed');
    expect(transaction.refunded_amount).toBe(0);
    expect(mocks.trigger.mock.calls[0][1].refund).toMatchObject({ amount: recordedFailed.amount, totalRefunded: 0 });
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(false);
  });
  it('uses the refund named by refund.updated without resolving another refund @J34', async () => {
    await deliver(recordedRefundEvent.type, recordedRefundEvent.data.object);
    expect(transaction).toMatchObject({ refund_id: recordedRefundEvent.data.object.id, refund_status: recordedRefundEvent.data.object.status });
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(true);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('recovers an omitted expandable charge from the authoritative refund read @J34', async () => {
    const missingCharge = { ...recordedRefundEvent.data.object };
    Reflect.deleteProperty(missingCharge, 'charge');
    await deliver(recordedRefundEvent.type, missingCharge);
    expect(mocks.refundRetrieve).toHaveBeenCalledWith(missingCharge.id);
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(true);
  });
  it('reads the current refund by ID when an older succeeded event arrives after failure @J34', async () => {
    mocks.retrieve.mockResolvedValue(recordedFailedCharge);
    mocks.refundRetrieve.mockResolvedValue(recordedFailed);
    await deliver('refund.updated', { ...recordedFailed, status: 'succeeded' });
    expect(mocks.refundRetrieve).toHaveBeenCalledWith(recordedFailed.id);
    expect(transaction.refund_status).toBe('failed');
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(false);
  });
  it('does not restore a stale refunded total when an older charge event follows a failed refund @J34', async () => {
    mocks.retrieve.mockResolvedValue(recordedFailedCharge);
    mocks.list.mockResolvedValue({ data: [recordedFailed] });
    transaction.status = 'refunded'; transaction.refunded_amount = recordedFailed.amount;
    await deliver('charge.refunded', recordedFailedBeforeCharge);
    expect(transaction).toMatchObject({ refund_status: 'failed', refunded_amount: 0, status: 'completed' });
  });
  it('retries a competing refund update without sending a stale second notification @J34', async () => {
    const lost = { eq: () => lost, is: () => lost, select: async () => ({ data: [], error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }) };
    mocks.update.mockReturnValue(lost);
    expect((await deliver()).status).toBe(500);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
  it('retries an unavailable Stripe read without writing an unconfirmed refund @J34', async () => {
    mocks.list.mockRejectedValue(new Error('Stripe unavailable'));
    expect((await deliver()).status).toBe(500);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('ignores charge updates without any refund activity @J34', async () => {
    await deliver('charge.updated', { ...charge, amount_refunded: 0 });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
});

describe('recorded refund variants', () => {
  it('keeps a partial refund from turning off full paid access @J34', async () => {
    mocks.list.mockResolvedValue(recordedPartialRefunds);
    await deliver(recordedPartial.type, recordedPartial.data.object);
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(false);
    expect(transaction.status).toBe('partially_refunded');
    expect(mocks.trigger.mock.calls[0][1].payment.statusAfter).toBe('partially_refunded');
    expect(mocks.trigger.mock.calls[0][1].refund).toMatchObject({ status: 'succeeded',
      amount: recordedPartial.data.object.amount_refunded, isFullRefund: false });
  });
  it('handles a genuine charge.updated event with its optional refunds absent @J34', async () => {
    mocks.list.mockResolvedValue({ data: [recordedPending] });
    await deliver(recordedChargeUpdate.type, recordedChargeUpdate.data.object);
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(false);
    expect(transaction.refund_status).toBe('pending');
  });
  it('recovers the optional payment intent from the authoritative charge read @J34', async () => {
    const missingIntent = { ...charge, payment_intent: undefined };
    expect((await deliver('charge.refunded', missingIntent)).status).toBe(200);
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(true);
  });
  it('waits for a pending payment before recording its refund @J34', async () => {
    transaction.status='pending';
    expect((await deliver()).status).toBe(500);expect(mocks.trigger).not.toHaveBeenCalled();
  });
  it('resolves a refund whose optional charge is absent through its payment intent @J34', async () => {
    mocks.refundRetrieve.mockResolvedValue({ ...refund, charge: undefined });
    mocks.retrieve.mockResolvedValue(recordedFullCurrent);
    expect((await deliver('refund.updated',recordedRefundEvent.data.object)).status).toBe(200);
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(true);
  });
  it('resolves the refund payment binding when the charge intent is absent @J34', async () => {
    mocks.retrieve.mockResolvedValue({ ...recordedFullCurrent, payment_intent: null });
    expect((await deliver()).status).toBe(200);
    expect(confirmsFullRefund(mocks.trigger.mock.calls[0][1])).toBe(true);
  });
});


describe('dispute event subscriptions', () => {
  it.each(['dispute.created', 'dispute.closed'])('is selectable and API-valid: %s @J34', (event) => {
    expect(WEBHOOK_EVENTS.some(item => item.value === event)).toBe(true);
    expect(WEBHOOK_EVENT_TYPES).toContain(event);
  });
});
