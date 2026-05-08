/**
 * Unit Tests: Stripe Webhook Registration Utilities
 *
 * Test ID: UT-WEBHOOK-001 to UT-WEBHOOK-012
 * Coverage:
 * - findExistingWebhookEndpoint() — find our endpoint in Stripe's list
 * - needsVersionUpdate() — detect API version mismatch
 * - buildWebhookParams() — build Stripe create/update params
 * - getWebhookRegistrationStatus() — derive UI status from DB + Stripe data
 */

import { describe, it, expect } from 'vitest';
import {
  findExistingWebhookEndpoint,
  needsVersionUpdate,
  buildWebhookParams,
  getWebhookRegistrationStatus,
} from '@/lib/stripe/webhook-registration';
import { STRIPE_API_VERSION, STRIPE_WEBHOOK_EVENTS } from '@/lib/constants';
import type Stripe from 'stripe';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<Stripe.WebhookEndpoint> = {}): Stripe.WebhookEndpoint {
  return {
    id: 'we_test_123',
    object: 'webhook_endpoint',
    url: 'https://example.com/api/webhooks/stripe',
    status: 'enabled',
    api_version: STRIPE_API_VERSION,
    enabled_events: [...STRIPE_WEBHOOK_EVENTS],
    created: 1700000000,
    livemode: false,
    application: null,
    description: null,
    metadata: {},
    ...overrides,
  } as Stripe.WebhookEndpoint;
}

// ── findExistingWebhookEndpoint ───────────────────────────────────────────

describe('findExistingWebhookEndpoint', () => {
  const TARGET_URL = 'https://myshop.com/api/webhooks/stripe';

  // UT-WEBHOOK-001: Exact match
  it('returns endpoint when URL matches exactly', () => {
    const endpoints = [
      makeEndpoint({ id: 'we_other', url: 'https://other.com/webhook' }),
      makeEndpoint({ id: 'we_ours', url: TARGET_URL }),
    ];

    const result = findExistingWebhookEndpoint(endpoints, TARGET_URL);
    expect(result?.id).toBe('we_ours');
  });

  // UT-WEBHOOK-002: No match
  it('returns undefined when no endpoint matches the URL', () => {
    const endpoints = [
      makeEndpoint({ url: 'https://other.com/webhook' }),
      makeEndpoint({ url: 'https://another.com/api/webhooks/stripe' }),
    ];

    const result = findExistingWebhookEndpoint(endpoints, TARGET_URL);
    expect(result).toBeUndefined();
  });

  // UT-WEBHOOK-003: Empty list
  it('returns undefined for empty endpoint list', () => {
    const result = findExistingWebhookEndpoint([], TARGET_URL);
    expect(result).toBeUndefined();
  });

  // UT-WEBHOOK-004: Multiple matching — returns first
  it('returns first match when multiple endpoints share the URL', () => {
    const endpoints = [
      makeEndpoint({ id: 'we_first', url: TARGET_URL }),
      makeEndpoint({ id: 'we_second', url: TARGET_URL }),
    ];

    const result = findExistingWebhookEndpoint(endpoints, TARGET_URL);
    expect(result?.id).toBe('we_first');
  });

  // UT-WEBHOOK-005: Trailing slash mismatch — should NOT match
  it('does not match URL with trailing slash when stored without', () => {
    const endpoints = [makeEndpoint({ url: TARGET_URL + '/' })];
    const result = findExistingWebhookEndpoint(endpoints, TARGET_URL);
    expect(result).toBeUndefined();
  });
});

// ── needsVersionUpdate ────────────────────────────────────────────────────

describe('needsVersionUpdate', () => {
  // UT-WEBHOOK-006: Same version — no update needed
  it('returns false when endpoint has the current API version', () => {
    const endpoint = makeEndpoint({ api_version: STRIPE_API_VERSION });
    expect(needsVersionUpdate(endpoint, STRIPE_API_VERSION)).toBe(false);
  });

  // UT-WEBHOOK-007: Old version — update needed
  it('returns true when endpoint has an older API version', () => {
    const endpoint = makeEndpoint({ api_version: '2024-06-20' });
    expect(needsVersionUpdate(endpoint, STRIPE_API_VERSION)).toBe(true);
  });

  // UT-WEBHOOK-008: Null version — update needed
  it('returns true when endpoint api_version is null', () => {
    const endpoint = makeEndpoint({ api_version: null as unknown as string });
    expect(needsVersionUpdate(endpoint, STRIPE_API_VERSION)).toBe(true);
  });
});

// ── buildWebhookParams ────────────────────────────────────────────────────

describe('buildWebhookParams', () => {
  const URL = 'https://myshop.com/api/webhooks/stripe';

  // UT-WEBHOOK-009: Returns correct create params
  it('includes all required events', () => {
    const params = buildWebhookParams(URL);
    expect(params.enabled_events).toEqual(expect.arrayContaining([...STRIPE_WEBHOOK_EVENTS]));
    expect(params.enabled_events).toHaveLength(STRIPE_WEBHOOK_EVENTS.length);
  });

  it('uses current API version', () => {
    const params = buildWebhookParams(URL);
    expect(params.api_version).toBe(STRIPE_API_VERSION);
  });

  it('sets the correct URL', () => {
    const params = buildWebhookParams(URL);
    expect(params.url).toBe(URL);
  });

  it('registers platform-account webhooks for platform checkout events', () => {
    const params = buildWebhookParams(URL);
    expect(params).not.toHaveProperty('connect');
  });
});

// ── getWebhookRegistrationStatus ─────────────────────────────────────────

describe('getWebhookRegistrationStatus', () => {
  // UT-WEBHOOK-010: No DB record
  it('returns "not_registered" when no webhook_endpoint_id in DB', () => {
    const status = getWebhookRegistrationStatus({ webhook_endpoint_id: null });
    expect(status).toBe('not_registered');
  });

  // UT-WEBHOOK-011: DB has ID
  it('returns "registered" when webhook_endpoint_id is present in DB', () => {
    const status = getWebhookRegistrationStatus({ webhook_endpoint_id: 'we_test_123' });
    expect(status).toBe('registered');
  });

  // UT-WEBHOOK-012: Undefined config (Stripe not set up via DB)
  it('returns "not_registered" when config is null', () => {
    const status = getWebhookRegistrationStatus(null);
    expect(status).toBe('not_registered');
  });
});
