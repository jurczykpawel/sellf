'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptStripeKey, decryptStripeKey } from '@/lib/services/stripe-encryption'
import { requireAdminApi } from '@/lib/auth-server'
import { withAdminAuth } from '@/lib/actions/admin-auth'
import Stripe from 'stripe'
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard'
import { invalidateStripeCache } from '@/lib/stripe/server'
import type {
  StripeConfiguration,
  StripeMode,
  StripeKeyPrefix,
  KeyFormatValidationResult,
  ConnectionTestResult,
  PermissionVerificationResult,
  PermissionStatus,
  ValidationResult,
  ActionResponse,
  GetActiveConfigResponse,
  SaveConfigResponse,
  DeleteConfigResponse,
  ValidateKeyResponse,
  TestConnectionResponse,
  VerifyPermissionsResponse,
  CreateStripeConfigInput,
  REQUIRED_PERMISSIONS,
  RegisterWebhookResponse,
  WebhookRegistrationInfo,
} from '@/types/stripe-config'
import {
  findExistingWebhookEndpoint,
  buildWebhookParams,
  getWebhookRegistrationStatus,
} from '@/lib/stripe/webhook-registration'
import { STRIPE_API_VERSION } from '@/lib/constants'
import { revalidatePath } from 'next/cache'

/**
 * Validates Stripe API key format
 */
export async function validateStripeKeyFormat(apiKey: string): Promise<KeyFormatValidationResult> {
  const errors: string[] = []

  // Trim whitespace
  const trimmedKey = apiKey.trim()

  // Check if empty
  if (!trimmedKey) {
    errors.push('API key is required')
    return { isValid: false, errors }
  }

  // Check minimum length (Stripe keys are typically 30+ characters)
  if (trimmedKey.length < 30) {
    errors.push('API key is too short (minimum 30 characters)')
  }

  // Detect prefix and mode
  let detectedPrefix: StripeKeyPrefix | undefined
  let detectedMode: StripeMode | undefined

  if (trimmedKey.startsWith('rk_test_')) {
    detectedPrefix = 'rk_test_'
    detectedMode = 'test'
  } else if (trimmedKey.startsWith('rk_live_')) {
    detectedPrefix = 'rk_live_'
    detectedMode = 'live'
  } else if (trimmedKey.startsWith('sk_test_')) {
    detectedPrefix = 'sk_test_'
    detectedMode = 'test'
  } else if (trimmedKey.startsWith('sk_live_')) {
    detectedPrefix = 'sk_live_'
    detectedMode = 'live'
  } else {
    errors.push('Invalid key prefix. Must start with rk_test_, rk_live_, sk_test_, or sk_live_')
  }

  // Check for valid characters (alphanumeric + underscores)
  if (!/^[a-zA-Z0-9_]+$/.test(trimmedKey)) {
    errors.push('API key contains invalid characters')
  }

  return {
    isValid: errors.length === 0,
    errors,
    detectedMode,
    detectedPrefix,
  }
}

/**
 * Tests connection to Stripe API and retrieves account info
 */
export async function testStripeKeyConnection(apiKey: string): Promise<TestConnectionResponse> {
  try {
    // Admin-only: prevent using this server as a proxy to validate stolen Stripe keys
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'Unauthorized', errorCode: 'UNAUTHORIZED' }
    }
    await requireAdminApi(supabase)

    // Validate format first
    const formatValidation = await validateStripeKeyFormat(apiKey)
    if (!formatValidation.isValid) {
      return {
        success: false,
        error: formatValidation.errors.join(', '),
        errorCode: 'INVALID_FORMAT',
      }
    }

    // Initialize Stripe client with the provided key
    const stripe = new Stripe(apiKey.trim(), {
      apiVersion: '2026-04-22.dahlia',
      typescript: true,
    })

    // Test connection by retrieving account info
    const account = await stripe.accounts.retrieve(null)

    return {
      success: true,
      data: {
        success: true,
        accountId: account.id,
        accountName: account.business_profile?.name || account.email || 'Unknown',
      },
    }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeAuthenticationError) {
      return {
        success: false,
        error: 'Invalid API key. Please check your key and try again.',
        errorCode: 'AUTHENTICATION_FAILED',
      }
    }

    if (error instanceof Stripe.errors.StripePermissionError) {
      return {
        success: false,
        error: 'API key does not have permission to retrieve account information.',
        errorCode: 'PERMISSION_DENIED',
      }
    }

    if (error instanceof Stripe.errors.StripeAPIError) {
      console.error('[testStripeKeyConnection] Stripe API error:', error)
      return {
        success: false,
        error: 'Stripe API error occurred. Please try again later.',
        errorCode: error.code || 'API_ERROR',
      }
    }

    console.error('[testStripeKeyConnection] Error:', error)
    return {
      success: false,
      error: 'Failed to test Stripe connection',
      errorCode: 'UNKNOWN_ERROR',
    }
  }
}

