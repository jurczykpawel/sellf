/** Checkout loading state. @see app/[locale]/checkout/[slug]/components/CustomPaymentForm.tsx */
import { useTranslations } from 'next-intl';

export default function PaymentFormSkeleton() {
  const t = useTranslations('checkout');
  return <div role="status" aria-live="polite" className="space-y-4 rounded-xl border border-sf-border bg-sf-base p-4">
    <p className="text-sm text-sf-muted">{t('loadingPaymentMethods')}</p>
    <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
      <div className="grid grid-cols-2 gap-3"><div className="h-11 rounded-lg bg-sf-hover" /><div className="h-11 rounded-lg bg-sf-hover" /></div>
      <div className="h-11 rounded-lg bg-sf-hover" /><div className="h-11 rounded-lg bg-sf-hover" />
    </div>
  </div>;
}
