/** Provider-generated test events for receiver contract checks. */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import Stripe from 'stripe';
import type { Event } from 'stripe';

export function testStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) throw new Error('A Stripe test-mode key is required');
  return new Stripe(key);
}
export async function recordedEvent(type: string, matches: (event: Event) => boolean, since: number): Promise<Event> {
  const stripe = testStripe();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const events = await stripe.events.list({ type, created: { gte: since }, limit: 100 });
    const event = events.data.find(matches);
    if (event) return event;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Stripe did not publish the expected ${type} event`);
}
export function saveStripeRecording(name: string, event: Event): void {
  if (process.env.RECORD_STRIPE_FIXTURES !== '1') return;
  const ids = new Map<string, string>();
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['client_secret', 'fingerprint', 'receipt_url', 'url', 'hosted_invoice_url', 'invoice_pdf', 'name', 'address', 'phone'].includes(key)).map(([key, item]) => [key, typeof item === 'string' && (key.includes('name') || key.includes('descriptor')) ? 'Recorded fixture' : clean(item)]));
    if (typeof value === 'string') {
      if (value.includes('@')) return 'recorded-buyer@example.com';
      return value.replace(/\b(?:cs_test|pi|ch|re|evt|cus|prod|price|req|pm|txn)_[A-Za-z0-9]+\b/g, id => {
        if (!ids.has(id)) ids.set(id, id.split('_')[0] + '_recorded_' + ids.size);
        return ids.get(id)!;
      });
    }
    return value;
  };
  mkdirSync('tests/fixtures/stripe', { recursive: true });
  writeFileSync(`tests/fixtures/stripe/${name}.json`, JSON.stringify(clean(event), null, 2) + '\n');
}
export async function paidCheckoutEvent(productId: string, email: string, amount = 4999): Promise<Event> {
  const since = Math.floor(Date.now() / 1000) - 1;
  const result = spawnSync('stripe', ['trigger', 'checkout.session.completed',
    '--override', `price:unit_amount=${amount}`, '--remove', 'checkout_session:line_items',
    '--add', 'checkout_session:line_items[0][price]=${price:id}', '--add', 'checkout_session:line_items[0][quantity]=1',
    '--override', `payment_page_confirm:expected_amount=${amount}`,
    '--override', `payment_method:billing_details.email=${email}`, '--override', 'payment_method:billing_details.name=Stripe Tester',
    '--add', `product:metadata.test_run=${productId}`, '--add', `price:metadata.test_run=${productId}`,
    '--add', `checkout_session:metadata.product_id=${productId}`,
    '--add', 'checkout_session:metadata.first_name=Stripe', '--add', 'checkout_session:metadata.last_name=Tester',
  ], { env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY }, encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).replace(/(?:sk|pk|rk)_(?:test|live)_[\w]+|whsec_[\w]+/g, '[redacted]'));
  const event = await recordedEvent('checkout.session.completed', item => (item.data.object as Stripe.Checkout.Session).metadata?.product_id === productId, since);
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.amount_total !== amount || session.customer_details?.email !== email) {
    await clearPaidCheckout(session.id);
    throw new Error('Provider fixture does not match the requested buyer and amount');
  }
  return event;
}
export async function paidIntent(amount: number, currency: string, email: string): Promise<Stripe.PaymentIntent> {
  return testStripe().paymentIntents.create({ amount, currency, payment_method: 'pm_card_visa', confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, receipt_email: email,
    metadata: { test_run: randomUUID() } });
}
export async function refundEvent(paymentIntentId: string, amount: number, total: number): Promise<{ event: Event; refund: Stripe.Refund }> {
  const stripe = testStripe(), since = Math.floor(Date.now() / 1000) - 1;
  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId, amount, reason: 'requested_by_customer' });
  const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
  const event = await recordedEvent('charge.refunded', e => { const charge = e.data.object as Stripe.Charge; return charge.id === chargeId && charge.amount_refunded === total; }, since);
  return { event, refund };
}
export async function clearPaidIntent(paymentIntentId: string): Promise<void> {
  const stripe = testStripe();
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const charge = pi.latest_charge as Stripe.Charge | null;
  if (charge && charge.amount_refunded < charge.amount) await stripe.refunds.create({ payment_intent: paymentIntentId, amount: charge.amount - charge.amount_refunded }, { idempotencyKey: 'cleanup-' + paymentIntentId });
}

export async function clearPaidCheckout(sessionId: string): Promise<void> {
  const stripe = testStripe(), session = await stripe.checkout.sessions.retrieve(sessionId);
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (pi) await clearPaidIntent(pi);
  const lines = await stripe.checkout.sessions.listLineItems(sessionId);
  for (const line of lines.data) {
    if (line.price) await stripe.prices.update(line.price.id, { active: false });
    const product = line.price?.product;
    if (product) await stripe.products.update(typeof product === 'string' ? product : product.id, { active: false });
  }
  if (session.customer) await stripe.customers.del(typeof session.customer === 'string' ? session.customer : session.customer.id);
}
