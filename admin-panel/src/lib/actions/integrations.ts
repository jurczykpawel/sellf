'use server'

import { withAdminClient } from '@/lib/actions/admin-auth'
import { validateIntegrations, type IntegrationsInput } from '@/lib/validations/integrations'
import { validateLicense, extractDomainFromUrl } from '@/lib/license/verify'
import { getEnvLicenseStatus } from '@/lib/license/env-status'
import { revalidatePath, unstable_cache, revalidateTag } from 'next/cache'
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard'
import { createPublicClient } from '@/lib/supabase/server'

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
    const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.MAIN_DOMAIN
    const platformDomain = siteUrl ? extractDomainFromUrl(siteUrl) : null
    const envLicenseStatus = getEnvLicenseStatus(process.env.SELLF_LICENSE_KEY, platformDomain)

    if (error && error.code === 'PGRST116') {
      return {
        success: true as const,
        data: {
          cookie_consent_enabled: true,
          consent_logging_enabled: false,
          sellf_license_env_configured: envLicenseConfigured,
          sellf_license_env_status: envLicenseStatus,
        } as Record<string, unknown>,
      }
    }
    if (error) return { success: false as const, error: error.message }
    return {
      success: true as const,
      data: {
        ...(data as Record<string, unknown>),
        sellf_license_env_configured: envLicenseConfigured,
        sellf_license_env_status: envLicenseStatus,
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
      const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
      const currentDomain = siteUrl ? extractDomainFromUrl(siteUrl) : null;

      const licenseValidation = validateLicense(sanitizedValues.sellf_license, currentDomain || undefined);

      if (!licenseValidation.valid) {
        return {
          success: false,
          error: 'Invalid license',
          details: {
            sellf_license: [licenseValidation.error || 'License validation failed']
          }
        };
      }
    }

    // `.select()` forces PostgREST `Prefer: return=representation` which
    // makes the update synchronous w.r.t. follow-up reads from a different
    // pool connection (without it, a service-role poll right after success
    // could occasionally observe the pre-update value).
    const { error } = await dataClient.from('integrations_config')
      .update({ ...sanitizedValues, updated_at: new Date().toISOString() })
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
