import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmbedCorsHeaders,
  isAllowedEmbedOrigin,
  loadAllowedOriginsForProduct,
  parseEmbedCheckoutBody,
  sanitizeAllowedEmbedOrigins,
} from '@/lib/embed/checkout-embed';
import type { createAdminClient } from '@/lib/supabase/admin';

describe('checkout embed security helpers', () => {
  it('allows only exact HTTPS origins from the configured list', () => {
    const allowed = sanitizeAllowedEmbedOrigins([
      'https://landing.example.com',
      'https://sellf.techskills.academy/',
      'http://localhost:3000',
    ]);

    expect(isAllowedEmbedOrigin('https://landing.example.com', allowed)).toBe(true);
    expect(isAllowedEmbedOrigin('https://sellf.techskills.academy', allowed)).toBe(true);
    expect(isAllowedEmbedOrigin('http://localhost:3000', allowed)).toBe(true);
    expect(isAllowedEmbedOrigin('https://evil.example.com', allowed)).toBe(false);
    expect(isAllowedEmbedOrigin('https://landing.example.com.evil.test', allowed)).toBe(false);
    expect(isAllowedEmbedOrigin(null, allowed)).toBe(false);
  });

  it('builds CORS headers without credentials and without wildcard fallback', () => {
    const headers = buildEmbedCorsHeaders('https://landing.example.com', [
      'https://landing.example.com',
    ]);

    expect(headers['Access-Control-Allow-Origin']).toBe('https://landing.example.com');
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Sellf-Embed-Version');
    expect(headers.Vary).toBe('Origin');

    const deniedHeaders = buildEmbedCorsHeaders(null, ['https://landing.example.com']);
    expect(deniedHeaders['Access-Control-Allow-Origin']).toBeUndefined();
    expect(deniedHeaders['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('accepts only the embed request fields owned by Sellf', () => {
    expect(parseEmbedCheckoutBody({ productSlug: 'kurs-ai', email: 'buyer@example.com' })).toEqual({
      ok: true,
      value: { productSlug: 'kurs-ai', email: 'buyer@example.com' },
    });

    expect(parseEmbedCheckoutBody({ productSlug: 'kurs-ai', successUrl: 'https://evil.example' })).toEqual({
      ok: false,
      error: 'Invalid request',
    });

    expect(parseEmbedCheckoutBody({ productId: 'product-id' })).toEqual({
      ok: false,
      error: 'Invalid request',
    });
  });
});

interface SettingsRow { seller_id: string; allowed_embed_origins: string[] }

/** In-memory stand-in for the two tables the origin resolver reads. */
function fakeClient(adminIds: string[], settings: SettingsRow[]) {
  const settingsQuery = (rows: SettingsRow[]) => ({
    eq: (_col: string, value: string) => ({
      maybeSingle: async () => ({ data: rows.find((r) => r.seller_id === value) ?? null, error: null }),
    }),
    in: (_col: string, values: string[]) => {
      const filtered = rows.filter((r) => values.includes(r.seller_id));
      return { limit: async (n: number) => ({ data: filtered.slice(0, n), error: null }) };
    },
    limit: async (n: number) => ({ data: rows.slice(0, n), error: null }),
  });

  return {
    from: (table: string) => {
      if (table === 'admin_users') {
        return { select: async () => ({ data: adminIds.map((user_id) => ({ user_id })), error: null }) };
      }
      if (table === 'seller_embed_settings') return { select: () => settingsQuery(settings) };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

describe('loadAllowedOriginsForProduct', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the seller row when the product has a seller', async () => {
    const client = fakeClient([], [{ seller_id: 'seller-1', allowed_embed_origins: ['https://seller.example'] }]);
    await expect(loadAllowedOriginsForProduct(client, 'seller-1')).resolves.toEqual(['https://seller.example']);
  });

  it('uses the shop admin row for a product without a seller', async () => {
    vi.stubEnv('SELLF_EMBED_ALLOWED_ORIGINS', 'https://env.example');
    const client = fakeClient(['admin-1'], [
      { seller_id: 'admin-1', allowed_embed_origins: ['https://shop.example'] },
    ]);
    await expect(loadAllowedOriginsForProduct(client, null)).resolves.toEqual(['https://shop.example']);
  });

  it('ignores rows that do not belong to an admin for a product without a seller', async () => {
    vi.stubEnv('SELLF_EMBED_ALLOWED_ORIGINS', 'https://env.example');
    const client = fakeClient(['admin-1'], [
      { seller_id: 'customer-1', allowed_embed_origins: ['https://other.example'] },
    ]);
    await expect(loadAllowedOriginsForProduct(client, null)).resolves.toEqual(['https://env.example']);
  });

  it('falls back to env when several admin rows make the choice ambiguous', async () => {
    vi.stubEnv('SELLF_EMBED_ALLOWED_ORIGINS', 'https://env.example');
    const client = fakeClient(['admin-1', 'admin-2'], [
      { seller_id: 'admin-1', allowed_embed_origins: ['https://one.example'] },
      { seller_id: 'admin-2', allowed_embed_origins: ['https://two.example'] },
    ]);
    await expect(loadAllowedOriginsForProduct(client, null)).resolves.toEqual(['https://env.example']);
  });
});
