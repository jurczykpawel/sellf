'use client';

import { useState, useEffect } from 'react';
import { PaymentElement, LinkAuthenticationElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Product } from '@/types';
import { OrderBumpWithProduct } from '@/types/order-bump';
import { ExpressCheckoutConfig } from '@/types/payment-config';
import { formatPrice } from '@/lib/constants';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { validateTaxId, isPolishNIP, normalizeNIP } from '@/lib/validation/nip';
import { useTracking } from '@/hooks/useTracking';
import { usePricing } from '@/hooks/usePricing';
import DemoCheckoutNotice from '@/components/DemoCheckoutNotice';
import type { TaxMode } from '@/lib/actions/shop-config';

interface AppliedCoupon {
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  exclude_order_bumps?: boolean;
}

interface CustomPaymentFormProps {
  product: Product;
  email?: string;
  bumpProduct?: OrderBumpWithProduct | null;
  bumpSelected: boolean;
  appliedCoupon?: AppliedCoupon;
  successUrl?: string;
  onChangeAccount?: () => void;
  customAmount?: number; // Pay What You Want - custom price chosen by customer
  customAmountError?: string | null; // Validation error for custom amount
  clientSecret?: string; // Payment Intent client secret for metadata updates
  paymentMethodOrder?: string[]; // Custom payment method ordering from config
  expressCheckoutConfig?: ExpressCheckoutConfig; // Express Checkout visibility config
  taxMode?: TaxMode;
}

