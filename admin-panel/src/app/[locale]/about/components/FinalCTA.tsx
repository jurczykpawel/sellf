import { getTranslations } from 'next-intl/server';
import { ArrowRight, Github, Clock, Code, Scale, Heart } from 'lucide-react';
import { Reveal } from './motion/Reveal';

export async function FinalCTA() {
  const t = await getTranslations('landing');

  return (
    <section className="relative py-28 md:py-36 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse at 30% 30%, var(--gf-accent-glow) 0%, transparent 50%)',
            'radial-gradient(ellipse at 70% 70%, rgba(0,170,255,0.12) 0%, transparent 50%)',
            'var(--gf-bg-base)',
          ].join(', '),
        }}
      />

      <Reveal className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center" animation="scale">
        <h2 className="text-4xl md:text-5xl font-bold text-gf-heading mb-6">
          {t('finalCta.title')}
        </h2>
        <p className="text-xl text-gf-body mb-10 max-w-2xl mx-auto">
          {t('finalCta.subtitle')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#deployment"
            className="inline-flex items-center px-8 py-4 rounded-xl text-lg font-bold text-white bg-gf-accent hover:bg-gf-accent-hover shadow-[var(--gf-shadow-accent)] hover:shadow-[0_6px_40px_-4px_var(--gf-accent-glow)] transition-[background-color,box-shadow] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent gap-3"
          >
            {t('finalCta.ctaDeploy')}
            <ArrowRight className="h-5 w-5" />
          </a>

          <a
            href="https://github.com/jurczykpawel/gateflow"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-8 py-4 rounded-xl text-lg font-bold text-gf-heading border-2 border-gf-border hover:border-gf-border-accent bg-gf-raised/80 transition-[border-color,background-color] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent gap-3"
          >
            <Github className="h-5 w-5" />
            {t('finalCta.ctaGithub')}
          </a>

          <a
            href="#"
            className="inline-flex items-center px-8 py-4 rounded-xl text-lg font-bold text-gf-heading border-2 border-pink-500/30 hover:border-pink-500/60 bg-pink-500/10 hover:bg-pink-500/15 transition-[border-color,background-color] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500 gap-3"
          >
            <Heart className="h-5 w-5 text-pink-400" />
            {t('donate.title')}
          </a>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-8 mt-10 text-sm text-gf-muted">
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
