/**
 * PATCH /api/v1/integrations — the Meta CAPI token is stored encrypted.
 *
 * @see admin-panel/src/app/api/v1/integrations/route.ts
 * @see admin-panel/src/lib/integrations/capi-token.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decryptSecret } from '@/lib/services/secret-encryption';

const TOKEN = 'EAAapi_capi_token_abcdefghijklmnop';

const { upserts } = vi.hoisted(() => ({ upserts: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    authenticate: vi.fn(async () => ({
      method: 'api_key',
      supabase: {
        from: () => ({
          upsert: (payload: Record<string, unknown>) => {
            upserts.push(payload);
            const chain = {
              select: () => chain,
              single: async () => ({ data: { id: 1, updated_at: '2026-09-29T00:00:00Z' }, error: null }),
            };
            return chain;
          },
        }),
      },
    })),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  createPlatformClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

import { PATCH } from '@/app/api/v1/integrations/route';

function patch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/v1/integrations', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sf_live_test' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/v1/integrations — CAPI token at rest', () => {
  beforeEach(() => {
    upserts.length = 0;
  });

  it('stores ciphertext, not plaintext', async () => {
    const res = await PATCH(patch({ facebook_capi_token: TOKEN }));
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    const [payload] = upserts;
    expect(JSON.stringify(payload)).not.toContain(TOKEN);
    expect(payload.facebook_capi_token).toBeNull();
    const decrypted = await decryptSecret({
      encrypted_key: payload.facebook_capi_token_encrypted as string,
      encryption_iv: payload.facebook_capi_token_iv as string,
      encryption_tag: payload.facebook_capi_token_tag as string,
    });
    expect(decrypted).toBe(TOKEN);
    const json = await res.json();
    expect(json.data.changed_fields).toEqual(['facebook_capi_token']);
  });

  it('leaves the stored token untouched when the field is absent', async () => {
    const res = await PATCH(patch({ facebook_pixel_id: '1234567890' }));
    expect(res.status).toBe(200);
    expect(Object.keys(upserts[0]).filter((key) => key.startsWith('facebook_capi_token'))).toEqual([]);
  });

  it('removes the stored token on an explicit null', async () => {
    const res = await PATCH(patch({ facebook_capi_token: null }));
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({
      facebook_capi_token: null,
      facebook_capi_token_encrypted: null,
      facebook_capi_token_iv: null,
      facebook_capi_token_tag: null,
    });
  });
});
