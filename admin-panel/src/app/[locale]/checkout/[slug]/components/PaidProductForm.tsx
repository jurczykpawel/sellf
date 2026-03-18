'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
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
import { useTranslations } from 'next-intl';
import { useTracking } from '@/hooks/useTracking';
import { useCoupon } from '@/hooks/useCoupon';
import { useOto } from '@/hooks/useOto';
import { usePwywFreeAccess } from '@/hooks/usePwywFreeAccess';
import { useCheckoutRedirect } from '@/hooks/useCheckoutRedirect';
import ProductShowcase from './ProductShowcase';
import CustomPaymentForm from './CustomPaymentForm';
import OtoCountdownBanner from '@/components/storefront/OtoCountdownBanner';
import OrderBumpList from './OrderBumpList';
import CouponField from './CouponField';
import PwywSection from './PwywSection';

interface PaidProductFormProps {
  product: Product;
  paymentMethodOrder?: string[];
  expressCheckoutConfig?: ExpressCheckoutConfig;
  taxMode?: TaxMode;
  /** Seller slug for marketplace products (undefined = platform owner / seller_main) */
  sellerSlug?: string;
}

export default function PaidProductForm({ product, paymentMethodOrder, expressCheckoutConfig, taxMode, sellerSlug }: PaidProductFormProps) {
  const t = useTranslations('checkout');
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
    ? loadStripe(config.stripePublishableKey)
    : null;

  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  // Email state - from logged in user or from URL param (for OTO redirects)
  const urlEmail = searchParams.get('email');
  const [email, setEmail] = useState<string | undefined>(user?.email || urlEmail || undefined);

  // Sync email with user when they log in
  useEffect(() => {
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [user?.email, email]);

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

  // Validate custom amount
  const validateCustomAmount = useCallback((amount: number): boolean => {
    if (!product.allow_custom_price) return true;
    const minPrice = product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT;
    if (amount < minPrice) {
      setCustomAmountError(t('customPrice.belowMinimum', { minimum: formatPrice(minPrice, product.currency) }));
      return false;
    }
    if (amount > STRIPE_MAX_AMOUNT) {
      setCustomAmountError(t('customPrice.aboveMaximum', { maximum: formatPrice(STRIPE_MAX_AMOUNT, product.currency) }));
      return false;
    }
    setCustomAmountError(null);
    return true;
  }, [product, t]);

  // Compute isPwywFree once — shared with PwywSection
  const isPwywFree =
    product.allow_custom_price &&
    customAmount === 0 &&
    (product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT) === 0;

  // Order bumps
  const { orderBumps } = useOrderBumps(product.id, sellerSlug);
  const [selectedBumpIds, setSelectedBumpIds] = useState<Set<string>>(new Set());

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
    sellerSlug,
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
  });

  // PWYW free access
  const pwyw = usePwywFreeAccess({
    user,
    product,
    onAccessGranted: grantAccess,
    onError: setError,
  });

  // Track view_item and begin_checkout on mount
  useEffect(() => {
    if (trackingFired.current) return;
    trackingFired.current = true;

    const trackingData = {
      value: product.price,
      currency: product.currency,
      items: [{
        item_id: product.id,
        item_name: product.name,
        price: product.price,
        quantity: 1,
      }],
    };

    track('view_item', trackingData);
    track('begin_checkout', trackingData);
  }, [product, track]);

  // Fetch Stripe client secret
  const fetchClientSecret = useCallback(async () => {
    if (isFunnelTest) return;

    if (product.allow_custom_price && customAmount === 0 && (product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT) === 0) {
      setClientSecret(null);
      return;
    }

    if (product.allow_custom_price && !validateCustomAmount(customAmount)) {
      return;
    }

    try {
      const response = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          email: email || undefined,
          bumpProductIds: selectedBumpIds.size > 0 ? Array.from(selectedBumpIds) : undefined,
          couponCode: coupon.appliedCoupon?.code,
          successUrl: searchParams.get('success_url') || undefined,
          customAmount: product.allow_custom_price ? customAmount : undefined,
          sellerSlug: sellerSlug || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.error === 'You already have access to this product') {
          grantAccess();
          return;
        }
        setError(errorData.error || t('createSessionError'));
        throw new Error(errorData.error || t('createSessionError'));
      }

      const data = await response.json();

      // 100% coupon: server granted free access
      if (data.freeAccess) {
        grantAccess();
        return;
      }

      setClientSecret(data.clientSecret);
    } catch {
      setError(t('loadError'));
    }
  }, [product, email, selectedBumpIds, coupon.appliedCoupon, searchParams, t, customAmount, validateCustomAmount, isFunnelTest, grantAccess]);

  useEffect(() => {
    if (!hasAccess && !error && !authLoading) {
      fetchClientSecret();
    }
  }, [fetchClientSecret, hasAccess, error, authLoading]);

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

      {/* PWYW Section (price picker + free access) */}
      <PwywSection
        product={product}
        user={user}
        customAmount={customAmount}
        customAmountInput={customAmountInput}
        customAmountError={customAmountError}
        isPwywFree={isPwywFree}
        hasAccess={hasAccess}
        error={error}
        pwyw={pwyw}
        onAmountInputChange={(raw) => setCustomAmountInput(raw)}
        onAmountBlur={() => {
          const value = parseFloat(customAmountInput) || 0;
          setCustomAmount(value);
          if (value > 0) setCustomAmountInput(value.toString());
          validateCustomAmount(value);
        }}
        onPresetClick={(preset) => {
          setCustomAmount(preset);
          setCustomAmountInput(preset.toString());
          setCustomAmountError(null);
          setError(null);
        }}
      />

      {/* Order Bumps */}
      {!hasAccess && !error && !isPwywFree && searchParams.get('hide_bump') !== 'true' && (
        <OrderBumpList
          bumps={availableBumps}
          selectedBumpIds={selectedBumpIds}
          onToggle={toggleBump}
        />
      )}

      {/* Coupon Field */}
      {!hasAccess && !error && !isPwywFree && (
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
      {!(isPwywFree && !error && !hasAccess) && (
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

          {!isFunnelTest && !error && !hasAccess && !isPwywFree && stripePromise && clientSecret && (
            <Elements
              key={`${product.id}-${clientSecret}-${resolvedTheme}`}
              stripe={stripePromise}
              options={{
                clientSecret,
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
              } as StripeElementsOptions}
            >
              <CustomPaymentForm
                product={product}
                email={email}
                bumpProducts={availableBumps}
                selectedBumpIds={selectedBumpIds}
                appliedCoupon={coupon.appliedCoupon ?? undefined}
                successUrl={searchParams.get('success_url') || undefined}
                onChangeAccount={handleSignOutAndCheckout}
                customAmount={product.allow_custom_price ? customAmount : undefined}
                customAmountError={product.allow_custom_price ? customAmountError : null}
                clientSecret={clientSecret || undefined}
                paymentMethodOrder={paymentMethodOrder}
                expressCheckoutConfig={expressCheckoutConfig}
                taxMode={taxMode}
                sellerSlug={sellerSlug}
              />
            </Elements>
          )}
        </div>
      )}
    </div>
  );

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
