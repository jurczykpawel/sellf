/** Selected partner earnings. @see lib/affiliates/portal/service.ts */
import { getLocale } from 'next-intl/server';
import AffiliatePortal, { AffiliatePortalError } from '@/components/affiliates/portal/AffiliatePortal';
import PartnerSelection from '@/components/affiliates/PartnerSelection';
import { readAdminPortal } from '@/lib/affiliates/portal/service';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const locale = await getLocale() === 'pl' ? 'pl' : 'en'; const { member, cursor, currency } = await searchParams;
  const result = member ? await readAdminPortal(member, { ...(cursor ? { cursor } : {}), ...(currency ? { currency } : {}) }) : null;
  return <><PartnerSelection member={member} locale={locale} />{result && (result.success ? <AffiliatePortal data={result.data} locale={locale} currency={currency} memberId={member} /> : <AffiliatePortalError error={result.error} locale={locale} />)}</>;
}
