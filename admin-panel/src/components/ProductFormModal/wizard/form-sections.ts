/**
 * Product form sections, ordered by what the seller sets; each section says what it changes for the buyer.
 * @see ./ProductCreationWizard.tsx
 */
import type { ProductFormData } from '../types';

export const FORM_SECTIONS = ['basics', 'delivery', 'cart', 'schedule', 'offer', 'sales'] as const;
export type FormSectionId = typeof FORM_SECTIONS[number];

/** Field error key → section holding that field. */
const FIELD_SECTION: Record<string, FormSectionId> = {
  name: 'basics',
  slug: 'basics',
  price: 'basics',
  recurring_price: 'basics',
  custom_price_min: 'basics',
  custom_price_presets: 'basics',
  trial_days: 'basics',
  vat_rate: 'basics',
  content_url: 'delivery',
  bundleItemIds: 'delivery',
  license_tier: 'delivery',
  license_duration_days: 'delivery',
  checkout_profile: 'cart',
  sessions: 'schedule',
  event_mode: 'schedule',
  description: 'offer',
  marketing_fields: 'offer',
  sale_price: 'sales',
};

/** First section, in form order, holding one of the errored fields; null when none is known. */
export function sectionForErrors(keys: readonly string[]): FormSectionId | null {
  const sections = new Set(keys.map(key => FIELD_SECTION[key]).filter(Boolean));
  return FORM_SECTIONS.find(section => sections.has(section)) ?? null;
}

/** Guided tutorials open the form in the section they explain. */
export function initialSection(tutorial: string | undefined): FormSectionId {
  if (tutorial === 'events') return 'schedule';
  if (tutorial === 'b2b-checkout-profile') return 'cart';
  return 'basics';
}

/** Count shown next to a section on the list (message key under `sections.counts`), or null when the section is not in use. */
export function sectionCount(
  section: FormSectionId,
  formData: Pick<ProductFormData, 'checkout_profile' | 'custom_checkout_fields' | 'event_mode' | 'sessions'>,
): { key: 'fields' | 'dates'; count: number } | null {
  if (section === 'cart') {
    const count = (formData.checkout_profile?.modules.length ?? 0) + formData.custom_checkout_fields.length;
    return count ? { key: 'fields', count } : null;
  }
  if (section === 'schedule') {
    const count = formData.event_mode ? formData.sessions?.length ?? 0 : 0;
    return count ? { key: 'dates', count } : null;
  }
  return null;
}
