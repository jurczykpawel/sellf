/** Own earnings portal. @see lib/affiliates/portal/service.ts */
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import DashboardLayout from '@/components/DashboardLayout';
import AffiliatePortal, { AffiliatePortalError } from '@/components/affiliates/portal/AffiliatePortal';
import { readPartnerPortal, portalMetadata } from '@/lib/affiliates/portal/service';
export const metadata = portalMetadata;
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const locale = await getLocale() === 'pl' ? 'pl' : 'en'; const { cursor, currency } = await searchParams; const t = await getTranslations('affiliates');
  const result = await readPartnerPortal({ ...(cursor ? { cursor } : {}), ...(currency ? { currency } : {}) });
  const { data: { user } } = await (await createClient()).auth.getUser();
  return <DashboardLayout user={user ? { id: user.id, email: user.email } : null}>{result.success ? <AffiliatePortal data={result.data} locale={locale} currency={currency} /> : <div className="space-y-4"><AffiliatePortalError error={result.error} locale={locale} />{result.error === 'not_found' && <Link href={`/${locale}/affiliates/apply`} className="inline-block rounded-lg border border-sf-border px-4 py-2">{t('apply')}</Link>}</div>}</DashboardLayout>;
}
