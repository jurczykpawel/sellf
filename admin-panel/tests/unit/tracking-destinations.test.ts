/**
 * Unit tests for tracking destination adapters.
 *
 * Adapters are pure transport units: take a TrackingEvent + TrackingDecision,
 * build a destination-specific payload, POST it. No DB, no audit logging
 * (dispatcher's job), no consent policy (consent-mode's job).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fbCapiDestination,
  gtmSsDestination,
  type TrackingEvent,
  type DestinationConfig,
} from '@/lib/tracking/destinations';
import type { TrackingDecision } from '@/lib/tracking/consent-mode';
import { FB_GRAPH_API_VERSION } from '@/lib/tracking/types';

vi.mock('@/lib/security/outbound-url', () => ({
  assertSafeOutboundUrl: vi.fn().mockResolvedValue(undefined),
  UnsafeOutboundUrlError: class extends Error {},
}));

function createEvent(overrides: Partial<TrackingEvent> = {}): TrackingEvent {
  return {
    eventName: 'Purchase',
    eventId: 'evt_test_123',
    eventTime: 1700000000,
    eventSourceUrl: 'https://example.com/p/test',
    value: 49.99,
    currency: 'PLN',
    contentIds: ['prod_1'],
    contentName: 'Test Product',
    orderId: 'order_123',
    userData: {
      emailHashed: 'a'.repeat(64),
      clientIp: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      fbc: 'fb.1.123.abc',
      fbp: 'fb.1.456.def',
    },
    ...overrides,
  };
}

function createConfig(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return {
    facebook_pixel_id: '123456789',
    facebook_capi_token: 'capi_token_test_value',
    facebook_test_event_code: null,
    fb_capi_enabled: true,
    gtm_server_container_url: 'https://gtm.example.com',
    gtm_ss_enabled: true,
    ...overrides,
  };
}

function mockFetchOk(body: Record<string, unknown> = { events_received: 1 }) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function mockFetchError(status: number, body: Record<string, unknown>) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function lastFetchBody(): Record<string, unknown> {
  const call = vi.mocked(global.fetch).mock.calls[0];
  return JSON.parse(call[1]?.body as string);
}

const FULL: TrackingDecision = { action: 'send_full' };
const LDU: TrackingDecision = { action: 'send_ldu' };

describe('fbCapiDestination', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('isConfigured', () => {
    it('returns true when pixel_id, capi_token, and fb_capi_enabled are all set', () => {
      expect(fbCapiDestination.isConfigured(createConfig())).toBe(true);
    });

    it('returns false when fb_capi_enabled is false', () => {
      expect(fbCapiDestination.isConfigured(createConfig({ fb_capi_enabled: false }))).toBe(false);
    });

    it('returns false when pixel_id missing', () => {
      expect(fbCapiDestination.isConfigured(createConfig({ facebook_pixel_id: null }))).toBe(false);
    });

    it('returns false when capi_token missing', () => {
      expect(fbCapiDestination.isConfigured(createConfig({ facebook_capi_token: null }))).toBe(false);
    });
  });

  describe('send', () => {
    it('POSTs to graph.facebook.com with bearer token', async () => {
      mockFetchOk();
      await fbCapiDestination.send(createEvent(), FULL, createConfig());

      const [url, options] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe(
        `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/123456789/events`
      );
      expect(options?.method).toBe('POST');
      expect(options?.headers).toMatchObject({
        Authorization: 'Bearer capi_token_test_value',
      });
    });

    it('includes test_event_code at top-level when configured', async () => {
      mockFetchOk();
      await fbCapiDestination.send(
        createEvent(),
        FULL,
        createConfig({ facebook_test_event_code: 'TEST123' })
      );
      expect(lastFetchBody().test_event_code).toBe('TEST123');
    });

    it('omits test_event_code when not configured', async () => {
      mockFetchOk();
      await fbCapiDestination.send(createEvent(), FULL, createConfig());
      expect(lastFetchBody().test_event_code).toBeUndefined();
    });

    it('on send_full: payload has no data_processing_options', async () => {
      mockFetchOk();
      await fbCapiDestination.send(createEvent(), FULL, createConfig());

      const event = (lastFetchBody().data as Record<string, unknown>[])[0];
      expect(event.data_processing_options).toBeUndefined();
    });

    it('on send_ldu: payload has data_processing_options=["LDU"] with country/state zeros', async () => {
      mockFetchOk();
      await fbCapiDestination.send(createEvent(), LDU, createConfig());

      const event = (lastFetchBody().data as Record<string, unknown>[])[0];
      expect(event.data_processing_options).toEqual(['LDU']);
      expect(event.data_processing_options_country).toBe(0);
      expect(event.data_processing_options_state).toBe(0);
    });

    it('on send_ldu: omits fbc/fbp cookies (LDU forbids ad cookies)', async () => {
      mockFetchOk();
      await fbCapiDestination.send(createEvent(), LDU, createConfig());

      const event = (lastFetchBody().data as Record<string, unknown>[])[0];
      const userData = event.user_data as Record<string, unknown>;
      expect(userData.fbc).toBeUndefined();
      expect(userData.fbp).toBeUndefined();
    });

    it('on send_full: includes fbc/fbp when present on event', async () => {
      mockFetchOk();
      await fbCapiDestination.send(createEvent(), FULL, createConfig());

      const event = (lastFetchBody().data as Record<string, unknown>[])[0];
      const userData = event.user_data as Record<string, unknown>;
      expect(userData.fbc).toBe('fb.1.123.abc');
      expect(userData.fbp).toBe('fb.1.456.def');
    });

    it('returns failure on HTTP 401 with parsed error message', async () => {
      mockFetchError(401, { error: { message: 'Invalid OAuth access token' } });
      const result = await fbCapiDestination.send(createEvent(), FULL, createConfig());

      expect(result).toEqual({
        destination: 'fb_capi',
        success: false,
        httpStatus: 401,
        error: 'Invalid OAuth access token',
      });
    });

    it('returns failure on network error', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network down'));
      const result = await fbCapiDestination.send(createEvent(), FULL, createConfig());

      expect(result.destination).toBe('fb_capi');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network down');
    });
  });
});

describe('gtmSsDestination', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('isConfigured', () => {
    it('returns true when gtm_ss_enabled and container_url set', () => {
      expect(gtmSsDestination.isConfigured(createConfig())).toBe(true);
    });

    it('returns false when gtm_ss_enabled is false', () => {
      expect(gtmSsDestination.isConfigured(createConfig({ gtm_ss_enabled: false }))).toBe(false);
    });

    it('returns false when container_url missing', () => {
      expect(
        gtmSsDestination.isConfigured(createConfig({ gtm_server_container_url: null }))
      ).toBe(false);
    });
  });

  describe('send', () => {
    it('POSTs to {containerUrl}/mp/collect', async () => {
      mockFetchOk({});
      await gtmSsDestination.send(createEvent(), FULL, createConfig());

      const [url] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe('https://gtm.example.com/mp/collect');
    });

    it('strips trailing slash from container URL', async () => {
      mockFetchOk({});
      await gtmSsDestination.send(
        createEvent(),
        FULL,
        createConfig({ gtm_server_container_url: 'https://gtm.example.com/' })
      );

      const [url] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe('https://gtm.example.com/mp/collect');
    });

    it('on send_full: consent_state grants all categories', async () => {
      mockFetchOk({});
      await gtmSsDestination.send(createEvent(), FULL, createConfig());

      const body = lastFetchBody();
      expect(body.consent_state).toEqual({
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
      });
    });

    it('on send_ldu: ad_* denied, analytics granted (reporting only)', async () => {
      mockFetchOk({});
      await gtmSsDestination.send(createEvent(), LDU, createConfig());

      const body = lastFetchBody();
      expect(body.consent_state).toEqual({
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'granted',
      });
    });

    it('on send_ldu: omits fbc/fbp from user_data', async () => {
      mockFetchOk({});
      await gtmSsDestination.send(createEvent(), LDU, createConfig());

      const userData = lastFetchBody().user_data as Record<string, unknown>;
      expect(userData.fbc).toBeUndefined();
      expect(userData.fbp).toBeUndefined();
    });

    it('returns failure on HTTP 500', async () => {
      mockFetchError(500, { error: 'internal' });
      const result = await gtmSsDestination.send(createEvent(), FULL, createConfig());

      expect(result.destination).toBe('gtm_ss');
      expect(result.success).toBe(false);
      expect(result.httpStatus).toBe(500);
    });
  });
});
