'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getStripeServer } from '@/lib/stripe/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { ProductValidationService } from '@/lib/services/product-validation';
import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { getOrCreateStripeCustomer } from '@/lib/stripe/customer';
import { buildSubscriptionSessionConfig } from '@/lib/stripe/subscription-checkout';
import { getOrCreateStripeTaxRate } from '@/lib/stripe/tax-rate-manager';
import { getOrCreateStripePriceForProduct } from '@/lib/stripe/product-price';

interface CreateEmbeddedCheckoutOptions {
  productId: string;
  email?: string;
}

export async function fetchClientSecret(options: CreateEmbeddedCheckoutOptions): Promise<{ clientSecret?: string; error?: string }> {
  const origin = (await headers()).get('origin');
  const supabase = await createClient();
  
  try {
    const { productId, email } = options;

    // Input validation
    if (!productId) {
      return { error: 'Product ID is required' };
    }

    // Email validation if provided - enhanced with disposable domain checking
    if (email) {
      const emailValidation = await ProductValidationService.validateEmail(email);
      if (!emailValidation) {
        return { error: 'Invalid or disposable email address not allowed' };
      }
    }

    // Get authenticated user (optional)
    const { data: { user } } = await supabase.auth.getUser();

    // Rate limiting check with proper IP-based limiting for anonymous users
    const rateLimitConfig = user 
      ? RATE_LIMITS.CHECKOUT_CREATION 
      : RATE_LIMITS.CHECKOUT_CREATION_ANONYMOUS;
    
    const isAllowed = await checkRateLimit(
      rateLimitConfig.actionType,
      rateLimitConfig.maxRequests,
      rateLimitConfig.windowMinutes,
      user?.id
    );

    if (!isAllowed) {
      return { error: 'Too many checkout attempts. Please try again later.' };
    }

    // Validate product and check user access
    const validationService = new ProductValidationService(supabase);
    const { product } = await validationService.validateForCheckout(productId, user);

    const stripe = await getStripeServer();

    // Resolve checkout config: DB > env var > default
    const checkoutConfig = await getCheckoutConfig();
    const returnUrl = `${origin}/p/${product.slug}/payment-status?session_id={CHECKOUT_SESSION_ID}`;
    const customerEmail = email || user?.email;

    let sessionConfig: Record<string, unknown>;

    if (product.product_type === 'subscription') {
      if (!customerEmail) {
        return { error: 'Email is required for subscription checkout' };
      }

      const customerId = await getOrCreateStripeCustomer({
        email: customerEmail,
        userId: user?.id,
      });

      let taxRateId: string | undefined;
      if (checkoutConfig.tax_mode === 'local' && product.vat_rate && product.vat_rate > 0) {
        taxRateId = await getOrCreateStripeTaxRate({
          percentage: product.vat_rate,
          inclusive: product.price_includes_vat,
        });
      }

      // ensure durable Stripe Price binding before checkout.
      const stripePriceId = await getOrCreateStripePriceForProduct(stripe, product);

      sessionConfig = buildSubscriptionSessionConfig({
        product,
        customerId,
        stripePriceId,
        returnUrl,
        email: customerEmail,
        userId: user?.id,
        checkoutConfig,
        taxRateId,
      });
    } else {
      sessionConfig = {
        ui_mode: 'embedded_page' as const,
        customer_email: customerEmail || undefined,
        line_items: [
          {
            price_data: {
              currency: product.currency.toLowerCase(),
              product_data: {
                name: product.name,
                description: product.description || undefined,
              },
              unit_amount: Math.round(product.price * 100),
            },
            quantity: 1,
          },
        ],
        mode: 'payment' as const,
        return_url: returnUrl,
        metadata: {
          product_id: product.id,
          product_slug: product.slug,
          user_id: user?.id || '',
        },
        expires_at: Math.floor(Date.now() / 1000) + (checkoutConfig.expires_hours * 60 * 60),
        automatic_tax: checkoutConfig.automatic_tax,
        tax_id_collection: checkoutConfig.tax_id_collection,
        billing_address_collection: checkoutConfig.billing_address_collection,
      };

      if (checkoutConfig.paymentMethodMode === 'automatic') {
        sessionConfig.automatic_payment_methods = { enabled: true };
      } else if (
        checkoutConfig.paymentMethodMode === 'stripe_preset' &&
        checkoutConfig.stripePresetId
      ) {
        sessionConfig.payment_method_configuration = checkoutConfig.stripePresetId;
      } else {
        sessionConfig.payment_method_types = checkoutConfig.payment_method_types as any;
      }
    }

    // Create embedded checkout session
    const session = await stripe.checkout.sessions.create(sessionConfig);

    if (!session.client_secret) {
      return { error: 'Failed to create checkout session' };
    }

    return { clientSecret: session.client_secret };
    
  } catch (error) {
    console.error('[fetchClientSecret] Error:', error);
    return { error: 'Failed to create checkout session' };
  }
}

export async function signOutAndRedirectToCheckout() {
  const supabase = await createClient();
  
  // Sign out the user
  await supabase.auth.signOut();
  
  // Note: We can't redirect from server action, so we'll return success
  // and let the client handle the redirect
  return { success: true };
}