/**
 * Verifies that the API key has all required permissions
 */
export async function verifyStripeKeyPermissions(apiKey: string): Promise<VerifyPermissionsResponse> {
  try {
    // Admin-only: prevent using this server as a proxy to validate stolen Stripe keys
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }
    await requireAdminApi(supabase)

    const stripe = new Stripe(apiKey.trim(), {
      apiVersion: '2026-04-22.dahlia',
      typescript: true,
    })

    // Clone required permissions to track verification
    const permissions: PermissionStatus[] = (
      [
        {
          resource: 'charges',
          operation: 'write',
          required: true,
          verified: false,
        },
        {
          resource: 'customers',
          operation: 'write',
          required: true,
          verified: false,
        },
        {
          resource: 'checkout.sessions',
          operation: 'write',
          required: true,
          verified: false,
        },
        {
          resource: 'payment_intents',
          operation: 'read',
          required: true,
          verified: false,
        },
        {
          resource: 'webhooks',
          operation: 'read',
          required: false,
          verified: false,
        },
        {
          resource: 'products',
          operation: 'read',
          required: false,
          verified: false,
        },
        {
          resource: 'prices',
          operation: 'read',
          required: false,
          verified: false,
        },
      ] as const
    ).map(p => ({ ...p }))

    // Test each permission by attempting a minimal operation
    // Note: For restricted keys, Stripe will return permission errors if access is denied

    // Test charges (write) - List charges (read-like but requires charges scope)
    try {
      await stripe.charges.list({ limit: 1 })
      const chargesPerm = permissions.find(p => p.resource === 'charges')
      if (chargesPerm) chargesPerm.verified = true
    } catch (error) {
      if (error instanceof Stripe.errors.StripePermissionError) {
        const chargesPerm = permissions.find(p => p.resource === 'charges')
        if (chargesPerm) chargesPerm.errorMessage = 'Missing charges permission'
      }
    }

    // Test customers (write)
    try {
      await stripe.customers.list({ limit: 1 })
      const customersPerm = permissions.find(p => p.resource === 'customers')
      if (customersPerm) customersPerm.verified = true
    } catch (error) {
      if (error instanceof Stripe.errors.StripePermissionError) {
        const customersPerm = permissions.find(p => p.resource === 'customers')
        if (customersPerm) customersPerm.errorMessage = 'Missing customers permission'
      }
    }

    // Test checkout.sessions (write)
    try {
      await stripe.checkout.sessions.list({ limit: 1 })
      const sessionsPerm = permissions.find(p => p.resource === 'checkout.sessions')
      if (sessionsPerm) sessionsPerm.verified = true
    } catch (error) {
      if (error instanceof Stripe.errors.StripePermissionError) {
        const sessionsPerm = permissions.find(p => p.resource === 'checkout.sessions')
        if (sessionsPerm) sessionsPerm.errorMessage = 'Missing checkout sessions permission'
      }
    }

    // Test payment_intents (read)
    try {
      await stripe.paymentIntents.list({ limit: 1 })
      const piPerm = permissions.find(p => p.resource === 'payment_intents')
      if (piPerm) piPerm.verified = true
    } catch (error) {
      if (error instanceof Stripe.errors.StripePermissionError) {
        const piPerm = permissions.find(p => p.resource === 'payment_intents')
        if (piPerm) piPerm.errorMessage = 'Missing payment intents permission'
      }
    }

    // Test webhooks (read) - Optional
    try {
      await stripe.webhookEndpoints.list({ limit: 1 })
      const webhooksPerm = permissions.find(p => p.resource === 'webhooks')
      if (webhooksPerm) webhooksPerm.verified = true
    } catch (error) {
      // Webhooks permission is optional, so we don't fail on this
      const webhooksPerm = permissions.find(p => p.resource === 'webhooks')
      if (webhooksPerm && error instanceof Stripe.errors.StripePermissionError) {
        webhooksPerm.errorMessage = 'Missing webhooks permission (optional)'
      }
    }

    // Test products (read) - Optional
    try {
      await stripe.products.list({ limit: 1 })
      const productsPerm = permissions.find(p => p.resource === 'products')
      if (productsPerm) productsPerm.verified = true
    } catch (error) {
      const productsPerm = permissions.find(p => p.resource === 'products')
      if (productsPerm && error instanceof Stripe.errors.StripePermissionError) {
        productsPerm.errorMessage = 'Missing products permission (optional)'
      }
    }

    // Test prices (read) - Optional
    try {
      await stripe.prices.list({ limit: 1 })
      const pricesPerm = permissions.find(p => p.resource === 'prices')
      if (pricesPerm) pricesPerm.verified = true
    } catch (error) {
      const pricesPerm = permissions.find(p => p.resource === 'prices')
      if (pricesPerm && error instanceof Stripe.errors.StripePermissionError) {
        pricesPerm.errorMessage = 'Missing prices permission (optional)'
      }
    }

    // Check if all required permissions are granted
    const missingPermissions = permissions.filter(p => p.required && !p.verified)
    const allGranted = missingPermissions.length === 0

    return {
      success: true,
      data: {
        allGranted,
        permissions,
        missingPermissions,
      },
    }
  } catch (error) {
    console.error('[verifyStripeKeyPermissions] Error:', error)
    return {
      success: false,
      error: 'Failed to verify Stripe key permissions',
      errorCode: 'PERMISSION_CHECK_FAILED',
    }
  }
}

