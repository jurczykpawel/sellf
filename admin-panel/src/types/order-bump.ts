/**
 * Order Bump Types
 *
 * Types for order bump functionality - one-click upsells during checkout
 */

import type { Database } from './database';

// Database table types
export type OrderBump = Database['public']['Tables']['order_bumps']['Row'];
export type OrderBumpInsert = Database['public']['Tables']['order_bumps']['Insert'];
export type OrderBumpUpdate = Database['public']['Tables']['order_bumps']['Update'];

// API Response types

/**
 * Order bump with product details for checkout display
 * Returned by get_product_order_bumps() function
 */
export interface OrderBumpWithProduct {
  bump_id: string;
  bump_product_id: string;
  bump_product_name: string;
  bump_product_description: string | null;
  bump_product_icon: string | null;
  bump_price: number;
  original_price: number;
  bump_access_duration: number | null;
  bump_currency: string;
  bump_title: string;
  bump_description: string | null;
  display_order: number;
  urgency_duration_minutes: number | null;
}

/**
 * Order bump configuration for admin panel
 * Returned by admin_get_product_order_bumps() function
 */
export interface OrderBumpAdmin {
  bump_id: string;
  bump_product_id: string;
  bump_product_name: string;
  bump_price: number | null;
  bump_title: string;
  bump_description: string | null;
  is_active: boolean;
  display_order: number;
  access_duration_days: number | null;
  urgency_duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Form data for creating/editing order bumps
 */
export interface OrderBumpFormData {
  main_product_id: string;
  bump_product_id: string;
  bump_price: number | null;
  bump_title: string;
  bump_description: string | null;
  is_active: boolean;
  display_order: number;
  access_duration_days: number | null;
  urgency_duration_minutes: number | null;
}

/**
 * Checkout session with order bump selection
 */
export interface CheckoutWithBump {
  productId: string;
  email?: string;
  /** @deprecated Use bumpProductIds instead */
  bumpProductId?: string;
  bumpProductIds?: string[]; // IDs of selected bump products
}

/**
 * Payment metadata for order bumps
 */
export interface OrderBumpPaymentMetadata {
  bump_product_ids?: string[]; // Array of bump product IDs included in purchase
  is_bump?: boolean; // True if this transaction includes bump(s)
  main_product_id?: string; // Original product ID
}
