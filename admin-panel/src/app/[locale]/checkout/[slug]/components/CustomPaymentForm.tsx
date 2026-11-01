'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import { checkoutProfileSchema } from '@/lib/checkout-modules/profile';
import CheckoutProfileFields from '@/components/checkout/CheckoutProfileFields';
import { formatPrice } from '@/lib/constants';
import { formatBillingIntervalLabel } from '@/lib/product-pricing-display';
import { validateTaxId } from '@/lib/validation/nip';
import { shouldShowTosCheckbox } from '@/lib/checkout/tos-display';
import { shouldRequestInvoice, shouldCollectBuyerCountry } from '@/lib/checkout/invoice-form-logic';
import { useTracking } from '@/hooks/useTracking';
import DemoCheckoutNotice from '@/components/DemoCheckoutNotice';
import InvoiceFields from '@/components/checkout/InvoiceFields';
import PaymentFormSkeleton from '@/components/checkout/PaymentFormSkeleton';
import CustomCheckoutFieldsForm from '@/components/checkout/CustomCheckoutFieldsForm';
import { getCheckoutRequestError } from '@/lib/checkout/request-error';
import { getTrialDays } from '@/lib/checkout/trial-display';
import TrialTerms from '@/components/checkout/TrialTerms';
import type { useInvoiceData } from '@/hooks/useInvoiceData';
import type { useCheckoutProfileValues } from '@/components/checkout/CheckoutProfileFields';
import type { StripePaymentElementOptions } from '@stripe/stripe-js';
import type { Product } from '@/types';
import type { OrderBumpWithProduct } from '@/types/order-bump';
import type { ExpressCheckoutConfig } from '@/types/payment-config';
import type { PricingResult } from '@/hooks/usePricing';
import type { TaxMode } from '@/lib/actions/shop-config';
import type { CustomFieldDefinition, CustomFieldValues } from '@/lib/validations/custom-checkout-fields';

