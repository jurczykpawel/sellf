// @vitest-environment happy-dom
/**
 * "What are you selling?": a starting aid that sets existing product fields (no new product type is stored),
 * shows which settings change before switching, and never touches a product that is only opened and saved.
 * @see src/components/ProductFormModal/wizard/scenarios.ts
 * @see src/components/ProductFormModal/wizard/ScenarioBar.tsx
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductCreationWizard from '@/components/ProductFormModal/wizard/ProductCreationWizard';
import { SCENARIOS, applyScenario, needsConfirmation, scenarioChanges, scenarioFields, scenarioOf, scenarioWarnings } from '@/components/ProductFormModal/wizard/scenarios';
import { UX_PRODUCT_TYPES_AVAILABLE, applyProductTypeDefaults } from '@/lib/product-defaults';
import { isEventCompatible } from '@/lib/events/schema';
import { initialFormData } from '@/components/ProductFormModal/types';
import type { ProductFormData } from '@/components/ProductFormModal/types';
import type { Product } from '@/types';

const messages = { pl: JSON.parse(readFileSync('src/messages/pl.json', 'utf8')), en: JSON.parse(readFileSync('src/messages/en.json', 'utf8')) } as Record<'pl' | 'en', Record<string, unknown>>;
const locale = vi.hoisted(() => ({ current: 'pl' as 'pl' | 'en' }));
function lookup(path: string, lang: 'pl' | 'en' = locale.current): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), messages[lang]);
}

vi.mock('next-intl', async original => {
  const { createTranslator } = await original<typeof import('next-intl')>();
  const icu = (namespace?: string) => {
    const t = createTranslator({ locale: locale.current, messages: messages[locale.current] as never, namespace: namespace as never, onError: () => {}, getMessageFallback: ({ key }) => key });
    return Object.assign((key: string, values?: Record<string, unknown>) => (t as unknown as (k: string, v?: unknown) => string)(key, values), { has: () => true, rich: t, markup: t, raw: (key: string) => lookup(namespace ? `${namespace}.${key}` : key) });
  };
  return { useLocale: () => locale.current, useTranslations: icu };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ trustedDownloadDomains: [] }) }));
vi.mock('@/lib/actions/categories', () => ({ getCategories: vi.fn().mockResolvedValue({ success: true, data: [] }), getProductCategories: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('@/lib/actions/tags', () => ({ getTags: vi.fn().mockResolvedValue({ success: true, data: [] }), getProductTags: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('@/lib/actions/shop-config', () => ({ getMyShopConfig: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn().mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }), from: () => ({ select: () => ({ eq: () => ({ order: vi.fn().mockResolvedValue({ data: [{ component_product_id: 'c1', display_order: 0 }, { component_product_id: 'c2', display_order: 1 }], error: null }) }) }) }) }) }));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/api/client', async original => ({ ...(await original<typeof import('@/lib/api/client')>()), api: { getCustom: vi.fn().mockResolvedValue({ has_oto: false }), list: vi.fn().mockResolvedValue({ data: [] }) } }));
vi.mock('@/lib/events/actions', () => ({ getEventAdmin: vi.fn(), exportEventParticipants: vi.fn() }));
const triggers = vi.hoisted(() => [] as Array<{ id: string; auto?: boolean }>);
vi.mock('@/components/tutorials/TutorialHelpButton', () => ({ default: ({ id }: { id: string }) => createElement('button', { type: 'button', 'data-testid': `tutorial-help-${id}` }, 'help') }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: (props: { id: string; auto?: boolean }) => { triggers.push(props); return null; } }));
vi.mock('@/components/affiliates/products/Settings', () => ({ AffiliateRuleEditor: () => null }));
vi.mock('@/components/player/VideoOptionsPanel', () => ({ VideoOptionsPanel: () => null }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
vi.mock('@/lib/orders/transfer-public', () => ({ getTransferAvailability: vi.fn().mockResolvedValue({ enabled: false, dueDays: 14, reservationHours: null }) }));
beforeEach(() => { locale.current = 'pl'; triggers.length = 0; });
afterEach(cleanup);

const s = (path: string) => lookup(`admin.products.form.scenario.${path}`) as string;
const form = (extra: Partial<ProductFormData> = {}): ProductFormData => ({ ...initialFormData, currency: 'PLN', ...extra });
const session = { starts_at: '2026-12-15T09:00:00.000Z', timezone: 'Europe/Warsaw', capacity: 30, sales_open: true, sort: 0, tiers: [{ label: 'Standard', price: 149, seats: null, sort: 0 }] };
const schoolProfile = { v: 1 as const, modules: [
  { id: 'buyer' as const, types: ['person' as const, 'organization' as const], bank_transfer_for: ['organization' as const] },
  { id: 'quantity' as const, min: 1, max: 100, mode: 'checkout' as const },
] };

// ===== THE SIX SCENARIOS SET EXISTING FIELDS =====

describe('scenario model', () => {
  it('offers the six scenarios of the acceptance list', () => {
    expect(SCENARIOS).toEqual(['download', 'free', 'subscription', 'donation', 'bundle', 'event']);
  });

  it.each([
    ['download', { product_type: 'one_time', allow_custom_price: false, checkout_template: 'default', is_bundle: false, event_mode: false, ux_product_type: 'standard' }],
    ['free', { product_type: 'one_time', price: 0, allow_custom_price: false, is_bundle: false, event_mode: false, ux_product_type: 'lead-magnet' }],
    ['subscription', { product_type: 'subscription', billing_interval: 'month', billing_interval_count: 1, is_bundle: false, event_mode: false, ux_product_type: 'subscription' }],
    ['donation', { product_type: 'one_time', allow_custom_price: true, checkout_template: 'tip-jar', price: 0, is_bundle: false, event_mode: false, ux_product_type: 'tip-jar' }],
    ['bundle', { product_type: 'one_time', allow_custom_price: false, is_bundle: true, event_mode: false, ux_product_type: 'standard' }],
    ['event', { product_type: 'one_time', allow_custom_price: false, is_bundle: false, event_mode: true, allow_repeat_purchase: true, ux_product_type: 'standard' }],
  ] as const)('%s sets only existing product fields', (id, expected) => {
    const result = applyScenario(form({ name: 'Kurs', price: 149 }), id);
    expect(result).toMatchObject(expected);
    // No new product type: every key is a field the form already had (event fields are optional in the form type).
    const known = new Set([...Object.keys(form()), 'event_mode', 'allow_repeat_purchase', 'sessions']);
    expect(Object.keys(result).filter(key => !known.has(key))).toEqual([]);
    expect(scenarioOf(result)).toBe(id);
  });

  it('keeps everything a scenario does not set: name, content, checkout details, dates and bundle items', () => {
    const before = form({ name: 'Szkolenie', description: 'Opis', checkout_profile: schoolProfile, sessions: [session], bundleItemIds: ['c1'], content_config: { content_items: [{ id: 'a', type: 'download_link', title: 'PDF', config: { download_url: 'https://example.com/a.pdf' }, order: 0, is_active: true }] } as ProductFormData['content_config'] });
    for (const id of SCENARIOS) {
      const after = applyScenario(before, id);
      expect(after).toMatchObject({ name: 'Szkolenie', description: 'Opis', checkout_profile: schoolProfile, sessions: [session], bundleItemIds: ['c1'], content_config: before.content_config });
    }
  });

  it('changes nothing when the product already follows the chosen scenario, keeping tuned amounts', () => {
    const donation = applyScenario(form(), 'donation');
    const tuned = { ...donation, custom_price_min: 10, custom_price_presets: [20, 50] };
    expect(scenarioChanges(tuned, applyScenario(tuned, 'donation'))).toEqual([]);
    const subscription = applyScenario(form({ recurring_price: 30, billing_interval: 'year', trial_days: 7 }), 'subscription');
    expect(applyScenario(subscription, 'subscription')).toEqual(subscription);
  });

  it('recognises the scenario of a stored product', () => {
    expect(scenarioOf(form({ price: 149 }))).toBe('download');
    expect(scenarioOf(form({ ux_product_type: 'lead-magnet' }))).toBe('free');
    expect(scenarioOf(form({ ux_product_type: 'subscription', product_type: 'subscription' }))).toBe('subscription');
    expect(scenarioOf(form({ ux_product_type: 'tip-jar', checkout_template: 'tip-jar', allow_custom_price: true }))).toBe('donation');
    expect(scenarioOf(form({ is_bundle: true }))).toBe('bundle');
    expect(scenarioOf(form({ event_mode: true }))).toBe('event');
  });
});

describe('difference before switching', () => {
  const money = (amount: number) => `${amount} PLN`;

  it('lists every setting the switch changes, with its value before and after', () => {
    const event = form({ name: 'Szkolenie', price: 149, event_mode: true, allow_repeat_purchase: true, sessions: [session, { ...session, sort: 1 }] });
    const changes = scenarioChanges(event, applyScenario(event, 'free'), money);
    expect(changes).toEqual([
      { key: 'payment', before: { key: 'payment.standard' }, after: { key: 'payment.lead-magnet' } },
      { key: 'price', before: { key: 'amount', values: { amount: '149 PLN' } }, after: { key: 'amount', values: { amount: '0 PLN' } } },
      { key: 'event', before: { key: 'eventOn', values: { count: 2 } }, after: { key: 'off' } },
    ]);
  });

  it('shows a lost subscription and bundle, not only the new type', () => {
    const subscription = form({ ux_product_type: 'subscription', product_type: 'subscription', recurring_price: 30, billing_interval: 'month', billing_interval_count: 1 });
    expect(scenarioChanges(subscription, applyScenario(subscription, 'download'), money).map(change => [change.key, change.before, change.after])).toEqual([
      ['payment', { key: 'payment.subscription' }, { key: 'payment.standard' }],
      ['billing', { key: 'billing', values: { amount: '30 PLN', interval: 'month', count: 1 } }, { key: 'none' }],
    ]);
    const bundle = form({ is_bundle: true, bundleItemIds: ['a', 'b', 'c'] });
    expect(scenarioChanges(bundle, applyScenario(bundle, 'download'), money)).toEqual([
      { key: 'bundle', before: { key: 'bundleOn', values: { count: 3 } }, after: { key: 'off' } },
    ]);
  });

  it('names a donation: chosen amount, minimum, suggestions and the extra checkout field', () => {
    const changes = scenarioChanges(form({ price: 49 }), applyScenario(form({ price: 49 }), 'donation'), money);
    expect(changes.map(change => change.key)).toEqual(['payment', 'price', 'customPrice', 'customFields']);
    expect(changes.find(change => change.key === 'customPrice')!.after).toEqual({ key: 'customPriceOn', values: { min: '1 PLN', presets: '5 PLN, 10 PLN, 25 PLN' } });
    expect(changes.find(change => change.key === 'customFields')!.after).toEqual({ key: 'fieldCount', values: { count: 1 } });
  });

  it('asks first unless the seller has not touched anything the switch changes', () => {
    const blank = form();
    expect(needsConfirmation(blank, applyScenario(blank, 'donation'), blank)).toBe(false);
    expect(needsConfirmation(blank, applyScenario(blank, 'event'), blank)).toBe(false);
    const priced = form({ price: 149 });
    expect(needsConfirmation(priced, applyScenario(priced, 'free'), blank)).toBe(true);
    expect(needsConfirmation(priced, applyScenario(priced, 'event'), blank)).toBe(false);
    // An opened (stored or duplicated) product always shows the difference first.
    expect(needsConfirmation(blank, applyScenario(blank, 'event'), null)).toBe(true);
  });

  it('warns when kept checkout details no longer fit, and when a stored product changes how it is paid', () => {
    const school = form({ price: 149, checkout_profile: schoolProfile });
    expect(scenarioWarnings(school, applyScenario(school, 'subscription'), false)).toEqual(['checkoutProfile']);
    expect(scenarioWarnings(school, applyScenario(school, 'event'), false)).toEqual([]);
    expect(scenarioWarnings(school, applyScenario(school, 'subscription'), true)).toEqual(['checkoutProfile', 'paymentAfterSales']);
  });
});

// ===== EVERY CHANGE IS SHOWN, AND A SCENARIO NEVER PRODUCES WHAT SAVING REFUSES =====

/** Products of every kind a seller may open, including amounts and settings a scenario must not lose silently. */
const STARTING_FORMS: Array<[string, ProductFormData]> = [
  ['blank', form()],
  ['download', form({ price: 149 })],
  ['download with chosen amount', form({ price: 149, allow_custom_price: true, custom_price_min: 20, show_price_presets: true, custom_price_presets: [30, 50] })],
  ['free', form({ ux_product_type: 'lead-magnet', price: 0 })],
  ['subscription with trial', form({ ux_product_type: 'subscription', product_type: 'subscription', price: 0, recurring_price: 30, billing_interval: 'month', billing_interval_count: 1, trial_days: 14 })],
  ['tuned donation', { ...applyScenario(form(), 'donation'), custom_price_min: 10, custom_price_presets: [20, 50] }],
  ['bundle', form({ price: 99, is_bundle: true, bundleItemIds: ['a', 'b'] })],
  ['event', form({ price: 149, event_mode: true, allow_repeat_purchase: true, sessions: [session] })],
];
const CASES = STARTING_FORMS.flatMap(([name, before]) => SCENARIOS.map(id => [name, id, before] as const));
// An optional switch the form type leaves out (e.g. `event_mode` of a blank form) reads as off, like an empty value.
const unset = (value: unknown) => (value === undefined || value === null || value === false ? null : value);
const changedFields = (before: ProductFormData, after: ProductFormData) =>
  (Object.keys({ ...before, ...after }) as Array<keyof ProductFormData>).filter(key => JSON.stringify(unset(before[key])) !== JSON.stringify(unset(after[key])));

