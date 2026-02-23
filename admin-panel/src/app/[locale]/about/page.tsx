import { getTranslations } from 'next-intl/server';
import { LandingNav } from './components/LandingNav';
import { HeroSection } from './components/HeroSection';
import { SocialProofBar } from './components/SocialProofBar';
import { FeeComparisonSection } from './components/FeeComparisonSection';
import { FeatureGrid } from './components/FeatureGrid';
import { HowItWorks } from './components/HowItWorks';
import { TaxSection } from './components/TaxSection';
import { SelfHostedComparison } from './components/SelfHostedComparison';
import { TechStackGrid } from './components/TechStackGrid';
import { UseCases } from './components/UseCases';
import { FAQSection } from './components/FAQSection';
import { FinalCTA } from './components/FinalCTA';
import { LandingFooter } from './components/LandingFooter';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  return {
    title: `GateFlow — ${t('hero.headlineTop')} ${t('hero.headlineBottom')}`,
    description: t('hero.metaDescription'),
  };
}

export default function AboutPage() {
  return (
    <div className="grain-overlay min-h-screen bg-gf-deep overflow-hidden">
      {/* Skip to main content — a11y */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-gf-accent focus:text-white focus:outline-none"
      >
        Skip to main content
      </a>
      <LandingNav />
      <main id="main-content">
        <HeroSection />
        <SocialProofBar />
        <FeeComparisonSection />
        <div className="section-divider" />
        <FeatureGrid />
        <HowItWorks />
        <div className="section-divider" />
        <TaxSection />
        <SelfHostedComparison />
        <TechStackGrid />
        <div className="section-divider" />
        <UseCases />
        <FAQSection />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
