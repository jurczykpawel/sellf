/**
 * "Buyer gets": what the buyer receives and fills in, read from the product's current settings.
 * Message keys live under `admin.products.form.summary`.
 * @see ./BuyerSummary.tsx
 */
import type { ProductFormData } from '../types';

export interface SummaryPart {
  key: string;
  values?: Record<string, string | number>;
}

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
  | 'allow_custom_price' | 'price' | 'issue_license_on_purchase' | 'event_mode' | 'checkout_profile'>;

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

export function buyerSummaryParts(formData: SummaryInput): BuyerSummaryParts {
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
  const transfer = buyer?.id === 'buyer' ? buyer.bank_transfer_for ?? [] : [];
  if (transfer.length) extras.push({ key: transfer.length === 2 ? 'transfer' : transfer[0] === 'organization' ? 'transferOrganization' : 'transferPerson' });
  const days = formData.auto_grant_duration_days && formData.auto_grant_duration_days > 0 ? formData.auto_grant_duration_days : null;
  return {
    access: { what: accessWhat(formData), days, payment: payment(formData) },
    extras,
    noDatesOrParticipants: !formData.event_mode && !participants,
  };
}
