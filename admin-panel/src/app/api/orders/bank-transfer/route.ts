/** Public transfer placement. @see lib/orders/bank-transfer-config.ts */
import { after, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizeCouponCode } from '@/lib/coupons/normalize-code';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';
import { verifyCaptchaToken } from '@/lib/captcha/verify';
import { validateCheckoutModules } from '@/lib/checkout-modules/validate';
import { resolveEventCheckout } from '@/lib/events/checkout';
import { bankTransferConfigSchema, canUseBankTransfer } from '@/lib/orders/bank-transfer-config';
import { issueInvoiceForTransaction } from '@/lib/invoicing/service';
import { createTransferTokenSigner } from '@/lib/orders/transfer-token';
import { sendTransferAccessMail } from '@/lib/orders/transfer-mail';
import { dispatchTransferEvent } from '@/lib/orders/bank-transfer-service';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { getClientIp } from '@/lib/security/client-ip';
import { buildCheckoutLineSpecs, buildOrderSnapshotLines } from '@/lib/services/checkout-line-items';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import { ProductValidationService } from '@/lib/services/product-validation';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { validateCustomFieldDefinitions, validateCustomFieldValues } from '@/lib/validations/custom-checkout-fields';
import type { NextRequest } from 'next/server';
import type { ValidatedProduct } from '@/lib/services/product-validation';
import type { Json } from '@/types/database';
const inputSchema = z.object({
  productId: z.uuid(), email: z.email().max(254), quantity: z.number().int().min(1).max(100).optional(),
  sessionId: z.uuid().optional(), bumpProductIds: z.array(z.uuid()).max(20).default([]), couponCode: z.string().trim().max(100).optional(),
  moduleValues: z.record(z.string(), z.unknown()), termsAccepted: z.literal(true), locale: z.enum(['pl', 'en']).default('en'),
  captchaToken: z.string().min(1).max(16384), customFieldValues: z.record(z.string(), z.string()).optional(),
}).strict();
const couponSchema = z.object({ valid: z.literal(true), id: z.uuid(), code: z.string(), discount_type: z.enum(['percentage', 'fixed', 'set_price']),
  discount_value: z.number(), exclude_order_bumps: z.boolean(), allowed_product_ids: z.array(z.string()).optional() });
