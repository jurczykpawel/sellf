/** Online payment of an unpaid transfer order from the signed order link. @see lib/orders/quick-pay.ts */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { createQuickPaySession, quoteOrderPayment } from '@/lib/orders/quick-pay';
import { buildOrderPayLink, verifyTransferToken } from '@/lib/orders/transfer-token';
import { checkRateLimit } from '@/lib/rate-limiting';
import { getStripeServer } from '@/lib/stripe/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NextRequest } from 'next/server';

const inputSchema = z.object({ token: z.string().max(80), expectedAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }): Promise<NextResponse> {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (!await checkRateLimit('order_quick_pay', 10, 10)) return reply({ error: 'Too many requests' }, 429);
    const { orderId } = await params;
    const parsed = inputSchema.safeParse(await readJsonBody(request));
    if (!z.uuid().safeParse(orderId).success || !parsed.success) return reply({ error: 'Invalid request' }, 400);
    if (!verifyTransferToken(parsed.data.token, orderId)) return reply({ error: 'Not found' }, 404);
    const db = createAdminClient();
    const { data: tx } = await db.from('payment_transactions').select('id,payment_provider,status,amount,currency,product_id,coupon_id,order_number,customer_email,metadata,products(name,slug)')
      .eq('id', orderId).eq('payment_provider', 'bank_transfer').single();
    if (!tx) return reply({ error: 'Not found' }, 404);
    const now = new Date(), base = getSellfBaseUrl();
    const locale = (tx.metadata as Record<string, unknown> | null)?.locale === 'pl' ? 'pl' : 'en';
    const product = (Array.isArray(tx.products) ? tx.products[0] : tx.products) as { name: string; slug: string } | null;
    const quote = await quoteOrderPayment(db, tx, now);
    if (quote.mode === 'paid') return reply({ reason: 'paid' }, 409);
    if (quote.mode === 'unavailable') return reply({ reason: quote.reason, checkoutUrl: product ? `${base}/${locale}/checkout/${product.slug}` : null }, 409);
    if (quote.amount !== parsed.data.expectedAmount) return reply({ reason: 'amount_changed', quote }, 409);
    const session = await createQuickPaySession(db, await getStripeServer(), tx, quote,
      { baseUrl: base, returnUrl: buildOrderPayLink(orderId, locale, base).url, now, productName: product?.name ?? 'Order' });
    return reply(session);
  } catch (error) {
    if (!(error instanceof ApiPayloadTooLargeError)) console.error('[quick-pay] Session unavailable:', error instanceof Error ? error.message : 'Unknown error');
    return reply({ error: error instanceof ApiPayloadTooLargeError ? 'Request too large' : 'Payment unavailable' }, error instanceof ApiPayloadTooLargeError ? 413 : 500);
  }
}
