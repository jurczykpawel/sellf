'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { CheckoutElementsProvider } from '@stripe/react-stripe-js/checkout';
import EventSessions from '@/components/checkout/EventSessions';
import { selectEventSession } from '@/lib/events/presentation';
import { checkoutProfileSchema } from '@/lib/checkout-modules/profile';
import BankTransferForm from '@/components/checkout/BankTransferForm';
import { getTransferAvailability } from '@/lib/orders/transfer-public';
import { availableTransferMethod, canUseBankTransfer } from '@/lib/orders/bank-transfer-config';
import { useInvoiceData } from '@/hooks/useInvoiceData';
import { parseQuantityInput } from '@/lib/checkout-modules/quantity';
import CheckoutProfileFields, { CheckoutQuantityField, useCheckoutProfileValues } from '@/components/checkout/CheckoutProfileFields';
import { formatPrice, STRIPE_MAX_AMOUNT } from '@/lib/constants';
import { parseCustomAmountInput } from '@/lib/payment/custom-amount';
import { minimumChargeAmount } from '@/lib/currency/minor-units';
import { signOutAndRedirectToCheckout } from '@/lib/actions/checkout';
import { validateCustomFieldValues } from '@/lib/validations/custom-checkout-fields';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import { formatBillingIntervalLabel, getVatDisplay } from '@/lib/product-pricing-display';
import { createCheckoutSessionQueue } from '@/lib/checkout/session-queue';
import { getStripeClient } from '@/lib/stripe/client';
import { TWO_COLUMN_ROW_CLASSNAME, PANEL_END_CLASSNAME } from '@/lib/two-column-layout';
import { useAuth } from '@/contexts/AuthContext';
import { useConfig } from '@/components/providers/config-provider';
import { useTheme } from '@/components/providers/theme-provider';
import { useOrderBumps } from '@/hooks/useOrderBumps';
import { useTracking } from '@/hooks/useTracking';
import { useCoupon } from '@/hooks/useCoupon';
import { useOto } from '@/hooks/useOto';
import { useFreeAccess } from '@/hooks/useFreeAccess';
import { useCheckoutRedirect } from '@/hooks/useCheckoutRedirect';
import { calculatePricing } from '@/hooks/usePricing';
import { useCartTracking } from '@/hooks/useCartTracking';
import PaymentFormSkeleton from '@/components/checkout/PaymentFormSkeleton';
import OrderSummary from '@/components/checkout/OrderSummary';
import CustomCheckoutFieldsForm from '@/components/checkout/CustomCheckoutFieldsForm';
import OtoCountdownBanner from '@/components/storefront/OtoCountdownBanner';
import { getCheckoutRequestError } from '@/lib/checkout/request-error';
import type { StripeCheckoutElementsSdkOptions } from '@stripe/stripe-js';
import type { Product } from '@/types';
import type { ExpressCheckoutConfig } from '@/types/payment-config';
import type { TaxMode } from '@/lib/actions/shop-config';
import type { CustomFieldDefinition, CustomFieldValues } from '@/lib/validations/custom-checkout-fields';
import type { EventSession } from '@/lib/events/presentation';
import type { CheckoutSessionIdentity } from '@/lib/checkout/session-queue';
import type { BundleComponentSummary } from './BundleContentsPreview';
import ProductShowcase from './ProductShowcase';
import CustomPaymentForm from './CustomPaymentForm';
import FunnelTestBanner from './FunnelTestBanner';
import AccessGrantedCard from './AccessGrantedCard';
import OrderBumpList from './OrderBumpList';
import CouponField from './CouponField';
import PwywSection from './PwywSection';

interface CheckoutSessionResponse extends CheckoutSessionIdentity {
  freeAccess?: boolean;
}

interface PaidProductFormProps {
  product: Product;
  paymentMethodOrder?: string[];
  expressCheckoutConfig?: ExpressCheckoutConfig;
  taxMode?: TaxMode;
  collectTermsOfService: boolean;
  bundleComponents?: BundleComponentSummary[];
  /**
   * `standalone` (default): full page shell + ProductShowcase + form.
   * `embedded`: form column only (host template provides product info / chrome).
   */
  layoutMode?: 'standalone' | 'embedded';
  afterCheckoutSlot?: React.ReactNode;
}

