/**
 * Product validation service
 * Centralizes product validation logic to avoid duplication across checkout flows
 */

import { createClient } from '@/lib/supabase/server';
import type { User } from '@supabase/supabase-js';
import { DisposableEmailService } from './disposable-email';

export type ProductType = 'one_time' | 'subscription';
export type BillingInterval = 'day' | 'week' | 'month' | 'year';

export interface ValidatedProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  is_active: boolean;
  available_from: string | null;
  available_until: string | null;
  auto_grant_duration_days?: number | null;
  // Pay What You Want fields
  allow_custom_price?: boolean;
  custom_price_min?: number;
  // Sale price (Omnibus) — when active, this is the price actually charged
  sale_price?: number | null;
  sale_price_until?: string | null;
  sale_quantity_limit?: number | null;
  sale_quantity_sold?: number | null;
  // VAT/Tax fields
  vat_rate: number | null;
  price_includes_vat: boolean;
  // Subscription fields (Phase 2 — Subscriptions MVP)
  product_type: ProductType;
  billing_interval: BillingInterval | null;
  billing_interval_count: number | null;
  recurring_price: number | null;
  trial_days: number | null;
  // durable Stripe Price binding (Phase 6 hardening)
  stripe_price_id: string | null;
}

export interface UserAccessInfo {
  hasAccess: boolean;
  accessExpiresAt: string | null;
  isExpired: boolean;
}

export class ProductValidationService {
  private supabase: Awaited<ReturnType<typeof createClient>>;

  constructor(supabase: Awaited<ReturnType<typeof createClient>>) {
    this.supabase = supabase;
  }

  /**
   * Get and validate product for checkout
   */
  async validateProduct(productId: string): Promise<ValidatedProduct> {
    if (!productId || typeof productId !== 'string') {
      throw new Error('Product ID is required');
    }

    const { data: product, error } = await this.supabase
      .from('products')
      .select('id, slug, name, description, price, currency, is_active, available_from, available_until, auto_grant_duration_days, allow_custom_price, custom_price_min, sale_price, sale_price_until, sale_quantity_limit, sale_quantity_sold, vat_rate, price_includes_vat, product_type, billing_interval, billing_interval_count, recurring_price, trial_days, stripe_price_id')
      .eq('id', productId)
      .eq('is_active', true)
      .single();

    if (error || !product) {
      throw new Error('Product not found or inactive');
    }

    if (product.product_type === 'subscription') {
      const recurring = product.recurring_price;
      if (
        recurring === null ||
        recurring === undefined ||
        Number(recurring) <= 0 ||
        !product.billing_interval ||
        !product.billing_interval_count
      ) {
        throw new Error('Subscription product is misconfigured');
      }
    } else if (product.price <= 0 && !product.allow_custom_price) {
      // Validate one-time product price (skip for Pay What You Want products)
      throw new Error('Invalid product price');
    }

    return product as ValidatedProduct;
  }

  /**
   * Check if product is temporally available for purchase
   */
  static validateTemporalAvailability(product: ValidatedProduct): void {
    const now = new Date();
    const availableFrom = product.available_from ? new Date(product.available_from) : null;
    const availableUntil = product.available_until ? new Date(product.available_until) : null;
    
    const isTemporallyAvailable = (!availableFrom || availableFrom <= now) && 
                                 (!availableUntil || availableUntil > now);
    
    if (!isTemporallyAvailable) {
      throw new Error('Product not available for purchase');
    }
  }

  /**
   * Check if user already has access to the product
   */
  async checkUserAccess(userId: string, productId: string): Promise<UserAccessInfo> {
    const { data: existingAccess } = await this.supabase
      .from('user_product_access')
      .select('access_expires_at')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (!existingAccess) {
      return {
        hasAccess: false,
        accessExpiresAt: null,
        isExpired: false
      };
    }

    const expiresAt = existingAccess.access_expires_at 
      ? new Date(existingAccess.access_expires_at) 
      : null;
    const isExpired = expiresAt && expiresAt < new Date();

    return {
      hasAccess: !isExpired,
      accessExpiresAt: existingAccess.access_expires_at,
      isExpired: Boolean(isExpired)
    };
  }

  /**
   * Complete product validation for checkout (combines all checks)
   */
  async validateForCheckout(
    productId: string, 
    user?: User | null
  ): Promise<{ product: ValidatedProduct; userAccess: UserAccessInfo | null }> {
    // 1. Validate product exists and is active
    const product = await this.validateProduct(productId);

    // 2. Check temporal availability
    ProductValidationService.validateTemporalAvailability(product);

    // 3. Check user access if user is logged in
    let userAccess: UserAccessInfo | null = null;
    if (user) {
      userAccess = await this.checkUserAccess(user.id, productId);
      
      // Throw error if user already has valid access
      if (userAccess.hasAccess) {
        throw new Error('You already have access to this product');
      }
    }

    return { product, userAccess };
  }

  /**
   * Validate email format and check for disposable domains
   */
  static async validateEmail(email: string, allowDisposable: boolean = false): Promise<boolean> {
    // Use our enhanced disposable email service
    const validation = await DisposableEmailService.validateEmail(email, allowDisposable);
    return validation.isValid;
  }

  /**
   * Validate email format only (basic regex check)
   */
  static validateEmailFormat(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Calculate access expiry date
   */
  static calculateAccessExpiry(durationDays?: number | null): string | null {
    if (!durationDays) return null;
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + durationDays);
    return expiryDate.toISOString();
  }
}
