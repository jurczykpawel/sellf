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

export const WEBHOOK_EVENT_CATEGORIES = ['purchases', 'subscriptions', 'leads', 'system'] as const;
export type WebhookEventCategory = (typeof WEBHOOK_EVENT_CATEGORIES)[number];

export interface WebhookEventDefinition {
  value: string;
  label: string;
  category: WebhookEventCategory;
}

export const WEBHOOK_EVENTS: WebhookEventDefinition[] = [
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
  { value: 'refund.issued', label: 'Refund Issued', category: 'purchases' },
  { value: 'license.revoked', label: 'License Revoked (Pro)', category: 'system' },
];
