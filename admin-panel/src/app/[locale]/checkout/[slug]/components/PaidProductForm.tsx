'use client';

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { CheckoutElementsProvider } from '@stripe/react-stripe-js/checkout';
import type { StripeCheckoutElementsSdkOptions } from '@stripe/stripe-js';
import { Product } from '@/types';
import { ExpressCheckoutConfig } from '@/types/payment-config';
import type { TaxMode } from '@/lib/actions/shop-config';
import { formatPrice, STRIPE_MINIMUM_AMOUNT, STRIPE_MAX_AMOUNT } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import { signOutAndRedirectToCheckout } from '@/lib/actions/checkout';
import { useSearchParams } from 'next/navigation';
import { useConfig } from '@/components/providers/config-provider';
import { useTheme } from '@/components/providers/theme-provider';
import { useOrderBumps } from '@/hooks/useOrderBumps';
import CustomCheckoutFieldsForm from '@/components/checkout/CustomCheckoutFieldsForm';
import type {
  CustomFieldDefinition,
  CustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';
import { useTranslations } from 'next-intl';
import { useTracking } from '@/hooks/useTracking';
import { useCoupon } from '@/hooks/useCoupon';
import { useOto } from '@/hooks/useOto';
import { useFreeAccess } from '@/hooks/useFreeAccess';
import { useCheckoutRedirect } from '@/hooks/useCheckoutRedirect';
import { calculatePricing } from '@/hooks/usePricing';
import ProductShowcase from './ProductShowcase';
import CustomPaymentForm from './CustomPaymentForm';
import OtoCountdownBanner from '@/components/storefront/OtoCountdownBanner';
import OrderBumpList from './OrderBumpList';
import CouponField from './CouponField';
import PwywSection from './PwywSection';
import { getStripeClient } from '@/lib/stripe/client';

interface PaidProductFormProps {
  product: Product;
  paymentMethodOrder?: string[];
  expressCheckoutConfig?: ExpressCheckoutConfig;
  taxMode?: TaxMode;
  /**
   * `standalone` (default): full page shell + ProductShowcase + form.
   * `embedded`: form column only (host template provides product info / chrome).
   */
  layoutMode?: 'standalone' | 'embedded';
  afterCheckoutSlot?: React.ReactNode;
}

export default function PaidProductForm({ product, paymentMethodOrder, expressCheckoutConfig, taxMode, layoutMode = 'standalone', afterCheckoutSlot }: PaidProductFormProps) {
  const t = useTranslations('checkout');
  const isSubscription = product.product_type === 'subscription';
  // PWYW subscriptions allow buyers to choose their recurring amount. The
  // existing PwywSection works regardless of one-shot vs recurring — only
  // copy needs to switch to "Monthly amount" via the section's own i18n.
  const isPwywSubscription = isSubscription && product.allow_custom_price === true;
  const { user, isAdmin, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const config = useConfig();
  const { resolvedTheme } = useTheme();
  const { track } = useTracking();
  const trackingFired = useRef(false);

  // Funnel test mode: admin-only visual preview (no Stripe, no backend calls)
  const isFunnelTest = searchParams.get('funnel_test') === '1' && isAdmin;

  // Safe loading of Stripe to prevent crashes if key is missing
  const stripePromise = config.stripePublishableKey
    ? getStripeClient(config.stripePublishableKey)
    : null;

  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const lastCheckoutSessionSignature = useRef<string | null>(null);

  // Email state - from logged in user or from URL param (for OTO redirects)
  const urlEmail = searchParams.get('email');
  const [email, setEmail] = useState<string | undefined>(user?.email || urlEmail || undefined);

  // Sync email with user when they log in. setState-during-render replaces the
  // previous useEffect+setState cascade.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [trackedUserEmail, setTrackedUserEmail] = useState(user?.email);
  if (user?.email !== trackedUserEmail) {
    setTrackedUserEmail(user?.email);
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }

  // Custom price state (Pay What You Want)
  const getInitialAmount = () => {
    if (product.allow_custom_price) {
      if (product.price > 0) return product.price;
      const presets = product.custom_price_presets;
      const firstValidPreset = presets?.find(p => p > 0);
      if (firstValidPreset) return firstValidPreset;
      return product.custom_price_min ?? 5;
    }
    return product.price;
  };
  const [customAmount, setCustomAmount] = useState<number>(getInitialAmount);
  const [customAmountInput, setCustomAmountInput] = useState<string>(getInitialAmount().toString());
  const [customAmountError, setCustomAmountError] = useState<string | null>(null);

  // Pure validator — returns the error message (or null) without touching state.
  // The caller decides when to commit the error to UI state, which keeps this
  // function safe to call from useEffect bodies (no setState cascade).
  const checkCustomAmount = useCallback((amount: number): string | null => {
    if (!product.allow_custom_price) return null;
    const minPrice = product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT;
    if (amount < minPrice) {
      return t('customPrice.belowMinimum', { minimum: formatPrice(minPrice, product.currency) });
    }
    if (amount > STRIPE_MAX_AMOUNT) {
      return t('customPrice.aboveMaximum', { maximum: formatPrice(STRIPE_MAX_AMOUNT, product.currency) });
    }
    return null;
  }, [product, t]);

  // Compute isPwywFree once — shared with PwywSection
  const isPwywFree =
    product.allow_custom_price &&
    customAmount === 0 &&
    (product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT) === 0;

  // Order bumps
  const { orderBumps } = useOrderBumps(product.id);
  const [selectedBumpIds, setSelectedBumpIds] = useState<Set<string>>(new Set());

  // Custom checkout fields — admin defines, buyer fills. Values flow into the
  // pending payment_transactions row via the API POST below; per-field errors
  // round-trip back from server when validation fails (e.g. required missing).
  const customFieldDefs = useMemo<CustomFieldDefinition[]>(
    () => (Array.isArray(product.custom_checkout_fields) ? product.custom_checkout_fields : []),
    [product.custom_checkout_fields],
  );
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValues>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});

  const availableBumps = orderBumps.filter(
    ob => product.currency.toLowerCase() === ob.bump_currency.toLowerCase()
  );

  const toggleBump = (bumpProductId: string) => {
    setSelectedBumpIds(prev => {
      const next = new Set(prev);
      if (next.has(bumpProductId)) {
        next.delete(bumpProductId);
      } else {
        next.add(bumpProductId);
      }
      return next;
    });
  };

  const bumpSelected = selectedBumpIds.size > 0;

  // Coupon logic — URL coupon handling is absorbed inside the hook
  const coupon = useCoupon({
    productId: product.id,
    email,
    isOtoMode: searchParams.get('oto') === '1',
  });

  // OTO logic — funnel test OTO slug fetch is absorbed inside the hook
  const oto = useOto({
    urlCoupon: searchParams.get('coupon'),
    urlEmail,
    otoParam: searchParams.get('oto'),
    productId: product.id,
    isFunnelTest,
    onCouponReady: coupon.applyOtoCoupon,
  });

  // Checkout redirect
  const { hasAccess, grantAccess, countdown, handleRedirectToProduct } = useCheckoutRedirect({
    product,
    bumpSelected,
    isFunnelTest,
    funnelTestOtoSlug: oto.funnelTestOtoSlug,
    getFunnelTestOtoReady: oto.getFunnelTestOtoReady,
    getFunnelTestOtoSlug: oto.getFunnelTestOtoSlug,
  });

  const pricing = calculatePricing({
    baseProductId: product.id,
    productPrice: isSubscription ? product.recurring_price ?? 0 : product.price,
    productCurrency: product.currency,
    productVatRate: product.vat_rate ?? undefined,
    priceIncludesVat: product.price_includes_vat ?? undefined,
    customAmount: product.allow_custom_price ? customAmount : undefined,
    bumps: availableBumps.map(bump => ({
      id: bump.bump_product_id,
      price: bump.bump_price,
      selected: selectedBumpIds.has(bump.bump_product_id),
    })),
    coupon: coupon.appliedCoupon,
  });

  // Any coupon that reduces the whole selected checkout total to zero uses the
  // same grant flow as PWYW=0. If selected bumps remain payable, keep Stripe.
  const isFullDiscountCoupon = !!coupon.appliedCoupon && pricing.isFreeWithCoupon;

  const isFreeAccess = isPwywFree || isFullDiscountCoupon;
  const checkoutSessionSignature = JSON.stringify({
    productId: product.id,
    email: email || null,
    bumpProductIds: Array.from(selectedBumpIds).sort(),
    couponCode: coupon.appliedCoupon?.code ?? null,
    successUrl: searchParams.get('success_url') || null,
    customAmount: product.allow_custom_price ? customAmount : null,
  });

  // Free-access flow (shared by PWYW=0 and full-discount coupons)
  const pwyw = useFreeAccess({
    user,
    product,
    onAccessGranted: grantAccess,
    onError: setError,
    couponCode: isFullDiscountCoupon ? coupon.appliedCoupon?.code ?? null : null,
  });

  // Track view_item and begin_checkout on mount
  useEffect(() => {
    if (trackingFired.current) return;
    trackingFired.current = true;

    const trackingData = {
      value: isSubscription ? product.recurring_price ?? 0 : product.price,
      currency: product.currency,
      items: [{
        item_id: product.id,
        item_name: product.name,
        price: isSubscription ? product.recurring_price ?? 0 : product.price,
        quantity: 1,
      }],
    };

    track('view_item', trackingData);
    track('begin_checkout', trackingData);
  }, [product, track]);

  // Fetch Stripe client secret. Inlined inside the effect (rather than a
  // useCallback) so React Compiler doesn't flag the call site as
  // "setState-in-effect" — every setState here lands in an async then-callback,
  // not synchronously in the effect body.
  useEffect(() => {
    if (hasAccess || error || authLoading) return;
    if (isFunnelTest) return;
    const checkoutEmail = email?.trim();

    // Free-access paths (PWYW=0 or 100% coupon) bypass Stripe entirely — the
    // free-access section handles grant + magic-link flows. The render
    // gate checks `!isFreeAccess` before mounting the embedded checkout, so
    // we don't need to clear clientSecret here.
    if (isFreeAccess) return;

    if (product.allow_custom_price && checkCustomAmount(customAmount) !== null) {
      return;
    }

    const shouldRefreshExistingSession =
      !!clientSecret &&
      !!lastCheckoutSessionSignature.current &&
      lastCheckoutSessionSignature.current !== checkoutSessionSignature;

    if (clientSecret && !shouldRefreshExistingSession) {
      return;
    }

    const controller = new AbortController();

    fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        productId: product.id,
        clientSecret: shouldRefreshExistingSession ? clientSecret : undefined,
        email: checkoutEmail || undefined,
        bumpProductIds: selectedBumpIds.size > 0 ? Array.from(selectedBumpIds) : undefined,
        couponCode: coupon.appliedCoupon?.code,
        successUrl: searchParams.get('success_url') || undefined,
        customAmount: product.allow_custom_price ? customAmount : undefined,
        customFieldValues: customFieldDefs.length > 0 ? customFieldValues : undefined,
      }),
    })
      .then(async response => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          if (controller.signal.aborted) return;
          if (errorData.error === 'You already have access to this product') {
            grantAccess();
            return;
          }
          // Custom field validation surfaces per-field errors — keep them so
          // the form can highlight the offending input.
          if (errorData.error === 'Invalid custom field values' && errorData.details) {
            setCustomFieldErrors(errorData.details as Record<string, string>);
            setError(t('createSessionError'));
            return;
          }
          // Surface the server's error verbatim — previously a throw+catch
          // fallthrough replaced this with a generic "Failed to load checkout"
          // which masked actionable server messages (e.g. 401 coupon errors).
          setError(errorData.error || t('createSessionError'));
          return;
        }
        const data = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!data) {
          setError(t('loadError'));
          return;
        }
        setCustomFieldErrors({});
        // 100% coupon: server granted free access
        if (data.freeAccess) {
          grantAccess();
          return;
        }
        lastCheckoutSessionSignature.current = checkoutSessionSignature;
        setClientSecret(data.clientSecret);
        setCheckoutSessionId(data.checkoutSessionId);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(t('loadError'));
      });

    return () => controller.abort();
  }, [
    hasAccess, error, authLoading,
    product, email, selectedBumpIds, coupon.appliedCoupon, searchParams, t,
    customAmount, checkCustomAmount, isFunnelTest, isFreeAccess, grantAccess, isSubscription,
    clientSecret, checkoutSessionSignature,
  ]);

  const handleSignOutAndCheckout = async () => {
    try {
      await signOutAndRedirectToCheckout();
      window.location.reload();
    } catch (err) {
      console.error('[PaidProductForm] Sign out error:', err);
    }
  };

  const renderCheckoutForm = () => (
    <div className="w-full lg:w-1/2 lg:pl-8">
      {/* Funnel Test Banner */}
      {isFunnelTest && (
        <div className="mb-6 p-4 bg-sf-warning-soft border border-sf-warning/30 rounded-xl">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-sf-warning flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M5 14.5l-1.43 5.725a1.125 1.125 0 001.09 1.4h14.68a1.125 1.125 0 001.09-1.4L19 14.5" />
            </svg>
            <div>
              <p className="text-sm font-bold text-sf-warning">{t('funnelTest.banner')}</p>
              <p className="text-xs text-sf-warning/80">{t('funnelTest.description')}</p>
            </div>
          </div>
        </div>
      )}

      {/* OTO Countdown Banner */}
      {oto.isOtoMode && oto.otoInfo?.valid && oto.otoInfo.expires_at && !oto.otoExpired && (
        <OtoCountdownBanner
          expiresAt={oto.otoInfo.expires_at}
          discountType={oto.otoInfo.discount_type || 'percentage'}
          discountValue={oto.otoInfo.discount_value || 0}
          currency={product.currency}
          onExpire={oto.handleOtoExpire}
        />
      )}

      {/* PWYW Section — shown for one-shot products with PWYW enabled, AND
          for subscription products with allow_custom_price (Phase 3c, monthly
          PWYW amount picker). Subscription + PWYW takes the raw subscription
          path on submit; non-PWYW subscriptions keep the existing fixed-price
          Checkout Session flow. */}
      {(!isSubscription || isPwywSubscription) && (
        <PwywSection
          product={product}
          user={user}
          customAmount={customAmount}
          customAmountInput={customAmountInput}
          customAmountError={customAmountError}
          isFreeAccess={isFreeAccess}
          isFullDiscountCoupon={isFullDiscountCoupon}
          hasAccess={hasAccess}
          error={error}
          pwyw={pwyw}
          onAmountInputChange={(raw) => setCustomAmountInput(raw)}
          onAmountBlur={() => {
            const value = parseFloat(customAmountInput) || 0;
            setCustomAmount(value);
            if (value > 0) setCustomAmountInput(value.toString());
            setCustomAmountError(checkCustomAmount(value));
          }}
          onPresetClick={(preset) => {
            setCustomAmount(preset);
            setCustomAmountInput(preset.toString());
            setCustomAmountError(null);
            setError(null);
          }}
        />
      )}

      {/* Order Bumps */}
      {!isSubscription && !hasAccess && !error && !isFreeAccess && searchParams.get('hide_bump') !== 'true' && (
        <OrderBumpList
          bumps={availableBumps}
          selectedBumpIds={selectedBumpIds}
          onToggle={toggleBump}
        />
      )}

      {/* Coupon Field — still shown for full-discount coupons so the user can
          review/remove the applied code before confirming free access. */}
      {!isSubscription && !hasAccess && !error && !isPwywFree && (
        <CouponField
          couponCode={coupon.couponCode}
          appliedCoupon={coupon.appliedCoupon}
          isVerifying={coupon.isVerifyingCoupon}
          couponError={coupon.couponError}
          currency={product.currency}
          showCouponInput={coupon.showCouponInput}
          onCodeChange={coupon.setCouponCode}
          onApply={() => coupon.handleVerifyCoupon(coupon.couponCode)}
          onRemove={coupon.removeCoupon}
        />
      )}

      {/* Checkout Card */}
      {!(isFreeAccess && !error && !hasAccess) && (
        <div className="bg-sf-raised backdrop-blur-md rounded-2xl p-6 border border-sf-border relative overflow-hidden">
          {coupon.isVerifyingCoupon && (
            <div className="absolute top-0 left-0 h-0.5 bg-sf-accent-bg animate-pulse w-full" />
          )}

          <h2 className="text-xl font-semibold text-sf-heading mb-4">{t('title')}</h2>

          {/* Missing Config Alert */}
          {!config.stripePublishableKey && (
            <div className="mb-4 p-4 bg-sf-danger-soft border border-sf-danger/20 rounded-lg">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-sf-danger mt-0.5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <h3 className="text-sm font-bold text-sf-danger">Configuration Error</h3>
                  <p className="text-xs text-sf-danger mt-1">
                    Stripe API key is missing. Please check your environment variables (STRIPE_PUBLISHABLE_KEY).
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-6 bg-sf-danger-soft border border-sf-danger/20 rounded-xl backdrop-blur-sm">
              <div className="flex items-center">
                <div className="flex-shrink-0 w-10 h-10 bg-sf-danger-soft rounded-full flex items-center justify-center mr-4">
                  <svg className="w-5 h-5 text-sf-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-sf-danger mb-1">{t('paymentError')}</h3>
                  <p className="text-sf-danger text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          {hasAccess && (
            <div className="mb-4 p-6 bg-sf-success-soft border border-sf-success/20 rounded-xl backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex-shrink-0 w-10 h-10 bg-sf-success-soft rounded-full flex items-center justify-center mr-4">
                    <svg className="w-5 h-5 text-sf-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-sf-success mb-1">{t('accessGranted')}</h3>
                    <p className="text-sf-success text-sm">{t('alreadyHasAccess')}</p>
                    <p className="text-sf-success/70 text-xs mt-1 flex items-center">
                      <svg className="w-3 h-3 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {t('autoRedirect', { seconds: countdown })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleRedirectToProduct}
                  className="bg-sf-success hover:bg-sf-success/90 text-sf-inverse px-6 py-3 rounded-full transition-all duration-200 font-medium text-sm active:scale-[0.98]"
                >
                  {t('goToProduct')}
                </button>
              </div>
            </div>
          )}

          {/* Funnel test: Complete Test button instead of Stripe */}
          {isFunnelTest && !error && !hasAccess && (
            <button
              onClick={grantAccess}
              className="w-full py-4 px-6 bg-sf-warning hover:bg-sf-warning/90 text-sf-inverse font-bold rounded-xl transition-all active:scale-[0.98] text-lg"
            >
              {t('funnelTest.completeButton')}
            </button>
          )}

          {!isFunnelTest && !error && !hasAccess && !isFreeAccess && stripePromise && clientSecret && (
            <CheckoutElementsProvider
              key={`${product.id}-${checkoutSessionId || clientSecret}-${resolvedTheme}`}
              stripe={stripePromise}
              options={{
                clientSecret,
                elementsOptions: {
                  appearance: {
                    theme: resolvedTheme === 'dark' ? 'night' : 'stripe',
                    variables: {
                      colorPrimary: '#3b82f6',
                      ...(resolvedTheme === 'dark' ? {
                        colorBackground: '#1e293b',
                        colorText: '#ffffff',
                      } : {}),
                      colorDanger: '#ef4444',
                      fontFamily: 'system-ui, sans-serif',
                      borderRadius: '8px',
                    },
                  },
                },
              } satisfies StripeCheckoutElementsSdkOptions}
            >
              <CustomPaymentForm
                product={product}
                email={email}
                bumpProducts={availableBumps}
                selectedBumpIds={selectedBumpIds}
                appliedCoupon={coupon.appliedCoupon ?? undefined}
                onChangeAccount={handleSignOutAndCheckout}
                customAmount={product.allow_custom_price ? customAmount : undefined}
                customAmountError={product.allow_custom_price ? customAmountError : null}
                clientSecret={clientSecret || undefined}
                pricing={pricing}
                paymentMethodOrder={paymentMethodOrder}
                expressCheckoutConfig={expressCheckoutConfig}
                taxMode={taxMode}
                customFieldDefs={customFieldDefs}
                customFieldValues={customFieldValues}
                onCustomFieldValuesChange={setCustomFieldValues}
                customFieldErrors={customFieldErrors}
                afterCheckoutSlot={afterCheckoutSlot}
              />
            </CheckoutElementsProvider>
          )}
        </div>
      )}
    </div>
  );

  if (layoutMode === 'embedded') {
    // Host template (e.g. tip-jar) provides chrome + product info; we render
    // ONLY the form column so the page doesn't duplicate showcase / wrapper.
    return (
      <div className="w-full p-6 lg:p-8 bg-sf-base border border-sf-border shadow-[var(--sf-shadow-accent)] backdrop-blur-md rounded-2xl">
        {renderCheckoutForm()}
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-sf-deep to-sf-raised p-4 lg:p-8">
      <div className="w-full max-w-7xl mx-auto p-6 lg:p-8 bg-sf-base border border-sf-border shadow-[var(--sf-shadow-accent)] backdrop-blur-md rounded-2xl">
        <div className="flex flex-col lg:flex-row">
          <ProductShowcase product={product} taxMode={taxMode} />
          {renderCheckoutForm()}
        </div>
      </div>
    </div>
  );
}
