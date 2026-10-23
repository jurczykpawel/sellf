import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { getOverdueTransferCount } from '@/lib/orders/bank-transfer-actions';
import DashboardContent from '@/components/dashboard/DashboardContent';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();
  
  // Fetch failed webhooks count server-side for initial render
  let failedCount = 0;
  try {
    const { count } = await supabase
      .from('webhook_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed');
    failedCount = count || 0;
  } catch (err) {
    console.error('Failed to fetch webhook failures count', err);
  }

  const overdue = await getOverdueTransferCount(), t = await getTranslations('bankTransfer');
  return <>{overdue.success && (overdue.data ?? 0) > 0 && <Link href={`${await getLocale() === 'pl' ? '/pl' : ''}/dashboard/payments`} className="block rounded-xl border border-sf-warning bg-sf-warning-soft p-4 mb-4">{t('overdueCount', { count: overdue.data ?? 0 })}</Link>}<DashboardContent failedWebhooksCount={failedCount} /></>;
}
