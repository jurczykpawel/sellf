'use client';

/** Trial terms use the buyer's timezone after the shared hydration snapshot. */
import { useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { formatTrialDate, trialEndFromStart } from '@/lib/checkout/trial-display';

function subscribeClock(change: () => void): () => void {
  const timer = setInterval(change, 1000);
  return () => clearInterval(timer);
}
const clock = () => Math.floor(Date.now() / 1000);
const serverClock = () => null;
const noClock = () => () => {};

interface TrialTermsProps {
  days: number;
  amount: number;
  currency: string;
  intervalLabel?: string;
  showToday?: boolean;
  previewDate?: boolean;
}

export default function TrialTerms({ days, amount, currency, intervalLabel, showToday = false, previewDate = true }: TrialTermsProps) {
  const t = useTranslations('checkout.trial');
  const locale = useLocale();
  const now = useSyncExternalStore(previewDate ? subscribeClock : noClock, clock, serverClock);
  const end = now === null || !previewDate ? null : trialEndFromStart(now, days);
  const zone = end === null ? null : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const price = `${formatPrice(amount, currency, locale)}${intervalLabel ? ` / ${intervalLabel}` : ''}`;
  return <div data-testid="trial-terms" className="my-3 space-y-1 text-sm font-normal text-sf-body">
    {showToday && <p className="font-semibold">{t('today')}: {formatPrice(0, currency, locale)}</p>}
    <p className="font-semibold">{t('freeDays', { days })}</p>
    <p>{t('after')}: {price}</p>
    {end !== null && zone
      ? <p>{t('firstPayment')}: <time data-testid="trial-first-payment" dateTime={new Date(end * 1000).toISOString()}>{formatTrialDate(end, locale, zone)}</time></p>
      : <p>{t('startsAfter', { days })}</p>}
    <p>{t('automatic')}</p>
  </div>;
}
