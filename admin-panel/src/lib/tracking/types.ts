/**
 * Tracking Types for GTM, Facebook Pixel, and Facebook CAPI
 */

export const FB_GRAPH_API_VERSION = 'v25.0';

// GA4 Event Names (used in dataLayer)
export type GA4EventName =
  | 'view_item'
  | 'begin_checkout'
  | 'add_payment_info'
  | 'purchase'
  | 'generate_lead';

// Facebook Event Names (used in Pixel and CAPI)
export type FBEventName =
  | 'ViewContent'
  | 'InitiateCheckout'
  | 'AddPaymentInfo'
  | 'Purchase'
  | 'Lead';

// GA4 Ecommerce Item
export interface EcommerceItem {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  currency?: string;
  item_category?: string;
}

// Data passed to track function
export interface TrackingEventData {
  transactionId?: string;
  value: number;
  currency: string;
  items: EcommerceItem[];
  userEmail?: string;
}

// Internal tracking configuration
export interface TrackingConfig {
  gtmEnabled: boolean;
  fbPixelEnabled: boolean;
  fbCAPIEnabled: boolean;
}

// Config from database
export interface TrackingConfigFromDB {
  gtm_container_id?: string | null;
  gtm_server_container_url?: string | null;
  gtm_ss_enabled?: boolean | null;
  facebook_pixel_id?: string | null;
  fb_capi_enabled?: boolean | null;
  send_conversions_without_consent?: boolean | null;
}

// FB CAPI Request payload (sent to /api/tracking/fb-capi)
export interface FBCAPIRequestPayload {
  event_name: FBEventName;
  event_id: string;
  event_source_url: string;
  value: number;
  currency: string;
  content_ids: string[];
  content_name?: string;
  order_id?: string;
  user_email?: string;
  has_consent?: boolean;
}

// Extend Window for TypeScript
declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
    fbq?: (
      action: string,
      event: string,
      params?: Record<string, unknown>,
      options?: { eventID?: string }
    ) => void;
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Generate a deterministic event ID for Purchase events.
 *
 * Both client-side (PaymentStatusView) and server-side (Stripe webhook)
 * must produce the same event_id for the same Stripe session, enabling
 * Facebook's 48-hour deduplication window to collapse them into one event.
 *
 * @param stripeId - Stripe Checkout Session ID or Payment Intent ID
 */
export function generatePurchaseEventId(stripeId: string): string {
  return `purchase_${stripeId}`;
}
