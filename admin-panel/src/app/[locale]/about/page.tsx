import { getTranslations } from 'next-intl/server';
import { LandingNav } from './components/LandingNav';
import { HeroSection } from './components/HeroSection';
import { SocialProofBar } from './components/SocialProofBar';
import { FeeComparisonSection } from './components/FeeComparisonSection';
import { FeatureGrid } from './components/FeatureGrid';
import { EmbedCheckoutDemo } from './components/EmbedCheckoutDemo';
import { UseCases } from './components/UseCases';
import { TaxSection } from './components/TaxSection';
import { HowItWorks } from './components/HowItWorks';
import { SelfHostedComparison } from './components/SelfHostedComparison';
import { TechStackGrid } from './components/TechStackGrid';
import { LicenseTier } from './components/LicenseTier';
import { FAQSection } from './components/FAQSection';
import { FinalCTA } from './components/FinalCTA';
import { LandingFooter } from './components/LandingFooter';
import { buildLandingJsonLd } from './jsonld';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sellf.app';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  const title = `Sellf — ${t('hero.headlineTop')} ${t('hero.headlineBottom')}`;
  const description = t('hero.metaDescription');
  const ogImage = `${SITE_URL}/api/og/about?locale=${locale}`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/${locale}/about` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/${locale}/about`,
      locale,
      type: 'website',
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
    robots: { index: true, follow: true },
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const jsonLd = buildLandingJsonLd(locale);

  return (
    <div className="grain-overlay min-h-screen bg-sf-deep overflow-hidden">
      {/* JSON-LD payload built from server constants + locale; safe innerHTML. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-sf-accent-bg focus:text-white focus:outline-none"
      >
        Skip to main content
      </a>
      <LandingNav />
      <main id="main-content">
        <HeroSection />
        <SocialProofBar />
        <FeeComparisonSection />
        <FeatureGrid />
        <EmbedCheckoutDemo />
        <UseCases />
        <TaxSection />
        <div className="section-divider" />
        <HowItWorks />
        <SelfHostedComparison />
        <TechStackGrid />
        <LicenseTier />
        <div className="section-divider" />
        <FAQSection />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
