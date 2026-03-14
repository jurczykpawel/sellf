// app/payment/success/page.tsx
// Payment success page - handles both Embedded Checkout and PaymentIntent flows

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';

interface PaymentSuccessPageProps {
  searchParams: Promise<{
    session_id?: string;
    product?: string;
    payment_intent?: string;
    product_id?: string;
    redirect_status?: string;
    success_url?: string;
  }>;
}

async function PaymentSuccessContent({ searchParams }: PaymentSuccessPageProps) {
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'payment.success' });

  // Handle new PaymentIntent flow
  const paymentIntent = params.payment_intent;
  const productId = params.product_id;
  const redirectStatus = params.redirect_status;
  const successUrl = params.success_url;

  // Handle old Embedded Checkout flow
  const sessionId = params.session_id;
  const productSlug = params.product;

  // If we have success_url from OTO/funnel, redirect there (with open redirect protection)
  if (successUrl && redirectStatus === 'succeeded' && isSafeRedirectUrl(successUrl)) {
    redirect(successUrl);
  }

  // NEW FLOW: If we have payment_intent, use the new Payment Intent flow
  if (paymentIntent && redirectStatus === 'succeeded') {
    // Use productSlug if available (it's in URL as 'product' param from CustomPaymentForm)
    // Otherwise fetch product by ID
    if (productSlug) {
      let redirectUrl = `/${locale}/p/${productSlug}/payment-status?payment_intent=${paymentIntent}`;
      if (successUrl) {
        redirectUrl += `&success_url=${encodeURIComponent(successUrl)}`;
      }
      redirect(redirectUrl);
    } else if (productId) {
      try {
        const response = await fetch(`${process.env.SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/products/${productId}`);
        const data = await response.json();
        if (data.product?.slug) {
          let redirectUrl = `/${locale}/p/${data.product.slug}/payment-status?payment_intent=${paymentIntent}`;
          if (successUrl) {
            redirectUrl += `&success_url=${encodeURIComponent(successUrl)}`;
          }
          redirect(redirectUrl);
        }
      } catch (error) {
        // If fetch fails, show success page anyway
        console.error('Failed to fetch product:', error);
      }
    }
  }

  // OLD FLOW: If we have a product slug (embedded checkout), redirect to it
  if (productSlug && !paymentIntent) {
    redirect(`/p/${productSlug}?payment=success`);
  }

  // If we have a session ID but no product slug, show generic success page (old flow)
  if (sessionId) {
    // You could fetch additional details here if needed
  }

  return (
    <div className="min-h-screen bg-sf-deep flex items-center justify-center">
      <div className="max-w-md mx-auto bg-sf-raised/80 border border-sf-border rounded-2xl p-8 text-center">
        <div className="w-16 h-16 bg-sf-success/20 border border-sf-success/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-sf-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-sf-heading mb-2">{t('title')}</h1>
        <p className="text-sf-muted mb-6">
          {t('description')}
        </p>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage(props: PaymentSuccessPageProps) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-sf-deep flex items-center justify-center">
        <div className="text-sf-heading">Loading...</div>
      </div>
    }>
      <PaymentSuccessContent {...props} />
    </Suspense>
  );
}
