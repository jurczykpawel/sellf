'use server';

/**
 * Server Actions for Seller Management (Admin)
 *
 * CRUD operations for marketplace sellers.
 * All actions require admin authentication.
 *
 * @see src/lib/marketplace/seller-client.ts — seller lookup
 * @see src/lib/stripe/connect.ts — Stripe Connect
 * @see supabase/migrations/20260311000001_marketplace_sellers.sql — sellers table
 */

import { revalidatePath } from 'next/cache';
import { createPlatformClient } from '@/lib/supabase/admin';
import { withAdminAuth } from '@/lib/actions/admin-auth';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { clearSellerCache } from '@/lib/marketplace/seller-client';

// ===== TYPES =====

export interface SellerListItem {
  id: string;
  slug: string;
  display_name: string;
  schema_name: string;
  status: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  platform_fee_percent: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSellerInput {
  slug: string;
  displayName: string;
  email: string;
  platformFeePercent?: number;
}

export interface UpdateSellerInput {
  displayName?: string;
  platformFeePercent?: number;
  status?: 'active' | 'suspended';
}

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ===== ACTIONS =====

/**
 * List all sellers with their current status.
 */
export async function listSellers(): Promise<ActionResult<SellerListItem[]>> {
  return withAdminAuth(async () => {
    const access = checkMarketplaceAccess();
    if (!access.accessible) {
      return { success: false, error: 'Marketplace is not enabled' };
    }

    const platform = createPlatformClient();
    const { data, error } = await platform
      .from('sellers')
      .select('id, slug, display_name, schema_name, status, stripe_account_id, stripe_onboarding_complete, platform_fee_percent, user_id, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[sellers] Failed to list sellers:', error);
      return { success: false, error: 'Failed to load sellers' };
    }

    return { success: true, data: data ?? [] };
  });
}

/**
 * Create a new seller and provision their schema.
 * Calls the DB function provision_seller_schema() which clones seller_main.
 */
export async function createSeller(input: CreateSellerInput): Promise<ActionResult<{ sellerId: string }>> {
  return withAdminAuth(async () => {
    const access = checkMarketplaceAccess();
    if (!access.accessible) {
      return { success: false, error: 'Marketplace is not enabled' };
    }

    // Validate input
    if (!input.slug || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(input.slug)) {
      return { success: false, error: 'Slug must be 3-50 chars, lowercase alphanumeric with hyphens, no leading/trailing hyphens' };
    }

    if (!input.displayName || input.displayName.trim().length < 2) {
      return { success: false, error: 'Display name must be at least 2 characters' };
    }

    if (!input.email || !input.email.includes('@')) {
      return { success: false, error: 'Valid email is required' };
    }

    const feePercent = input.platformFeePercent ?? 5;
    if (feePercent < 0 || feePercent > 50) {
      return { success: false, error: 'Platform fee must be between 0% and 50%' };
    }

    // Call provision function (clones seller_main schema)
    const platform = createPlatformClient();
    const { data, error } = await platform.rpc('provision_seller_schema', {
      p_slug: input.slug,
      p_display_name: input.displayName.trim(),
    });

    if (error) {
      console.error('[sellers] Provision failed:', error);
      if (error.message?.includes('already exists')) {
        return { success: false, error: 'A seller with this slug already exists' };
      }
      return { success: false, error: `Failed to provision seller: ${error.message}` };
    }

    // Update platform_fee_percent if non-default (provision creates with default 5%)
    if (feePercent !== 5) {
      await platform
        .from('sellers')
        .update({ platform_fee_percent: feePercent })
        .eq('id', data);
    }

    clearSellerCache();
    revalidatePath('/admin/sellers');

    return { success: true, data: { sellerId: data } };
  });
}

/**
 * Update seller details (display name, fee, status).
 */
export async function updateSeller(sellerId: string, input: UpdateSellerInput): Promise<ActionResult> {
  return withAdminAuth(async () => {
    const access = checkMarketplaceAccess();
    if (!access.accessible) {
      return { success: false, error: 'Marketplace is not enabled' };
    }

    if (!sellerId) {
      return { success: false, error: 'Seller ID is required' };
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.displayName !== undefined) {
      if (input.displayName.trim().length < 2) {
        return { success: false, error: 'Display name must be at least 2 characters' };
      }
      updates.display_name = input.displayName.trim();
    }

    if (input.platformFeePercent !== undefined) {
      if (input.platformFeePercent < 0 || input.platformFeePercent > 50) {
        return { success: false, error: 'Platform fee must be between 0% and 50%' };
      }
      updates.platform_fee_percent = input.platformFeePercent;
    }

    if (input.status !== undefined) {
      if (!['active', 'suspended'].includes(input.status)) {
        return { success: false, error: 'Status must be active or suspended' };
      }
      updates.status = input.status;
    }

    const platform = createPlatformClient();
    const { error } = await platform
      .from('sellers')
      .update(updates)
      .eq('id', sellerId);

    if (error) {
      console.error('[sellers] Update failed:', error);
      return { success: false, error: 'Failed to update seller' };
    }

    clearSellerCache();
    revalidatePath('/admin/sellers');

    return { success: true };
  });
}

/**
 * Deprovision a seller — drops their schema and removes the seller record.
 * DESTRUCTIVE: This permanently deletes all seller data.
 */
export async function deprovisionSeller(sellerId: string): Promise<ActionResult> {
  return withAdminAuth(async () => {
    const access = checkMarketplaceAccess();
    if (!access.accessible) {
      return { success: false, error: 'Marketplace is not enabled' };
    }

    if (!sellerId) {
      return { success: false, error: 'Seller ID is required' };
    }

    // Get seller info for validation
    const platform = createPlatformClient();
    const { data: seller, error: fetchError } = await platform
      .from('sellers')
      .select('slug, schema_name')
      .eq('id', sellerId)
      .single();

    if (fetchError || !seller) {
      return { success: false, error: 'Seller not found' };
    }

    // Prevent deprovisioning the owner (seller_main)
    if (seller.schema_name === 'seller_main') {
      return { success: false, error: 'Cannot deprovision the platform owner' };
    }

    // Call deprovision function
    const { error } = await platform.rpc('deprovision_seller_schema', {
      p_seller_id: sellerId,
    });

    if (error) {
      console.error('[sellers] Deprovision failed:', error);
      return { success: false, error: `Failed to deprovision seller: ${error.message}` };
    }

    clearSellerCache();
    revalidatePath('/admin/sellers');

    return { success: true };
  });
}
