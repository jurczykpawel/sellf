// @vitest-environment happy-dom
/** Co-creator panel pieces: product editor, creator terms editor, earnings page. @see components/affiliates/products/CocreatorSettings.tsx */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  getProductCocreator: vi.fn(), setProductCocreator: vi.fn(), removeProductCocreator: vi.fn(),
  getCreatorTerms: vi.fn(), publishCreatorTerms: vi.fn(), acceptCreatorTerms: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('@/lib/affiliates/cocreator/actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useLocale: () => locale.value }));
import { CocreatorEditor } from '@/components/affiliates/products/CocreatorSettings';
import CreatorTermsSettings from '@/components/affiliates/admin/CreatorTermsSettings';
import AffiliatePortal from '@/components/affiliates/portal/AffiliatePortal';
import { cocreatorMessages } from '@/components/affiliates/products/messages';
import { portalMessages } from '@/components/affiliates/portal/messages';
import type { PortalData } from '@/lib/affiliates/portal/model';

const product = '11111111-1111-4111-8111-111111111111';
const base = { product_id: product, product_type: 'one_time', product_currency: 'PLN', revision: 0, program_configured: true, cocreator: null };
const assigned = { ...base, revision: 1, cocreator: { member_id: product, display_name: 'Anna', email: 'anna@example.test', percentage_bps: 1000, fixed_minor: null, currency: null, since: '2026-11-17T10:00:00Z', terms_accepted: false } };
const terms = { version: 'creator-v1', en: 'Creator terms text', pl: 'Tekst regulaminu twórcy' };
const portal = (creator: Partial<NonNullable<PortalData['creator']>>): PortalData => ({
  member: { code: 'creator-abc', status: 'approved' }, is_partner: false, balances: [], codes: [], rules: [],
  commissions: [{ product: 'Creator Course', status: 'held', reference: '22222222-2222-4222-8222-222222222222', kind: 'cocreator', terms_required: !creator.accepted_version,
    currency: 'PLN', paid_at: '2026-11-17T10:00:00Z', eligible_at: '2026-11-17T10:00:00Z', accrued_minor: '1000', current_minor: '1000', livemode: false, sync_pending: false, needs_review: false }],
  creator: { active: true, rules: [{ product: 'Creator Course', percentage_bps: 1000, fixed_minor: null, currency: null }], accepted_version: null, accepted_at: null, terms, ...creator },
  next_cursor: null, as_of: '2026-11-17T12:00:00Z', sync_pending: false, needs_review: false,
});

beforeEach(() => { vi.clearAllMocks(); locale.value = 'en'; });
afterEach(cleanup);

it.each(['en', 'pl'] as const)('assigns a co-creator with a percentage share and shows the terms state %s @J640', async lang => {
  locale.value = lang; const t = cocreatorMessages[lang];
  actions.getProductCocreator.mockResolvedValueOnce({ success: true, data: base }).mockResolvedValue({ success: true, data: assigned });
  actions.setProductCocreator.mockResolvedValue({ success: true, data: { revision: 1 } });
  render(<CocreatorEditor productId={product} />);
  expect(await screen.findByText(t.none)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t.email), { target: { value: 'anna@example.test' } });
  fireEvent.change(screen.getByLabelText(t.bps), { target: { value: lang === 'pl' ? '12,5' : '12.5' } });
  fireEvent.click(screen.getByRole('button', { name: t.save }));
  await waitFor(() => expect(actions.setProductCocreator).toHaveBeenCalledWith({ product_id: product, expected_revision: 0, email: 'anna@example.test', rule: { percentage_bps: 1250 } }));
  expect(await screen.findByText(t.saved)).toBeTruthy();
  expect(screen.getByText(t.termsPending)).toBeTruthy();
  expect(screen.getByText('Anna')).toBeTruthy();
});

it('sends a fixed amount in minor units, explains a missing account and removes the co-creator', async () => {
  const t = cocreatorMessages.en;
  actions.getProductCocreator.mockResolvedValue({ success: true, data: assigned });
  actions.setProductCocreator.mockResolvedValue({ success: false, errorCode: 'ACCOUNT_NOT_FOUND' });
  actions.removeProductCocreator.mockResolvedValue({ success: true, data: { revision: 2 } });
  render(<CocreatorEditor productId={product} />);
  await screen.findByText('Anna');
  fireEvent.change(screen.getByLabelText(t.email), { target: { value: 'new@example.test' } });
  fireEvent.change(screen.getByLabelText(t.type), { target: { value: 'fixed' } });
  fireEvent.change(screen.getByLabelText(t.minor), { target: { value: '15.50' } });
  fireEvent.click(screen.getByRole('button', { name: t.save }));
  await waitFor(() => expect(actions.setProductCocreator).toHaveBeenCalledWith(expect.objectContaining({ expected_revision: 1, rule: { fixed_minor: '1550', currency: 'PLN' } })));
  expect(await screen.findByText(t.accountNotFound)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t.remove }));
  await waitFor(() => expect(actions.removeProductCocreator).toHaveBeenCalledWith({ product_id: product, expected_revision: 1 }));
});