export default function CustomPaymentForm({
  product,
  email,
  bumpProduct,
  bumpSelected,
  appliedCoupon,
  successUrl,
  onChangeAccount,
  customAmount,
  customAmountError,
  clientSecret,
  paymentMethodOrder,
  expressCheckoutConfig,
  taxMode
}: CustomPaymentFormProps) {
  const t = useTranslations('checkout');
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const { track } = useTracking();

  // Email from LinkAuthenticationElement onChange
  const [linkEmail, setLinkEmail] = useState('');

  // Confirm email checkbox — only required when logged-in user uses a different email
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const emailMismatch = !!(email && linkEmail && linkEmail.toLowerCase() !== email.toLowerCase());

  // Customer data - single name field
  const [fullName, setFullName] = useState('');

  // Terms & Conditions - only for guests (!email)
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Invoice data - optional (triggered by NIP input)
  const [nip, setNip] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('PL');

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  // GUS integration state
  interface GUSCompanyData {
    nazwa: string;
    ulica: string;
    nrNieruchomosci: string;
    nrLokalu?: string;
    miejscowosc: string;
    kodPocztowy: string;
  }

  const [isLoadingGUS, setIsLoadingGUS] = useState(false);
  const [gusError, setGusError] = useState<string | null>(null);
  const [nipError, setNipError] = useState<string | null>(null);
  const [gusSuccess, setGusSuccess] = useState(false);
  const [gusData, setGusData] = useState<GUSCompanyData | null>(null);

  // Centralized pricing calculation
  const pricing = usePricing({
    productPrice: product.price,
    productCurrency: product.currency,
    productVatRate: product.vat_rate ?? undefined,
    priceIncludesVat: product.price_includes_vat ?? undefined,
    customAmount,
    bumpPrice: bumpProduct?.bump_price,
    bumpSelected,
    coupon: appliedCoupon,
  });

  const { basePrice, discountAmount, totalGross, totalNet, vatAmount, vatRate } = pricing;

  // Auto-load profile data for logged-in users
  useEffect(() => {
    async function loadProfileData() {
      if (!email) {
        setIsLoadingProfile(false);
        return; // Only load for logged-in users
      }

      setIsLoadingProfile(true);
      try {
        const response = await fetch('/api/profile/get', {
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const { data } = await response.json();
          if (data) {
            // Load customer name (prefer full_name, fallback to first + last)
            if (data.full_name) {
              setFullName(data.full_name);
            } else if (data.first_name || data.last_name) {
              setFullName(`${data.first_name || ''} ${data.last_name || ''}`.trim());
            }

            // Load invoice data if available
            if (data.tax_id) setNip(data.tax_id);
            if (data.company_name) setCompanyName(data.company_name);
            if (data.address_line1) setAddress(data.address_line1);
            if (data.city) setCity(data.city);
            if (data.zip_code) setPostalCode(data.zip_code);
            if (data.country) setCountry(data.country);
          }
        }
      } catch (error) {
        console.error('Failed to load profile data:', error);
        // Silent fail - user can enter data manually
      } finally {
        setIsLoadingProfile(false);
      }
    }

    loadProfileData();
  }, [email]);

  // Helper function to translate NIP validation errors
  const translateNipError = (error: string | undefined): string => {
    if (!error) return t('nipValidation.invalidFormat');

    if (error.includes('Invalid Polish NIP checksum')) {
      return t('nipValidation.invalidChecksum');
    } else if (error.includes('Polish NIP must be 10 digits')) {
      return t('nipValidation.mustBe10Digits');
    } else if (error.includes('Tax ID is required')) {
      return t('nipValidation.required');
    } else {
      return t('nipValidation.invalidFormat');
    }
  };

  // Tax ID / NIP auto-fill handler (supports international formats)
  const handleNIPBlur = async () => {
    if (!nip || nip.trim().length === 0) return;

    // Validate tax ID format (supports PL prefix, other countries, etc.)
    const validation = validateTaxId(nip, true);

    if (!validation.isValid) {
      setNipError(translateNipError(validation.error));
      setGusError(null);
      setGusSuccess(false);
      return;
    }

    setNipError(null);

    // Auto-fill from GUS only for Polish NIP
    if (validation.isPolish && validation.normalized) {
      setIsLoadingGUS(true);
      setGusError(null);
      setGusSuccess(false);

      try {
        const response = await fetch('/api/gus/fetch-company-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nip: validation.normalized }),
        });

        const result = await response.json();

        if (result.success && result.data) {
          // Store GUS data
          setGusData(result.data);

          // Autofill company data
          setCompanyName(result.data.nazwa);

          // Build address string
          let addressStr = `${result.data.ulica} ${result.data.nrNieruchomosci}`;
          if (result.data.nrLokalu) {
            addressStr += `/${result.data.nrLokalu}`;
          }
          setAddress(addressStr.trim());

          setCity(result.data.miejscowosc);
          setPostalCode(result.data.kodPocztowy);
          setCountry('PL');
          setGusSuccess(true);
        } else {
          // GUS API returned error
          if (result.code === 'RATE_LIMIT_EXCEEDED') {
            setGusError(t('gusRateLimitExceeded'));
          } else if (result.code === 'NOT_FOUND') {
            setGusError(t('gusNotFound'));
          } else if (result.code === 'NOT_CONFIGURED') {
            // Silent fail - GUS not configured, user can enter manually
            setGusError(null);
          } else if (result.code === 'INVALID_ORIGIN') {
            setGusError(t('gusSecurityError'));
          } else {
            setGusError(t('gusFetchError'));
          }
        }
      } catch (error) {
        console.error('GUS fetch error:', error);
        setGusError(t('gusFetchError'));
      } finally {
        setIsLoadingGUS(false);
      }
    } else if (!validation.isPolish) {
      // Non-Polish tax ID - show success message, no GUS auto-fill
      setGusError(null);
      setGusSuccess(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    const finalEmail = linkEmail || email;
    if (!finalEmail) {
      setErrorMessage(t('emailRequired', { defaultValue: 'Email is required' }));
      return;
    }

    if (emailMismatch && !emailConfirmed) {
      setErrorMessage(t('confirmEmailRequired', { defaultValue: 'Please confirm the product assignment to your account' }));
      return;
    }

    if (!fullName || fullName.trim().length === 0) {
      setErrorMessage(t('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }

    // Require T&C acceptance for guests
    if (!email && !termsAccepted) {
      setErrorMessage(t('termsRequired', { defaultValue: 'Please accept Terms and Conditions' }));
      return;
    }

    // Validate tax ID if provided (supports international formats)
    if (nip && nip.trim().length > 0) {
      const validation = validateTaxId(nip, true);
      if (!validation.isValid) {
        setErrorMessage(validation.error || t('invalidTaxIdFormat'));
        return;
      }
    }

    setIsProcessing(true);
    setErrorMessage('');

    try {
      // Always update Payment Intent metadata with customer data
      // This ensures fullName and termsAccepted are saved regardless of NIP status
      if (clientSecret) {
        // Submit the form to validate payment method
        const { error: submitError } = await elements.submit();
        if (submitError) {
          setErrorMessage(submitError.message || t('failedToPreparePayment'));
          setIsProcessing(false);
          return;
        }

        // Update metadata via API - works for both NIP and non-NIP scenarios
        const hasValidTaxId = nip && nip.trim().length > 0 && validateTaxId(nip, false).isValid;
        const updateResponse = await fetch('/api/update-payment-metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientSecret: clientSecret,
            fullName,
            termsAccepted: !email ? termsAccepted : undefined, // Only for guests
            needsInvoice: hasValidTaxId ? true : false,
            nip: nip || undefined,
            companyName: companyName || undefined,
            address: address || undefined,
            city: city || undefined,
            postalCode: postalCode || undefined,
            country: country || undefined,
          }),
        });

        if (!updateResponse.ok) {
          console.error('Failed to update payment metadata');
          // Continue anyway - metadata update is not critical for payment
        }
      }

      // Track add_payment_info event before confirming payment
      const items = [{
        item_id: product.id,
        item_name: product.name,
        price: basePrice,
        quantity: 1,
      }];
      if (bumpSelected && bumpProduct) {
        items.push({
          item_id: bumpProduct.bump_product_id,
          item_name: bumpProduct.bump_product_name || t('additionalProduct'),
          price: bumpProduct.bump_price,
          quantity: 1,
        });
      }
      await track('add_payment_info', {
        value: totalGross,
        currency: product.currency,
        items,
        userEmail: finalEmail,
      });

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/payment/success?product_id=${product.id}&product=${product.slug}${successUrl ? `&success_url=${encodeURIComponent(successUrl)}` : ''}`,
          receipt_email: finalEmail,
          payment_method_data: {
            billing_details: {
              email: finalEmail,
              name: fullName,
            },
          },
        },
      });

      if (error) {
        setErrorMessage(error.message || t('paymentFailed'));
        setIsProcessing(false);
      }
    } catch (err: any) {
      setErrorMessage(err.message || t('unexpectedError'));
      setIsProcessing(false);
    }
  };

  if (paymentSuccess) {
    return (
      <div className="p-6 bg-sf-success-soft border border-sf-success/20 rounded-xl">
        <div className="flex items-center">
          <div className="flex-shrink-0 w-10 h-10 bg-sf-success-soft rounded-full flex items-center justify-center mr-4">
            <svg className="w-5 h-5 text-sf-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-sf-success">{t('paymentSuccessful', { defaultValue: 'Payment Successful!' })}</h3>
            <p className="text-sf-success text-sm">{t('accessGranted')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <DemoCheckoutNotice />
      {/* Email — LinkAuthenticationElement (handles Link detection + email collection) */}
      <div data-test-email={linkEmail || email || ''}>
        {email && onChangeAccount && (
          <div className="flex justify-end mb-1">
            <button
              type="button"
              onClick={onChangeAccount}
              className="text-sf-accent hover:text-sf-accent-hover text-xs underline transition-colors"
            >
              {t('changeAccount')}
            </button>
          </div>
        )}
        <LinkAuthenticationElement
          options={{ defaultValues: { email: email || '' } }}
          onChange={(e) => setLinkEmail(e.value.email)}
        />
      </div>

      {/* Email mismatch warning — logged-in user purchasing with a different email */}
      {emailMismatch && (
        <div className="p-3 bg-sf-warning-soft border border-sf-warning/20 rounded-lg">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-sf-warning flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="text-xs text-sf-warning">
              {t('emailMismatchWarning', {
                accountEmail: email,
                purchaseEmail: linkEmail,
                defaultValue: `You are purchasing with ${linkEmail}, but you are logged in as ${email}. The product will be linked to your account.`,
              })}
            </p>
          </div>
        </div>
      )}

      {/* Full Name - single field */}
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-sf-body mb-2">
          {t('fullName', { defaultValue: 'Imię i nazwisko' })}
        </label>
        <input
          type="text"
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={t('fullNamePlaceholder')}
          required
          disabled={isLoadingProfile}
          className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
        />
      </div>

      {/* Terms & Conditions - only for guests */}
      {!email && (
        <div className="py-1">
          <label className="flex items-start cursor-pointer group">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-sf-accent bg-sf-input border border-sf-border rounded focus:ring-2 focus:ring-sf-accent/50 focus:border-sf-accent/50 transition-colors"
              required
            />
            <span className="ml-3 text-sm text-sf-body">
              {t('iAgree', { defaultValue: 'I agree to the' })}{' '}
              <a href="/terms" target="_blank" className="text-sf-accent hover:text-sf-accent-hover underline transition-colors">
                {t('termsOfService', { defaultValue: 'Terms of Service' })}
              </a>
              {' '}{t('and', { defaultValue: 'and' })}{' '}
              <a href="/privacy" target="_blank" className="text-sf-accent hover:text-sf-accent-hover underline transition-colors">
                {t('privacyPolicy', { defaultValue: 'Privacy Policy' })}
              </a>
              <span className="text-sf-danger ml-1">*</span>
            </span>
          </label>
        </div>
      )}

      {/* Payment Element — tabs layout, Apple Pay/Google Pay as wallet tabs */}
      <div>
        <PaymentElement
          options={{
            layout: {
              type: 'tabs',
              defaultCollapsed: false,
            },
            defaultValues: {
              billingDetails: {
                name: fullName || undefined,
              },
            },
            paymentMethodOrder: (() => {
              const baseOrder = paymentMethodOrder && paymentMethodOrder.length > 0
                ? paymentMethodOrder
                : product.currency === 'PLN'
                ? ['blik', 'p24', 'card']
                : product.currency === 'EUR'
                ? ['sepa_debit', 'ideal', 'card', 'klarna']
                : product.currency === 'USD'
                ? ['card', 'cashapp', 'affirm']
                : undefined;
              // Filter out 'link' — LAE handles Link separately
              return baseOrder?.filter(m => m !== 'link');
            })(),
            wallets: {
              applePay: expressCheckoutConfig?.applePay !== false ? 'auto' : 'never',
              googlePay: expressCheckoutConfig?.googlePay !== false ? 'auto' : 'never',
            },
            fields: {
              billingDetails: {
                email: 'never',
                name: 'never',
              },
            },
          }}
        />
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-4 bg-sf-danger-soft border border-sf-danger/20 rounded-lg">
          <p className="text-sf-danger text-sm">{errorMessage}</p>
        </div>
      )}

      {/* NIP Field - Optional, triggers company fields */}
      <div className="space-y-3">
        <div>
          <label htmlFor="nip" className="block text-sm font-medium text-sf-body mb-2">
            {t('nipLabel')} <span className="text-sf-muted text-xs">({t('optional', { defaultValue: 'optional' })})</span>
          </label>
          <div className="relative">
            <input
              type="text"
              id="nip"
              value={nip}
              onChange={(e) => {
                setNip(e.target.value);
                setNipError(null);
                setGusError(null);
                setGusSuccess(false);
                setGusData(null);
              }}
              onBlur={handleNIPBlur}
              placeholder={t('taxIdPlaceholder')}
              maxLength={20}
              className={`w-full px-3 py-2.5 bg-sf-input border ${
                nipError ? 'border-sf-danger/50' : gusSuccess ? 'border-sf-success/50' : 'border-sf-border'
              } rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent ${
                isLoadingGUS ? 'pr-10' : ''
              }`}
            />
            {isLoadingGUS && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg className="animate-spin h-5 w-5 text-sf-accent" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            )}
          </div>
          {nipError && (
            <p className="mt-1 text-xs text-sf-danger">{nipError}</p>
          )}
          {gusError && (
            <p className="mt-1 text-xs text-sf-warning">⚠️ {gusError}</p>
          )}
          {gusSuccess && !isLoadingGUS && (
            <p className="mt-1 text-xs text-sf-success">✓ {t('gusDataFetched')}</p>
          )}
        </div>

        {/* Company fields - show when NIP is provided or GUS data fetched */}
        {(nip.length === 10 || gusData || companyName) && (
          <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
            <div>
              <label htmlFor="companyName" className="block text-sm font-medium text-sf-body mb-2">
                {t('companyNameLabel', { defaultValue: 'Company Name' })}
              </label>
              <input
                type="text"
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t('companyNamePlaceholder')}
                className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="address" className="block text-sm font-medium text-sf-body mb-2">
                {t('addressLabel')}
              </label>
              <input
                type="text"
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t('addressPlaceholder')}
                className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="postalCode" className="block text-sm font-medium text-sf-body mb-2">
                  {t('postalCodeLabel')}
                </label>
                <input
                  type="text"
                  id="postalCode"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder={t('postalCodePlaceholder')}
                  className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="city" className="block text-sm font-medium text-sf-body mb-2">
                  {t('cityLabel')}
                </label>
                <input
                  type="text"
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder={t('cityPlaceholder')}
                  className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Order Summary - Compact (Zanfia/EasyCart-inspired) */}
      <div className="space-y-2 py-4 border-t border-sf-border">
        {/* Show bump or coupon if present */}
        {(bumpSelected && bumpProduct) || (appliedCoupon && discountAmount > 0) ? (
          <>
            {/* Product Price */}
            <div className="flex justify-between text-sm text-sf-muted">
              <span>{product.name}</span>
              <span>{formatPrice(basePrice, product.currency)} {product.currency}</span>
            </div>

            {/* Bump Product */}
            {bumpSelected && bumpProduct && (
              <div className="flex justify-between text-sm text-sf-muted">
                <span>{bumpProduct.bump_product_name || t('additionalProduct')}</span>
                <span>{formatPrice(bumpProduct.bump_price, product.currency)} {product.currency}</span>
              </div>
            )}

            {/* Coupon Discount */}
            {appliedCoupon && discountAmount > 0 && (
              <div className="flex justify-between text-sm text-sf-success">
                <span>{t('couponDiscount', { defaultValue: 'Discount' })} ({appliedCoupon.code})</span>
                <span>-{formatPrice(discountAmount, product.currency)} {product.currency}</span>
              </div>
            )}

            <div className="border-t border-sf-border my-2" />
          </>
        ) : null}

        {/* Total - Prominent */}
        <div className="flex justify-between items-baseline">
          <div>
            <div className={`font-semibold ${customAmountError ? 'text-sf-danger' : 'text-sf-heading'}`}>
              {t('total', { defaultValue: 'Total' })}
              {customAmountError && (
                <span className="text-xs font-normal ml-2">({t('invalidAmount', { defaultValue: 'invalid amount' })})</span>
              )}
            </div>
            {taxMode !== 'stripe_tax' && !customAmountError && product.vat_rate && product.vat_rate > 0 && (
              <div className="text-xs text-sf-muted">
                {t('netPrice')}: {formatPrice(totalNet, product.currency)} {product.currency} + {t('vat')} {vatRate}%
              </div>
            )}
          </div>
          <div className={`text-2xl font-bold ${customAmountError ? 'text-sf-danger line-through' : 'text-sf-heading'}`}>
            {formatPrice(totalGross, product.currency)} {product.currency}
          </div>
        </div>
      </div>

      {/* Confirm Email Address — only when logged-in user uses a different email */}
      {emailMismatch && (
        <div className="py-1">
          <label className="flex items-start cursor-pointer group">
            <input
              type="checkbox"
              checked={emailConfirmed}
              onChange={(e) => setEmailConfirmed(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-sf-accent bg-sf-input border border-sf-border rounded focus:ring-2 focus:ring-sf-accent/50 focus:border-sf-accent/50 transition-colors"
            />
            <span className="ml-3 text-sm text-sf-body">
              {t('confirmEmailLabel', { accountEmail: email, purchaseEmail: linkEmail, defaultValue: `I confirm the product will be linked to my account (${email}). Receipt will be sent to ${linkEmail}.` })}
            </span>
          </label>
        </div>
      )}

      {/* PWYW Validation Error Warning */}
      {customAmountError && (
        <div className="p-3 bg-sf-danger-soft border border-sf-danger/20 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-sf-danger flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-sf-danger">{customAmountError}</p>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!stripe || isProcessing || !!customAmountError || (emailMismatch && !emailConfirmed)}
        className={`w-full px-6 py-4 text-white font-bold rounded-full shadow-[var(--sf-shadow-accent)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${
          customAmountError
            ? 'bg-sf-muted/30 cursor-not-allowed'
            : 'bg-sf-accent-bg hover:bg-sf-accent-hover'
        }`}
      >
        {isProcessing ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {t('processing', { defaultValue: 'Processing...' })}
          </span>
        ) : customAmountError ? (
          t('fixAmountFirst', { defaultValue: 'Fix the amount above to continue' })
        ) : (
          t('payButton', { amount: `${formatPrice(totalGross, product.currency)} ${product.currency}`, defaultValue: `Pay ${formatPrice(totalGross, product.currency)} ${product.currency}` })
        )}
      </button>

      <p className="text-xs text-sf-muted text-center">
        🔒 {t('securePayment')}
      </p>
    </form>
  );
}
