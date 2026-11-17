/**
 * Seller-initiated license issuance (admin panel and API v1): validates the request
 * against the product, issues the license with its audit entry in one transaction and mails the
 * buyer the key. license.issued is captured by the issued_licenses insert trigger, inside the same
 * transaction (issue_license_with_audit), so a refused audit entry leaves no license and no event.
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 */
import 'server-only';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { sendLicenseMail } from '@/lib/license-keys/license-mail';
import { issueLicense } from '@/lib/license-keys/issue';
import { resolveCustomerLocale } from '@/lib/webhooks/customer-locale';
import { parseLicenseClaims, type LicenseClaims } from '@/lib/license-keys/format';
import { normalizeLicenseDomain } from '@/lib/license-keys/domain';
import { licenseEmailSchema } from '@/lib/license-keys/email';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { recordAuditEntry } from '@/lib/audit/audit-entry';
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
  /** The key mail is queued for automatic delivery (auth mail limit); access and license are saved. */
  emailPending: boolean;
}

export type LicenseRequestResult =
  | { ok: true; license: IssuedLicenseView }
  | { ok: false; status: 400 | 409 | 500; error: string; fieldErrors?: Record<string, string> };

export async function issueRequestedLicense(
  input: LicenseRequestInput,
  ctx: { actorUserId: string; source: 'manual' | 'api'; origin: string; accessGrantId?: string; userId?: string },
): Promise<LicenseRequestResult> {
  const admin = createAdminClient();
  const product = await admin.from('products').select('slug, name, custom_checkout_fields, license_duration_days').eq('id', input.productId).single();
  if (product.error || !product.data) return { ok: false, status: 409, error: 'Product is not configured for license issuance' };
  // A legacy duration beyond the supported range cannot produce a valid expiry date.
  if (licenseDurationError(product.data.license_duration_days)) return { ok: false, status: 409, error: 'Invalid license duration on the product', fieldErrors: { license_duration_days: 'license_duration' } };
  const definitions = validateCustomFieldDefinitions(product.data.custom_checkout_fields ?? []);
  if (!definitions.ok) return { ok: false, status: 400, error: 'Invalid product configuration' };
  const domainField = definitions.value.find(field => field.id === PREDEFINED_CUSTOM_FIELDS.license_domain.id && field.type === 'domain');
  const inputValues = { ...input.customFieldValues, ...(domainField && input.domain ? { [domainField.id]: input.domain } : {}) };
  const values = validateCustomFieldValues(definitions.value, inputValues);
  if (!values.ok) return { ok: false, status: 400, error: 'Invalid form values', fieldErrors: values.errors };

  let locale: 'pl' | 'en';
  let result;
  const action = ctx.source === 'api' ? 'API_LICENSE_ISSUED' : 'MANUAL_LICENSE_ISSUED';
  try {
    locale = await resolveBuyerLocale(admin, input.email, input.locale);
    // The license, its license.issued event and the audit entry commit together: when audit_log
    // refuses the entry (e.g. the actor is no auth user), no license exists and no event is queued.
    result = await issueLicense(admin, {
      productId: input.productId, email: input.email, userId: ctx.userId ?? null, orderId: ctx.accessGrantId ? `access_${ctx.accessGrantId}` : `${ctx.source}_${randomUUID()}`,
      accessGrantId: ctx.accessGrantId,
      customFieldValues: values.values, source: ctx.source, locale,
    }, { audit: { performedBy: ctx.actorUserId, values: { action } } });
  } catch (error) {
    console.error('[license-request] Issuance failed:', error instanceof Error ? error.message : 'Unknown error');
    return { ok: false, status: 500, error: 'License issuance failed' };
  }
  if (!result?.id) return { ok: false, status: 409, error: 'Product is not configured for license issuance or no active signing key exists' };

  const claims = parseLicenseClaims(result.token);
  if (result.reused) {
    // An already issued key (retry of an access grant) is handed out again: nothing changes in the
    // database, so this entry records the hand-out itself. No entry, no key and no mail.
    const audit = await recordAuditEntry(createPlatformClient(), {
      table_name: 'issued_licenses',
      operation: 'INSERT',
      performed_by: ctx.actorUserId,
      new_values: { ...(ctx.accessGrantId ? { access_grant_id: ctx.accessGrantId } : {}), action, reused: true, license_id: result.id, product_id: input.productId, email: input.email, domain: claims?.domain ?? null, kid: result.kid },
    });
    if (!audit.ok) {
      console.error('[license-request] Audit entry refused:', audit.error);
      return { ok: false, status: 500, error: 'License audit could not be saved' };
    }
  }

  let emailSent = false;
  let emailPending = false;
  if (ctx.accessGrantId || input.sendEmail !== false) {
    // Both paths share the durable retry queue: a mail the provider refuses for now is delivered later.
    const exp = claims?.exp ? new Date(claims.exp * 1000).toISOString() : null;
    const delivery = await sendLicenseMail(admin, { userId: ctx.userId ?? null, email: input.email, token: result.token, productSlug: product.data.slug, productName: (product.data.name ?? '').slice(0, 500), locale,
      ...(exp && { mailData: { license_expires_at: exp, license_expires_text: formatTransferDeadline(exp, locale) } }) });
    if (delivery === 'failed' && ctx.accessGrantId) return { ok: false, status: 500, error: 'Access and license saved, but the license email could not be sent.' };
    // A mail left to the webhook channel (buyer emails off) counts as sent only for a grant, as before.
    emailSent = delivery === 'sent' || (delivery === 'skipped' && Boolean(ctx.accessGrantId));
    emailPending = delivery === 'pending';
  }

  return {
    ok: true,
    license: {
      id: result.id, token: result.token, kid: result.kid, sellerId: result.sellerId, claims,
      jwksUrl: `${ctx.origin}/api/licenses/jwks?seller=${result.sellerId}`,
      crlUrl: `${ctx.origin}/api/licenses/revoked?seller=${result.sellerId}`,
      emailSent,
      emailPending,
    },
  };
}

/** Buyer's own language (latest order, then account) wins; the seller panel language is only a fallback. */
export async function resolveBuyerLocale(admin: ReturnType<typeof createAdminClient>, email: string, fallback?: 'pl' | 'en'): Promise<'pl' | 'en'> {
  const { data, error } = await admin.rpc('buyer_mail_locale', { p_email: email });
  if (!error && (data === 'pl' || data === 'en')) return data;
  return resolveCustomerLocale(admin, fallback);
}
