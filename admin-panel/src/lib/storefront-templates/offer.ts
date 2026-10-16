/** Shared opt-in offer defaults. @see phase2-contracts.ts */
import type { OfferPageConfig } from '@/lib/storefront-templates/offer-repository';
export const DEFAULT_OFFER: OfferPageConfig = { format: 1, enabled: false, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null };
