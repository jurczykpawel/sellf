'use client';

import { useTranslations } from 'next-intl';

interface SellfBrandingProps {
  /** 'checkout' (default) shows "Ten koszyk działa na Sellf", 'product' shows "Zabezpieczone przez" */
  variant?: 'checkout' | 'product';
}

/**
 * Sellf branding watermark shown when no valid license is active.
 * - checkout variant: "Ten koszyk działa na → Sellf"
 * - product variant:  "Zabezpieczone przez → Sellf"
 */
export default function SellfBranding({ variant = 'checkout' }: SellfBrandingProps) {
  const t = useTranslations('checkout');
  const brandingKey = variant === 'product' ? 'productBranding' : 'checkoutBranding';
  const refParam = variant === 'product' ? 'product' : 'checkout';

  return (
    <div className="fixed bottom-3 left-0 right-0 text-center pointer-events-none z-10">
      <a
        href={`https://demo.sellf.app?ref=${refParam}`}
        target="_blank"
        rel="noopener noreferrer"
        className="pointer-events-auto inline-flex items-center gap-1.5 text-xs text-sf-body hover:text-sf-heading transition-colors"
      >
        {t(brandingKey)}{' '}
        <span className="font-semibold underline decoration-dotted underline-offset-2">
          Sellf
        </span>
      </a>
    </div>
  );
}