describe('the difference shows every changed setting', () => {
  it.each(CASES)('%s → %s: each field the switch changes is in the preview', (_name, id, before) => {
    const after = applyScenario(before, id);
    const shown = new Set(scenarioChanges(before, after).flatMap(change => scenarioFields(change.key)));
    expect(changedFields(before, after).filter(field => !shown.has(field))).toEqual([]);
  });

  it.each(UX_PRODUCT_TYPES_AVAILABLE)('every field the %s payment defaults set has a line in the preview', type => {
    // Unusual values everywhere, so every field the defaults set differs from what was there.
    const odd = form({ ux_product_type: 'unknown' as never, checkout_template: 'odd', product_type: 'odd' as never, allow_custom_price: 'odd' as never, price: -1,
      billing_interval: 'odd' as never, billing_interval_count: -1, recurring_price: -1, trial_days: -1, custom_price_min: -1, show_price_presets: 'odd' as never,
      custom_price_presets: [], custom_checkout_fields: [] });
    const covered = new Set(scenarioFields());
    expect(changedFields(odd, applyProductTypeDefaults(odd, type)).filter(field => !covered.has(field))).toEqual([]);
  });

  it('shows the trial period a switch removes, in Polish and English', () => {
    const subscription = STARTING_FORMS.find(([name]) => name === 'subscription with trial')![1];
    const trial = scenarioChanges(subscription, applyScenario(subscription, 'download')).find(change => change.key === 'trial');
    expect(trial).toEqual({ key: 'trial', before: { key: 'trialDays', values: { count: 14 } }, after: { key: 'none' } });
    for (const lang of ['pl', 'en'] as const) {
      expect(lookup('admin.products.form.scenario.fields.trial', lang), lang).toBeTruthy();
      expect(lookup('admin.products.form.scenario.values.trialDays', lang), lang).toBeTruthy();
    }
  });
});