const noopSubscribe = () => () => {};

export default function PaidProductForm({ product, paymentMethodOrder, expressCheckoutConfig, taxMode, collectTermsOfService, bundleComponents, layoutMode = 'standalone', afterCheckoutSlot }: PaidProductFormProps) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const parsedProfile = checkoutProfileSchema.safeParse(product.checkout_profile);
  const quantityConfig = parsedProfile.success ? parsedProfile.data.modules.find(module => module.id === 'quantity') : undefined;
  const [quantity, setQuantity] = useState(quantityConfig?.min ?? 1);
  const [quantityInput, setQuantityInput] = useState(String(quantity));
  const quantityInvalid = !!quantityConfig && parseQuantityInput(quantityInput, quantityConfig) === null;
  const changeQuantity = (value: string) => {
    setQuantityInput(value);
    const parsed = quantityConfig ? parseQuantityInput(value, quantityConfig) : null;
    if (parsed !== null) setQuantity(parsed);
  };
  const isSubscription = product.product_type === 'subscription';
  // PWYW subscriptions allow buyers to choose their recurring amount. The
  // existing PwywSection works regardless of one-shot vs recurring — only
  // copy needs to switch to "Monthly amount" via the section's own i18n.
  const isPwywSubscription = isSubscription && product.allow_custom_price === true;
  const { user, isAdmin, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const eventText = useTranslations('events');
  const [eventSessions, setEventSessions] = useState<EventSession[]>([]);
  const [eventSessionId, setEventSessionId] = useState<string | null>(null);
  const [eventLoadError, setEventLoadError] = useState(false);
  const requestedSession = searchParams.get('session');
  const refreshEvents = useCallback(async () => {
    if (!product.event_mode) return;
    try {
      const response = await fetch(`/api/public/products/${encodeURIComponent(product.slug)}/availability`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json() as { sessions: EventSession[] };
      setEventSessions(data.sessions);
      setEventSessionId(current => selectEventSession(data.sessions, current ?? requestedSession));
      setEventLoadError(false);
    } catch { setEventLoadError(true); }
  }, [product.event_mode, product.slug, requestedSession]);
  useEffect(() => { void refreshEvents(); }, [refreshEvents]);
  const eventSession = eventSessions.find(s => s.id === eventSessionId);
  const eventReady = !product.event_mode || (!eventLoadError && !!eventSession?.currentTier && !eventSession.soldOut);
  const config = useConfig();
  const { resolvedTheme } = useTheme();
  const { track } = useTracking();
  const trackingFired = useRef(false);
  const checkoutTrackingFired = useRef(false);
  const confirmationPending = useRef(false);
  const [purchaseStarted, setPurchaseStarted] = useState(false);
  // The server-rendered form is clickable before React attaches onSubmit; a native GET submit reloads the page and drops the query (coupon, email, oto).
  const interactive = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const handleConfirmationChange = useCallback((pending: boolean) => { confirmationPending.current = pending; }, []);

  // Funnel test mode: admin-only visual preview (no Stripe, no backend calls)
  const isFunnelTest = searchParams.get('funnel_test') === '1' && isAdmin;
  const explicitRepurchase = searchParams.get('repurchase') === '1';

  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [bindingToken, setBindingToken] = useState<string | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [lastCheckoutSessionSignature, setLastCheckoutSessionSignature] = useState<string | null>(null);
  const [sessionQueue] = useState(() => createCheckoutSessionQueue<CheckoutSessionResponse>(async identity => {
    // Dynamic recurring support uses a PaymentIntent rather than a Checkout Session.
    if (!identity.clientSecret?.startsWith('cs_')) return;
    const response = await fetch('/api/create-payment-intent', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, ...identity, expireOnly: true }),
    });
    if (!response.ok) throw new Error('Unable to expire checkout session');
  }));

  useEffect(() => {
    const handlePageHide = () => {
      if (!confirmationPending.current) sessionQueue.update(null);
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        confirmationPending.current = false;
        checkoutTrackingFired.current = false;
        setPurchaseStarted(false);
        setClientSecret(null);
        setBindingToken(null);
        setCheckoutSessionId(null);
        setLastCheckoutSessionSignature(null);
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      if (!confirmationPending.current) sessionQueue.update(null);
    };
  }, [sessionQueue]);

  // Email state - from logged in user or from URL param (for OTO redirects)
  const urlEmail = searchParams.get('email');
  const urlName = searchParams.get('name') ?? undefined;
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

  const [formEmail, setFormEmail] = useState<string | undefined>(undefined);
  const invoice = useInvoiceData(email, { initialFullName: urlName });
  const profile = parsedProfile.success ? parsedProfile.data : null;
  const profileForm = useCheckoutProfileValues(profile, invoice, user?.email ?? formEmail ?? email ?? '', quantity);
  const bt = useTranslations('bankTransfer');
  const [transfer, setTransfer] = useState({ enabled: false, dueDays: 14 });
  const [method, setMethod] = useState<'online' | 'transfer'>('online');
  const profileHasTransfer = !!profile?.modules.some(m => m.id === 'buyer' && !!m.bank_transfer_for?.length);
  useEffect(() => { if (!profileHasTransfer) return; let active = true; getTransferAvailability().then(value => { if (active) setTransfer(value); }).catch(() => {}); return () => { active = false; }; }, [profileHasTransfer]);
  const transferProfile = transfer.enabled && !!profile && !product.allow_custom_price && !product.is_bundle && !isSubscription && profileHasTransfer;
  const transferAllowed = transferProfile && canUseBankTransfer(true, profile, profileForm.buyerType);
  const activeMethod = availableTransferMethod(method, transferProfile, profile, profileForm.buyerType);
  if (method !== activeMethod) setMethod(activeMethod);

  // Safe loading of Stripe to prevent crashes if key is missing
  const stripePromise = config.stripePublishableKey && purchaseStarted && activeMethod === 'online'
    ? getStripeClient(config.stripePublishableKey)
    : null;

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
  const [customAmountInput, setCustomAmountInput] = useState<string>(getInitialAmount().toString());
  const parsedAmount = parseCustomAmountInput(customAmountInput, product.currency);
  const customAmount = parsedAmount ?? 0;

  // Validate range separately from the raw input format.
  const checkCustomAmount = useCallback((amount: number): string | null => {
    if (!product.allow_custom_price) return null;
    const minPrice = product.custom_price_min ?? minimumChargeAmount(product.currency);
    if (amount < minPrice) {
      return t('customPrice.belowMinimum', { minimum: formatPrice(minPrice, product.currency, locale) });
    }
    if (amount > STRIPE_MAX_AMOUNT) {
      return t('customPrice.aboveMaximum', { maximum: formatPrice(STRIPE_MAX_AMOUNT, product.currency, locale) });
    }
    return null;
  }, [product, t, locale]);

  const customAmountError = !product.allow_custom_price ? null : parsedAmount === null
    ? t('customPrice.invalidAmount') : checkCustomAmount(customAmount);

  // Compute isPwywFree once — shared with PwywSection
  const isPwywFree =
    product.allow_custom_price && !customAmountError &&
    customAmount === 0 &&
    (product.custom_price_min ?? minimumChargeAmount(product.currency)) === 0;

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

  // Effective unit price: active sale price (Omnibus) when running, else regular
  // price. Single source shared with the server charge + DB validation so the
  // cart total, the "Pay" button and the actual charge can never diverge.
  const effectiveUnitPrice = isSubscription
    ? product.recurring_price ?? 0
    : product.event_mode ? eventSession?.currentTier?.price ?? 0 : getEffectiveUnitPrice(product);

  const checkoutTaxMode = activeMethod === 'transfer' ? 'local' : taxMode;
  const pricing = calculatePricing({
    baseProductId: product.id,
    productPrice: effectiveUnitPrice * quantity,
    quantity,
    productCurrency: product.currency,
    productVatRate: product.vat_rate ?? undefined,
    vatExempt: product.vat_exempt,
    taxMode: checkoutTaxMode,
    priceIncludesVat: product.price_includes_vat ?? undefined,
    customAmount: product.allow_custom_price ? customAmount : undefined,
    bumps: availableBumps.map(bump => ({
      id: bump.bump_product_id,
      price: bump.bump_price,
      selected: selectedBumpIds.has(bump.bump_product_id),
      vatRate: bump.vat_rate,
      priceIncludesVat: bump.price_includes_vat,
      vatExempt: bump.vat_exempt,
    })),
    coupon: coupon.appliedCoupon,
  });

  // Any coupon that reduces the whole selected checkout total to zero uses the
  // same grant flow as PWYW=0. If selected bumps remain payable, keep Stripe.
  const isFullDiscountCoupon = !!coupon.appliedCoupon && pricing.isFreeWithCoupon;

  const isFreeAccess = !product.event_mode && (isPwywFree || isFullDiscountCoupon);
  const checkoutSessionSignature = JSON.stringify({
    locale,
    quantity,
    productId: product.id,
    email: email || null,
    bumpProductIds: Array.from(selectedBumpIds).sort(),
    couponCode: coupon.appliedCoupon?.code ?? null,
    successUrl: searchParams.get('success_url') || null,
    customAmount: product.allow_custom_price ? customAmount : null,
    sessionId: product.event_mode ? eventSessionId : undefined,
    repurchase: explicitRepurchase,
  });

  // Free-access flow (shared by PWYW=0 and full-discount coupons)
  const pwyw = useFreeAccess({
    user,
    product,
    onAccessGranted: grantAccess,
    onError: setError,
    couponCode: isFullDiscountCoupon ? coupon.appliedCoupon?.code ?? null : null,
    customFieldValues: customFieldDefs.length > 0 ? customFieldValues : undefined,
  });

  // Validate product-defined custom fields before claiming a free/coupon grant,
  // mirroring the paid flow. Reuses the canonical validator (same rules server-side).
  const claimFreeAccess = useCallback(async () => {
    if (customFieldDefs.length > 0) {
      const validation = validateCustomFieldValues(customFieldDefs, customFieldValues, { requireAll: true });
      if (!validation.ok) {
        setCustomFieldErrors(validation.errors);
        return;
      }
      setCustomFieldErrors({});
    }
    await pwyw.handlePwywFreeAccess();
  }, [customFieldDefs, customFieldValues, pwyw]);

  const cartItems = [{ item_id: product.id, item_name: product.name, price: effectiveUnitPrice, quantity },
    ...availableBumps.filter(bump => selectedBumpIds.has(bump.bump_product_id)).map(bump => ({
      item_id: bump.bump_product_id, item_name: bump.bump_product_name, price: bump.bump_price, quantity: 1,
    }))];
  useCartTracking(purchaseStarted, { currency: product.currency,
    value: cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0), items: cartItems }, track);

  // Track view_item and begin_checkout on mount
  useEffect(() => {
    if (trackingFired.current) return;
    trackingFired.current = true;

    const trackingData = {
      value: effectiveUnitPrice,
      currency: product.currency,
      items: [{
        item_id: product.id,
        item_name: product.name,
        price: effectiveUnitPrice,
        quantity: 1,
      }],
    };

    track('view_item', trackingData);

  }, [product, track, effectiveUnitPrice]);

  useEffect(() => {
    if (!purchaseStarted || checkoutTrackingFired.current) return;
    checkoutTrackingFired.current = true;
    track('begin_checkout', { value: effectiveUnitPrice, currency: product.currency,
      items: [{ item_id: product.id, item_name: product.name, price: effectiveUnitPrice, quantity: 1 }] });
  }, [purchaseStarted, track, effectiveUnitPrice, product]);

  // One request at a time; superseded responses remain available for replacement.
  useEffect(() => {
    if (activeMethod === 'transfer' || !eventReady || !purchaseStarted || hasAccess || error || authLoading || isFunnelTest || isFreeAccess ||
      !!customAmountError) {
      sessionQueue.update(null);
      return;
    }

    sessionQueue.update({
      key: checkoutSessionSignature,
      run: async previous => {
        const response = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: product.id,
            locale,
            quantity,
            sessionId: product.event_mode ? eventSessionId : undefined,
            clientSecret: previous?.clientSecret,
            bindingToken: previous?.bindingToken ?? undefined,
            email: email?.trim() || undefined,
            bumpProductIds: selectedBumpIds.size > 0 ? Array.from(selectedBumpIds) : undefined,
            couponCode: coupon.appliedCoupon?.code,
            successUrl: searchParams.get('success_url') || undefined,
            customAmount: product.allow_custom_price ? customAmount : undefined,
            customFieldValues: customFieldDefs.length > 0 ? customFieldValues : undefined,
            repurchase: explicitRepurchase,
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (product.event_mode && (response.status === 409 || response.status === 429)) {
            if (response.status === 409) await refreshEvents();
            throw new Error(eventText(response.status === 429 ? 'holdLimit' : data.error === 'sold_out' ? 'soldOut' : 'priceChanged'));
          }
          throw Object.assign(new Error(getCheckoutRequestError(response.status, data.error, t('createSessionError'), t('requestRateLimit'))), { details: data.details });
        }
        return await response.json() as CheckoutSessionResponse;
      },
      apply: data => {
        setCustomFieldErrors({});
        if (data.freeAccess) {
          grantAccess();
          return;
        }
        setLastCheckoutSessionSignature(checkoutSessionSignature);
        setClientSecret(data.clientSecret ?? null);
        setCheckoutSessionId(data.checkoutSessionId ?? null);
        setBindingToken(data.bindingToken ?? null);
      },
      fail: err => {
        if (err instanceof Error && err.message === 'You already have access to this product') {
          grantAccess();
          return;
        }
        if (err instanceof Error && err.message === 'Invalid custom field values' && 'details' in err) {
          setCustomFieldErrors(err.details as Record<string, string>);
          setError(t('createSessionError'));
          return;
        }
        setError(err instanceof Error ? err.message : t('loadError'));
      },
    });
  }, [
    activeMethod,
    eventReady, eventSessionId, refreshEvents, eventText, purchaseStarted, hasAccess, error, authLoading,
    product, email, locale, quantity, selectedBumpIds, coupon.appliedCoupon, searchParams, t,
    customAmount, customAmountError, isFunnelTest, isFreeAccess, grantAccess,
    checkoutSessionSignature, explicitRepurchase, sessionQueue, customFieldDefs, customFieldValues,
  ]);

  const handleSignOutAndCheckout = async () => {
    try {
      await signOutAndRedirectToCheckout();
      window.location.reload();
    } catch (err) {
      console.error('[PaidProductForm] Sign out error:', err);
    }
  };

  const checkoutFormClassName = layoutMode === 'embedded'
    ? 'w-full'
    : PANEL_END_CLASSNAME;

  const renderCheckoutForm = () => (
    <div className={checkoutFormClassName}>
      {/* Funnel Test Banner */}
      {isFunnelTest && <FunnelTestBanner />}

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
      {/* Custom checkout fields on the free-access path (PWYW=0 or 100% coupon).
          The paid path renders these inside the Stripe checkout card, which is
          hidden when isFreeAccess — so render them here too, with the same state,
          so the buyer can fill them (e.g. license domain) before claiming. */}
      {isFreeAccess && !hasAccess && !error && customFieldDefs.length > 0 && (
        <div className="mb-6 p-5 bg-sf-raised backdrop-blur-sm rounded-2xl border border-sf-border">
          <CustomCheckoutFieldsForm
            fields={customFieldDefs}
            values={customFieldValues}
            onChange={(next) => {
              setCustomFieldValues(next);
              if (Object.keys(customFieldErrors).length > 0) setCustomFieldErrors({});
            }}
            errors={customFieldErrors}
          />
        </div>
      )}

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
          pwyw={{ ...pwyw, handlePwywFreeAccess: claimFreeAccess }}
          onAmountInputChange={(raw) => { setCustomAmountInput(raw); setPurchaseStarted(false); }}
          onPresetClick={(preset) => {
            setCustomAmountInput(preset.toLocaleString(locale, { useGrouping: false }));
            setPurchaseStarted(false);
            setError(null);
          }}
          collectTermsOfService={collectTermsOfService}
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
          priceIncludesVat={product.price_includes_vat ?? true}
          vatDisplay={getVatDisplay({ taxMode: checkoutTaxMode, vatRate: product.vat_rate, vatExempt: product.vat_exempt, priceIncludesVat: product.price_includes_vat })}
          couponCode={coupon.couponCode}
          appliedCoupon={coupon.appliedCoupon}
          noPriceReduction={coupon.appliedCoupon?.discount_type === 'set_price' && pricing.discountAmount === 0}
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
        <div className="bg-sf-raised backdrop-blur-md rounded-2xl p-4 sm:p-6 border border-sf-border relative overflow-hidden">
          {coupon.isVerifyingCoupon && (
            <div className="absolute top-0 left-0 h-0.5 bg-sf-accent-bg animate-pulse w-full" />
          )}

          <h2 className="text-xl font-semibold text-sf-heading mb-4">{t('purchaseTitle')}</h2>
          {quantityConfig?.mode === 'product_page' && <CheckoutQuantityField config={quantityConfig} value={quantityInput} onChange={changeQuantity} invalid={quantityInvalid} />}

          {product.event_mode && <>
            <EventSessions sessions={eventSessions} currency={product.currency} selected={eventSessionId} onSelect={id => { setEventSessionId(id); setError(null); setPurchaseStarted(false); }} />
            {eventLoadError && <p role="alert">{eventText('loadError')}</p>}
          </>}

          {transferProfile && !hasAccess && !isFunnelTest && !isFreeAccess && profile && <>
            {activeMethod === 'transfer' && quantityConfig?.mode === 'checkout' && <CheckoutQuantityField config={quantityConfig} value={quantityInput} onChange={changeQuantity} invalid={quantityInvalid} />}
            <CheckoutProfileFields profile={profile} state={profileForm} invoice={invoice} errors={profileForm.errors} disabled={false} />
            {transferAllowed && <fieldset className="my-4 space-y-3"><legend className="font-semibold">{bt('method')}</legend>
              {(['online', 'transfer'] as const).map(value => <label key={value} className="flex items-center gap-2 rounded-lg border border-sf-border p-3"><input type="radio" name="payment-method" value={value} checked={activeMethod === value} onChange={() => { setMethod(value); setPurchaseStarted(false); setClientSecret(null); setError(null); }} />{bt(value, { days: transfer.dueDays })}</label>)}
            </fieldset>}
            {activeMethod === 'transfer' && eventReady && <BankTransferForm disabled={quantityInvalid} onModuleErrors={profileForm.setErrors} product={product} email={user?.email ?? formEmail ?? email ?? ''} lockedEmail={!!user?.email} onEmailChange={setFormEmail} moduleValues={profileForm.values} sessionId={eventSessionId} bumpIds={Array.from(selectedBumpIds)} couponCode={coupon.appliedCoupon?.code} fields={customFieldDefs} values={customFieldValues} onValuesChange={setCustomFieldValues} />}
          </>}

          {/* Missing Config Alert */}
          {activeMethod === 'online' && !config.stripePublishableKey && (
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
                  {product.event_mode && <button type="button" onClick={() => { setError(null); setPurchaseStarted(false); void refreshEvents(); }}>{eventText('chooseSession')}</button>}
                </div>
              </div>
            </div>
          )}

          {hasAccess && (
            <AccessGrantedCard countdown={countdown} onGoToProduct={handleRedirectToProduct} />
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

          {!isFunnelTest && !error && !hasAccess && !isFreeAccess && eventReady && (
            <OrderSummary
              productName={quantity > 1 ? `${product.name} × ${quantity}` : product.name}
              currency={product.currency}
              basePrice={pricing.basePrice}
              discountAmount={pricing.discountAmount}
              totalGross={pricing.totalPayable}
              totalNet={pricing.totalNet}
              vatRate={pricing.vatRate}
              vatExempt={product.vat_exempt}
              vatExemptNote={product.vat_exempt_note}
              taxMode={checkoutTaxMode}
              quantityInvalid={quantityInvalid}
              customAmountError={product.allow_custom_price ? customAmountError : null}
              appliedCoupon={coupon.appliedCoupon ?? undefined}
              bumpProducts={availableBumps}
              selectedBumpIds={selectedBumpIds}
              intervalLabel={isSubscription ? formatBillingIntervalLabel(product.billing_interval, product.billing_interval_count, locale) : undefined}
            />
          )}

          {!isFunnelTest && !error && !hasAccess && !isFreeAccess && activeMethod === 'online' && !purchaseStarted && eventReady && (
            <form onSubmit={event => { event.preventDefault(); if (!quantityInvalid && !customAmountError && profileForm.validate()) setPurchaseStarted(true); }}>
              {(product.event_mode || profile) && !user?.email && <label className="mb-4 block">{eventText('email')}<input id="buyer.email" type="email" required value={email ?? ''} onChange={event => setEmail(event.target.value)} className="mt-1 block w-full rounded border border-sf-border p-3" /></label>}
              {quantityConfig?.mode === 'checkout' && <CheckoutQuantityField config={quantityConfig} value={quantityInput} onChange={changeQuantity} invalid={quantityInvalid} />}
              {profile && !transferProfile && <CheckoutProfileFields profile={profile} state={profileForm} invoice={invoice} errors={profileForm.errors} disabled={false} />}
              <button type="submit" disabled={!interactive || quantityInvalid || !!customAmountError} className="w-full cursor-pointer disabled:cursor-wait disabled:opacity-60 rounded-xl bg-sf-accent-bg px-6 py-4 font-semibold text-sf-inverse hover:bg-sf-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent">
                {t('continueToPayment')}
              </button>
              <p className="mt-3 text-center text-xs text-sf-muted">{t('securePayment')}</p>
            </form>
          )}

          {!isFunnelTest && !error && !hasAccess && !isFreeAccess && activeMethod === 'online' && purchaseStarted && (!clientSecret || lastCheckoutSessionSignature !== checkoutSessionSignature) && <PaymentFormSkeleton />}

          {!isFunnelTest && !error && !hasAccess && !isFreeAccess && activeMethod === 'online' && stripePromise && clientSecret && lastCheckoutSessionSignature === checkoutSessionSignature && (
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
                quantityInvalid={quantityInvalid}
                product={product}
                email={user?.email ?? formEmail ?? email}
                invoice={invoice}
                profileForm={profileForm}
                profileHandled={transferProfile}
                onEmailChange={setFormEmail}
                bumpProducts={availableBumps}
                selectedBumpIds={selectedBumpIds}
                onChangeAccount={handleSignOutAndCheckout}
                customAmountError={product.allow_custom_price ? customAmountError : null}
                clientSecret={clientSecret || undefined}
                bindingToken={bindingToken || undefined}
                onConfirmationChange={handleConfirmationChange}
                pricing={pricing}
                paymentMethodOrder={paymentMethodOrder}
                expressCheckoutConfig={expressCheckoutConfig}
                taxMode={checkoutTaxMode}
                customFieldDefs={customFieldDefs}
                customFieldValues={customFieldValues}
                onCustomFieldValuesChange={setCustomFieldValues}
                customFieldErrors={customFieldErrors}
                collectTermsOfService={collectTermsOfService}
              />
            </CheckoutElementsProvider>
          )}
          {!isFunnelTest && !error && !hasAccess && !isFreeAccess && afterCheckoutSlot}
        </div>
      )}
    </div>
  );

  if (layoutMode === 'embedded') {
    // Host template (e.g. tip-jar) provides chrome + product info; we render
    // ONLY the form column so the page doesn't duplicate showcase / wrapper.
    return (
      <div className="w-full p-4 sm:p-6 lg:p-8 bg-sf-base border border-sf-border shadow-[var(--sf-shadow-accent)] backdrop-blur-md rounded-2xl">
        {renderCheckoutForm()}
      </div>
    );
  }

  return (
    <div className="flex justify-center items-start min-h-screen bg-gradient-to-br from-sf-deep to-sf-raised p-4 lg:p-8">
      <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 bg-sf-base border border-sf-border shadow-[var(--sf-shadow-accent)] backdrop-blur-md rounded-2xl">
        <div className={TWO_COLUMN_ROW_CLASSNAME}>
          <ProductShowcase product={product} taxMode={checkoutTaxMode} bundleComponents={bundleComponents} />
          {renderCheckoutForm()}
        </div>
      </div>
    </div>
  );
}
