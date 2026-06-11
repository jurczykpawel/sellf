import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Regression guard for the `removeChild` NotFoundError crash.
//
// vanilla-cookieconsent activates a blocked script by REPLACING its DOM node:
//   querySelectorAll('script[data-category]') → clone.text = original.innerHTML
//   → original.replaceWith(clone)
// If React owns that <script> (i.e. it is rendered as a React child), replaceWith
// detaches it from React's fiber tree and the next unmount of TrackingProvider
// (e.g. navigating into /dashboard, where it returns null) throws:
//   "NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be
//    removed is not a child of this node."
// Fix: the consent-managed scripts (GTM, Meta Pixel, Consent-Mode defaults) are
// injected as plain DOM nodes by an effect, NEVER rendered as React children.
// This test pins that contract — rendering must not emit any `data-category`
// <script>, regardless of consent mode.

vi.mock('next/navigation', () => ({ usePathname: () => '/en' }));
vi.mock('next/script', () => ({
  default: (props: { id?: string; src?: string; nonce?: string }) =>
    createElement('script', { id: props.id, src: props.src, nonce: props.nonce }),
}));
vi.mock('@/lib/tracking/gtm', () => ({ gtmLoaderBaseUrl: () => 'https://www.googletagmanager.com' }));

import TrackingProvider from '@/components/TrackingProvider';

function render(cookie_consent_enabled: boolean): string {
  return renderToStaticMarkup(
    createElement(TrackingProvider, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: { gtm_container_id: 'GTM-TEST123', facebook_pixel_id: '1234567890', cookie_consent_enabled } as any,
      nonce: 'test-nonce',
    }),
  );
}

describe('TrackingProvider keeps consent-managed scripts out of React', () => {
  it('renders no script[data-category] when consent gating is ON', () => {
    const html = render(true);
    expect(html).not.toMatch(/data-category/);
    expect(html).not.toContain('id="gtm-script"');
    expect(html).not.toContain('id="fb-pixel"');
    expect(html).not.toContain('id="consent-mode-defaults"');
  });

  it('renders no managed inline scripts when consent gating is OFF either', () => {
    const html = render(false);
    expect(html).not.toMatch(/data-category/);
    expect(html).not.toContain('id="gtm-script"');
    expect(html).not.toContain('id="fb-pixel"');
  });
});
