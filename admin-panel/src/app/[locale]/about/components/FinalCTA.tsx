import { getTranslations } from 'next-intl/server';
import { ArrowRight, Clock, Code, Scale } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import { GithubIcon } from '@/components/ui/GithubIcon';

export async function FinalCTA() {
  const t = await getTranslations('landing');

  return (
    <section className="relative py-28 md:py-36 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse at 30% 30%, var(--sf-accent-glow) 0%, transparent 50%)',
            'radial-gradient(ellipse at 70% 70%, rgba(0,170,255,0.12) 0%, transparent 50%)',
            'var(--sf-bg-base)',
          ].join(', '),
        }}
      />

      <Reveal className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center" animation="scale">
        <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-6">
          {t('finalCta.title')}
        </h2>
        <p className="text-xl text-sf-body mb-10 max-w-2xl mx-auto">
          {t('finalCta.subtitle')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#deployment"
            className="inline-flex items-center px-8 py-4 rounded-full text-lg font-bold text-white bg-sf-accent-bg hover:bg-sf-accent-hover shadow-[var(--sf-shadow-accent)] hover:shadow-[0_6px_40px_-4px_var(--sf-accent-glow)] transition-[background-color,box-shadow] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent gap-3"
          >
            {t('finalCta.ctaDeploy')}
            <ArrowRight className="h-5 w-5" />
          </a>

          <a
            href="https://github.com/jurczykpawel/sellf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-8 py-4 rounded-full text-lg font-bold text-sf-heading border-2 border-sf-border hover:border-sf-border-accent bg-sf-raised/80 transition-[border-color,background-color] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent gap-3"
          >
            <GithubIcon className="h-5 w-5" />
            {t('finalCta.ctaGithub')}
          </a>

        </div>

        <div className="flex flex-wrap justify-center items-center gap-8 mt-10 text-sm text-sf-muted">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>{t('finalCta.trust10min')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4" />
            <span>{t('finalCta.trustSourceCode')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            <span>{t('finalCta.trustMIT')}</span>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
