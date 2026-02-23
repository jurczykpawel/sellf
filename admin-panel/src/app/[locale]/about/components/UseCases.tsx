import { getTranslations } from 'next-intl/server';
import { GraduationCap, Package, Gift } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

interface UseCase {
  icon: LucideIcon;
  key: string;
}

const useCases: UseCase[] = [
  { icon: GraduationCap, key: 'courses' },
  { icon: Package, key: 'digital' },
  { icon: Gift, key: 'leads' },
];

export async function UseCases() {
  const t = await getTranslations('landing');

  return (
    <section className="py-24 md:py-32 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            {t('useCases.title')}
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            {t('useCases.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {useCases.map((useCase) => {
            const Icon = useCase.icon;
            return (
              <div
                key={useCase.key}
                className="p-8 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg transition-all duration-300"
              >
                <div className="w-14 h-14 bg-[#00AAFF]/10 dark:bg-[#00AAFF]/20 rounded-2xl flex items-center justify-center mb-6">
                  <Icon className="w-7 h-7 text-[#00AAFF]" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                  {t(`useCases.${useCase.key}.title`)}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
                  {t(`useCases.${useCase.key}.desc`)}
                </p>
                <ul className="space-y-2">
                  {(['feature1', 'feature2', 'feature3'] as const).map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00AAFF] shrink-0" />
                      {t(`useCases.${useCase.key}.${feature}`)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
