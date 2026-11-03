/**
 * API Integration Tests: purchase attribution for integrators and agents.
 *
 * GET /api/v1/analytics/attribution — aggregates only (ANALYTICS_READ)
 * GET /api/v1/payments?embed=attribution — per-order source (PAYMENTS_READ)
 *
 * Run: bun run test:api (requires dev server)
 */

import { createHash, randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, get, supabase } from './setup';

const stamp = Date.now();
const slug = `attr-api-${stamp}`;
let productId = '';
const txIds: string[] = [];
let restrictedKeyId = '';
let restrictedKey = '';

const touch = (campaign: string) => ({
  v: 1, consent: 'analytics', mode: 'stored', sessions_count: 2,
  first_seen_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
  first: { source: 'facebook', medium: 'paid_social', campaign: 'autumn' },
  last: { source: 'listmonk', medium: 'email', campaign, content: 'cta-1' },
  device_class: 'mobile', country: 'PL',
});

async function purchase(session: string, amount: number, campaign: string | null): Promise<string> {
  if (campaign) {
    const { error } = await supabase.rpc('store_checkout_attribution', { p_ref: session, p_payload: touch(campaign) });
    if (error) throw error;
  }
  const { data, error } = await supabase.from('payment_transactions').insert({
    product_id: productId, customer_email: `attr-api-${stamp}@example.com`, session_id: session,
    amount, currency: 'PLN', status: 'completed',
  }).select('id').single();
  if (error) throw error;
  txIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  const { data, error } = await supabase.from('products')
    .insert({ name: 'Attribution API', slug, price: 100, currency: 'PLN', is_active: true }).select('id').single();
  if (error) throw error;
  productId = data.id;
  await purchase(`cs_test_attrapi_${stamp}_1`, 10000, `mail-api-${stamp}`);
  await purchase(`cs_test_attrapi_${stamp}_2`, 10000, `mail-api-${stamp}`);
  await purchase(`cs_test_attrapi_${stamp}_3`, 4000, null);

  const { data: admin } = await supabase.from('admin_users').select('id').limit(1).single();
  restrictedKey = `sf_test_${randomBytes(32).toString('hex')}`;
  const { data: key, error: keyError } = await supabase.from('api_keys').insert({
    name: `attr-restricted-${stamp}`, key_prefix: restrictedKey.substring(0, 12),
    key_hash: createHash('sha256').update(restrictedKey).digest('hex'), admin_user_id: admin!.id,
    scopes: ['products:read'], rate_limit_per_minute: 100, is_active: true,
  }).select('id').single();
  if (keyError) throw keyError;
  restrictedKeyId = key.id;
});

afterAll(async () => {
  if (txIds.length) await supabase.from('payment_transactions').delete().in('id', txIds);
  if (productId) await supabase.from('products').delete().eq('id', productId);
  if (restrictedKeyId) await supabase.from('api_keys').delete().eq('id', restrictedKeyId);
});

interface Row { channel?: string; source?: string; medium?: string; campaign?: string; content?: string; currency: string; orders: number; net: number; gross: number; refunded: number }

describe('GET /api/v1/analytics/attribution', () => {
  it('answers "where did purchases of the last 3 days come from" in one call @J171', async () => {
    const res = await get<{ data: { rows: Row[]; filters: Record<string, unknown> } }>(`/api/v1/analytics/attribution?days=3&product_id=${productId}`);
    expect(res.status).toBe(200);
    const mail = res.data.data.rows.find(r => r.campaign === `mail-api-${stamp}`);
    expect(mail).toMatchObject({ channel: 'email', source: 'listmonk', medium: 'email', content: 'cta-1', currency: 'PLN', orders: 2, net: 200 });
    expect(res.data.data.rows.find(r => r.channel === 'unknown')).toMatchObject({ orders: 1, net: 40 });
    expect(res.data.data.filters).toMatchObject({ touch: 'last', group_by: ['channel', 'source', 'medium', 'campaign', 'content'] });
    expect(JSON.stringify(res.data)).not.toContain('@example.com');
  });

  it('switches to first touch and custom grouping', async () => {
    const res = await get<{ data: { rows: Row[] } }>(`/api/v1/analytics/attribution?days=3&product_id=${productId}&touch=first&group_by=channel`);
    expect(res.status).toBe(200);
    expect(res.data.data.rows.find(r => r.channel === 'paid_social')).toMatchObject({ orders: 2 });
    expect(Object.keys(res.data.data.rows[0])).not.toContain('campaign');
  });

  it('rejects unknown dimensions and bad dates', async () => {
    expect((await get(`/api/v1/analytics/attribution?group_by=email`)).status).toBe(400);
    expect((await get(`/api/v1/analytics/attribution?from=yesterday`)).status).toBe(400);
  });

  it('requires the analytics scope', async () => {
    expect((await fetch(`${API_URL}/api/v1/analytics/attribution`)).status).toBe(401);
    const res = await fetch(`${API_URL}/api/v1/analytics/attribution`, { headers: { 'X-API-Key': restrictedKey } });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/payments?embed=attribution', () => {
  it('adds the frozen source to each order only when asked', async () => {
    const plain = await get<{ data: Array<Record<string, unknown>> }>(`/api/v1/payments?product_id=${productId}`);
    expect(plain.data.data[0]).not.toHaveProperty('attribution');
    const res = await get<{ data: Array<{ id: string; attribution: Record<string, unknown> | null }> }>(`/api/v1/payments?product_id=${productId}&embed=attribution`);
    expect(res.status).toBe(200);
    const withSource = res.data.data.find(p => p.id === txIds[0]);
    expect(withSource?.attribution).toMatchObject({
      channel: 'email', first_channel: 'paid_social', kind: 'payment',
      last: { source: 'listmonk', medium: 'email', campaign: `mail-api-${stamp}`, content: 'cta-1' },
      first: { source: 'facebook' }, sessions_count: 2, device_class: 'mobile', country: 'PL',
    });
    expect(withSource?.attribution).not.toHaveProperty('click_id');
  });
});
