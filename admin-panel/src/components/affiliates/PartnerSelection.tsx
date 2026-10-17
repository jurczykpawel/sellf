'use client';
/** Named partner selection for the admin portal. @see lib/affiliates/payouts/reads.ts */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ProgramSetupNotice from '@/components/affiliates/ProgramSetupNotice';
import PayoutPicker from '@/components/affiliates/payouts/PayoutPicker';
import { getPayoutChoices } from '@/lib/affiliates/payouts/reads';
import type { PayoutChoices } from '@/lib/affiliates/payouts/contracts';
export default function PartnerSelection({ member, locale }: { member?: string; locale: 'en' | 'pl' }) {
  const t = useTranslations('affiliates'); const router = useRouter(); const pathname = usePathname();
  const [search, setSearch] = useState(''); const [choices, setChoices] = useState<PayoutChoices['members']>([]); const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [programConfigured, setProgramConfigured] = useState<boolean>();
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void getPayoutChoices({ search, ...(member ? { member_id: member } : {}) }).then(result => {
      if (active) { setLoading(false); setFailed(!result.success); if (result.data) { setChoices(result.data.members); setProgramConfigured(result.data.programConfigured); } }
    }).catch(() => { if (active) { setFailed(true); setLoading(false); } }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search, member]);
  if (!failed && programConfigured === false) return <ProgramSetupNotice locale={locale} />;
  return <section lang={locale} className="mb-6 space-y-5 rounded-xl border border-sf-border bg-sf-raised p-5 text-sf-heading">
    <header><h1 className="text-2xl font-semibold">{t('earningsTitle')}</h1><p className="mt-2 max-w-2xl text-sm text-sf-body">{t('earningsHint')}</p></header>
    <div className="max-w-md"><PayoutPicker label={t('partner')} emptyLabel={t('empty')} options={choices.map(c => ({ value: c.id, label: c.display_name }))} selectedValue={member ?? ''} onSearch={setSearch} onSelect={id => router.push(`${pathname}?member=${encodeURIComponent(id)}`)} /></div>{loading && <p role="status" className="text-sm text-sf-body">{t('loadingPartners')}</p>}{failed && <p role="alert">{t('unavailable')}</p>}
    {!member && !loading && !failed && <div className="space-y-2 rounded-lg border border-dashed border-sf-border p-5 text-sm text-sf-body"><p>{choices.length ? t('earningsSelect') : t('earningsEmpty')}</p><Link className="font-medium text-sf-accent underline" href={`${locale === 'pl' ? '/pl' : ''}/dashboard/affiliates`}>{t('manageApplications')}</Link></div>}
  </section>;
}
