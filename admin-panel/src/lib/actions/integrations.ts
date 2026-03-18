'use server'

import { withAdminOrSellerAuth } from '@/lib/actions/admin-auth'
import { validateIntegrations, type IntegrationsInput } from '@/lib/validations/integrations'
import { validateLicense, extractDomainFromUrl } from '@/lib/license/verify'
import { revalidatePath } from 'next/cache'
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard'
import { createPublicClient } from '@/lib/supabase/server'

// --- GLOBAL CONFIG ---

export async function getIntegrationsConfig() {
  return withAdminOrSellerAuth(async ({ dataClient }) => {
    const { data, error } = await dataClient.from('integrations_config').select('*').single()

    if (error && error.code === 'PGRST116') {
      return { success: true as const, data: { cookie_consent_enabled: true, consent_logging_enabled: false } as Record<string, unknown> }
    }
    if (error) return { success: false as const, error: error.message }
    return { success: true as const, data: data as Record<string, unknown> }
  })
}

export async function updateIntegrationsConfig(values: IntegrationsInput) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  return withAdminOrSellerAuth(async ({ dataClient }) => {
    const validation = validateIntegrations(values)
    if (!validation.isValid) return { success: false, error: 'Invalid fields', details: validation.errors }

    // Validate Sellf license if provided
    if (values.sellf_license) {
      const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
      const currentDomain = siteUrl ? extractDomainFromUrl(siteUrl) : null;

      const licenseValidation = validateLicense(values.sellf_license, currentDomain || undefined);

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

    const { error } = await dataClient.from('integrations_config')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', 1)

    if (error) return { success: false, error: error.message }
    revalidatePath('/dashboard/integrations')
    return { success: true }
  })
}

// --- PUBLIC API ---

export async function getPublicIntegrationsConfig() {
  const supabase = createPublicClient()
  // RPC returns a JSON object with config + scripts array
  const { data, error } = await supabase.rpc('get_public_integrations_config')

  if (error) {
    console.error('Failed to fetch public integrations config', error)
    return null
  }

  return data // Returns JSON object directly
}
