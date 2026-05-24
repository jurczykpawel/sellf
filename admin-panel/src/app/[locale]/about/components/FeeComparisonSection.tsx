'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Reveal } from '@/components/motion/Reveal';

interface PlatformFee {
  key: string;
  label: string;
  feeNote: string;
  fee: number;
  barColor: string;
}

interface LocaleConfig {
  currency: 'PLN' | 'USD';
  symbol: string;
  intlLocale: string;
  // slider bounds in the local currency
  min: number;
  max: number;
  step: number;
  // initial value
  initial: number;
  // pulse thresholds (in local currency)
  pulseThresholds: number[];
  // assumed average order value used for per-tx fees (Gumroad's $0.30 etc.)
  avgOrderValue: number;
  // fixed-per-tx fee in local currency for Gumroad/Paddle/Lemon
  fixedTxFee: number;
}

const LOCALE_CONFIGS: Record<string, LocaleConfig> = {
  pl: {
    currency: 'PLN',
    symbol: 'zł',
    intlLocale: 'pl-PL',
    min: 5000,
    max: 500000,
    step: 5000,
    initial: 40000,
    pulseThresholds: [10000, 100000, 500000],
    avgOrderValue: 200,
    fixedTxFee: 1.2, // ≈ $0.30 in PLN
  },
  en: {
    currency: 'USD',
    symbol: '$',
    intlLocale: 'en-US',
    min: 1000,
    max: 100000,
    step: 1000,
    initial: 10000,
    pulseThresholds: [1000, 10000, 100000],
    avgOrderValue: 50,
    fixedTxFee: 0.30,
  },
};

function calculateFees(revenue: number, cfg: LocaleConfig): PlatformFee[] {
  const txCount = revenue / cfg.avgOrderValue;
  const sellfFee = revenue * 0.034;
  const gumroadFee = revenue * 0.1 + revenue * 0.029 + cfg.fixedTxFee * txCount;
  const paddleFee = revenue * 0.05 + revenue * 0.035 + cfg.fixedTxFee * txCount;
  const lemonFee = revenue * 0.05 + revenue * 0.035 + cfg.fixedTxFee * txCount;
  return [
    { key: 'sellf', label: '', feeNote: '', fee: sellfFee, barColor: 'bg-sf-success' },
    { key: 'gumroad', label: '', feeNote: '', fee: gumroadFee, barColor: 'bg-sf-danger-bg' },
    { key: 'paddle', label: '', feeNote: '', fee: paddleFee, barColor: 'bg-sf-warning' },
    { key: 'lemon', label: '', feeNote: '', fee: lemonFee, barColor: 'bg-sf-warning' },
  ];
}