/**
 * Complete validation: format + connection + permissions
 */
export async function validateStripeKey(apiKey: string, expectedMode?: StripeMode): Promise<ValidateKeyResponse> {
  // Step 1: Format validation
  const formatValidation = await validateStripeKeyFormat(apiKey)

  if (!formatValidation.isValid) {
    return {
      success: true,
      data: {
        isValid: false,
        formatValidation,
      },
    }
  }

  // Check if mode matches expected mode
  if (expectedMode && formatValidation.detectedMode !== expectedMode) {
    return {
      success: true,
      data: {
        isValid: false,
        formatValidation: {
          ...formatValidation,
          isValid: false,
          errors: [
            ...formatValidation.errors,
            `You selected ${expectedMode} mode but pasted a ${formatValidation.detectedMode} key`,
          ],
        },
      },
    }
  }

  // Step 2: Connection test
  const connectionTest = await testStripeKeyConnection(apiKey)

  if (!connectionTest.success || !connectionTest.data?.success) {
    return {
      success: true,
      data: {
        isValid: false,
        formatValidation,
        connectionTest: connectionTest.data || {
          success: false,
          error: connectionTest.error,
          errorCode: connectionTest.errorCode,
        },
      },
    }
  }

  // Step 3: Permission verification
  const permissionVerification = await verifyStripeKeyPermissions(apiKey)

  if (!permissionVerification.success || !permissionVerification.data) {
    return {
      success: true,
      data: {
        isValid: false,
        formatValidation,
        connectionTest: connectionTest.data,
        permissionVerification: {
          allGranted: false,
          permissions: [],
          missingPermissions: [],
        },
      },
    }
  }

  return {
    success: true,
    data: {
      isValid: permissionVerification.data.allGranted,
      formatValidation,
      connectionTest: connectionTest.data,
      permissionVerification: permissionVerification.data,
    },
  }
}

/**
 * Saves a new Stripe configuration to the database (encrypted)
 */
export async function saveStripeConfig(input: CreateStripeConfigInput): Promise<SaveConfigResponse> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }
  // Platform admin only — sellers use Stripe Connect, not raw API keys
  return withAdminAuth(async ({ supabase: _supabase }) => {
    const dataClient = createAdminClient();
    // Validate the key first
    const validation = await validateStripeKey(input.apiKey, input.mode)
    if (!validation.success || !validation.data?.isValid) {
      return {
        success: false,
        error: 'API key validation failed',
        errorCode: 'VALIDATION_FAILED',
      }
    }

    const formatResult = validation.data.formatValidation

    // Encrypt the API key
    const encrypted = await encryptStripeKey(input.apiKey.trim())

    // Extract last 4 characters
    const keyLast4 = input.apiKey.trim().slice(-4)

    // Deactivate any existing active configurations for this mode
    await dataClient
      .from('stripe_configurations')
      .update({ is_active: false })
      .eq('mode', input.mode)
      .eq('is_active', true)

    // Insert new configuration
    const { data, error } = await dataClient
      .from('stripe_configurations')
      .insert({
        mode: input.mode,
        encrypted_key: encrypted.encryptedKey,
        encryption_iv: encrypted.iv,
        encryption_tag: encrypted.tag,
        key_last_4: keyLast4,
        key_prefix: formatResult.detectedPrefix!,
        permissions_verified: true,
        last_validated_at: new Date().toISOString(),
        account_id: validation.data.connectionTest?.accountId || null,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
        is_active: true,
      })
      .select('id, mode')
      .single()

    if (error) {
      console.error('Failed to save Stripe configuration:', error)
      return {
        success: false,
        error: 'Failed to save configuration to database',
        errorCode: 'DATABASE_ERROR',
      }
    }

    // Invalidate cached Stripe instance so the new key is used immediately
    invalidateStripeCache()

    revalidatePath('/dashboard/settings')

    return {
      success: true,
      data: {
        id: data.id,
        mode: data.mode as StripeMode,
      },
    }
  })
}

