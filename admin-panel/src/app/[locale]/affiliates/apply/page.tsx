/** Verified account application. @see lib/affiliates/admin/actions.ts */
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import DashboardLayout from '@/components/DashboardLayout';
import { AffiliateApplication } from '@/components/affiliates/admin/AffiliateAdmin';
import { getApplicationProgram } from '@/lib/affiliates/admin/actions';
import { portalMetadata } from '@/lib/affiliates/portal/service';
export const metadata = portalMetadata;
export const dynamic = 'force-dynamic';
export default async function Page() {
  const locale = await getLocale() === 'pl' ? 'pl' : 'en'; const t = await getTranslations('affiliates'); const result = await getApplicationProgram();
  const { data: { user } } = await (await createClient()).auth.getUser();
  return <DashboardLayout user={user ? { id: user.id, email: user.email } : null}>{result.success && result.data ? <AffiliateApplication program={result.data} locale={locale} /> : <p role="alert">{t('unavailable')}</p>}</DashboardLayout>;
}
