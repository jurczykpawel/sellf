/** Private inert SSR preview outside the locale/session application layout. */
import { notFound } from 'next/navigation';
import { preparePreview } from '@/lib/storefront-templates/preview';
import { verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import PublicThemeShell from '@/components/storefront/PublicThemeShell';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function TemplatePreview({ params, searchParams }: {
  params: Promise<{ revision: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await verifyTemplateSession();
  const query = await searchParams;
  const { revision } = await params;
  const locale = query.locale === 'pl' ? 'pl' : 'en';
  const response = await preparePreview(auth, {
    revision: /^(0|[1-9][0-9]*)$/.test(revision) ? Number(revision) : -1,
    locale: query.locale, fixture: query.fixture,
  }, typeof query.issuedAt === 'string' && /^\d+$/.test(query.issuedAt) ? Number(query.issuedAt) : NaN);
  if (!response.success && response.code === 'FORBIDDEN') notFound();
  if (!response.success) {
    const t = (locale === 'pl' ? pl : en).templatePreview;
    return <main style={{ maxWidth: '40rem', margin: '10vh auto', padding: 24 }}>
      <h1>{t.previewUnavailable}</h1><p>{t.previewRetry}</p>
      <details><summary>{t.technical}</summary><p>{response.code}</p></details>
    </main>;
  }
  const { model, tokens } = response.data;
  return <div inert data-preview-inert><PublicThemeShell tokens={tokens}>
    <StorefrontComposition model={model} shopName={locale === 'pl' ? 'Podgląd sklepu' : 'Store preview'} renderKey="preview" />
  </PublicThemeShell></div>;
}
