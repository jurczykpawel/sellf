'use client';
/** Named partner selection for the admin portal. @see lib/affiliates/payouts/reads.ts */
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PayoutPicker from '@/components/affiliates/payouts/PayoutPicker';
import { getPayoutChoices } from '@/lib/affiliates/payouts/reads';
import type { PayoutChoices } from '@/lib/affiliates/payouts/contracts';
export default function PartnerSelection({ member, locale }: { member?: string; locale: 'en' | 'pl' }) {
  const t = useTranslations('affiliates'); const router = useRouter(); const pathname = usePathname();
  const [search, setSearch] = useState(''); const [choices, setChoices] = useState<PayoutChoices['members']>([]); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void getPayoutChoices({ search, ...(member ? { member_id: member } : {}) }).then(result => {
      if (active) { setFailed(!result.success); if (result.data) setChoices(result.data.members); }
    }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search, member]);
  return <div lang={locale} className="max-w-md mb-6"><PayoutPicker label={t('partner')} emptyLabel={t('empty')} options={choices.map(c => ({ value: c.id, label: c.display_name }))} selectedValue={member ?? ''} onSearch={setSearch} onSelect={id => router.push(`${pathname}?member=${encodeURIComponent(id)}`)} />{failed && <p role="alert">{t('unavailable')}</p>}</div>;
}