/**
 * Internal helper: retrieves active config using service-role client.
 * Used by server-side callers (getStripeServer, verifyWebhookSignature) that
 * run outside a user session (e.g. webhook handlers, checkout flows).
 */
async function getActiveStripeConfigInternal(mode: StripeMode): Promise<GetActiveConfigResponse> {
  try {
    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('stripe_configurations')
      .select('*')
      .eq('mode', mode)
      .eq('is_active', true)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: true, data: null }
      }
      console.error('Failed to retrieve Stripe configuration:', error)
      return {
        success: false,
        error: 'Failed to retrieve configuration',
        errorCode: 'DATABASE_ERROR',
      }
    }

    return { success: true, data: data as StripeConfiguration }
  } catch (error) {
    console.error('[getActiveStripeConfigInternal] Error:', error)
    return {
      success: false,
      error: 'Failed to retrieve Stripe configuration',
      errorCode: 'UNKNOWN_ERROR',
    }
  }
}

/**
 * Retrieves the active Stripe configuration for a given mode
 */
export async function getActiveStripeConfig(mode: StripeMode): Promise<GetActiveConfigResponse> {
  // Platform admin only — seller schemas don't have stripe_configurations
  return withAdminAuth(async () => {
    const dataClient = createAdminClient();
    const { data, error } = await dataClient
      .from('stripe_configurations')
      .select('*')
      .eq('mode', mode)
      .eq('is_active', true)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found
        return { success: true, data: null }
      }
      console.error('Failed to retrieve Stripe configuration:', error)
      return {
        success: false,
        error: 'Failed to retrieve configuration',
        errorCode: 'DATABASE_ERROR',
      }
    }

    return { success: true, data: data as StripeConfiguration }
  })
}

/**
 * Internal helper: decrypts active Stripe key using service-role client.
 * Used by server-side callers that run outside a user session.
 */
export async function getDecryptedStripeKeyInternal(mode: StripeMode): Promise<string | null> {
  try {
    const configResponse = await getActiveStripeConfigInternal(mode)

    if (!configResponse.success || !configResponse.data) {
      return null
    }

    return await decryptStripeKey({
      encrypted_key: configResponse.data.encrypted_key,
      encryption_iv: configResponse.data.encryption_iv,
      encryption_tag: configResponse.data.encryption_tag,
    })
  } catch (error) {
    console.error('[getDecryptedStripeKeyInternal] Error:', error)
    return null
  }
}

/**
 * Retrieves and decrypts the active Stripe API key for a given mode.
 * Platform admin only — sellers use Stripe Connect, not raw API keys.
 */
export async function getDecryptedStripeKey(mode: StripeMode): Promise<string | null> {
  const result = await withAdminAuth(async () => {
    const decrypted = await getDecryptedStripeKeyInternal(mode)
    return { success: true, data: decrypted }
  })
  if (!result.success) return null
  return result.data ?? null
}

/**
 * Deletes a Stripe configuration
 */
export async function deleteStripeConfig(id: string): Promise<DeleteConfigResponse> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }
  // Platform admin only — sellers cannot delete Stripe configurations
  return withAdminAuth(async () => {
    const dataClient = createAdminClient();
    const { error } = await dataClient.from('stripe_configurations').delete().eq('id', id)

    if (error) {
      console.error('Failed to delete Stripe configuration:', error)
      return {
        success: false,
        error: 'Failed to delete configuration',
        errorCode: 'DATABASE_ERROR',
      }
    }

    revalidatePath('/dashboard/settings')

    return { success: true }
  })
}

