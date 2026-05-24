import { getTranslations } from 'next-intl/server';
import { GraduationCap, Package, Gift, Repeat } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';

import type { LucideIcon } from 'lucide-react';

interface UseCase {
  icon: LucideIcon;
  key: string;
}

const useCases: UseCase[] = [
  { icon: GraduationCap, key: 'courses' },
  { icon: Repeat, key: 'subscriptions' },
  { icon: Package, key: 'digital' },
  { icon: Gift, key: 'leads' },
];

export async function UseCases() {
  const t = await getTranslations('landing');

  return (
    <section className="py-24 md:py-32 bg-sf-base" data-landing-section="use-cases">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('useCases.categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('useCases.title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">
            {t('useCases.subtitle')}
          </p>
        </Reveal>

        {/* Zigzag alternating layout */}
        <div className="space-y-16 md:space-y-20">
          {useCases.map((useCase, i) => {
            const Icon = useCase.icon;
            const isReversed = i % 2 !== 0;

            return (
              <Reveal
                key={useCase.key}
                animation={isReversed ? 'fade-right' : 'fade-left'}
                delay={100}
              >
                <div className={`flex flex-col md:flex-row ${isReversed ? 'md:flex-row-reverse' : ''} items-center gap-8 md:gap-12`}>
                  <div className={`flex-shrink-0 ${isReversed ? 'md:text-right' : ''}`}>
                    <div className={`w-16 h-16 bg-sf-accent-soft rounded-2xl flex items-center justify-center mb-4 ${isReversed ? 'md:ml-auto' : ''}`}>
                      <Icon className="w-8 h-8 text-sf-accent" />
                    </div>
                    <h3 className="text-2xl font-bold text-sf-heading">
                      {t(`useCases.${useCase.key}.title`)}
                    </h3>
                  </div>

                  <div className="flex-1">
                    <p className="text-sf-body mb-5 leading-relaxed text-lg">
                      {t(`useCases.${useCase.key}.desc`)}
                    </p>
                    <ul className="space-y-2">
                      {(['feature1', 'feature2', 'feature3'] as const).map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm text-sf-body">
                          <span className="w-1.5 h-1.5 rounded-full bg-sf-accent-bg shrink-0" />
                          {t(`useCases.${useCase.key}.${feature}`)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
