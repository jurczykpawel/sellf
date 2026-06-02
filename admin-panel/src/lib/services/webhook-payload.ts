/**
 * Shared webhook payload builder for purchase.completed events.
 *
 * Deduplicates payload construction from:
 * - verify-payment.ts (Checkout Session flow + Payment Intent flow)
 * - webhooks/stripe/route.ts (Checkout Session handler + Payment Intent handler)
 *
 * @see /lib/payment/verify-payment.ts
 * @see /app/api/webhooks/stripe/route.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatCustomFieldsForDisplay, type DisplayCustomField } from '@/lib/format-custom-fields';
import type { CustomFieldDefinition } from '@/lib/validations/custom-checkout-fields';

type AnySupabaseClient = SupabaseClient<any, any, any>;

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  icon: string | null;
}

export interface PurchaseWebhookData {
  customer: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    userId: string | null;
  };
  product: ProductDetail | { id: string };
  bumpProduct: ProductDetail | null;
  bumpProducts: ProductDetail[];
  order: {
    amount: number | null;
    currency: string | null;
    sessionId?: string;
    paymentIntentId: string | null | undefined;
    couponId: string | null;
    isGuest: boolean | undefined;
  };
  invoice?: {
    needsInvoice: boolean;
    nip: string | null;
    companyName: string | null;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
  };
  /**
   * Custom checkout-field answers, resolved against the product's
   * `custom_checkout_fields` definitions. Omitted when the seller didn't
   * configure any fields or the buyer didn't submit any values.
   */
  customFields?: DisplayCustomField[];
  source?: string;
  /** License issued on purchase. Present only when the product has license issuance enabled. */
  license?: {
    token: string;
    kid: string;
    jwksUrl: string;
  };
}

export interface BuildWebhookPayloadParams {
  supabaseClient: AnySupabaseClient;
  customerEmail: string;
  userId: string | null;
  productId: string;
  bumpProductIds: string[];
  metadata: Record<string, string | undefined> | null;
  amount: number | null;
  currency: string | null;
  sessionId?: string;
  paymentIntentId: string | null | undefined;
  couponId: string | null;
  isGuest: boolean | undefined;
  source?: string;
  /**
   * JSONB `custom_field_values` recorded on the buyer's payment_transactions
   * row. Resolved against the product's `custom_checkout_fields` definitions
   * before landing in the webhook payload.
   */
  customFieldValues?: Record<string, unknown> | null;
}

/**
 * Fetch product details and build a purchase.completed webhook payload.
 *
 * Fetches product info from the database (main product + bumps) and constructs
 * the standardized PurchaseWebhookData object.
 */
export async function buildPurchaseWebhookPayload(
  params: BuildWebhookPayloadParams
): Promise<PurchaseWebhookData> {
  const {
    supabaseClient, customerEmail, userId, productId, bumpProductIds,
    metadata, amount, currency, sessionId, paymentIntentId,
    couponId, isGuest, source, customFieldValues,
  } = params;

  // Fetch main product details
  const { data: productDetails } = await supabaseClient
    .from('products')
    .select('id, name, slug, price, currency, icon, custom_checkout_fields')
    .eq('id', productId)
    .single();

  // Fetch bump product details (batch)
  let bumpProductDetailsList: ProductDetail[] = [];
  if (bumpProductIds.length > 0) {
    const { data: bumps } = await supabaseClient
      .from('products')
      .select('id, name, slug, price, currency, icon')
      .in('id', bumpProductIds);
    if (bumps) bumpProductDetailsList = bumps as ProductDetail[];
  }

  const webhookData: PurchaseWebhookData = {
    customer: {
      email: customerEmail,
      firstName: metadata?.first_name || null,
      lastName: metadata?.last_name || null,
      userId,
    },
    product: productDetails
      ? {
          id: productDetails.id,
          name: productDetails.name,
          slug: productDetails.slug,
          price: productDetails.price,
          currency: productDetails.currency,
          icon: productDetails.icon,
        }
      : { id: productId },
    // Backward compat: first bump as bumpProduct
    bumpProduct: bumpProductDetailsList.length > 0
      ? {
          id: bumpProductDetailsList[0].id,
          name: bumpProductDetailsList[0].name,
          slug: bumpProductDetailsList[0].slug,
          price: bumpProductDetailsList[0].price,
          currency: bumpProductDetailsList[0].currency,
          icon: bumpProductDetailsList[0].icon,
        }
      : null,
    bumpProducts: bumpProductDetailsList.map(b => ({
      id: b.id, name: b.name, slug: b.slug,
      price: b.price, currency: b.currency, icon: b.icon,
    })),
    order: {
      amount,
      currency,
      ...(sessionId && { sessionId }),
      paymentIntentId,
      couponId,
      isGuest,
    },
    ...(source && { source }),
  };

  // Add invoice data if requested
  if (metadata?.needs_invoice === 'true') {
    webhookData.invoice = {
      needsInvoice: true,
      nip: metadata.nip || null,
      companyName: metadata.company_name || null,
      address: metadata.address || null,
      city: metadata.city || null,
      postalCode: metadata.postal_code || null,
      country: metadata.country || null,
    };
  }

  // Attach resolved custom-checkout-field answers if the seller had any defined
  // AND the buyer submitted at least one non-empty value. Webhooks default to
  // English labels — receivers that need a locale-specific copy can re-resolve
  // from `custom_checkout_fields` on the product (also surfaced via the v1 API).
  const productCustomFields = (productDetails as { custom_checkout_fields?: unknown } | null)
    ?.custom_checkout_fields;
  const definitions: CustomFieldDefinition[] | null = Array.isArray(productCustomFields)
    ? (productCustomFields as CustomFieldDefinition[])
    : null;
  if (definitions && customFieldValues) {
    const resolved = formatCustomFieldsForDisplay(customFieldValues, definitions, 'en');
    if (resolved.length > 0) {
      webhookData.customFields = resolved;
    }
  }

  return webhookData;
}