/**
 * Returns the connected Stripe account name and ID by calling Stripe API live.
 * Uses DB config if available, falls back to STRIPE_SECRET_KEY env var.
 * Returns null in demo mode or when no key is configured.
 */
export async function getStripeAccountInfo(): Promise<{ accountId: string | null; accountName: string | null } | null> {
  if (isDemoMode()) return null
  try {
    const supabase = await createClient()
    try { await requireAdminApi(supabase) } catch { return null }
    const mode: StripeMode = process.env.NODE_ENV === 'production' ? 'live' : 'test'
    const apiKey = await getDecryptedStripeKeyInternal(mode) || process.env.STRIPE_SECRET_KEY
    if (!apiKey) return null

    const stripe = new Stripe(apiKey, { apiVersion: '2026-04-22.dahlia' })
    const account = await stripe.accounts.retrieve(null)
    const anyAccount = account as { business_profile?: { name?: string | null }; email?: string | null }
    return {
      accountId: account.id,
      accountName: anyAccount.business_profile?.name || anyAccount.email || null,
    }
  } catch (error) {
    console.error('[getStripeAccountInfo] Error:', error)
    return null
  }
}

/**
 * Detects the active Stripe key source (db, env, or none).
 * Must live here (in a 'use server' file) so process.env is accessible
 * when called from client components.
 */
export async function getStripeKeySource(): Promise<{ activeSource: 'db' | 'env' | 'none'; dbConfigured: boolean; envConfigured: boolean }> {
  const supabase = await createClient()
  try { await requireAdminApi(supabase) } catch { return { activeSource: 'none', dbConfigured: false, envConfigured: false } }
  const envConfigured = !!process.env.STRIPE_SECRET_KEY
  const mode: StripeMode = process.env.NODE_ENV === 'production' ? 'live' : 'test'

  let dbConfigured = false
  try {
    const dbKey = await getDecryptedStripeKeyInternal(mode)
    dbConfigured = !!dbKey
  } catch {
    // DB not available — ignore
  }

  let activeSource: 'db' | 'env' | 'none' = 'none'
  if (dbConfigured) activeSource = 'db'
  else if (envConfigured) activeSource = 'env'

  return { activeSource, dbConfigured, envConfigured }
}

/**
 * Lists all Stripe configurations (active and inactive)
 */
export async function listStripeConfigs(): Promise<ActionResponse<StripeConfiguration[]>> {
  // Platform admin only — sellers don't manage platform Stripe keys
  return withAdminAuth(async () => {
    const dataClient = createAdminClient();
    const { data, error } = await dataClient
      .from('stripe_configurations')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to list Stripe configurations:', error)
      return {
        success: false,
        error: 'Failed to retrieve configurations',
        errorCode: 'DATABASE_ERROR',
      }
    }

    return { success: true, data: data as StripeConfiguration[] }
  })
}

/**
 * Returns the webhook registration info for the active Stripe configuration.
 * Used by StripeSettings to show registration status without triggering any mutations.
 */
export async function getWebhookRegistrationInfo(): Promise<WebhookRegistrationInfo> {
  try {
    const supabase = await createClient()
    try { await requireAdminApi(supabase) } catch { return { status: 'not_registered', endpointId: null } }

    const { data } = await supabase
      .from('stripe_configurations')
      .select('webhook_endpoint_id')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return {
      status: getWebhookRegistrationStatus(data),
      endpointId: data?.webhook_endpoint_id ?? null,
    }
  } catch {
    return { status: 'not_registered', endpointId: null }
  }
}

/**
 * Registers (or updates) a Stripe webhook endpoint for this Sellf installation.
 *
 * Idempotent: if an endpoint with our URL already exists in Stripe, updates its
 * API version and events instead of creating a new one.
 *
 * Stores the signing secret (AES-256-GCM encrypted) in the active DB config row
 * so STRIPE_WEBHOOK_SECRET env var is no longer required for DB-config installs.
 */
