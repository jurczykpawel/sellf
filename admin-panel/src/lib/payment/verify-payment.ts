/**
 * Payment verification utilities
 *
 * SECURITY WARNING: This file contains server-side only code.
 * Contains Service Role keys and must never be executed in the browser.
 * Only use in Server Components and API Routes.
 */

import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getStripeServer } from '@/lib/stripe/server';
import type { User } from '@supabase/supabase-js';
import { WebhookService } from '@/lib/services/webhook-service';

/**
 * Helper function to update user profile with customer data from payment
 *
 * ALWAYS updates (for logged-in users):
 * - Customer name: first_name, last_name, full_name
 *
 * ONLY if invoice requested (needs_invoice='true'):
 * - Company data: tax_id, company_name, address, city, zip_code, country
 *
 * Note: For guest purchases, data is migrated on registration via
 * migrate_guest_payment_data_to_profile() database function.
 */
async function updateProfileWithCompanyData(
  serviceClient: any,
  userId: string,
  metadata: Record<string, any>
): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    // ALWAYS save customer name (from ANY payment, even without invoice)
    if (metadata.first_name) updateData.first_name = metadata.first_name;
    if (metadata.last_name) updateData.last_name = metadata.last_name;
    if (metadata.full_name) updateData.full_name = metadata.full_name;

    // Save company data ONLY if invoice was requested
    if (metadata.needs_invoice === 'true') {
      if (metadata.nip) updateData.tax_id = metadata.nip;
      if (metadata.company_name) updateData.company_name = metadata.company_name;
      if (metadata.address) updateData.address_line1 = metadata.address;
      if (metadata.city) updateData.city = metadata.city;
      if (metadata.postal_code) updateData.zip_code = metadata.postal_code;
      if (metadata.country) updateData.country = metadata.country;
    }

    // Only update if we have data to save
    if (Object.keys(updateData).length > 1) { // > 1 because updated_at is always present
      const { error } = await serviceClient
        .from('profiles')
        .upsert({
          id: userId,
          ...updateData
        });

      if (error) {
        console.error('Failed to update profile with customer data:', error);
      } else {
        console.log('Successfully updated profile with customer data for user:', userId);
      }
    }
  } catch (error) {
    console.error('Error updating profile with customer data:', error);
  }
}

export interface OtoInfo {
  has_oto: boolean;
  coupon_code?: string;
  coupon_id?: string;
  oto_product_id?: string;
  oto_product_slug?: string;
  oto_product_name?: string;
  oto_product_price?: number;
  oto_product_currency?: string;
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
  expires_at?: string;
  duration_minutes?: number;
  // Fields for skipped OTO (e.g., user already owns the product)
  reason?: string;
  skipped_oto_product_id?: string;
  skipped_oto_product_slug?: string;
}

export interface PaymentIntentVerificationResult {
  payment_intent_id: string;
  status: string;
  customer_email?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  created?: number;
  access_granted?: boolean;
  requires_login?: boolean;
  is_guest_purchase?: boolean;
  scenario?: string;
  send_magic_link?: boolean;
  oto_info?: OtoInfo;
  error?: string;
}

export interface PaymentVerificationResult {
  session_id: string;
  status: string;
  payment_status: string | null;
  customer_email?: string;
  amount_total?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  created?: number;
  expires_at?: number;
  access_granted?: boolean;
  already_had_access?: boolean;
  requires_login?: boolean;
  is_guest_purchase?: boolean;
  scenario?: string;
  access_expires_at?: string | null;
  send_magic_link?: boolean;
  oto_info?: OtoInfo;
  error?: string;
}

/**
 * Check if payment was already processed and return cached result from database.
 * This avoids unnecessary Stripe API calls for already-processed payments.
 * Returns null if payment not found in database (needs Stripe verification).
 */
