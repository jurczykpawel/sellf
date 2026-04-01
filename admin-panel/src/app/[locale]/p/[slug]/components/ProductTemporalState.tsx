import { useTranslations, useLocale } from 'next-intl';
import { Product } from '@/types';
import FloatingToolbar from '@/components/FloatingToolbar';
import WaitlistForm from '@/components/WaitlistForm';

interface ProductTemporalStateProps {
  product: Product;
}

export default function ProductTemporalState({ product }: ProductTemporalStateProps) {
  const t = useTranslations('productView');
  const locale = useLocale();

  const now = new Date();
  const availableFrom = product.available_from ? new Date(product.available_from) : null;
  const availableUntil = product.available_until ? new Date(product.available_until) : null;
  const isNotYetAvailable = availableFrom && availableFrom > now;
  const isExpired = availableUntil && availableUntil < now;

  // If waitlist is enabled, show the waitlist form
  if (product.enable_waitlist) {
    const reason = isNotYetAvailable ? 'not_started' : 'expired';
    return (
      <div>
        <FloatingToolbar position="top-right" />
        <WaitlistForm product={product} unavailableReason={reason} />
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
          {product.price === 0
            ? t('free')
            : new Intl.NumberFormat(locale, { style: 'currency', currency: product.currency || 'USD' }).format(product.price)}
        </div>

        <div className="text-4xl mb-4">⏰</div>
        <h2 className="text-2xl font-semibold text-sf-heading mb-2">
          {isNotYetAvailable ? t('comingSoon') : t('offerExpired')}
        </h2>
        <p className="text-sf-muted mb-6">
          {isNotYetAvailable ? t('comingSoonMessage') : t('offerExpiredMessage')}
        </p>

        {availableFrom && isNotYetAvailable && (
          <div className="bg-sf-accent-soft border border-sf-border-accent rounded-lg p-4 text-sf-accent mb-6">
            <p className="text-sm">{t('availableFromDate', { date: availableFrom.toLocaleDateString(locale) })}</p>
          </div>
        )}

        {availableUntil && isExpired && (
          <div className="bg-sf-danger-soft border border-sf-danger/30 rounded-lg p-4 text-sf-danger mb-6">
            <p className="text-sm">{t('wasAvailableUntil', { date: availableUntil.toLocaleDateString(locale) })}</p>
          </div>
        )}

        {isExpired && (
          <div className="bg-sf-danger-soft border border-sf-danger/30 rounded-lg p-4 text-sf-danger">
            <p className="text-sm">{t('previousAccessNote')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
