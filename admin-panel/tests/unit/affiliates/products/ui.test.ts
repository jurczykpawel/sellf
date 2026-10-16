// @vitest-environment happy-dom
/** Affiliate product controls. @see src/components/affiliates/products */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ locale: 'en', type: 'one_time', rule: null as { fixed_minor: string; currency: string; percentage_bps: null; revision: number; enabled: boolean } | null, search: vi.fn(), save: vi.fn(), bind: vi.fn() }));
vi.mock('next-intl', () => ({ useLocale: () => state.locale, useTranslations: () => () => 'No partners found' }));
vi.mock('@/lib/affiliates/products/actions', () => ({
  getAffiliateProduct: async () => ({ success: true, data: { product: { product_type: state.type, is_refundable: true, refund_period_days: null }, rule: state.rule } }),
  createAffiliateRule: state.save, bindAffiliateCoupon: state.bind,
  getAffiliateCoupon: state.search,
}));
import { AffiliateRuleEditor, AffiliateCouponEditor } from '@/components/affiliates/products/Settings';
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); state.locale = 'en'; state.type = 'one_time'; state.rule = null; state.save.mockResolvedValue({ success: true }); state.bind.mockResolvedValue({ success: true }); state.search.mockResolvedValue({ success: true, data: { binding: { member_id: 'uuid-should-not-be-visible', version: '7', display_name: 'Current Partner', code: 'current' }, members: [{ id: 'member', code: 'partner', display_name: 'Approved Partner' }], next_cursor: null } }); });
it.each(['en', 'pl'])('shows unlimited maturity explicitly in %s', async locale => {
  state.locale = locale; render(createElement(AffiliateRuleEditor, { productId: 'product' }));
  const warning = await screen.findByRole('note');
  expect(warning.textContent).toMatch(locale === 'pl' ? /nigdy nie można wypłacić, również przez ręczne korekty/ : /can never be paid out, including through manual adjustments/);
  expect(screen.getByRole('button', { name: locale === 'pl' ? 'Zapisz prowizję' : 'Save commission' })).toBeDefined();
});
it('disables subscription rule creation', async () => {
  state.type = 'subscription'; render(createElement(AffiliateRuleEditor, { productId: 'product' }));
  await screen.findByText(/Subscriptions earn no commission/);
  expect(screen.queryByRole('button', { name: 'Save commission' })).toBeNull();
});
it('validates before saving and retains a conflicting edit until reload', async () => {
  state.save.mockResolvedValue({ success: false, errorCode: 'CONFLICT' });
  render(createElement(AffiliateRuleEditor, { productId: 'product' }));
  await screen.findByLabelText('Commission (%)');
  fireEvent.change(screen.getByLabelText('Commission (%)'), { target: { value: '100.01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save commission' }));
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Commission (%)'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save commission' }));
  await screen.findByText(/Changed elsewhere/);
  expect((screen.getByLabelText('Commission (%)') as HTMLInputElement).value).toBe('20');
});
it('selects an approved coupon owner and uses its binding version', async () => {
  render(createElement(AffiliateCouponEditor, { couponId: 'coupon' }));
  await screen.findByText(/Current Partner/);
  expect(screen.queryByText(/uuid-should-not-be-visible/)).toBeNull();
  const picker = screen.getByRole('textbox', { name: 'Approved partner' });
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: 'Approved' } });
  fireEvent.keyDown(picker, { key: 'ArrowDown' });
  fireEvent.keyDown(picker, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Assign coupon' }));
  await waitFor(() => expect(state.bind).toHaveBeenCalledWith({ coupon_id: 'coupon', member_id: 'member', expected_version: '7' }));
});

it('saves a localized fixed amount without rounding', async () => {
  render(createElement(AffiliateRuleEditor, { productId: 'product' }));
  await screen.findByLabelText('Commission (%)');
  fireEvent.change(screen.getByLabelText('Commission type'), { target: { value: 'fixed' } });
  fireEvent.change(screen.getByLabelText('Commission amount'), { target: { value: '90071992547409,93' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save commission' }));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ rule: { fixed_minor: '9007199254740993', currency: 'PLN' } })));
});
it('searches partners by name on the server', async () => {
  render(createElement(AffiliateCouponEditor, { couponId: 'coupon' }));
  const picker = await screen.findByRole('textbox', { name: 'Approved partner' });
  fireEvent.input(picker, { target: { value: 'Maria' } });
  await waitFor(() => expect(state.search).toHaveBeenCalledWith({ coupon_id: 'coupon', cursor: null, search: 'Maria' }));
});

it('keeps an empty partner search usable with the keyboard', async () => {
  state.search.mockResolvedValue({ success: true, data: { binding: null, members: [], next_cursor: null } });
  render(createElement(AffiliateCouponEditor, { couponId: 'coupon' }));
  const picker = await screen.findByRole('textbox', { name: 'Approved partner' });
  await screen.findByText(/No approved partners yet/);
  fireEvent.focus(picker); fireEvent.keyDown(picker, { key: 'ArrowDown' }); fireEvent.keyDown(picker, { key: 'Enter' });
  expect(state.bind).not.toHaveBeenCalled();
});

it.each([['CHF', '12.34'], ['KRW', '1234']])('loads a fixed commission in %s', async (currency, amount) => {
  state.rule = { fixed_minor: '1234', currency, percentage_bps: null, revision: 1, enabled: true };
  render(createElement(AffiliateRuleEditor, { productId: 'product' }));
  await waitFor(() => expect((screen.getByLabelText('Commission amount') as HTMLInputElement).value).toBe(amount));
  fireEvent.click(screen.getByRole('button', { name: 'Save commission' }));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ rule: { fixed_minor: '1234', currency } })));
});

it('starts a fresh loading state when the selected coupon changes', async () => {
  const { rerender } = render(createElement(AffiliateCouponEditor, { couponId: 'coupon' }));
  await screen.findByText(/Current Partner/);
  state.search.mockImplementation(() => new Promise(() => {}));
  rerender(createElement(AffiliateCouponEditor, { couponId: 'another-coupon' }));
  expect(screen.queryByText(/Current Partner/)).toBeNull();
  expect((screen.getByRole('button', { name: 'Assign coupon' }) as HTMLButtonElement).disabled).toBe(true);
});
