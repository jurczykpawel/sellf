import { beforeEach, expect, it, vi } from 'vitest';
import { fulfillPaidOrder } from '@/lib/services/fulfill-paid-order';
import { deriveOrderId } from '@/lib/services/webhook-service';
import type Stripe from 'stripe';

const mocks = vi.hoisted(() => ({ licenses: vi.fn(), trigger: vi.fn(), capture: vi.fn(), dispute: vi.fn(), order: [] as string[] }));
vi.mock('@/app/api/webhooks/stripe/dispute-handlers', () => ({ handleChargeDispute: mocks.dispute }));
vi.mock('@/lib/services/bundle-order', () => ({
  resolveComponentProductIds: vi.fn(async () => []), issueLicensesForOrder: mocks.licenses,
}));
vi.mock('@/lib/services/tax-snapshot', () => ({ captureAndPersistOrderTax: mocks.capture }));
vi.mock('@/lib/services/webhook-service', async original => ({
  ...await original<typeof import('@/lib/services/webhook-service')>(),
  WebhookService: { trigger: mocks.trigger },
}));
const tx = { id: 'tx-order', order_number: 1001, session_id: 'cs_order', customer_email: 'buyer@example.test', user_id: null, metadata: {}, custom_field_values: {}, fulfillment_pending: true };
const line = { product_id: 'product', item_type: 'main_product', discounted_total: 123, currency: 'PLN', vat_rate: 23, tax_behavior: 'inclusive', vat_exempt: false, net_amount: 10000, tax_amount: 2300 };
const product = { id: 'product', name: 'Course', slug: 'course', price: 123, currency: 'PLN', icon: null };
function client() {
  return { from: (table: string) => {
    const q = {
      select: () => q, eq: () => q, update: vi.fn(() => q),
      single: async () => ({ data: table === 'products' ? product : tx, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: table === 'payment_line_items' ? [line] : null, error: null }),
    };
    return q;
  }};
}
const common = () => ({ supabase: client() as never, transactionId: tx.id, productId: 'product', customerEmail: tx.customer_email, amount: 12300, currency: 'PLN', isGuest: true });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.licenses.mockResolvedValue([]);
  mocks.capture.mockResolvedValue(undefined);
});

it.each(['pi_order', null])('identifies the saved order and explicit minor-unit values for %s', async paymentIntentId => {
  await fulfillPaidOrder({ ...common(), stripe: {} as Stripe, sessionId: 'cs_order', paymentIntentId });
  const payload = mocks.trigger.mock.calls[0][1];
  expect(payload).toMatchObject({ amountUnit: 'minor', customer: { email: tx.customer_email }, product: { price: 12300, net: null, tax: null }, order: { orderId: tx.id, orderNumber: 1001, amount: 12300, grossTotal: 12300, taxSnapshotStatus: 'unavailable', sessionId: 'cs_order', paymentIntentId } });
  expect(mocks.licenses.mock.calls[0][1].orderId).toBe(paymentIntentId ?? 'cs_order');
});

it('fulfills offline from saved rows using the transaction delivery and license key', async () => {
  mocks.capture.mockImplementation(() => { throw new Error('Stripe must not be used'); });
  await fulfillPaidOrder({ ...common(), provider: { kind: 'offline' } });
  expect(mocks.capture).not.toHaveBeenCalled();
  const payload = mocks.trigger.mock.calls[0][1];
  expect(payload.order).toMatchObject({ orderId: 'tx-order', orderNumber: 1001, netTotal: 10000, taxTotal: 2300 });
  expect(payload.order.sessionId).toBeUndefined();
  expect(deriveOrderId(payload)).toBe('tx-order');
  expect(mocks.licenses.mock.calls[0][1].orderId).toBe('tx-order');
});

it('keeps the saved offline exemption when product settings change', async () => {
  const saved = { ...line };
  try {
    Object.assign(line, { vat_exempt: true, net_amount: 12300, tax_amount: 0 });
    await fulfillPaidOrder({ ...common(), provider: { kind: 'offline' } });
    expect(mocks.trigger.mock.calls[0][1].product.vatExempt).toBe(true);
  } finally {
    Object.assign(line, saved);
  }
});

it.each(['stripe', 'offline'] as const)('passes stored profile details to the %s purchase webhook', async kind => {
  const details = { buyer: { v: 1, type: 'organization', company_name: 'Gmina Przykładowa', needs_invoice: true }, quantity: { v: 1, value: 5 } };
  const db = client();
  const originalFrom = db.from;
  db.from = (table: string) => {
    const q = originalFrom(table);
    q.single = async () => ({ data: table === 'products' ? { ...product, checkout_profile: { v: 1, modules: [] } } : { ...tx, order_details: details }, error: null });
    return q;
  };
  const args = { ...common(), supabase: db as never };
  await fulfillPaidOrder(kind === 'offline' ? { ...args, provider: { kind: 'offline' } } : { ...args, stripe: {} as Stripe, sessionId: tx.session_id, paymentIntentId: 'pi_order' });
  expect(mocks.trigger.mock.calls[0][1].orderDetails).toMatchObject(details);
  expect(mocks.trigger.mock.calls[0][1].invoice.companyName).toBe('Gmina Przykładowa');
});

it('applies a dispute Stripe opened before the payment was stored, before issuing licenses @J191', async () => {
  mocks.dispute.mockImplementation(async () => { mocks.order.push('dispute'); return { processed: true, message: 'ok' }; });
  mocks.licenses.mockImplementation(async () => { mocks.order.push('licenses'); return []; });
  const dispute = { id: 'dp_early', status: 'needs_response' };
  const list = vi.fn(async () => ({ data: [dispute] }));
  await fulfillPaidOrder({ ...common(), stripe: { disputes: { list } } as unknown as Stripe, sessionId: 'cs_order', paymentIntentId: 'pi_order' });
  expect(list).toHaveBeenCalledWith({ payment_intent: 'pi_order', limit: 10 });
  expect(mocks.dispute).toHaveBeenCalledWith(dispute, expect.anything(), expect.anything(), false);
  expect(mocks.order).toEqual(['dispute', 'licenses']);
});
