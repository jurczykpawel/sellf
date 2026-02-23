import { getTranslations } from 'next-intl/server';
import { Rocket, Link2, ShoppingBag } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

interface Step {
  icon: LucideIcon;
  key: string;
  number: string;
}

const steps: Step[] = [
  { icon: Rocket, key: 'step1', number: '01' },
  { icon: Link2, key: 'step2', number: '02' },
  { icon: ShoppingBag, key: 'step3', number: '03' },
];

export async function HowItWorks() {
  const t = await getTranslations('landing');

  return (
    <section className="py-24 md:py-32 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            {t('howItWorks.title')}
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            {t('howItWorks.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.key} className="text-center">
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#00AAFF] flex items-center justify-center">
                  <Icon className="w-8 h-8 text-white" />
                </div>
                <div className="text-sm font-bold text-[#00AAFF] mb-2">
                  {step.number}
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                  {t(`howItWorks.${step.key}.title`)}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  {t(`howItWorks.${step.key}.desc`)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
