import { getTranslations } from 'next-intl/server';
import { Building2, User, TrendingUp, AlertTriangle } from 'lucide-react';

export async function TaxSection() {
  const t = await getTranslations('landing');

  return (
    <section className="py-24 md:py-32 bg-white dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            {t('tax.title')}
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            {t('tax.subtitle')}
          </p>
        </div>

        {/* Comparison cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {/* MoR card */}
          <div className="p-8 rounded-2xl border-2 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
                <Building2 className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-red-600 dark:text-red-400">
                  {t('tax.morTitle')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('tax.morSubtitle')}</p>
              </div>
            </div>
            <ul className="space-y-4 mt-6">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-red-400 shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">
                  {t('tax.morPlatformFees')}: <span className="font-semibold text-red-600 dark:text-red-400">{t('tax.morFeeAmount')}</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-red-400 shrink-0" />
                <span className="text-red-600 dark:text-red-400 font-medium">{t('tax.morDataOwnership')}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-red-400 shrink-0" />
                <span className="text-red-600 dark:text-red-400 font-medium">{t('tax.morPlatformRisk')}</span>
              </li>
            </ul>
          </div>

          {/* Own Stripe card */}
          <div className="p-8 rounded-2xl border-2 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10 ring-2 ring-emerald-300/50 dark:ring-emerald-700/50 relative">
            <div className="absolute -top-3 right-6">
              <span className="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                Recommended
              </span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                <User className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                  {t('tax.gateflowTitle')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('tax.gateflowSubtitle')}</p>
              </div>
            </div>
            <ul className="space-y-4 mt-6">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">
                  {t('tax.gateflowPlatformFees')}: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{t('tax.gateflowFeeAmount')}</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">
                  {t('tax.gateflowStripeFees')}: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{t('tax.gateflowStripeAmount')}</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t('tax.gateflowDataOwnership')}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t('tax.gateflowSelfHosted')}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Tax Growth Path */}
        <div className="mb-8">
          <h3 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-8 text-center">
            {t('tax.taxGrowthTitle')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-sky-100 dark:bg-sky-900/30 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-sky-600 dark:text-sky-400">1</span>
                </div>
                <TrendingUp className="w-5 h-5 text-sky-500" />
              </div>
              <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                {t('tax.taxStep1Title')}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {t('tax.taxStep1Desc')}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-sky-200 dark:bg-sky-800/50 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-sky-700 dark:text-sky-300">2</span>
                </div>
                <TrendingUp className="w-5 h-5 text-sky-600 dark:text-sky-400" />
              </div>
              <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                {t('tax.taxStep2Title')}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {t('tax.taxStep2Desc')}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#00AAFF]/10 dark:bg-[#00AAFF]/5 border-2 border-[#00AAFF]/30 dark:border-[#00AAFF]/20">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-[#00AAFF]/20 dark:bg-[#00AAFF]/10 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-[#00AAFF]">3</span>
                </div>
                <TrendingUp className="w-5 h-5 text-[#00AAFF]" />
              </div>
              <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                {t('tax.taxStep3Title')}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {t('tax.taxStep3Desc')}
              </p>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 mt-8">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {t('tax.taxDisclaimer')}
          </p>
        </div>
      </div>
    </section>
  );
}
