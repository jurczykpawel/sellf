/** Lead form wire contract and canonical consent wording. @see server.ts */
import { z } from 'zod';

export const DEFAULT_LEAD_CONSENT = {
  lead_consent_required: false,
  lead_consent_version: '1',
  lead_consent_text_pl: 'Chcę otrzymywać wiadomości o nowych materiałach i produktach. Mogę wypisać się w każdej chwili.',
  lead_consent_text_en: 'I want to receive news about new materials and products. I can unsubscribe at any time.',
};
export interface LeadConsentSettings {
  lead_consent_required?: boolean;
  lead_consent_version?: string;
  lead_consent_text_pl?: string;
  lead_consent_text_en?: string;
}
export const leadSettingsSchema = z.object({
  lead_consent_required: z.boolean().optional(),
  lead_consent_version: z.string().regex(/^[a-zA-Z0-9._-]{1,60}$/).optional(),
  lead_consent_text_pl: z.string().trim().min(1).max(500).optional(),
  lead_consent_text_en: z.string().trim().min(1).max(500).optional(),
});
export function validateLeadSettings(value: unknown): string[] {
  const parsed = leadSettingsSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
}
export interface MarketingConsentConfig { required: boolean; version: string; text: string }
export function consentForLocale(settings: LeadConsentSettings | null, locale: string): MarketingConsentConfig {
  const value = { ...DEFAULT_LEAD_CONSENT, ...settings };
  const lang = locale === 'pl' ? 'pl' : 'en';
  return { required: value.lead_consent_required, version: `${value.lead_consent_version}:${lang}`, text: value[`lead_consent_text_${lang}`] };
}
export const productIdentifierSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const leadTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const altchaSchema = z.object({
  algorithm: z.enum(['SHA-1', 'SHA-256', 'SHA-512']), challenge: z.string().max(256),
  salt: z.string().max(512), signature: z.string().max(256), number: z.number().int().nonnegative().max(100_000),
});
export const leadBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  src: z.string().url().max(2048).refine(value => new URL(value).protocol === 'https:'),
  product: productIdentifierSchema.optional(), nonce: leadTokenSchema,
  altcha: z.union([z.string().min(1).max(4096), altchaSchema]),
  marketingConsent: z.boolean().optional(), consentVersion: z.string().min(1).max(64).optional(),
  consentText: z.string().max(500).optional(),
});
export const LEAD_FORM_MESSAGES = {
  en: {
    title: 'Get the material', emailLabel: 'Email address', placeholder: 'you@example.com', submit: 'Send access link',
    verifying: 'Checking submission…', solving: 'Verifying…', submitting: 'Sending…',
    success: 'Check your email and confirm your email address.', invalidEmail: 'Enter a valid email address.',
    rejected: 'Submission rejected. Please try again.', rateLimit: 'Too many attempts. Try again later.',
    networkError: 'Unable to send. Please try again.', dismiss: 'Skip', consentRequired: 'Select the consent checkbox to join the list.',
  },
  pl: {
    title: 'Odbierz materiał', emailLabel: 'Adres email', placeholder: 'ty@example.com', submit: 'Wyślij link',
    verifying: 'Sprawdzam zgłoszenie…', solving: 'Trwa weryfikacja…', submitting: 'Wysyłam…',
    success: 'Sprawdź pocztę i potwierdź adres email.', invalidEmail: 'Podaj poprawny adres email.',
    rejected: 'Zgłoszenie odrzucono. Spróbuj ponownie.', rateLimit: 'Za dużo prób. Spróbuj później.',
    networkError: 'Nie udało się wysłać. Spróbuj ponownie.', dismiss: 'Pomiń', consentRequired: 'Zaznacz zgodę, aby zapisać się na listę.',
  },
};