it('shows subscriptions and a missing program instead of a broken form', async () => {
  const t = cocreatorMessages.en;
  actions.getProductCocreator.mockResolvedValue({ success: true, data: { ...base, program_configured: false } });
  const { unmount } = render(<CocreatorEditor productId={product} />);
  expect(await screen.findByText(t.programLink)).toBeTruthy();
  unmount();
  render(<CocreatorEditor productId={product} productType="subscription" />);
  expect(await screen.findByText(t.subscription)).toBeTruthy();
  expect(screen.queryByRole('button', { name: t.save })).toBeNull();
});

it.each(['en', 'pl'] as const)('publishes the creator terms with the version read earlier %s', async lang => {
  const t = cocreatorMessages[lang];
  actions.getCreatorTerms.mockResolvedValue({ success: true, data: null });
  actions.publishCreatorTerms.mockResolvedValue({ success: true, data: { terms_version: 'creator-v1', terms: { en: 'A', pl: 'B' }, created_at: '2026-11-17T10:00:00Z' } });
  render(<CreatorTermsSettings locale={lang} />);
  expect(await screen.findByText(t.termsNone)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t.termsVersion), { target: { value: 'creator-v1' } });
  fireEvent.change(screen.getByLabelText(t.termsEn), { target: { value: 'A' } });
  fireEvent.change(screen.getByLabelText(t.termsPl), { target: { value: 'B' } });
  fireEvent.click(screen.getByRole('button', { name: t.termsSave }));
  await waitFor(() => expect(actions.publishCreatorTerms).toHaveBeenCalledWith({ expected_version: null, terms_version: 'creator-v1', terms: { en: 'A', pl: 'B' } }));
  expect(await screen.findByText(t.termsSaved)).toBeTruthy();
});

it.each(['en', 'pl'] as const)('lets a co-creator accept the creator terms on the earnings page %s @J642', async lang => {
  const t = cocreatorMessages[lang];
  actions.acceptCreatorTerms.mockResolvedValue({ success: true, data: { terms_version: 'creator-v1' } });
  render(<AffiliatePortal data={portal({})} locale={lang} />);
  expect(screen.getByText(t.portalTitle)).toBeTruthy();
  expect(screen.getByText(`Creator Course: 10%`)).toBeTruthy();
  expect(screen.getByText(terms[lang])).toBeTruthy();
  expect(screen.getByText(t.waitingForTerms)).toBeTruthy();
  expect(screen.queryByText(portalMessages[lang].codes)).toBeNull();
  const accept = screen.getByRole('button', { name: t.acceptButton }) as HTMLButtonElement;
  expect(accept.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(t.acceptLabel)); fireEvent.click(accept);
  await waitFor(() => expect(actions.acceptCreatorTerms).toHaveBeenCalledWith({ terms_version: 'creator-v1', accepted: true }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalled());
});

it('shows the accepted version, a missing terms notice and the admin view without a form', () => {
  const t = cocreatorMessages.en;
  const { unmount } = render(<AffiliatePortal data={portal({ accepted_version: 'creator-v1', accepted_at: '2026-11-17T11:00:00Z' })} locale="en" />);
  expect(screen.getByText('creator-v1')).toBeTruthy();
  expect(screen.queryByRole('button', { name: t.acceptButton })).toBeNull();
  unmount();
  const missing = render(<AffiliatePortal data={portal({ terms: null })} locale="en" />);
  expect(screen.getByText(t.termsMissing)).toBeTruthy();
  missing.unmount();
  render(<AffiliatePortal data={portal({})} locale="en" memberId={product} />);
  expect(screen.getByText(t.termsPending)).toBeTruthy();
  expect(screen.queryByRole('button', { name: t.acceptButton })).toBeNull();
});

it('keeps EN and PL co-creator copy aligned', () => {
  expect(Object.keys(cocreatorMessages.en)).toEqual(Object.keys(cocreatorMessages.pl));
});
it.each(['en', 'pl'] as const)('identifies co-creator email and share errors at their fields %s', async lang => {
  locale.value = lang; const t = cocreatorMessages[lang];
  actions.getProductCocreator.mockResolvedValue({ success: true, data: base });
  render(<CocreatorEditor productId={product} />);
  await screen.findByText(t.none);
  const email = screen.getByLabelText(t.email), rate = screen.getByLabelText(t.bps);
  fireEvent.change(email, { target: { value: 'anna@example.test' } });
  for (const value of ['0', '100.01', '999999999999999999999999']) {
    fireEvent.change(rate, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(rate.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(rate.getAttribute('aria-describedby')!)?.textContent).toContain(lang === 'pl' ? '0,01–100%' : '0.01–100%');
  }
  fireEvent.change(rate, { target: { value: '10' } });
  fireEvent.change(email, { target: { value: 'bad@@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: t.save }));
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(rate.getAttribute('aria-invalid')).toBe('false');
  expect(actions.setProductCocreator).not.toHaveBeenCalled();
});
