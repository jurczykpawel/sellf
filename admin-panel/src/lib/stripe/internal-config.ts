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

export interface StripeWebhookSecretStatus {
  envConfigured: boolean
  dbPresent: boolean
  dbDecryptable: boolean
}

/**
 * Cheap status snapshot of the Stripe webhook secret across env + DB. Does
 * not return the secret itself — only flags. Lets the security audit tell
 * the difference between "not configured anywhere" (payments silently
 * fail) and "DB has it but APP_ENCRYPTION_KEY no longer decrypts it"
 * (worst case: payments silently fail after a key rotation).
 */
export async function getStripeWebhookSecretStatus(): Promise<StripeWebhookSecretStatus> {
  const envConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET)
  // Bound the DB lookup — security-audit calls this on every run and we never
  // want a slow / unreachable Supabase to hang the audit. Treat a hang the
  // same as "DB unreachable from this check" → fall back to env-only signal.
  const dbTimeout = new Promise<{ data: null }>((resolve) =>
    setTimeout(() => resolve({ data: null }), 2500),
  )
  try {
    const adminClient = createAdminClient()
    const query = adminClient
      .from('stripe_configurations')
      .select('webhook_signing_secret_enc, webhook_signing_iv, webhook_signing_tag')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const { data } = await Promise.race([query, dbTimeout])

    const dbPresent = Boolean(
      data?.webhook_signing_secret_enc && data?.webhook_signing_iv && data?.webhook_signing_tag,
    )
    if (!dbPresent) return { envConfigured, dbPresent: false, dbDecryptable: false }

    try {
      const decrypted = await decryptSecret({
        encrypted_key: data!.webhook_signing_secret_enc as string,
        encryption_iv: data!.webhook_signing_iv as string,
        encryption_tag: data!.webhook_signing_tag as string,
      })
      return { envConfigured, dbPresent: true, dbDecryptable: Boolean(decrypted) }
    } catch {
      return { envConfigured, dbPresent: true, dbDecryptable: false }
    }
  } catch {
    return { envConfigured, dbPresent: false, dbDecryptable: false }
  }
}
