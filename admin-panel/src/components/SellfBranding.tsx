'use client';

import { useTranslations } from 'next-intl';

/**
 * "This checkout is open-source → Sellf" branding watermark.
 * Shown at the bottom of checkout pages when no valid license is active.
 * A valid Sellf license (time-limited or unlimited) hides this element.
 */
export default function SellfBranding() {
  const t = useTranslations('checkout');

  return (
    <div className="fixed bottom-3 left-0 right-0 text-center pointer-events-none z-10">
      <a
        href="https://demo.sellf.app?ref=checkout"
        target="_blank"
        rel="noopener noreferrer"
        className="pointer-events-auto inline-flex items-center gap-1.5 text-xs text-gf-body hover:text-gf-heading transition-colors"
      >
        {t('checkoutBranding')}{' '}
        <span className="font-semibold underline decoration-dotted underline-offset-2">
          Sellf
        </span>
      </a>
    </div>
  );
}
