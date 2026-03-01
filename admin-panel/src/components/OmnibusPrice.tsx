'use client';

/**
 * OmnibusPrice Component
 * Displays lowest price from last 30 days as required by EU Omnibus Directive (2019/2161)
 * Shows ONLY when sale_price is active (public discount announcement)
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface OmnibusPriceProps {
  productId: string;
  currentPrice: number;
  currency: string;
  showAlways?: boolean; // Force display (for admin preview, testing)
}

interface LowestPriceData {
  lowestPrice: number | null;
  currency: string | null;
  effectiveFrom: string | null;
  showOmnibus: boolean;
}

export default function OmnibusPrice({
  productId,
  currentPrice,
  currency,
  showAlways = false
}: OmnibusPriceProps) {
  const t = useTranslations('checkout');
  const [lowestPriceData, setLowestPriceData] = useState<LowestPriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    async function fetchLowestPrice() {
      try {
        const response = await fetch(`/api/products/${productId}/lowest-price`);
        if (response.ok) {
          const data = await response.json();
          setLowestPriceData(data);
        }
      } catch (error) {
        console.error('Failed to fetch Omnibus price:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchLowestPrice();
  }, [productId]);

  // Don't show anything while loading
  if (loading) {
    return null;
  }

  // Don't show if API says not to show (no active sale_price)
  if (!showAlways && (!lowestPriceData || !lowestPriceData.showOmnibus)) {
    return null;
  }

  // Don't show if no lowest price data
  if (!lowestPriceData || lowestPriceData.lowestPrice === null) {
    return null;
  }

  // Format price using Intl.NumberFormat
  const formatter = new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: lowestPriceData.currency || currency,
  });

  return (
    <div className="relative">
      <div
        className="text-sm text-gf-muted mt-2 flex items-center gap-1 cursor-help"
        data-testid="omnibus-price"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span>{t('lowestPriceLabel')}: {formatter.format(lowestPriceData.lowestPrice)}</span>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute z-10 bottom-full left-0 mb-2 w-80 p-4 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-300">
          <p className="font-semibold text-white mb-2">{t('lowestPriceTooltipTitle')}</p>
          <p className="mb-2">{t('lowestPriceTooltipDescription')}</p>
          <p className="text-xs text-gf-muted">{t('lowestPriceTooltipDisclaimer')}</p>
        </div>
      )}
    </div>
  );
}
