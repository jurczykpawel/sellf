/**
 * Meta Conversions API token — encrypted at rest.
 *
 * Covers the storage helper (encrypt on write, decrypt on read, legacy
 * plaintext fallback + one-time upgrade) and the admin integrations actions
 * (write path stores ciphertext only, read path never returns the token,
 * saving without a token keeps the stored one).
 *
 * @see admin-panel/src/lib/integrations/capi-token.ts
 * @see admin-panel/src/lib/actions/integrations.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '@/lib/services/secret-encryption';

const TOKEN = 'EAAtest_capi_token_1234567890abcdef';

// ===== Fake Supabase client that records writes =====

interface RecordedUpdate {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
}

function createRecordingClient(options: { row?: Record<string, unknown> | null; updateMatches?: boolean } = {}) {
  const updates: RecordedUpdate[] = [];
  const client = {
    from(table: string) {
      return {
        select() {
          const chain = {
            eq: () => chain,
            single: async () => ({ data: options.row ?? null, error: null }),
            maybeSingle: async () => ({ data: options.row ?? null, error: null }),
          };
          return chain;
        },
        update(payload: Record<string, unknown>) {
          const record: RecordedUpdate = { table, payload, filters: [] };
          updates.push(record);
          const result = { data: options.updateMatches === false ? [] : [{ id: 1 }], error: null };
          const chain = {
            eq(column: string, value: unknown) {
              record.filters.push(['eq', column, value]);
              return chain;
            },
            is(column: string, value: unknown) {
              record.filters.push(['is', column, value]);
              return chain;
            },
            select: () => chain,
            then: (resolve: (value: typeof result) => unknown) => resolve(result),
          };
          return chain;
        },
      };
    },
  };
  return { client, updates };
}

// ===== Storage helper =====

describe('capi-token storage helper', () => {
  it('encrypts a token into ciphertext columns and clears the plaintext column', async () => {
    const { encryptCapiTokenColumns } = await import('@/lib/integrations/capi-token');
    const columns = await encryptCapiTokenColumns(TOKEN);

    expect(columns.facebook_capi_token).toBeNull();
    expect(columns.facebook_capi_token_encrypted).toBeTruthy();
    expect(columns.facebook_capi_token_encrypted).not.toContain(TOKEN);
    expect(JSON.stringify(columns)).not.toContain(TOKEN);

    const decrypted = await decryptSecret({
      encrypted_key: columns.facebook_capi_token_encrypted as string,
      encryption_iv: columns.facebook_capi_token_iv as string,
      encryption_tag: columns.facebook_capi_token_tag as string,
    });
    expect(decrypted).toBe(TOKEN);
  });

  it('clears all token columns when the token is removed', async () => {
    const { encryptCapiTokenColumns } = await import('@/lib/integrations/capi-token');
    expect(await encryptCapiTokenColumns(null)).toEqual({
      facebook_capi_token: null,
      facebook_capi_token_encrypted: null,
      facebook_capi_token_iv: null,
      facebook_capi_token_tag: null,
    });
  });

  it('decrypts an encrypted row', async () => {
    const { resolveCapiToken } = await import('@/lib/integrations/capi-token');
    const enc = await encryptSecret(TOKEN);
    const token = await resolveCapiToken({
      facebook_capi_token: null,
      facebook_capi_token_encrypted: enc.encryptedKey,
      facebook_capi_token_iv: enc.iv,
      facebook_capi_token_tag: enc.tag,
    });
    expect(token).toBe(TOKEN);
  });

  it('returns a legacy plaintext token and upgrades it to ciphertext in place', async () => {
    const { resolveCapiToken } = await import('@/lib/integrations/capi-token');
    const { client, updates } = createRecordingClient();

    const token = await resolveCapiToken({ facebook_capi_token: TOKEN }, client as never);

    expect(token).toBe(TOKEN);
    expect(updates).toHaveLength(1);
    const [update] = updates;
    expect(update.table).toBe('integrations_config');
    expect(update.payload.facebook_capi_token).toBeNull();
    expect(JSON.stringify(update.payload)).not.toContain(TOKEN);
    // Compare-and-swap: only replaces the exact legacy value, never a newer save.
    expect(update.filters).toContainEqual(['eq', 'id', 1]);
    expect(update.filters).toContainEqual(['eq', 'facebook_capi_token', TOKEN]);
    expect(update.filters).toContainEqual(['is', 'facebook_capi_token_encrypted', null]);

    const decrypted = await decryptSecret({
      encrypted_key: update.payload.facebook_capi_token_encrypted as string,
      encryption_iv: update.payload.facebook_capi_token_iv as string,
      encryption_tag: update.payload.facebook_capi_token_tag as string,
    });
    expect(decrypted).toBe(TOKEN);
  });

  it('keeps serving a legacy token when the upgrade cannot encrypt', async () => {
    const { resolveCapiToken } = await import('@/lib/integrations/capi-token');
    const { client, updates } = createRecordingClient();
    const saved = { app: process.env.APP_ENCRYPTION_KEY, stripe: process.env.STRIPE_ENCRYPTION_KEY };
    delete process.env.APP_ENCRYPTION_KEY;
    delete process.env.STRIPE_ENCRYPTION_KEY;
    try {
      const token = await resolveCapiToken({ facebook_capi_token: TOKEN }, client as never);
      expect(token).toBe(TOKEN);
      expect(updates).toHaveLength(0);
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved.app;
      if (saved.stripe !== undefined) process.env.STRIPE_ENCRYPTION_KEY = saved.stripe;
    }
  });

  it('boot-time conversion encrypts a stored legacy token and skips an encrypted one', async () => {
    const { upgradeStoredLegacyCapiToken } = await import('@/lib/integrations/capi-token');

    const legacy = createRecordingClient({ row: { facebook_capi_token: TOKEN, facebook_capi_token_encrypted: null } });
    expect(await upgradeStoredLegacyCapiToken(legacy.client as never)).toBe(true);
    expect(legacy.updates).toHaveLength(1);
    expect(JSON.stringify(legacy.updates[0].payload)).not.toContain(TOKEN);

    const converted = createRecordingClient({ row: { facebook_capi_token: null, facebook_capi_token_encrypted: 'x' } });
    expect(await upgradeStoredLegacyCapiToken(converted.client as never)).toBe(false);
    expect(converted.updates).toHaveLength(0);

    // A concurrent save already replaced the value: nothing matched, nothing lost.
    const raced = createRecordingClient({
      row: { facebook_capi_token: TOKEN, facebook_capi_token_encrypted: null },
      updateMatches: false,
    });
    expect(await upgradeStoredLegacyCapiToken(raced.client as never)).toBe(false);
  });

  it('prefers the encrypted value over a leftover plaintext value', async () => {
    const { resolveCapiToken } = await import('@/lib/integrations/capi-token');
    const enc = await encryptSecret(TOKEN);
    const token = await resolveCapiToken({
      facebook_capi_token: 'EAAstale_value_000000000000',
      facebook_capi_token_encrypted: enc.encryptedKey,
      facebook_capi_token_iv: enc.iv,
      facebook_capi_token_tag: enc.tag,
    });
    expect(token).toBe(TOKEN);
  });

  it('redacts every token column and reports only whether a token is set', async () => {
    const { redactCapiToken } = await import('@/lib/integrations/capi-token');
    const enc = await encryptSecret(TOKEN);
    const redacted = redactCapiToken({
      facebook_pixel_id: '123',
      facebook_capi_token: TOKEN,
      facebook_capi_token_encrypted: enc.encryptedKey,
      facebook_capi_token_iv: enc.iv,
      facebook_capi_token_tag: enc.tag,
    });
    expect(redacted).toEqual({ facebook_pixel_id: '123', facebook_capi_token_set: true });
    expect(redactCapiToken({ facebook_pixel_id: '123' })).toEqual({
      facebook_pixel_id: '123',
      facebook_capi_token_set: false,
    });
  });
});

// ===== Admin actions =====

const { adminClientRef } = vi.hoisted(() => ({
  adminClientRef: { current: null as unknown },
}));

vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminClient: async (fn: (ctx: { dataClient: unknown }) => Promise<unknown>) =>
    fn({ dataClient: adminClientRef.current }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock('@/lib/license/env-status', () => ({
  getEnvLicenseStatus: vi.fn(async () => null),
}));

describe('integrations admin actions', () => {
  beforeEach(() => {
    adminClientRef.current = null;
  });

  it('saving a token stores ciphertext, never plaintext', async () => {
    const { updateIntegrationsConfig } = await import('@/lib/actions/integrations');
    const { client, updates } = createRecordingClient();
    adminClientRef.current = client;

    const result = await updateIntegrationsConfig({ facebook_capi_token: TOKEN, fb_capi_enabled: true });

    expect(result.success).toBe(true);
    expect(updates).toHaveLength(1);
    const { payload } = updates[0];
    expect(JSON.stringify(payload)).not.toContain(TOKEN);
    expect(payload.facebook_capi_token).toBeNull();
    expect(payload.facebook_capi_token_encrypted).toBeTruthy();
    expect(payload.fb_capi_enabled).toBe(true);
    const decrypted = await decryptSecret({
      encrypted_key: payload.facebook_capi_token_encrypted as string,
      encryption_iv: payload.facebook_capi_token_iv as string,
      encryption_tag: payload.facebook_capi_token_tag as string,
    });
    expect(decrypted).toBe(TOKEN);
  });

  it('saving without a token keeps the stored one', async () => {
    const { updateIntegrationsConfig } = await import('@/lib/actions/integrations');
    const { client, updates } = createRecordingClient();
    adminClientRef.current = client;

    await updateIntegrationsConfig({ facebook_pixel_id: '1234567890', fb_capi_enabled: true });
    await updateIntegrationsConfig({ facebook_pixel_id: '1234567890', facebook_capi_token: '' });

    expect(updates).toHaveLength(2);
    for (const { payload } of updates) {
      expect(Object.keys(payload).filter((key) => key.startsWith('facebook_capi_token'))).toEqual([]);
    }
  });

  it('an explicit null removes the stored token', async () => {
    const { updateIntegrationsConfig } = await import('@/lib/actions/integrations');
    const { client, updates } = createRecordingClient();
    adminClientRef.current = client;

    await updateIntegrationsConfig({ facebook_capi_token: null });

    expect(updates[0].payload).toMatchObject({
      facebook_capi_token: null,
      facebook_capi_token_encrypted: null,
      facebook_capi_token_iv: null,
      facebook_capi_token_tag: null,
    });
  });

  it('the admin read path never contains the token', async () => {
    const { getIntegrationsConfig } = await import('@/lib/actions/integrations');
    const enc = await encryptSecret(TOKEN);
    for (const row of [
      { id: 1, facebook_pixel_id: '123', facebook_capi_token: TOKEN },
      {
        id: 1,
        facebook_pixel_id: '123',
        facebook_capi_token: null,
        facebook_capi_token_encrypted: enc.encryptedKey,
        facebook_capi_token_iv: enc.iv,
        facebook_capi_token_tag: enc.tag,
      },
    ]) {
      const { client } = createRecordingClient({ row });
      adminClientRef.current = client;

      const result = await getIntegrationsConfig();

      expect(result.success).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain(enc.encryptedKey);
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data.facebook_capi_token_set).toBe(true);
      expect(data).not.toHaveProperty('facebook_capi_token');
    }
  });
});
