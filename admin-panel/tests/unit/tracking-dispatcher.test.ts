/**
 * Unit tests for the tracking dispatcher.
 *
 * Dispatcher orchestrates: resolve decision → fan out to configured destinations
 * → write audit log for every outcome (success/fail/skip). Adapters are mocked
 * so behaviour assertions stay independent of HTTP details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchTrackingEvent } from '@/lib/tracking/dispatcher';
import type { TrackingEvent, DestinationConfig } from '@/lib/tracking/destinations';
import type { DestinationResult } from '@/lib/tracking/server';

// ---- mocks ----------------------------------------------------------------

const { fbSendMock, gtmSendMock, auditLogMock } = vi.hoisted(() => ({
  fbSendMock: vi.fn(),
  gtmSendMock: vi.fn(),
  auditLogMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tracking/destinations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tracking/destinations')>();
  const fbCapiDestination = {
    name: 'fb_capi' as const,
    isConfigured: (cfg: DestinationConfig) =>
      !!(cfg.fb_capi_enabled && cfg.facebook_pixel_id && cfg.facebook_capi_token),
    send: fbSendMock,
  };
  const gtmSsDestination = {
    name: 'gtm_ss' as const,
    isConfigured: (cfg: DestinationConfig) =>
      !!(cfg.gtm_ss_enabled && cfg.gtm_server_container_url),
    send: gtmSendMock,
  };
  return {
    ...actual,
    fbCapiDestination,
    gtmSsDestination,
    ALL_DESTINATIONS: [gtmSsDestination, fbCapiDestination] as const,
  };
});

vi.mock('@/lib/tracking/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tracking/server')>();
  return {
    ...actual,
    logTrackingEvent: (...args: unknown[]) => auditLogMock(...args),
  };
});

// ---- helpers --------------------------------------------------------------

function createEvent(overrides: Partial<TrackingEvent> = {}): TrackingEvent {
  return {
    eventName: 'Purchase',
    eventId: 'evt_dispatch_1',
    eventTime: 1700000000,
    eventSourceUrl: 'https://example.com/p/test',
    value: 49.99,
    currency: 'PLN',
    contentIds: ['prod_1'],
    contentName: 'Test Product',
    orderId: 'order_dispatch_1',
    userData: {
      emailHashed: 'a'.repeat(64),
      clientIp: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    },
    ...overrides,
  };
}

function createConfig(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return {
    facebook_pixel_id: '123456789',
    facebook_capi_token: 'tok',
    facebook_test_event_code: null,
    fb_capi_enabled: true,
    gtm_server_container_url: 'https://gtm.example.com',
    gtm_ss_enabled: true,
    ...overrides,
  };
}

const okResult = (name: 'fb_capi' | 'gtm_ss'): DestinationResult => ({
  destination: name,
  success: true,
  httpStatus: 200,
  eventsReceived: 1,
});

// ---- tests ----------------------------------------------------------------

describe('dispatchTrackingEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fbSendMock.mockResolvedValue(okResult('fb_capi'));
    gtmSendMock.mockResolvedValue(okResult('gtm_ss'));
  });

  afterEach(() => vi.restoreAllMocks());

  describe('skip path', () => {
    it('mode=strict + no consent + Purchase: does not call any destination', async () => {
      await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'strict',
        hasConsent: false,
        source: 'server',
      });

      expect(fbSendMock).not.toHaveBeenCalled();
      expect(gtmSendMock).not.toHaveBeenCalled();
    });

    it('mode=strict + no consent: audits a single skip entry with the reason', async () => {
      await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'strict',
        hasConsent: false,
        source: 'server',
      });

      const skipCalls = auditLogMock.mock.calls.filter(
        (c) => (c[0] as { status: string }).status === 'skipped'
      );
      expect(skipCalls).toHaveLength(1);
      expect(skipCalls[0][0]).toMatchObject({
        status: 'skipped',
        skipReason: 'no_consent_strict_mode',
        source: 'server',
        eventName: 'Purchase',
      });
    });

    it('limited mode + no consent + ViewContent: skip browsing event without calling destinations', async () => {
      await dispatchTrackingEvent(
        createEvent({ eventName: 'ViewContent' }),
        createConfig(),
        { mode: 'limited', hasConsent: false, source: 'client_proxy' }
      );

      expect(fbSendMock).not.toHaveBeenCalled();
      expect(gtmSendMock).not.toHaveBeenCalled();

      const skipCalls = auditLogMock.mock.calls.filter(
        (c) => (c[0] as { status: string }).status === 'skipped'
      );
      expect(skipCalls[0][0]).toMatchObject({
        skipReason: 'browsing_event_requires_consent',
      });
    });
  });

  describe('send_ldu path (limited + reject + Purchase)', () => {
    it('calls fb_capi with send_ldu decision', async () => {
      await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'limited',
        hasConsent: false,
        source: 'server',
      });

      expect(fbSendMock).toHaveBeenCalledOnce();
      const [, decision] = fbSendMock.mock.calls[0];
      expect(decision).toEqual({ action: 'send_ldu' });
    });

    it('calls gtm_ss with send_ldu decision', async () => {
      await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'limited',
        hasConsent: false,
        source: 'server',
      });

      const [, decision] = gtmSendMock.mock.calls[0];
      expect(decision).toEqual({ action: 'send_ldu' });
    });

    it('audits each destination outcome separately', async () => {
      await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'limited',
        hasConsent: false,
        source: 'server',
      });

      const successCalls = auditLogMock.mock.calls.filter(
        (c) => (c[0] as { status: string }).status === 'success'
      );
      const destinations = successCalls.map((c) => (c[0] as { destination: string }).destination);
      expect(destinations).toContain('fb_capi');
      expect(destinations).toContain('gtm_ss');
    });
  });

  describe('send_full path', () => {
    it('mode=permissive + reject + Purchase: send_full decision passed to destinations', async () => {
      await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'permissive',
        hasConsent: false,
        source: 'server',
      });

      const [, decision] = fbSendMock.mock.calls[0];
      expect(decision).toEqual({ action: 'send_full' });
    });

    it('consent granted + any mode: send_full decision', async () => {
      await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'strict',
        hasConsent: true,
        source: 'client_proxy',
      });

      const [, decision] = fbSendMock.mock.calls[0];
      expect(decision).toEqual({ action: 'send_full' });
    });
  });

  describe('destination selection', () => {
    it('skips fb_capi when not configured but still calls gtm_ss', async () => {
      await dispatchTrackingEvent(
        createEvent(),
        createConfig({ fb_capi_enabled: false }),
        { mode: 'strict', hasConsent: true, source: 'server' }
      );

      expect(fbSendMock).not.toHaveBeenCalled();
      expect(gtmSendMock).toHaveBeenCalledOnce();
    });

    it('audits no_destination_configured when neither configured (no skip-reason from consent)', async () => {
      await dispatchTrackingEvent(
        createEvent(),
        createConfig({ fb_capi_enabled: false, gtm_ss_enabled: false }),
        { mode: 'strict', hasConsent: true, source: 'server' }
      );

      expect(fbSendMock).not.toHaveBeenCalled();
      expect(gtmSendMock).not.toHaveBeenCalled();

      const skipCalls = auditLogMock.mock.calls.filter(
        (c) => (c[0] as { status: string }).status === 'skipped'
      );
      expect(skipCalls[0][0]).toMatchObject({
        skipReason: 'no_destination_configured',
      });
    });
  });

  describe('failure handling', () => {
    it('one destination failing does not block the other', async () => {
      fbSendMock.mockResolvedValue({
        destination: 'fb_capi',
        success: false,
        httpStatus: 401,
        error: 'Invalid token',
      });

      const result = await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'strict',
        hasConsent: true,
        source: 'server',
      });

      expect(gtmSendMock).toHaveBeenCalledOnce();
      expect(result.anySuccess).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it('returns anySuccess=false when all destinations fail', async () => {
      fbSendMock.mockResolvedValue({
        destination: 'fb_capi',
        success: false,
        error: 'fail-1',
      });
      gtmSendMock.mockResolvedValue({
        destination: 'gtm_ss',
        success: false,
        error: 'fail-2',
      });

      const result = await dispatchTrackingEvent(createEvent(), createConfig(), {
        mode: 'strict',
        hasConsent: true,
        source: 'server',
      });

      expect(result.anySuccess).toBe(false);
      expect(result.results.every((r) => !r.success)).toBe(true);
    });
  });
});
