'use server';

import { createClient } from '@/lib/supabase/server';
import { encryptCurrencyKey, decryptCurrencyKey } from '@/lib/services/currency-encryption';
import { revalidatePath } from 'next/cache';
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard';
import { withAdminAuth } from '@/lib/actions/admin-auth';
import type { ActionResponse } from '@/lib/actions/admin-auth';

export interface CurrencyConfig {
  enabled: boolean;
  hasKey: boolean;
  provider: 'exchangerate-api' | 'fixer' | 'ecb';
  configuredIn: 'env' | 'database' | 'both' | 'none';
  hasEnvConfig: boolean;
  hasDatabaseConfig: boolean;
}

export interface SaveCurrencyConfigInput {
  provider: 'exchangerate-api' | 'fixer' | 'ecb';
  apiKey?: string; // Optional - only required for exchangerate-api and fixer
  enabled: boolean;
}

/**
 * Saves/updates Currency API configuration in integrations_config
 */
export async function saveCurrencyConfig(input: SaveCurrencyConfigInput): Promise<ActionResponse<void>> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }

  return withAdminAuth(async ({ supabase }) => {
    // Validation: exchangerate-api and fixer require API key
    if ((input.provider === 'exchangerate-api' || input.provider === 'fixer') && !input.apiKey) {
      return {
        success: false,
        error: `${input.provider} requires an API key`,
        errorCode: 'INVALID_INPUT'
      };
    }

    // Validation: ecb should NOT have API key
    if (input.provider === 'ecb' && input.apiKey) {
      return {
        success: false,
        error: `${input.provider} does not use an API key`,
        errorCode: 'INVALID_INPUT'
      };
    }

    // Validation: API key format if provided
    if (input.apiKey) {
      const trimmedKey = input.apiKey.trim();
      if (trimmedKey.length < 10) {
        return {
          success: false,
          error: 'API key seems too short (minimum 10 characters)',
          errorCode: 'INVALID_INPUT'
        };
      }
    }

    // Prepare update object
    const updateData: any = {
      currency_api_provider: input.provider,
      currency_api_enabled: input.enabled,
      updated_at: new Date().toISOString()
    };

    // Encrypt API key if provided
    if (input.apiKey) {
      const encrypted = await encryptCurrencyKey(input.apiKey.trim());
      updateData.currency_api_key_encrypted = encrypted.encryptedKey;
      updateData.currency_api_key_iv = encrypted.iv;
      updateData.currency_api_key_tag = encrypted.tag;
    } else {
      // Clear encrypted key if switching to ecb or manual
      updateData.currency_api_key_encrypted = null;
      updateData.currency_api_key_iv = null;
      updateData.currency_api_key_tag = null;
    }

    // Update integrations_config
    const { error } = await supabase
      .from('integrations_config')
      .update(updateData)
      .eq('id', 1); // integrations_config is a singleton table

    if (error) {
      console.error('[saveCurrencyConfig] Database update error:', error);
      return {
        success: false,
        error: 'Failed to save configuration',
        errorCode: 'DATABASE_ERROR'
      };
    }

    revalidatePath('/dashboard/integrations');
    revalidatePath('/dashboard');

    return { success: true };
  });
}

/**
 * Gets Currency configuration status (without decrypting the key)
 * Checks both .env and database for configuration
 */
