/** Program and membership administration. @see lib/affiliates/admin/actions.ts */
import { getLocale, getTranslations } from 'next-intl/server';
import { getAdminOverview } from '@/lib/affiliates/admin/actions';
import { AffiliateAdmin } from '@/components/affiliates/admin/AffiliateAdmin';
export default async function Page() {
  const locale = await getLocale() === 'pl' ? 'pl' : 'en';
  const result = await getAdminOverview(); const t = await getTranslations('affiliates');
  return result.success && result.data ? <AffiliateAdmin initial={result.data} locale={locale} /> : <p role="alert">{t('unavailable')}</p>;
}