describe('a scenario sets what its kind of product requires', () => {
  it('an event turns off the amount chosen by the buyer, shows it, and keeps the price and suggestions', () => {
    const before = STARTING_FORMS.find(([name]) => name === 'download with chosen amount')![1];
    expect(scenarioOf(before)).toBe('download');
    const after = applyScenario(before, 'event');
    expect(after).toMatchObject({ event_mode: true, allow_custom_price: false, price: 149, custom_price_min: 20, show_price_presets: true, custom_price_presets: [30, 50] });
    expect(isEventCompatible(after)).toBe(true);
    expect(scenarioChanges(before, after).find(change => change.key === 'customPrice')).toEqual({ key: 'customPrice', before: { key: 'customPriceOn', values: { min: '20', presets: '30, 50' } }, after: { key: 'off' } });
  });

  it.each(CASES)('%s → %s: saving does not refuse the kind of product the scenario sets', (_name, id, before) => {
    expect(isEventCompatible(applyScenario(before, id))).toBe(true);
  });

  it('warns about any setting saving refuses for an event, using the same rule as saving', () => {
    const event = form({ price: 149, event_mode: true });
    expect(scenarioWarnings(form({ price: 149 }), { ...event, allow_custom_price: true }, false)).toContain('eventIncompatible');
    expect(scenarioWarnings(form({ price: 149 }), event, false)).toEqual([]);
  });
});

