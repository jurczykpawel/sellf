'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';

export function FAQSection() {
  const t = useTranslations('landing');
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const items = t.raw('faq.items') as { q: string; a: string }[];

  function handleToggle(index: number) {
    setOpenIndex(openIndex === index ? null : index);
  }

  return (
    <section className="py-24 md:py-32 bg-white dark:bg-gray-950">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-12 text-center">
          {t('faq.title')}
        </h2>

        <div>
          {items.map((item, i) => (
            <div
              key={i}
              className="border-b border-gray-200 dark:border-gray-800"
            >
              <button
                type="button"
                onClick={() => handleToggle(i)}
                className="w-full flex justify-between items-center py-5 text-left"
              >
                <span className="text-lg font-semibold text-gray-900 dark:text-white pr-8">
                  {item.q}
                </span>
                <ChevronDown
                  className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-300 ${
                    openIndex === i ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  openIndex === i ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <p className="pb-5 text-gray-600 dark:text-gray-400 leading-relaxed">
                  {item.a}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
