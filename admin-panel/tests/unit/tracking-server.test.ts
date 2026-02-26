/**
 * Unit tests for server-side tracking (GTM SS + Facebook CAPI)
 *
 * Tests the server-side conversion tracking logic including:
 * - Event type filtering (only Purchase/Lead allowed)
 * - Configuration validation (Supabase env vars, destination settings)
 * - Consent checking (send_conversions_without_consent)
 * - Destination routing (GTM SS, FB CAPI, both)
 * - Parallel destination sending
 * - Facebook Graph API payload construction and sending
 * - GTM SS payload sending
 * - Error handling for API failures and network errors
 * - Event payload builder (buildServerEventPayload)
 * - Destination resolution (resolveDestinations)
 *
 * @see admin-panel/src/lib/tracking/server.ts
 * @see admin-panel/src/lib/tracking/types.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FB_GRAPH_API_VERSION } from '@/lib/tracking/types';
import type { ServerTrackingData } from '@/lib/tracking/server';

// ===== MOCKS =====

const mockSelect = vi.fn();
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn((table: string) => {
  if (table === 'tracking_logs') return { insert: mockInsert };
  return { select: mockSelect };
});
const mockSingle = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// ===== HELPERS =====

/**
 * Known SHA256 hash of "test@example.com" (lowercase, trimmed).
 * Pre-computed to avoid reimplementing the production sha256 function.
 */
const KNOWN_HASH_TEST_EMAIL =
  '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b';

/** Default valid integrations_config returned by Supabase mock */
function createDefaultConfig(overrides: Record<string, unknown> = {}) {
  return {
    fb_capi_enabled: true,
    facebook_pixel_id: '123456789',
    facebook_capi_token: 'test_capi_token_abc',
    facebook_test_event_code: null,
    send_conversions_without_consent: true,
    gtm_ss_enabled: false,
    gtm_server_container_url: null,
    ...overrides,
  };
}

/** Config with GTM SS enabled */
function createGtmSSConfig(overrides: Record<string, unknown> = {}) {
  return createDefaultConfig({
    gtm_ss_enabled: true,
    gtm_server_container_url: 'https://gtm.example.com',
    ...overrides,
  });
}

/** Default valid ServerTrackingData for a Purchase event */
function createDefaultTrackingData(overrides: Partial<ServerTrackingData> = {}): ServerTrackingData {
  return {
    eventName: 'Purchase' as const,
    eventSourceUrl: 'https://example.com/p/test-product',
    value: 49.99,
    currency: 'PLN',
    items: [{ item_id: 'prod_1', item_name: 'Test Product', price: 49.99, quantity: 1 }],
    orderId: 'order_123',
    userEmail: 'test@example.com',
    clientIp: '1.2.3.4',
    userAgent: 'Mozilla/5.0 Test',
    ...overrides,
  };
}

/** Configure the Supabase mock to return a given config or error */
function setupSupabaseMock(
  config: Record<string, unknown> | null,
  error: Record<string, unknown> | null = null
) {
  mockSelect.mockReturnValue({ single: mockSingle });
  mockSingle.mockResolvedValue({ data: config, error });
}

/** Configure global.fetch to return a given JSON response */
function setupFetchMock(
  body: Record<string, unknown>,
  ok = true,
  status = 200
) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Setup fetch to return different responses per URL pattern */
function setupMultiFetchMock(handlers: Array<{
  pattern: string;
  body: Record<string, unknown>;
  ok?: boolean;
  status?: number;
}>) {
  vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers.find((h) => url.includes(h.pattern));
    if (!handler) throw new Error(`No mock for ${url}`);
    return {
      ok: handler.ok ?? true,
      status: handler.status ?? 200,
      json: () => Promise.resolve(handler.body),
      text: () => Promise.resolve(JSON.stringify(handler.body)),
    } as Response;
  });
}

// ===== SHARED SETUP =====

function setupTestEnv() {
  vi.resetAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'tracking_logs') return { insert: mockInsert };
    return { select: mockSelect };
  });
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
}

// ===== TEST SUITE =====

