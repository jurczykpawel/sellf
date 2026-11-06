/** PlayerStack lead intake and email-confirmed delivery. @see config.ts */
import { resolveCustomerLocale } from '@/lib/webhooks/customer-locale';
import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createChallenge, verifySolution } from 'altcha-lib/v1';
import { z } from 'zod';
import { ApiPayloadTooLargeError, readJsonBody } from '@/lib/api/body-limit';
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { validateEmailAction } from '@/lib/actions/validate-email';
import { buildEmbedCorsHeaders, getSellfBaseUrl, loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import { emitFreeAccessLead } from '@/lib/services/free-access-events';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';
import { WebhookService } from '@/lib/services/webhook-service';
import { LEAD_FORM_MESSAGES, consentForLocale, leadBodySchema, leadTokenSchema, productIdentifierSchema } from '@/lib/leads/config';
import type { SupabaseClient } from '@supabase/supabase-js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');

function leadLocale(request: Request, consentVersion?: string): 'pl' | 'en' {
  const locale = new URL(request.url).searchParams.get('locale') ?? consentVersion?.split(':').at(-1)
    ?? request.headers.get('accept-language')?.split(/[-,;]/)[0].trim().toLowerCase();
  return locale === 'pl' ? 'pl' : 'en';
}

const PRODUCT_FIELDS = 'id,slug,name,price,product_type,is_active,available_from,available_until,embed_enabled,seller_id,preview_video_url,lead_consent_required,lead_consent_version,lead_consent_text_pl,lead_consent_text_en' as const;

