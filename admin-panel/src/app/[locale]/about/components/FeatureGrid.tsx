import { getTranslations, getLocale } from 'next-intl/server';
import { BarChart3, CreditCard, Layers, Tag, Zap, Gift, Package, ShieldCheck, Clock, TrendingUp, RotateCcw, FileText, Lock } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import { RevealGroup } from '@/components/motion/RevealGroup';

import type { LucideIcon } from 'lucide-react';

interface Feature {
  icon: LucideIcon;
  key: string;
  localeOnly?: string;
}

const features: Feature[] = [
  { icon: BarChart3, key: 'dashboard' },
  { icon: CreditCard, key: 'payments' },
  { icon: Layers, key: 'orderBumps' },
  { icon: Tag, key: 'coupons' },
  { icon: Zap, key: 'webhooks' },
  { icon: Gift, key: 'leads' },
  { icon: Package, key: 'delivery' },
  { icon: ShieldCheck, key: 'omnibus' },
  { icon: Clock, key: 'saleLimits' },
  { icon: TrendingUp, key: 'funnels' },
  { icon: RotateCcw, key: 'refunds' },
  { icon: Lock, key: 'security' },
  { icon: FileText, key: 'gus', localeOnly: 'pl' },
];

export async function FeatureGrid() {
  const t = await getTranslations('landing');
  const locale = await getLocale();

  const visibleFeatures = features.filter(f => !f.localeOnly || f.localeOnly === locale);
  const heroFeatures = visibleFeatures.slice(0, 2);
  const restFeatures = visibleFeatures.slice(2);

  return (
    <section className="py-24 md:py-32 bg-sf-deep">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('features.categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('features.title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">
            {t('features.subtitle')}
          </p>
        </Reveal>

        {/* Hero cards — 2 large spanning cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {heroFeatures.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <Reveal
                key={feature.key}
                animation={i === 0 ? 'fade-left' : 'fade-right'}
                delay={i * 100}
              >
                <div className="group p-8 rounded-2xl bg-sf-raised/80 border-2 border-sf-border-accent hover:shadow-[var(--sf-shadow-accent)] transition-[box-shadow] duration-300 h-full">
                  <div className="w-14 h-14 bg-sf-accent-med rounded-xl flex items-center justify-center mb-5 group-hover:bg-sf-accent/30 transition-colors duration-300">
                    <Icon className="w-7 h-7 text-sf-accent" />
                  </div>
                  <h3 className="text-xl font-bold text-sf-heading mb-3">
                    {t(`features.${feature.key}.title`)}
                  </h3>
                  <p className="text-sf-body leading-relaxed">
                    {t(`features.${feature.key}.desc`)}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* Standard cards — staggered grid */}
        <RevealGroup className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" stagger={60}>
          {restFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.key}
                className="group p-6 rounded-2xl bg-sf-raised/80 border border-sf-border hover:border-sf-border-accent transition-[border-color,box-shadow] duration-300 hover:shadow-[var(--sf-shadow-accent)]"
              >
                <div className="w-12 h-12 bg-sf-accent-soft rounded-xl flex items-center justify-center mb-4 group-hover:bg-sf-accent-med transition-colors duration-300">
                  <Icon className="w-6 h-6 text-sf-accent" />
                </div>
                <h3 className="text-lg font-bold text-sf-heading mb-2">
                  {t(`features.${feature.key}.title`)}
                </h3>
                <p className="text-sm text-sf-body leading-relaxed">
                  {t(`features.${feature.key}.desc`)}
                </p>
              </div>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
