import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/services/secret-encryption'
import type { StripeConfiguration, StripeMode } from '@/types/stripe-config'

async function readActiveStripeConfig(mode: StripeMode): Promise<StripeConfiguration | null> {
  try {
    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('stripe_configurations')
      .select('*')
      .eq('mode', mode)
      .eq('is_active', true)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      console.error('[readActiveStripeConfig] DB error:', error)
      return null
    }
    return data as unknown as StripeConfiguration
  } catch (error) {
    console.error('[readActiveStripeConfig] Error:', error)
    return null
  }
}

export async function getDecryptedStripeKeyInternal(mode: StripeMode): Promise<string | null> {
  try {
    const config = await readActiveStripeConfig(mode)
    if (!config) return null
    return await decryptSecret({
      encrypted_key: config.encrypted_key,
      encryption_iv: config.encryption_iv,
      encryption_tag: config.encryption_tag,
    })
  } catch (error) {
    console.error('[getDecryptedStripeKeyInternal] Error:', error)
    return null
  }
}

export async function getDecryptedWebhookSecretInternal(): Promise<string | null> {
  try {
    const adminClient = createAdminClient()
    const { data } = await adminClient
      .from('stripe_configurations')
      .select('webhook_signing_secret_enc, webhook_signing_iv, webhook_signing_tag')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!data?.webhook_signing_secret_enc || !data.webhook_signing_iv || !data.webhook_signing_tag) {
      return null
    }

    return await decryptSecret({
      encrypted_key: data.webhook_signing_secret_enc,
      encryption_iv: data.webhook_signing_iv,
      encryption_tag: data.webhook_signing_tag,
    })
  } catch (error) {
    console.error('[getDecryptedWebhookSecretInternal] Error:', error)
    return null
  }
}
