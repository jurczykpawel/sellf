import { getTranslations } from 'next-intl/server';
import { ExternalLink, Play } from 'lucide-react';

export async function DemoSection() {
  const t = await getTranslations('landing');

  return (
    <section className="py-20 md:py-28 bg-gradient-to-r from-[#00AAFF] via-sky-500 to-blue-600 relative overflow-hidden">
      <div className="absolute inset-0 bg-black/10" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
          {t('demo.title')}
        </h2>
        <p className="text-lg text-sky-100 mb-8 max-w-2xl mx-auto">
          {t('demo.subtitle')}
        </p>

        <a
          href="https://gateflow.cytr.us/login"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-8 py-4 rounded-xl text-lg font-bold text-[#00AAFF] bg-white hover:bg-gray-50 shadow-2xl transition-all duration-300 transform hover:scale-105 gap-3"
        >
          <Play className="h-5 w-5" />
          {t('demo.cta')}
          <ExternalLink className="h-5 w-5" />
        </a>

        <p className="text-sm text-sky-200 mt-4">
          Stripe test mode — no real charges
        </p>
      </div>
    </section>
  );
}
