import { getTranslations, getLocale } from 'next-intl/server';
import { BarChart3, CreditCard, Layers, Tag, Zap, Gift, Package, ShieldCheck, Clock, TrendingUp, RotateCcw, FileText } from 'lucide-react';
import { Reveal } from './motion/Reveal';
import { RevealGroup } from './motion/RevealGroup';

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
  { icon: FileText, key: 'gus', localeOnly: 'pl' },
];

export async function FeatureGrid() {
  const t = await getTranslations('landing');
  const locale = await getLocale();

  const visibleFeatures = features.filter(f => !f.localeOnly || f.localeOnly === locale);
  const heroFeatures = visibleFeatures.slice(0, 2);
  const restFeatures = visibleFeatures.slice(2);

  return (
    <section className="py-24 md:py-32 bg-gf-deep">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gf-heading mb-4">
            {t('features.title')}
          </h2>
          <p className="text-xl text-gf-body max-w-3xl mx-auto">
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
                <div className="group p-8 rounded-2xl bg-gf-raised/80 border-2 border-gf-border-accent hover:shadow-[var(--gf-shadow-accent)] transition-[box-shadow] duration-300 h-full">
                  <div className="w-14 h-14 bg-gf-accent-med rounded-xl flex items-center justify-center mb-5 group-hover:bg-gf-accent/30 transition-colors duration-300">
                    <Icon className="w-7 h-7 text-gf-accent" />
                  </div>
                  <h3 className="text-xl font-bold text-gf-heading mb-3">
                    {t(`features.${feature.key}.title`)}
                  </h3>
                  <p className="text-gf-body leading-relaxed">
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
                className="group p-6 rounded-2xl bg-gf-raised/80 border border-gf-border hover:border-gf-border-accent transition-[border-color,box-shadow] duration-300 hover:shadow-[var(--gf-shadow-accent)]"
              >
                <div className="w-12 h-12 bg-gf-accent-soft rounded-xl flex items-center justify-center mb-4 group-hover:bg-gf-accent-med transition-colors duration-300">
                  <Icon className="w-6 h-6 text-gf-accent" />
                </div>
                <h3 className="text-lg font-bold text-gf-heading mb-2">
                  {t(`features.${feature.key}.title`)}
                </h3>
                <p className="text-sm text-gf-body leading-relaxed">
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
