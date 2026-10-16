/** Affiliate administration navigation. @see lib/affiliates/admin/actions.ts */
import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';
import { portalMetadata } from '@/lib/affiliates/portal/service';
import type { ReactNode } from 'react';
export const metadata = portalMetadata;
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: ReactNode }) {
  const t = await getTranslations('affiliates'); const locale = await getLocale();
  return <div className="mx-auto max-w-6xl min-w-0 space-y-6"><nav aria-label={t('navigation')} className="flex flex-wrap gap-3 text-sm">
    {[['', 'partners'], ['/earnings', 'earnings'], ['/payouts', 'payoutsLabel']].map(([path, label]) => <Link className="rounded-lg border border-sf-border px-3 py-2 hover:bg-sf-hover focus-visible:outline-2" key={path} href={`/${locale}/dashboard/affiliates${path}`}>{t(label)}</Link>)}
  </nav>{children}</div>;
}
