import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getUserMock, dispatchMock, logTrackingEventMock, configMaybeSingle, transactionMaybeSingle } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  dispatchMock: vi.fn(),
  logTrackingEventMock: vi.fn().mockResolvedValue(undefined),
  configMaybeSingle: vi.fn(),
  transactionMaybeSingle: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      const maybeSingle = table === 'payment_transactions' ? transactionMaybeSingle : configMaybeSingle;
      const builder = { select: () => builder, eq: () => builder, maybeSingle };
      return builder;
    },
  })),
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/tracking', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tracking')>('@/lib/tracking');
  return {
    ...actual,
    logTrackingEvent: logTrackingEventMock,
    dispatchTrackingEvent: dispatchMock,
  };
});

import { POST } from '@/app/api/tracking/fb-capi/route';

const SITE_URL = 'https://shop.example.com';

function makeRequest(options: {
  origin?: string | null;
  body?: Record<string, unknown>;
}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.origin) headers.set('origin', options.origin);
  return new NextRequest('http://localhost/api/tracking/fb-capi', {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body ?? { event_name: 'ViewContent', event_id: 'evt-1' }),
  });
}

describe('POST /api/tracking/fb-capi', () => {
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    process.env.SITE_URL = SITE_URL;
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    configMaybeSingle.mockReset();
    configMaybeSingle.mockResolvedValue({
      data: {
        facebook_pixel_id: 'px1',
        facebook_capi_token: 'tok1',
        facebook_test_event_code: null,
        fb_capi_enabled: true,
        conversion_tracking_mode: 'strict',
        gtm_ss_enabled: false,
        gtm_server_container_url: null,
      },
      error: null,
    });
    dispatchMock.mockReset();
    dispatchMock.mockResolvedValue({
      skipped: null,
      anySuccess: true,
      results: [{ destination: 'fb_capi', eventsReceived: 1 }],
    });
    transactionMaybeSingle.mockReset();
    transactionMaybeSingle.mockResolvedValue({ data: null, error: null });
    logTrackingEventMock.mockClear();
  });

  afterEach(() => {
    process.env.SITE_URL = originalSiteUrl;
  });

  it('rejects a request with no Origin header', async () => {
    const res = await POST(makeRequest({ origin: null }));
    expect(res.status).toBe(403);
  });

  it('rejects a request from a foreign origin', async () => {
    const res = await POST(makeRequest({ origin: 'https://other.example' }));
    expect(res.status).toBe(403);
  });

  it('applies the rate limit before the origin check', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limiting');
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    const res = await POST(makeRequest({ origin: 'https://other.example' }));
    expect(res.status).toBe(429);
  });

  it('accepts a request from the configured site origin', async () => {
    const res = await POST(makeRequest({ origin: SITE_URL }));
    expect(res.status).toBe(200);
  });

  it('uses only the session email, ignoring a client-supplied user_email', async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: 'real-owner@shop.example.com' } }, error: null });
    await POST(makeRequest({
      origin: SITE_URL,
      body: { event_name: 'ViewContent', event_id: 'evt-2', user_email: 'someone-else@example.com' },
    }));
    const [trackingEvent, , options] = dispatchMock.mock.calls[0];
    expect(options.customerEmailForAudit).toBe('real-owner@shop.example.com');
    expect(trackingEvent.userData.emailHashed).toBeDefined();
  });

  it('does not use a client-supplied user_email when there is no session', async () => {
    await POST(makeRequest({
      origin: SITE_URL,
      body: { event_name: 'ViewContent', event_id: 'evt-3', user_email: 'someone-else@example.com' },
    }));
    const [trackingEvent, , options] = dispatchMock.mock.calls[0];
    expect(options.customerEmailForAudit).toBeUndefined();
    expect(trackingEvent.userData.emailHashed).toBeUndefined();
  });

  it('drops a Purchase event whose order id has no matching completed transaction', async () => {
    transactionMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await POST(makeRequest({
      origin: SITE_URL,
      body: { event_name: 'Purchase', event_id: 'evt-p1', order_id: 'cs_test_unknown' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.skipped).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('drops a Purchase event with no order id at all', async () => {
    const res = await POST(makeRequest({
      origin: SITE_URL,
      body: { event_name: 'Purchase', event_id: 'evt-p2' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('forwards a Purchase event whose order id matches a completed transaction', async () => {
    transactionMaybeSingle.mockResolvedValueOnce({ data: { id: 'tx-1' }, error: null });
    const res = await POST(makeRequest({
      origin: SITE_URL,
      body: { event_name: 'Purchase', event_id: 'evt-p3', order_id: 'cs_test_real' },
    }));
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a missing has_consent flag with no consent cookie as not consented', async () => {
    await POST(makeRequest({
      origin: SITE_URL,
      body: { event_name: 'ViewContent', event_id: 'evt-no-flag' },
    }));
    const [, , options] = dispatchMock.mock.calls[0];
    expect(options.hasConsent).toBe(false);
  });

  it('still honors an explicit has_consent: true with no consent cookie', async () => {
    await POST(makeRequest({
      origin: SITE_URL,
      body: { event_name: 'ViewContent', event_id: 'evt-explicit-true', has_consent: true },
    }));
    const [, , options] = dispatchMock.mock.calls[0];
    expect(options.hasConsent).toBe(true);
  });

  it('still honors an explicit has_consent: false with no consent cookie', async () => {
    await POST(makeRequest({
      origin: SITE_URL,
      body: { event_name: 'ViewContent', event_id: 'evt-explicit-false', has_consent: false },
    }));
    const [, , options] = dispatchMock.mock.calls[0];
    expect(options.hasConsent).toBe(false);
  });

  it('passes the decrypted CAPI token to the dispatcher for an encrypted row', async () => {
    const { encryptSecret } = await import('@/lib/services/secret-encryption');
    const enc = await encryptSecret('EAAencrypted_route_token_12345');
    configMaybeSingle.mockResolvedValue({
      data: {
        facebook_pixel_id: 'px1',
        facebook_capi_token: null,
        facebook_capi_token_encrypted: enc.encryptedKey,
        facebook_capi_token_iv: enc.iv,
        facebook_capi_token_tag: enc.tag,
        facebook_test_event_code: null,
        fb_capi_enabled: true,
        conversion_tracking_mode: 'strict',
        gtm_ss_enabled: false,
        gtm_server_container_url: null,
      },
      error: null,
    });
    const res = await POST(makeRequest({ origin: SITE_URL }));
    expect(res.status).toBe(200);
    const [, config] = dispatchMock.mock.calls[0];
    expect(config.facebook_capi_token).toBe('EAAencrypted_route_token_12345');
    expect(config).not.toHaveProperty('facebook_capi_token_encrypted');
  });

  it('passes a legacy plaintext CAPI token through to the dispatcher', async () => {
    const res = await POST(makeRequest({ origin: SITE_URL }));
    expect(res.status).toBe(200);
    const [, config] = dispatchMock.mock.calls[0];
    expect(config.facebook_capi_token).toBe('tok1');
  });
});