interface CustomPaymentFormProps {
  product: Product;
  email?: string;
  invoice: ReturnType<typeof useInvoiceData>;
  profileForm: ReturnType<typeof useCheckoutProfileValues>;
  profileHandled?: boolean;
  onEmailChange(value: string): void;
  bumpProducts?: OrderBumpWithProduct[];
  selectedBumpIds?: Set<string>;
  onChangeAccount?: () => void;
  customAmountError?: string | null;
  quantityInvalid?: boolean;
  clientSecret?: string;
  bindingToken?: string;
  onConfirmationChange?: (pending: boolean) => void;
  onProcessingChange?: (processing: boolean) => void;
  pricing: PricingResult;
  paymentMethodOrder?: string[];
  expressCheckoutConfig?: ExpressCheckoutConfig;
  taxMode?: TaxMode;
  collectTermsOfService: boolean;
  termsAccepted: boolean;
  onTermsAcceptedChange(value: boolean): void;
  isGuest?: boolean;
  customFieldDefs?: CustomFieldDefinition[];
  customFieldValues?: CustomFieldValues;
  onCustomFieldValuesChange?: (next: CustomFieldValues) => void;
  customFieldErrors?: Record<string, string>;
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
  invoice, profileForm, profileHandled, onEmailChange,
  bumpProducts = [],
  selectedBumpIds = new Set(),
  onChangeAccount,
  customAmountError, quantityInvalid = false,
  clientSecret,
  bindingToken,
  onConfirmationChange, onProcessingChange,
  pricing,
  paymentMethodOrder,
  expressCheckoutConfig,
  taxMode,
  collectTermsOfService,
  termsAccepted,
  onTermsAcceptedChange: setTermsAccepted,
  isGuest = true,
  customFieldDefs = [],
  customFieldValues = {},
  onCustomFieldValuesChange,
  customFieldErrors,
}: CustomPaymentFormProps) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const checkoutResult = useCheckoutElements();
  const { track } = useTracking();

  const isSubscription = product.product_type === 'subscription';
  const trialDays = getTrialDays(product);
  const intervalLabel = isSubscription
    ? formatBillingIntervalLabel(product.billing_interval, product.billing_interval_count, locale)
    : '';

  const [linkEmail, setLinkEmail] = useState(email || '');
  const [previousEmail, setPreviousEmail] = useState(email);
  if (email !== previousEmail) {
    setPreviousEmail(email);
    if (isGuest) setLinkEmail(email ?? '');
  }
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const emailMismatch = !!(email && linkEmail && linkEmail.toLowerCase() !== email.toLowerCase());

  const showTos = shouldShowTosCheckbox(collectTermsOfService, isGuest);
  const [isProcessing, setIsProcessing] = useState(false);
  useEffect(() => { onProcessingChange?.(isProcessing); }, [isProcessing, onProcessingChange]);
  useEffect(() => () => onProcessingChange?.(false), [onProcessingChange]);
  const [paymentElementReady, setPaymentElementReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Invoice / NIP logic
  const parsedProfile = checkoutProfileSchema.safeParse(product.checkout_profile);
  const profile = parsedProfile.success ? parsedProfile.data : null;
  const { errors: moduleErrors, setErrors: setModuleErrors } = profileForm;

  const { basePrice, totalPayable } = pricing;
  const paymentElementOptions: StripePaymentElementOptions = {
    layout: {
      type: 'tabs',
    },
    ...(paymentMethodOrder && paymentMethodOrder.length > 0
      ? { paymentMethodOrder: paymentMethodOrder.filter(m => m !== 'link') }
      : { paymentMethodOrder: ['card'] }),
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
    if (quantityInvalid || !profileForm.validate()) return;

    if (checkoutResult.type !== 'success' || !paymentElementReady) return;
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

    if (!profile && (!invoice.fullName || invoice.fullName.trim().length === 0)) {
      setErrorMessage(t('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }

    if (showTos && !termsAccepted) {
      setErrorMessage(t('termsRequired', { defaultValue: 'Please accept Terms and Conditions' }));
      return;
    }

    if (!profile && invoice.nip && invoice.nip.trim().length > 0) {
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
          getCheckoutRequestError(validationResponse.status, validation?.data?.error || validation?.error?.message,
            'Invalid or disposable email address not allowed', t('emailValidationRateLimit'))
        );
        setIsProcessing(false);
        return;
      }

      if (clientSecret) {
        const updateResponse = await fetch('/api/update-payment-metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientSecret,
            bindingToken,
            productId: product.id,
            email: finalEmail,
            locale,
            moduleValues: profile ? profileForm.values : undefined,
            fullName: invoice.fullName,
            termsAccepted: showTos ? termsAccepted : undefined,
            needsInvoice: shouldRequestInvoice(invoice.nip),
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
          // Any failure stops the payment: the details must be stored before confirming.
          const errorBody = await updateResponse.json().catch(() => ({}));
          if (updateResponse.status === 422 && Array.isArray(errorBody.errors)) {
            setModuleErrors(errorBody.errors);
            setErrorMessage(t('profile.fixFields'));
            setIsProcessing(false);
            return;
          }
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
          setErrorMessage(t('detailsNotSaved'));
          setIsProcessing(false);
          return;
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
        value: totalPayable,
        currency: product.currency,
        items,
        userEmail: finalEmail,
      });

      // All PaymentElement billing fields are 'never' (paired group), so we
      // must push them via updateBillingAddress. Optional invoice fields fall
      // back to null — Stripe accepts nullable address members.
      const billingAddressUpdate = await checkout.updateBillingAddress({
        name: profile
          ? (profileForm.buyerType === 'organization'
            ? profileForm.party.company_name
            : `${profileForm.person.first_name} ${profileForm.person.last_name}`)
          : invoice.fullName,
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

      onConfirmationChange?.(true);
      const result = await checkout.confirm();

      if (result.type === 'error') {
        onConfirmationChange?.(false);
        setErrorMessage(result.error.message || t('paymentFailed'));
        setIsProcessing(false);
      }
    } catch (err) {
      onConfirmationChange?.(false);
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
        {profile && email ? <div id="buyer.email" tabIndex={-1} className="text-sm text-sf-body">Email: <span className="font-medium">{email}</span></div> : <>
        <label htmlFor="checkoutEmail" className="block text-sm font-medium text-sf-body mb-2">
          Email
        </label>
        <input
          type="email"
          id="checkoutEmail"
          aria-invalid={moduleErrors.some(error => error.field === 'buyer.email')}
          aria-describedby={moduleErrors.some(error => error.field === 'buyer.email') ? 'buyer.email-error' : undefined}
          value={linkEmail}
          onChange={(e) => { setLinkEmail(e.target.value); onEmailChange(e.target.value); }}
          placeholder="you@example.com"
          required
          className={`w-full px-3 py-2.5 bg-sf-input border ${moduleErrors.some(error => error.field === 'buyer.email') ? 'border-sf-danger' : 'border-sf-border'} rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent`}
        />
        </>}
      </div>

      {moduleErrors.filter(error => error.field === 'buyer.email').map(error => <p id="buyer.email-error" key={error.field} role="alert" className="text-sm text-sf-danger">{t('profile.errors.invalid')}</p>)}

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
      {!profile && <div>
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
      </div>}
      {profile && !profileHandled && <CheckoutProfileFields profile={profile} state={profileForm} invoice={invoice} errors={moduleErrors} disabled={isProcessing} />}

      {/* Terms & Conditions — guests only, and only when collect_terms_of_service is ON */}
      {showTos && (
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
      <div className="relative min-h-48">
        {!paymentElementReady && <div className="absolute inset-0 z-10 bg-sf-raised"><PaymentFormSkeleton /></div>}
        <PaymentElement options={paymentElementOptions} onReady={() => setPaymentElementReady(true)} />
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-4 bg-sf-danger-soft border border-sf-danger/20 rounded-lg">
          <p className="text-sf-danger text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Invoice Fields (NIP + company). Country selector only in Stripe Tax mode (drives
          jurisdiction + reverse charge); in Fixed-Rate mode the rate is flat. */}
      {!profile && <InvoiceFields invoice={invoice} showCountry={shouldCollectBuyerCountry(taxMode)} />}

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
      {trialDays && <TrialTerms days={trialDays} amount={totalPayable} currency={product.currency} intervalLabel={intervalLabel} />}
      <button
        type="submit"
        disabled={quantityInvalid || checkoutResult.type !== 'success' || !paymentElementReady || isProcessing || !!customAmountError || (emailMismatch && !emailConfirmed)}
        // Session readiness can precede the Element's interactive DOM. Keep
        // initialization distinct from processing and validation restrictions.
        {...(checkoutResult.type !== 'success' || !paymentElementReady ? { 'data-checkout-pending': true } : {})}
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
        ) : trialDays ? t('trial.start', { days: trialDays }) : isSubscription && intervalLabel ? (
          t('subscribeButton', {
            amount: `${formatPrice(totalPayable, product.currency, locale)} / ${intervalLabel}`,
            defaultValue: `Subskrybuj ${formatPrice(totalPayable, product.currency, locale)} / ${intervalLabel}`,
          })
        ) : (
          t('payButton', {
            amount: formatPrice(totalPayable, product.currency, locale),
            defaultValue: `Zapłać ${formatPrice(totalPayable, product.currency, locale)}`,
          })
        )}
      </button>

      <p className="text-xs text-sf-muted text-center">{t('securePayment')}</p>
    </form>
  );
}