// ===== THE FORM: create, change with preview, skip, edit =====

async function openNew() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(createElement(ProductCreationWizard, { isOpen: true, onSubmit, onClose: vi.fn(), isSubmitting: false, error: null }));
  await act(async () => {});
  return { onSubmit };
}
const picker = () => screen.getByRole('group', { name: s('title') });
const option = (id: string) => within(picker()).getByRole('button', { name: new RegExp(`^${s(`options.${id}.name`)}`) });
const bar = () => document.querySelector<HTMLElement>('[data-tour="form-scenario"]')!;
const buyerSummary = () => document.querySelector('[data-buyer-summary]')!.textContent ?? '';
const nav = () => screen.getByRole('navigation', { name: lookup('admin.products.form.sections.nav') as string });

describe('"What are you selling?" when creating', () => {
  it('starts with the six scenarios and a way to skip', async () => {
    await openNew();
    expect(within(picker()).getAllByRole('button').map(button => button.dataset.scenario ?? button.textContent)).toEqual([...SCENARIOS, s('manual')]);
    expect(within(picker()).getByText(s('hint'))).toBeDefined();
  });

  it('opens on the question: focus goes to the first scenario, not to the name field below it', async () => {
    await openNew();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    expect(document.activeElement).toBe(option('download'));
  });

  it('preserves focus on the buyer summary toggle after opening the form', async () => {
    vi.useFakeTimers();
    try {
      await openNew();
      const toggle = screen.getByRole('button', { name: lookup('admin.products.form.summary.more') as string });
      toggle.focus();
      fireEvent.click(toggle);
      await act(async () => { vi.advanceTimersByTime(101); });
      expect(document.activeElement).toBe(toggle);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the first choice on an untouched form and says which scenario is set', async () => {
    await openNew();
    await act(async () => { fireEvent.click(option('free')); });
    expect(screen.queryByRole('group', { name: s('title') })).toBeNull();
    expect(bar().textContent).toContain(s('options.free.name'));
    expect(buyerSummary()).toContain('za darmo');
    expect(document.activeElement).toBe(within(bar()).getByRole('button', { name: s('changeLabel') }));
  });

  it('shows the difference before switching and changes nothing when the seller cancels', async () => {
    await openNew();
    await act(async () => { fireEvent.click(option('free')); });
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: s('changeLabel') })); });
    await act(async () => { fireEvent.click(option('event')); });
    const preview = screen.getByRole('region', { name: lookup('admin.products.form.scenario.confirm.title', 'pl')!.toString().replace('{name}', s('options.event.name')) });
    expect(document.activeElement).toBe(within(preview).getByRole('heading'));
    const items = within(preview).getAllByRole('listitem').map(item => item.textContent);
    expect(items).toEqual([`${s('fields.payment')}: ${s('values.payment.lead-magnet')} → ${s('values.payment.standard')}`, `${s('fields.event')}: ${s('values.off')} → włączone (0 terminów)`, `${s('fields.repeat')}: ${s('values.no')} → ${s('values.yes')}`]);
    await act(async () => { fireEvent.click(within(preview).getByRole('button', { name: s('confirm.cancel') })); });
    expect(bar().textContent).toContain(s('options.free.name'));
    expect(buyerSummary()).toContain('za darmo');
    expect(within(nav()).getByRole('button', { name: /Terminy i miejsca/ }).textContent).toBe('Terminy i miejsca');

    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: s('changeLabel') })); });
    await act(async () => { fireEvent.click(option('event')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: s('confirm.apply') })); });
    expect(bar().textContent).toContain(s('options.event.name'));
    expect(buyerSummary()).toContain('wybór terminu');
  });

  it('lets the seller skip and set everything by hand', async () => {
    await openNew();
    await act(async () => { fireEvent.click(within(picker()).getByRole('button', { name: s('manual') })); });
    expect(screen.queryByRole('group', { name: s('title') })).toBeNull();
    expect(bar().textContent).toContain(s('manualCurrent'));
    expect(within(bar()).getByRole('button', { name: s('choose') })).toBeDefined();
    expect(document.querySelector('[data-product-type="standard"]')).not.toBeNull();
  });

  it('starts a new bundle with the bundle scenario already set', async () => {
    render(createElement(ProductCreationWizard, { isOpen: true, onSubmit: vi.fn(), onClose: vi.fn(), isSubmitting: false, error: null, defaultIsBundle: true }));
    await act(async () => {});
    expect(screen.queryByRole('group', { name: s('title') })).toBeNull();
    expect(bar().textContent).toContain(s('options.bundle.name'));
  });

  it('speaks English in the English panel', async () => {
    locale.current = 'en';
    await openNew();
    expect(screen.getByRole('group', { name: 'What are you selling?' })).toBeDefined();
    expect(within(picker()).getAllByRole('button').map(button => button.textContent?.split('\n')[0])).toHaveLength(7);
    for (const id of SCENARIOS) expect(lookup(`admin.products.form.scenario.options.${id}.name`, 'en'), id).toBeTruthy();
  });
});

