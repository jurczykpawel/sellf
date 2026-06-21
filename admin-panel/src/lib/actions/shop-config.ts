'use server'

import { createPublicClient } from '@/lib/supabase/server'
import { revalidatePath, unstable_cache, revalidateTag } from 'next/cache'
import { cache } from 'react'
import { cacheGet, cacheSet, cacheDel, CacheKeys, CacheTTL } from '@/lib/redis/cache'
import { isDemoMode } from '@/lib/demo-guard'
import { withAdminClient } from '@/lib/actions/admin-auth'

export type TaxMode = 'local' | 'stripe_tax'

export interface ShopConfig {
  id: string
  default_currency: string
  shop_name: string
  contact_email?: string | null
  country?: string | null
  tax_rate?: number | null

  // Dual tax mode
  tax_mode: TaxMode
  stripe_tax_rate_cache: Record<string, string>

  // Branding & Whitelabel
  logo_url?: string | null
  font_family?: 'system' | 'inter' | 'roboto' | 'montserrat' | 'poppins' | 'playfair' | null

  // Checkout appearance
  checkout_theme?: 'system' | 'light' | 'dark' | null

  // Stripe Tax toggles (null = use env var)
  automatic_tax_enabled?: boolean | null
  tax_id_collection_enabled?: boolean | null

  // Checkout session settings (null = use env var)
  checkout_billing_address?: 'auto' | 'required' | null
  checkout_expires_hours?: number | null
  checkout_collect_terms?: boolean | null

  // EU Omnibus Directive (2019/2161)
  omnibus_enabled: boolean

  // Legal Documents
  terms_of_service_url?: string | null
  privacy_policy_url?: string | null

  // Legal company data (for document generation)
  legal_form?: 'jdg' | 'spzoo' | 'fundacja' | 'osoba_fizyczna' | null
  company_legal_name?: string | null
  nip?: string | null
  regon?: string | null
  krs?: string | null
  company_street?: string | null
  company_building_no?: string | null
  company_flat_no?: string | null
  company_city?: string | null
  company_postal?: string | null
  company_phone?: string | null
  complaints_email?: string | null
  is_vat_exempt?: boolean
  is_micro_enterprise?: boolean
  has_dpo?: boolean
  dpo_contact?: string | null

  custom_settings: Record<string, any>
  created_at: string
  updated_at: string
}

/**
 * Get shop configuration (singleton)
 *
 * OPTIMIZED with multi-layer caching:
 * 1. React cache() - Deduplicates requests in the same render cycle
 * 2. Redis cache (optional) - <10ms latency if Upstash configured
 * 3. Database fallback - Works without Redis
 * 4. createPublicClient() - Enables ISR on pages using this function
 */
// Cross-request DB fetch cache. When Upstash Redis is configured the Redis
// layer above wins; without Redis this keeps the DB out of the hot path
// (5 min in Next.js memory). Invalidated via revalidateTag('shop-config').
// In non-production the cache is disabled so direct DB writes (e.g. E2E test
// fixtures) take effect immediately without needing to round-trip through the
// server action that calls revalidateTag.
// Explicit column list for anon (public) reads of shop_config.
// Must match the column-level GRANT in migration 20260621000001_restrict_shop_config_anon_pii.sql.
// contact_email is included — it is the shop's intentionally-public contact address,
// already rendered to anonymous visitors on the public "Coming Soon" page.
// Seller PII columns (nip, regon, krs, address, company_*, dpo_*,
// is_vat_exempt, is_micro_enterprise, has_dpo, complaints_email, legal_form) are excluded.
const SHOP_CONFIG_PUBLIC_COLUMNS = [
  'id',
  'shop_name',
  'default_currency',
  'tax_rate',
  'tax_mode',
  'stripe_tax_rate_cache',
  'logo_url',
  'font_family',
  'checkout_theme',
  'automatic_tax_enabled',
  'tax_id_collection_enabled',
  'checkout_billing_address',
  'checkout_expires_hours',
  'checkout_collect_terms',
  'terms_of_service_url',
  'privacy_policy_url',
  'omnibus_enabled',
  'custom_settings',
  'created_at',
  'updated_at',
  'contact_email',
  'country',
].join(',')

