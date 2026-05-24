import { getTranslations } from 'next-intl/server';
import { Rocket, Shield, ArrowRight, Check, ExternalLink } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import { SELLF_GITHUB_URL } from '@/lib/constants';

export async function SelfHostedComparison() {
  const t = await getTranslations('landing');

  return (
    <section id="deployment" className="py-24 md:py-32 bg-sf-base" data-landing-section="self-hosted">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('selfHosted.categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('selfHosted.title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">
            {t('selfHosted.subtitle')}
          </p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Quick Start card */}
          <Reveal animation="fade-left">
            <div className="p-8 rounded-2xl bg-sf-raised/80 border border-sf-border shadow-[var(--sf-shadow)] h-full">
              <div className="w-14 h-14 bg-sf-accent-soft rounded-2xl flex items-center justify-center mb-6">
                <Rocket className="w-7 h-7 text-sf-accent" />
              </div>
              <h3 className="text-2xl font-bold text-sf-heading mb-1">
                {t('selfHosted.quickStart.title')}
              </h3>
              <p className="text-sm text-sf-muted mb-3">{t('selfHosted.quickStart.subtitle')}</p>
              <span className="inline-block bg-sf-float text-sf-body text-sm font-semibold px-3 py-1 rounded-full mb-6">
                {t('selfHosted.quickStart.price')}
              </span>
              <ul className="space-y-3">
                {(['pm2', 'ssl', 'supabase', 'ram'] as const).map((key) => (
                  <li key={key} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-sf-success shrink-0 mt-0.5" />
                    <span className="text-sf-body text-sm">{t(`selfHosted.quickStart.${key}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* Production card */}
          <Reveal animation="fade-right" delay={100}>
            <div className="p-8 rounded-2xl bg-sf-raised/80 border-2 border-sf-accent shadow-[var(--sf-shadow-accent)] ring-2 ring-sf-accent/20 relative h-full">
              <div className="absolute -top-3 right-6">
                <span className="bg-sf-accent-bg text-white text-xs font-bold px-3 py-1 rounded-full">
                  {t('selfHosted.production.badge')}
                </span>
              </div>
              <div className="w-14 h-14 bg-sf-accent-soft rounded-2xl flex items-center justify-center mb-6">
                <Shield className="w-7 h-7 text-sf-accent" />
              </div>
              <h3 className="text-2xl font-bold text-sf-heading mb-1">
                {t('selfHosted.production.title')}
              </h3>
              <p className="text-sm text-sf-muted mb-3">{t('selfHosted.production.subtitle')}</p>
              <span className="inline-block bg-sf-accent-soft text-sf-accent text-sm font-semibold px-3 py-1 rounded-full mb-6">
                {t('selfHosted.production.price')}
              </span>
              <ul className="space-y-3">
                {(['pm2', 'db', 'deploy', 'specs'] as const).map((key) => (
                  <li key={key} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-sf-success shrink-0 mt-0.5" />
                    <span className="text-sf-body text-sm">{t(`selfHosted.production.${key}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>

        {/* Demo prompt */}
        <Reveal className="text-center mt-12 space-y-2" animation="scale">
          <p className="text-lg font-semibold text-sf-heading">{t('selfHosted.demoPrompt')}</p>
          <p className="text-sm text-sf-body max-w-2xl mx-auto mb-6">{t('selfHosted.demoPromptSubtitle')}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-6">
            <a
              href="https://demo.sellf.app/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white shadow-[var(--sf-shadow-accent)] hover:shadow-[0_6px_40px_-4px_var(--sf-accent-glow)] rounded-full px-8 py-4 text-lg font-bold transition-[background-color,box-shadow] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
            >
              {t('selfHosted.demoCta')}
              <ExternalLink className="h-5 w-5" />
            </a>
            <a
              href={`${SELLF_GITHUB_URL}#deployment`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-sf-raised/80 border-2 border-sf-border hover:border-sf-border-accent text-sf-heading rounded-full px-8 py-4 text-lg font-bold transition-[border-color,background-color] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
            >
              {t('selfHosted.guideCta')}
              <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
