/**
 * BEHAVIORAL: several Sellf installations share one Stripe account. Drives the REAL webhook POST
 * against the REAL local Supabase (completion RPC, products, payment_transactions). Only the
 * boundary is mocked: signature header, signature verification (returns the recorded payload),
 * Stripe client shim, rate limit, conversion tracking, outbound webhooks.
 *
 * Events are built from the recorded test-mode payloads in tests/fixtures/stripe.
 *
 * @see src/app/api/webhooks/stripe/instance-gate.ts
 * @see src/lib/stripe/instance-marker.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { deleteChecked } from '../../helpers/db-cleanup';
import checkoutFixture from '../../fixtures/stripe/checkout_completed_receiver.json';
import invoiceFixture from '../../fixtures/stripe/invoice_paid_cycle.json';

type AdminFactory = typeof import('@/lib/supabase/admin').createAdminClient;
const h = vi.hoisted(() => ({ stripe: null as unknown as Stripe, admin: null as null | ((real: AdminFactory) => unknown) }));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: (k: string) => (k === 'stripe-signature' ? 'test_sig' : null) })) }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn, unstable_noStore: vi.fn() }));
vi.mock('@/lib/stripe/server', () => ({
  verifyWebhookSignature: vi.fn(async (body: string) => JSON.parse(body)),
  getStripeServer: vi.fn(async () => h.stripe),
}));
vi.mock('@/lib/rate-limiting', async (orig) => ({ ...(await orig<typeof import('@/lib/rate-limiting')>()), checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/tracking', async (orig) => ({ ...(await orig<typeof import('@/lib/tracking')>()), trackServerSideConversion: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/admin', async (orig) => {
  const actual = await orig<typeof import('@/lib/supabase/admin')>();
  return { ...actual, createAdminClient: vi.fn(() => (h.admin ? h.admin(actual.createAdminClient) : actual.createAdminClient())) };
});
vi.mock('@/lib/services/product-validation', () => ({ ProductValidationService: { validateEmail: vi.fn(async () => true) } }));

import { POST } from '@/app/api/webhooks/stripe/route';
import { WebhookService } from '@/lib/services/webhook-service';
import { getStripeInstanceId, STRIPE_INSTANCE_METADATA_KEY } from '@/lib/stripe/instance-marker';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const hasSupabase = !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
const db = hasSupabase ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

const productIds: string[] = [];
const emails: string[] = [];
let ours = '';
let seq = 0;
const uniq = (p: string) => `${p}_${Date.now()}_${++seq}_${Math.random().toString(36).slice(2, 7)}`;
const FOREIGN = 'f'.repeat(32);

beforeAll(async () => { if (hasSupabase) ours = await getStripeInstanceId(); });
afterAll(async () => {
  if (!db) return;
  if (emails.length) await deleteChecked('guest_purchases', db.from('guest_purchases').delete().in('customer_email', emails));
  if (productIds.length) {
    await deleteChecked('payment_line_items', db.from('payment_line_items').delete().in('product_id', productIds));
    await deleteChecked('payment_transactions', db.from('payment_transactions').delete().in('product_id', productIds));
    await deleteChecked('products', db.from('products').delete().in('id', productIds));
  }
});

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  h.admin = null;
  h.stripe = {
    checkout: { sessions: { listLineItems: vi.fn(async () => ({ data: [] })), retrieve: vi.fn(async () => ({ id: 'cs_shim', amount_total: 4999, amount_subtotal: 4999, currency: 'usd', total_details: { amount_tax: 0 }, automatic_tax: { enabled: false } })), list: vi.fn(async () => ({ data: [] })) } },
  } as unknown as Stripe;
  vi.spyOn(WebhookService, 'trigger').mockImplementation(async () => {});
  logSpy = vi.spyOn(console, 'log');
  if (db) await db.from('rate_limits').delete().like('function_name', '%process_stripe_payment_completion');
});
afterEach(() => vi.restoreAllMocks());

async function createProduct(): Promise<string> {
  const { data, error } = await db!.from('products')
    .insert({ slug: uniq('im'), name: 'Instance marker product', price: 49.99, currency: 'usd', is_active: true })
    .select('id').single();
  if (error || !data) throw new Error(`createProduct failed: ${error?.message}`);
  productIds.push(data.id);
  return data.id;
}

function sessionEvent(metadata: Record<string, string>) {
  const event = structuredClone(checkoutFixture) as unknown as { id: string; data: { object: Record<string, unknown> } };
  const email = `${uniq('buyer')}@example.com`;
  emails.push(email);
  event.id = uniq('evt');
  Object.assign(event.data.object, { id: uniq('cs'), payment_intent: uniq('pi'), metadata, customer_details: { ...(event.data.object.customer_details as object), email } });
  return event;
}

async function post(event: unknown): Promise<number> {
  const res = await POST(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: JSON.stringify(event) }) as never);
  return res.status;
}

async function txCount(sessionId: string): Promise<number> {
  const { count, error } = await db!.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('session_id', sessionId);
  if (error) throw error;
  return count ?? 0;
}

describe.skipIf(!hasSupabase)('Stripe webhook — shared Stripe account (instance marker)', () => {
  it('foreign marker on an existing product → 200, nothing saved, logged as foreign', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN });
    expect(await post(event)).toBe(200);
    expect(await txCount(event.data.object.id as string)).toBe(0);
    expect(logSpy.mock.calls.flat().join(' ')).toContain('foreign instance, skipped');
  });

  it('foreign marker on a subscription invoice (parent.subscription_details) → 200 without touching Stripe', async () => {
    const event = structuredClone(invoiceFixture) as unknown as { data: { object: { parent: { subscription_details: { metadata: Record<string, string> } } } } };
    event.data.object.parent.subscription_details.metadata = { [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN };
    h.stripe = {} as Stripe; // any Stripe call would throw
    expect(await post(event)).toBe(200);
    expect(logSpy.mock.calls.flat().join(' ')).toContain('foreign instance, skipped');
  });

  it('no marker + product unknown here (old session from another installation) → 200, skipped', async () => {
    const event = sessionEvent({ product_id: crypto.randomUUID() });
    expect(await post(event)).toBe(200);
    expect(await txCount(event.data.object.id as string)).toBe(0);
  });

  it('no marker + non-UUID product id → 200, skipped', async () => {
    expect(await post(sessionEvent({ product_id: 'not-a-uuid' }))).toBe(200);
  });

  it('our marker → payment processed', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    expect(await post(event)).toBe(200);
    const { data } = await db!.from('payment_transactions').select('status').eq('session_id', event.data.object.id as string).single();
    expect(data?.status).toBe('completed');
  });

  it('no marker + our product (session from before this release) → payment processed', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId });
    expect(await post(event)).toBe(200);
    expect(await txCount(event.data.object.id as string)).toBe(1);
  });

  it('our marker + database failure → 500 so Stripe redelivers', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    h.admin = (realFactory) => {
      const real = realFactory();
      return Object.assign(Object.create(real), { rpc: vi.fn(async () => ({ data: null, error: { message: 'connection reset', code: '08006' } })) });
    };
    expect(await post(event)).toBe(500);
  });

  it('no marker + database failure while checking the product → 500 (not silently skipped)', async () => {
    const event = sessionEvent({ product_id: crypto.randomUUID() });
    h.admin = () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }),
      rpc: vi.fn(),
    });
    expect(await post(event)).toBe(500);
  });
});
