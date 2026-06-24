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
import type { OrderTaxSnapshot } from '@/lib/services/tax-snapshot';

type AnySupabaseClient = SupabaseClient<any, any, any>;

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  icon: string | null;
  // VAT snapshot for this line (present when tax was captured). Amounts in MINOR units.
  net?: number | null;
  tax?: number | null;
  gross?: number | null;
  vatRate?: number | null;
  vatExempt?: boolean;
  taxBehavior?: 'inclusive' | 'exclusive' | null;
  taxabilityReason?: string | null;
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
    // Order-level tax totals (MINOR units), present when tax was captured.
    netTotal?: number | null;
    taxTotal?: number | null;
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
  /** Per-line tax snapshot captured from Stripe (added per product/bump + order totals). */
  taxSnapshot?: OrderTaxSnapshot;
  /**
   * Stripe Checkout `customer_details`. In the EMBED flow the buyer's NIP + billing address
   * are collected by Stripe (tax_id_collection / billing_address_collection), not by Sellf's
   * own InvoiceFields — so they live here, not in `metadata`. Used as the invoice source
   * when `metadata.needs_invoice` is absent, so embed B2B purchases carry faktura data too.
   */
  stripeCustomerDetails?: {
    name?: string | null;
    tax_ids?: Array<{ value?: string | null }> | null;
    address?: { line1?: string | null; city?: string | null; postal_code?: string | null; country?: string | null } | null;
  } | null;
}

/**
 * Apply a captured tax line to a product/bump detail (matched by productId).
 * Returns the detail unchanged when no snapshot line matches.
 */
function applyLineTax(
  detail: ProductDetail,
  taxSnapshot: OrderTaxSnapshot | undefined,
  vatExemptById: Map<string, boolean>,
): ProductDetail {
  const line = taxSnapshot?.lines.find((l) => l.productId === detail.id);
  if (!line) return detail;
  return {
    ...detail,
    net: line.netAmount,
    tax: line.taxAmount,
    gross: line.grossAmount,
    vatRate: line.vatRate,
    // Product vat_exempt is the label only in local mode. Under Stripe Tax, Stripe decides
    // taxability (taxabilityReason) — never claim exemption from the seller's PL flag.
    vatExempt: taxSnapshot?.stripeTaxApplied ? false : (vatExemptById.get(detail.id) ?? false),
    taxBehavior: line.taxBehavior,
    taxabilityReason: line.taxabilityReason,
  };
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
    couponId, isGuest, source, customFieldValues, taxSnapshot, stripeCustomerDetails,
  } = params;

  // Fetch main product details (incl. vat_exempt for the tax-snapshot label)
  const { data: productDetails } = await supabaseClient
    .from('products')
    .select('id, name, slug, price, currency, icon, custom_checkout_fields, vat_exempt')
    .eq('id', productId)
    .single();

  // vat_exempt per product (label authority in local tax mode) — keyed by id.
  const vatExemptById = new Map<string, boolean>();
  if (productDetails) vatExemptById.set(productDetails.id, productDetails.vat_exempt ?? false);

  // Fetch bump product details (batch)
  let bumpProductDetailsList: ProductDetail[] = [];
  if (bumpProductIds.length > 0) {
    const { data: bumps } = await supabaseClient
      .from('products')
      .select('id, name, slug, price, currency, icon, vat_exempt')
      .in('id', bumpProductIds);
    if (bumps) {
      bumpProductDetailsList = bumps.map((b) => ({
        id: b.id, name: b.name, slug: b.slug, price: b.price, currency: b.currency, icon: b.icon,
      }));
      for (const b of bumps) vatExemptById.set(b.id, b.vat_exempt ?? false);
    }
  }

  const webhookData: PurchaseWebhookData = {
    customer: {
      email: customerEmail,
      firstName: metadata?.first_name || null,
      lastName: metadata?.last_name || null,
      userId,
    },
    product: productDetails
      ? applyLineTax(
          {
            id: productDetails.id,
            name: productDetails.name,
            slug: productDetails.slug,
            price: productDetails.price,
            currency: productDetails.currency,
            icon: productDetails.icon,
          },
          taxSnapshot,
          vatExemptById,
        )
      : { id: productId },
    // Backward compat: first bump as bumpProduct
    bumpProduct: bumpProductDetailsList.length > 0
      ? applyLineTax(bumpProductDetailsList[0], taxSnapshot, vatExemptById)
      : null,
    bumpProducts: bumpProductDetailsList.map((b) => applyLineTax(b, taxSnapshot, vatExemptById)),
    order: {
      amount,
      currency,
      ...(sessionId && { sessionId }),
      paymentIntentId,
      couponId,
      isGuest,
      ...(taxSnapshot && { netTotal: taxSnapshot.netTotal, taxTotal: taxSnapshot.taxTotal }),
    },
    ...(source && { source }),
  };

  // Add invoice data if requested. On-site (Sellf's InvoiceFields) writes it to metadata;
  // embed collects NIP + address via Stripe → read from customer_details as the fallback,
  // treating a provided tax id as a faktura request (B2B). Without this, embed purchases
  // would emit no invoice data and integrations would issue incomplete fakturas.
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
  } else {
    const taxId = stripeCustomerDetails?.tax_ids?.find((t) => t.value)?.value ?? null;
    if (taxId) {
      const a = stripeCustomerDetails?.address;
      webhookData.invoice = {
        needsInvoice: true,
        nip: taxId,
        companyName: stripeCustomerDetails?.name || null,
        address: a?.line1 || null,
        city: a?.city || null,
        postalCode: a?.postal_code || null,
        country: a?.country || null,
      };
    }
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
