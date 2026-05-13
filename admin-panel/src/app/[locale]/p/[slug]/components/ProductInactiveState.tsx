import { useTranslations, useLocale } from 'next-intl';
import { Product } from '@/types';
import FloatingToolbar from '@/components/FloatingToolbar';
import WaitlistForm from '@/components/WaitlistForm';
import { formatPrice } from '@/lib/constants';
import { formatRecurringProductPrice } from '@/lib/product-pricing-display';

interface ProductInactiveStateProps {
  product: Product;
}

export default function ProductInactiveState({ product }: ProductInactiveStateProps) {
  const t = useTranslations('productView');
  const locale = useLocale();
  const isSubscription = product.product_type === 'subscription';
  const priceLabel = isSubscription
    ? (formatRecurringProductPrice(product, locale) ?? formatPrice(product.recurring_price ?? 0, product.currency))
    : product.price === 0
      ? t('free', { defaultValue: 'FREE' })
      : formatPrice(product.price, product.currency);

  // If waitlist is enabled, show the waitlist form
  if (product.enable_waitlist) {
    return (
      <div>
        <FloatingToolbar position="top-right" />
        <WaitlistForm product={product} unavailableReason="inactive" />
      </div>
    );
  }

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
          {priceLabel}
        </div>

        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-2xl font-semibold text-sf-heading mb-2">{t('productInactiveTitle')}</h2>
        <p className="text-sf-muted mb-6">{t('productInactiveMessage')}</p>
      </div>
    </div>
  );
}