describe('scenario messages', () => {
  it('has the same keys in Polish and English, without leftovers', () => {
    const keys = (node: unknown, prefix = ''): string[] => node && typeof node === 'object'
      ? Object.entries(node).flatMap(([key, value]) => keys(value, `${prefix}${key}.`)) : [prefix.slice(0, -1)];
    expect(keys(lookup('admin.products.form.scenario', 'en')).sort()).toEqual(keys(lookup('admin.products.form.scenario', 'pl')).sort());
  });
});

// ===== EDIT: an opened product is never reconfigured by itself =====

const stored = (extra: Partial<Product>): Product => ({
  ...({} as Product), id: 'p1', name: 'Produkt', slug: 'produkt', description: 'Opis', long_description: '', price: 149, currency: 'PLN',
  vat_rate: 23, price_includes_vat: true, is_active: true, is_listed: true, product_type: 'one_time',
  content_delivery_type: 'content', content_config: { content_items: [] }, ...extra,
}) as Product;

const SIX_PRODUCTS: Array<[string, Partial<Product>]> = [
  ['download', { issue_license_on_purchase: true, license_tier: 'pro', auto_grant_duration_days: 365 } as Partial<Product>],
  ['free', { price: 0, lead_consent_required: true } as Partial<Product>],
  ['subscription', { product_type: 'subscription', price: 0, recurring_price: 30, billing_interval: 'month', billing_interval_count: 1, trial_days: 7 } as Partial<Product>],
  ['donation', { price: 0, allow_custom_price: true, custom_price_min: 10, custom_price_presets: [20, 50], checkout_template: 'tip-jar', custom_checkout_fields: [{ id: 'note', label: { pl: 'Wiadomość', en: 'Message' }, type: 'text', required: false, max_length: 200 }] } as Partial<Product>],
  ['bundle', { is_bundle: true }],
  ['event', { event_mode: true, allow_repeat_purchase: true, sessions: [session], checkout_profile: schoolProfile } as Partial<Product>],
];

