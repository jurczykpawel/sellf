// app/payment/error/page.tsx
// Payment error page

import { Suspense } from 'react';
import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';

interface PaymentErrorPageProps {
  searchParams: Promise<{ reason?: string }>;
}

async function PaymentErrorContent({ searchParams }: PaymentErrorPageProps) {
  const params = await searchParams;
  const reason = params.reason;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'payment.error' });

  const getErrorMessage = (reason?: string) => {
    switch (reason) {
      case 'payment_failed':
        return t('paymentFailed');
      case 'session_not_found':
        return t('sessionNotFound');
      case 'cancelled':
        return t('cancelled');
      default:
        return t('genericError');
    }
  };

  return (
    <div className="min-h-screen bg-gf-deep flex items-center justify-center">
      <div className="max-w-md mx-auto bg-gf-raised/80 border border-gf-border rounded-xl p-8 text-center">
        <div className="w-16 h-16 bg-gf-danger/20 border border-gf-danger/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gf-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gf-heading mb-2">{t('title')}</h1>
        <p className="text-gf-muted mb-6">
          {getErrorMessage(reason)}
        </p>
        <div className="space-y-3">
          <button
            onClick={() => window.history.back()}
            className="w-full bg-gf-accent hover:bg-gf-accent-hover text-white font-semibold py-2 px-4 rounded-xl transition-[background-color] duration-200"
          >
            {t('tryAgain')}
          </button>
          <Link
            href="/"
            className="block w-full bg-gf-raised border border-gf-border hover:border-gf-border-accent text-gf-heading font-semibold py-2 px-4 rounded-xl transition-[border-color] duration-200"
          >
            {t('goHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PaymentErrorPage(props: PaymentErrorPageProps) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gf-deep flex items-center justify-center">
        <div className="text-gf-heading">Loading...</div>
      </div>
    }>
      <PaymentErrorContent {...props} />
    </Suspense>
  );
}
