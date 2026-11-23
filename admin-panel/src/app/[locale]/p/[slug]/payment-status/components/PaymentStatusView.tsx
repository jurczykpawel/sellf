'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Confetti from 'react-confetti';
import { useTranslations } from 'next-intl';
import { usePaymentStatus } from '../hooks';
import { PaymentStatusViewProps } from '../types';
import { getStatusInfo } from '../utils/helpers';
import { useTracking } from '@/hooks/useTracking';
import { generatePurchaseEventId } from '@/lib/tracking/types';
import {
  ErrorStatus,
  ProcessingStatus,
  SuccessStatus,
  MagicLinkStatus,
  PaymentStatusLayout,
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
}: PaymentStatusViewProps) {
  const t = useTranslations('paymentStatus');
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (paymentStatus !== 'received') return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [paymentStatus, router]);
  const { track } = useTracking();
  const purchaseTracked = useRef(false);

  const {
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
    disableAutoRedirect: !redirectUrl,
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

  if (paymentStatus === 'account_mismatch') {
    return <PaymentStatusLayout product={product} statusInfo={statusInfo}>
      <p className="text-sf-body mb-6">{t('differentAccountDetails')}</p>
      <button disabled={switching} className="bg-sf-accent-bg text-white rounded-full px-6 py-3 disabled:opacity-50" onClick={async () => {
        setSwitching(true); setSwitchError(false);
        try {
          const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnUrl: window.location.pathname + window.location.search }) });
          if (!response.ok) throw new Error('Logout unavailable');
          localStorage.removeItem('sf_role');
          window.location.reload();
        } catch { setSwitching(false); setSwitchError(true); }
      }}>{t('signOutAndContinue')}</button>
      {switchError && <p role="alert">{t('verificationFailed')}</p>}
    </PaymentStatusLayout>;
  }

  if (paymentStatus === 'disputed') {
    return <PaymentStatusLayout product={product} statusInfo={statusInfo}><p className="text-sf-body">{t('paymentDisputedDetails')}</p></PaymentStatusLayout>;
  }

  if (paymentStatus === 'refunded') {
    return <PaymentStatusLayout product={product} statusInfo={statusInfo}><p className="text-sf-body">{t('paymentRefundedDetails')}</p></PaymentStatusLayout>;
  }

  if (paymentStatus === 'data_error') {
    return (
      <PaymentStatusLayout product={product} statusInfo={statusInfo}>
        <p className="text-sf-body">{t('orderNeedsReviewDetails')}</p>
        <code className="block break-all text-sm">{sessionId || paymentIntentId}</code>
      </PaymentStatusLayout>
    );
  }

  // Handle error states first
  if (errorMessage && (paymentStatus === 'failed' || paymentStatus === 'expired')) {
    return (
      <PaymentStatusLayout product={product} statusInfo={statusInfo}>
        <ErrorStatus product={product} errorMessage={errorMessage} />
      </PaymentStatusLayout>
    );
  }

  // Handle processing state
  if (paymentStatus === 'processing' || paymentStatus === 'received') {
    return (
      <PaymentStatusLayout product={product} statusInfo={statusInfo}>
        <ProcessingStatus received={paymentStatus === 'received'} />
      </PaymentStatusLayout>
    );
  }

  // Handle success state — server decides accessGranted; client auth is only
  // used downstream to pick between "go to product" and "send magic link" CTAs.
  if (paymentStatus === 'completed' && accessGranted) {
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
          <SuccessStatus
            product={product}
            windowDimensions={windowDimensions}
            countdown={countdown}
            redirecting={!!redirectUrl}
          />
        </PaymentStatusLayout>
      </>
    );
  }

  // Handle magic link flow (guest purchase)
  if (paymentStatus === 'magic_link_sent' || paymentStatus === 'guest_purchase') {
    // Show OTO first for guests, then magic link after skip or OTO expiry
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
            retryCountdown={magicLink.retryCountdown}
            sending={magicLink.sending}
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
