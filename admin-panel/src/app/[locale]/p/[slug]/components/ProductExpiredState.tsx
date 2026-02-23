import { useTranslations } from 'next-intl';
import { Product } from '@/types';
import FloatingToolbar from '@/components/FloatingToolbar';

interface ProductExpiredStateProps {
  product: Product;
}

export default function ProductExpiredState({ product }: ProductExpiredStateProps) {
  const t = useTranslations('productView');

  return (
    <div className="flex justify-center items-center min-h-screen bg-gf-deep">
      <FloatingToolbar position="top-right" />

      <div className="max-w-4xl mx-auto p-8 bg-gf-raised/80 border border-gf-border rounded-xl shadow-2xl text-center">
        <div className="text-6xl mb-4">{product.icon || '📦'}</div>
        <h1 className="text-3xl font-bold text-gf-heading mb-2">{product.name}</h1>
        {product.description && (
          <p className="text-gf-body mb-6 max-w-2xl mx-auto">{product.description}</p>
        )}
        <div className="text-xl font-semibold text-gf-accent mb-8">
          {product.price === 0 ? 'FREE' : `$${product.price}`}
        </div>

        <div className="text-4xl mb-4">⏰</div>
        <h2 className="text-2xl font-semibold text-gf-heading mb-2">{t('accessExpired')}</h2>
        <p className="text-gf-muted mb-6">{t('accessExpiredMessage')}</p>
        <div className="bg-gf-danger-soft border border-gf-danger/30 rounded-lg p-4 text-gf-danger">
          <p className="text-sm">{t('canPurchaseAgain')}</p>
        </div>
      </div>
    </div>
  );
}