describe('resolveDestinations', () => {
  it('should detect FB CAPI as configured', async () => {
    const { resolveDestinations } = await import('@/lib/tracking/server');
    const result = resolveDestinations(createDefaultConfig());
    expect(result).toEqual({ fbCAPI: true, gtmSS: false });
  });

  it('should detect GTM SS as configured', async () => {
    const { resolveDestinations } = await import('@/lib/tracking/server');
    const result = resolveDestinations(createGtmSSConfig({ fb_capi_enabled: false }));
    expect(result).toEqual({ fbCAPI: false, gtmSS: true });
  });

  it('should detect both as configured', async () => {
    const { resolveDestinations } = await import('@/lib/tracking/server');
    const result = resolveDestinations(createGtmSSConfig());
    expect(result).toEqual({ fbCAPI: true, gtmSS: true });
  });

  it('should detect none configured', async () => {
    const { resolveDestinations } = await import('@/lib/tracking/server');
    const result = resolveDestinations(createDefaultConfig({ fb_capi_enabled: false }));
    expect(result).toEqual({ fbCAPI: false, gtmSS: false });
  });

  it('should handle null config', async () => {
    const { resolveDestinations } = await import('@/lib/tracking/server');
    const result = resolveDestinations(null);
    expect(result).toEqual({ fbCAPI: false, gtmSS: false });
  });

  it('should require all FB CAPI fields', async () => {
    const { resolveDestinations } = await import('@/lib/tracking/server');
    expect(resolveDestinations(createDefaultConfig({ facebook_pixel_id: null })).fbCAPI).toBe(false);
    expect(resolveDestinations(createDefaultConfig({ facebook_capi_token: null })).fbCAPI).toBe(false);
    expect(resolveDestinations(createDefaultConfig({ fb_capi_enabled: false })).fbCAPI).toBe(false);
  });

  it('should require both GTM SS fields', async () => {
    const { resolveDestinations } = await import('@/lib/tracking/server');
    expect(resolveDestinations(createGtmSSConfig({ gtm_ss_enabled: false })).gtmSS).toBe(false);
    expect(resolveDestinations(createGtmSSConfig({ gtm_server_container_url: null })).gtmSS).toBe(false);
  });
});

