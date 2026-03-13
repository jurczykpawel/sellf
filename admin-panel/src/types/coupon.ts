/**
 * Coupon Types
 */

import type { Database } from './database';

// Database table types
export type Coupon = Database['seller_main']['Tables']['coupons']['Row'];
export type CouponInsert = Database['seller_main']['Tables']['coupons']['Insert'];
export type CouponUpdate = Database['seller_main']['Tables']['coupons']['Update'];

export interface CouponFormData {
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  currency?: string | null;
  usage_limit_global?: number | null;
  usage_limit_per_user?: number;
  expires_at?: string | null;
  is_active: boolean;
  name?: string;
  allowed_emails?: string[];
  allowed_product_ids?: string[];
  exclude_order_bumps?: boolean;
}

export interface CouponVerificationResult {
  valid: boolean;
  error?: string;
  id?: string;
  code?: string;
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
  exclude_order_bumps?: boolean;
}

/** Shape of a successfully applied coupon used in checkout UI */
export interface AppliedCoupon {
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  exclude_order_bumps?: boolean;
}
