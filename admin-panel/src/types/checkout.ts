// Error types for better error handling
export enum CheckoutErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  PRODUCT_UNAVAILABLE = 'PRODUCT_UNAVAILABLE',
  DUPLICATE_ACCESS = 'DUPLICATE_ACCESS',
  STRIPE_ERROR = 'STRIPE_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class CheckoutError extends Error {
  constructor(
    public type: CheckoutErrorType,
    message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

// Request/Response types
export interface CreateCheckoutRequest {
  productId: string;
  email?: string;
  /** @deprecated Use bumpProductIds instead */
  bumpProductId?: string;
  bumpProductIds?: string[]; // Multiple order bump product IDs
  couponCode?: string; // NEW: Optional discount code
  successUrl?: string; // NEW: Optional OTO redirect URL
  customAmount?: number; // Pay What You Want - customer-chosen price
}

export interface CreateCheckoutResponse {
  clientSecret: string;
  sessionId: string;
}

export interface CheckoutErrorResponse {
  error: string;
  type: CheckoutErrorType;
}

// Product types for checkout
export interface ProductForCheckout {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  is_active: boolean;
  available_from: string | null;
  available_until: string | null;
  // Pay What You Want fields
  allow_custom_price?: boolean;
  custom_price_min?: number;
  // VAT/Tax fields
  vat_rate: number | null;
  price_includes_vat: boolean;
}

// User access types
export interface UserAccessData {
  access_expires_at: string | null;
  access_duration_days: number | null;
  access_granted_at: string;
}

// Checkout session options
export interface CheckoutSessionOptions {
  product: ProductForCheckout;
  /** @deprecated Use bumpProducts instead */
  bumpProduct?: ProductForCheckout;
  bumpProducts?: ProductForCheckout[]; // Multiple order bump products
  email?: string;
  userId?: string;
  returnUrl: string;
  coupon?: {
    id: string;
    code: string;
    discount_type: 'percentage' | 'fixed';
    discount_value: number;
    exclude_order_bumps?: boolean;
  };
  customAmount?: number; // Pay What You Want - customer-chosen price
}
