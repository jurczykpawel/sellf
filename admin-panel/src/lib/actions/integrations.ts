'use server'

import { withAdminClient } from '@/lib/actions/admin-auth'
import { validateIntegrations, type IntegrationsInput } from '@/lib/validations/integrations'
import { normalizeLicenseDomain } from '@/lib/license-keys/domain'
import { verifyPlatformLicenseToken } from '@/lib/license/resolve'
import { getEnvLicenseStatus } from '@/lib/license/env-status'
import { revalidatePath, unstable_cache, revalidateTag } from 'next/cache'
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard'
import { createPublicClient } from '@/lib/supabase/server'
import { capiTokenUpdateColumns, redactCapiToken } from '@/lib/integrations/capi-token'
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url'

// --- GLOBAL CONFIG ---

const EDITABLE_INTEGRATION_FIELDS: Array<keyof IntegrationsInput> = [
  'gtm_container_id',
  'gtm_server_container_url',
  'gtm_ss_enabled',
  'google_ads_conversion_id',
  'google_ads_conversion_label',
  'facebook_pixel_id',
  'facebook_capi_token',
  'facebook_test_event_code',
  'fb_capi_enabled',
  'conversion_tracking_mode',
  'umami_website_id',
  'umami_script_url',
  'cookie_consent_enabled',
  'consent_logging_enabled',
  'sellf_license',
]

function pickEditableIntegrations(values: Record<string, unknown>): IntegrationsInput {
  const picked: IntegrationsInput = {}
  for (const field of EDITABLE_INTEGRATION_FIELDS) {
    if (field in values) {
      picked[field] = values[field] as never
    }
  }
  return picked
}

export async function getIntegrationsConfig() {
  return withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient.from('integrations_config').select('*').single()
    const envLicenseConfigured = Boolean(process.env.SELLF_LICENSE_KEY)
    const siteUrl = getCanonicalOriginOrNull()
    const platformDomain = normalizeLicenseDomain(siteUrl) ?? null
    const envLicenseStatus = await getEnvLicenseStatus(process.env.SELLF_LICENSE_KEY, platformDomain)

    if (error && error.code === 'PGRST116') {
      return {
        success: true as const,
        data: {
          cookie_consent_enabled: true,
          consent_logging_enabled: false,
          facebook_capi_token_set: false,
          sellf_license_env_configured: envLicenseConfigured,
          sellf_license_env_status: envLicenseStatus,
          sellf_license_status: null,
        } as Record<string, unknown>,
      }
    }
    if (error) return { success: false as const, error: error.message }
    // Validate the DB-stored token the same way the resolver does, so the UI can show full
    // status (valid/reason + tier + domain + expiry) — not just the signature snippet.
    const dbToken = (data as Record<string, unknown>)?.sellf_license as string | null | undefined
    const dbLicenseStatus = dbToken ? await getEnvLicenseStatus(dbToken, platformDomain) : null
    return {
      success: true as const,
      data: {
        // The CAPI token never reaches the browser — only whether one is set.
        ...redactCapiToken(data as Record<string, unknown>),
        sellf_license_env_configured: envLicenseConfigured,
        sellf_license_env_status: envLicenseStatus,
        sellf_license_status: dbLicenseStatus,
      },
    }
  })
}

export async function updateIntegrationsConfig(values: IntegrationsInput) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  return withAdminClient(async ({ dataClient }) => {
    const sanitizedValues = pickEditableIntegrations(values as Record<string, unknown>)
    const validation = validateIntegrations(sanitizedValues)
    if (!validation.isValid) return { success: false, error: 'Invalid fields', details: validation.errors }

    // Validate Sellf license if provided
    if (sanitizedValues.sellf_license) {
      const siteUrl = getCanonicalOriginOrNull();
      const currentDomain = normalizeLicenseDomain(siteUrl);
      const licenseValidation = currentDomain
        ? await verifyPlatformLicenseToken(sanitizedValues.sellf_license, currentDomain)
        : null;

      if (!licenseValidation?.valid) {
        return {
          success: false,
          error: 'Invalid license',
          details: {
            sellf_license: ['License validation failed']
          }
        };
      }
    }

    // The CAPI token is stored encrypted; a blank value keeps the stored token.
    const { facebook_capi_token: capiToken, ...otherValues } = sanitizedValues
    let capiTokenColumns: Awaited<ReturnType<typeof capiTokenUpdateColumns>>
    try {
      capiTokenColumns = await capiTokenUpdateColumns(capiToken)
    } catch (error) {
      console.error('[updateIntegrationsConfig] CAPI token encryption failed:', error instanceof Error ? error.message : 'Unknown error')
      return { success: false, error: 'Could not encrypt the CAPI token. Check that APP_ENCRYPTION_KEY is configured.' }
    }

    // `.select()` forces PostgREST `Prefer: return=representation` which
    // makes the update synchronous w.r.t. follow-up reads from a different
    // pool connection (without it, a service-role poll right after success
    // could occasionally observe the pre-update value).
    const { error } = await dataClient.from('integrations_config')
      .update({ ...otherValues, ...capiTokenColumns, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select('id')

    if (error) return { success: false, error: error.message }
    revalidatePath('/dashboard/integrations')
    revalidateTag('integrations-config', { expire: 0 })
    return { success: true }
  })
}

// --- PUBLIC API ---

async function fetchPublicIntegrationsConfigFresh() {
  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('get_public_integrations_config')
  if (error) {
    console.error('Failed to fetch public integrations config', error)
    return null
  }
  return data
}

// Cached cross-request in production — the RPC payload is identical for every
// visitor. Invalidated via revalidateTag('integrations-config') after admin
// updates. Disabled in non-prod so tests and dev sessions never observe stale
// config after a direct supabase update.
const fetchPublicIntegrationsConfig = process.env.NODE_ENV === 'production'
  ? unstable_cache(
      fetchPublicIntegrationsConfigFresh,
      ['integrations-config'],
      { revalidate: 300, tags: ['integrations-config'] },
    )
  : fetchPublicIntegrationsConfigFresh

export async function getPublicIntegrationsConfig() {
  return fetchPublicIntegrationsConfig()
}
