/**
 * Supported currency codes matching the database CHECK constraint.
 * @see supabase/migrations/20250101000000_core_schema.sql (products.currency CHECK)
 */
export const SUPPORTED_CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN',
  'HRK', 'RUB', 'TRY', 'BRL', 'MXN', 'INR', 'KRW', 'SGD',
  'HKD', 'NZD', 'ZAR', 'ILS', 'THB', 'MYR', 'PHP', 'IDR', 'VND',
] as const;

export type SupportedCurrencyCode = typeof SUPPORTED_CURRENCY_CODES[number];

export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'PLN', symbol: 'zł', name: 'Polish Złoty' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  { code: 'MXN', symbol: 'Mex$', name: 'Mexican Peso' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won' }
];

export const getCurrencySymbol = (currencyCode: string): string => {
  const currency = CURRENCIES.find(c => c.code === currencyCode);
  return currency ? currency.symbol : currencyCode;
};

export const formatPrice = (price: number, currencyCode: string): string => {
  const currency = CURRENCIES.find(c => c.code === currencyCode);
  const symbol = currency ? currency.symbol : currencyCode;
  
  // Different formatting based on currency
  if (currencyCode === 'JPY' || currencyCode === 'KRW') {
    // No decimal places for JPY and KRW
    return `${symbol}${Math.round(price).toLocaleString()}`;
  }
  
  return `${symbol}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Stripe minimum charge amount in currency units (e.g., $0.50).
 * Used as default fallback for custom_price_min across checkout flows.
 * @see https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
 */
export const STRIPE_MINIMUM_AMOUNT = 0.50;

/**
 * Stripe maximum charge amount in currency units.
 * Applied as upper bound for Pay What You Want custom pricing.
 * @see https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
 */
export const STRIPE_MAX_AMOUNT = 999999.99;

/**
 * Stripe API version used across all Stripe SDK calls.
 * When updating, also update the webhook endpoint version in the Stripe Dashboard.
 * @see https://stripe.com/docs/upgrades
 */
export const STRIPE_API_VERSION = '2026-02-25.clover' as const;

/**
 * Stripe webhook events that must be subscribed to in the Stripe Dashboard.
 * @see admin-panel/src/app/api/webhooks/stripe/route.ts
 */
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'payment_intent.succeeded',
  'charge.refunded',
  'charge.dispute.created',
  // Stripe Connect: seller account lifecycle
  'account.updated',
  'account.application.deauthorized',
] as const;

/**
 * Product fields for public-facing product page queries.
 * Shared between /p/[slug] and /s/[seller]/[product] pages.
 * @see supabase/migrations/20250101000000_core_schema.sql — products table
 */
export const PRODUCT_PAGE_FIELDS = [
  'id', 'name', 'slug', 'description', 'long_description',
  'icon', 'image_url', 'thumbnail_url', 'preview_video_url',
  'price', 'currency', 'vat_rate', 'price_includes_vat',
  'features', 'layout_template',
  'is_active', 'is_featured', 'is_listed',
  'omnibus_exempt',
  'sale_price', 'sale_price_until', 'sale_quantity_limit', 'sale_quantity_sold',
  'available_from', 'available_until', 'auto_grant_duration_days',
  'content_delivery_type', 'content_config',
  'success_redirect_url', 'pass_params_to_redirect',
  'is_refundable', 'refund_period_days',
  'enable_waitlist',
  'allow_custom_price', 'custom_price_min', 'show_price_presets', 'custom_price_presets',
  'created_at', 'updated_at',
].join(', ');
