/**
 * Seller-initiated license issuance (admin panel and API v1): validates the request
 * against the product, issues the license, audits it and mails the buyer the key.
 * license.issued is captured by the issued_licenses insert trigger.
 * @see supabase/migrations/20261110235905_release_2026_11_0_fulfillment_core.sql
 */
import 'server-only';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { issueLicense } from '@/lib/license-keys/issue';
import { resolveCustomerLocale } from '@/lib/webhooks/customer-locale';
import { parseLicenseClaims, type LicenseClaims } from '@/lib/license-keys/format';
import { normalizeLicenseDomain } from '@/lib/license-keys/domain';
import { licenseEmailSchema } from '@/lib/license-keys/email';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { PREDEFINED_CUSTOM_FIELDS, validateCustomFieldDefinitions, validateCustomFieldValues } from '@/lib/validations/custom-checkout-fields';
import { formatTransferDeadline } from '@/lib/orders/transfer-format';
import { licenseDurationError } from '@/lib/validations/product';

export const licenseRequestSchema = z.object({
  productId: z.string().uuid(),
  email: licenseEmailSchema,
  domain: z.string().trim().max(253).refine((value) => !value || Boolean(normalizeLicenseDomain(value)), 'Invalid domain').optional(),
  customFieldValues: z.record(z.string(), z.string().max(500)).optional(),
  sendEmail: z.boolean().optional(),
  locale: z.enum(['pl', 'en']).optional(),
}).strict();

export type LicenseRequestInput = z.infer<typeof licenseRequestSchema>;

export interface IssuedLicenseView {
  id: string;
  token: string;
  kid: string;
  sellerId: string;
  claims: LicenseClaims | null;
  jwksUrl: string;
  crlUrl: string;
  emailSent: boolean;
}

export type LicenseRequestResult =
  | { ok: true; license: IssuedLicenseView }
  | { ok: false; status: 400 | 409 | 500; error: string; fieldErrors?: Record<string, string> };

export async function issueRequestedLicense(
  input: LicenseRequestInput,
  ctx: { actorUserId: string; source: 'manual' | 'api'; origin: string },
): Promise<LicenseRequestResult> {
  const admin = createAdminClient();
  const product = await admin.from('products').select('slug, name, custom_checkout_fields, license_duration_days').eq('id', input.productId).single();
  if (product.error || !product.data) return { ok: false, status: 409, error: 'Product is not configured for license issuance' };
  // A legacy duration beyond the supported range cannot produce a valid expiry date (W146 B7).
  if (licenseDurationError(product.data.license_duration_days)) return { ok: false, status: 409, error: 'Invalid license duration on the product', fieldErrors: { license_duration_days: 'license_duration' } };
  const definitions = validateCustomFieldDefinitions(product.data.custom_checkout_fields ?? []);
  if (!definitions.ok) return { ok: false, status: 400, error: 'Invalid product configuration' };
  const domainField = definitions.value.find(field => field.id === PREDEFINED_CUSTOM_FIELDS.license_domain.id && field.type === 'domain');
  const inputValues = { ...input.customFieldValues, ...(domainField && input.domain ? { [domainField.id]: input.domain } : {}) };
  const values = validateCustomFieldValues(definitions.value, inputValues);
  if (!values.ok) return { ok: false, status: 400, error: 'Invalid form values', fieldErrors: values.errors };

  let locale: 'pl' | 'en';
  let result;
  try {
    locale = await resolveBuyerLocale(admin, input.email, input.locale);
    result = await issueLicense(admin, {
      productId: input.productId, email: input.email, userId: null, orderId: `${ctx.source}_${randomUUID()}`,
      customFieldValues: values.values, source: ctx.source, locale,
    });
  } catch (error) {
    console.error('[license-request] Issuance failed:', error instanceof Error ? error.message : 'Unknown error');
    return { ok: false, status: 500, error: 'License issuance failed' };
  }
  if (!result?.id) return { ok: false, status: 409, error: 'Product is not configured for license issuance or no active signing key exists' };

  const claims = parseLicenseClaims(result.token);
  await createPlatformClient().from('audit_log').insert({
    table_name: 'issued_licenses',
    operation: 'INSERT',
    performed_by: ctx.actorUserId,
    new_values: { action: ctx.source === 'api' ? 'API_LICENSE_ISSUED' : 'MANUAL_LICENSE_ISSUED', license_id: result.id, product_id: input.productId, email: input.email, domain: claims?.domain ?? null, kid: result.kid },
  });

  const emailSent = input.sendEmail === false ? false
    : await mailLicenseToBuyer({ email: input.email, token: result.token, productSlug: product.data.slug, productName: product.data.name, locale });

  return {
    ok: true,
    license: {
      id: result.id, token: result.token, kid: result.kid, sellerId: result.sellerId, claims,
      jwksUrl: `${ctx.origin}/api/licenses/jwks?seller=${result.sellerId}`,
      crlUrl: `${ctx.origin}/api/licenses/revoked?seller=${result.sellerId}`,
      emailSent,
    },
  };
}

/** Sign-in mail carrying the key and a link to the product page; the key is removed from account data after delivery. */
async function mailLicenseToBuyer(input: { email: string; token: string; productSlug: string; productName: string | null; locale: 'pl' | 'en' }): Promise<boolean> {
  const admin = createAdminClient();
  try {
    const exp = parseLicenseClaims(input.token)?.exp;
    const expiresAt = exp ? new Date(exp * 1000).toISOString() : null;
    const sent = await sendTrustedMagicLink({ transactionalOnly: true,
      email: input.email,
      redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: getSellfBaseUrl(), productSlug: input.productSlug, locale: input.locale, sessionId: undefined, paymentIntentId: undefined }),
      data: { locale: input.locale, license_key: input.token, ...(expiresAt && { license_expires_at: expiresAt, license_expires_text: formatTransferDeadline(expiresAt, input.locale) }), ...(input.productName && { purchase_product: input.productName.slice(0, 500) }) },
    });
    if (!sent.ok) console.error('[license-request] Buyer mail not sent:', sent.code);
    return sent.ok && !sent.skipped;
  } finally {
    const cleared = await admin.rpc('prepare_event_mail', { p_email: input.email, p_data: { locale: input.locale } });
    if (cleared.error) console.error('[license-request] License key cleanup failed');
  }
}

/** Buyer's own language (latest order, then account) wins; the seller panel language is only a fallback. */
export async function resolveBuyerLocale(admin: ReturnType<typeof createAdminClient>, email: string, fallback?: 'pl' | 'en'): Promise<'pl' | 'en'> {
  const { data, error } = await admin.rpc('buyer_mail_locale', { p_email: email });
  if (!error && (data === 'pl' || data === 'en')) return data;
  return resolveCustomerLocale(admin, fallback);
}
