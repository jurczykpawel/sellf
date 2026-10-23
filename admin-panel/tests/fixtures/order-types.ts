import type { Database } from '../../src/types/database';
type Tx = Database['public']['Tables']['payment_transactions']['Insert'];
type Guest = Database['public']['Tables']['guest_purchases']['Insert'];
type Product = Database['public']['Tables']['products']['Update'];
export const offline: Tx = {
  product_id: 'product', customer_email: 'buyer@example.com', amount: 100, currency: 'PLN',
  session_id: null, payment_provider: 'bank_transfer', order_number: 1001,
  pricing_snapshot_version: 1, coupon_id: null, livemode: false,
};
export const guest: Guest = {
  product_id: 'product', customer_email: 'buyer@example.com', transaction_amount: 100,
  session_id: null, transaction_id: 'transaction',
};
export const product: Product = { allow_repeat_purchase: false };
