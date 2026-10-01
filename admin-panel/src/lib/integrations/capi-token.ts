/**
 * Meta Conversions API access token — stored encrypted at rest.
 *
 * Storage (public.integrations_config, singleton id = 1), same scheme as the
 * GUS and Currency API keys in that table:
 *   facebook_capi_token_encrypted / _iv / _tag — AES-256-GCM (APP_ENCRYPTION_KEY)
 *   facebook_capi_token                        — legacy plaintext column; read
 *                                                only as a fallback for rows
 *                                                saved before encryption
 *
 * Every write stores ciphertext and clears the plaintext column. A row that
 * still holds only the plaintext value is upgraded in place the first time the
 * server reads it (tracking send, or the boot-time pass in instrumentation.ts).
 * The upgrade is a compare-and-swap: it only replaces the exact plaintext value
 * it read, so it can never overwrite a token saved in the meantime, and the
 * plaintext is cleared only by the same UPDATE that writes the ciphertext.
 *
 * The admin UI never receives the token: `redactCapiToken` replaces all token
 * columns with a `facebook_capi_token_set` flag.
 *
 * @see admin-panel/src/lib/services/secret-encryption.ts
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql (CAPI token section)
 */

import 'server-only';

import { decryptSecret, encryptSecret } from '@/lib/services/secret-encryption';
import type { SupabaseClient } from '@supabase/supabase-js';

export const CAPI_TOKEN_COLUMN_NAMES = [
  'facebook_capi_token',
  'facebook_capi_token_encrypted',
  'facebook_capi_token_iv',
  'facebook_capi_token_tag',
] as const;

/** Column list for `.select()` calls that need to resolve the token. */
export const CAPI_TOKEN_SELECT = CAPI_TOKEN_COLUMN_NAMES.join(', ');

type CapiTokenColumnName = typeof CAPI_TOKEN_COLUMN_NAMES[number];

export type CapiTokenColumns = Partial<Record<CapiTokenColumnName, string | null>>;

// Structural so both the typed admin client and the untyped service client fit.
type IntegrationsWriter = Pick<SupabaseClient, 'from'>;

/**
 * Column values for saving a token: ciphertext + cleared plaintext, or all
 * columns cleared when `token` is null. Throws when encryption is not
 * configured (APP_ENCRYPTION_KEY) — a token is never stored in plaintext.
 */
export async function encryptCapiTokenColumns(
  token: string | null,
): Promise<Record<CapiTokenColumnName, string | null>> {
  if (token === null) {
    return {
      facebook_capi_token: null,
      facebook_capi_token_encrypted: null,
      facebook_capi_token_iv: null,
      facebook_capi_token_tag: null,
    };
  }
  const encrypted = await encryptSecret(token);
  return {
    facebook_capi_token: null,
    facebook_capi_token_encrypted: encrypted.encryptedKey,
    facebook_capi_token_iv: encrypted.iv,
    facebook_capi_token_tag: encrypted.tag,
  };
}

/**
 * Column changes for a token value received from a save:
 *   undefined or blank → no change (the stored token is kept)
 *   null               → token removed
 *   string             → token encrypted
 */
export async function capiTokenUpdateColumns(
  value: string | null | undefined,
): Promise<Partial<Record<CapiTokenColumnName, string | null>>> {
  if (value === undefined) return {};
  if (value === null) return encryptCapiTokenColumns(null);
  const trimmed = value.trim();
  if (!trimmed) return {};
  return encryptCapiTokenColumns(trimmed);
}

/**
 * Encrypts a legacy plaintext token in place. Returns true when the row was
 * converted. Never throws: on any failure the plaintext value stays where it
 * is and keeps working.
 */
export async function upgradeLegacyCapiToken(
  client: IntegrationsWriter,
  plaintext: string,
): Promise<boolean> {
  try {
    const columns = await encryptCapiTokenColumns(plaintext);
    const { data, error } = await client
      .from('integrations_config')
      .update(columns)
      .eq('id', 1)
      .eq('facebook_capi_token', plaintext)
      .is('facebook_capi_token_encrypted', null)
      .select('id');
    if (error) {
      console.error('[upgradeLegacyCapiToken] Update failed:', error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error(
      '[upgradeLegacyCapiToken] Not converted:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return false;
  }
}

/**
 * Returns the usable token for a config row: the decrypted value when present,
 * otherwise the legacy plaintext value. When `upgradeClient` is given, a legacy
 * plaintext value is also converted to ciphertext in place.
 */
export async function resolveCapiToken(
  row: CapiTokenColumns | null | undefined,
  upgradeClient?: IntegrationsWriter,
): Promise<string | null> {
  if (!row) return null;

  if (row.facebook_capi_token_encrypted && row.facebook_capi_token_iv && row.facebook_capi_token_tag) {
    try {
      return await decryptSecret({
        encrypted_key: row.facebook_capi_token_encrypted,
        encryption_iv: row.facebook_capi_token_iv,
        encryption_tag: row.facebook_capi_token_tag,
      });
    } catch (error) {
      console.error(
        '[resolveCapiToken] Decryption failed:',
        error instanceof Error ? error.message : 'Unknown error',
      );
      return row.facebook_capi_token || null;
    }
  }

  const legacy = row.facebook_capi_token || null;
  if (legacy && upgradeClient) {
    await upgradeLegacyCapiToken(upgradeClient, legacy);
  }
  return legacy;
}

/**
 * Replaces every token column of a config row with a `facebook_capi_token_set`
 * flag, so the admin UI learns whether a token exists without receiving it.
 */
export function redactCapiToken<T extends Record<string, unknown>>(
  row: T,
): Omit<T, CapiTokenColumnName> & { facebook_capi_token_set: boolean } {
  const rest: Record<string, unknown> = { ...row };
  for (const column of CAPI_TOKEN_COLUMN_NAMES) delete rest[column];
  const isSet = Boolean(row.facebook_capi_token_encrypted || row.facebook_capi_token);
  return { ...(rest as Omit<T, CapiTokenColumnName>), facebook_capi_token_set: isSet };
}

/**
 * Replaces the token columns of a config row with the resolved plaintext
 * `facebook_capi_token`, the shape the tracking destinations consume.
 */
export async function withResolvedCapiToken<T extends CapiTokenColumns>(
  row: T,
  upgradeClient?: IntegrationsWriter,
): Promise<Omit<T, CapiTokenColumnName> & { facebook_capi_token: string | null }> {
  const token = await resolveCapiToken(row, upgradeClient);
  const rest: Record<string, unknown> = { ...row };
  for (const column of CAPI_TOKEN_COLUMN_NAMES) delete rest[column];
  return { ...(rest as Omit<T, CapiTokenColumnName>), facebook_capi_token: token };
}

/**
 * One-time conversion run at server start: encrypts a stored legacy plaintext
 * token so existing installs are converted without waiting for the first
 * tracking event. Safe to run on every boot (no-op once converted).
 */
export async function upgradeStoredLegacyCapiToken(client: IntegrationsWriter): Promise<boolean> {
  try {
    const { data, error } = await client
      .from('integrations_config')
      .select('facebook_capi_token, facebook_capi_token_encrypted')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return false;
    const row = data as CapiTokenColumns;
    if (row.facebook_capi_token_encrypted || !row.facebook_capi_token) return false;
    return upgradeLegacyCapiToken(client, row.facebook_capi_token);
  } catch (error) {
    console.error(
      '[upgradeStoredLegacyCapiToken] Error:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return false;
  }
}
