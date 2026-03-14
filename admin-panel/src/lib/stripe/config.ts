/**
 * Unified Stripe and checkout configuration
 * 
 * 🎯 HOW TO USE:
 * 
 * For PaymentElement:
 *   import { StripeConfig } from '@/lib/stripe/config'
 *   <Elements options={StripeConfig.elementsOptions(clientSecret)}>
 * 
 * For EmbeddedCheckout with fetchClientSecret:
 *   import { StripeConfig } from '@/lib/stripe/config'
 *   <EmbeddedCheckoutProvider options={StripeConfig.embeddedCheckout(fetchFn)}>
 * 
 * For EmbeddedCheckout with clientSecret:
 *   import { StripeConfig } from '@/lib/stripe/config'
 *   <EmbeddedCheckoutProvider options={StripeConfig.embeddedCheckoutWithSecret(secret, onComplete)}>
 * 
 * 🎨 TO CHANGE CONFIGURATION:
 * Edit .stripe file in project root - changes apply everywhere!
 * Configuration is loaded from .stripe file or environment variables.
 */

import type { Appearance, StripeElementsOptions } from '@stripe/stripe-js';

/**
 * Helper functions to get configuration from environment variables
 * These use runtime environment variables instead of NEXT_PUBLIC_*
 */
const getEnv = (key: string, fallback: string): string => {
  return process.env[key] || fallback;
};

const toBool = (value: string): boolean => {
  return value.toLowerCase() === 'true';
};

const toNumber = (value: string): number => {
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
};

// Core Stripe configuration (loaded from server-side environment variables)
export const STRIPE_CONFIG = {
  // UI Theme
  theme: getEnv('STRIPE_THEME', 'night') as 'stripe' | 'night' | 'flat',
  labels: getEnv('STRIPE_LABELS', 'floating') as 'above' | 'floating',
  
  // Payment methods (ordered by preference)  
  payment_method_types: getEnv('STRIPE_PAYMENT_METHODS', 'blik,p24,card').split(',').map(s => s.trim()) as ('blik' | 'p24' | 'card' | 'link' | 'klarna')[],
  
  // Payment method options
  payment_method_options: {
    blik: {
      setup_future_usage: getEnv('STRIPE_BLIK_SETUP_FUTURE_USAGE', 'off_session') as 'off_session' | 'on_session',
    },
  },
  
  // Session settings
  session: {
    expires_hours: toNumber(getEnv('STRIPE_SESSION_EXPIRES_HOURS', '24')),
    billing_address_collection: getEnv('STRIPE_SESSION_BILLING_ADDRESS_COLLECTION', 'auto') as 'auto' | 'required',
    automatic_tax: { 
      enabled: toBool(getEnv('STRIPE_SESSION_AUTOMATIC_TAX_ENABLED', 'true'))
    },
    tax_id_collection: { 
      enabled: toBool(getEnv('STRIPE_SESSION_TAX_ID_COLLECTION_ENABLED', 'true'))
    },
  },
  
  // Rate limiting
  rate_limit: {
    max_requests: toNumber(getEnv('STRIPE_RATE_LIMIT_MAX_REQUESTS', '10')),
    window_minutes: toNumber(getEnv('STRIPE_RATE_LIMIT_WINDOW_MINUTES', '1')),
    action_type: getEnv('STRIPE_RATE_LIMIT_ACTION_TYPE', 'checkout_creation'),
  },
  
  // Layout options
  layouts: {
    default: getEnv('STRIPE_LAYOUTS_DEFAULT', 'tabs') as 'tabs' | 'accordion' | 'auto',
  }
} as const;

