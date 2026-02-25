'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import { Product } from '@/types';
import { ExpressCheckoutConfig } from '@/types/payment-config';
import { formatPrice } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import { signOutAndRedirectToCheckout } from '@/lib/actions/checkout';
import { useRouter } from 'next/navigation';
import { useConfig } from '@/components/providers/config-provider';
import { useTheme } from '@/components/providers/theme-provider';
import { useOrderBumps } from '@/hooks/useOrderBumps';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';
import { useTranslations } from 'next-intl';
import { useTracking } from '@/hooks/useTracking';
import ProductShowcase from './ProductShowcase';
import CustomPaymentForm from './CustomPaymentForm';
import OtoCountdownBanner from '@/components/storefront/OtoCountdownBanner';

interface PaidProductFormProps {
  product: Product;
  paymentMethodOrder?: string[];
  expressCheckoutConfig?: ExpressCheckoutConfig;
}

export default function PaidProductForm({ product, paymentMethodOrder, expressCheckoutConfig }: PaidProductFormProps) {
  const t = useTranslations('checkout');
  const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const config = useConfig();
  const { resolvedTheme } = useTheme();
  const { track } = useTracking();
  const trackingFired = useRef(false);
  
  // Safe loading of Stripe to prevent crashes if key is missing
  const stripePromise = config.stripePublishableKey 
    ? loadStripe(config.stripePublishableKey) 
    : null;
  
  const [error, setError] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [countdown, setCountdown] = useState(5);

  // Custom price state (Pay What You Want)
  // customAmount = numeric value for API/logic
  // customAmountInput = string value for input display (allows typing "5.", "5.00", etc.)
  const getInitialAmount = () => {
    if (product.allow_custom_price) {
      // Product price is the suggested amount; fall back to first preset or minimum
      if (product.price > 0) return product.price;
      const presets = product.custom_price_presets;
      const firstValidPreset = presets?.find(p => p > 0);
      if (firstValidPreset) return firstValidPreset;
      return product.custom_price_min || 5;
    }
    return product.price;
  };
  const [customAmount, setCustomAmount] = useState<number>(getInitialAmount);
  const [customAmountInput, setCustomAmountInput] = useState<string>(getInitialAmount().toString());
  const [customAmountError, setCustomAmountError] = useState<string | null>(null);

  // Email state - from logged in user, or from URL param (for OTO redirects)
  const urlEmail = searchParams.get('email');
  const [email, setEmail] = useState<string | undefined>(user?.email || urlEmail || undefined);

  // Sync email with user when they log in
  useEffect(() => {
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [user?.email, email]);

  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [isVerifyingCoupon, setIsVerifyingCoupon] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponManuallyRemoved, setCouponManuallyRemoved] = useState(false);
  const [lastCheckedUrlCoupon, setLastCheckedUrlCoupon] = useState<string | null>(null);

  // OTO (One-Time Offer) state
  const [isOtoMode, setIsOtoMode] = useState(false);
  const [otoInfo, setOtoInfo] = useState<{
    valid: boolean;
    expires_at?: string;
    discount_type?: 'percentage' | 'fixed';
    discount_value?: number;
    seconds_remaining?: number;
  } | null>(null);
  const [otoExpired, setOtoExpired] = useState(false);

  // Reset manual removal flag when email changes to allow auto-apply for new email
  useEffect(() => {
    setCouponManuallyRemoved(false);
  }, [email]);

  // Order bump state
  const { orderBump } = useOrderBumps(product.id);
  const [bumpSelected, setBumpSelected] = useState(false);

  // Check if currency matches (Stripe requires same currency for all line items)
  const isCurrencyMatching = orderBump && product.currency.toLowerCase() === orderBump.bump_currency.toLowerCase();

  // Track view_item and begin_checkout events on mount
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

    // Fire view_item first, then begin_checkout
    track('view_item', trackingData);
    track('begin_checkout', trackingData);
  }, [product, track]);

  // Handle coupon verification
  const handleVerifyCoupon = useCallback(async (code: string, currentEmail?: string) => {
    if (!code) return;
    setIsVerifyingCoupon(true);
    setCouponError(null);
    setCouponManuallyRemoved(false); 
    try {
      const res = await fetch('/api/coupons/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code, 
          productId: product.id, 
          email: currentEmail || email 
        }),
      });
      const data = await res.json();
      if (data.valid) {
        setAppliedCoupon(data);
        setCouponCode(data.code);
        setShowCouponInput(true);
      } else {
        setCouponError(data.error || t('invalidCoupon'));
        setAppliedCoupon(null);
      }
    } catch (err) {
      setCouponError(t('verifyError'));
    } finally {
      setIsVerifyingCoupon(false);
    }
  }, [product.id, email, t]);

  // Auto-apply logic for email change
  useEffect(() => {
    const checkAutoApply = async () => {
      if (!email || appliedCoupon || couponManuallyRemoved) return;
      try {
        const res = await fetch('/api/coupons/auto-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, productId: product.id }),
        });
        const data = await res.json();
        if (data.found) {
          setAppliedCoupon(data);
          setCouponCode(data.code);
          addToast?.(t('discountApplied', { discount: '' }).replace('  ', ' '), 'success');
        }
      } catch (err) {
        // Silent fail
      }
    };

    const timer = setTimeout(checkAutoApply, 500);
    return () => clearTimeout(timer);
  }, [email, product.id, appliedCoupon, couponManuallyRemoved, addToast, t]);

  // Handle URL coupon param and OTO mode
  useEffect(() => {
    const urlCoupon = searchParams.get('coupon');
    const showPromo = searchParams.get('show_promo');
    const otoParam = searchParams.get('oto');

    if (showPromo === 'true') {
      setShowCouponInput(true);
    }

    // Check if this is an OTO redirect (urlEmail is already extracted at component level)
    if (otoParam === '1' && urlCoupon && urlEmail) {
      setIsOtoMode(true);

      // Fetch OTO coupon info for timer
      const fetchOtoInfo = async () => {
        try {
          const res = await fetch(`/api/oto/info?code=${encodeURIComponent(urlCoupon)}&email=${encodeURIComponent(urlEmail)}`);
          const data = await res.json();

          if (data.valid) {
            setOtoInfo(data);
            // Also apply the coupon
            setAppliedCoupon({
              code: urlCoupon,
              discount_type: data.discount_type,
              discount_value: data.discount_value,
            });
            setCouponCode(urlCoupon);
            setShowCouponInput(true);
            setLastCheckedUrlCoupon(urlCoupon);
          } else {
            // OTO expired or invalid
            setOtoExpired(true);
            setIsOtoMode(false);
          }
        } catch (err) {
          console.error('Failed to fetch OTO info:', err);
          setOtoExpired(true);
          setIsOtoMode(false);
        }
      };

      fetchOtoInfo();
    } else if (urlCoupon && urlCoupon !== lastCheckedUrlCoupon) {
      // Regular coupon handling (non-OTO)
      setLastCheckedUrlCoupon(urlCoupon);
      setCouponCode(urlCoupon); // Populate input immediately
      setShowCouponInput(true); // Always show input if coupon is in URL
      handleVerifyCoupon(urlCoupon);
    }
  }, [searchParams, handleVerifyCoupon, lastCheckedUrlCoupon, urlEmail]);

  // Handle OTO expiry
  const handleOtoExpire = useCallback(() => {
    setOtoExpired(true);
    setAppliedCoupon(null);
    setCouponCode('');
    setIsOtoMode(false);
    addToast?.(t('otoExpired'), 'warning');
  }, [addToast, t]);

  const handleSignOutAndCheckout = async () => {
    try {
      await signOutAndRedirectToCheckout();
      window.location.reload();
    } catch {
      // Silent error
    }
  };

  const handleRedirectToProduct = useCallback(() => {
    if (bumpSelected) {
      router.push('/my-products');
    } else {
      router.push(`/p/${product.slug}`);
    }
  }, [product.slug, router, bumpSelected]);

  useEffect(() => {
    if (hasAccess && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (hasAccess && countdown === 0) {
      handleRedirectToProduct();
    }
  }, [hasAccess, countdown, handleRedirectToProduct]);

  const [clientSecret, setClientSecret] = useState<string | null>(null);

  // Validate custom amount
  const STRIPE_MAX_AMOUNT = 999999.99; // Stripe's maximum amount limit
  const validateCustomAmount = useCallback((amount: number): boolean => {
    if (!product.allow_custom_price) return true;
    const minPrice = product.custom_price_min || 0.50;
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

  const fetchClientSecret = useCallback(async () => {
    // Validate custom amount before fetching
    if (product.allow_custom_price && !validateCustomAmount(customAmount)) {
      return;
    }

    try {
      const response = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          email: email || undefined, // Pass undefined instead of empty string for logged-in users
          bumpProductId: bumpSelected && orderBump ? orderBump.bump_product_id : undefined,
          couponCode: appliedCoupon?.code,
          successUrl: searchParams.get('success_url') || undefined,
          customAmount: product.allow_custom_price ? customAmount : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.error === 'You already have access to this product') {
          setHasAccess(true);
          return;
        }
        setError(errorData.error || t('createSessionError'));
        throw new Error(errorData.error || t('createSessionError'));
      }

      const data = await response.json();
      setClientSecret(data.clientSecret);
    } catch (err) {
      setError(t('loadError'));
      throw err;
    }
  }, [product, email, bumpSelected, orderBump, appliedCoupon, searchParams, t, customAmount, validateCustomAmount]);

  // Fetch client secret when component mounts or dependencies change
  useEffect(() => {
    if (!hasAccess && !error) {
      fetchClientSecret();
    }
  }, [fetchClientSecret, hasAccess, error]);

  const renderCheckoutForm = () => (
    <div className="w-full lg:w-1/2 lg:pl-8">
      {/* OTO Countdown Banner */}
      {isOtoMode && otoInfo?.valid && otoInfo.expires_at && !otoExpired && (
        <OtoCountdownBanner
          expiresAt={otoInfo.expires_at}
          discountType={otoInfo.discount_type || 'percentage'}
          discountValue={otoInfo.discount_value || 0}
          currency={product.currency}
          onExpire={handleOtoExpire}
        />
      )}

      {/* Pay What You Want - Custom Price Selection */}
      {product.allow_custom_price && !hasAccess && !error && (
        <div className="mb-6 p-5 bg-gray-50 dark:bg-white/5 dark:backdrop-blur-sm rounded-2xl border border-gray-200 dark:border-white/10">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{t('customPrice.title')}</h3>

          {/* Preset Buttons - filter out 0/empty values */}
          {product.show_price_presets && product.custom_price_presets && product.custom_price_presets.filter(p => p > 0).length > 0 && (
            <div className="flex gap-2 mb-3">
              {product.custom_price_presets.filter(preset => preset > 0).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setCustomAmount(preset);
                    setCustomAmountInput(preset.toString());
                    setCustomAmountError(null);
                    setError(null); // Reset API error to allow new fetch
                  }}
                  className={`
                    px-4 py-2 rounded-lg border text-sm font-medium transition-all
                    ${customAmount === preset
                      ? 'bg-blue-500 border-blue-400 text-white'
                      : 'bg-gray-100 border-gray-300 text-gray-900 hover:bg-gray-200 dark:bg-white/5 dark:border-white/20 dark:text-white dark:hover:bg-white/10 dark:hover:border-white/30'}
                  `}
                >
                  {formatPrice(preset, product.currency)}
                </button>
              ))}
            </div>
          )}

          {/* Custom Amount Input */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                inputMode="decimal"
                value={customAmountInput}
                onChange={(e) => {
                  // Allow typing freely - only validate on blur
                  // Replace comma with dot for locales that use comma as decimal separator
                  const rawValue = e.target.value.replace(',', '.');
                  // Only allow numbers, dots, and empty string
                  if (rawValue === '' || /^\d*\.?\d*$/.test(rawValue)) {
                    setCustomAmountInput(rawValue);
                  }
                }}
                onBlur={() => {
                  // Parse and validate on blur
                  const value = parseFloat(customAmountInput) || 0;
                  setCustomAmount(value);
                  // Clean up display (remove trailing dots, etc.) only if valid
                  if (value > 0) {
                    setCustomAmountInput(value.toString());
                  }
                  validateCustomAmount(value);
                }}
                placeholder={`${product.custom_price_min || 0.50}`}
                className={`
                  w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border rounded-lg text-lg font-semibold text-gray-900 dark:text-white
                  focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all
                  ${customAmountError ? 'border-red-500' : 'border-gray-300 dark:border-white/20'}
                `}
              />
            </div>
            <span className="text-lg font-medium text-gray-500 dark:text-gray-400 min-w-[50px]">
              {product.currency}
            </span>
          </div>

          {/* Error Message */}
          {customAmountError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">{customAmountError}</p>
          )}

          {/* Minimum Price Info */}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {t('customPrice.minimum')}: {formatPrice(product.custom_price_min || 0.50, product.currency)} {product.currency}
          </p>
        </div>
      )}

      {/* Order Bump - special offer */}
      {orderBump && isCurrencyMatching && !hasAccess && !error && searchParams.get('hide_bump') !== 'true' && (
        <div 
          onClick={() => setBumpSelected(!bumpSelected)}
          className={`
            relative mb-6 group cursor-pointer overflow-hidden rounded-2xl border transition-all duration-300 ease-out
            ${bumpSelected 
              ? 'border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 shadow-[0_0_40px_-10px_rgba(251,191,36,0.15)]'
              : 'border-gray-200 bg-gray-50 hover:border-amber-400/30 hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'}
          `}
        >
          <div className={`absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl transition-opacity duration-500 ${bumpSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
          
          <div className="relative p-5 flex items-start gap-4">
            <div className={`
              mt-1 flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300
              ${bumpSelected 
                ? 'border-amber-400 bg-amber-400 text-slate-900 scale-110'
                : 'border-gray-300 group-hover:border-amber-400/50 bg-gray-100 dark:border-white/30 dark:bg-white/5'}
            `}>
              <svg className={`w-4 h-4 transition-transform duration-300 ${bumpSelected ? 'scale-100' : 'scale-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                <div className="flex items-center gap-3">
                  {orderBump.bump_product_icon && (
                    <span className="text-2xl">{orderBump.bump_product_icon}</span>
                  )}
                  <div>
                    <h3 className={`text-lg font-bold transition-colors ${bumpSelected ? 'text-amber-800 dark:text-amber-100' : 'text-gray-900 dark:text-white group-hover:text-amber-900 dark:group-hover:text-amber-50'}`}>
                      {orderBump.bump_title}
                    </h3>
                    
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`
                        inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border
                        ${bumpSelected 
                          ? 'bg-amber-400/10 text-amber-300 border-amber-400/20' 
                          : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-white/5 dark:text-gray-400 dark:border-white/10 group-hover:border-amber-400/10'}
                      `}>
                        {orderBump.bump_access_duration && orderBump.bump_access_duration > 0 ? (
                          <>
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {t('daysAccess', { days: orderBump.bump_access_duration })}
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            {t('lifetimeAccess')}
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-left sm:text-right mt-2 sm:mt-0 bg-gray-100 sm:bg-transparent dark:bg-black/20 p-2 sm:p-0 rounded-lg">
                  {orderBump.original_price > orderBump.bump_price && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 line-through decoration-gray-400 dark:decoration-gray-500 mb-0.5">
                      {formatPrice(orderBump.original_price, orderBump.bump_currency)} {orderBump.bump_currency}
                    </div>
                  )}
                  <div className="text-xl font-black text-amber-400 leading-none tracking-tight filter drop-shadow-lg">
                    {formatPrice(orderBump.bump_price, orderBump.bump_currency)} {orderBump.bump_currency}
                  </div>
                  {orderBump.original_price > orderBump.bump_price && (
                    <div className="text-[10px] font-bold text-green-600 dark:text-green-400 mt-1 uppercase tracking-wide">
                      {t('saveAmount', { amount: formatPrice(orderBump.original_price - orderBump.bump_price, orderBump.bump_currency) })}
                    </div>
                  )}
                </div>
              </div>

              {orderBump.bump_description && (
                <p className={`text-sm leading-relaxed transition-colors ${bumpSelected ? 'text-amber-800/80 dark:text-amber-100/80' : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'}`}>
                  {orderBump.bump_description}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!hasAccess && !error && (
        <div className="mb-4">
          {(showCouponInput || appliedCoupon) && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder={t('couponPlaceholder')}
                    disabled={appliedCoupon || isVerifyingCoupon}
                    className={`
                      w-full px-3 py-2 bg-gray-50 dark:bg-white/5 border rounded-lg text-sm transition-all outline-none
                      ${appliedCoupon ? 'border-green-500/50 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/5' : 'border-gray-300 dark:border-white/10 focus:border-blue-500/50'}
                    `}
                  />
                  {appliedCoupon && (
                    <div className="absolute right-3 inset-y-0 flex items-center">
                      <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
                {!appliedCoupon ? (
                  <button
                    onClick={() => handleVerifyCoupon(couponCode)}
                    disabled={!couponCode || isVerifyingCoupon}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-900 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white text-sm rounded-lg transition-all disabled:opacity-50"
                  >
                    {isVerifyingCoupon ? t('verifying') : t('applyCoupon')}
                  </button>
                ) : (
                  <button
                    onClick={() => { 
                      setAppliedCoupon(null); 
                      setCouponCode('');
                      setCouponManuallyRemoved(true); 
                    }}
                    className="px-2 py-2 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {couponError && !appliedCoupon && (
                <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 ml-1">{couponError}</p>
              )}
              {appliedCoupon && (
                <p className="text-[10px] text-green-600 dark:text-green-400 mt-1 ml-1 font-medium uppercase tracking-wider">
                  🎉 {t('discountApplied', { discount: appliedCoupon.discount_type === 'percentage' ? `${appliedCoupon.discount_value}%` : `${appliedCoupon.discount_value} ${product.currency}` })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-gray-50 dark:bg-white/10 dark:backdrop-blur-md rounded-lg p-6 border border-gray-200 dark:border-white/20 shadow-lg dark:shadow-xl relative overflow-hidden">
        {isVerifyingCoupon && (
          <div className="absolute top-0 left-0 h-0.5 bg-blue-500 animate-pulse w-full" />
        )}
        
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">{t('title')}</h2>
        
        {/* Missing Config Alert */}
        {!config.stripePublishableKey && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-500/50 rounded-lg">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-400 mt-0.5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <h3 className="text-sm font-bold text-red-700 dark:text-red-200">Configuration Error</h3>
                <p className="text-xs text-red-600 dark:text-red-300/80 mt-1">
                  Stripe API key is missing. Please check your environment variables (STRIPE_PUBLISHABLE_KEY).
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-6 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/30 dark:to-rose-900/30 border border-red-200 dark:border-red-500/40 rounded-xl backdrop-blur-sm">
            <div className="flex items-center">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 dark:bg-red-500/20 rounded-full flex items-center justify-center mr-4">
                <svg className="w-5 h-5 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-1">{t('paymentError')}</h3>
                <p className="text-red-600 dark:text-red-100/90 text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}
        
        {hasAccess && (
          <div className="mb-4 p-6 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border border-green-200 dark:border-green-500/40 rounded-xl backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="flex-shrink-0 w-10 h-10 bg-green-100 dark:bg-green-500/20 rounded-full flex items-center justify-center mr-4">
                  <svg className="w-5 h-5 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-green-700 dark:text-green-300 mb-1">{t('accessGranted')}</h3>
                  <p className="text-green-600 dark:text-green-100/90 text-sm">
                    {t('alreadyHasAccess')}
                  </p>
                  <p className="text-green-700/70 dark:text-green-200/70 text-xs mt-1 flex items-center">
                    <svg className="w-3 h-3 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {t('autoRedirect', { seconds: countdown })}
                  </p>
                </div>
              </div>
              <button
                onClick={handleRedirectToProduct}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg transition-all duration-200 font-medium text-sm shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                {t('goToProduct')}
              </button>
            </div>
          </div>
        )}
        
        {!error && !hasAccess && stripePromise && clientSecret && (
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
              bumpProduct={orderBump}
              bumpSelected={bumpSelected}
              appliedCoupon={appliedCoupon}
              successUrl={searchParams.get('success_url') || undefined}
              onChangeAccount={handleSignOutAndCheckout}
              customAmount={product.allow_custom_price ? customAmount : undefined}
              customAmountError={product.allow_custom_price ? customAmountError : null}
              clientSecret={clientSecret || undefined}
              paymentMethodOrder={paymentMethodOrder}
              expressCheckoutConfig={expressCheckoutConfig}
            />
          </Elements>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-800 p-4 lg:p-8">
      <div className="w-full max-w-7xl mx-auto p-6 lg:p-8 bg-white border border-gray-200 shadow-xl dark:bg-white/5 dark:backdrop-blur-md dark:border-white/10 dark:shadow-2xl rounded-xl">
        <div className="flex flex-col lg:flex-row">
          <ProductShowcase product={product} />
          {renderCheckoutForm()}
        </div>
      </div>
    </div>
  );
}