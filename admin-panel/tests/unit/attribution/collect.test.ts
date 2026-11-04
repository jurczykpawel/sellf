/** Buyer-side attribution collector: what a checkout receives from the landing URL and, with consent, from storage. */
import { describe, expect, it } from 'vitest';
import { collectAttribution, decorateCheckoutUrl, ATTRIBUTION_HANDOFF_PARAM } from '@/lib/attribution/collect';

const T0 = Date.parse('2026-11-01T10:00:00Z');
const HOUR = 3600_000;

describe('collectAttribution', () => {
  it('without consent keeps only the current landing URL and stores nothing (cookieless mode)', () => {
    const r = collectAttribution({
      href: 'https://shop.example/offer?utm_source=Listmonk&utm_medium=email&utm_campaign=mail-05&utm_content=cta-1&fbclid=abc',
      referrer: '', now: T0, consent: 'none', stored: '{"first":{"source":"old"}}',
    });
    expect(r.store).toBeNull();
    expect(r.payload).toMatchObject({
      v: 1, consent: 'none', mode: 'url', first: null, sessions_count: null, click: null,
      last: { source: 'listmonk', medium: 'email', campaign: 'mail-05', content: 'cta-1', landing_path: '/offer' },
    });
  });

  it('records the external referrer host without its path, and ignores same-site referrers', () => {
    const ext = collectAttribution({ href: 'https://shop.example/a', referrer: 'https://www.google.pl/search?q=x', now: T0, consent: 'none', stored: null });
    expect(ext.payload.last?.referrer_host).toBe('google.pl');
    const internal = collectAttribution({ href: 'https://shop.example/a', referrer: 'https://shop.example/blog', now: T0, consent: 'none', stored: null });
    expect(internal.payload.last?.referrer_host).toBeNull();
  });

  it('with analytics consent keeps first touch, updates last touch and counts sessions', () => {
    const visit1 = collectAttribution({
      href: 'https://shop.example/?utm_source=facebook&utm_medium=paid_social&utm_campaign=autumn', referrer: '', now: T0, consent: 'analytics', stored: null,
    });
    expect(visit1.payload).toMatchObject({ mode: 'stored', sessions_count: 1, first: { source: 'facebook' }, last: { source: 'facebook' } });
    const sameSession = collectAttribution({ href: 'https://shop.example/checkout', referrer: '', now: T0 + 10 * 60_000, consent: 'analytics', stored: visit1.store });
    expect(sameSession.payload.sessions_count).toBe(1);
    const visit2 = collectAttribution({
      href: 'https://shop.example/offer?utm_source=listmonk&utm_medium=email&utm_campaign=mail-05', referrer: '', now: T0 + 48 * HOUR, consent: 'analytics', stored: sameSession.store,
    });
    expect(visit2.payload).toMatchObject({
      sessions_count: 2, first: { source: 'facebook', campaign: 'autumn' }, last: { source: 'listmonk', campaign: 'mail-05' },
      first_seen_at: new Date(T0).toISOString(),
    });
    const directReturn = collectAttribution({ href: 'https://shop.example/offer', referrer: '', now: T0 + 96 * HOUR, consent: 'analytics', stored: visit2.store });
    expect(directReturn.payload.last?.source).toBe('listmonk');
    expect(directReturn.payload.sessions_count).toBe(3);
  });

  it('keeps an ad click id only with marketing consent', () => {
    const href = 'https://shop.example/?gclid=CjwKCAiA&utm_source=google&utm_medium=cpc';
    expect(collectAttribution({ href, referrer: '', now: T0, consent: 'analytics', stored: null }).payload.click).toBeNull();
    expect(collectAttribution({ href, referrer: '', now: T0, consent: 'marketing', stored: null }).payload.click).toEqual({ type: 'gclid', value: 'CjwKCAiA' });
  });

  it('ties the ad click id to the touch it came with: a later campaign visit without a click drops it (W147-6)', () => {
    const ad = collectAttribution({ href: 'https://shop.example/?gclid=CjwKCAiA', referrer: 'https://www.google.com/', now: T0, consent: 'marketing', stored: null });
    expect(ad.payload.click).toEqual({ type: 'gclid', value: 'CjwKCAiA' });
    const sameAdDirect = collectAttribution({ href: 'https://shop.example/offer', referrer: '', now: T0 + HOUR, consent: 'marketing', stored: ad.store });
    expect(sameAdDirect.payload.click).toEqual({ type: 'gclid', value: 'CjwKCAiA' });
    const mail = collectAttribution({
      href: 'https://shop.example/offer?utm_source=listmonk&utm_medium=email&utm_campaign=mail-05', referrer: '', now: T0 + 48 * HOUR, consent: 'marketing', stored: sameAdDirect.store,
    });
    expect(mail.payload.last).toMatchObject({ source: 'listmonk', medium: 'email' });
    expect(mail.payload.click).toBeNull();
  });

  it('tolerates corrupted storage', () => {
    const r = collectAttribution({ href: 'https://shop.example/', referrer: '', now: T0, consent: 'analytics', stored: '{not json' });
    expect(r.payload.sessions_count).toBe(1);
  });

  it('hands the payload across domains in a URL parameter that the checkout restores', () => {
    const seller = collectAttribution({
      href: 'https://blog.example/post?utm_source=newsletter&utm_medium=email&utm_campaign=n1', referrer: '', now: T0, consent: 'analytics', stored: null,
    });
    const link = decorateCheckoutUrl('https://pay.example/checkout/course', seller.payload);
    expect(new URL(link).searchParams.get(ATTRIBUTION_HANDOFF_PARAM)).toBeTruthy();
    const checkout = collectAttribution({ href: link, referrer: 'https://blog.example/post', now: T0 + 60_000, consent: 'none', stored: null });
    expect(checkout.payload).toMatchObject({ mode: 'stored', first: { source: 'newsletter' }, last: { source: 'newsletter', campaign: 'n1' }, sessions_count: 1 });
  });
});
