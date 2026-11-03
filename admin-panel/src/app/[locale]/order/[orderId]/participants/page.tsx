/** Buyer page to add the participant list after payment, via the signed link or the owner's session. @see lib/orders/participants-access.ts */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import ParticipantsLaterForm from '@/components/checkout/ParticipantsLaterForm';
import { readOrderDetails } from '@/lib/checkout-modules/order-details';
import { canEditParticipants } from '@/lib/orders/participants-access';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Metadata } from 'next';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function ParticipantsPage({ params, searchParams }: { params: Promise<{ orderId: string; locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { orderId, locale } = await params, { token } = await searchParams;
  if (!z.uuid().safeParse(orderId).success || !await checkRateLimit('order_participants_page', 60, 1)) notFound();
  const { data: tx } = await createAdminClient().from('payment_transactions').select('id,user_id,status,order_number,order_details,products(name,checkout_profile)').eq('id', orderId).maybeSingle();
  if (!tx || !await canEditParticipants(orderId, token, tx.user_id)) notFound();
  const product = (Array.isArray(tx.products) ? tx.products[0] : tx.products) as { name: string; checkout_profile: { modules?: Array<{ id: string; allow_later?: boolean }> } | null } | null;
  if (!product?.checkout_profile?.modules?.some(module => module.id === 'participants' && module.allow_later)) notFound();
  const details = readOrderDetails(tx.order_details), quantity = details.quantity?.value ?? 1, people = details.participants?.people ?? [];
  const t = await getTranslations({ locale, namespace: 'participantsLater' });
  return <main className="mx-auto my-10 max-w-3xl p-6">
    <h1 className="text-2xl font-semibold">{t('title', { number: tx.order_number ?? '' })}</h1>
    <p className="mt-2 text-sf-muted">{product.name} · {t('quantity', { count: quantity })}</p>
    {people.length > 0 ? <>
      <p role="status" className="mt-4 rounded-xl border border-sf-border p-4">{t('alreadyComplete')}</p>
      <ul className="mt-4 space-y-1">{people.map((person, index) => <li key={index}>{person.first_name} {person.last_name} · {person.email}</li>)}</ul>
    </> : tx.status !== 'completed' ? <p className="mt-4">{t('notPaid')}</p> : <>
      <p className="mt-4">{t('intro')}</p>
      <div className="mt-6"><ParticipantsLaterForm orderId={orderId} token={token} quantity={quantity} /></div>
    </>}
  </main>;
}
