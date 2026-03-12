/**
 * Marketplace: Tenant-Aware Supabase Client
 *
 * Creates Supabase clients scoped to a specific seller's schema.
 * Includes seller lookup with in-memory TTL cache.
 *
 * @see src/lib/supabase/admin.ts — base admin/platform clients
 * @see supabase/migrations/20260311000001_marketplace_sellers.sql — sellers table
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/admin';
import { isValidSellerSchema } from '@/lib/marketplace/tenant';

// ===== TYPES =====

export interface SellerInfo {
  id: string;
  slug: string;
  schema_name: string;
  display_name: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  platform_fee_percent: number;
  status: string;
  user_id: string | null;
}

// ===== CONSTANTS =====

/** Columns to select from sellers table (shared between getSellerBySlug and getSellerById) */
const SELLER_COLUMNS = 'id, slug, schema_name, display_name, stripe_account_id, stripe_onboarding_complete, platform_fee_percent, status, user_id' as const;

/** Map a raw DB row to SellerInfo */
function toSellerInfo(data: Record<string, unknown>): SellerInfo {
  return {
    id: data.id as string,
    slug: data.slug as string,
    schema_name: data.schema_name as string,
    display_name: data.display_name as string,
    stripe_account_id: data.stripe_account_id as string | null,
    stripe_onboarding_complete: data.stripe_onboarding_complete as boolean,
    platform_fee_percent: data.platform_fee_percent as number,
    status: data.status as string,
    user_id: data.user_id as string | null,
  };
}

// ===== CACHE =====

interface CacheEntry {
  seller: SellerInfo | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_MAX_SIZE = 1000; // O6: prevent unbounded growth (DoS vector)
const sellerCache = new Map<string, CacheEntry>();

/**
 * Clear the seller cache. Useful for testing or after provisioning.
 */
export function clearSellerCache(): void {
  sellerCache.clear();
}

/** Set a cache entry with eviction when exceeding max size */
function setCacheEntry(key: string, seller: SellerInfo | null): void {
  // Evict oldest entries if cache is full
  if (sellerCache.size >= CACHE_MAX_SIZE && !sellerCache.has(key)) {
    const firstKey = sellerCache.keys().next().value;
    if (firstKey !== undefined) sellerCache.delete(firstKey);
  }
  sellerCache.set(key, { seller, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ===== SELLER LOOKUP =====

/**
 * Look up a seller by slug from public.sellers.
 * Results are cached for 60 seconds.
 *
 * @returns SellerInfo or null if not found / not active
 */
export async function getSellerBySlug(slug: string): Promise<SellerInfo | null> {
  if (!slug) return null;

  // Check cache
  const cached = sellerCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.seller;
  }

  const platform = createPlatformClient();
  const { data, error } = await platform
    .from('sellers')
    .select(SELLER_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'active')
    .single();

  if (error || !data) {
    // Cache negative result too (prevents repeated DB queries for non-existent sellers)
    setCacheEntry(slug, null);
    return null;
  }

  const seller = toSellerInfo(data);
  setCacheEntry(slug, seller);
  return seller;
}

/**
 * Look up a seller by their database ID.
 * Not cached — used for admin operations.
 */
export async function getSellerById(sellerId: string): Promise<SellerInfo | null> {
  if (!sellerId) return null;

  const platform = createPlatformClient();
  const { data, error } = await platform
    .from('sellers')
    .select(SELLER_COLUMNS)
    .eq('id', sellerId)
    .single();

  if (error || !data) return null;

  return toSellerInfo(data);
}

// ===== TENANT-SCOPED CLIENTS =====

/**
 * Create a Supabase client scoped to a seller's schema (service_role).
 * Bypasses RLS — use only in server-side contexts after auth checks.
 *
 * @param schemaName - PostgreSQL schema name (e.g., 'seller_nick')
 */
export function createSellerAdminClient(schemaName: string) {
  // K4: Validate schema name to prevent arbitrary schema access via service_role
  if (!isValidSellerSchema(schemaName)) {
    throw new Error(`Invalid seller schema name: "${schemaName}". Must match pattern seller_[a-z0-9_]{2,50} and not be seller_main.`);
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for seller admin client');
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    db: { schema: schemaName },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Create a Supabase client scoped to a seller's schema (anon key, with cookies).
 * RLS-aware — for public-facing pages.
 *
 * @param schemaName - PostgreSQL schema name (e.g., 'seller_nick')
 */
export function createSellerPublicClient(schemaName: string) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY;

  const url = supabaseUrl || 'http://localhost:54321';
  const key = supabaseAnonKey || 'dummy-anon-key-for-build-time';

  return createSupabaseClient(url, key, {
    db: { schema: schemaName },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
