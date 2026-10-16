/** Authenticated render document; the evidence adapter removes the Next application shell. @see preview-render.tsx */
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextRequest } from 'next/server';
import { preparePreview } from '@/lib/storefront-templates/preview';
import { verifyTemplateApiKey, verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import PublicThemeShell from '@/components/storefront/PublicThemeShell';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function PreviewDocument({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const incoming = await headers();
  if (incoming.get('x-sellf-preview-document') !== '1') notFound();
  const auth = incoming.has('authorization') || incoming.has('x-api-key')
    ? await verifyTemplateApiKey(new NextRequest('http://localhost/', { headers: incoming }))
    : await verifyTemplateSession();
  const query = await searchParams;
  const response = await preparePreview(auth, { revision: typeof query.revision === 'string' && /^(0|[1-9][0-9]*)$/.test(query.revision) ? Number(query.revision) : -1, locale: (await params).locale, fixture: query.fixture }, 'storefront_preview_document');
  if (!response.success && response.code === 'FORBIDDEN') notFound();
  if (!response.success) return <main data-preview-failure={response.code} />;
  const { model, tokens } = response.data;
  return <div inert><PublicThemeShell tokens={tokens}><StorefrontComposition model={model} shopName={model.locale === 'pl' ? 'Podgląd sklepu' : 'Store preview'} renderKey="preview" /></PublicThemeShell></div>;
}
