export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  description?: string;
  is_active: boolean;
  secret: string;
  product_filter_mode: 'all' | 'selected';
  product_ids?: string[];
  custom_payload_fields?: Record<string, unknown> | null;
  payload_field_selection?: string[] | null;
  has_custom_headers?: boolean;
  custom_header_names?: string[];
  created_at: string;
}

export type WebhookLogStatus =
  | 'success'
  | 'failed'
  | 'retried'
  | 'archived'
  | 'pending_retry'
  | 'permanently_failed';

export interface WebhookLog {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: any;

  status: WebhookLogStatus;
  http_status: number;

  response_body: string;
  error_message?: string;
  duration_ms: number;

  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  failed_permanently_at: string | null;

  created_at: string;

  endpoint?: {
    id: string;
    url: string;
    description?: string;
    is_active: boolean;
  };
}

export const WEBHOOK_EVENT_CATEGORIES = ['purchases', 'subscriptions', 'leads', 'partners', 'catalog', 'system'] as const;
export type WebhookEventCategory = (typeof WEBHOOK_EVENT_CATEGORIES)[number];

export interface WebhookEventDefinition {
  value: string;
  label: string;
  category: WebhookEventCategory;
}

export const WEBHOOK_EVENTS: WebhookEventDefinition[] = [
  { value: 'order.abandoned', label: 'Order Abandoned', category: 'purchases' },
  { value: 'seats.held', label: 'Seats Held', category: 'system' },
  { value: 'seats.confirmed', label: 'Seats Confirmed', category: 'system' },
  { value: 'seats.released', label: 'Seats Released', category: 'system' },
  { value: 'access.granted', label: 'Access Granted', category: 'system' },
  { value: 'access.updated', label: 'Access Updated', category: 'system' },
  { value: 'access.revoked', label: 'Access Revoked', category: 'system' },
  { value: 'order.placed', label: 'Order Placed', category: 'purchases' },
  { value: 'order.cancelled', label: 'Order Cancelled', category: 'purchases' },
  { value: 'order.overdue', label: 'Order Overdue', category: 'purchases' },
  { value: 'order.payment_reminder', label: 'Order Payment Reminder', category: 'purchases' },
  { value: 'order.transfer_declared', label: 'Order Transfer Declared', category: 'purchases' },
  { value: 'order.invoice_issued', label: 'Order Invoice Issued (held)', category: 'purchases' },
  { value: 'order.reopened', label: 'Order Reopened', category: 'purchases' },
  { value: 'purchase.completed', label: 'Purchase Completed', category: 'purchases' },
  { value: 'lead.captured', label: 'Lead Captured (Free Product)', category: 'leads' },
  { value: 'waitlist.signup', label: 'Waitlist Signup', category: 'leads' },
  { value: 'access.expired', label: 'Access Expired', category: 'system' },
  // Subscriptions MVP (Phase 3)
  { value: 'subscription.created', label: 'Subscription Created', category: 'subscriptions' },
  { value: 'subscription.updated', label: 'Subscription Updated', category: 'subscriptions' },
  { value: 'subscription.canceled', label: 'Subscription Canceled', category: 'subscriptions' },
  { value: 'subscription.trial_ending', label: 'Subscription Trial Ending', category: 'subscriptions' },
  { value: 'subscription.renewal_upcoming', label: 'Subscription Renewal Upcoming', category: 'subscriptions' },
  { value: 'invoice.paid', label: 'Invoice Paid (Subscription Renewal)', category: 'subscriptions' },
  { value: 'invoice.payment_failed', label: 'Invoice Payment Failed', category: 'subscriptions' },
  { value: 'dispute.created', label: 'Dispute Created', category: 'purchases' },
  { value: 'dispute.closed', label: 'Dispute Closed', category: 'purchases' },
  { value: 'refund.updated', label: 'Refund Status Updated', category: 'purchases' },
  { value: 'refund.issued', label: 'Refund Issued', category: 'purchases' },
  { value: 'license.revoked', label: 'License Revoked (Pro)', category: 'system' },
  { value: 'license.restored', label: 'License Restored (Pro)', category: 'system' },
  { value: 'invoicing.issued', label: 'Sales Invoice Issued', category: 'purchases' },
  { value: 'invoicing.failed', label: 'Sales Invoice Failed', category: 'purchases' },
  { value: 'invoicing.corrected', label: 'Sales Invoice Corrected', category: 'purchases' },
  { value: 'commission.accrued', label: 'Partner Commission Accrued', category: 'partners' },
  { value: 'commission.reversed', label: 'Partner Commission Reversed', category: 'partners' },
  { value: 'payout.reserved', label: 'Partner Payout Reserved', category: 'partners' },
  { value: 'payout.paid', label: 'Partner Payout Paid', category: 'partners' },
  { value: 'payout.cancelled', label: 'Partner Payout Cancelled', category: 'partners' },
  { value: 'refund.requested', label: 'Refund Request Submitted', category: 'purchases' },
  { value: 'refund.request_approved', label: 'Refund Request Approved', category: 'purchases' },
  { value: 'refund.request_rejected', label: 'Refund Request Rejected', category: 'purchases' },
  { value: 'refund.request_cancelled', label: 'Refund Request Cancelled', category: 'purchases' },
  { value: 'product.published', label: 'Product Published', category: 'catalog' },
  { value: 'product.unpublished', label: 'Product Unpublished', category: 'catalog' },
  { value: 'product.price_changed', label: 'Product Price Changed', category: 'catalog' },
  { value: 'product.sold_out', label: 'Product Sold Out', category: 'catalog' },
];
