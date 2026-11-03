/** Public order instructions, scoped by the signed link. @see lib/orders/transfer-token.ts */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import TransferDeclaration from '@/components/checkout/TransferDeclaration';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import QuickPayButton from '@/components/checkout/QuickPayButton';
import { quoteOrderPayment } from '@/lib/orders/quick-pay';
import { verifyTransferToken } from '@/lib/orders/transfer-token';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Metadata } from 'next';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function TransferPage({ params, searchParams }: { params: Promise<{ orderId: string; locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { orderId, locale } = await params, { token } = await searchParams;
  if (!z.uuid().safeParse(orderId).success || !verifyTransferToken(token, orderId) || !await checkRateLimit('transfer_instructions', 60, 1)) notFound();
  const { data: tx } = await createAdminClient().from('payment_transactions').select('id,payment_provider,product_id,coupon_id,customer_email,amount,currency,order_number,payment_due_at,transfer_details,status,release_at,invoice_hold_at,transfer_declared_at,products(slug)').eq('id', orderId).eq('payment_provider', 'bank_transfer').single();
  if (!tx) notFound();
  const t = await getTranslations({ locale, namespace: 'bankTransfer' });
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
  const unpaid = tx.status === 'awaiting_payment';
  const quote = await quoteOrderPayment(createAdminClient(), tx, new Date());
  const product = (Array.isArray(tx.products) ? tx.products[0] : tx.products) as { slug: string } | null;
  return <main className="max-w-2xl mx-auto p-6 my-10"><h1 className="text-2xl font-semibold">{t('thanks', { number: tx.order_number ?? '' })}</h1>
    {tx.status !== 'cancelled' && <p className="mt-3">{t(`status_${tx.status}`)}</p>}
    {unpaid && tx.invoice_hold_at && <p className="mt-3">{t('invoiceHold')}</p>}
    {unpaid && tx.release_at && <p className="mt-3 font-semibold">{t('reservedUntil', { date: date(tx.release_at) })}</p>}
    <TransferInstructions paid={tx.status === 'completed'} cancelled={tx.status === 'cancelled'} transfer={tx.transfer_details} amount={tx.amount} currency={tx.currency} dueAt={tx.payment_due_at} print />
    {(quote.mode === 'settle' || quote.mode === 'reopen') && <QuickPayButton orderId={orderId} token={token!} amount={quote.amount} currency={quote.currency} />}
    {tx.status === 'cancelled' && quote.mode === 'unavailable' && product && <p className="my-4 print:hidden">{t('quickPayNewOrder')} <a className="underline" href={`/${locale}/checkout/${product.slug}`}>{t('quickPayNewOrderLink')}</a></p>}
    {unpaid && <TransferDeclaration orderId={orderId} token={token!} declaredAt={tx.transfer_declared_at} />}
  </main>;
}