const fetchShopConfigFromDbRaw = async (): Promise<ShopConfig | null> => {
  const supabase = createPublicClient()
  const { data, error } = await supabase
    .from('shop_config')
    .select(SHOP_CONFIG_PUBLIC_COLUMNS)
    .maybeSingle()
  if (error) {
    console.error('Error fetching shop config:', error)
    return null
  }
  return data as ShopConfig | null
}

const fetchShopConfigFromDb = process.env.NODE_ENV === 'production'
  ? unstable_cache(fetchShopConfigFromDbRaw, ['shop-config'], { revalidate: 300, tags: ['shop-config'] })
  : fetchShopConfigFromDbRaw

export const getShopConfig = cache(async (): Promise<ShopConfig | null> => {
  const cacheKey = CacheKeys.SHOP_CONFIG

  // Try Redis cache first (if configured)
  const cached = await cacheGet<ShopConfig>(cacheKey)
  if (cached) {
    return cached
  }

  // Fallback: Next.js memory cache → DB. The DB call only fires when both
  // Redis and Next's in-memory cache miss.
  const data = await fetchShopConfigFromDb()

  // Cache for next time (if Redis is available)
  if (data) {
    await cacheSet(cacheKey, data, CacheTTL.LONG) // 1 hour
  }

  return data
})

/**
 * Get shop config for the current admin/seller's own schema.
 * Seller admins get their seller schema config, platform admins get public.
 * Use this in Settings UI. For public pages, use getShopConfig() (always platform).
 */
export async function getMyShopConfig(): Promise<ShopConfig | null> {
  const result = await withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient
      .from('shop_config')
      .select('*')
      .maybeSingle()
    if (error) {
      console.error('Error fetching shop config:', error)
      return { success: false, error: error.message }
    }
    return { success: true, data: data as ShopConfig | null }
  })
  return result.success ? (result.data ?? null) : null
}

/**
 * Get default shop currency (platform-wide, for public pages)
 */
export async function getDefaultCurrency(): Promise<string> {
  const config = await getShopConfig()
  return config?.default_currency || 'USD'
}

/**
 * Get default currency for the caller's own schema.
 * Seller admins get their seller schema currency, platform admins get public.
 * Use this in dashboard/admin UI. For public pages, use getDefaultCurrency().
 */
export async function getMyDefaultCurrency(): Promise<string> {
  const config = await getMyShopConfig()
  return config?.default_currency || 'USD'
}

/**
 * Update shop configuration
 */
export async function updateShopConfig(updates: Partial<Omit<ShopConfig, 'id' | 'created_at' | 'updated_at'>>): Promise<boolean> {
  if (isDemoMode()) return false

  const result = await withAdminClient(async ({ dataClient }) => {
    // Read config from the SAME schema we'll write to (not platform's getShopConfig)
    const { data: config, error: fetchError } = await dataClient
      .from('shop_config')
      .select('id')
      .maybeSingle()
    if (fetchError) {
      console.error('Error reading shop config:', fetchError)
      return { success: false, error: fetchError.message }
    }

    // Singleton: create the row on first save (fresh installs have none — prod runs no seed.sql).
    const configId = config?.id
    if (!configId) {
      const { data: created, error: insertError } = await dataClient
        .from('shop_config')
        .insert({ ...updates, updated_at: new Date().toISOString() })
        .select('id')
        .single()
      if (insertError || !created) {
        console.error('Error creating shop config:', insertError)
        return { success: false, error: insertError?.message ?? 'Failed to create shop config' }
      }
      await cacheDel(CacheKeys.SHOP_CONFIG)
      revalidateTag('shop-config', { expire: 0 })
      revalidatePath('/dashboard', 'layout')
      return { success: true }
    }

    const { error } = await dataClient
      .from('shop_config')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', configId)

    if (error) {
      console.error('Error updating shop config:', error)
      return { success: false, error: error.message }
    }

    // Invalidate Redis cache (if configured)
    await cacheDel(CacheKeys.SHOP_CONFIG)
    // Invalidate the Next.js in-memory cache so the next read hits the DB.
    revalidateTag('shop-config', { expire: 0 })

    // Revalidate all dashboard pages that might use shop config
    revalidatePath('/dashboard', 'layout')

    return { success: true }
  })

  return result.success
}

/**
 * Set default shop currency
 */
export async function setDefaultCurrency(currency: string): Promise<boolean> {
  return updateShopConfig({ default_currency: currency })
}
