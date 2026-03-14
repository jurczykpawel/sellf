import { test, expect } from '@playwright/test';
import { supabaseAdmin, loginAsAdmin, createTestAdmin, getAdminBearerToken } from './helpers/admin-auth';
import crypto from 'crypto';

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

test.describe('Webhook Dispatch System', () => {
  test.describe.configure({ mode: 'serial' }); // Run serially to avoid webhook broadcast collisions

  // Test Data
  const TEST_URL = 'https://example.com/test-hook';
  let freeProductId: string;
  let freeProductSlug: string;
  let paidProductId: string;
  let paidProductSlug: string;

  // Cleanup stack
  const cleanupIds: { table: string, id: string }[] = [];

  // Helper to register cleanup
  const registerCleanup = (table: string, id: string) => {
    cleanupIds.push({ table, id });
  };

  test.beforeAll(async () => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);

    // 1. Create Free Product (for lead.captured and waitlist)
    const freeSlug = `webhook-free-${timestamp}-${random}`;
    const { data: freeProduct, error: freeError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Webhook Free Product',
        slug: freeSlug,
        price: 0,
        currency: 'USD',
        is_active: true,
        enable_waitlist: true,
        description: 'Free test product',
        vat_rate: 23,
        price_includes_vat: true
      })
      .select()
      .single();

    if (freeError) throw freeError;
    freeProductId = freeProduct.id;
    freeProductSlug = freeProduct.slug;
    registerCleanup('products', freeProductId);

    // 2. Create Paid Product (for purchase.completed)
    const paidSlug = `webhook-paid-${timestamp}-${random}`;
    const { data: paidProduct, error: paidError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Webhook Paid Product',
        slug: paidSlug,
        price: 49.99,
        currency: 'USD',
        is_active: true,
        enable_waitlist: true,
        description: 'Paid test product',
        vat_rate: 23,
        price_includes_vat: true
      })
      .select()
      .single();

    if (paidError) throw paidError;
    paidProductId = paidProduct.id;
    paidProductSlug = paidProduct.slug;
    registerCleanup('products', paidProductId);
  });

  test.afterAll(async () => {
    // Delete in reverse order
    for (const item of cleanupIds.reverse()) {
        if (item.table === 'users') {
             await supabaseAdmin.auth.admin.deleteUser(item.id);
        } else {
             await supabaseAdmin.from(item.table).delete().eq('id', item.id);
        }
    }
  });

  async function createWebhook(events: string[], isActive: boolean = true) {
    const { data, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: TEST_URL,
        events,
        is_active: isActive,
        secret: 'whsec_test'
      })
      .select()
      .single();
    
    if (error) throw error;
    registerCleanup('webhook_endpoints', data.id);
    return data;
  }

  async function getRecentLogs(endpointId: string, limit: number = 1) {
    // Wait a bit for async processing
    await new Promise(r => setTimeout(r, 2000));
    
    const { data, error } = await supabaseAdmin
      .from('webhook_logs')
      .select('*')
      .eq('endpoint_id', endpointId)
      .order('created_at', { ascending: false })
      .limit(limit);
      
    if (error) throw error;
    return data;
  }

  test('waitlist.signup: should send correct payload (free product)', async ({ request }) => {
    const webhook = await createWebhook(['waitlist.signup']);
    
    // Trigger signup
    const signupEmail = `waitlist-free-${Date.now()}@example.com`;
    const response = await request.post('/api/waitlist/signup', {
      data: {
        email: signupEmail,
        productId: freeProductId
      }
    });
    expect(response.status()).toBe(200);

    // Verify Log
    const logs = await getRecentLogs(webhook.id);
    expect(logs.length).toBe(1);
    const payload = typeof logs[0].payload === 'string' ? JSON.parse(logs[0].payload) : logs[0].payload;
    
    expect(payload.event).toBe('waitlist.signup');
    expect(payload.data.customer.email).toBe(signupEmail);
    expect(payload.data.product.id).toBe(freeProductId);
    expect(payload.data.product.price).toBe(0);
    expect(payload.data.signed_up_at).toBeUndefined();
  });

  test('waitlist.signup: should send correct payload (paid product)', async ({ request }) => {
    const webhook = await createWebhook(['waitlist.signup']);
    
    // Trigger signup for paid product
    const signupEmail = `waitlist-paid-${Date.now()}@example.com`;
    const response = await request.post('/api/waitlist/signup', {
      data: {
        email: signupEmail,
        productId: paidProductId
      }
    });
    expect(response.status()).toBe(200);

    // Verify Log
    const logs = await getRecentLogs(webhook.id);
    expect(logs.length).toBe(1);
    const payload = typeof logs[0].payload === 'string' ? JSON.parse(logs[0].payload) : logs[0].payload;
    
    expect(payload.event).toBe('waitlist.signup');
    expect(payload.data.customer.email).toBe(signupEmail);
    expect(payload.data.product.id).toBe(paidProductId);
    expect(payload.data.product.price).toBe(49.99);
    expect(payload.data.signed_up_at).toBeUndefined();
  });

  test('lead.captured: should send correct payload without duplicate timestamp', async ({ page }) => {
    const webhook = await createWebhook(['lead.captured']);

    // Create a temporary admin user to login with
    const { email, password, cleanup } = await createTestAdmin('webhook-tester');
    
    try {
      await loginAsAdmin(page, email, password);
      
      // Use page.request which shares the auth cookie
      const response = await page.request.post(`/api/public/products/${freeProductSlug}/grant-access`);
      
      expect(response.status()).toBe(200);

      // Verify Log
      const logs = await getRecentLogs(webhook.id);
      expect(logs.length).toBe(1);
      const log = logs[0];
      
      const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
      
      expect(payload.event).toBe('lead.captured');
      expect(payload.timestamp).toBeDefined();
      
      // Check Data
      expect(payload.data).toBeDefined();
      // Verify NO duplicate timestamp inside data
      expect(payload.data.timestamp).toBeUndefined();
      
      expect(payload.data.customer).toBeDefined();
      expect(payload.data.customer.email).toBe(email); // Should match the logged in user
      
      expect(payload.data.product).toBeDefined();
      expect(payload.data.product.id).toBe(freeProductId);
      expect(payload.data.product.currency).toBe('USD');
    } finally {
      await cleanup();
    }
  });

  test('purchase.completed: should send correct payload via Stripe webhook trigger', async ({ request }) => {
    test.skip(!STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET environment variable is not set');

    const webhook = await createWebhook(['purchase.completed']);
    const email = `stripe-test-${Date.now()}@example.com`;
    const sessionId = `cs_test_${Date.now()}`;
    const paymentIntentId = `pi_test_${Date.now()}`;

    // Construct Stripe Event Payload
    const stripePayload = {
      id: `evt_${Date.now()}`,
      object: 'event',
      api_version: '2023-10-16',
      created: Math.floor(Date.now() / 1000),
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          payment_status: 'paid',
          status: 'complete',
          amount_total: 4999,
          currency: 'usd',
          payment_intent: paymentIntentId,
          customer_details: {
            email: email,
            name: 'Stripe Tester'
          },
          customer_email: email,
          metadata: {
            product_id: paidProductId,
            first_name: 'Stripe',
            last_name: 'Tester'
          }
        }
      }
    };

    const payloadString = JSON.stringify(stripePayload);
    
    // Sign the payload (Stripe format: timestamp + "." + payload)
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payloadString}`;
    
    const signature = crypto
      .createHmac('sha256', STRIPE_WEBHOOK_SECRET!)
      .update(signedPayload)
      .digest('hex');
    
    const header = `t=${timestamp},v1=${signature}`;

    // Send Webhook to OUR API
    const response = await request.post('/api/webhooks/stripe', {
      headers: {
        'stripe-signature': header,
        'Content-Type': 'application/json'
      },
      data: payloadString
    });

    const responseBody = await response.json();
    expect(response.status()).toBe(200);
    expect(responseBody.received).toBe(true);

    // Verify Log
    const logs = await getRecentLogs(webhook.id);
    expect(logs.length).toBe(1);
    const log = logs[0];
    
    const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
    
    expect(payload.event).toBe('purchase.completed');
    expect(payload.timestamp).toBeDefined();
    
    // Check Customer
    expect(payload.data.customer).toEqual({
      email: email,
      firstName: 'Stripe',
      lastName: 'Tester',
      userId: null
    });

    // Check Product (fetched from DB by our backend)
    expect(payload.data.product).toBeDefined();
    expect(payload.data.product.id).toBe(paidProductId);
    expect(payload.data.product.slug).toBe(paidProductSlug);
    expect(payload.data.product.price).toBe(49.99); 
    
    // Check Order
    expect(payload.data.order).toEqual({
      amount: 4999,
      currency: 'usd',
      sessionId: sessionId,
      paymentIntentId: paymentIntentId,
      couponId: null,
      isGuest: true
    });
  });

  test('should not send webhook if disabled', async ({ request }) => {
    const webhook = await createWebhook(['waitlist.signup'], false); // inactive

    const signupEmail = `waitlist-disabled-${Date.now()}@example.com`;
    const response = await request.post('/api/waitlist/signup', {
      data: {
        email: signupEmail,
        productId: freeProductId
      }
    });

    // Verify the signup itself succeeded (so empty logs are meaningful)
    expect(response.status()).toBe(200);

    // Wait same amount of time as we usually do for logs to appear
    await new Promise(r => setTimeout(r, 2000));

    const logs = await getRecentLogs(webhook.id);
    expect(logs.length).toBe(0);
  });

  test('should send to multiple webhooks', async ({ request }) => {
    const webhook1 = await createWebhook(['waitlist.signup']);
    const webhook2 = await createWebhook(['waitlist.signup']);

    const signupEmail = `waitlist-multi-${Date.now()}@example.com`;
    const response = await request.post('/api/waitlist/signup', {
      data: {
        email: signupEmail,
        productId: freeProductId
      }
    });

    // Verify the signup succeeded before checking webhook logs
    expect(response.status()).toBe(200);

    // Need slightly longer wait for multiple async processing
    await new Promise(r => setTimeout(r, 2000));

    const logs1 = await getRecentLogs(webhook1.id);
    const logs2 = await getRecentLogs(webhook2.id);

    expect(logs1.length).toBe(1);
    expect(logs2.length).toBe(1);
  });
});
