/** Completed purchase navigation. @see PaymentStatusView.tsx */
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { productUrl } from '@/lib/utils/product-urls';
import type { Product, WindowDimensions } from '@/app/[locale]/p/[slug]/payment-status/types';

interface SuccessStatusProps { product: Product; windowDimensions: WindowDimensions; countdown: number; redirecting?: boolean }
export default function SuccessStatus({ product, countdown, redirecting = false }: SuccessStatusProps) {
  const t = useTranslations('paymentStatus');
  const locale = useLocale();
  return <div className="space-y-5">
    <p className="text-sf-body">{t('purchaseReceipt', { productName: product.name })}</p>
    <p className="text-sm text-sf-muted">{t('purchaseLibraryHint')}</p>
    <Link className="block rounded-xl bg-sf-accent-bg px-5 py-3 font-semibold text-sf-inverse hover:bg-sf-accent-hover" href={productUrl(product.slug, locale)}>{t('openPurchase')}</Link>
    <Link className="inline-block text-sm text-sf-accent underline underline-offset-4" href={`/${locale}/my-products`}>{t('purchaseLibrary')}</Link>
    {redirecting && <p className="text-sm text-sf-muted">{t('redirectingToProduct')} {countdown}</p>}
  </div>;
}