async function context(identifier?: unknown) {
  const client = createAdminClient();
  const valid = productIdentifierSchema.safeParse(identifier);
  const { data: product, error } = valid.success
    ? await client.from('products').select(PRODUCT_FIELDS).eq(z.string().uuid().safeParse(valid.data).success ? 'id' : 'slug', valid.data).maybeSingle()
    : { data: null, error: null };
  if (error) throw new Error('Product lookup failed');
  const origins = [...await loadAllowedOriginsForProduct(client, product?.seller_id ?? null), getSellfBaseUrl()];
  return { client, product, origins };
}
function requestOrigin(request: Request): string | null {
  return request.headers.get('origin') ?? (request.headers.get('sec-fetch-site') === 'same-origin' ? getSellfBaseUrl() : null);
}
function reply(request: Request, origins: string[], status: number, data: unknown = null) {
  const headers = { ...buildEmbedCorsHeaders(requestOrigin(request), origins, 'GET, POST, OPTIONS'), 'Access-Control-Allow-Credentials': 'true' };
  return status === 204 ? new NextResponse(null, { status, headers }) : NextResponse.json(data, { status, headers });
}
function allowed(request: Request, origins: string[]): boolean {
  return !!buildEmbedCorsHeaders(requestOrigin(request), origins)['Access-Control-Allow-Origin'];
}
function available(product: Awaited<ReturnType<typeof context>>['product']): boolean {
  return !!product && product.is_active && product.embed_enabled && product.price === 0 && product.product_type !== 'subscription'
    && (!product.available_from || Date.parse(product.available_from) <= Date.now())
    && (!product.available_until || Date.parse(product.available_until) > Date.now());
}
export async function leadOptions(request: Request, product?: string): Promise<NextResponse> {
  try {
    const { origins } = await context(product ?? new URL(request.url).searchParams.get('product'));
    return reply(request, origins, allowed(request, origins) ? 204 : 403, { error: 'Forbidden' });
  } catch { return reply(request, [], 503, { error: 'Unavailable' }); }
}
export async function leadChallenge(request: Request): Promise<NextResponse> {
  let origins: string[] = [];
  try {
    const id = new URL(request.url).searchParams.get('product');
    const ctx = await context(id); origins = ctx.origins;
    if (!allowed(request, origins)) return reply(request, origins, 403, { error: 'Forbidden' });
    if (!await checkRateLimit('leads_challenge', 30, 1)) return reply(request, origins, 429, { error: 'Too many requests' });
    if (id && !available(ctx.product)) return reply(request, origins, 404, { error: 'Product is not available' });
    const hmacKey = process.env.ALTCHA_HMAC_KEY;
    if (!hmacKey) return reply(request, origins, 503, { error: 'ALTCHA is not configured' });
    const altcha = await createChallenge({ hmacKey, maxNumber: 100_000, expires: new Date(Date.now() + 600_000) });
    const nonce = secret();
    const { error } = await ctx.client.from('lead_nonces').insert({ nonce_hash: hash(nonce), product_id: ctx.product?.id ?? null, origin: requestOrigin(request)!, signature: altcha.signature });
    if (error) return reply(request, origins, 503, { error: 'Unavailable' });
    return reply(request, origins, 200, { altcha, nonce });
  } catch { return reply(request, origins, 503, { error: 'Unavailable' }); }
}
export async function leadSubmit(request: Request): Promise<NextResponse> {
  let origins: string[] = [];
  try {
    const raw = await readJsonBody<Record<string, unknown>>(request, 16_384);
    // The first attempt consumes the nonce even when another field is invalid.
    const client = createAdminClient();
    const nonce = leadTokenSchema.safeParse(raw?.nonce);
    const consumed = nonce.success
      ? await client.from('lead_nonces').delete().eq('nonce_hash', hash(nonce.data)).select('*').maybeSingle()
      : { data: null, error: null };
    const ctx = await context(raw?.product); origins = ctx.origins;
    if (!allowed(request, origins)) return reply(request, origins, 403, { error: 'Forbidden' });
    const parsed = leadBodySchema.safeParse(raw);
    const stored = consumed.data;
    if (consumed.error) return reply(request, origins, 503, { error: 'Unavailable' });
    if (!parsed.success || !stored || Date.parse(stored.expires_at) <= Date.now() || stored.origin !== requestOrigin(request)) return reply(request, origins, 400, { error: 'Invalid request' });
    const body = parsed.data;
    if (body.product && !available(ctx.product)) return reply(request, origins, 404, { error: 'Product is not available' });
    if (stored.product_id !== (ctx.product?.id ?? null)) return reply(request, origins, 400, { error: 'Invalid request' });
    const locale = leadLocale(request, body.consentVersion);
    const consent = consentForLocale(ctx.product, locale);
    if ((!body.product || consent.required) && body.marketingConsent !== true) return reply(request, origins, 400, { error: 'Marketing consent required' });
    if (body.marketingConsent && body.consentVersion !== consent.version) return reply(request, origins, 400, { error: 'Invalid consent version' });
    if (!await checkRateLimit('leads_submit', 5, 5) || !await checkRateLimitForIdentifier('leads_email', 5, 1440, `email:${body.email}`)) return reply(request, origins, 429, { error: 'Too many requests' });
    const solution = typeof body.altcha === 'string' ? body.altcha : Buffer.from(JSON.stringify(body.altcha)).toString('base64');
    let validProof = false;
    try {
      const proof = JSON.parse(Buffer.from(solution, 'base64').toString('utf8'));
      const hmacKey = process.env.ALTCHA_HMAC_KEY;
      validProof = !!hmacKey && proof?.signature === stored.signature && await verifySolution(solution, hmacKey);
    } catch { validProof = false; }
    if (!validProof) return reply(request, origins, 400, { error: 'Invalid verification' });
    if (!(await validateEmailAction(body.email)).isValid) return reply(request, origins, 400, { error: 'Invalid email' });
    const confirmation = secret();
    const { error } = await client.from('lead_submissions').insert({
      token_hash: hash(confirmation), email: body.email, product_id: ctx.product?.id ?? null,
      product_slug: ctx.product?.slug ?? null, source: body.src, marketing_consent: body.marketingConsent === true,
      consent_version: body.marketingConsent ? consent.version : null, consent_text: body.marketingConsent ? consent.text : null,
      client_consent_text: body.consentText ?? null,
      locale,
    });
    if (error) return reply(request, origins, 503, { error: 'Unavailable' });
    const redirectTo = `${getSellfBaseUrl()}/auth/callback?redirect_to=${encodeURIComponent(`/auth/lead?token=${confirmation}`)}`;
    const sent = await sendTrustedMagicLink({ email: body.email, redirectTo, data: { locale, ...(ctx.product ? { product_slug: ctx.product.slug } : {}) } });
    if (!sent.ok) return reply(request, origins, sent.code === 'rate_limited' ? 429 : 503, { error: 'Unable to send email' });
    return reply(request, origins, 200, { status: 'check_email' });
  } catch (error) {
    return reply(request, origins, error instanceof ApiPayloadTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 503, { error: 'Invalid request' });
  }
}
export async function playerstackConfig(request: Request, id: string): Promise<NextResponse> {
  let origins: string[] = [];
  try {
    const ctx = await context(id); origins = ctx.origins;
    if (!allowed(request, origins)) return reply(request, origins, 403, { error: 'Forbidden' });
    if (!await checkRateLimit('leads_config', 60, 1)) return reply(request, origins, 429, { error: 'Too many requests' });
    if (!available(ctx.product)) return reply(request, origins, 404, { error: 'Product is not available' });
    const p = ctx.product!;
    const base = getSellfBaseUrl();
    const locale = leadLocale(request);
    const pl = locale === 'pl';
    const automaticEndpoints = new URL(base).protocol === 'https:' ? {
      webhookUrl: `${base}/api/leads/submit?product=${encodeURIComponent(p.slug)}&locale=${locale}`,
      challengeUrl: `${base}/api/leads/challenge?product=${encodeURIComponent(p.slug)}`,
    } : {};
    return reply(request, origins, 200, {
      src: p.preview_video_url ?? '', title: p.name,
      marketingConsent: { pl: consentForLocale(p, 'pl'), en: consentForLocale(p, 'en') },
      emailGate: { ...automaticEndpoints, enabled: true, at: 'after', product: p.slug, altchaFormat: 'base64', remember: false,
        marketingConsent: consentForLocale(p, pl ? 'pl' : 'en'),
        privacy: { text: p.lead_consent_required ? (pl ? 'Odbierasz materiał w zamian za zapis na newsletter, z którego możesz wypisać się w każdej chwili.' : 'Receive this material in exchange for joining the newsletter. You can unsubscribe at any time.') : (pl ? 'Potwierdź email, aby otrzymać materiał.' : 'Confirm your email to receive the material.'), href: `${getSellfBaseUrl()}/${pl ? 'pl' : 'en'}/privacy`, linkText: pl ? 'Prywatność' : 'Privacy' },
        messages: LEAD_FORM_MESSAGES[pl ? 'pl' : 'en'],
      },
    });
  } catch { return reply(request, origins, 503, { error: 'Unavailable' }); }
}
export async function confirmLead(token: string, user: { id: string; email?: string | null }, userClient: SupabaseClient): Promise<{ ok: boolean; productSlug?: string }> {
  if (!leadTokenSchema.safeParse(token).success || !user.email) return { ok: false };
  try {
    const client = createAdminClient();
    const { data: lead, error } = await client.from('lead_submissions').select('*, product:products(id,slug,name)').eq('token_hash', hash(token)).eq('email', user.email.toLowerCase()).maybeSingle();
    if (error || !lead || Date.parse(lead.expires_at) <= Date.now()) return { ok: false };
    const product = lead.product;
    let sendMail = false;
    if (lead.product_slug) {
      if (!product) return { ok: false };
      const grant = await grantFreeProductAccess(userClient, client, { product, user: { id: user.id, email: user.email }, deferLeadEvent: true });
      if (!grant.accessGranted) return { ok: false };
      sendMail = !grant.alreadyHadAccess && !lead.confirmed_at;
    }
    const result = await client.rpc('confirm_lead_submission', { p_token_hash: hash(token), p_email: user.email.toLowerCase() });
    const confirmed = result.data?.[0];
    if (result.error || !confirmed) return { ok: false };
    const locale = await resolveCustomerLocale(client, confirmed.locale);
    const payload = {
      leadId: confirmed.id, customer: { email: confirmed.email, userId: user.id, locale }, product,
      source: confirmed.source, marketingConsent: confirmed.marketing_consent,
      consentVersion: confirmed.consent_version, consentConfirmedAt: confirmed.marketing_consent ? confirmed.confirmed_at : null,
      capturedAt: confirmed.created_at, confirmedAt: confirmed.confirmed_at,
    };
    if (product) {
      if (!await emitFreeAccessLead(client, { product, user: { id: user.id, email: user.email }, locale }, { data: payload, sendMail })) return { ok: false };
    } else await WebhookService.trigger('lead.captured', payload, client, undefined, `lead:${confirmed.id}`);
    return { ok: true, productSlug: product?.slug };
  } catch { return { ok: false }; }
}
