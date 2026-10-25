/**
 * Shared direct-database API key setup for Playwright specs.
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

interface ApiKeyFixtureResult {
  data: Database['public']['Tables']['api_keys']['Row'];
  error: null;
}

type ApiKeyInput = Omit<Database['public']['Tables']['api_keys']['Insert'], 'key_prefix' | 'key_hash'>;

export async function insertTestApiKey(client: SupabaseClient, plaintext: string, input: ApiKeyInput): Promise<ApiKeyFixtureResult> {
  const result = await client.from('api_keys').insert({
    ...input,
    key_prefix: plaintext.slice(0, 16),
    key_hash: createHash('sha256').update(plaintext).digest('hex'),
  }).select().single();
  expect(result.error).toBeNull();
  expect(result.data).not.toBeNull();
  return { data: result.data, error: null };
}