async function getProcessedPaymentFromDatabase(
  sessionId: string,
  serviceClient: any,
  user?: User | null
): Promise<PaymentVerificationResult | null> {
  // Look up existing completed transaction
  const { data: transaction, error } = await serviceClient
    .from('payment_transactions')
    .select(`
      id,
      session_id,
      product_id,
      customer_email,
      user_id,
      amount,
      currency,
      status,
      created_at,
      products:product_id (
        id,
        slug,
        name,
        success_redirect_url
      )
    `)
    .eq('session_id', sessionId)
    .eq('status', 'completed')
    .maybeSingle();

  if (error || !transaction) {
    return null; // Not in database, need to verify with Stripe
  }

  // Verify user ownership if user is logged in
  if (user && transaction.user_id && transaction.user_id !== user.id) {
    return {
      session_id: sessionId,
      status: 'complete',
      payment_status: 'paid',
      error: 'Session does not belong to current user'
    };
  }

  // Check if user has access to the product
  const { data: accessRecord } = await serviceClient
    .from('user_product_access')
    .select('id, access_expires_at')
    .eq('product_id', transaction.product_id)
    .eq('user_id', transaction.user_id || user?.id)
    .maybeSingle();

  const hasAccess = !!accessRecord;
  const isGuestPurchase = !transaction.user_id;

  // Generate OTO info if applicable
  let otoInfo: OtoInfo = { has_oto: false };
  try {
    const { data: otoResult } = await serviceClient
      .rpc('generate_oto_coupon', {
        source_product_id_param: transaction.product_id,
        customer_email_param: transaction.customer_email,
        transaction_id_param: transaction.id
      });

    if (otoResult?.has_oto || otoResult?.reason) {
      otoInfo = otoResult as OtoInfo;
    }
  } catch (otoErr) {
    console.error('OTO generation exception (cached):', otoErr);
  }

  return {
    session_id: sessionId,
    status: 'complete',
    payment_status: 'paid',
    customer_email: transaction.customer_email,
    amount_total: Math.round(transaction.amount * 100), // Convert to cents for consistency
    currency: transaction.currency,
    metadata: {
      product_id: transaction.product_id
    },
    created: Math.floor(new Date(transaction.created_at).getTime() / 1000),
    access_granted: hasAccess,
    already_had_access: false, // Can't determine from cache
    requires_login: isGuestPurchase && !user,
    is_guest_purchase: isGuestPurchase,
    scenario: isGuestPurchase ? 'guest_purchase_cached' : 'logged_in_purchase_cached',
    access_expires_at: accessRecord?.access_expires_at || null,
    send_magic_link: isGuestPurchase,
    oto_info: otoInfo
  };
}

