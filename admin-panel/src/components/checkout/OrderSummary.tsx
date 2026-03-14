'use client';

import { useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
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
  taxMode?: TaxMode;
  customAmountError?: string | null;
  appliedCoupon?: AppliedCoupon;
  bumpProducts?: OrderBumpWithProduct[];
  selectedBumpIds?: Set<string>;
}

export default function OrderSummary({
  productName,
  currency,
  basePrice,
  discountAmount,
  totalGross,
  totalNet,
  vatRate,
  taxMode,
  customAmountError,
  appliedCoupon,
  bumpProducts = [],
  selectedBumpIds = new Set(),
}: OrderSummaryProps) {
  const t = useTranslations('checkout');

  const selectedBumpsForSummary = bumpProducts.filter(bp => selectedBumpIds.has(bp.bump_product_id));
  const showBreakdown = selectedBumpsForSummary.length > 0 || (appliedCoupon && discountAmount > 0);

  return (
    <div className="space-y-2 py-4 border-t border-sf-border">
      {showBreakdown && (
        <>
          {/* Product Price */}
          <div className="flex justify-between text-sm text-sf-muted">
            <span>{productName}</span>
            <span>{formatPrice(basePrice, currency)} {currency}</span>
          </div>

          {/* Multi-bump line items */}
          {selectedBumpsForSummary.map(bump => (
            <div key={bump.bump_product_id} className="flex justify-between text-sm text-sf-muted">
              <span>{bump.bump_product_name || t('additionalProduct')}</span>
              <span>{formatPrice(bump.bump_price, currency)} {currency}</span>
            </div>
          ))}

          {/* Coupon Discount */}
          {appliedCoupon && discountAmount > 0 && (
            <div className="flex justify-between text-sm text-sf-success">
              <span>{t('couponDiscount', { defaultValue: 'Discount' })} ({appliedCoupon.code})</span>
              <span>-{formatPrice(discountAmount, currency)} {currency}</span>
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
          {taxMode !== 'stripe_tax' && !customAmountError && vatRate != null && vatRate > 0 && (
            <div className="text-xs text-sf-muted">
              {t('netPrice')}: {formatPrice(totalNet, currency)} {currency} + {t('vat')} {vatRate}%
            </div>
          )}
        </div>
        <div className={`text-2xl font-bold ${customAmountError ? 'text-sf-danger line-through' : 'text-sf-heading'}`}>
          {formatPrice(totalGross, currency)} {currency}
        </div>
      </div>
    </div>
  );
}