describe('trackServerSideConversion', () => {
  const originalEnv = { ...process.env };

  beforeEach(setupTestEnv);

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function getTrackFn() {
    const mod = await import('@/lib/tracking/server');
    return mod.trackServerSideConversion;
  }

  // ----- Event type filtering -----

  describe('event type filtering', () => {
    it('should reject ViewContent events with event_not_allowed_server_side', async () => {
      const trackServerSideConversion = await getTrackFn();
      const result = await trackServerSideConversion(
        createDefaultTrackingData({ eventName: 'ViewContent' })
      );

      expect(result).toEqual({
        success: false,
        skipped: true,
        reason: 'event_not_allowed_server_side',
      });
    });

    it('should reject InitiateCheckout events with event_not_allowed_server_side', async () => {
      const trackServerSideConversion = await getTrackFn();
      const result = await trackServerSideConversion(
        createDefaultTrackingData({ eventName: 'InitiateCheckout' })
      );

      expect(result).toEqual({
        success: false,
        skipped: true,
        reason: 'event_not_allowed_server_side',
      });
    });

    it('should reject AddPaymentInfo events with event_not_allowed_server_side', async () => {
      const trackServerSideConversion = await getTrackFn();
      const result = await trackServerSideConversion(
        createDefaultTrackingData({ eventName: 'AddPaymentInfo' })
      );

      expect(result).toEqual({
        success: false,
        skipped: true,
        reason: 'event_not_allowed_server_side',
      });
    });

    it('should allow Purchase events', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock({ events_received: 1 });

      const result = await trackServerSideConversion(
        createDefaultTrackingData({ eventName: 'Purchase' })
      );

      expect(result.success).toBe(true);
    });

    it('should allow Lead events', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock({ events_received: 1 });

      const result = await trackServerSideConversion(
        createDefaultTrackingData({ eventName: 'Lead' })
      );

      expect(result.success).toBe(true);
    });
  });

  // ----- Environment configuration -----

  describe('environment configuration', () => {
    it('should return error when SUPABASE_URL is missing', async () => {
      delete process.env.SUPABASE_URL;
      const trackServerSideConversion = await getTrackFn();

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        error: 'Server configuration error',
      });
    });

    it('should return error when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const trackServerSideConversion = await getTrackFn();

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        error: 'Server configuration error',
      });
    });
  });

  // ----- Destination configuration checks -----

  describe('destination configuration checks', () => {
    it('should skip when no destination is configured (FB disabled, no GTM SS)', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig({ fb_capi_enabled: false }));

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        skipped: true,
        reason: 'no_destination_configured',
      });
    });

    it('should skip when facebook_pixel_id is missing and no GTM SS', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig({ facebook_pixel_id: null }));

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        skipped: true,
        reason: 'no_destination_configured',
      });
    });

    it('should skip when facebook_capi_token is missing and no GTM SS', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig({ facebook_capi_token: null }));

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        skipped: true,
        reason: 'no_destination_configured',
      });
    });

    it('should proceed with GTM SS only when FB CAPI is not configured', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createGtmSSConfig({ fb_capi_enabled: false }));
      setupFetchMock({}); // GTM SS returns 200

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result.success).toBe(true);
      // Should only call GTM SS, not FB CAPI
      expect(global.fetch).toHaveBeenCalledOnce();
      const [url] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toContain('gtm.example.com');
    });

    it('should return error when Supabase config fetch fails', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(null, { message: 'relation does not exist', code: '42P01' });

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        error: 'Failed to fetch configuration',
      });
    });
  });

  // ----- Consent settings -----

  describe('consent settings', () => {
    it('should return server_side_conversions_disabled when send_conversions_without_consent is false', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig({ send_conversions_without_consent: false }));

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        skipped: true,
        reason: 'server_side_conversions_disabled',
      });
    });
  });

  // ----- Facebook API payload -----

  describe('Facebook API payload', () => {
    it('should send correct payload to Facebook Graph API', async () => {
      const trackServerSideConversion = await getTrackFn();
      const config = createDefaultConfig();
      setupSupabaseMock(config);
      setupFetchMock({ events_received: 1 });

      const data = createDefaultTrackingData({ eventId: 'evt_fixed_123' });
      await trackServerSideConversion(data);

      expect(global.fetch).toHaveBeenCalledOnce();

      const [url, options] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe(
        `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${config.facebook_pixel_id}/events?access_token=${config.facebook_capi_token}`
      );
      expect(options?.method).toBe('POST');
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(options?.body as string);
      expect(body.data).toHaveLength(1);

      const event = body.data[0];
      expect(event.event_name).toBe('Purchase');
      expect(event.event_id).toBe('evt_fixed_123');
      expect(event.event_source_url).toBe('https://example.com/p/test-product');
      expect(event.action_source).toBe('website');
      expect(event.event_time).toBeTypeOf('number');

      // user_data
      expect(event.user_data.client_ip_address).toBe('1.2.3.4');
      expect(event.user_data.client_user_agent).toBe('Mozilla/5.0 Test');
      expect(event.user_data.em).toEqual([KNOWN_HASH_TEST_EMAIL]);

      // custom_data
      expect(event.custom_data.currency).toBe('PLN');
      expect(event.custom_data.value).toBe(49.99);
      expect(event.custom_data.content_ids).toEqual(['prod_1']);
      expect(event.custom_data.content_name).toBe('Test Product');
      expect(event.custom_data.content_type).toBe('product');
      expect(event.custom_data.order_id).toBe('order_123');
    });

    it('should hash email correctly with SHA256 lowercase', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock({ events_received: 1 });

      const data = createDefaultTrackingData({
        eventId: 'evt_hash_test',
        userEmail: '  Test@EXAMPLE.COM  ',
      });
      await trackServerSideConversion(data);

      const body = JSON.parse(
        vi.mocked(global.fetch).mock.calls[0][1]?.body as string
      );
      const hashedEmail = body.data[0].user_data.em[0];

      expect(hashedEmail).toBe(KNOWN_HASH_TEST_EMAIL);
      expect(hashedEmail).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should include test_event_code when configured', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(
        createDefaultConfig({ facebook_test_event_code: 'TEST12345' })
      );
      setupFetchMock({ events_received: 1 });

      await trackServerSideConversion(
        createDefaultTrackingData({ eventId: 'evt_test_code' })
      );

      const body = JSON.parse(
        vi.mocked(global.fetch).mock.calls[0][1]?.body as string
      );
      expect(body.test_event_code).toBe('TEST12345');
    });

    it('should not include test_event_code when not configured', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(
        createDefaultConfig({ facebook_test_event_code: null })
      );
      setupFetchMock({ events_received: 1 });

      await trackServerSideConversion(
        createDefaultTrackingData({ eventId: 'evt_no_test_code' })
      );

      const body = JSON.parse(
        vi.mocked(global.fetch).mock.calls[0][1]?.body as string
      );
      expect(body.test_event_code).toBeUndefined();
    });

    it('should use provided event_id', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock({ events_received: 1 });

      await trackServerSideConversion(
        createDefaultTrackingData({ eventId: 'custom_event_id_xyz' })
      );

      const body = JSON.parse(
        vi.mocked(global.fetch).mock.calls[0][1]?.body as string
      );
      expect(body.data[0].event_id).toBe('custom_event_id_xyz');
    });

    it('should pass through deterministic purchase event_id to Facebook CAPI', async () => {
      const trackServerSideConversion = await getTrackFn();
      const { generatePurchaseEventId } = await import('@/lib/tracking/types');
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock({ events_received: 1 });

      const eventId = generatePurchaseEventId('cs_test_session_123');
      await trackServerSideConversion(
        createDefaultTrackingData({ eventId })
      );

      const body = JSON.parse(
        vi.mocked(global.fetch).mock.calls[0][1]?.body as string
      );
      expect(body.data[0].event_id).toBe('purchase_cs_test_session_123');
    });

    it('should generate event_id when not provided', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock({ events_received: 1 });

      await trackServerSideConversion(
        createDefaultTrackingData({ eventId: undefined })
      );

      const body = JSON.parse(
        vi.mocked(global.fetch).mock.calls[0][1]?.body as string
      );
      expect(body.data[0].event_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });
  });

  // ----- Success response -----

  describe('success response', () => {
    it('should return success with eventsReceived count', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock({ events_received: 1 });

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: true,
        eventsReceived: 1,
      });
    });
  });

  // ----- Error handling -----

  describe('error handling', () => {
    it('should handle Facebook API error response', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock(
        {
          error: {
            message: 'Invalid OAuth access token',
            type: 'OAuthException',
            code: 190,
          },
        },
        false,
        401
      );

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        error: 'Invalid OAuth access token',
      });
    });

    it('should handle Facebook API error without message field', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      setupFetchMock({ error: {} }, false, 500);

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result).toEqual({
        success: false,
        error: 'Facebook API request failed',
      });
    });

    it('should handle fetch network error', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig());
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ----- GTM Server-Side -----

  describe('GTM Server-Side destination', () => {
    it('should send to GTM SS when enabled', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createGtmSSConfig({ fb_capi_enabled: false }));
      setupFetchMock({});

      const result = await trackServerSideConversion(
        createDefaultTrackingData({ eventId: 'evt_gtm_123' })
      );

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledOnce();

      const [url, options] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe('https://gtm.example.com/mp/collect');
      expect(options?.method).toBe('POST');

      const body = JSON.parse(options?.body as string);
      expect(body.event_name).toBe('Purchase');
      expect(body.event_id).toBe('evt_gtm_123');
      expect(body.user_data.em).toEqual([KNOWN_HASH_TEST_EMAIL]);
    });

    it('should strip trailing slash from container URL', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createGtmSSConfig({
        fb_capi_enabled: false,
        gtm_server_container_url: 'https://gtm.example.com/',
      }));
      setupFetchMock({});

      await trackServerSideConversion(createDefaultTrackingData());

      const [url] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe('https://gtm.example.com/mp/collect');
    });

    it('should send to both GTM SS and FB CAPI when both are configured', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createGtmSSConfig());
      setupMultiFetchMock([
        { pattern: 'gtm.example.com', body: {} },
        { pattern: 'graph.facebook.com', body: { events_received: 1 } },
      ]);

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result.success).toBe(true);
      expect(result.eventsReceived).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should succeed if GTM SS fails but FB CAPI succeeds', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createGtmSSConfig());
      setupMultiFetchMock([
        { pattern: 'gtm.example.com', body: {}, ok: false, status: 500 },
        { pattern: 'graph.facebook.com', body: { events_received: 1 } },
      ]);

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result.success).toBe(true);
      expect(result.eventsReceived).toBe(1);
    });

    it('should succeed if FB CAPI fails but GTM SS succeeds', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createGtmSSConfig());
      setupMultiFetchMock([
        { pattern: 'gtm.example.com', body: {} },
        { pattern: 'graph.facebook.com', body: { error: { message: 'Invalid token' } }, ok: false, status: 401 },
      ]);

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result.success).toBe(true);
    });

    it('should fail if both destinations fail', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createGtmSSConfig());
      setupMultiFetchMock([
        { pattern: 'gtm.example.com', body: {}, ok: false, status: 500 },
        { pattern: 'graph.facebook.com', body: { error: { message: 'Bad token' } }, ok: false, status: 401 },
      ]);

      const result = await trackServerSideConversion(createDefaultTrackingData());

      expect(result.success).toBe(false);
      expect(result.error).toContain('gtm_ss');
      expect(result.error).toContain('fb_capi');
    });

    it('should not send to GTM SS when disabled', async () => {
      const trackServerSideConversion = await getTrackFn();
      setupSupabaseMock(createDefaultConfig()); // gtm_ss_enabled: false
      setupFetchMock({ events_received: 1 });

      await trackServerSideConversion(createDefaultTrackingData());

      expect(global.fetch).toHaveBeenCalledOnce();
      const [url] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toContain('graph.facebook.com');
    });
  });
});