export async function verifyPaymentSession(
  sessionId: string,
  user?: User | null
): Promise<PaymentVerificationResult> {
  // SECURITY: This function must only run on the server
  if (typeof window !== 'undefined') {
    throw new Error('verifyPaymentSession can only be called on the server');
  }

  // Validate input
  if (!sessionId || typeof sessionId !== 'string') {
    return {
      session_id: sessionId || 'invalid',
      status: 'error',
      payment_status: null,
      error: 'Invalid session ID'
    };
  }

  // Check environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      session_id: sessionId,
      status: 'error',
      payment_status: null,
      error: 'Server configuration error'
    };
  }

  // Create Service Role client for secure operations
  const serviceClient = createServiceClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  try {
    // First, check if payment was already processed (database cache)
    // This avoids unnecessary Stripe API calls and enables E2E testing
    const cachedResult = await getProcessedPaymentFromDatabase(sessionId, serviceClient, user);
    if (cachedResult) {
      return cachedResult;
    }

    // Payment not in database - verify with Stripe
    const stripe = await getStripeServer();

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'payment_intent']
    });

    if (!session) {
      return {
        session_id: sessionId,
        status: 'not_found',
        payment_status: null,
        error: 'Session not found'
      };
    }

    // Check if session belongs to current user (only if user is logged in and session has valid user_id)
    if (user && session.metadata?.user_id && 
        session.metadata.user_id !== '' && 
        session.metadata.user_id !== 'null' && 
        session.metadata.user_id !== user.id) {
      return {
        session_id: session.id,
        status: session.status || 'unknown',
        payment_status: session.payment_status,
        error: 'Session does not belong to current user'
      };
    }

    // Base response
    const baseResponse: PaymentVerificationResult = {
      session_id: session.id,
      status: session.status || 'unknown',
      payment_status: session.payment_status,
      customer_email: session.customer_details?.email || undefined,
      amount_total: session.amount_total || undefined,
      currency: session.currency || undefined,
      metadata: session.metadata || undefined,
      created: session.created,
      expires_at: session.expires_at,
    };

    // If payment is complete, delegate to database function
    if (session.status === 'complete' && session.payment_status === 'paid') {
      const productId = session.metadata?.product_id;
      const customerEmail = session.customer_details?.email || session.customer_email;
      
      if (productId && customerEmail) {
        try {
          // Validate email for disposable domains
          const { ProductValidationService } = await import('@/lib/services/product-validation');
          const isValidEmail = await ProductValidationService.validateEmail(customerEmail);
          if (!isValidEmail) {
            return {
              ...baseResponse,
              access_granted: false,
              error: 'Invalid email address detected. Temporary email addresses are not allowed for purchases. Please contact support for assistance.',
              scenario: 'email_validation_failed_server_side'
            };
          }
          
          // Extract payment intent ID
          const stripePaymentIntentId = typeof session.payment_intent === 'object'
            ? session.payment_intent?.id
            : session.payment_intent;

          // Extract bump product ID from metadata if present
          const bumpProductId = session.metadata?.bump_product_id || null;
          const hasBump = session.metadata?.has_bump === 'true';
          
          // Extract coupon ID from metadata if present
          const couponId = session.metadata?.coupon_id || null;
          const hasCoupon = session.metadata?.has_coupon === 'true';

          // Use new function that supports order bumps
          const rpcParams = {
            session_id_param: session.id,
            product_id_param: productId,
            customer_email_param: customerEmail,
            amount_total: session.amount_total || 0,
            currency_param: session.currency || 'usd',
            stripe_payment_intent_id: stripePaymentIntentId || null,
            user_id_param: user?.id || null,
            bump_product_id_param: hasBump && bumpProductId ? bumpProductId : null,
            coupon_id_param: hasCoupon && couponId ? couponId : null
          };
          
          console.log('Calling process_stripe_payment_completion_with_bump with:', JSON.stringify(rpcParams, null, 2));

          const { data: paymentResult, error: paymentError } = await serviceClient
            .rpc('process_stripe_payment_completion_with_bump', rpcParams);

          if (paymentResult) {
             console.log('Raw DB paymentResult:', JSON.stringify(paymentResult, null, 2));
          }

          if (paymentError) {
            console.error('Database payment processing error:', paymentError);
            return {
              ...baseResponse,
              access_granted: false,
              error: 'Failed to process payment'
            };
          }

          if (!paymentResult?.success) {
            return {
              ...baseResponse,
              access_granted: false,
              error: paymentResult?.error || 'Payment processing failed'
            };
          }

          // Trigger webhook for new successful purchases
          if (!paymentResult.already_had_access) {
            // Fetch detailed product info for webhook
            const { data: productDetails } = await serviceClient
              .from('products')
              .select('id, name, slug, price, currency, icon')
              .eq('id', productId)
              .single();

            // Fetch bump product info if exists
            let bumpProductDetails = null;
            if (hasBump && bumpProductId) {
               const { data: bump } = await serviceClient
                .from('products')
                .select('id, name, slug, price, currency, icon')
                .eq('id', bumpProductId)
                .single();
               bumpProductDetails = bump;
            }

            const webhookData: any = {
              customer: {
                email: customerEmail,
                firstName: session.metadata?.first_name || null,
                lastName: session.metadata?.last_name || null,
                userId: user?.id || null
              },
              product: productDetails ? {
                 id: productDetails.id,
                 name: productDetails.name,
                 slug: productDetails.slug,
                 price: productDetails.price,
                 currency: productDetails.currency,
                 icon: productDetails.icon
              } : { id: productId },
              bumpProduct: bumpProductDetails ? {
                 id: bumpProductDetails.id,
                 name: bumpProductDetails.name,
                 slug: bumpProductDetails.slug,
                 price: bumpProductDetails.price,
                 currency: bumpProductDetails.currency,
                 icon: bumpProductDetails.icon
              } : null,
              order: {
                amount: session.amount_total,
                currency: session.currency,
                sessionId: session.id,
                paymentIntentId: stripePaymentIntentId,
                couponId: hasCoupon && couponId ? couponId : null,
                isGuest: paymentResult.is_guest_purchase
              }
            };

            // Add invoice data if requested
            if (session.metadata?.needs_invoice === 'true') {
              webhookData.invoice = {
                needsInvoice: true,
                nip: session.metadata.nip || null,
                companyName: session.metadata.company_name || null,
                address: session.metadata.address || null,
                city: session.metadata.city || null,
                postalCode: session.metadata.postal_code || null,
                country: session.metadata.country || null,
              };
            }

            WebhookService.trigger('purchase.completed', webhookData)
              .catch(err => console.error('Webhook trigger error:', err));

            // NOTE: Server-side CAPI tracking for Purchase is handled in the
            // Stripe webhook handler (webhooks/stripe/route.ts), NOT here.
            // Both webhook and client-side use deterministic event_id based on
            // Stripe session ID (generatePurchaseEventId) for Facebook dedup.
          }

          // Generate OTO coupon if configured for this product
          let otoInfo: OtoInfo = { has_oto: false };
          if (paymentResult.access_granted || paymentResult.is_guest_purchase) {
            try {
              // Get transaction ID from payment_transactions table
              const { data: transaction } = await serviceClient
                .from('payment_transactions')
                .select('id')
                .eq('session_id', session.id)
                .single();

              if (transaction?.id) {
                const { data: otoResult, error: otoError } = await serviceClient
                  .rpc('generate_oto_coupon', {
                    source_product_id_param: productId,
                    customer_email_param: customerEmail,
                    transaction_id_param: transaction.id
                  });

                if (otoError) {
                  console.error('OTO generation error:', otoError);
                } else if (otoResult?.has_oto) {
                  otoInfo = otoResult as OtoInfo;
                  console.log('Generated OTO coupon:', otoInfo.coupon_code);
                } else if (otoResult?.reason) {
                  // Pass through skipped OTO info (e.g., user already owns the product)
                  otoInfo = otoResult as OtoInfo;
                  console.log('OTO skipped:', otoResult.reason, 'slug:', otoResult.skipped_oto_product_slug);
                }
              }
            } catch (otoErr) {
              console.error('OTO generation exception:', otoErr);
            }
          }

          // Convert database response to our interface
          return {
            ...baseResponse,
            access_granted: paymentResult.access_granted || false,
            already_had_access: paymentResult.already_had_access || false,
            requires_login: paymentResult.requires_login || false,
            is_guest_purchase: paymentResult.is_guest_purchase || false,
            scenario: paymentResult.scenario,
            access_expires_at: paymentResult.access_expires_at,
            send_magic_link: paymentResult.send_magic_link || false,
            // Use customer email from DB result, fallback to Stripe session, fallback to what we passed in
            customer_email: paymentResult.customer_email || baseResponse.customer_email || customerEmail,
            oto_info: otoInfo
          };

        } catch (error) {
          console.error('Payment processing error:', error);
          return {
            ...baseResponse,
            access_granted: false,
            error: 'Failed to process payment completion'
          };
        }
      }

      // Missing required data
      return {
        ...baseResponse,
        access_granted: false,
        error: !productId ? 'Product ID missing from session metadata' : 'Customer email missing from session'
      };
    }

    return baseResponse;

  } catch (error) {
    // Handle Stripe errors
    if (error && typeof error === 'object' && 'type' in error) {
      const stripeError = error as { type: string; message: string };
      if (stripeError.type === 'StripeInvalidRequestError') {
        return {
          session_id: sessionId,
          status: 'invalid',
          payment_status: null,
          error: 'Invalid session ID'
        };
      }
    }

    console.error('Payment verification error:', error);
    return {
      session_id: sessionId,
      status: 'error',
      payment_status: null,
      error: 'Payment verification failed'
    };
  }
}