export function FeeComparisonSection() {
  const t = useTranslations('landing');
  const locale = useLocale();
  const cfg = LOCALE_CONFIGS[locale] ?? LOCALE_CONFIGS.en;
  const [revenue, setRevenue] = useState(cfg.initial);

  const fmt = new Intl.NumberFormat(cfg.intlLocale, {
    style: 'currency',
    currency: cfg.currency,
    maximumFractionDigits: 0,
  });

  const platforms = calculateFees(revenue, cfg);
  const maxFee = Math.max(...platforms.map((p) => p.fee));

  const labelMap: Record<string, { label: string; feeNote: string }> = {
    sellf: { label: t('feeComparison.sellfLabel'), feeNote: t('feeComparison.sellfFeeNote') },
    gumroad: { label: t('feeComparison.gumroadLabel'), feeNote: t('feeComparison.gumroadFeeNote') },
    paddle: { label: t('feeComparison.paddleLabel'), feeNote: t('feeComparison.paddleFeeNote') },
    lemon: { label: t('feeComparison.lemonLabel'), feeNote: t('feeComparison.lemonFeeNote') },
  };

  const sellfFee = platforms[0].fee;
  const gumroadFee = platforms[1].fee;
  const monthlySavings = gumroadFee - sellfFee;
  const annualSavings = monthlySavings * 12;

  // Hero badge listens on this event for the revenue-impact ticker.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('sellf:revenue-change', {
        detail: { revenue, monthlySavings, annualSavings },
      }),
    );
  }, [revenue, monthlySavings, annualSavings]);

  // Savings pulse on threshold crossings.
  const savingsRef = useRef<HTMLDivElement>(null);
  const lastBucketRef = useRef<number>(-1);

  useEffect(() => {
    const bucket = cfg.pulseThresholds.filter((threshold) => revenue >= threshold).length;
    if (bucket > lastBucketRef.current && savingsRef.current) {
      const node = savingsRef.current;
      node.classList.remove('savings-pulse-active');
      void node.offsetWidth;
      node.classList.add('savings-pulse-active');
      node.dataset.pulseState = 'pulsing';
      const timer = window.setTimeout(() => {
        node.dataset.pulseState = 'idle';
      }, 340);
      lastBucketRef.current = bucket;
      return () => window.clearTimeout(timer);
    }
    lastBucketRef.current = bucket;
  }, [revenue, cfg.pulseThresholds]);

  return (
    <section
      className="py-24 md:py-32 bg-sf-base"
      data-landing-section="fee-comparison"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal>
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3 text-center">
            {t('feeComparison.categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4 text-center">
            {t('feeComparison.title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto text-center mb-12">
            {t('feeComparison.subtitle')}
          </p>
        </Reveal>

        {/* Revenue slider */}
        <Reveal animation="fade-up" delay={100}>
          <div className="mb-12">
            <label className="block text-sm font-medium text-sf-body mb-3 text-center">
              {t('feeComparison.monthlyRevenue')}:{' '}
              <span className="text-lg font-bold text-sf-accent">
                {fmt.format(revenue)}
              </span>
            </label>
            <input
              type="range"
              min={cfg.min}
              max={cfg.max}
              step={cfg.step}
              value={revenue}
              onChange={(e) => setRevenue(Number(e.target.value))}
              aria-label={t('feeComparison.monthlyRevenue')}
              aria-valuemin={cfg.min}
              aria-valuemax={cfg.max}
              aria-valuenow={revenue}
              aria-valuetext={fmt.format(revenue)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-sf-accent bg-sf-raised"
            />
            <div className="flex justify-between text-xs text-sf-muted mt-1">
              <span>{fmt.format(cfg.min)}</span>
              <span>{fmt.format(cfg.max)}</span>
            </div>
          </div>
        </Reveal>

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
                    <span className="text-sm font-semibold text-sf-heading">{label}</span>
                    <span className="text-xs text-sf-muted ml-2">{feeNote}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium text-sf-body">
                      {t('feeComparison.platformFees')}: {fmt.format(platform.fee)}
                    </span>
                    <span className="text-xs text-sf-muted ml-3">
                      {t('feeComparison.youKeep')}: {fmt.format(youKeep)}
                    </span>
                  </div>
                </div>
                <div className="bg-sf-raised rounded-full h-4">
                  <div
                    className={`${platform.barColor} rounded-full h-4 transition-[width] duration-500`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Savings highlight */}
        <Reveal animation="scale" delay={200}>
          <div
            ref={savingsRef}
            data-pulse-state="idle"
            className="bg-sf-success-soft border border-sf-success/20 rounded-xl p-6 text-center mt-8"
          >
            <p className="text-lg font-semibold text-sf-success">
              {t('feeComparison.youSave', { amount: fmt.format(monthlySavings) })}
            </p>
            <p className="text-2xl font-bold text-sf-success mt-2">
              {t('feeComparison.annualSavings', { amount: fmt.format(annualSavings) })}
            </p>
          </div>
        </Reveal>

        {/* Before/After block — concrete math at typical creator scale */}
        <Reveal animation="fade-up" delay={300}>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-sf-danger-bg/30 bg-sf-raised/40 p-5">
              <div className="text-xs font-mono uppercase tracking-wider text-sf-danger-bg mb-2">
                {t('feeComparison.beforeLabel')}
              </div>
              <p className="text-sm text-sf-body leading-relaxed">
                {t('feeComparison.beforeText')}
              </p>
            </div>
            <div className="rounded-xl border border-sf-success/40 bg-sf-success-soft/20 p-5">
              <div className="text-xs font-mono uppercase tracking-wider text-sf-success mb-2">
                {t('feeComparison.afterLabel')}
              </div>
              <p className="text-sm text-sf-body leading-relaxed">
                {t('feeComparison.afterText')}
              </p>
            </div>
          </div>
          <p className="text-center text-base font-bold text-sf-heading mt-4">
            {t('feeComparison.diffLabel')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
