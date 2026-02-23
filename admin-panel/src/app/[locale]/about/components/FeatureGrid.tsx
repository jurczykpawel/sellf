import { getTranslations, getLocale } from 'next-intl/server';
import { BarChart3, CreditCard, Layers, Tag, Zap, Gift, Package, ShieldCheck, Clock, TrendingUp, RotateCcw, FileText } from 'lucide-react';

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

  return (
    <section className="py-24 md:py-32 bg-white dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            {t('features.title')}
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            {t('features.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {visibleFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.key}
                className="group p-6 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 hover:border-[#00AAFF]/50 hover:shadow-lg hover:shadow-sky-500/5 transition-all duration-300 hover:scale-[1.02]"
              >
                <div className="w-12 h-12 bg-[#00AAFF]/10 dark:bg-[#00AAFF]/20 rounded-xl flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-[#00AAFF]" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  {t(`features.${feature.key}.title`)}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {t(`features.${feature.key}.desc`)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