// ===== buildServerEventPayload =====

describe('buildServerEventPayload', () => {
  it('should build correct payload structure', async () => {
    const { buildServerEventPayload } = await import('@/lib/tracking/server');

    const payload = buildServerEventPayload(
      createDefaultTrackingData(),
      'test_event_123'
    );

    expect(payload.event_name).toBe('Purchase');
    expect(payload.event_id).toBe('test_event_123');
    expect(payload.event_source_url).toBe('https://example.com/p/test-product');
    expect(payload.action_source).toBe('website');
    expect(payload.event_time).toBeTypeOf('number');

    expect(payload.user_data.client_ip_address).toBe('1.2.3.4');
    expect(payload.user_data.client_user_agent).toBe('Mozilla/5.0 Test');
    expect(payload.user_data.em).toEqual([KNOWN_HASH_TEST_EMAIL]);

    expect(payload.custom_data.currency).toBe('PLN');
    expect(payload.custom_data.value).toBe(49.99);
    expect(payload.custom_data.content_ids).toEqual(['prod_1']);
    expect(payload.custom_data.content_name).toBe('Test Product');
    expect(payload.custom_data.order_id).toBe('order_123');
  });

  it('should omit user_data fields when not provided', async () => {
    const { buildServerEventPayload } = await import('@/lib/tracking/server');

    const payload = buildServerEventPayload(
      createDefaultTrackingData({ clientIp: undefined, userAgent: undefined, userEmail: undefined }),
      'test_123'
    );

    expect(payload.user_data.client_ip_address).toBeUndefined();
    expect(payload.user_data.client_user_agent).toBeUndefined();
    expect(payload.user_data.em).toBeUndefined();
  });

  it('should omit order_id from custom_data when not provided', async () => {
    const { buildServerEventPayload } = await import('@/lib/tracking/server');

    const payload = buildServerEventPayload(
      createDefaultTrackingData({ orderId: undefined }),
      'test_123'
    );

    expect(payload.custom_data.order_id).toBeUndefined();
  });
});

