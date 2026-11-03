// @vitest-environment happy-dom
/** Seller-page runtime (embed loader, gate): records the visit, and hands the source to the Sellf checkout domain. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAttributionRuntime } from '@/lib/attribution/browser-script';
import { GET as checkoutLoader } from '@/app/embed/v1/checkout.js/route';

type Runtime = { sellfAttribution: () => Record<string, unknown> | undefined; sellfDecorateLinks: (origin: string) => void };
function load(): Runtime {
  return new Function(`${buildAttributionRuntime()}; return { sellfAttribution, sellfDecorateLinks };`)() as Runtime;
}

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  const api = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } };
  Object.defineProperty(window, 'localStorage', { value: api, configurable: true });
  delete (window as { sellfAttributionConsent?: string }).sellfAttributionConsent;
  window.history.replaceState(null, '', '/');
});

describe('seller-page attribution runtime', () => {
  it('without the seller declaring consent sends only the landing URL and stores nothing', () => {
    window.history.replaceState(null, '', '/kurs?utm_source=listmonk&utm_medium=email&utm_campaign=mail-05');
    expect(load().sellfAttribution()).toMatchObject({ consent: 'none', mode: 'url', last: { campaign: 'mail-05' } });
    expect(storage.size).toBe(0);
  });

  it('with consent declared by the seller banner keeps first touch across page views', () => {
    (window as { sellfAttributionConsent?: string }).sellfAttributionConsent = 'analytics';
    window.history.replaceState(null, '', '/?utm_source=facebook&utm_medium=paid_social');
    load().sellfAttribution();
    window.history.replaceState(null, '', '/kurs');
    expect(load().sellfAttribution()).toMatchObject({ mode: 'stored', first: { source: 'facebook' }, last: { source: 'facebook' } });
  });

  it('decorates links leading to the Sellf checkout on another domain @J172', () => {
    window.history.replaceState(null, '', '/kurs?utm_source=newsletter&utm_medium=email');
    document.body.innerHTML = '<a id="buy" href="https://pay.example.test/checkout/kurs">Kup</a><a id="own" href="/about">O nas</a>';
    load().sellfDecorateLinks('https://pay.example.test');
    document.getElementById('buy')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.getElementById('own')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(new URL((document.getElementById('buy') as HTMLAnchorElement).href).searchParams.get('sf_a')).toBeTruthy();
    expect((document.getElementById('own') as HTMLAnchorElement).href).not.toContain('sf_a');
  });

  it('is shipped inside the embed checkout loader and attached to checkout requests', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_x');
    const source = await (await checkoutLoader()).text();
    expect(source).toContain('function sellfAttribution');
    expect(source).toMatch(/payload\.attribution = sellfAttribution\(\)/);
    expect(() => new Function(source)).not.toThrow();
  });
});
