/** Real product writes, outbox, signed queue and owned HTTP receiver. */
import { createHash, randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestAdmin, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { webhookReceiver } from './helpers/webhook-receiver';
import { webhookTunnel } from './helpers/webhook-tunnel';

// This run exercises the actual dispatcher through public transport, including its URL validation.
test('product CRUD delivers signed snapshots and retains selected-product routing after deletion @J560', async ({ page, request }) => {
  expect(process.env.SLOT_TICKET).toBeTruthy();
  test.setTimeout(180_000);
  const admin = await createTestAdmin('product-lifecycle');
  const secret = 'whsec_product_lifecycle_receiver';
  const receiver = await webhookReceiver(secret);
  let tunnel: Awaited<ReturnType<typeof webhookTunnel>> | undefined;
  let productId: string | undefined;
  let endpointId: string | undefined;
  let keyId: string | undefined;
  try {
    // Isolate the owned stack's historical test outbox before registering the receiver.
    expect((await supabaseAdmin.from('business_events').update({ dispatched_at: new Date().toISOString() })
      .is('dispatched_at', null)).error).toBeNull();
    tunnel = await webhookTunnel(receiver.url);
    await expect.poll(async () => {
      try { return (await fetch(tunnel!.url)).status; } catch { return 0; }
    }, { timeout: 30_000 }).toBe(401);
    const key = `sf_test_${randomBytes(32).toString('hex')}`;
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const signedIn = await auth.auth.signInWithPassword({ email: admin.email, password: admin.password });
    expect(signedIn.error).toBeNull();
    const owner = await supabaseAdmin.from('admin_users').select('id').eq('user_id', signedIn.data.user!.id).single();
    expect(owner.error).toBeNull();
    const inserted = await supabaseAdmin.from('api_keys').insert({ name: 'product-lifecycle', key_prefix: key.slice(0,12),
      key_hash: createHash('sha256').update(key).digest('hex'), admin_user_id: owner.data!.id,
      scopes: ['products:read','products:write'], rate_limit_per_minute: 1000 }).select('id').single();
    expect(inserted.error).toBeNull(); keyId = inserted.data!.id;
    const headers = { Authorization: `Bearer ${key}` };
    const endpoint = await supabaseAdmin.from('webhook_endpoints').insert({ url: tunnel.url, secret,
      events: ['product.created','product.updated','product.deleted'], is_active: true }).select('id').single();
    expect(endpoint.error).toBeNull(); endpointId = endpoint.data!.id;
    const created = await request.post('/api/v1/products', { headers, data: {
      name: 'Receiver product', slug: `receiver-product-${Date.now()}`, price: 12.34, currency: 'PLN', is_active: false,
      content_config: { secret: 'protected-product-material' },
    } });
    expect(created.status()).toBe(201);
    const result = await created.json(); productId = result.data.id;
    const repeatedCreate = await request.post('/api/v1/products', { headers, data: {
      name: 'Receiver product', slug: result.data.slug, price: 12.34, currency: 'PLN',
    } });
    expect(repeatedCreate.status()).toBe(409);
    const drain = async () => {
      const response = await request.get('/api/cron?job=business-events', {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      expect(response.status()).toBe(200);
    };
    await drain();
    const firstDelivery = await supabaseAdmin.from('webhook_logs').select('status,error_message,http_status').eq('endpoint_id', endpointId!);
    expect(firstDelivery.error).toBeNull();
    expect(firstDelivery.data).toEqual([{ status: 'success', error_message: null, http_status: 200 }]);
    await expect.poll(() => receiver.received.filter(event => event.data.product?.id === productId).length).toBe(1);
    expect(receiver.received[0]).toMatchObject({ event: 'product.created', data: { revision: 1, amountUnit: 'minor',
      actor: { type: 'api_key', id: keyId },
      product: { id: productId, price: 1234, currency: 'PLN', isActive: false } } });
    expect((await supabaseAdmin.rpc('set_webhook_endpoint_scoping', {
      p_endpoint_id: endpointId, p_mode: 'selected', p_product_ids: [productId!],
    })).error).toBeNull();
    const updated = await request.patch(`/api/v1/products/${productId}`, { headers, data: { name: 'Changed receiver product', price: 21.35 } });
    expect(updated.status()).toBe(200);
    const unchanged = await request.patch(`/api/v1/products/${productId}`, { headers, data: { name: 'Changed receiver product' } });
    expect(unchanged.status()).toBe(200);
    expect((await request.delete(`/api/v1/products/${productId}`, { headers })).status()).toBe(204);
    // Drain only after deletion, so even the queued update must retain its product scope.
    await drain();
    await expect.poll(() => receiver.received.filter(event => event.data.product?.id === productId).length).toBe(3);
    const events = receiver.received.filter(event => event.data.product?.id === productId);
    expect(new Set(events.map(event => event.data.eventId)).size).toBe(3);
    expect(events.every(event => typeof event.data.occurredAt === 'string')).toBe(true);
    expect(events.map(event => event.event).sort()).toEqual(['product.created','product.deleted','product.updated']);
    const change = events.find(event => event.event === 'product.updated')!;
    expect(change.data).toMatchObject({ revision: 2, changedFields: ['name','price'], product: { name: 'Changed receiver product', price: 2135 } });
    const deleted = events.find(event => event.event === 'product.deleted')!;
    expect(deleted.data).toMatchObject({ revision: 3, product: change.data.product });
    expect(JSON.stringify(events)).not.toMatch(/protected-product-material|_selectedEndpointIds/);
    const pending = await supabaseAdmin.from('business_events').select('id').eq('product_id', productId!).eq('event_type','product.deleted').single();
    expect(pending.error).toBeNull();
    // Repeat a committed handoff, as after a worker interruption; delivery keys must collapse it.
    expect((await supabaseAdmin.from('business_events').update({ dispatched_at: null, leased_until: null }).eq('id', pending.data!.id)).error).toBeNull();
    await drain();
    const logs = await supabaseAdmin.from('webhook_logs').select('id,status').eq('endpoint_id', endpointId!);
    expect(logs.error).toBeNull(); expect(logs.data).toHaveLength(3);
    expect(logs.data!.every(log => log.status === 'success')).toBe(true);
    expect(receiver.received).toHaveLength(3);
    await acceptAllCookies(page);
    await page.goto('/'); await setAuthSession(page, admin.email, admin.password);
    for (const [locale, button, title] of [['en','Add Endpoint','Product Created'],['pl','Dodaj Endpoint','Produkt utworzony']] as const) {
      await page.goto(`/${locale}/dashboard/webhooks`);
      await page.getByRole('button', { name: button }).first().click();
      for (const label of locale === 'en' ? ['Product Created','Product Updated','Product Deleted'] : ['Produkt utworzony','Produkt zaktualizowany','Produkt usunięty']) {
        const option = page.locator('#webhook-form label', { hasText: label });
        await expect(option.locator('input[type="checkbox"]')).toBeEnabled();
        await expect(option.locator('[title]')).toHaveAttribute('title', /.+/);
      }
      await expect(page.locator('#webhook-form')).toContainText(title);
    }
  } finally {
    if (endpointId) await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
    if (productId) await supabaseAdmin.from('products').delete().eq('id', productId);
    if (keyId) await supabaseAdmin.from('api_keys').delete().eq('id', keyId);
    await tunnel?.close(); await receiver.close(); await admin.cleanup();
  }
});
