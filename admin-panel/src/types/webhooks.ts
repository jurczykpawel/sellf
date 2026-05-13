export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  description?: string;
  is_active: boolean;
  secret: string;
  created_at: string;
}

export interface WebhookLog {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: any;
  
  // New fields
  status: 'success' | 'failed' | 'retried' | 'archived';
  http_status: number; // Formerly response_status
  
  response_body: string;
  error_message?: string;
  duration_ms: number;
  created_at: string;
  
  endpoint?: {
    id: string;
    url: string;
    description?: string;
    is_active: boolean;
  };
}

export const WEBHOOK_EVENTS = [
  { value: 'purchase.completed', label: 'Purchase Completed' },
  { value: 'lead.captured', label: 'Lead Captured (Free Product)' },
  { value: 'waitlist.signup', label: 'Waitlist Signup' },
  { value: 'access.expired', label: 'Access Expired' },
  // Subscriptions MVP (Phase 3)
  { value: 'subscription.created', label: 'Subscription Created' },
  { value: 'subscription.updated', label: 'Subscription Updated' },
  { value: 'subscription.canceled', label: 'Subscription Canceled' },
  { value: 'subscription.trial_ending', label: 'Subscription Trial Ending' },
  { value: 'subscription.renewal_upcoming', label: 'Subscription Renewal Upcoming' },
  { value: 'invoice.paid', label: 'Invoice Paid (Subscription Renewal)' },
  { value: 'invoice.payment_failed', label: 'Invoice Payment Failed' },
  { value: 'refund.issued', label: 'Refund Issued' },
];