// ===== sendToGtmSS =====

describe('sendToGtmSS', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should POST to /mp/collect endpoint', async () => {
    const { sendToGtmSS, buildServerEventPayload } = await import('@/lib/tracking/server');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    } as Response);

    const payload = buildServerEventPayload(
      createDefaultTrackingData(),
      'gtm_test_123'
    );
    const result = await sendToGtmSS('https://gtm.example.com', payload);

    expect(result.destination).toBe('gtm_ss');
    expect(result.success).toBe(true);
    expect(result.httpStatus).toBe(200);

    const [url, options] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('https://gtm.example.com/mp/collect');
    expect(options?.method).toBe('POST');
  });

  it('should handle non-ok response', async () => {
    const { sendToGtmSS, buildServerEventPayload } = await import('@/lib/tracking/server');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve('Bad Gateway'),
    } as Response);

    const payload = buildServerEventPayload(
      createDefaultTrackingData(),
      'gtm_fail_123'
    );
    const result = await sendToGtmSS('https://gtm.example.com', payload);

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(502);
    expect(result.error).toBe('Bad Gateway');
  });

  it('should handle network error', async () => {
    const { sendToGtmSS, buildServerEventPayload } = await import('@/lib/tracking/server');
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('DNS resolution failed'));

    const payload = buildServerEventPayload(
      createDefaultTrackingData(),
      'gtm_net_err'
    );
    const result = await sendToGtmSS('https://gtm.example.com', payload);

    expect(result.success).toBe(false);
    expect(result.error).toBe('DNS resolution failed');
  });
});

