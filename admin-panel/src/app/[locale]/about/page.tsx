import { getTranslations } from 'next-intl/server';
import { LandingNav } from './components/LandingNav';
import { HeroSection } from './components/HeroSection';
import { SocialProofBar } from './components/SocialProofBar';
import { FeeComparisonSection } from './components/FeeComparisonSection';
import { FeatureGrid } from './components/FeatureGrid';
import { HowItWorks } from './components/HowItWorks';
import { DemoSection } from './components/DemoSection';
import { TaxSection } from './components/TaxSection';
import { SelfHostedComparison } from './components/SelfHostedComparison';
import { TechStackGrid } from './components/TechStackGrid';
import { UseCases } from './components/UseCases';
import { DonateSection } from './components/DonateSection';
import { FAQSection } from './components/FAQSection';
import { FinalCTA } from './components/FinalCTA';
import { LandingFooter } from './components/LandingFooter';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  return {
    title: `GateFlow — ${t('hero.headlineTop')} ${t('hero.headlineBottom')}`,
    description: t('hero.subtitle'),
  };
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 overflow-hidden">
      <LandingNav />
      <HeroSection />
      <SocialProofBar />
      <FeeComparisonSection />
      <FeatureGrid />
      <HowItWorks />
      <DemoSection />
      <TaxSection />
      <SelfHostedComparison />
      <TechStackGrid />
      <UseCases />
      <DonateSection />
      <FAQSection />
      <FinalCTA />
      <LandingFooter />
    </div>
  );
}
