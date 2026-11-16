/**
 * API Integration Tests: product archive
 *
 * DELETE of a product with orders archives it (orders, invoices and licenses stay);
 * a permanent delete is a separate explicit call allowed only from the archive and
 * still keeps those records with the purchase-time product name.
 *
 * Run: bun run test:api (requires dev server running)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { get, post, patch, del, cleanup, supabaseAdmin, API_URL } from './setup';

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}
interface Product { id: string; name: string; is_active: boolean; archived_at: string | null }
interface Impact { orders: number; invoices: number; licenses: number; accesses: number; subscriptions: number; hasHistory: boolean }

const db = supabaseAdmin();
const createdProductIds: string[] = [];

async function createProduct(name: string): Promise<string> {
  const slug = `w250-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', { name, slug, description: 'Archive test', price: 49 });
  expect(status).toBe(201);
  createdProductIds.push(data.data!.id);
  return data.data!.id;
}

/** A paid order and an issued license for the product, as the checkout would leave them. */
async function sell(productId: string): Promise<{ orderId: string; licenseId: string }> {
  const session = `cs_test_w250${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const { data: order, error } = await db.from('payment_transactions').insert({
    product_id: productId, customer_email: 'w250-buyer@example.com', amount: 4900, currency: 'PLN',
    status: 'completed', session_id: session,
  }).select('id').single();
  expect(error).toBeNull();
  const { data: admin } = await db.from('admin_users').select('user_id').limit(1).single();
  const { data: license, error: licenseError } = await db.from('issued_licenses').insert({
    seller_id: admin!.user_id, original_seller_id: admin!.user_id, product_id: productId,
    email: 'w250-buyer@example.com', order_id: order!.id, kid: 'w250', license_key: `w250-${order!.id}`,
  }).select('id').single();
  expect(licenseError).toBeNull();
  return { orderId: order!.id, licenseId: license!.id };
}

describe('Product archive API @J602', () => {
  afterAll(async () => {
    await cleanup({ products: createdProductIds });
  });

  it('DELETE of a product with orders archives it and keeps the order and license', async () => {
    const id = await createProduct('Archive sold course');
    const { orderId, licenseId } = await sell(id);

    const impact = await get<ApiResponse<Impact>>(`/api/v1/products/${id}/deletion-impact`);
    expect(impact.status).toBe(200);
    expect(impact.data.data).toMatchObject({ orders: 1, licenses: 1, hasHistory: true });

    const { status, data } = await del<ApiResponse<{ id: string; status: string; impact: Impact }>>(`/api/v1/products/${id}`);
    expect(status).toBe(200);
    expect(data.data).toMatchObject({ id, status: 'archived', impact: { orders: 1, licenses: 1 } });

    const product = await get<ApiResponse<Product>>(`/api/v1/products/${id}`);
    expect(product.data.data).toMatchObject({ is_active: false });
    expect(product.data.data!.archived_at).not.toBeNull();
    expect((await db.from('payment_transactions').select('product_id').eq('id', orderId).single()).data?.product_id).toBe(id);
    expect((await db.from('issued_licenses').select('id').eq('id', licenseId).single()).data).not.toBeNull();

    const again = await del<ApiResponse<{ status: string }>>(`/api/v1/products/${id}`);
    expect(again.status).toBe(200);
    expect(again.data.data?.status).toBe('archived');
  });

  it('lists archived products only under status=archived', async () => {
    const id = await createProduct('Archive listed archive');
    await sell(id);
    await del(`/api/v1/products/${id}`);

    const active = await get<ApiResponse<Product[]>>('/api/v1/products?limit=100&search=Archive%20listed%20archive');
    expect((active.data.data ?? []).map(p => p.id)).not.toContain(id);
    const archived = await get<ApiResponse<Product[]>>('/api/v1/products?limit=100&status=archived&search=Archive%20listed%20archive');
    expect((archived.data.data ?? []).map(p => p.id)).toContain(id);
  });

  it('refuses activation and permanent delete of a sold product outside the archive flow', async () => {
    const id = await createProduct('Archive permanent guard');
    await sell(id);

    const premature = await del<ApiResponse<null>>(`/api/v1/products/${id}?permanent=true`);
    expect(premature.status).toBe(409);
    expect(premature.data.error?.code).toBe('CONFLICT');

    await del(`/api/v1/products/${id}`);
    const activate = await patch<ApiResponse<Product>>(`/api/v1/products/${id}`, { is_active: true });
    expect(activate.status).toBe(409);
  });

  it('restores an archived product as inactive', async () => {
    const id = await createProduct('Archive restore');
    await sell(id);
    await del(`/api/v1/products/${id}`);

    const { status, data } = await post<ApiResponse<Product>>(`/api/v1/products/${id}/restore`, {});
    expect(status).toBe(200);
    expect(data.data).toMatchObject({ id, archived_at: null, is_active: false });
    const listed = await get<ApiResponse<Product[]>>('/api/v1/products?limit=100&search=Archive%20restore');
    expect((listed.data.data ?? []).map(p => p.id)).toContain(id);
  });

  it('permanent delete from the archive keeps the order and license with the purchase-time name', async () => {
    const id = await createProduct('Archive permanent');
    const { orderId, licenseId } = await sell(id);
    await patch(`/api/v1/products/${id}`, { name: 'Archive permanent renamed' });
    await del(`/api/v1/products/${id}`);

    const { status } = await del(`/api/v1/products/${id}?permanent=true`);
    expect(status).toBe(204);
    expect((await get(`/api/v1/products/${id}`)).status).toBe(404);

    const order = (await db.from('payment_transactions').select('product_id,product_name,status').eq('id', orderId).single()).data;
    expect(order).toEqual({ product_id: null, product_name: 'Archive permanent', status: 'completed' });
    const license = (await db.from('issued_licenses').select('product_id,product_name').eq('id', licenseId).single()).data;
    expect(license).toEqual({ product_id: null, product_name: 'Archive permanent' });

    const detail = await get<ApiResponse<{ id: string; product: { id: string | null; name: string } }>>(`/api/v1/payments/${orderId}`);
    expect(detail.status).toBe(200);
    expect(detail.data.data?.product).toMatchObject({ id: null, name: 'Archive permanent' });
    const list = await get<ApiResponse<Array<{ id: string; product: { id: string | null; name: string } }>>>('/api/v1/payments?limit=100&email=w250-buyer');
    expect(list.data.data?.find(p => p.id === orderId)?.product).toMatchObject({ id: null, name: 'Archive permanent' });
  });

  it('hides an archived product from the public product endpoint even with the waitlist on', async () => {
    const id = await createProduct('Archive public');
    await sell(id);
    const { data: before } = await db.from('products').update({ enable_waitlist: true, is_active: false }).eq('id', id).select('slug').single();
    expect((await fetch(`${API_URL}/api/public/products/${before!.slug}`)).status).toBe(200);
    await del(`/api/v1/products/${id}`);
    expect((await fetch(`${API_URL}/api/public/products/${before!.slug}`)).status).toBe(404);
  });

  it('refuses a permanent delete while a subscription is active and keeps the ended one', async () => {
    const id = await createProduct('Archive subscription');
    await sell(id);
    const { data: subscription, error } = await db.from('subscriptions').insert({
      product_id: id, stripe_customer_id: 'cus_w250', stripe_subscription_id: `sub_w250_${Date.now()}`, status: 'active',
    }).select('id').single();
    expect(error).toBeNull();
    await del(`/api/v1/products/${id}`);

    const impact = await get<ApiResponse<Impact & { activeSubscriptions: number }>>(`/api/v1/products/${id}/deletion-impact`);
    expect(impact.data.data).toMatchObject({ subscriptions: 1, activeSubscriptions: 1 });
    const blocked = await del<ApiResponse<null>>(`/api/v1/products/${id}?permanent=true`);
    expect(blocked.status).toBe(409);
    expect(blocked.data.error?.message).toContain('active subscriptions');

    await db.from('subscriptions').update({ status: 'canceled' }).eq('id', subscription!.id);
    expect((await del(`/api/v1/products/${id}?permanent=true`)).status).toBe(204);
    const kept = (await db.from('subscriptions').select('product_id,product_name,status').eq('id', subscription!.id).single()).data;
    expect(kept).toEqual({ product_id: null, product_name: 'Archive subscription', status: 'canceled' });
  });

  it('a product without orders is still deleted at once', async () => {
    const id = await createProduct('Archive never sold');
    const { status } = await del(`/api/v1/products/${id}`);
    expect(status).toBe(204);
    expect((await get(`/api/v1/products/${id}`)).status).toBe(404);
  });
});
