/** Public order instructions, scoped by the signed link. @see lib/orders/transfer-token.ts */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import { verifyTransferToken } from '@/lib/orders/transfer-token';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Metadata } from 'next';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function TransferPage({ params, searchParams }: { params: Promise<{ orderId: string; locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { orderId, locale } = await params, { token } = await searchParams;
  if (!z.uuid().safeParse(orderId).success || !verifyTransferToken(token, orderId) || !await checkRateLimit('transfer_instructions', 60, 1)) notFound();
  const { data: tx } = await createAdminClient().from('payment_transactions').select('amount,currency,order_number,payment_due_at,transfer_details,status').eq('id', orderId).eq('payment_provider', 'bank_transfer').single();
  if (!tx) notFound();
  const t = await getTranslations({ locale, namespace: 'bankTransfer' });
  return <main className="max-w-2xl mx-auto p-6 my-10"><h1 className="text-2xl font-semibold">{t('thanks', { number: tx.order_number ?? '' })}</h1>
    <p className="mt-3">{t(`status_${tx.status}`)}</p>
    <TransferInstructions transfer={tx.transfer_details} amount={tx.amount} currency={tx.currency} dueAt={tx.payment_due_at} print />
  </main>;
}