async function openStored(extra: Partial<Product>) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(createElement(ProductCreationWizard, { isOpen: true, product: stored(extra), onSubmit, onClose: vi.fn(), isSubmitting: false, error: null }));
  await act(async () => {});
  return onSubmit;
}
async function save(onSubmit: ReturnType<typeof vi.fn>) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Aktualizuj produkt' })); });
  expect(onSubmit).toHaveBeenCalledOnce();
  return onSubmit.mock.calls[0][0] as ProductFormData;
}

describe('"What are you selling?" when editing', () => {
  it.each(SIX_PRODUCTS)('a stored %s product shows its scenario with only "Change"', async (id, extra) => {
    await openStored(extra);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    expect(document.activeElement?.id).toBe('name');
    expect(screen.queryByRole('group', { name: s('title') })).toBeNull();
    expect(bar().textContent).toContain(s(`options.${id}.name`));
    expect(within(bar()).getByRole('button', { name: s('changeLabel') })).toBeDefined();
    expect(within(bar()).queryByRole('button', { name: s('manual') })).toBeNull();
  });

  it.each(SIX_PRODUCTS)('opening and saving a stored %s product sends the same configuration, also after looking at "Change" and cancelling', async (_id, extra) => {
    const first = await save(await openStored(extra));
    cleanup();
    const onSubmit = await openStored(extra);
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: s('changeLabel') })); });
    await act(async () => { fireEvent.click(within(picker()).getByRole('button', { name: s('cancel') })); });
    const second = await save(onSubmit);
    expect(second).toEqual(first);
    const product = stored(extra) as unknown as Record<string, unknown>;
    for (const key of Object.keys(extra)) expect([key, (first as unknown as Record<string, unknown>)[key]]).toEqual([key, product[key]]);
  });

  it('a change confirmed after editing the form keeps the edit; the preview follows what the seller typed', async () => {
    const onSubmit = await openStored({});
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: s('changeLabel') })); });
    await act(async () => { fireEvent.click(option('free')); });
    const preview = () => screen.getByRole('region', { name: /Zmienić scenariusz/ });
    const priceLine = () => within(preview()).getAllByRole('listitem').map(item => item.textContent).find(text => text?.startsWith(s('fields.price')));
    expect(priceLine()).toMatch(/149.*→.*0/);
    await act(async () => { fireEvent.change(document.getElementById('name')!, { target: { value: 'Nowa nazwa po podglądzie' } }); });
    await act(async () => { fireEvent.change(document.getElementById('price')!, { target: { value: '99' } }); });
    await act(async () => { fireEvent.blur(document.getElementById('price')!); });
    expect(priceLine()).toMatch(/99.*→.*0/);
    await act(async () => { fireEvent.click(within(preview()).getByRole('button', { name: s('confirm.apply') })); });
    const sent = await save(onSubmit);
    expect(sent).toMatchObject({ name: 'Nowa nazwa po podglądzie', price: 0, ux_product_type: 'lead-magnet' });
  });

  it('switching a stored event to a download shows the loss of dates first and keeps the dates in the form', async () => {
    const onSubmit = await openStored({ event_mode: true, allow_repeat_purchase: true, sessions: [session] } as Partial<Product>);
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: s('changeLabel') })); });
    await act(async () => { fireEvent.click(option('download')); });
    const preview = screen.getByRole('region', { name: /Zmienić scenariusz/ });
    expect(within(preview).getAllByRole('listitem').map(item => item.textContent)).toEqual([`${s('fields.event')}: włączone (1 termin) → ${s('values.off')}`]);
    // The way of paying stays the same, so no warning about stored sales.
    expect(within(preview).queryByText(s('warnings.paymentAfterSales'))).toBeNull();
    await act(async () => { fireEvent.click(within(preview).getByRole('button', { name: s('confirm.apply') })); });
    const sent = await save(onSubmit);
    expect(sent).toMatchObject({ event_mode: false, sessions: [session] });
  });
});

// ===== ONE-OFF FORM TUTORIAL =====

describe('form tutorial', () => {
  it('registers the form tutorial to start once on its own and offers it again inside the form', async () => {
    await openStored({});
    expect(triggers).toContainEqual({ id: 'product-form' });
    expect(screen.getByTestId('tutorial-help-product-form')).toBeDefined();
  });

  it('marks the six sections and the buyer summary for its steps', async () => {
    await openNew();
    for (const id of ['basics', 'delivery', 'cart', 'schedule', 'offer', 'sales']) {
      expect(within(nav()).getByRole('button', { name: new RegExp(lookup(`admin.products.form.sections.${id}.title`) as string) }).dataset.tour).toBe(`form-section-${id}`);
    }
    expect(document.querySelector('[data-tour="buyer-summary"] [data-buyer-summary]')).not.toBeNull();
  });
});
