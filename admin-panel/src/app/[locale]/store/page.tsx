/** /store remains a catalogue entry in demo mode. @see PublicStorefrontPage.tsx */
import { storefrontMetadata } from '@/lib/storefront-templates/public-page';
import type { Metadata } from 'next';
import PublicStorefrontPage from '@/components/storefront/PublicStorefrontPage';
import type { StorefrontSearchParams } from '@/lib/storefront-templates/public-page';

export default async function StorePage({ params, searchParams }: {
  params: Promise<{ locale: 'en' | 'pl' }>; searchParams: Promise<StorefrontSearchParams>;
}) {
  const { locale } = await params;
  return <PublicStorefrontPage locale={locale} searchParams={await searchParams} />;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: 'en' | 'pl' }> }): Promise<Metadata> {
  return storefrontMetadata((await params).locale, 'store');
}
