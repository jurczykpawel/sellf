import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { post, patch, get, cleanup, deleteTestApiKey, supabaseAdmin } from './setup';

interface ProductResponse { data: { id: string; checkout_profile: unknown }; error?: { message: string } }
const ids: string[] = [];
const profile = { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode: 'checkout' }] };
const product = () => ({ name: 'Checkout seats', slug: `profile-${randomUUID()}`, price: 50, currency: 'PLN' });
afterAll(async () => { await cleanup({ products: ids }); await deleteTestApiKey(); });

describe('product checkout profile API', () => {
  it('creates, lists, updates and clears profiles with a dedicated audit event', async () => {
    const created = await post<ProductResponse>('/api/v1/products', { ...product(), checkout_profile: profile });
    expect(created.status).toBe(201);
    const id = created.data.data.id; ids.push(id);
    expect(created.data.data.checkout_profile).toEqual(profile);
    expect((await get<ProductResponse>(`/api/v1/products/${id}`)).data.data.checkout_profile).toEqual(profile);
    const list = await get<{ data: ProductResponse['data'][] }>('/api/v1/products?search=Checkout%20seats');
    expect(list.data.data.find(p => p.id === id)?.checkout_profile).toEqual(profile);
    const changed = { v: 1, modules: [{ id: 'phone', required: true }] };
    const updated = await patch<ProductResponse>(`/api/v1/products/${id}`, { checkout_profile: changed });
    expect(updated.status).toBe(200); expect(updated.data.data.checkout_profile).toEqual(changed);
    const { data: audit, error } = await supabaseAdmin().from('audit_log').select('new_values').contains('new_values', { action: 'product.checkout_profile.update', product_id: id });
    expect(error).toBeNull(); expect(audit?.length).toBe(2);
    expect((await patch<ProductResponse>(`/api/v1/products/${id}`, { checkout_profile: null })).data.data.checkout_profile).toBeNull();
  });
  it('rejects unknown profile keys, modules, dependencies, product combinations and unconfigured GUS', async () => {
    for (const value of [{ ...profile, extra: true }, { v: 1, modules: [{ id: 'unknown' }] }, { v: 1, modules: [{ id: 'participants', required: true, prefill_from_buyer: false }] }, { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: true }] }]) {
      const res = await post<ProductResponse>('/api/v1/products', { ...product(), checkout_profile: value });
      if (res.status === 201) ids.push(res.data.data.id);
      expect(res.status).toBe(400); expect(res.data.error).toBeDefined();
    }
    const res = await post('/api/v1/products', { ...product(), checkout_profile: profile, allow_custom_price: true });
    expect(res.status).toBe(400);
  });
  it('validates PATCH against the complete stored product', async () => {
    const created = await post<ProductResponse>('/api/v1/products', { ...product(), checkout_profile: profile });
    expect(created.status).toBe(201);
    const id = created.data.data.id; ids.push(id);
    for (const patchData of [{ allow_custom_price: true }, { issue_license_on_purchase: true }]) {
      expect((await patch(`/api/v1/products/${id}`, patchData)).status).toBe(400);
    }
    expect((await patch(`/api/v1/products/${id}`, { checkout_profile: null, allow_custom_price: true })).status).toBe(200);
    expect((await patch(`/api/v1/products/${id}`, { checkout_profile: profile })).status).toBe(400);
  });
});
