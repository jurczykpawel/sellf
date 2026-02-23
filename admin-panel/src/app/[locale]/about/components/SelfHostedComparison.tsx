import { getTranslations } from 'next-intl/server';
import { Rocket, Shield, ArrowRight, Check, ExternalLink } from 'lucide-react';

export async function SelfHostedComparison() {
  const t = await getTranslations('landing');

  return (
    <section id="deployment" className="py-24 md:py-32 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            {t('selfHosted.title')}
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            {t('selfHosted.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Quick Start card */}
          <div className="p-8 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg">
            <div className="w-14 h-14 bg-[#00AAFF]/10 dark:bg-[#00AAFF]/20 rounded-2xl flex items-center justify-center mb-6">
              <Rocket className="w-7 h-7 text-[#00AAFF]" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              {t('selfHosted.quickStart.title')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{t('selfHosted.quickStart.subtitle')}</p>
            <span className="inline-block bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-semibold px-3 py-1 rounded-full mb-6">
              {t('selfHosted.quickStart.price')}
            </span>
            <ul className="space-y-3">
              {(['pm2', 'ssl', 'supabase', 'ram'] as const).map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-gray-700 dark:text-gray-300 text-sm">{t(`selfHosted.quickStart.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Production card (recommended) */}
          <div className="p-8 rounded-2xl bg-white dark:bg-gray-800 border-2 border-[#00AAFF] shadow-xl ring-2 ring-[#00AAFF]/20 relative">
            <div className="absolute -top-3 right-6">
              <span className="bg-[#00AAFF] text-white text-xs font-bold px-3 py-1 rounded-full">
                {t('selfHosted.production.badge')}
              </span>
            </div>
            <div className="w-14 h-14 bg-[#00AAFF]/10 dark:bg-[#00AAFF]/20 rounded-2xl flex items-center justify-center mb-6">
              <Shield className="w-7 h-7 text-[#00AAFF]" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              {t('selfHosted.production.title')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{t('selfHosted.production.subtitle')}</p>
            <span className="inline-block bg-[#00AAFF]/10 text-[#00AAFF] text-sm font-semibold px-3 py-1 rounded-full mb-6">
              {t('selfHosted.production.price')}
            </span>
            <ul className="space-y-3">
              {(['pm2', 'db', 'deploy', 'specs'] as const).map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-gray-700 dark:text-gray-300 text-sm">{t(`selfHosted.production.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Demo prompt */}
        <div className="text-center mt-12 space-y-2">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{t('selfHosted.demoPrompt')}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-6">{t('selfHosted.demoPromptSubtitle')}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-6">
            <a
              href="https://gateflow.cytr.us/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-[#00AAFF] to-blue-600 hover:from-[#0088CC] hover:to-blue-700 text-white shadow-lg hover:shadow-sky-500/30 rounded-xl px-8 py-4 text-lg font-bold transition-all duration-200"
            >
              {t('selfHosted.demoCta')}
              <ExternalLink className="h-5 w-5" />
            </a>
            <a
              href="https://github.com/jurczykpawel/gateflow#deployment"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 hover:border-[#00AAFF] text-gray-900 dark:text-white rounded-xl px-8 py-4 text-lg font-bold transition-all duration-200"
            >
              {t('selfHosted.guideCta')}
              <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
