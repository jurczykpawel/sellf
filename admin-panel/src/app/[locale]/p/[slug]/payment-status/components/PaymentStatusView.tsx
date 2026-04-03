'use client';

import { useEffect, useRef } from 'react';
import Confetti from 'react-confetti';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { usePaymentStatus } from '../hooks';
import { PaymentStatusViewProps } from '../types';
import { getStatusInfo } from '../utils/helpers';
import { useTracking } from '@/hooks/useTracking';
import { generatePurchaseEventId } from '@/lib/tracking';
import {
  ErrorStatus,
  ProcessingStatus,
  SuccessStatus,
  MagicLinkStatus,
  PaymentStatusLayout,
  OtoOfferSection,
} from './';

export default function PaymentStatusView({
  product,
  accessGranted,
  errorMessage,
  paymentStatus,
  customerEmail,
  sessionId,
  paymentIntentId,
  redirectUrl,
  otoOffer,
}: PaymentStatusViewProps) {
  const t = useTranslations('paymentStatus');
  const tOto = useTranslations('oto');
  const router = useRouter();
  const { track } = useTracking();
  const purchaseTracked = useRef(false);

  // When OTO is shown, disable auto-redirect countdown
  const hasOtoOffer = otoOffer?.hasOto ?? false;

  const {
    auth,
    countdown,
    windowDimensions,
    terms,
    turnstile,
    magicLink,
  } = usePaymentStatus({
    paymentStatus,
    customerEmail,
    sessionId,
    paymentIntentId,
    product,
    accessGranted,
    redirectUrl,
    disableAutoRedirect: hasOtoOffer,
  });

  const statusInfo = getStatusInfo(paymentStatus, t);

  // Track purchase event when payment is successful
  useEffect(() => {
    if (purchaseTracked.current) return;

    // Fire purchase event for completed or magic_link_sent (guest purchase) status
    const isSuccessfulPurchase =
      (paymentStatus === 'completed' && accessGranted) ||
      paymentStatus === 'magic_link_sent';

    if (!isSuccessfulPurchase) return;

    purchaseTracked.current = true;

    // Deterministic event ID for Facebook dedup with server-side (Stripe webhook)
    const stripeId = sessionId || paymentIntentId;
    const transactionId = stripeId || `txn_${Date.now()}`;
    const purchaseEventId = stripeId ? generatePurchaseEventId(stripeId) : undefined;

    track('purchase', {
      transactionId,
      value: product.price,
      currency: product.currency,
      items: [{
        item_id: product.id,
        item_name: product.name,
        price: product.price,
        quantity: 1,
      }],
      userEmail: customerEmail || undefined,
    }, purchaseEventId);
  }, [paymentStatus, accessGranted, product, sessionId, paymentIntentId, customerEmail, track]);

  // Handle OTO skip action
  const handleOtoSkip = () => {
    if (auth.isAuthenticated) {
      // Logged-in user: go to product page
      router.push(`/p/${product.slug}`);
    } else {
      // Guest user: trigger magic link flow (handled by MagicLinkStatus visibility)
      // We'll show magic link section by hiding OTO
      magicLink.sendMagicLink();
    }
  };

  // Determine skip button label based on auth status
  const getSkipLabel = () => {
    if (auth.isAuthenticated) {
      return tOto('goToProduct');
    }
    return tOto('getMagicLink');
  };

  // Handle error states first
  if (errorMessage && (paymentStatus === 'failed' || paymentStatus === 'expired')) {
    return (
      <PaymentStatusLayout product={product} statusInfo={statusInfo}>
        <ErrorStatus product={product} errorMessage={errorMessage} />
      </PaymentStatusLayout>
    );
  }

  // Handle processing state
  if (paymentStatus === 'processing') {
    return (
      <PaymentStatusLayout product={product} statusInfo={statusInfo}>
        <ProcessingStatus />
      </PaymentStatusLayout>
    );
  }

  // Handle success state with auth check
  if (paymentStatus === 'completed' && accessGranted && auth.isAuthenticated) {
    return (
      <>
        {/* Full-page confetti overlay */}
        {windowDimensions.width > 0 && (
          <div className="fixed inset-0 pointer-events-none z-50">
            <Confetti
              width={windowDimensions.width}
              height={windowDimensions.height}
              recycle={false}
              numberOfPieces={800}
              gravity={0.25}
              initialVelocityX={{ min: -10, max: 10 }}
              initialVelocityY={{ min: -20, max: 5 }}
            />
          </div>
        )}
        <PaymentStatusLayout
          product={product}
          statusInfo={statusInfo}
        >
          {hasOtoOffer ? (
            <>
              <p className="text-sf-body mb-4">
                {t('accessGrantedToProduct', { productName: product.name })}
              </p>
              <OtoOfferSection
                otoOffer={otoOffer!}
                productSlug={product.slug}
                onSkip={handleOtoSkip}
                skipLabel={getSkipLabel()}
              />
            </>
          ) : (
            <SuccessStatus
              product={product}
              windowDimensions={windowDimensions}
              countdown={countdown}
            />
          )}
        </PaymentStatusLayout>
      </>
    );
  }

  // Handle magic link flow (guest purchase)
  if (paymentStatus === 'magic_link_sent' || paymentStatus === 'guest_purchase') {
    // Show OTO first for guests, then magic link after skip or OTO expiry
    const showOtoForGuest = hasOtoOffer && !magicLink.sent;

    return (
      <>
        {/* Full-page confetti overlay for successful payment */}
        {windowDimensions.width > 0 && (
          <div className="fixed inset-0 pointer-events-none z-50">
            <Confetti
              width={windowDimensions.width}
              height={windowDimensions.height}
              recycle={false}
              numberOfPieces={800}
              gravity={0.25}
              initialVelocityX={{ min: -10, max: 10 }}
              initialVelocityY={{ min: -20, max: 5 }}
            />
          </div>
        )}

        <PaymentStatusLayout
          product={product}
          statusInfo={statusInfo}
        >
          {showOtoForGuest ? (
            <>
              <p className="text-sf-body mb-4">
                {t('paymentSuccessful')} {t('accessGrantedToProduct', { productName: product.name })}
              </p>
              <OtoOfferSection
                otoOffer={otoOffer!}
                productSlug={product.slug}
                onSkip={handleOtoSkip}
                skipLabel={getSkipLabel()}
              />
            </>
          ) : (
            <MagicLinkStatus
              product={product}
              customerEmail={customerEmail}
              magicLinkSent={magicLink.sent}
              termsAccepted={terms.accepted}
              captchaToken={turnstile.token}
              captchaError={turnstile.error}
              captchaTimeout={turnstile.timeout}
              showInteractiveWarning={turnstile.showInteractiveWarning}
              magicLinkError={magicLink.error}
              onTermsAccept={terms.acceptTerms}
              onCaptchaSuccess={turnstile.setToken}
              onCaptchaError={turnstile.setError}
              onCaptchaTimeout={() => turnstile.setTimeout(true)}
              onBeforeInteractive={() => turnstile.setShowInteractiveWarning(true)}
              onAfterInteractive={() => turnstile.setShowInteractiveWarning(false)}
              sendMagicLink={magicLink.sendMagicLink}
              redirectUrl={redirectUrl}
              countdown={countdown}
            />
          )}
        </PaymentStatusLayout>
      </>
    );
  }

  // Fallback to error state
  return (
    <PaymentStatusLayout product={product} statusInfo={statusInfo}>
      <ErrorStatus 
        product={product} 
        errorMessage={errorMessage || `Unknown payment status: ${paymentStatus}`} 
      />
    </PaymentStatusLayout>
  );
}
