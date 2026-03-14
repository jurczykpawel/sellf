'use server'

import { createPublicClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { cache } from 'react'
import { cacheGet, cacheSet, cacheDel, CacheKeys, CacheTTL } from '@/lib/redis/cache'
import { isDemoMode } from '@/lib/demo-guard'
import { withAdminAuth } from '@/lib/actions/admin-auth'

export type TaxMode = 'local' | 'stripe_tax'

export interface ShopConfig {
  id: string
  default_currency: string
  shop_name: string
  contact_email?: string | null
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
export const getShopConfig = cache(async (): Promise<ShopConfig | null> => {
  const cacheKey = CacheKeys.SHOP_CONFIG

  // Try Redis cache first (if configured)
  const cached = await cacheGet<ShopConfig>(cacheKey)
  if (cached) {
    return cached
  }

  // Fallback to database
  const supabase = createPublicClient()
  const { data, error } = await supabase
    .from('shop_config')
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('Error fetching shop config:', error)
    return null
  }

  // Cache for next time (if Redis is available)
  if (data) {
    await cacheSet(cacheKey, data, CacheTTL.LONG) // 1 hour
  }

  return data as ShopConfig | null
})

/**
 * Get default shop currency
 */
export async function getDefaultCurrency(): Promise<string> {
  const config = await getShopConfig()
  return config?.default_currency || 'USD'
}

/**
 * Update shop configuration
 */
export async function updateShopConfig(updates: Partial<Omit<ShopConfig, 'id' | 'created_at' | 'updated_at'>>): Promise<boolean> {
  if (isDemoMode()) return false

  const result = await withAdminAuth(async ({ supabase }) => {
    // Get current config first
    const config = await getShopConfig()
    if (!config) {
      console.error('No shop config found to update')
      return { success: false, error: 'No shop config found' }
    }

    const { error } = await supabase
      .from('shop_config')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', config.id)

    if (error) {
      console.error('Error updating shop config:', error)
      return { success: false, error: error.message }
    }

    // Invalidate Redis cache (if configured)
    await cacheDel(CacheKeys.SHOP_CONFIG)

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
