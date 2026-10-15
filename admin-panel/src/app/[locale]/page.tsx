/** Storefront homepage; demo retains its about-page entry. @see PublicStorefrontPage.tsx */
import { redirect } from 'next/navigation';
import { storefrontMetadata } from '@/lib/storefront-templates/public-page';
import type { Metadata } from 'next';
import PublicStorefrontPage from '@/components/storefront/PublicStorefrontPage';
import type { StorefrontSearchParams } from '@/lib/storefront-templates/public-page';

export default async function SmartLandingPage({ params, searchParams }: {
  params: Promise<{ locale: 'en' | 'pl' }>; searchParams: Promise<StorefrontSearchParams>;
}) {
  if (process.env.DEMO_MODE === 'true') redirect('/about');
  const { locale } = await params;
  return <PublicStorefrontPage locale={locale} searchParams={await searchParams} />;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: 'en' | 'pl' }> }): Promise<Metadata> {
  return storefrontMetadata((await params).locale, 'home');
}
