'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { Reveal } from './motion/Reveal';

export function FAQSection() {
  const t = useTranslations('landing');
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const items = t.raw('faq.items') as { q: string; a: string }[];

  function handleToggle(index: number) {
    setOpenIndex(openIndex === index ? null : index);
  }

  return (
    <section className="py-24 md:py-32 bg-gf-deep">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Split layout: sticky title left, accordion right */}
        <div className="flex flex-col md:flex-row md:gap-16">
          {/* Left column — title */}
          <Reveal animation="fade-left" className="md:w-1/3 mb-10 md:mb-0">
            <div className="md:sticky md:top-24">
              <h2 className="text-4xl md:text-5xl font-bold text-gf-heading mb-4">
                {t('faq.title')}
              </h2>
              <a
                href="https://github.com/jurczykpawel/gateflow/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-gf-accent hover:text-gf-accent-hover transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent rounded"
              >
                {t('faq.githubIssues')}
              </a>
            </div>
          </Reveal>

          {/* Right column — accordion */}
          <Reveal animation="fade-right" delay={100} className="md:w-2/3">
            <div>
              {items.map((item, i) => {
                const isOpen = openIndex === i;
                return (
                  <div key={i} className="border-b border-gf-border">
                    <button
                      type="button"
                      onClick={() => handleToggle(i)}
                      aria-expanded={isOpen}
                      aria-controls={`faq-answer-${i}`}
                      className="w-full flex justify-between items-center py-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent rounded"
                    >
                      <span className="text-lg font-semibold text-gf-heading pr-8">
                        {item.q}
                      </span>
                      <ChevronDown
                        className={`w-5 h-5 text-gf-muted transition-transform duration-300 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    <div
                      id={`faq-answer-${i}`}
                      role="region"
                      className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
                        isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <p className="pb-5 text-gf-body leading-relaxed">
                        {item.a}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
