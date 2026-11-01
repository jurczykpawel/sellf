'use client';

import { useTranslations, useLocale } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { getVatDisplay } from '@/lib/product-pricing-display';
import type { OrderBumpWithProduct } from '@/types/order-bump';
import type { AppliedCoupon } from '@/types/coupon';
import type { TaxMode } from '@/lib/actions/shop-config';

interface OrderSummaryProps {
  productName: string;
  currency: string;
  basePrice: number;
  discountAmount: number;
  totalGross: number;
  totalNet: number;
  vatRate: number | null;
  vatExempt?: boolean;
  vatExemptNote?: string | null;
  taxMode?: TaxMode;
  quantityInvalid?: boolean;
  customAmountError?: string | null;
  appliedCoupon?: AppliedCoupon;
  bumpProducts?: OrderBumpWithProduct[];
  selectedBumpIds?: Set<string>;
  /**
   * If set, the total is rendered as "{price} / {intervalLabel}" (subscription).
   * Pass output of formatBillingIntervalLabel() — e.g. "mies." / "rok".
   */
  intervalLabel?: string;
  trialDays?: number | null;
}

export default function OrderSummary({
  productName,
  currency,
  basePrice,
  discountAmount,
  totalGross,
  totalNet,
  vatRate,
  vatExempt,
  vatExemptNote,
  taxMode,
  quantityInvalid,
  customAmountError,
  appliedCoupon,
  bumpProducts = [],
  selectedBumpIds = new Set(),
  intervalLabel,
  trialDays,
}: OrderSummaryProps) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const totalError = quantityInvalid || !!customAmountError;

  const selectedBumpsForSummary = bumpProducts.filter(bp => selectedBumpIds.has(bp.bump_product_id));
  const vatDisplay = getVatDisplay({ taxMode, vatRate, vatExempt, vatExemptNote });
  const showBreakdown = selectedBumpsForSummary.length > 0 || (appliedCoupon && discountAmount > 0);

  return (
    <div className="space-y-2 py-4 border-t border-sf-border">
      {showBreakdown && (
        <>
          {/* Product Price */}
          <div className="flex justify-between text-sm text-sf-muted">
            <span>{productName}</span>
            <span>{formatPrice(basePrice, currency, locale)}</span>
          </div>

          {/* Multi-bump line items */}
          {selectedBumpsForSummary.map(bump => (
            <div key={bump.bump_product_id} className="flex justify-between text-sm text-sf-muted">
              <span>{bump.bump_product_name || t('additionalProduct')}</span>
              <span>{formatPrice(bump.bump_price, currency, locale)}</span>
            </div>
          ))}

          {/* Coupon Discount */}
          {appliedCoupon && discountAmount > 0 && (
            <div className="flex justify-between text-sm text-sf-success">
              <span>{t('couponDiscount', { defaultValue: 'Discount' })} ({appliedCoupon.code})</span>
              <span>-{formatPrice(discountAmount, currency, locale)}</span>
            </div>
          )}

          <div className="border-t border-sf-border my-2" />
        </>
      )}

      {/* Total */}
      <div className="flex flex-wrap justify-between items-baseline gap-3">
        <div>
          <div className={`font-semibold ${totalError ? 'text-sf-danger' : 'text-sf-heading'}`}>
            {trialDays ? t('trial.today') : t('total', { defaultValue: 'Total' })}
            {totalError && (
              <span className="text-xs font-normal ml-2">({quantityInvalid ? t('profile.errors.invalidQuantity') : t('invalidAmount', { defaultValue: 'invalid amount' })})</span>
            )}
          </div>
          {!trialDays && !totalError && vatDisplay.kind === 'rate' && (
            <div className="text-xs text-sf-muted">
              {t('netPrice')}: {formatPrice(totalNet, currency, locale)} + {t('vat')} {vatDisplay.rate}%
            </div>
          )}
          {!trialDays && !totalError && vatDisplay.kind === 'exempt' && (
            <div className="text-xs text-sf-muted">
              {t('vatExempt')}{vatDisplay.note && ` (${vatDisplay.note})`}
            </div>
          )}
        </div>
        <div data-testid="order-summary-total" className={`shrink-0 whitespace-nowrap text-2xl font-bold ${totalError ? 'text-sf-danger' : 'text-sf-heading'}`}>
          {totalError ? '—' : formatPrice(trialDays ? 0 : totalGross, currency, locale)}
          {!trialDays && !totalError && intervalLabel && <span className="text-base font-medium text-sf-muted"> / {intervalLabel}</span>}
        </div>
      </div>
      {trialDays && !totalError && <div className="space-y-1 text-sm text-sf-body">
        <div className="flex flex-wrap justify-between gap-3"><span>{t('trial.after')}</span><span data-testid="trial-later-total" className="font-semibold">{formatPrice(totalGross, currency, locale)}{intervalLabel && ` / ${intervalLabel}`}</span></div>
        {vatDisplay.kind === 'rate' && <p className="text-xs text-sf-muted">{t('netPrice')}: {formatPrice(totalNet, currency, locale)} + {t('vat')} {vatDisplay.rate}%</p>}
        {vatDisplay.kind === 'exempt' && <p className="text-xs text-sf-muted">{t('vatExempt')}{vatDisplay.note && ` (${vatDisplay.note})`}</p>}
      </div>}
    </div>
  );
}
