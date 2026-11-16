// @vitest-environment happy-dom
/**
 * Product form layout: sections ordered by what the seller sets, each with the effect on the buyer.
 * @see src/components/ProductFormModal/wizard/form-sections.ts
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// ICU plurals ("1 termin", "5 pól") need the real formatter; missing keys fall back like the simple translator.
vi.mock('next-intl', async original => {
  const { createTranslator } = await original<typeof import('next-intl')>();
  const icu = (namespace?: string) => {
    const t = createTranslator({ locale: 'pl', messages: messages as never, namespace: namespace as never, onError: () => {}, getMessageFallback: ({ key }) => key });
    const simple = translator(namespace);
    return Object.assign((key: string, values?: Record<string, unknown>) => (simple.has(key) ? (t as unknown as (k: string, v?: unknown) => string)(key, values) : simple(key, values)), { has: simple.has, rich: simple.rich, markup: simple.markup, raw: simple.raw });
  };
  return { useLocale: () => 'pl', useTranslations: icu };
});
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
// The shop's bank-transfer switch; each test may override it (the summary must follow the same rule as checkout).
const transferAvailability = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orders/transfer-public', () => ({ getTransferAvailability: transferAvailability }));
beforeEach(() => { transferAvailability.mockResolvedValue({ enabled: true, dueDays: 14, reservationHours: null }); });
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

// ===== REJECTED SAVE: every refused save shows its first error =====

const editable = (extra: Partial<Product> = {}) => ({
  ...({} as Product), id: 'p1', name: 'Kurs', slug: 'kurs', description: 'Opis kursu', price: 149, currency: 'PLN',
  vat_rate: 23, price_includes_vat: true, is_active: true, is_listed: true, product_type: 'one_time',
  content_delivery_type: 'content', content_config: { content_items: [] }, ...extra,
}) as Product;

async function openEdit(extra: Partial<Product> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(createElement(ProductCreationWizard, { isOpen: true, product: editable(extra), onSubmit, onClose: vi.fn(), isSubmitting: false, error: null }));
  await act(async () => {});
  return { nav: screen.getByRole('navigation', { name: pl('nav') }), onSubmit };
}

async function save() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Aktualizuj produkt' })); });
  await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(null))); });
}

const currentSection = () => document.querySelector<HTMLElement>('[data-form-section]')!.dataset.formSection;
const describedText = (element: Element) => (element.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ');

const session = (extra: Record<string, unknown> = {}) => ({ starts_at: '2026-12-15T09:00:00.000Z', timezone: 'Europe/Warsaw', capacity: null, sales_open: true, sort: 0, tiers: [{ label: 'Standard', price: 149, seats: null, sort: 0 }], ...extra });
const schoolProfile = { v: 1 as const, modules: [
  { id: 'buyer' as const, types: ['person' as const, 'organization' as const], bank_transfer_for: ['organization' as const] },
  { id: 'recipient' as const, for: ['organization' as const] },
  { id: 'phone' as const, required: false },
  { id: 'quantity' as const, min: 1, max: 100, mode: 'checkout' as const },
  { id: 'participants' as const, required: true, prefill_from_buyer: true, allow_later: true },
] };

describe('rejected save', () => {
  it('opens the errored section and focuses the field on every refused save, also when the error is unchanged', async () => {
    const { nav, onSubmit } = await openEdit({ issue_license_on_purchase: true, license_tier: 'zły poziom!' } as Partial<Product>);
    for (let attempt = 0; attempt < 2; attempt++) {
      await showSection(nav, 'offer');
      await save();
      expect([attempt, currentSection()]).toEqual([attempt, 'delivery']);
      expect(document.activeElement?.id).toBe('license-tier');
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a refused event date next to its field, in "Dates and seats", with focus on it', async () => {
    const { nav, onSubmit } = await openEdit({ event_mode: true, sessions: [session({ starts_at: '' })] } as Partial<Product>);
    await showSection(nav, 'offer');
    await save();
    expect(currentSection()).toBe('schedule');
    const field = document.activeElement as HTMLElement;
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.closest('label')?.textContent).toContain(lookup('events.errors.starts_at') as string);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a fractional tier price in a currency without minor units next to the price', async () => {
    const { nav, onSubmit } = await openEdit({ currency: 'JPY', price: 1000, event_mode: true, sessions: [session({ tiers: [{ label: 'Standard', price: 1000.5, seats: null, sort: 0 }] })] } as Partial<Product>);
    await showSection(nav, 'offer');
    await save();
    expect(currentSection()).toBe('schedule');
    const field = document.activeElement as HTMLElement;
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.closest('label')?.textContent).toContain(lookup('events.errors.tier_price_whole') as string);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a session without price tiers at "Add tier", with focus on it', async () => {
    const { nav, onSubmit } = await openEdit({ event_mode: true, sessions: [session({ tiers: [] })] } as Partial<Product>);
    await showSection(nav, 'offer');
    await save();
    expect(currentSection()).toBe('schedule');
    const field = document.activeElement as HTMLElement;
    expect(field.textContent).toBe(lookup('events.addTier'));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(field)).toContain(lookup('events.errors.tiers') as string);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows too many sessions at the first one over the limit, with focus on its remove button', async () => {
    const sessions = Array.from({ length: 51 }, (_, sort) => session({ sort }));
    const { nav, onSubmit } = await openEdit({ event_mode: true, sessions } as Partial<Product>);
    await showSection(nav, 'offer');
    await save();
    expect(currentSection()).toBe('schedule');
    const field = document.activeElement as HTMLElement;
    expect(field.textContent).toBe(lookup('events.removeSession'));
    expect(field.closest('fieldset')?.querySelector('legend')?.textContent).toBe(`${lookup('events.session')} 51`);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(field)).toContain(lookup('events.errors.sessions_max') as string);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('marks event mode that no longer fits the product', async () => {
    const { nav, onSubmit } = await openEdit({ event_mode: true, sessions: [session()], is_bundle: true } as Partial<Product>);
    await showSection(nav, 'offer');
    await save();
    expect(currentSection()).toBe('schedule');
    const field = document.activeElement as HTMLElement;
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(field)).toBe(lookup('events.modeUnavailable'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a refused checkout profile in "Checkout details", with focus on the control and its message', async () => {
    const { nav, onSubmit } = await openEdit({ checkout_profile: { v: 1, modules: [{ id: 'buyer', types: [] }] } } as Partial<Product>);
    await showSection(nav, 'offer');
    await save();
    expect(currentSection()).toBe('cart');
    const field = document.activeElement as HTMLElement;
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(field)).toContain(lookup('checkoutProfile.errors.invalid') as string);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('marks a refused sale price and links its message', async () => {
    const { nav, onSubmit } = await openEdit();
    const sales = await showSection(nav, 'sales');
    fireEvent.change(within(sales).getByLabelText('Cena promocyjna'), { target: { value: '1,001' } });
    await showSection(nav, 'offer');
    await save();
    expect(currentSection()).toBe('sales');
    const field = document.activeElement as HTMLElement;
    expect(field.id).toBe('sale_price');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(field)).toMatch(/\S/);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('content delivery names', () => {
  it('names the delivery method and the redirect address', async () => {
    const { nav } = await openEdit({ content_delivery_type: 'redirect', content_config: { redirect_url: 'https://example.com/material' } } as Partial<Product>);
    const delivery = await showSection(nav, 'delivery');
    expect(within(delivery).getByRole('combobox', { name: lookup('admin.products.form.contentDeliveryType') as string })).toBeDefined();
    expect(within(delivery).getByRole('textbox', { name: lookup('admin.products.form.redirectUrl') as string })).toBeDefined();
  });
});

// ===== SECTION COUNTS AND THE BUYER SUMMARY (variant B sketch) =====

const buyerSummary = () => screen.getByText((_, element) => element?.getAttribute('data-buyer-summary') === '' ).textContent ?? '';

describe('section counts and buyer summary', () => {
  it('counts checkout fields and dates on the section list', async () => {
    const { nav } = await openEdit({ event_mode: true, sessions: [session()], checkout_profile: schoolProfile } as Partial<Product>);
    const labels = within(nav).getAllByRole('button').map(button => button.textContent);
    expect(labels).toContain(`${pl('cart.title')} · 5 pól`);
    expect(labels).toContain(`${pl('schedule.title')} · 1 termin`);
  });

  it('counts extra checkout fields and uses Polish plurals', async () => {
    const { nav } = await openEdit({ event_mode: true, sessions: [session(), session({ sort: 1 })], checkout_profile: { v: 1, modules: [schoolProfile.modules[0]] },
      custom_checkout_fields: [{ id: 'domain', label: { pl: 'Domena', en: 'Domain' }, type: 'text', required: true, max_length: 100 }] } as Partial<Product>);
    const labels = within(nav).getAllByRole('button').map(button => button.textContent);
    expect(labels).toContain(`${pl('cart.title')} · 2 pola`);
    expect(labels).toContain(`${pl('schedule.title')} · 2 terminy`);
  });

  it('keeps "Buyer gets" visible in every section', async () => {
    const { nav } = await openEdit();
    for (const id of FORM_SECTIONS) {
      await showSection(nav, id);
      expect(buyerSummary()).toMatch(/^Kupujący otrzyma:/);
    }
  });

  it('sums up a plain course: one payment, no dates or participants', async () => {
    await openEdit();
    expect(buyerSummary()).toBe('Kupujący otrzyma: dostęp do produktu po jednorazowej płatności, bez wyboru terminu i uczestników.');
  });

  it('sums up a school event: date, seats, buyer and recipient, participants later, transfer for organisations', async () => {
    await openEdit({ event_mode: true, sessions: [session()], checkout_profile: schoolProfile } as Partial<Product>);
    expect(buyerSummary()).toBe('Kupujący otrzyma: dostęp do produktu po jednorazowej płatności, wybór terminu, liczbę miejsc, dane nabywcy i odbiorcy, możliwość późniejszego podania uczestników i przelew dla organizacji.');
  });

  it('does not promise a bank transfer the shop has switched off', async () => {
    transferAvailability.mockResolvedValue({ enabled: false, dueDays: 14, reservationHours: null });
    await openEdit({ event_mode: true, sessions: [session()], checkout_profile: schoolProfile } as Partial<Product>);
    expect(buyerSummary()).not.toContain('przelew');
  });

  it('describes a transfer that depends on how soon the date starts', async () => {
    transferAvailability.mockResolvedValue({ enabled: true, dueDays: 14, reservationHours: 48 });
    await openEdit({ event_mode: true, sessions: [session()], checkout_profile: schoolProfile } as Partial<Product>);
    expect(buyerSummary()).toContain('przelew dla organizacji (gdy do terminu zostało ponad 48 h)');
  });

  it('describes subscription access without the one-off access length', async () => {
    await openEdit({ product_type: 'subscription', price: 30, auto_grant_duration_days: 7 } as Partial<Product>);
    expect(buyerSummary()).toBe('Kupujący otrzyma: dostęp do produktu na czas opłacania abonamentu, bez wyboru terminu i uczestników.');
  });
});

// ===== BUYER SUMMARY ON A PHONE: one line, expandable =====

describe('buyer summary on a phone', () => {
  it('starts as one line and expands from the keyboard-reachable toggle', async () => {
    await openEdit();
    const summary = document.querySelector<HTMLElement>('[data-buyer-summary]')!;
    const toggle = screen.getByRole('button', { name: lookup('admin.products.form.summary.more') as string });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(summary.id);
    expect(summary.className).toContain('line-clamp-1');
    expect(toggle.className).toContain('sm:hidden');
    expect(summary.className).toContain('sm:line-clamp-none');
    await act(async () => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe(lookup('admin.products.form.summary.less'));
    expect(summary.className).not.toContain('line-clamp-1');
    await act(async () => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
