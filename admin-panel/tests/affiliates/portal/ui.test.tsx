/** Portal rendering contract. @see components/affiliates/portal/AffiliatePortal.tsx */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import AffiliatePortal, { AffiliatePortalError } from '@/components/affiliates/portal/AffiliatePortal';
import { portalMessages } from '@/components/affiliates/portal/messages';
import { fixture } from './fixtures';
it.each(['en', 'pl'] as const)('renders %s labels, states and pagination', locale => {
  const html = renderToStaticMarkup(createElement(AffiliatePortal, { data: fixture, locale, currency: 'PLN' }));
  const m = portalMessages[locale];
  for (const label of [m.title, m.held, m.debt, m.reversed, m.never, m.review, m.lag, m.next, m.subscription]) expect(html).toContain(label);
  expect(html).toContain('name="cursor"'); expect(html).toContain('name="currency"');
  expect(html).toContain('noindex,nofollow');
  expect(html).not.toContain('undefined');
});
it('escapes text and provides matching translation keys', () => {
  expect(Object.keys(portalMessages.en)).toEqual(Object.keys(portalMessages.pl));
  const data = { ...fixture, codes: [{ code: '<script>bad()</script>', active: true }] };
  expect(renderToStaticMarkup(createElement(AffiliatePortal, { data, locale: 'en' }))).toContain('&lt;script&gt;');
});

it.each(['en', 'pl'] as const)('renders actionable %s error text', locale => {
  for (const error of ['unauthorized', 'forbidden', 'not_found', 'invalid_input', 'unavailable'] as const) {
    const html = renderToStaticMarkup(createElement(AffiliatePortalError, { locale, error }));
    expect(html).toContain(portalMessages[locale][error]); expect(html).toContain('role="alert"');
  }
});
