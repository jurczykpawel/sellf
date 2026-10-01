'use client';

import { useTranslations } from 'next-intl';
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
  customAmountError?: string | null;
  appliedCoupon?: AppliedCoupon;
  bumpProducts?: OrderBumpWithProduct[];
  selectedBumpIds?: Set<string>;
  /**
   * If set, the total is rendered as "{price} / {intervalLabel}" (subscription).
   * Pass output of formatBillingIntervalLabel() — e.g. "mies." / "rok".
   */
  intervalLabel?: string;
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
  customAmountError,
  appliedCoupon,
  bumpProducts = [],
  selectedBumpIds = new Set(),
  intervalLabel,
}: OrderSummaryProps) {
  const t = useTranslations('checkout');

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
            <span>{formatPrice(basePrice, currency)}</span>
          </div>

          {/* Multi-bump line items */}
          {selectedBumpsForSummary.map(bump => (
            <div key={bump.bump_product_id} className="flex justify-between text-sm text-sf-muted">
              <span>{bump.bump_product_name || t('additionalProduct')}</span>
              <span>{formatPrice(bump.bump_price, currency)}</span>
            </div>
          ))}

          {/* Coupon Discount */}
          {appliedCoupon && discountAmount > 0 && (
            <div className="flex justify-between text-sm text-sf-success">
              <span>{t('couponDiscount', { defaultValue: 'Discount' })} ({appliedCoupon.code})</span>
              <span>-{formatPrice(discountAmount, currency)}</span>
            </div>
          )}

          <div className="border-t border-sf-border my-2" />
        </>
      )}

      {/* Total */}
      <div className="flex justify-between items-baseline">
        <div>
          <div className={`font-semibold ${customAmountError ? 'text-sf-danger' : 'text-sf-heading'}`}>
            {t('total', { defaultValue: 'Total' })}
            {customAmountError && (
              <span className="text-xs font-normal ml-2">({t('invalidAmount', { defaultValue: 'invalid amount' })})</span>
            )}
          </div>
          {!customAmountError && vatDisplay.kind === 'rate' && (
            <div className="text-xs text-sf-muted">
              {t('netPrice')}: {formatPrice(totalNet, currency)} + {t('vat')} {vatDisplay.rate}%
            </div>
          )}
          {!customAmountError && vatDisplay.kind === 'exempt' && (
            <div className="text-xs text-sf-muted">
              {t('vatExempt')}{vatDisplay.note && ` (${vatDisplay.note})`}
            </div>
          )}
        </div>
        <div data-testid="order-summary-total" className={`text-2xl font-bold ${customAmountError ? 'text-sf-danger line-through' : 'text-sf-heading'}`}>
          {formatPrice(totalGross, currency)}
          {intervalLabel && <span className="text-base font-medium text-sf-muted"> / {intervalLabel}</span>}
        </div>
      </div>
    </div>
  );
}
