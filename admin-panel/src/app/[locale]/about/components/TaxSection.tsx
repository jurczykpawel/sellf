import { getTranslations } from 'next-intl/server';
import { Building2, User, TrendingUp, AlertTriangle } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import { RevealGroup } from '@/components/motion/RevealGroup';

export async function TaxSection() {
  const t = await getTranslations('landing');

  return (
    <section className="py-24 md:py-32 bg-sf-deep" data-landing-section="tax">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('tax.categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('tax.title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">
            {t('tax.subtitle')}
          </p>
        </Reveal>

        {/* Comparison cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {/* MoR card */}
          <Reveal animation="fade-left">
            <div className="p-8 rounded-2xl border-2 border-sf-danger/30 bg-sf-danger-soft h-full">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-sf-danger-soft rounded-xl flex items-center justify-center border border-sf-danger/20">
                  <Building2 className="w-6 h-6 text-sf-danger" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-sf-danger">
                    {t('tax.morTitle')}
                  </h3>
                  <p className="text-sm text-sf-muted">{t('tax.morSubtitle')}</p>
                </div>
              </div>
              <ul className="space-y-4 mt-6">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-sf-danger-bg shrink-0" />
                  <span className="text-sf-body">
                    {t('tax.morPlatformFees')}: <span className="font-semibold text-sf-danger">{t('tax.morFeeAmount')}</span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-sf-danger-bg shrink-0" />
                  <span className="text-sf-danger font-medium">{t('tax.morDataOwnership')}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-sf-danger-bg shrink-0" />
                  <span className="text-sf-danger font-medium">{t('tax.morPlatformRisk')}</span>
                </li>
              </ul>
            </div>
          </Reveal>

          {/* Own Stripe card */}
          <Reveal animation="fade-right" delay={100}>
            <div className="p-8 rounded-2xl border-2 border-sf-success/40 bg-sf-success-soft ring-2 ring-sf-success/20 relative h-full">
              <div className="absolute -top-3 right-6">
                <span className="bg-sf-success text-sf-inverse text-xs font-bold px-3 py-1 rounded-full">
                  {t('tax.recommended')}
                </span>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-sf-success-soft rounded-xl flex items-center justify-center border border-sf-success/20">
                  <User className="w-6 h-6 text-sf-success" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-sf-success">
                    {t('tax.sellfTitle')}
                  </h3>
                  <p className="text-sm text-sf-muted">{t('tax.sellfSubtitle')}</p>
                </div>
              </div>
              <ul className="space-y-4 mt-6">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-sf-success shrink-0" />
                  <span className="text-sf-body">
                    {t('tax.sellfPlatformFees')}: <span className="font-semibold text-sf-success">{t('tax.sellfFeeAmount')}</span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-sf-success shrink-0" />
                  <span className="text-sf-body">
                    {t('tax.sellfStripeFees')}: <span className="font-semibold text-sf-success">{t('tax.sellfStripeAmount')}</span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-sf-success shrink-0" />
                  <span className="text-sf-success font-medium">{t('tax.sellfDataOwnership')}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-sf-success shrink-0" />
                  <span className="text-sf-success font-medium">{t('tax.sellfSelfHosted')}</span>
                </li>
              </ul>
            </div>
          </Reveal>
        </div>

        {/* Tax Growth Path */}
        <Reveal className="mb-8">
          <h3 className="text-2xl md:text-3xl font-bold text-sf-heading mb-8 text-center">
            {t('tax.taxGrowthTitle')}
          </h3>

          <RevealGroup className="grid grid-cols-1 md:grid-cols-3 gap-6" stagger={100}>
            <div className="p-6 rounded-2xl bg-sf-raised/80 border border-sf-border">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-sf-accent-soft rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-sf-accent">1</span>
                </div>
                <TrendingUp className="w-5 h-5 text-sf-accent" />
              </div>
              <h4 className="text-lg font-bold text-sf-heading mb-2">
                {t('tax.taxStep1Title')}
              </h4>
              <p className="text-sm text-sf-body leading-relaxed">
                {t('tax.taxStep1Desc')}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-sf-accent-soft border border-sf-border-accent">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-sf-accent-med rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-sf-accent">2</span>
                </div>
                <TrendingUp className="w-5 h-5 text-sf-accent" />
              </div>
              <h4 className="text-lg font-bold text-sf-heading mb-2">
                {t('tax.taxStep2Title')}
              </h4>
              <p className="text-sm text-sf-body leading-relaxed">
                {t('tax.taxStep2Desc')}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-sf-accent-med border-2 border-sf-border-accent">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-sf-accent/20 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-sf-accent">3</span>
                </div>
                <TrendingUp className="w-5 h-5 text-sf-accent" />
              </div>
              <h4 className="text-lg font-bold text-sf-heading mb-2">
                {t('tax.taxStep3Title')}
              </h4>
              <p className="text-sm text-sf-body leading-relaxed">
                {t('tax.taxStep3Desc')}
              </p>
            </div>
          </RevealGroup>
        </Reveal>

        {/* Disclaimer */}
        <Reveal animation="fade-up" delay={200}>
          <div className="flex items-start gap-3 p-4 rounded-xl bg-sf-warning-soft border border-sf-warning/20 mt-8">
            <AlertTriangle className="w-5 h-5 text-sf-warning shrink-0 mt-0.5" />
            <p className="text-sm text-sf-body">
              {t('tax.taxDisclaimer')}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
