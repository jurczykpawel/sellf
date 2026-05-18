import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/services/secret-encryption'

async function decryptColumn(
  encrypted: string | null | undefined,
  iv: string | null | undefined,
  tag: string | null | undefined,
): Promise<string | null> {
  if (!encrypted || !iv || !tag) return null
  return decryptSecret({
    encrypted_key: encrypted,
    encryption_iv: iv,
    encryption_tag: tag,
  })
}

async function readIntegrationsConfig<T>(columns: string): Promise<T | null> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('integrations_config')
      .select(columns)
      .eq('id', 1)
      .single()
    return (data as T | null) ?? null
  } catch (error) {
    console.error('[readIntegrationsConfig] Error:', error)
    return null
  }
}

interface GUSConfigRow {
  gus_api_key_encrypted: string | null
  gus_api_key_iv: string | null
  gus_api_key_tag: string | null
  gus_api_enabled: boolean | null
}

export async function getDecryptedGUSAPIKeyInternal(): Promise<string | null> {
  try {
    const config = await readIntegrationsConfig<GUSConfigRow>(
      'gus_api_key_encrypted, gus_api_key_iv, gus_api_key_tag, gus_api_enabled',
    )

    if (config?.gus_api_enabled === true) {
      const decrypted = await decryptColumn(
        config.gus_api_key_encrypted,
        config.gus_api_key_iv,
        config.gus_api_key_tag,
      )
      if (decrypted) return decrypted
    }

    const envKey = process.env.GUS_API_KEY
    if (envKey && envKey.trim().length > 0) {
      return envKey.trim()
    }

    return null
  } catch (error) {
    console.error('[getDecryptedGUSAPIKeyInternal] Error:', error)
    return null
  }
}

interface CurrencyConfigRow {
  currency_api_provider: string | null
  currency_api_key_encrypted: string | null
  currency_api_key_iv: string | null
  currency_api_key_tag: string | null
  currency_api_enabled: boolean | null
}

export async function getDecryptedCurrencyConfigInternal(): Promise<{
  provider: string
  apiKey: string | null
} | null> {
  try {
    const config = await readIntegrationsConfig<CurrencyConfigRow>(
      'currency_api_provider, currency_api_key_encrypted, currency_api_key_iv, currency_api_key_tag, currency_api_enabled',
    )

    if (config?.currency_api_enabled && config.currency_api_provider) {
      const provider = config.currency_api_provider

      if (provider === 'exchangerate-api' || provider === 'fixer') {
        const apiKey = await decryptColumn(
          config.currency_api_key_encrypted,
          config.currency_api_key_iv,
          config.currency_api_key_tag,
        )
        return { provider, apiKey }
      }

      if (provider === 'ecb') {
        return { provider, apiKey: null }
      }
    }

    const envProvider = process.env.NEXT_PUBLIC_CURRENCY_PROVIDER || 'ecb'
    const envKey = process.env.CURRENCY_API_KEY

    if (envProvider !== 'ecb') {
      return { provider: envProvider, apiKey: envKey?.trim() || null }
    }

    return { provider: 'ecb', apiKey: null }
  } catch (error) {
    console.error('[getDecryptedCurrencyConfigInternal] Error:', error)
    return { provider: 'ecb', apiKey: null }
  }
}