// ===== sendToFacebookCAPI =====

describe('sendToFacebookCAPI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send correctly to Graph API', async () => {
    const { sendToFacebookCAPI, buildServerEventPayload } = await import('@/lib/tracking/server');
    setupFetchMock({ events_received: 1 });

    const payload = buildServerEventPayload(
      createDefaultTrackingData(),
      'fb_test_123'
    );
    const result = await sendToFacebookCAPI('123456789', 'token_abc', payload);

    expect(result.destination).toBe('fb_capi');
    expect(result.success).toBe(true);
    expect(result.eventsReceived).toBe(1);

    const [url] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toContain('graph.facebook.com');
    expect(url).toContain('123456789');
  });

  it('should include test_event_code when provided', async () => {
    const { sendToFacebookCAPI, buildServerEventPayload } = await import('@/lib/tracking/server');
    setupFetchMock({ events_received: 1 });

    const payload = buildServerEventPayload(
      createDefaultTrackingData(),
      'fb_test_code'
    );
    await sendToFacebookCAPI('123456789', 'token_abc', payload, 'TEST99');

    const body = JSON.parse(
      vi.mocked(global.fetch).mock.calls[0][1]?.body as string
    );
    expect(body.test_event_code).toBe('TEST99');
  });

  it('should handle API error', async () => {
    const { sendToFacebookCAPI, buildServerEventPayload } = await import('@/lib/tracking/server');
    setupFetchMock({ error: { message: 'Invalid token' } }, false, 401);

    const payload = buildServerEventPayload(
      createDefaultTrackingData(),
      'fb_err'
    );
    const result = await sendToFacebookCAPI('123456789', 'bad_token', payload);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid token');
    expect(result.httpStatus).toBe(401);
  });
});

// ===== logTrackingEvent =====

