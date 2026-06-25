'use client';

import { useTranslations } from 'next-intl';

/**
 * Admin-only banner shown in funnel test mode (`?funnel_test=1`). Signals that
 * the checkout is a preview and no payment / access grant will happen. Shared by
 * the paid and free checkout forms so the preview looks identical for both.
 */
export default function FunnelTestBanner() {
  const t = useTranslations('checkout');

  return (
    <div className="mb-6 p-4 bg-sf-warning-soft border border-sf-warning/30 rounded-xl">
      <div className="flex items-center gap-3">
        <svg className="w-5 h-5 text-sf-warning flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M5 14.5l-1.43 5.725a1.125 1.125 0 001.09 1.4h14.68a1.125 1.125 0 001.09-1.4L19 14.5" />
        </svg>
        <div>
          <p className="text-sm font-bold text-sf-warning">{t('funnelTest.banner')}</p>
          <p className="text-xs text-sf-warning/80">{t('funnelTest.description')}</p>
        </div>
      </div>
    </div>
  );
}
