'use client';

import { useState } from 'react';
import { PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import type { StripeCheckoutContact, StripePaymentElementOptions } from '@stripe/stripe-js';
import { Product } from '@/types';
import type { OrderBumpWithProduct } from '@/types/order-bump';
import { ExpressCheckoutConfig } from '@/types/payment-config';
import { formatPrice } from '@/lib/constants';
import { formatBillingIntervalLabel } from '@/lib/product-pricing-display';
import { useTranslations, useLocale } from 'next-intl';
import { validateTaxId } from '@/lib/validation/nip';
import { useTracking } from '@/hooks/useTracking';
import type { PricingResult } from '@/hooks/usePricing';
import { useInvoiceData } from '@/hooks/useInvoiceData';
import DemoCheckoutNotice from '@/components/DemoCheckoutNotice';
import InvoiceFields from '@/components/checkout/InvoiceFields';
import OrderSummary from '@/components/checkout/OrderSummary';
import type { TaxMode } from '@/lib/actions/shop-config';
import type { AppliedCoupon } from '@/types/coupon';
import CustomCheckoutFieldsForm from '@/components/checkout/CustomCheckoutFieldsForm';
import type {
  CustomFieldDefinition,
  CustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';

interface CustomPaymentFormProps {
  product: Product;
  email?: string;
  bumpProducts?: OrderBumpWithProduct[];
  selectedBumpIds?: Set<string>;
  appliedCoupon?: AppliedCoupon;
  onChangeAccount?: () => void;
  customAmount?: number;
  customAmountError?: string | null;
  clientSecret?: string;
  pricing: PricingResult;
  paymentMethodOrder?: string[];
  expressCheckoutConfig?: ExpressCheckoutConfig;
  taxMode?: TaxMode;
  customFieldDefs?: CustomFieldDefinition[];
  customFieldValues?: CustomFieldValues;
  onCustomFieldValuesChange?: (next: CustomFieldValues) => void;
  customFieldErrors?: Record<string, string>;
  afterCheckoutSlot?: React.ReactNode;
}

type EmailValidationResponse = {
  success: boolean;
  data?: {
    isValid: boolean;
    isDisposable: boolean;
    error?: string;
  };
  error?: {
    message: string;
  };
};

export default function CustomPaymentForm({
  product,
  email,
  bumpProducts = [],
  selectedBumpIds = new Set(),
  appliedCoupon,
  onChangeAccount,
  customAmountError,
  clientSecret,
  pricing,
  paymentMethodOrder,
  expressCheckoutConfig,
  taxMode,
  customFieldDefs = [],
  customFieldValues = {},
  onCustomFieldValuesChange,
  customFieldErrors,
  afterCheckoutSlot,
}: CustomPaymentFormProps) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const checkoutResult = useCheckoutElements();
  const { track } = useTracking();

  const isSubscription = product.product_type === 'subscription';
  const intervalLabel = isSubscription
    ? formatBillingIntervalLabel(product.billing_interval, product.billing_interval_count, locale)
    : '';

  const [linkEmail, setLinkEmail] = useState(email || '');
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const emailMismatch = !!(email && linkEmail && linkEmail.toLowerCase() !== email.toLowerCase());

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Invoice / NIP logic
  const invoice = useInvoiceData(email);

  const { basePrice, discountAmount, totalGross, totalNet, vatRate } = pricing;
  const paymentElementOptions: StripePaymentElementOptions = {
    layout: {
      type: 'tabs',
    },
    ...(paymentMethodOrder && paymentMethodOrder.length > 0
      ? { paymentMethodOrder: paymentMethodOrder.filter(m => m !== 'link') }
      : {}),
    wallets: {
      applePay: expressCheckoutConfig?.applePay !== false ? 'auto' : 'never',
      googlePay: expressCheckoutConfig?.googlePay !== false ? 'auto' : 'never',
    },
    fields: {
      billingDetails: {
        email: 'never',
        name: 'never',
        // Stripe enforces paired address collection — all or nothing.
        address: {
          line1: 'never',
          line2: 'never',
          city: 'never',
          state: 'never',
          country: 'never',
          postalCode: 'never',
        },
      },
    },
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (checkoutResult.type !== 'success') return;
    const checkout = checkoutResult.checkout;

    const finalEmail = linkEmail || email;
    if (!finalEmail) {
      setErrorMessage(t('emailRequired', { defaultValue: 'Email is required' }));
      return;
    }

    if (emailMismatch && !emailConfirmed) {
      setErrorMessage(t('confirmEmailRequired', { defaultValue: 'Please confirm the product assignment to your account' }));
      return;
    }

    if (!invoice.fullName || invoice.fullName.trim().length === 0) {
      setErrorMessage(t('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }

    if (!email && !termsAccepted) {
      setErrorMessage(t('termsRequired', { defaultValue: 'Please accept Terms and Conditions' }));
      return;
    }

    if (invoice.nip && invoice.nip.trim().length > 0) {
      const validation = validateTaxId(invoice.nip, true);
      if (!validation.isValid) {
        setErrorMessage(validation.error || t('invalidTaxIdFormat'));
        return;
      }
    }

    setIsProcessing(true);
    setErrorMessage('');

    try {
      const validationResponse = await fetch('/api/validate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: finalEmail }),
      });
      const validation = (await validationResponse
        .json()
        .catch(() => null)) as EmailValidationResponse | null;
      if (!validationResponse.ok || !validation?.success || !validation.data?.isValid) {
        setErrorMessage(
          validation?.data?.error ||
            validation?.error?.message ||
            'Invalid or disposable email address not allowed'
        );
        setIsProcessing(false);
        return;
      }

      if (clientSecret) {
        const hasValidTaxId = invoice.nip && invoice.nip.trim().length > 0 && validateTaxId(invoice.nip, false).isValid;
        const updateResponse = await fetch('/api/update-payment-metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientSecret,
            fullName: invoice.fullName,
            termsAccepted: !email ? termsAccepted : undefined,
            needsInvoice: hasValidTaxId ? true : false,
            nip: invoice.nip || undefined,
            companyName: invoice.companyName || undefined,
            address: invoice.address || undefined,
            city: invoice.city || undefined,
            postalCode: invoice.postalCode || undefined,
            country: invoice.country || undefined,
            customFieldValues:
              customFieldDefs.length > 0 ? customFieldValues : undefined,
          }),
        });

        if (!updateResponse.ok) {
          // Custom field validation surfaces per-field detail — block submit
          // so the buyer sees the error rather than silently failing.
          const errorBody = await updateResponse.json().catch(() => ({}));
          if (errorBody?.error === 'Invalid custom field values' && errorBody.details) {
            setErrorMessage(
              t('customFieldsInvalid', {
                defaultValue: 'Please fill the required information fields.',
              }),
            );
            setIsProcessing(false);
            return;
          }
          console.error('[CustomPaymentForm] Failed to update payment metadata');
          // Continue anyway — metadata update is not critical for payment
        }
      }

      // Stripe rejects updateEmail when session already has customer_email.
      const currentSessionEmail = (checkout as unknown as { email?: string | null }).email ?? null;
      if (currentSessionEmail !== finalEmail) {
        const emailUpdate = await checkout.updateEmail(finalEmail);
        if (emailUpdate.type === 'error') {
          setErrorMessage(emailUpdate.error.message || t('emailRequired', { defaultValue: 'Email is required' }));
          setIsProcessing(false);
          return;
        }
      }

      // Track add_payment_info
      const items = [{
        item_id: product.id,
        item_name: product.name,
        price: basePrice,
        quantity: 1,
      }];
      for (const bump of bumpProducts.filter(bp => selectedBumpIds.has(bp.bump_product_id))) {
        items.push({
          item_id: bump.bump_product_id,
          item_name: bump.bump_product_name || t('additionalProduct'),
          price: bump.bump_price,
          quantity: 1,
        });
      }
      await track('add_payment_info', {
        value: totalGross,
        currency: product.currency,
        items,
        userEmail: finalEmail,
      });

      // All PaymentElement billing fields are 'never' (paired group), so we
      // must push them via updateBillingAddress. Optional invoice fields fall
      // back to null — Stripe accepts nullable address members.
      const billingAddressUpdate = await checkout.updateBillingAddress({
        name: invoice.fullName,
        address: {
          country: invoice.country || 'PL',
          line1: invoice.address || null,
          line2: null,
          city: invoice.city || null,
          state: null,
          postal_code: invoice.postalCode || null,
        },
      });
      if (billingAddressUpdate.type === 'error') {
        setErrorMessage(billingAddressUpdate.error.message || t('paymentFailed'));
        setIsProcessing(false);
        return;
      }

      const result = await checkout.confirm();

      if (result.type === 'error') {
        setErrorMessage(result.error.message || t('paymentFailed'));
        setIsProcessing(false);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('unexpectedError'));
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <DemoCheckoutNotice />

      {/* Email */}
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
        <label htmlFor="checkoutEmail" className="block text-sm font-medium text-sf-body mb-2">
          Email
        </label>
        <input
          type="email"
          id="checkoutEmail"
          value={linkEmail}
          onChange={(e) => setLinkEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent"
        />
      </div>

      {/* Email mismatch warning */}
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

      {/* Full Name */}
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-sf-body mb-2">
          {t('fullName', { defaultValue: 'Imię i nazwisko' })}
        </label>
        <input
          type="text"
          id="fullName"
          value={invoice.fullName}
          onChange={(e) => invoice.setFullName(e.target.value)}
          placeholder={t('fullNamePlaceholder')}
          required
          disabled={invoice.isLoadingProfile}
          className="w-full px-3 py-2.5 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
        />
      </div>

      {/* Terms & Conditions — guests only */}
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

      {/* Payment Element */}
      <div>
        <PaymentElement options={paymentElementOptions} />
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-4 bg-sf-danger-soft border border-sf-danger/20 rounded-lg">
          <p className="text-sf-danger text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Invoice Fields (NIP + company) */}
      <InvoiceFields invoice={invoice} />

      {/* Product-defined custom checkout fields (e.g. message, domain). */}
      {customFieldDefs.length > 0 && onCustomFieldValuesChange && (
        <CustomCheckoutFieldsForm
          fields={customFieldDefs}
          values={customFieldValues}
          onChange={onCustomFieldValuesChange}
          errors={customFieldErrors}
          disabled={isProcessing}
        />
      )}

      {/* Order Summary */}
      <OrderSummary
        productName={product.name}
        currency={product.currency}
        basePrice={basePrice}
        discountAmount={discountAmount}
        totalGross={totalGross}
        totalNet={totalNet}
        vatRate={vatRate}
        taxMode={taxMode}
        customAmountError={customAmountError}
        appliedCoupon={appliedCoupon}
        bumpProducts={bumpProducts}
        selectedBumpIds={selectedBumpIds}
        intervalLabel={intervalLabel || undefined}
      />

      {/* Confirm Email — when logged-in user uses different email */}
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

      {/* Submit Button */}
      <button
        type="submit"
        disabled={checkoutResult.type !== 'success' || isProcessing || !!customAmountError || (emailMismatch && !emailConfirmed)}
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
        ) : isSubscription && intervalLabel ? (
          t('subscribeButton', {
            amount: `${formatPrice(totalGross, product.currency)} / ${intervalLabel}`,
            defaultValue: `Subskrybuj ${formatPrice(totalGross, product.currency)} / ${intervalLabel}`,
          })
        ) : (
          t('payButton', {
            amount: formatPrice(totalGross, product.currency),
            defaultValue: `Zapłać ${formatPrice(totalGross, product.currency)}`,
          })
        )}
      </button>

      <p className="text-xs text-sf-muted text-center">{t('securePayment')}</p>
      {afterCheckoutSlot}
    </form>
  );
}
