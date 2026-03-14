'use server';

import { createClient } from '@/lib/supabase/server';
import { encryptGUSKey, decryptGUSKey } from '@/lib/services/gus-encryption';
import { revalidatePath } from 'next/cache';
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard';
import { withAdminAuth } from '@/lib/actions/admin-auth';
import type { ActionResponse } from '@/lib/actions/admin-auth';

export interface GUSConfig {
  enabled: boolean;
  hasKey: boolean;
}

export interface SaveGUSKeyInput {
  apiKey: string;
  enabled: boolean;
}

/**
 * Saves/updates GUS API key in shop_config.custom_settings
 */
export async function saveGUSAPIKey(input: SaveGUSKeyInput): Promise<ActionResponse<void>> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }

  return withAdminAuth(async ({ supabase }) => {
    // Basic validation
    const trimmedKey = input.apiKey.trim();

    // If KEEP_EXISTING sentinel, only update enabled status without touching the key
    if (trimmedKey === 'KEEP_EXISTING') {
      const { error } = await supabase
        .from('integrations_config')
        .update({
          gus_api_enabled: input.enabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', 1);

      if (error) {
        console.error('[saveGUSAPIKey] Failed to update enabled status:', error);
        return {
          success: false,
          error: 'Failed to update configuration',
          errorCode: 'DATABASE_ERROR'
        };
      }

      revalidatePath('/dashboard/integrations');
      return { success: true };
    }

    // Validate new key
    if (!trimmedKey) {
      return {
        success: false,
        error: 'API key is required',
        errorCode: 'INVALID_INPUT'
      };
    }

    if (trimmedKey.length < 10) {
      return {
        success: false,
        error: 'API key seems too short',
        errorCode: 'INVALID_INPUT'
      };
    }

    // Encrypt the API key
    const encrypted = await encryptGUSKey(trimmedKey);

    // Update integrations_config with encrypted GUS key
    const { error } = await supabase
      .from('integrations_config')
      .update({
        gus_api_key_encrypted: encrypted.encryptedKey,
        gus_api_key_iv: encrypted.iv,
        gus_api_key_tag: encrypted.tag,
        gus_api_enabled: input.enabled,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1); // integrations_config is a singleton table

    if (error) {
      console.error('[saveGUSAPIKey] Database update error:', error);
      return {
        success: false,
        error: 'Failed to save configuration',
        errorCode: 'DATABASE_ERROR'
      };
    }

    revalidatePath('/dashboard/integrations');

    return { success: true };
  });
}

/**
 * Gets GUS configuration status (without decrypting the key)
 * Checks both .env and database for key presence
 */
export async function getGUSConfig(): Promise<ActionResponse<GUSConfig>> {
  try {
    // Check if key is in environment (METHOD 1)
    const envKey = process.env.GUS_API_KEY;
    const hasEnvKey = !!(envKey && envKey.trim().length > 0);

    // Check database for encrypted key (METHOD 2)
    const supabase = await createClient();

    const { data: config } = await supabase
      .from('integrations_config')
      .select('gus_api_key_encrypted, gus_api_enabled')
      .eq('id', 1)
      .single();

    const hasDatabaseKey = !!(config?.gus_api_key_encrypted);
    const enabled = config?.gus_api_enabled === true;

    // Key exists if either method has a key
    const hasKey = hasEnvKey || hasDatabaseKey;

    return {
      success: true,
      data: {
        enabled: hasEnvKey || enabled, // If env key exists, consider it enabled
        hasKey,
      }
    };
  } catch (error) {
    console.error('Error fetching GUS config:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'UNKNOWN_ERROR'
    };
  }
}

/**
 * Gets decrypted GUS API key (server-side only)
 *
 * Method priority:
 * 1. Encrypted key from database (DB takes priority — set via admin panel)
 * 2. GUS_API_KEY from .env (fallback for developers)
 *
 * Returns null if not configured or if GUS is disabled
 */
export async function getDecryptedGUSAPIKey(): Promise<string | null> {
  try {
    // METHOD 1: Check database first (priority)
    const supabase = await createClient();

    const { data: config } = await supabase
      .from('integrations_config')
      .select('gus_api_key_encrypted, gus_api_key_iv, gus_api_key_tag, gus_api_enabled')
      .eq('id', 1)
      .single();

    // If DB has an encrypted key and GUS is enabled, use it
    if (config?.gus_api_enabled === true && config?.gus_api_key_encrypted) {
      const decrypted = await decryptGUSKey({
        encrypted_key: config.gus_api_key_encrypted,
        encryption_iv: config.gus_api_key_iv,
        encryption_tag: config.gus_api_key_tag,
      });
      return decrypted;
    }

    // METHOD 2: Fallback to environment variable
    const envKey = process.env.GUS_API_KEY;
    if (envKey && envKey.trim().length > 0) {
      return envKey.trim();
    }

    return null;
  } catch (error) {
    console.error('Error decrypting GUS API key:', error);
    return null;
  }
}

/**
 * Deletes GUS API key from integrations_config
 */
export async function deleteGUSAPIKey(): Promise<ActionResponse<void>> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }

  return withAdminAuth(async ({ supabase }) => {
    // Clear GUS keys from integrations_config
    const { error } = await supabase
      .from('integrations_config')
      .update({
        gus_api_key_encrypted: null,
        gus_api_key_iv: null,
        gus_api_key_tag: null,
        gus_api_enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);

    if (error) {
      console.error('Failed to delete GUS API key:', error);
      return {
        success: false,
        error: 'Failed to delete configuration',
        errorCode: 'DATABASE_ERROR'
      };
    }

    revalidatePath('/dashboard/integrations');

    return { success: true };
  });
}
