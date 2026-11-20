/**
 * "Buyer gets": what the buyer receives and fills in, read from the product's current settings.
 * Message keys live under `admin.products.form.summary`.
 * @see ./BuyerSummary.tsx
 */
import { parseMoneyInput } from '@/lib/currency/parse-money-input';
import { canUseBankTransfer, productAllowsTransfer } from '@/lib/orders/bank-transfer-config';
import type { TransferAvailability } from '@/lib/orders/transfer-public';
import type { ProductFormData } from '../types';

export interface SummaryPart {
  key: string;
  values?: Record<string, string | number>;
  /** When the part applies only sometimes (message key under `summary.conditions`). */
  condition?: SummaryPart;
}

/** The shop-wide transfer switch, as checkout reads it; null while unknown. */
export type SummaryTransfer = Pick<TransferAvailability, 'enabled' | 'reservationHours'> | null;

export interface BuyerSummaryParts {
  /** Access to what was bought and how it is paid for; always first. */
  access: { what: SummaryPart; days: number | null; payment: string };
  /** Further things the buyer gets or fills in, in checkout order. */
  extras: SummaryPart[];
  /** True when the buyer neither picks a date nor names participants. */
  noDatesOrParticipants: boolean;
}

type SummaryInput = Pick<ProductFormData,
  'is_bundle' | 'bundleItemIds' | 'content_delivery_type' | 'content_config' | 'auto_grant_duration_days' | 'product_type'
  | 'currency' | 'allow_custom_price' | 'price' | 'issue_license_on_purchase' | 'event_mode' | 'checkout_profile'>;

/** True when the product's own settings ask for a transfer; checkout then also needs the shop switch (`SummaryTransfer`). */
export function summaryNeedsTransfer(formData: SummaryInput): boolean {
  return payment(formData) === 'oneTime' && productAllowsTransfer(formData)
    && !!formData.checkout_profile?.modules.some(m => m.id === 'buyer' && !!m.bank_transfer_for?.length);
}

/** Transfer exactly as checkout offers it (same rule as `PaidProductForm`): per buyer type, and for an event only while the reservation can end before the date. */
function transferPart(formData: SummaryInput, transfer: SummaryTransfer): SummaryPart | null {
  if (!transfer || !summaryNeedsTransfer(formData)) return null;
  const types = (['person', 'organization'] as const).filter(type => canUseBankTransfer(transfer.enabled, formData.checkout_profile, type));
  if (!types.length) return null;
  const key = types.length === 2 ? 'transfer' : types[0] === 'organization' ? 'transferOrganization' : 'transferPerson';
  const hours = formData.event_mode ? transfer.reservationHours : null;
  return hours === null ? { key } : { key, condition: { key: 'beforeDate', values: { hours } } };
}

function accessWhat(formData: SummaryInput): SummaryPart {
  if (formData.is_bundle) return { key: 'bundle', values: { count: formData.bundleItemIds.length } };
  if (formData.content_delivery_type === 'redirect') return { key: 'redirect' };
  const items = (formData.content_config.content_items ?? []).filter(item => item.is_active !== false).length;
  return items ? { key: 'content', values: { count: items } } : { key: 'product' };
}

function payment(formData: SummaryInput): string {
  if (formData.product_type === 'subscription') return 'subscription';
  if (formData.allow_custom_price) return 'customPrice';
  return formData.price > 0 ? 'oneTime' : 'free';
}

export function buyerSummaryParts(formData: SummaryInput, transfer: SummaryTransfer, priceDisplayValue?: string, locale = 'en'): BuyerSummaryParts {
  const modules = formData.checkout_profile?.modules ?? [];
  const extras: SummaryPart[] = [];
  if (formData.issue_license_on_purchase) extras.push({ key: 'license' });
  if (formData.event_mode) extras.push({ key: 'date' });
  for (const entry of modules) {
    if (entry.id === 'quantity' && entry.mode !== 'hidden' && entry.max > 1) extras.push({ key: 'seats' });
  }
  const buyer = modules.find(m => m.id === 'buyer');
  if (buyer) extras.push({ key: modules.some(m => m.id === 'recipient') ? 'buyerAndRecipient' : 'buyer' });
  const participants = modules.find(m => m.id === 'participants');
  if (participants) extras.push({ key: !participants.required ? 'participantsOptional' : participants.allow_later ? 'participantsLater' : 'participants' });
  const transferExtra = transferPart(formData, transfer);
  if (transferExtra) extras.push(transferExtra);
  // A subscription grants access for as long as it is paid; the one-off access length does not apply (catalogue.ts).
  const days = formData.product_type !== 'subscription' && formData.auto_grant_duration_days && formData.auto_grant_duration_days > 0 ? formData.auto_grant_duration_days : null;
  return {
    access: { what: accessWhat(formData), days, payment: formData.product_type !== 'subscription' && priceDisplayValue !== undefined && parseMoneyInput(priceDisplayValue, formData.currency, locale).error ? 'invalid' : payment(formData) },
    extras,
    noDatesOrParticipants: !formData.event_mode && !participants,
  };
}