// Error messages (loaded from environment variables)
export const CHECKOUT_ERRORS = {
  PRODUCT_ID_REQUIRED: getEnv('STRIPE_ERROR_PRODUCT_ID_REQUIRED', 'Product ID is required'),
  INVALID_EMAIL: getEnv('STRIPE_ERROR_INVALID_EMAIL', 'Invalid email format'),
  PRODUCT_NOT_FOUND: getEnv('STRIPE_ERROR_PRODUCT_NOT_FOUND', 'Product not found or inactive'),
  PRODUCT_UNAVAILABLE: getEnv('STRIPE_ERROR_PRODUCT_UNAVAILABLE', 'Product not available for purchase'),
  DUPLICATE_ACCESS: getEnv('STRIPE_ERROR_DUPLICATE_ACCESS', 'You already have access to this product'),
  RATE_LIMIT_EXCEEDED: getEnv('STRIPE_ERROR_RATE_LIMIT_EXCEEDED', 'Too many checkout attempts. Please try again later.'),
  STRIPE_SESSION_FAILED: getEnv('STRIPE_ERROR_STRIPE_SESSION_FAILED', 'Failed to create checkout session'),
  INVALID_PRICE: getEnv('STRIPE_ERROR_INVALID_PRICE', 'Invalid product price')
} as const;

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500
} as const;

/**
 * Stripe appearance configuration for dark theme
 */
export const stripeAppearance: Appearance = {
  theme: STRIPE_CONFIG.theme,
  labels: STRIPE_CONFIG.labels,
  
  variables: {
    // Color scheme for dark theme
    colorPrimary: '#3b82f6', // Blue primary
    colorBackground: '#1f2937', // Dark background
    colorText: '#f9fafb', // Light text
    colorDanger: '#ef4444', // Red for errors
    colorSuccess: '#10b981', // Green for success
    
    // Border and spacing
    borderRadius: '8px',
    spacingUnit: '4px',
    spacingGridRow: '16px',
    spacingGridColumn: '16px',
    
    // Typography
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSizeBase: '14px',
    fontWeightNormal: '400',
    fontWeightBold: '600',
  },
  
  rules: {
    // Base styles
    '.Input': {
      backgroundColor: '#374151',
      border: '1px solid #4b5563',
      borderRadius: '8px',
      padding: '12px',
      fontSize: '14px',
      color: '#f9fafb',
      transition: 'border-color 0.2s ease',
    },
    
    '.Input:focus': {
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.1)',
      outline: 'none',
    },
    
    '.Input:hover': {
      borderColor: '#6b7280',
    },
    
    '.Input--invalid': {
      borderColor: '#ef4444',
    },
    
    '.Input--complete': {
      borderColor: '#10b981',
    },
    
    // Labels
    '.Label': {
      color: '#d1d5db',
      fontSize: '13px',
      fontWeight: '500',
      marginBottom: '6px',
    },
    
    '.Label--resting': {
      color: '#9ca3af',
    },
    
    '.Label--focus': {
      color: '#3b82f6',
    },
    
    // Error messages
    '.Error': {
      color: '#ef4444',
      fontSize: '13px',
      marginTop: '4px',
    },
    
    // Tabs (for PaymentElement)
    '.Tab': {
      backgroundColor: '#374151',
      border: '1px solid #4b5563',
      borderRadius: '6px 6px 0 0',
      padding: '12px 16px',
      color: '#d1d5db',
      fontSize: '14px',
      fontWeight: '500',
      transition: 'all 0.2s ease',
    },
    
    '.Tab:hover': {
      backgroundColor: '#4b5563',
      borderColor: '#6b7280',
    },
    
    '.Tab--selected': {
      backgroundColor: '#1f2937',
      borderColor: '#3b82f6',
      borderBottomColor: '#1f2937',
      color: '#f9fafb',
    },
    
    // Tab content area
    '.TabContent': {
      backgroundColor: '#1f2937',
      border: '1px solid #4b5563',
      borderTop: 'none',
      borderRadius: '0 0 8px 8px',
      padding: '16px',
    },
    
    // Loading indicators
    '.Spinner': {
      color: '#3b82f6',
    },
    
    // Checkboxes and radios
    '.Checkbox': {
      backgroundColor: '#374151',
      borderColor: '#4b5563',
    },
    
    '.Checkbox:checked': {
      backgroundColor: '#3b82f6',
      borderColor: '#3b82f6',
    },
    
    // Express checkout buttons (Apple Pay, Google Pay, etc.)
    '.ExpressCheckoutElement': {
      backgroundColor: '#1f2937',
      borderRadius: '8px',
      padding: '1px',
    },
  },
};

