/**
 * Stripe Webhook Registration Utilities
 *
 * Pure helper functions for webhook endpoint management.
 * Used by createStripeWebhookEndpoint() server action and StripeSettings UI.
 *
 * @see admin-panel/src/lib/actions/stripe-config.ts (server action)
 * @see admin-panel/src/components/settings/StripeSettings.tsx (UI)
 */

import { STRIPE_API_VERSION, STRIPE_WEBHOOK_EVENTS } from '@/lib/constants';
import type Stripe from 'stripe';

export type WebhookRegistrationStatus = 'registered' | 'not_registered';

/**
 * Find the webhook endpoint that matches our app URL from a Stripe list.
 * Returns the first match, or undefined if none found.
 */
export function findExistingWebhookEndpoint(
  endpoints: Stripe.WebhookEndpoint[],
  url: string
): Stripe.WebhookEndpoint | undefined {
  return endpoints.find((e) => e.url === url);
}

/**
 * Returns true if the endpoint's API version differs from the current target.
 */
export function needsVersionUpdate(
  endpoint: Stripe.WebhookEndpoint,
  targetVersion: string
): boolean {
  return endpoint.api_version !== targetVersion;
}

/**
 * Build params for stripe.webhookEndpoints.create() or .update().
 */
export function buildWebhookParams(url: string): Stripe.WebhookEndpointCreateParams {
  return {
    url,
    enabled_events: [...STRIPE_WEBHOOK_EVENTS] as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
    api_version: STRIPE_API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
    // Stripe Connect: receive events from connected seller accounts
    connect: true,
  };
}

/**
 * Derive the registration status from a DB config row.
 */
export function getWebhookRegistrationStatus(
  config: { webhook_endpoint_id: string | null } | null
): WebhookRegistrationStatus {
  if (!config?.webhook_endpoint_id) return 'not_registered';
  return 'registered';
}
