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
  for (const label of [m.title, m.held, m.debt, m.reversed, m.review, m.lag, m.next, m.subscription]) expect(html).toContain(label);
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

it.each(['en', 'pl'] as const)('keeps the %s main view compact and names products', locale => {
  const html = renderToStaticMarkup(createElement(AffiliatePortal, { data: fixture, locale }));
  const visible = html.replace(/<details[\s\S]*?<\/details>/g, '');
  const m = portalMessages[locale];
  expect(visible).not.toContain(m.reference);
  expect(visible).not.toContain(m.reversed);
  expect(visible).not.toContain(m.debt);
  expect(visible.replace(/<[^>]+>/g, '')).not.toMatch(/UTC|00:00|fazi?e 1|Phase 1|#00000001/);
  expect(visible).toContain('Affiliate PLN Course');
  expect(html).toContain(locale === 'pl' ? '2 sty 2026' : '2 Jan 2026');
});

it('shows debt only when present and keeps maturity secondary to the waiting row', () => {
  const data = { ...fixture, balances: fixture.balances.map(b => ({ ...b, debt: '1000' })) };
  const html = renderToStaticMarkup(createElement(AffiliatePortal, { data, locale: 'pl' })).replace(/<details[\s\S]*?<\/details>/g, '');
  expect(html).toContain('Dług');
  expect(html.match(/Dojrzewa od/g)).toHaveLength(1);
  for (const label of ['Dojrzała', 'Wypłacona', 'Cofnięta', 'Testowe', 'Oczekuje na sprawdzenie']) expect(html).toContain(label);
});
it('distinguishes reserved and processing commissions from mature ones', () => {
  for (const [status, sync_pending, label] of [['reserved', false, portalMessages.pl.reservedStatus], ['eligible', true, portalMessages.pl.processing]] as const) {
    const data = { ...fixture, commissions: [{ ...fixture.commissions[0], status, sync_pending, needs_review: false }] };
    const html = renderToStaticMarkup(createElement(AffiliatePortal, { data, locale: 'pl' })).replace(/<details[\s\S]*?<\/details>/g, '');
    expect(html).toContain(label);
    expect(html).not.toContain(portalMessages.pl.eligibleStatus);
  }
});

it.each(['en', 'pl'] as const)('explains permanently held commissions in %s even while processing', locale => {
  const html = renderToStaticMarkup(createElement(AffiliatePortal, { data: fixture, locale })).replace(/<details[\s\S]*?<\/details>/g, '');
  expect(html).toContain(locale === 'en' ? 'unlimited refund' : 'bezterminowym zwrotem');
});