/**
 * Default options for Stripe Elements
 */
export const defaultElementsOptions: StripeElementsOptions = {
  appearance: stripeAppearance,
  loader: 'auto',
};

/**
 * Ready-to-use Stripe Elements options for PaymentElement
 */
export const elementsOptions = (clientSecret: string) => ({
  clientSecret,
  appearance: stripeAppearance,
  loader: 'auto' as const,
});

/**
 * Ready-to-use EmbeddedCheckout options  
 */
export const embeddedCheckoutOptions = (fetchClientSecret: () => Promise<string>, onComplete?: () => void) => ({
  fetchClientSecret,
  ...(onComplete && { onComplete }),
});

/**
 * Ready-to-use EmbeddedCheckout options with client secret
 */
export const embeddedCheckoutOptionsWithSecret = (clientSecret: string, onComplete?: () => void) => ({
  clientSecret,
  ...(onComplete && { onComplete }),
});

/**
 * Configuration for different payment element layouts
 */
export const paymentElementOptions = {
  // Standard layout with tabs
  tabs: {
    layout: 'tabs' as const,
    paymentMethodOrder: ['blik', 'card', 'link', 'klarna', 'afterpay_clearpay'],
  },
  
  // Accordion layout
  accordion: {
    layout: 'accordion' as const,
    paymentMethodOrder: ['blik', 'card', 'link', 'klarna', 'afterpay_clearpay'],
  },
  
  // Auto layout (Stripe decides)
  auto: {
    layout: 'auto' as const,
  },
} as const;

/**
 * Helper function to get Elements options with custom appearance
 */
export function getElementsOptions(customAppearance?: Partial<Appearance>): StripeElementsOptions {
  return {
    ...defaultElementsOptions,
    appearance: customAppearance 
      ? { ...stripeAppearance, ...customAppearance }
      : stripeAppearance,
  };
}

/**
 * Helper function to get payment element options
 */
export function getPaymentElementOptions(layout: 'tabs' | 'accordion' = 'tabs') {
  const baseOptions = {
    appearance: stripeAppearance,
  };

  switch (layout) {
    case 'tabs':
      return {
        ...baseOptions,
        layout: 'tabs' as const,
      };
    case 'accordion':
      return {
        ...baseOptions,
        layout: 'accordion' as const,
      };
    default:
      return baseOptions;
  }
}

// =============================================================================
// 🎯 MAIN API - USE THESE FUNCTIONS IN YOUR COMPONENTS
// =============================================================================

/**
 * The only configuration object you need to import.
 * Change settings here and they apply everywhere.
 */
export const StripeConfig = {
  /**
   * Get Elements options for PaymentElement
   * Usage: <Elements options={StripeConfig.elementsOptions(clientSecret)}>
   */
  elementsOptions,

  /**
   * Get EmbeddedCheckout options with fetchClientSecret
   * Usage: <EmbeddedCheckoutProvider options={StripeConfig.embeddedCheckout(fetchFn)}>
   */
  embeddedCheckout: embeddedCheckoutOptions,

  /**
   * Get EmbeddedCheckout options with direct clientSecret
   * Usage: <EmbeddedCheckoutProvider options={StripeConfig.embeddedCheckoutWithSecret(secret, onComplete)}>
   */
  embeddedCheckoutWithSecret: embeddedCheckoutOptionsWithSecret,

  /**
   * Get PaymentElement options with layout
   * Usage: <PaymentElement options={StripeConfig.paymentElement('tabs')}>
   */
  paymentElement: getPaymentElementOptions,

  /**
   * Direct access to appearance object (for advanced use)
   */
  appearance: stripeAppearance,
} as const;