describe('logTrackingEvent', () => {
  const originalEnv = { ...process.env };

  beforeEach(setupTestEnv);

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function getLogFn() {
    const mod = await import('@/lib/tracking/server');
    return mod.logTrackingEvent;
  }

  it('should insert log entry with correct fields', async () => {
    const logTrackingEvent = await getLogFn();

    await logTrackingEvent({
      eventName: 'Purchase',
      eventId: 'purchase_cs_test_123',
      source: 'server',
      status: 'success',
      destination: 'fb_capi',
      orderId: 'cs_test_123',
      customerEmail: 'buyer@example.com',
      value: 99.00,
      currency: 'PLN',
      httpStatus: 200,
      eventsReceived: 1,
      durationMs: 150,
    });

    expect(mockFrom).toHaveBeenCalledWith('tracking_logs');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'Purchase',
        event_id: 'purchase_cs_test_123',
        source: 'server',
        status: 'success',
        destination: 'fb_capi',
        order_id: 'cs_test_123',
        customer_email: 'buyer@example.com',
        value: 99.00,
        currency: 'PLN',
        http_status: 200,
        events_received: 1,
        duration_ms: 150,
      })
    );
  });

  it('should handle skipped events with skip_reason', async () => {
    const logTrackingEvent = await getLogFn();

    await logTrackingEvent({
      eventName: 'Purchase',
      eventId: 'test_id',
      source: 'client_proxy',
      status: 'skipped',
      skipReason: 'no_consent',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        skip_reason: 'no_consent',
        source: 'client_proxy',
      })
    );
  });

  it('should handle failed events with error_message', async () => {
    const logTrackingEvent = await getLogFn();

    await logTrackingEvent({
      eventName: 'Lead',
      eventId: 'lead_123',
      source: 'server',
      status: 'failed',
      httpStatus: 400,
      errorMessage: 'Invalid pixel ID',
      durationMs: 80,
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'Lead',
        status: 'failed',
        http_status: 400,
        error_message: 'Invalid pixel ID',
        duration_ms: 80,
      })
    );
  });

  it('should never throw even if insert fails', async () => {
    mockInsert.mockRejectedValue(new Error('DB connection lost'));
    const logTrackingEvent = await getLogFn();

    await expect(
      logTrackingEvent({
        eventName: 'Purchase',
        eventId: 'test',
        source: 'server',
        status: 'success',
      })
    ).resolves.toBeUndefined();
  });

  it('should use provided supabase client instead of creating one', async () => {
    const logTrackingEvent = await getLogFn();
    const customInsert = vi.fn().mockResolvedValue({ error: null });
    const customClient = { from: () => ({ insert: customInsert }) };

    await logTrackingEvent(
      {
        eventName: 'Purchase',
        eventId: 'test',
        source: 'server',
        status: 'success',
      },
      customClient
    );

    expect(customInsert).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('trackServerSideConversion logging integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(setupTestEnv);

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function getTrackFn() {
    const mod = await import('@/lib/tracking/server');
    return mod.trackServerSideConversion;
  }

  it('should log success event to tracking_logs on successful FB send', async () => {
    const trackServerSideConversion = await getTrackFn();
    setupSupabaseMock(createDefaultConfig());
    setupFetchMock({ events_received: 1 });

    await trackServerSideConversion(createDefaultTrackingData());

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'Purchase',
        source: 'server',
        status: 'success',
        destination: 'fb_capi',
        http_status: 200,
        events_received: 1,
        order_id: 'order_123',
        customer_email: 'test@example.com',
        value: 49.99,
        currency: 'PLN',
      })
    );
  });

  it('should log skipped event when no destination configured', async () => {
    const trackServerSideConversion = await getTrackFn();
    setupSupabaseMock(createDefaultConfig({ fb_capi_enabled: false }));

    await trackServerSideConversion(createDefaultTrackingData());

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        skip_reason: 'no_destination_configured',
      })
    );
  });

  it('should log skipped event when server-side conversions disabled', async () => {
    const trackServerSideConversion = await getTrackFn();
    setupSupabaseMock(createDefaultConfig({ send_conversions_without_consent: false }));

    await trackServerSideConversion(createDefaultTrackingData());

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        skip_reason: 'server_side_conversions_disabled',
      })
    );
  });

  it('should log failed event on FB API error', async () => {
    const trackServerSideConversion = await getTrackFn();
    setupSupabaseMock(createDefaultConfig());
    setupFetchMock({ error: { message: 'Invalid token' } }, false, 401);

    await trackServerSideConversion(createDefaultTrackingData());

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        destination: 'fb_capi',
        http_status: 401,
        error_message: 'Invalid token',
      })
    );
  });

  it('should log failed event on network exception', async () => {
    const trackServerSideConversion = await getTrackFn();
    setupSupabaseMock(createDefaultConfig());
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    await trackServerSideConversion(createDefaultTrackingData());

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'Network error',
      })
    );
  });

  it('should log GTM SS destination separately from FB CAPI', async () => {
    const trackServerSideConversion = await getTrackFn();
    setupSupabaseMock(createGtmSSConfig());
    setupMultiFetchMock([
      { pattern: 'gtm.example.com', body: {} },
      { pattern: 'graph.facebook.com', body: { events_received: 1 } },
    ]);

    await trackServerSideConversion(createDefaultTrackingData());

    // Should have two log entries — one for GTM SS, one for FB CAPI
    const calls = mockInsert.mock.calls;
    const destinations = calls.map((c) => c[0].destination);
    expect(destinations).toContain('gtm_ss');
    expect(destinations).toContain('fb_capi');
  });
});

// ===== generatePurchaseEventId =====

describe('generatePurchaseEventId', () => {
  it('should generate deterministic ID from Stripe session ID', async () => {
    const { generatePurchaseEventId } = await import('@/lib/tracking/types');
    expect(generatePurchaseEventId('cs_test_abc123')).toBe('purchase_cs_test_abc123');
  });

  it('should generate deterministic ID from payment intent ID', async () => {
    const { generatePurchaseEventId } = await import('@/lib/tracking/types');
    expect(generatePurchaseEventId('pi_test_xyz789')).toBe('purchase_pi_test_xyz789');
  });

  it('should produce the same ID for the same input (idempotent)', async () => {
    const { generatePurchaseEventId } = await import('@/lib/tracking/types');
    const id1 = generatePurchaseEventId('cs_test_same');
    const id2 = generatePurchaseEventId('cs_test_same');
    expect(id1).toBe(id2);
  });
});
