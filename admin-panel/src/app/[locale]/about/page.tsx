import { getTranslations } from 'next-intl/server';
import { LandingNav } from './components/LandingNav';
import { HeroSection } from './components/HeroSection';
import { SocialProofBar } from './components/SocialProofBar';
import { FeeComparisonSection } from './components/FeeComparisonSection';
import { FeatureGrid } from './components/FeatureGrid';
import { ConversionStack } from './components/ConversionStack';
import { LoginWallDemo } from './components/LoginWallDemo';
import { SubscriptionsDemo } from './components/SubscriptionsDemo';
import { UseCases } from './components/UseCases';
import { TaxSection } from './components/TaxSection';
import { HowItWorks } from './components/HowItWorks';
import { SelfHostedComparison } from './components/SelfHostedComparison';
import { TechStackGrid } from './components/TechStackGrid';
import { LicenseTier } from './components/LicenseTier';
import { ObjectionsBlock } from './components/ObjectionsBlock';
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
        {/* Hook + proof — first 3 scrolls answer "kto + co + ile zostaje" */}
        <HeroSection />
        <SocialProofBar />
        <UseCases />
        <FeeComparisonSection />
        {/* Fast onboarding promise + flagship sales demo + pricing — answer
            "ile to kosztuje?" before piling on feature dump */}
        <HowItWorks />
        <ConversionStack />
        <LicenseTier />
        {/* Feature dump + deep demos for buyers who want details */}
        <FeatureGrid />
        <LoginWallDemo />
        <SubscriptionsDemo />
        <div className="section-divider" />
        {/* Strategic background — tax growth path, self-host details, stack */}
        <TaxSection />
        <SelfHostedComparison />
        <TechStackGrid />
        <div className="section-divider" />
        {/* Close objections + final CTA */}
        <ObjectionsBlock />
        <FAQSection />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
