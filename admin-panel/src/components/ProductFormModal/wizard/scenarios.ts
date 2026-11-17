/**
 * "What are you selling?": starting scenarios of the product form. A scenario only sets existing product fields;
 * nothing about it is stored, and an opened product keeps its configuration until the seller confirms a change.
 * @see ./ScenarioBar.tsx
 * @see @/lib/product-defaults.ts
 */
import { parseCheckoutProfile } from '@/lib/checkout-modules/profile';
import { applyProductTypeDefaults, type UxProductType } from '@/lib/product-defaults';
import type { ProductFormData } from '../types';

export const SCENARIOS = ['download', 'free', 'subscription', 'donation', 'bundle', 'event'] as const;
export type ScenarioId = typeof SCENARIOS[number];

/** How each scenario is paid for (existing UX product type). */
const PAYMENT: Record<ScenarioId, UxProductType> = {
  download: 'standard',
  free: 'lead-magnet',
  subscription: 'subscription',
  donation: 'tip-jar',
  bundle: 'standard',
  event: 'standard',
};

/** Scenario the product's fields describe now. */
export function scenarioOf(form: ProductFormData): ScenarioId {
  if (form.is_bundle) return 'bundle';
  if (form.event_mode) return 'event';
  switch (form.ux_product_type) {
    case 'subscription': return 'subscription';
    case 'tip-jar': return 'donation';
    case 'lead-magnet': return 'free';
    default: return 'download';
  }
}

/**
 * Fields set by the scenario; everything else (content, checkout details, dates, bundle items) stays as it is.
 * A product already paid for the scenario's way keeps its amounts, e.g. a tuned donation minimum.
 */
export function applyScenario(form: ProductFormData, id: ScenarioId): ProductFormData {
  const paid = form.ux_product_type === PAYMENT[id] ? form : applyProductTypeDefaults(form, PAYMENT[id]);
  const event = id === 'event';
  return {
    ...paid,
    is_bundle: id === 'bundle',
    event_mode: event,
    // Same default as switching event mode on in "Dates and seats".
    ...(event && !form.event_mode ? { allow_repeat_purchase: true } : {}),
  };
}

/** Message key under `scenario.values` with its parameters. */
export interface ScenarioValue { key: string; values?: Record<string, string | number> }
export type ScenarioChangeKey = 'payment' | 'price' | 'billing' | 'customPrice' | 'customFields' | 'bundle' | 'event' | 'repeat';
export interface ScenarioChange { key: ScenarioChangeKey; before: ScenarioValue; after: ScenarioValue }
export type MoneyFormat = (amount: number) => string;

const plainMoney: MoneyFormat = amount => String(amount);

/** Each setting a scenario can change, read as the seller sees it. */
const READERS: Record<ScenarioChangeKey, (form: ProductFormData, money: MoneyFormat) => ScenarioValue> = {
  payment: form => ({ key: `payment.${form.ux_product_type}` }),
  price: (form, money) => ({ key: 'amount', values: { amount: money(form.price) } }),
  billing: (form, money): ScenarioValue => {
    if (form.product_type !== 'subscription' || !form.billing_interval) return { key: 'none' };
    const values = { interval: form.billing_interval, count: form.billing_interval_count ?? 1 };
    return form.recurring_price != null ? { key: 'billing', values: { amount: money(form.recurring_price), ...values } } : { key: 'billingNoPrice', values };
  },
  customPrice: (form, money): ScenarioValue => {
    if (!form.allow_custom_price) return { key: 'off' };
    const min = money(form.custom_price_min ?? 0);
    const presets = form.show_price_presets ? (form.custom_price_presets ?? []) : [];
    return presets.length ? { key: 'customPriceOn', values: { min, presets: presets.map(money).join(', ') } } : { key: 'customPriceMin', values: { min } };
  },
  customFields: form => ({ key: 'fieldCount', values: { count: form.custom_checkout_fields.length } }),
  bundle: form => (form.is_bundle ? { key: 'bundleOn', values: { count: form.bundleItemIds.length } } : { key: 'off' }),
  event: form => (form.event_mode ? { key: 'eventOn', values: { count: form.sessions?.length ?? 0 } } : { key: 'off' }),
  repeat: form => ({ key: form.allow_repeat_purchase ? 'yes' : 'no' }),
};
const CHANGE_KEYS = Object.keys(READERS) as ScenarioChangeKey[];

const same = (a: ScenarioValue, b: ScenarioValue) => JSON.stringify(a) === JSON.stringify(b);

/** Settings that differ between the product now and after the switch, in form order. */
export function scenarioChanges(before: ProductFormData, after: ProductFormData, money: MoneyFormat = plainMoney): ScenarioChange[] {
  return CHANGE_KEYS.flatMap(key => {
    const from = READERS[key](before, money);
    const to = READERS[key](after, money);
    return same(from, to) ? [] : [{ key, before: from, after: to }];
  });
}

/**
 * Whether the switch must be shown first. Only a blank new form (`pristine`) whose changed settings the seller has not
 * touched yet switches straight away; an opened product (`pristine` null) always shows the difference.
 */
export function needsConfirmation(before: ProductFormData, after: ProductFormData, pristine: ProductFormData | null): boolean {
  const changes = scenarioChanges(before, after);
  if (!changes.length) return false;
  if (!pristine) return true;
  return changes.some(change => !same(change.before, READERS[change.key](pristine, plainMoney)));
}

export type ScenarioWarning = 'checkoutProfile' | 'paymentAfterSales';

/** What the switch keeps but the scenario cannot use, and what the server may still refuse for a stored product. */
export function scenarioWarnings(before: ProductFormData, after: ProductFormData, isStored: boolean): ScenarioWarning[] {
  const warnings: ScenarioWarning[] = [];
  if (after.checkout_profile && !parseCheckoutProfile(after.checkout_profile, { ...after }).success) warnings.push('checkoutProfile');
  if (isStored && before.product_type !== after.product_type) warnings.push('paymentAfterSales');
  return warnings;
}
