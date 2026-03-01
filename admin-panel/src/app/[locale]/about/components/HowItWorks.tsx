import { getTranslations } from 'next-intl/server';
import { Rocket, Link2, ShoppingBag } from 'lucide-react';
import { Reveal } from './motion/Reveal';

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
    <section className="py-24 md:py-32 bg-gf-base">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <p className="text-sm font-medium text-gf-muted tracking-[0.08em] uppercase mb-3">
            {t('howItWorks.categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-gf-heading mb-4">
            {t('howItWorks.title')}
          </h2>
          <p className="text-xl text-gf-body max-w-3xl mx-auto">
            {t('howItWorks.subtitle')}
          </p>
        </Reveal>

        {/* Vertical timeline */}
        <div className="relative">
          {/* Center line — desktop */}
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-gf-border-accent -translate-x-px" />
          {/* Left line — mobile */}
          <div className="md:hidden absolute left-6 top-0 bottom-0 w-px bg-gf-border-accent" />

          <div className="space-y-12 md:space-y-16">
            {steps.map((step, i) => {
              const Icon = step.icon;
              const isLeft = i % 2 === 0;

              return (
                <Reveal
                  key={step.key}
                  animation={isLeft ? 'fade-left' : 'fade-right'}
                  delay={i * 150}
                >
                  <div className="relative flex items-start gap-6 md:gap-0">
                    {/* Mobile node */}
                    <div className="md:hidden relative z-10 flex-shrink-0">
                      <div className="w-12 h-12 rounded-full bg-gf-accent-bg flex items-center justify-center shadow-[var(--gf-shadow-accent)]">
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                    </div>

                    {/* Mobile content */}
                    <div className="md:hidden flex-1">
                      <div className="text-xs font-bold text-gf-accent mb-1 tracking-wider">{step.number}</div>
                      <h3 className="text-xl font-bold text-gf-heading mb-2">
                        {t(`howItWorks.${step.key}.title`)}
                      </h3>
                      <p className="text-gf-body leading-relaxed">
                        {t(`howItWorks.${step.key}.desc`)}
                      </p>
                    </div>

                    {/* Desktop left area */}
                    <div className="hidden md:flex md:w-[calc(50%-2rem)] md:justify-end">
                      {isLeft ? (
                        <div className="text-right max-w-sm">
                          <div className="text-xs font-bold text-gf-accent mb-1 tracking-wider">{step.number}</div>
                          <h3 className="text-xl font-bold text-gf-heading mb-2">
                            {t(`howItWorks.${step.key}.title`)}
                          </h3>
                          <p className="text-gf-body leading-relaxed">
                            {t(`howItWorks.${step.key}.desc`)}
                          </p>
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>

                    {/* Desktop center node */}
                    <div className="hidden md:flex md:w-16 md:justify-center relative z-10 flex-shrink-0">
                      <div className="w-12 h-12 rounded-full bg-gf-accent-bg flex items-center justify-center shadow-[var(--gf-shadow-accent)]">
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                    </div>

                    {/* Desktop right area */}
                    <div className="hidden md:flex md:w-[calc(50%-2rem)]">
                      {!isLeft ? (
                        <div className="max-w-sm">
                          <div className="text-xs font-bold text-gf-accent mb-1 tracking-wider">{step.number}</div>
                          <h3 className="text-xl font-bold text-gf-heading mb-2">
                            {t(`howItWorks.${step.key}.title`)}
                          </h3>
                          <p className="text-gf-body leading-relaxed">
                            {t(`howItWorks.${step.key}.desc`)}
                          </p>
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
