// types/payment.ts
// Type definitions for payment-related operations

import type { Json } from './database';

export interface PaymentSession {
  id: string;
  session_id: string;
  provider_type: 'stripe';
  product_id: string;
  user_id?: string;
  customer_email: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  metadata: Record<string, unknown>;
  expires_at: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentTransaction {
  id: string;
  session_id: string;
  user_id: string | null;
  customer_email?: string | null;
  product_id: string;
  amount: number;
  currency: string;
  stripe_payment_intent_id?: string;
  status: 'completed' | 'refunded' | 'disputed' | 'pending' | 'failed';
  refunded_amount: number;
  refunded_at?: string;
  refunded_by?: string;
  refund_reason?: string;
  metadata: Record<string, unknown>;
  product?: {
    id: string;
    name: string | null;
    slug: string | null;
  };
  line_items?: PaymentTransactionLineItem[];
  created_at: string;
  updated_at: string;
}

export interface PaymentTransactionLineItem {
  id: string;
  transaction_id: string;
  product_id: string | null;
  item_type: 'main_product' | 'order_bump';
  product_name: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
  metadata?: Json | null;
}

export interface CreateCheckoutSessionRequest {
  productId: string;
  email?: string; // Required for guest checkout, optional for authenticated users
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateCheckoutSessionResponse {
  sessionId: string;
  checkoutUrl: string;
}

export interface WebhookEvent {
  id: string;
  event_id: string;
  provider_type: 'stripe';
  event_type: string;
  event_data: Record<string, unknown>;
  processed_at: string;
  created_at: string;
}

export interface RefundRequest {
  transactionId: string;
  amount?: number; // Partial refund amount, if not provided - full refund
  reason?: string;
}

export interface RefundResponse {
  success: boolean;
  refundId?: string;
  amount?: number;
  message: string;
}

export interface GuestPurchase {
  id: string;
  customer_email: string;
  product_id: string;
  transaction_id: string;
  claimed_by_user_id?: string;
  access_expires_at?: string;
  claimed_at?: string;
  created_at: string;
  products?: {
    name: string;
    slug: string;
  };
}

export interface PaymentHistory {
  transaction_id: string;
  product_name: string;
  product_slug: string;
  amount: number;
  currency: string;
  payment_date: string;
  status: 'completed' | 'refunded' | 'disputed';
  refunded_amount: number;
}
