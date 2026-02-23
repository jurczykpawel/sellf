import { getTranslations } from 'next-intl/server';
import { ArrowRight, Github, Clock, Code, Scale } from 'lucide-react';

export async function FinalCTA() {
  const t = await getTranslations('landing');

  return (
    <section className="py-24 md:py-32 bg-gradient-to-r from-[#00AAFF] via-sky-500 to-blue-600 relative overflow-hidden">
      <div className="absolute inset-0 bg-black/10" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
          {t('finalCta.title')}
        </h2>
        <p className="text-xl text-sky-100 mb-10 max-w-2xl mx-auto">
          {t('finalCta.subtitle')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#deployment"
            className="inline-flex items-center px-8 py-4 rounded-xl text-lg font-bold text-[#00AAFF] bg-white hover:bg-gray-50 shadow-2xl transition-all duration-300 transform hover:scale-105 gap-3"
          >
            {t('finalCta.ctaDeploy')}
            <ArrowRight className="h-5 w-5" />
          </a>

          <a
            href="https://github.com/jurczykpawel/gateflow"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-8 py-4 rounded-xl text-lg font-bold text-white border-2 border-white/30 hover:bg-white/10 transition-all duration-300 gap-3"
          >
            <Github className="h-5 w-5" />
            {t('finalCta.ctaGithub')}
          </a>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-8 mt-10 text-sm text-sky-100">
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
      </div>
    </section>
  );
}
