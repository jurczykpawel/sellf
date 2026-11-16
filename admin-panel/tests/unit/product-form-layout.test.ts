// @vitest-environment happy-dom
/**
 * Product form layout: sections ordered by what the seller sets, each with the effect on the buyer.
 * @see src/components/ProductFormModal/wizard/form-sections.ts
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORM_SECTIONS, initialSection, sectionForErrors } from '@/components/ProductFormModal/wizard/form-sections';
import ProductCreationWizard from '@/components/ProductFormModal/wizard/ProductCreationWizard';
import type { Product } from '@/types';

const messages = JSON.parse(readFileSync('src/messages/pl.json', 'utf8')) as Record<string, unknown>;
function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), messages);
}
function translator(namespace?: string) {
  const resolve = (key: string) => lookup(namespace ? `${namespace}.${key}` : key);
  const t = (key: string, values?: Record<string, unknown>) => {
    const message = resolve(key);
    if (typeof message !== 'string') return typeof values?.defaultValue === 'string' ? values.defaultValue : key;
    return message.replace(/\{(\w+)\}/g, (match, name: string) => (values && name in values ? String(values[name]) : match));
  };
  return Object.assign(t, { has: (key: string) => typeof resolve(key) === 'string', rich: t, markup: t, raw: resolve });
}

vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: (namespace?: string) => translator(namespace) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ trustedDownloadDomains: [] }) }));
vi.mock('@/lib/actions/categories', () => ({ getCategories: vi.fn().mockResolvedValue({ success: true, data: [] }), getProductCategories: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('@/lib/actions/tags', () => ({ getTags: vi.fn().mockResolvedValue({ success: true, data: [] }), getProductTags: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('@/lib/actions/shop-config', () => ({ getMyShopConfig: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn().mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }) }));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/api/client', async original => ({ ...(await original<typeof import('@/lib/api/client')>()), api: { getCustom: vi.fn().mockResolvedValue({ has_oto: false }), list: vi.fn().mockResolvedValue({ data: [] }) } }));
vi.mock('@/lib/events/actions', () => ({ getEventAdmin: vi.fn(), exportEventParticipants: vi.fn() }));
vi.mock('@/components/tutorials/TutorialHelpButton', () => ({ default: () => null }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
vi.mock('@/components/affiliates/products/Settings', () => ({ AffiliateRuleEditor: () => null }));
vi.mock('@/components/player/VideoOptionsPanel', () => ({ VideoOptionsPanel: () => null }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
afterEach(cleanup);

const pl = (path: string) => lookup(`admin.products.form.sections.${path}`) as string;

describe('section model', () => {
  it('orders sections by what the seller sets', () => {
    expect(FORM_SECTIONS).toEqual(['basics', 'delivery', 'cart', 'schedule', 'offer', 'sales']);
  });

  it.each([
    [{ name: 'required' }, 'basics'],
    [{ vat_rate: 'required' }, 'basics'],
    [{ content_url: 'invalid' }, 'delivery'],
    [{ license_tier: 'invalid' }, 'delivery'],
    [{ license_duration_days: 'license_duration' }, 'delivery'],
    [{ description: 'required' }, 'offer'],
    [{ marketing_fields: 'invalid' }, 'offer'],
    [{ sale_price: 'invalid' }, 'sales'],
    [{ sale_price: 'invalid', name: 'required' }, 'basics'],
    [{}, null],
  ])('opens the section holding the first error %o', (errors, section) => {
    expect(sectionForErrors(Object.keys(errors))).toBe(section);
  });

  it('starts guided tutorials in the section they explain', () => {
    expect(initialSection('events')).toBe('schedule');
    expect(initialSection('b2b-checkout-profile')).toBe('cart');
    expect(initialSection(undefined)).toBe('basics');
  });
});

async function openForm(product?: Partial<Product>) {
  render(createElement(ProductCreationWizard, { isOpen: true, product: product as Product | undefined, onSubmit: vi.fn(), onClose: vi.fn(), isSubmitting: false, error: null }));
  await act(async () => {});
  return screen.getByRole('navigation', { name: pl('nav') });
}

async function showSection(nav: HTMLElement, id: string) {
  await act(async () => { fireEvent.click(within(nav).getByRole('button', { name: pl(`${id}.title`) })); });
  const section = document.querySelector<HTMLElement>(`[data-form-section="${id}"]`)!;
  expect(section).not.toBeNull();
  return section;
}

describe('form layout', () => {
  it('names the dialog and lists the sections in order', async () => {
    const nav = await openForm();
    expect(screen.getByRole('dialog', { name: /Utwórz nowy produkt/ })).toBeDefined();
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(FORM_SECTIONS.map(id => pl(`${id}.title`)));
    expect(within(nav).getByRole('button', { name: pl('basics.title') }).getAttribute('aria-current')).toBe('true');
  });

  it.each(FORM_SECTIONS)('section %s has a heading and says what it changes for the buyer', async id => {
    const nav = await openForm();
    const section = await showSection(nav, id);
    expect(within(section).getByRole('heading', { level: 3 }).textContent).toBe(pl(`${id}.title`));
    expect(section.getAttribute('aria-labelledby')).toBe(within(section).getByRole('heading', { level: 3 }).id);
    expect(within(section).getByText(pl(`${id}.effect`))).toBeDefined();
    expect(document.querySelectorAll('[data-form-section]')).toHaveLength(1);
  });

  it('keeps checkout settings in "Checkout details", apart from the offer format', async () => {
    const nav = await openForm();
    const cart = await showSection(nav, 'cart');
    expect(within(cart).getByRole('checkbox', { name: 'Własny koszyk dla tego produktu' })).toBeDefined();
    expect(within(cart).getByText(lookup('admin.products.form.embedSection.leadTitle') as string)).toBeDefined();
    expect(within(cart).queryByLabelText(/^Format$/)).toBeNull();

    const offer = await showSection(nav, 'offer');
    const format = within(offer).getByLabelText(/^Format$/);
    const hint = lookup('admin.products.form.marketing.formatHint') as string;
    expect(format.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)?.textContent)).toContain(hint);
    expect(hint).toContain(pl('cart.title'));
  });

  it('puts event dates in "Dates and seats" and the embed switch under sales', async () => {
    const nav = await openForm();
    const schedule = await showSection(nav, 'schedule');
    expect(within(schedule).getByRole('checkbox', { name: lookup('events.enabled') as string })).toBeDefined();
    const sales = await showSection(nav, 'sales');
    expect(within(sales).getByRole('checkbox', { name: name => name.startsWith(lookup('admin.products.form.embedSection.toggleLabel') as string) })).toBeDefined();
    expect(within(sales).getByRole('checkbox', { name: lookup('admin.products.form.productActive') as string })).toBeDefined();
  });

  it('names the price controls', async () => {
    await openForm({ ...({} as Product), name: 'Kurs', slug: 'kurs', price: 149, currency: 'PLN', id: '' });
    fireEvent.click(document.querySelector('[data-product-type="standard"]')!);
    expect(screen.getByRole('combobox', { name: 'Waluta' })).toBeDefined();
    expect(screen.getByRole('spinbutton', { name: 'Stawka VAT' })).toBeDefined();
  });

  it('marks only the shown section as current', async () => {
    const nav = await openForm();
    await showSection(nav, 'offer');
    expect(within(nav).getByRole('button', { name: pl('offer.title') }).getAttribute('aria-current')).toBe('true');
    expect(within(nav).getByRole('button', { name: pl('basics.title') }).getAttribute('aria-current')).toBeNull();
  });
});
