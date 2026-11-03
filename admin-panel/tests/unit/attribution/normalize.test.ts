/** Server-side validation of client-supplied attribution: untrusted labels, bounded, consent-gated. */
import { describe, expect, it } from 'vitest';
import { normalizeAttribution } from '@/lib/attribution/normalize';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

describe('normalizeAttribution', () => {
  it('accepts a collector payload and adds device class and CDN country', () => {
    const out = normalizeAttribution({
      v: 1, consent: 'analytics', mode: 'stored', sessions_count: 2, first_seen_at: '2026-11-01T10:00:00.000Z', click: null,
      first: { source: 'facebook', medium: 'paid_social', campaign: 'a', content: null, term: null, id: null, referrer_host: null, landing_path: '/', at: '2026-11-01T10:00:00.000Z' },
      last: { source: 'listmonk', medium: 'email', campaign: 'mail-05', content: 'cta', term: null, id: null, referrer_host: null, landing_path: '/offer', at: '2026-11-02T10:00:00.000Z' },
    }, { userAgent: iphone, country: 'pl' });
    expect(out).toMatchObject({ consent: 'analytics', mode: 'stored', sessions_count: 2, device_class: 'mobile', country: 'PL',
      last: { source: 'listmonk', campaign: 'mail-05' }, first: { source: 'facebook' } });
  });

  it('falls back to an empty url-mode record when the client sent nothing', () => {
    expect(normalizeAttribution(undefined, { userAgent: mac, country: null })).toMatchObject({
      consent: 'none', mode: 'none', first: null, last: null, click: null, device_class: 'desktop', country: null,
    });
  });

  it('drops a click id when the visitor did not consent to marketing', () => {
    const out = normalizeAttribution({ v: 1, consent: 'analytics', mode: 'url', last: null, first: null, click: { type: 'fbclid', value: 'x' } }, { userAgent: mac, country: null });
    expect(out.click).toBeNull();
    const ok = normalizeAttribution({ v: 1, consent: 'marketing', mode: 'url', last: null, first: null, click: { type: 'fbclid', value: 'x' } }, { userAgent: mac, country: null });
    expect(ok.click).toEqual({ type: 'fbclid', value: 'x' });
  });

  it('rejects hostile values field by field instead of failing the checkout', () => {
    const out = normalizeAttribution({
      v: 1, consent: 'root', mode: 'url', click: { type: 'evil', value: 'x' },
      last: { source: 'a'.repeat(5000), medium: 'email', referrer_host: 'javascript:alert(1)', landing_path: 'https://evil/x?token=1', at: 'yesterday' },
    }, { userAgent: mac, country: 'T1' });
    expect(out.consent).toBe('none');
    expect(out.click).toBeNull();
    expect(out.country).toBeNull();
    expect(out.last?.source?.length).toBeLessThanOrEqual(200);
    expect(out.last).toMatchObject({ medium: 'email', referrer_host: null, landing_path: null, at: null });
  });
});
