import { getTranslations } from 'next-intl/server';
import { Building2, User, TrendingUp, AlertTriangle } from 'lucide-react';
import { Reveal } from './motion/Reveal';
import { RevealGroup } from './motion/RevealGroup';

export async function TaxSection() {
  const t = await getTranslations('landing');

  return (
    <section className="py-24 md:py-32 bg-gf-deep">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gf-heading mb-4">
            {t('tax.title')}
          </h2>
          <p className="text-xl text-gf-body max-w-3xl mx-auto">
            {t('tax.subtitle')}
          </p>
        </Reveal>

        {/* Comparison cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {/* MoR card */}
          <Reveal animation="fade-left">
            <div className="p-8 rounded-2xl border-2 border-gf-danger/30 bg-gf-danger-soft h-full">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-gf-danger-soft rounded-xl flex items-center justify-center border border-gf-danger/20">
                  <Building2 className="w-6 h-6 text-gf-danger" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gf-danger">
                    {t('tax.morTitle')}
                  </h3>
                  <p className="text-sm text-gf-muted">{t('tax.morSubtitle')}</p>
                </div>
              </div>
              <ul className="space-y-4 mt-6">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-gf-danger shrink-0" />
                  <span className="text-gf-body">
                    {t('tax.morPlatformFees')}: <span className="font-semibold text-gf-danger">{t('tax.morFeeAmount')}</span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-gf-danger shrink-0" />
                  <span className="text-gf-danger font-medium">{t('tax.morDataOwnership')}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-gf-danger shrink-0" />
                  <span className="text-gf-danger font-medium">{t('tax.morPlatformRisk')}</span>
                </li>
              </ul>
            </div>
          </Reveal>

          {/* Own Stripe card */}
          <Reveal animation="fade-right" delay={100}>
            <div className="p-8 rounded-2xl border-2 border-gf-success/40 bg-gf-success-soft ring-2 ring-gf-success/20 relative h-full">
              <div className="absolute -top-3 right-6">
                <span className="bg-gf-success text-white text-xs font-bold px-3 py-1 rounded-full">
                  Recommended
                </span>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-gf-success-soft rounded-xl flex items-center justify-center border border-gf-success/20">
                  <User className="w-6 h-6 text-gf-success" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gf-success">
                    {t('tax.gateflowTitle')}
                  </h3>
                  <p className="text-sm text-gf-muted">{t('tax.gateflowSubtitle')}</p>
                </div>
              </div>
              <ul className="space-y-4 mt-6">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-gf-success shrink-0" />
                  <span className="text-gf-body">
                    {t('tax.gateflowPlatformFees')}: <span className="font-semibold text-gf-success">{t('tax.gateflowFeeAmount')}</span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-gf-success shrink-0" />
                  <span className="text-gf-body">
                    {t('tax.gateflowStripeFees')}: <span className="font-semibold text-gf-success">{t('tax.gateflowStripeAmount')}</span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-gf-success shrink-0" />
                  <span className="text-gf-success font-medium">{t('tax.gateflowDataOwnership')}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-gf-success shrink-0" />
                  <span className="text-gf-success font-medium">{t('tax.gateflowSelfHosted')}</span>
                </li>
              </ul>
            </div>
          </Reveal>
        </div>

        {/* Tax Growth Path */}
        <Reveal className="mb-8">
          <h3 className="text-2xl md:text-3xl font-bold text-gf-heading mb-8 text-center">
            {t('tax.taxGrowthTitle')}
          </h3>

          <RevealGroup className="grid grid-cols-1 md:grid-cols-3 gap-6" stagger={100}>
            <div className="p-6 rounded-2xl bg-gf-raised/80 border border-gf-border">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gf-accent-soft rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-gf-accent">1</span>
                </div>
                <TrendingUp className="w-5 h-5 text-gf-accent" />
              </div>
              <h4 className="text-lg font-bold text-gf-heading mb-2">
                {t('tax.taxStep1Title')}
              </h4>
              <p className="text-sm text-gf-body leading-relaxed">
                {t('tax.taxStep1Desc')}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-gf-accent-soft border border-gf-border-accent">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gf-accent-med rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-gf-accent">2</span>
                </div>
                <TrendingUp className="w-5 h-5 text-gf-accent" />
              </div>
              <h4 className="text-lg font-bold text-gf-heading mb-2">
                {t('tax.taxStep2Title')}
              </h4>
              <p className="text-sm text-gf-body leading-relaxed">
                {t('tax.taxStep2Desc')}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-gf-accent-med border-2 border-gf-border-accent">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gf-accent/20 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-gf-accent">3</span>
                </div>
                <TrendingUp className="w-5 h-5 text-gf-accent" />
              </div>
              <h4 className="text-lg font-bold text-gf-heading mb-2">
                {t('tax.taxStep3Title')}
              </h4>
              <p className="text-sm text-gf-body leading-relaxed">
                {t('tax.taxStep3Desc')}
              </p>
            </div>
          </RevealGroup>
        </Reveal>

        {/* Disclaimer */}
        <Reveal animation="fade-up" delay={200}>
          <div className="flex items-start gap-3 p-4 rounded-xl bg-gf-warning-soft border border-gf-warning/20 mt-8">
            <AlertTriangle className="w-5 h-5 text-gf-warning shrink-0 mt-0.5" />
            <p className="text-sm text-gf-body">
              {t('tax.taxDisclaimer')}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