/**
 * Verify Payment Intent and process payment
 * Used for custom payment form flow (not embedded checkout)
 */
export async function verifyPaymentIntent(
  paymentIntentId: string,
  user?: User | null
): Promise<PaymentIntentVerificationResult> {
  // SECURITY: This function must only run on the server
  if (typeof window !== 'undefined') {
    throw new Error('verifyPaymentIntent can only be called on the server');
  }

  // Validate input
  if (!paymentIntentId || typeof paymentIntentId !== 'string') {
    return {
      payment_intent_id: paymentIntentId || 'invalid',
      status: 'error',
      error: 'Invalid payment intent ID'
    };
  }

  // Check environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      payment_intent_id: paymentIntentId,
      status: 'error',
      error: 'Server configuration error'
    };
  }

  // Create Service Role client for secure operations
  const serviceClient = createServiceClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  try {
    // Get Stripe instance
    const stripe = await getStripeServer();

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (!paymentIntent) {
      return {
        payment_intent_id: paymentIntentId,
        status: 'not_found',
        error: 'Payment intent not found'
      };
    }

    // Base response
    const baseResponse: PaymentIntentVerificationResult = {
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      customer_email: paymentIntent.receipt_email || undefined,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      metadata: paymentIntent.metadata || undefined,
      created: paymentIntent.created,
    };

    // If payment is successful, process it
    if (paymentIntent.status === 'succeeded') {
      const productId = paymentIntent.metadata?.product_id;
      const customerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.email;

      if (productId && customerEmail) {
        try {
          // Validate email for disposable domains
          const { ProductValidationService } = await import('@/lib/services/product-validation');
          const isValidEmail = await ProductValidationService.validateEmail(customerEmail);
          if (!isValidEmail) {
            return {
              ...baseResponse,
              access_granted: false,
              error: 'Invalid email address detected. Temporary email addresses are not allowed for purchases. Please contact support for assistance.',
              scenario: 'email_validation_failed_server_side'
            };
          }

          // Extract metadata
          const bumpProductId = paymentIntent.metadata?.bump_product_id || null;
          const couponId = paymentIntent.metadata?.coupon_id || null;

          // Process payment using database function
          // For Payment Intent flow, use payment_intent_id as session_id for uniqueness tracking
          const rpcParams = {
            session_id_param: paymentIntent.id, // Use payment_intent_id as session_id for Payment Intent flow
            product_id_param: productId,
            customer_email_param: customerEmail,
            amount_total: paymentIntent.amount,
            currency_param: paymentIntent.currency,
            stripe_payment_intent_id: paymentIntent.id,
            user_id_param: user?.id || null,
            bump_product_id_param: bumpProductId || null,
            coupon_id_param: couponId || null
          };

          console.log('Calling process_stripe_payment_completion_with_bump for PaymentIntent:', JSON.stringify(rpcParams, null, 2));

          const { data: paymentResult, error: paymentError } = await serviceClient
            .rpc('process_stripe_payment_completion_with_bump', rpcParams);

          if (paymentResult) {
            console.log('Raw DB paymentResult for PaymentIntent:', JSON.stringify(paymentResult, null, 2));
          }

          if (paymentError) {
            console.error('Database payment processing error:', paymentError);
            return {
              ...baseResponse,
              access_granted: false,
              error: 'Failed to process payment'
            };
          }

          if (!paymentResult?.success) {
            return {
              ...baseResponse,
              access_granted: false,
              error: paymentResult?.error || 'Payment processing failed'
            };
          }

          // Trigger webhook for new successful purchases
          if (!paymentResult.already_had_access) {
            // Fetch detailed product info for webhook
            const { data: productDetails } = await serviceClient
              .from('products')
              .select('id, name, slug, price, currency, icon')
              .eq('id', productId)
              .single();

            // Fetch bump product info if exists
            let bumpProductDetails = null;
            if (bumpProductId) {
               const { data: bump } = await serviceClient
                .from('products')
                .select('id, name, slug, price, currency, icon')
                .eq('id', bumpProductId)
                .single();
               bumpProductDetails = bump;
            }

            const webhookData: any = {
              customer: {
                email: customerEmail,
                firstName: paymentIntent.metadata?.first_name || null,
                lastName: paymentIntent.metadata?.last_name || null,
                userId: user?.id || null
              },
              product: productDetails ? {
                 id: productDetails.id,
                 name: productDetails.name,
                 slug: productDetails.slug,
                 price: productDetails.price,
                 currency: productDetails.currency,
                 icon: productDetails.icon
              } : { id: productId },
              bumpProduct: bumpProductDetails ? {
                 id: bumpProductDetails.id,
                 name: bumpProductDetails.name,
                 slug: bumpProductDetails.slug,
                 price: bumpProductDetails.price,
                 currency: bumpProductDetails.currency,
                 icon: bumpProductDetails.icon
              } : null,
              order: {
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                paymentIntentId: paymentIntent.id,
                couponId: couponId || null,
                isGuest: paymentResult.is_guest_purchase
              }
            };

            // Add invoice data if requested
            if (paymentIntent.metadata?.needs_invoice === 'true') {
              webhookData.invoice = {
                needsInvoice: true,
                nip: paymentIntent.metadata.nip || null,
                companyName: paymentIntent.metadata.company_name || null,
                address: paymentIntent.metadata.address || null,
                city: paymentIntent.metadata.city || null,
                postalCode: paymentIntent.metadata.postal_code || null,
                country: paymentIntent.metadata.country || null,
              };
            }

            WebhookService.trigger('purchase.completed', webhookData)
              .catch(err => console.error('Webhook trigger error:', err));

            // NOTE: Server-side CAPI tracking for Purchase is handled in the
            // Stripe webhook handler (webhooks/stripe/route.ts).
          }

          // Update user profile with company data if invoice was requested
          if (user?.id && paymentIntent.metadata) {
            await updateProfileWithCompanyData(
              serviceClient,
              user.id,
              paymentIntent.metadata
            );
          }

          // Generate OTO coupon if configured for this product
          let otoInfo: OtoInfo = { has_oto: false };
          if (paymentResult.access_granted || paymentResult.is_guest_purchase) {
            try {
              // Get transaction ID from payment_transactions table
              const { data: transaction } = await serviceClient
                .from('payment_transactions')
                .select('id')
                .eq('session_id', paymentIntent.id)
                .single();

              if (transaction?.id) {
                const { data: otoResult, error: otoError } = await serviceClient
                  .rpc('generate_oto_coupon', {
                    source_product_id_param: productId,
                    customer_email_param: customerEmail,
                    transaction_id_param: transaction.id
                  });

                if (otoError) {
                  console.error('OTO generation error:', otoError);
                } else if (otoResult?.has_oto) {
                  otoInfo = otoResult as OtoInfo;
                  console.log('Generated OTO coupon:', otoInfo.coupon_code);
                } else if (otoResult?.reason) {
                  // Pass through skipped OTO info (e.g., user already owns the product)
                  otoInfo = otoResult as OtoInfo;
                  console.log('OTO skipped:', otoResult.reason, 'slug:', otoResult.skipped_oto_product_slug);
                }
              }
            } catch (otoErr) {
              console.error('OTO generation exception:', otoErr);
            }
          }

          // Convert database response to our interface
          return {
            ...baseResponse,
            access_granted: paymentResult.access_granted || false,
            requires_login: paymentResult.requires_login || false,
            is_guest_purchase: paymentResult.is_guest_purchase || false,
            scenario: paymentResult.scenario,
            send_magic_link: paymentResult.send_magic_link || false,
            // Use customer email from DB result, fallback to Stripe, fallback to what we passed in
            customer_email: paymentResult.customer_email || baseResponse.customer_email || customerEmail,
            oto_info: otoInfo
          };

        } catch (error) {
          console.error('Payment processing error:', error);
          return {
            ...baseResponse,
            access_granted: false,
            error: 'Failed to process payment completion'
          };
        }
      }

      // Missing required data
      return {
        ...baseResponse,
        access_granted: false,
        error: !productId ? 'Product ID missing from payment intent metadata' : 'Customer email missing from payment intent'
      };
    }

    return baseResponse;

  } catch (error) {
    // Handle Stripe errors
    if (error && typeof error === 'object' && 'type' in error) {
      const stripeError = error as { type: string; message: string };
      if (stripeError.type === 'StripeInvalidRequestError') {
        return {
          payment_intent_id: paymentIntentId,
          status: 'invalid',
          error: 'Invalid payment intent ID'
        };
      }
    }

    console.error('Payment intent verification error:', error);
    return {
      payment_intent_id: paymentIntentId,
      status: 'error',
      error: 'Payment intent verification failed'
    };
  }
}
