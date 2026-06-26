import { describe, it, expect, vi, afterEach } from 'vitest';
import { lookupCompanyByNip } from '@/lib/gus/lookup';

const COMPANY = {
  nazwa: 'ORANGE POLSKA SPÓŁKA AKCYJNA',
  ulica: 'Aleje Jerozolimskie',
  nrNieruchomosci: '160',
  nrLokalu: '',
  miejscowosc: 'Warszawa',
  kodPocztowy: '02-326',
  regon: '012100784',
  nip: '5260250995',
};

function mockFetch(body: unknown, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('lookupCompanyByNip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the nip to the GUS endpoint', async () => {
    mockFetch({ success: true, data: COMPANY });

    await lookupCompanyByNip('5260250995');

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('/api/gus/fetch-company-data');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({ nip: '5260250995' });
  });

  it('forwards an abort signal to fetch', async () => {
    mockFetch({ success: true, data: COMPANY });
    const controller = new AbortController();

    await lookupCompanyByNip('5260250995', controller.signal);

    const [, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(options?.signal).toBe(controller.signal);
  });

  it('returns ok with company data on success', async () => {
    mockFetch({ success: true, data: COMPANY });

    const result = await lookupCompanyByNip('5260250995');

    expect(result).toEqual({ ok: true, data: COMPANY });
  });

  it('maps HTTP 429 to rate_limit', async () => {
    mockFetch({ success: false, code: 'RATE_LIMIT_EXCEEDED' }, 429);

    const result = await lookupCompanyByNip('5260250995');

    expect(result).toEqual({ ok: false, code: 'rate_limit' });
  });

  it('maps a not-found response to not_found', async () => {
    mockFetch({ success: false, code: 'NOT_FOUND' }, 404);

    const result = await lookupCompanyByNip('5260250995');

    expect(result).toEqual({ ok: false, code: 'not_found' });
  });

  it('maps HTTP 403 to security', async () => {
    mockFetch({ success: false, code: 'INVALID_ORIGIN' }, 403);

    const result = await lookupCompanyByNip('5260250995');

    expect(result).toEqual({ ok: false, code: 'security' });
  });

  it('maps a not-configured response to not_configured (silent)', async () => {
    mockFetch({ success: false, code: 'NOT_CONFIGURED' }, 503);

    const result = await lookupCompanyByNip('5260250995');

    expect(result).toEqual({ ok: false, code: 'not_configured' });
  });

  it('maps an unclassified error response to error', async () => {
    mockFetch({ success: false, code: 'UNKNOWN_ERROR' }, 500);

    const result = await lookupCompanyByNip('5260250995');

    expect(result).toEqual({ ok: false, code: 'error' });
  });

  it('maps a thrown network error to error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await lookupCompanyByNip('5260250995');

    expect(result).toEqual({ ok: false, code: 'error' });
  });
});
