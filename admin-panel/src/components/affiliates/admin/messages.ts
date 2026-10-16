/** Shared EN/PL copy. @see messages/en.json */
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
export const affiliateAdminMessages = { en: en.affiliates.admin, pl: pl.affiliates.admin };
export type AffiliateAdminLocale = keyof typeof affiliateAdminMessages;