export async function createStripeWebhookEndpoint(): Promise<RegisterWebhookResponse> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }

  try {
    const supabase = await createClient()
    await requireAdminApi(supabase)

    const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (!siteUrl) {
      return { success: false, error: 'SITE_URL is not set', errorCode: 'CONFIGURATION_ERROR' }
    }

    const webhookUrl = `${siteUrl}/api/webhooks/stripe`
    const mode: StripeMode = process.env.NODE_ENV === 'production' ? 'live' : 'test'
    const apiKey = await getDecryptedStripeKeyInternal(mode) || process.env.STRIPE_SECRET_KEY
    if (!apiKey) {
      return { success: false, error: 'Stripe is not configured', errorCode: 'CONFIGURATION_ERROR' }
    }
    const stripe = new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION })
    const params = buildWebhookParams(webhookUrl)

    // Find existing endpoint for our URL
    const allEndpoints = await stripe.webhookEndpoints.list({ limit: 100 })
    const existing = findExistingWebhookEndpoint(allEndpoints.data, webhookUrl)

    let endpointId: string
    let signingSecret: string | undefined

    // Always delete existing endpoint and recreate — ensures we always get a fresh
    // signing secret that can be saved (Stripe only exposes the secret at creation time)
    if (existing) {
      await stripe.webhookEndpoints.del(existing.id)
    }
    const created = await stripe.webhookEndpoints.create(params)
    endpointId = created.id
    signingSecret = created.secret

    // Persist to DB
    const update: Record<string, string | null> = { webhook_endpoint_id: endpointId }

    if (signingSecret) {
      const encrypted = await encryptStripeKey(signingSecret)
      update.webhook_signing_secret_enc = encrypted.encryptedKey
      update.webhook_signing_iv = encrypted.iv
      update.webhook_signing_tag = encrypted.tag
    }

    // Try to UPDATE existing active row (DB-config installs)
    const { count: activeCount } = await supabase
      .from('stripe_configurations')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)

    if (activeCount && activeCount > 0) {
      const { error: dbError } = await supabase
        .from('stripe_configurations')
        .update(update)
        .eq('is_active', true)
      if (dbError) {
        console.error('[createStripeWebhookEndpoint] DB update failed:', dbError)
        return { success: false, error: 'Failed to save webhook registration', errorCode: 'DATABASE_ERROR' }
      }
    } else {
      // ENV-config install: no DB row exists — insert a sentinel row to track webhook registration.
      // Sentinel uses placeholder encryption fields that intentionally fail decryption so
      // getDecryptedStripeKey returns null → dbConfigured stays false → activeSource stays 'env'.
      const envKey = process.env.STRIPE_SECRET_KEY ?? ''
      const { error: dbError } = await supabase
        .from('stripe_configurations')
        .insert({
          ...update,
          mode,
          encrypted_key: 'env_config_sentinel',
          encryption_iv: 'env_config_sentinel',
          encryption_tag: 'env_config_sentinel',
          key_last_4: envKey.slice(-4) || 'env_',
          key_prefix: envKey.slice(0, 8) || 'env_',
          is_active: true,
        })
      if (dbError) {
        console.error('[createStripeWebhookEndpoint] DB insert sentinel failed:', dbError)
        return { success: false, error: 'Failed to save webhook registration', errorCode: 'DATABASE_ERROR' }
      }
    }

    revalidatePath('/[locale]/dashboard/settings', 'page')

    return {
      success: true,
      data: { status: 'registered', endpointId },
    }
  } catch (error) {
    console.error('[createStripeWebhookEndpoint] Error:', error)
    return {
      success: false,
      error: 'Failed to register Stripe webhook endpoint',
      errorCode: 'UNKNOWN_ERROR',
    }
  }
}

/**
 * Internal helper: decrypts webhook signing secret using service-role client.
 * Used by verifyWebhookSignature() which runs in webhook context (no user session).
 */
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

    return await decryptStripeKey({
      encrypted_key: data.webhook_signing_secret_enc,
      encryption_iv: data.webhook_signing_iv,
      encryption_tag: data.webhook_signing_tag,
    })
  } catch (error) {
    console.error('[getDecryptedWebhookSecretInternal] Error:', error)
    return null
  }
}

/**
 * Retrieves and decrypts the webhook signing secret from the active DB config.
 * Platform admin only.
 */
export async function getDecryptedWebhookSecret(): Promise<string | null> {
  const result = await withAdminAuth(async () => {
    const dataClient = createAdminClient();
    const { data } = await dataClient
      .from('stripe_configurations')
      .select('webhook_signing_secret_enc, webhook_signing_iv, webhook_signing_tag')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!data?.webhook_signing_secret_enc || !data.webhook_signing_iv || !data.webhook_signing_tag) {
      return { success: true, data: null }
    }

    const secret = await decryptStripeKey({
      encrypted_key: data.webhook_signing_secret_enc,
      encryption_iv: data.webhook_signing_iv,
      encryption_tag: data.webhook_signing_tag,
    })

    return { success: true, data: secret }
  })
  if (!result.success) return null
  return result.data ?? null
}
