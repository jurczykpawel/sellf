'use client';
/** Browser download adapter. @see app/api/affiliates/payouts/[id]/csv/route.ts */
import PayoutPanel from '@/components/affiliates/payouts/PayoutPanel';
export default function PayoutScreen({ locale }: { locale: 'en' | 'pl' }) {
  return <PayoutPanel locale={locale} download={(id, version) => { const link = document.createElement('a'); link.href = `/api/affiliates/payouts/${encodeURIComponent(id)}/csv?version=${encodeURIComponent(version)}`; link.download = 'sellf-affiliate-payout.csv'; document.body.appendChild(link); link.click(); link.remove(); }} />;
}
