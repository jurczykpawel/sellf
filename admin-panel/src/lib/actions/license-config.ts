'use server'

import { revalidatePath } from 'next/cache'

import { withAdminAuth, type ActionResponse } from '@/lib/actions/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard'
import {
  generateSellerKeypair,
  importSellerKey,
  storeSellerKey,
  loadActivePublicKeyInfo,
} from '@/lib/license-keys/keys'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ProductLicenseConfigInput {
  enabled: boolean
  tier: string | null
  durationDays: number | null
}

export interface SellerLicenseInfo {
  kid: string
  publicKeyPem: string
  jwksUrl: string
}

/**
 * Sets the per-product license issuance config (3 product columns).
 * Scoped to the authenticated seller's own products via seller_id.
 */
export async function setProductLicenseConfig(
  productId: string,
  input: ProductLicenseConfigInput,
): Promise<ActionResponse> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }
  return withAdminAuth(async ({ user }) => {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('products')
      .update({
        issue_license_on_purchase: input.enabled,
        license_tier: input.tier?.trim() || null,
        license_duration_days: input.durationDays ?? null,
      })
      .eq('id', productId)
      .eq('seller_id', user.id)
      .select('id')
    if (error) {
      console.error('[setProductLicenseConfig]', error)
      return { success: false, error: 'Failed to save license config', errorCode: 'DATABASE_ERROR' }
    }
    if (!data || data.length === 0) {
      // No row matched id + seller_id — product missing or not owned by this seller.
      return { success: false, error: 'Product not found', errorCode: 'NOT_FOUND' }
    }
    return { success: true }
  })
}

/** Deactivates any currently-active key for the seller. */
async function deactivatePriorKeys(admin: SupabaseClient, sellerId: string): Promise<void> {
  await admin
    .from('seller_license_keys')
    .update({ is_active: false })
    .eq('seller_id', sellerId)
    .eq('is_active', true)
}

/**
 * MANAGED custody: generate a fresh keypair, deactivate the prior active key,
 * store the new one. Returns the public key + kid only — never the private key.
 */
export async function generateSellerLicenseKey(): Promise<ActionResponse<{ kid: string; publicKeyPem: string }>> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }
  return withAdminAuth(async ({ user }) => {
    const admin = createAdminClient()
    try {
      const keypair = generateSellerKeypair()
      await deactivatePriorKeys(admin, user.id)
      const { kid } = await storeSellerKey(admin, {
        sellerId: user.id,
        publicKeyPem: keypair.publicKeyPem,
        privateKeyPem: keypair.privateKeyPem,
        custody: 'managed',
      })
      revalidatePath('/[locale]/dashboard/settings', 'page')
      return { success: true, data: { kid, publicKeyPem: keypair.publicKeyPem } }
    } catch (error) {
      console.error('[generateSellerLicenseKey]', error)
      return { success: false, error: 'Failed to generate license key', errorCode: 'KEY_GENERATION_FAILED' }
    }
  })
}

/**
 * BYOK custody: validate + import a seller-supplied private key, deactivate the
 * prior active key. Returns the kid only — never echoes the private key back.
 */
export async function uploadSellerLicenseKey(
  privateKeyPem: string,
): Promise<ActionResponse<{ kid: string }>> {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' }
  if (!privateKeyPem || !privateKeyPem.trim()) {
    return { success: false, error: 'A private key is required', errorCode: 'INVALID_INPUT' }
  }
  return withAdminAuth(async ({ user }) => {
    const admin = createAdminClient()
    try {
      await deactivatePriorKeys(admin, user.id)
      const { kid } = await importSellerKey(admin, { sellerId: user.id, privateKeyPem: privateKeyPem.trim() })
      revalidatePath('/[locale]/dashboard/settings', 'page')
      return { success: true, data: { kid } }
    } catch (error) {
      console.error('[uploadSellerLicenseKey]', error)
      return { success: false, error: 'Invalid private key. Provide a PEM-encoded EC P-256 key.', errorCode: 'INVALID_KEY' }
    }
  })
}

/**
 * Returns the seller's active public key info (kid, public PEM, JWKS URL) or
 * `data: null` when no key has been configured. Never returns the private key.
 */
export async function getSellerLicenseInfo(): Promise<ActionResponse<SellerLicenseInfo | null>> {
  return withAdminAuth(async ({ user }) => {
    const admin = createAdminClient()
    try {
      const active = await loadActivePublicKeyInfo(admin, user.id)
      if (!active) return { success: true, data: null }
      const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || ''
      return {
        success: true,
        data: {
          kid: active.kid,
          publicKeyPem: active.publicKeyPem,
          jwksUrl: `${siteUrl}/api/licenses/jwks?seller=${user.id}`,
        },
      }
    } catch (error) {
      console.error('[getSellerLicenseInfo]', error)
      return { success: false, error: 'Failed to load license info', errorCode: 'DATABASE_ERROR' }
    }
  })
}