export async function POST(request: NextRequest): Promise<NextResponse> {
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (!request.headers.get('content-type')?.includes('application/json')) return fail('JSON required', 415);
    if (!await checkRateLimit('bank_transfer_place', 10, 5)) return fail('Too many orders', 429);
    const parsed = inputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return fail('Invalid order');
    const body = parsed.data;
    const signToken = createTransferTokenSigner();
    if (!(await verifyCaptchaToken(body.captchaToken, 'altcha')).success) return fail('Captcha required', 403);
    const session = await createClient(); const { data: { user } } = await session.auth.getUser();
    const email = (user?.email ?? body.email).trim().toLowerCase();
    if (!await ProductValidationService.validateEmail(email)) return fail('Invalid email');
    const db = createAdminClient();
    const { data: product, error } = await db.from('products').select('*').eq('id', body.productId).eq('is_active', true).single();
    if (error || !product) return fail('Product not found', 404);
    ProductValidationService.validateTemporalAvailability(product as ValidatedProduct);
    const { data: settings } = await db.from('bank_transfer_config').select('*').single();
    const config = bankTransferConfigSchema.safeParse(settings && Object.fromEntries(Object.entries(settings).filter(([k]) => k !== 'id')));
    const party = body.moduleValues.buyer;
    if (!config.success || !canUseBankTransfer(config.data.bank_transfer_enabled, product.checkout_profile, party && typeof party === 'object' && 'type' in party ? party.type : undefined)) return fail('Transfer unavailable');
    const validation = validateCheckoutModules(product.checkout_profile, body.moduleValues, {
      locale: body.locale, currency: product.currency, termsAccepted: body.termsAccepted,
    });
    if (!validation.success) return NextResponse.json({ errors: validation.errors }, { status: validation.status });
    const buyer = validation.details.buyer;
    if (!buyer || typeof buyer !== 'object' || Array.isArray(buyer)) return fail('Transfer unavailable');
    buyer.email = email;
    if (body.quantity !== undefined && body.quantity !== validation.quantity) return fail('Quantity mismatch');
    for (const identifier of [email, ...(typeof buyer.nip === 'string' && buyer.nip ? [buyer.nip] : [])]) {
      const key = createHash('sha256').update(identifier).digest('hex');
      if (!await checkRateLimitForIdentifier('bank_transfer_identity', 10, 60, key)) return fail('Too many orders', 429);
    }
    const defs = validateCustomFieldDefinitions(product.custom_checkout_fields ?? []);
    if (!defs.ok) return fail('Invalid checkout configuration', 500);
    const custom = validateCustomFieldValues(defs.value, body.customFieldValues ?? {}, { requireAll: true });
    if (!custom.ok) return fail('Invalid custom fields');
    let price = getEffectiveUnitPrice(product);
    const ip = getClientIp(request);
    if (product.event_mode) {
      const event = await resolveEventCheckout(db, { productId: product.id, sessionId: body.sessionId, email, ip, quantity: validation.quantity });
      if (!event.success) return fail(event.error, event.status);
      price = event.price;
    }
    const { data: offers, error: offerError } = await db.rpc('get_product_order_bumps', { product_id_param: product.id });
    if (offerError) return fail('Order bumps unavailable', 503);
    const requested = [...new Set(body.bumpProductIds)];
    const selected = requested.map(id => offers?.find(b => b.bump_product_id === id && b.bump_currency.toUpperCase() === product.currency.toUpperCase()));
    if (selected.some(b => !b)) return fail('Invalid order bump');
    const { data: bumpRows, error: bumpError } = requested.length
      ? await db.from('products').select('*').in('id', requested).eq('is_active', true) : { data: [], error: null };
    if (bumpError || bumpRows?.length !== requested.length) return fail('Invalid order bump');
    const orderBumpIds: Record<string, string> = {}; const accessOverrides: Record<string, number | null> = {};
    const toProduct = (p: typeof product) => ({ id: p.id, name: p.name, currency: p.currency,
      vatRate: p.vat_rate, priceIncludesVat: p.price_includes_vat, vatExempt: p.vat_exempt });
    const bumps = (bumpRows ?? []).map(p => {
      const offer = selected.find(b => b?.bump_product_id === p.id)!;
      orderBumpIds[p.id] = offer.bump_id; accessOverrides[p.id] = offer.bump_access_duration;
      return { product: toProduct(p), price: offer.bump_price };
    });
    let coupon = null;
    if (body.couponCode) {
      const verified = await db.rpc('verify_coupon', { code_param: normalizeCouponCode(body.couponCode), product_id_param: product.id,
        customer_email_param: email, currency_param: product.currency });
      const value = couponSchema.safeParse(verified.data);
      if (verified.error || !value.success) return fail('Invalid coupon');
      coupon = value.data;
    }
    const { specs, isFree } = buildCheckoutLineSpecs({ main: toProduct(product), mainPrice: price,
      quantity: validation.quantity, bumps, coupon, taxMode: 'local' });
    if (isFree) return fail('Transfer requires a positive amount');
    const lines = buildOrderSnapshotLines(specs, { orderBumpIds, accessOverrides });
    if (product.event_mode) lines[0].session_id = body.sessionId;
    const placed = await db.rpc('bank_transfer_order', { p_order: {
      product_id: product.id, currency: product.currency.toUpperCase(), customer_email: email, user_id: user?.id ?? null,
      order_details: { v: 1, ...validation.details }, custom_field_values: custom.values, coupon_id: coupon?.id ?? null,
      metadata: { event_ip: ip, locale: body.locale },
    }, p_lines: lines as unknown as Json });
    if (placed.error) return fail(placed.error.code === 'P0429' ? 'Unpaid order limit reached' : 'Order placement failed', placed.error.code === 'P0429' ? 429 : placed.error.code === 'P0409' ? 409 : 400);
    const result = placed.data as { transaction_id: string; order_number: number; amount: number; currency: string; dueAt: string; transfer: Json };
    after(async () => {
      await issueInvoiceForTransaction(result.transaction_id, { client: db });
      await sendTransferAccessMail(db, result.transaction_id);
    });
    try { await dispatchTransferEvent(db, result.transaction_id, 'order.placed'); }
    catch { console.error('[bank-transfer] Event awaiting recovery:', result.transaction_id); }
    return NextResponse.json({ orderId: result.transaction_id, orderNumber: result.order_number, amount: result.amount,
      currency: result.currency, dueAt: result.dueAt, transfer: result.transfer, token: signToken(result.transaction_id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return fail(error instanceof ApiPayloadTooLargeError ? 'Request too large' : 'Order unavailable', error instanceof ApiPayloadTooLargeError ? 413 : 500);
  }
}
