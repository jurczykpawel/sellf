import { getTranslations } from 'next-intl/server';
import { Reveal } from '@/components/motion/Reveal';
import { RevealGroup } from '@/components/motion/RevealGroup';
import { MessageCircleQuestion } from 'lucide-react';

interface ObjectionItem {
  title: string;
  body: string;
}

export async function ObjectionsBlock() {
  const t = await getTranslations('landing.objections');
  // Items live as an array in i18n; raw() pulls the typed list.
  const items = t.raw('items') as ObjectionItem[];

  return (
    <section
      data-landing-section="objections"
      className="py-24 md:py-32 bg-sf-base"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-12">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-sf-body max-w-3xl mx-auto">
            {t('subtitle')}
          </p>
        </Reveal>

        <RevealGroup
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
          stagger={80}
        >
          {items.map((item, i) => (
            <div
              key={i}
              data-objection-idx={i}
              className="rounded-2xl border border-sf-border-accent bg-sf-raised/60 p-6 flex flex-col gap-3 hover:border-sf-accent transition-colors"
            >
              <MessageCircleQuestion
                className="h-5 w-5 text-sf-accent"
                aria-hidden="true"
              />
              <h3 className="text-lg font-bold text-sf-heading">
                {item.title}
              </h3>
              <p className="text-sf-body text-sm leading-relaxed">
                {item.body}
              </p>
            </div>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