export async function getCurrencyConfig(): Promise<ActionResponse<CurrencyConfig>> {
  try {
    // Check if provider and key are in environment (METHOD 1)
    const envProvider = (process.env.NEXT_PUBLIC_CURRENCY_PROVIDER || 'ecb') as any;
    const envKey = process.env.CURRENCY_API_KEY;
    const hasEnvKey = !!(envKey && envKey.trim().length > 0);
    const hasEnvConfig = !!(envProvider && envProvider !== 'ecb'); // Has explicit config (not just default)

    // Check database for configuration (METHOD 2)
    const supabase = await createClient();

    const { data: config } = await supabase
      .from('integrations_config')
      .select('currency_api_provider, currency_api_key_encrypted, currency_api_enabled')
      .eq('id', 1)
      .single();

    const hasDatabaseKey = !!(config?.currency_api_key_encrypted);
    const databaseProvider = config?.currency_api_provider || 'ecb';
    const databaseEnabled = config?.currency_api_enabled === true;
    const hasDatabaseConfig = databaseProvider !== 'ecb' || hasDatabaseKey;

    // Determine effective configuration
    let provider: CurrencyConfig['provider'];
    let enabled: boolean;
    let hasKey: boolean;
    let configuredIn: CurrencyConfig['configuredIn'];

    // Priority: Database > .env
    if (hasDatabaseConfig && databaseEnabled) {
      provider = databaseProvider as any;
      enabled = true;
      hasKey = hasDatabaseKey || databaseProvider === 'ecb'; // ecb doesn't need key
      configuredIn = hasEnvConfig ? 'both' : 'database';
    } else if (hasEnvConfig) {
      provider = envProvider;
      enabled = true;
      hasKey = hasEnvKey || envProvider === 'ecb';
      configuredIn = 'env';
    } else {
      provider = 'ecb';
      enabled = true; // Always enabled (ECB is free default)
      hasKey = true; // ECB doesn't need API key
      configuredIn = 'none';
    }

    return {
      success: true,
      data: {
        enabled,
        hasKey,
        provider,
        configuredIn,
        hasEnvConfig,
        hasDatabaseConfig: hasDatabaseConfig && databaseEnabled,
      }
    };
  } catch (error) {
    console.error('Error fetching Currency config:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'UNKNOWN_ERROR'
    };
  }
}

/**
 * Gets decrypted Currency API configuration (server-side only)
 *
 * Method priority:
 * 1. Database encrypted config (METHOD 1 - recommended for non-technical users via UI)
 * 2. NEXT_PUBLIC_CURRENCY_PROVIDER + CURRENCY_API_KEY from .env (METHOD 2 - for developers)
 * 3. Manual fallback (METHOD 3 - always works)
 *
 * Returns { provider, apiKey } or null if disabled
 */
export async function getDecryptedCurrencyConfig(): Promise<{ provider: string; apiKey: string | null } | null> {
  try {
    // METHOD 1: Check database first (priority)
    const supabase = await createClient();

    const { data: config } = await supabase
      .from('integrations_config')
      .select('currency_api_provider, currency_api_key_encrypted, currency_api_key_iv, currency_api_key_tag, currency_api_enabled')
      .eq('id', 1)
      .single();

    if (config?.currency_api_enabled && config?.currency_api_provider) {
      const provider = config.currency_api_provider;

      // If provider needs a key, decrypt it
      if ((provider === 'exchangerate-api' || provider === 'fixer') && config.currency_api_key_encrypted) {
        const decryptedKey = await decryptCurrencyKey({
          encrypted_key: config.currency_api_key_encrypted,
          encryption_iv: config.currency_api_key_iv,
          encryption_tag: config.currency_api_key_tag,
        });

        return { provider, apiKey: decryptedKey };
      }

      // ECB doesn't need API key
      if (provider === 'ecb') {
        return { provider, apiKey: null };
      }
    }

    // METHOD 2: Fallback to environment variables
    const envProvider = process.env.NEXT_PUBLIC_CURRENCY_PROVIDER || 'ecb';
    const envKey = process.env.CURRENCY_API_KEY;

    if (envProvider && envProvider !== 'ecb') {
      return {
        provider: envProvider,
        apiKey: envKey?.trim() || null
      };
    }

    // METHOD 3: Final fallback to ECB (free, no key needed)
    return { provider: 'ecb', apiKey: null };
  } catch (error) {
    console.error('Error decrypting Currency config:', error);
    // Fallback to ECB on error
    return { provider: 'ecb', apiKey: null };
  }
}

/**
 * Deletes Currency API configuration from integrations_config
 */
export async function deleteCurrencyConfig(): Promise<ActionResponse<void>> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }

  return withAdminAuth(async ({ supabase }) => {
    // Clear Currency config from integrations_config
    const { error } = await supabase
      .from('integrations_config')
      .update({
        currency_api_provider: 'ecb',
        currency_api_key_encrypted: null,
        currency_api_key_iv: null,
        currency_api_key_tag: null,
        currency_api_enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);

    if (error) {
      console.error('Failed to delete Currency config:', error);
      return {
        success: false,
        error: 'Failed to delete configuration',
        errorCode: 'DATABASE_ERROR'
      };
    }

    revalidatePath('/dashboard/integrations');
    revalidatePath('/dashboard');

    return { success: true };
  });
}
