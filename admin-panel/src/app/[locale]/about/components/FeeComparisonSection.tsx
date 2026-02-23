'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';

interface PlatformFee {
  key: string;
  label: string;
  feeNote: string;
  fee: number;
  barColor: string;
}

function calculateFees(revenue: number): PlatformFee[] {
  const avgOrderValue = 50;
  const transactionCount = revenue / avgOrderValue;

  const gateflowFee = revenue * 0.034;
  const gumroadFee = revenue * 0.10 + revenue * 0.029 + 0.30 * transactionCount;
  const paddleFee = revenue * 0.05 + revenue * 0.035 + 0.30 * transactionCount;
  const lemonFee = revenue * 0.05 + revenue * 0.035 + 0.30 * transactionCount;

  return [
    { key: 'gateflow', label: '', feeNote: '', fee: gateflowFee, barColor: 'bg-emerald-500' },
    { key: 'gumroad', label: '', feeNote: '', fee: gumroadFee, barColor: 'bg-red-500' },
    { key: 'paddle', label: '', feeNote: '', fee: paddleFee, barColor: 'bg-orange-500' },
    { key: 'lemon', label: '', feeNote: '', fee: lemonFee, barColor: 'bg-orange-500' },
  ];
}

export function FeeComparisonSection() {
  const t = useTranslations('landing');
  const locale = useLocale();
  const [revenue, setRevenue] = useState(5000);

  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  const revenueFmt = new Intl.NumberFormat(locale === 'pl' ? 'en-US' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  const platforms = calculateFees(revenue);
  const maxFee = Math.max(...platforms.map((p) => p.fee));

  const labelMap: Record<string, { label: string; feeNote: string }> = {
    gateflow: { label: t('feeComparison.gateflowLabel'), feeNote: t('feeComparison.gateflowFeeNote') },
    gumroad: { label: t('feeComparison.gumroadLabel'), feeNote: t('feeComparison.gumroadFeeNote') },
    paddle: { label: t('feeComparison.paddleLabel'), feeNote: t('feeComparison.paddleFeeNote') },
    lemon: { label: t('feeComparison.lemonLabel'), feeNote: t('feeComparison.lemonFeeNote') },
  };

  const gateflowFee = platforms[0].fee;
  const gumroadFee = platforms[1].fee;
  const monthlySavings = gumroadFee - gateflowFee;
  const annualSavings = monthlySavings * 12;

  return (
    <section className="py-24 md:py-32 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 text-center">
          {t('feeComparison.title')}
        </h2>
        <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto text-center mb-12">
          {t('feeComparison.subtitle')}
        </p>

        {/* Revenue slider */}
        <div className="mb-12">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
            {t('feeComparison.monthlyRevenue')}: <span className="text-lg font-bold text-[#00AAFF]">{revenueFmt.format(revenue)}</span>
          </label>
          <input
            type="range"
            min={1000}
            max={100000}
            step={1000}
            value={revenue}
            onChange={(e) => setRevenue(Number(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#00AAFF]"
          />
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>$1,000</span>
            <span>$100,000</span>
          </div>
        </div>

        {/* Fee comparison bars */}
        <div className="space-y-6">
          {platforms.map((platform) => {
            const { label, feeNote } = labelMap[platform.key];
            const barWidth = maxFee > 0 ? Math.max((platform.fee / maxFee) * 100, 5) : 5;
            const youKeep = revenue - platform.fee;

            return (
              <div key={platform.key}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{label}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{feeNote}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('feeComparison.platformFees')}: {fmt.format(platform.fee)}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-3">
                      {t('feeComparison.youKeep')}: {fmt.format(youKeep)}
                    </span>
                  </div>
                </div>
                <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                  <div
                    className={`${platform.barColor} rounded-full h-4 transition-all duration-500`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Savings highlight */}
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-6 text-center mt-8">
          <p className="text-lg font-semibold text-emerald-800 dark:text-emerald-300">
            {t('feeComparison.youSave', { amount: fmt.format(monthlySavings) })} {t('feeComparison.perMonth')}
          </p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
            {t('feeComparison.annualSavings', { amount: fmt.format(annualSavings) })}
          </p>
        </div>
      </div>
    </section>
  );
}
