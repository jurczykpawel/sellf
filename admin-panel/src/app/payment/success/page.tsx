// app/payment/success/page.tsx
// Stripe return hop - forwards Checkout Sessions and legacy PaymentIntent returns to the payment status page

import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getPublicBaseUrl } from '@/lib/utils/canonical-url';
import { resolveSafeRedirectPath } from '@/lib/validations/redirect';
import { paymentStatusUrl, productUrl } from '@/lib/utils/product-urls';

interface PaymentSuccessPageProps {
  searchParams: Promise<{
    session_id?: string;
    locale?: string;
    product?: string;
    payment_intent?: string;
    product_id?: string;
    redirect_status?: string;
    success_url?: string;
  }>;
}

async function PaymentSuccessPage({ searchParams }: PaymentSuccessPageProps) {
  const params = await searchParams;
  const locale = params.locale === 'pl' || params.locale === 'en' ? params.locale : await getLocale();

  // Handle legacy PaymentIntent flow
  const paymentIntent = params.payment_intent;
  const productId = params.product_id;
  const redirectStatus = params.redirect_status;
  const successUrl = params.success_url ? resolveSafeRedirectPath(params.success_url) : null;

  // Handle Checkout Sessions flow
  const sessionId = params.session_id;
  const productSlug = params.product;

  // If we have success_url from OTO/funnel, redirect there (with open redirect protection)
  if (successUrl && redirectStatus === 'succeeded') {
    redirect(successUrl);
  }

  if (sessionId && productSlug) {
    let url = `/${locale}${paymentStatusUrl(productSlug)}?session_id=${encodeURIComponent(sessionId)}`;
    if (successUrl) url += `&success_url=${encodeURIComponent(successUrl)}`;
    redirect(url);
  }

  // LEGACY FLOW: If we have payment_intent, use the Payment Intent flow
  if (paymentIntent && redirectStatus === 'succeeded') {
    let resolvedSlug = productSlug;
    if (!resolvedSlug && productId && /^[0-9a-f-]{36}$/i.test(productId)) {
      try {
        const response = await fetch(
          `${getPublicBaseUrl()}/api/products/${productId}`,
          { signal: AbortSignal.timeout(5000) }
        );
        const data = await response.json();
        resolvedSlug = data.product?.slug;
      } catch (error) {
        console.error('Failed to fetch product:', error);
      }
    }
    if (resolvedSlug) {
      const base = `/${locale}${paymentStatusUrl(resolvedSlug)}`;
      const sep = '?';
      let url = `${base}${sep}payment_intent=${encodeURIComponent(paymentIntent)}`;
      if (successUrl) url += `&success_url=${encodeURIComponent(successUrl)}`;
      redirect(url);
    }
  }

  // OLD FLOW: If we have a product slug (embedded checkout), redirect to it
  if (productSlug && !paymentIntent) {
    redirect(`${productUrl(productSlug, locale)}?payment=success`);
  }

  // Nothing to resolve (no purchase in the URL): never claim success, go to the shop.
  redirect(`/${locale}`);
}

export default PaymentSuccessPage;
