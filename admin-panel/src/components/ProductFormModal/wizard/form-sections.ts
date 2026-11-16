/**
 * Product form sections, ordered by what the seller sets; each section says what it changes for the buyer.
 * @see ./ProductCreationWizard.tsx
 */

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
  license_tier: 'delivery',
  license_duration_days: 'delivery',
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
