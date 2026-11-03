'use client';

import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import BuyerLicenseKey from './BuyerLicenseKey';
import FloatingToolbar from '@/components/FloatingToolbar';
import { formatPrice } from '@/lib/constants';
import { formatRecurringProductPrice, formatBillingIntervalLabel } from '@/lib/product-pricing-display';
import { getTrialDays } from '@/lib/checkout/trial-display';
import TrialTerms from '@/components/checkout/TrialTerms';
import type { Product } from '@/types';
import type { SecureProductResponse } from './ProductAccessView';

interface ProductExpiredStateProps {
  product: Product;
  existingLicense?: SecureProductResponse['license'];
}

export default function ProductExpiredState({ product, existingLicense }: ProductExpiredStateProps) {
  const t = useTranslations('productView');
  const locale = useLocale();
  const trialDays = getTrialDays(product);
  const tCheckout = useTranslations('checkout');
  const isSubscription = product.product_type === 'subscription';
  const priceLabel = isSubscription
    ? (formatRecurringProductPrice(product, locale) ?? formatPrice(product.recurring_price ?? 0, product.currency, locale))
    : product.price === 0
      ? t('free', { defaultValue: 'FREE' })
      : formatPrice(product.price, product.currency, locale);

  return (
    <div className="flex justify-center items-center min-h-screen bg-sf-deep">
      <FloatingToolbar position="top-right" />

      <div className="max-w-4xl mx-auto p-8 bg-sf-raised/80 border border-sf-border rounded-2xl shadow-[var(--sf-shadow-accent)] text-center">
        <div className="text-6xl mb-4">{product.icon || '📦'}</div>
        <h1 className="text-3xl font-bold text-sf-heading mb-2">{product.name}</h1>
        {product.description && (
          <p className="text-sf-body mb-6 max-w-2xl mx-auto">{product.description}</p>
        )}
        <div className="text-xl font-semibold text-sf-accent mb-8">
          {trialDays ? <TrialTerms days={trialDays} amount={product.recurring_price ?? 0} currency={product.currency} intervalLabel={formatBillingIntervalLabel(product.billing_interval, product.billing_interval_count, locale)} showToday previewDate={false} /> : priceLabel}
        </div>

        <div className="text-4xl mb-4">⏰</div>
        <h2 className="text-2xl font-semibold text-sf-heading mb-2">{t('accessExpired')}</h2>
        <p className="text-sf-muted mb-6">{t('accessExpiredMessage')}</p>
        <div className="bg-sf-danger-soft border border-sf-danger/30 rounded-lg p-4 text-sf-danger mb-6">
          <p className="text-sm">{t('canPurchaseAgain')}</p>
        </div>

        {existingLicense && <div className="mb-6"><BuyerLicenseKey license={existingLicense} /></div>}

        <Link
          href={`/${locale}/checkout/${product.slug}`}
          className="inline-block bg-sf-accent hover:bg-sf-accent/90 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
        >
          {trialDays ? tCheckout('trial.start', { days: trialDays }) : <>{t('purchaseAgain')} — {priceLabel}</>}
        </Link>
      </div>
    </div>
  );
}
