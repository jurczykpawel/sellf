'use client';

import { useTranslations } from 'next-intl';

interface AccessGrantedCardProps {
  /** Seconds remaining before the auto-redirect fires. */
  countdown: number;
  /** Navigate onward (success_url / OTO / product page — resolved by the caller). */
  onGoToProduct: () => void;
}

/**
 * "Access granted" confirmation card with an auto-redirect countdown and a
 * manual "go to product" button. Shared by the paid and free checkout forms
 * (real grant + funnel-test simulation) so the post-checkout state is identical.
 */
export default function AccessGrantedCard({ countdown, onGoToProduct }: AccessGrantedCardProps) {
  const t = useTranslations('checkout');

  return (
    <div className="mb-4 p-6 bg-sf-success-soft border border-sf-success/20 rounded-xl backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="flex-shrink-0 w-10 h-10 bg-sf-success-soft rounded-full flex items-center justify-center mr-4">
            <svg className="w-5 h-5 text-sf-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-sf-success mb-1">{t('accessGranted')}</h3>
            <p className="text-sf-success text-sm">{t('alreadyHasAccess')}</p>
            <p className="text-sf-success/70 text-xs mt-1 flex items-center">
              <svg className="w-3 h-3 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {t('autoRedirect', { seconds: countdown })}
            </p>
          </div>
        </div>
        <button
          onClick={onGoToProduct}
          className="bg-sf-success hover:bg-sf-success/90 text-sf-inverse px-6 py-3 rounded-full transition-all duration-200 font-medium text-sm active:scale-[0.98]"
        >
          {t('goToProduct')}
        </button>
      </div>
    </div>
  );
}
