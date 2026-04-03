import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Product } from '../types';

interface ErrorStatusProps {
  product: Product;
  errorMessage: string;
}

export default function ErrorStatus({ product, errorMessage }: ErrorStatusProps) {
  const t = useTranslations('paymentStatus');
  const router = useRouter();

  return (
    <>
      <p className="text-sf-body mb-6">{errorMessage}</p>

      <div className="space-y-4">
        <button
          onClick={() => router.push(`/p/${product.slug}`)}
          className="bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-medium py-3 px-6 rounded-full transition-[background-color] duration-200 active:scale-[0.98]"
        >
          {t('tryAgain')}
        </button>
        <p className="text-sf-muted text-sm">
          {t('havingTrouble')} <span className="text-sf-accent cursor-pointer underline hover:no-underline">{t('contactSupport')}</span>
        </p>
      </div>
    </>
  );
}
