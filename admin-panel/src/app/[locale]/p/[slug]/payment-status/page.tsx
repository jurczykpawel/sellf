import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import PaymentStatusView from './components/PaymentStatusView';
import { verifyPaymentSession, verifyPaymentIntent, OtoInfo } from '@/lib/payment/verify-payment';
import { buildOtoRedirectUrl, buildSuccessRedirectUrl, hasHideBumpParam } from '@/lib/payment/oto-redirect';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';
import { PaymentStatus, OtoOfferInfo } from './types';
import { getSellerBySlug, createSellerAdminClient } from '@/lib/marketplace/seller-client';

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{
    session_id?: string;
    payment_intent?: string;
    success_url?: string;
    seller?: string;
  }>;
}

export default async function PaymentStatusPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const { session_id, payment_intent } = resolvedSearchParams;
  const isStripePayment = !!(session_id || payment_intent); // Has session_id or payment_intent = paid product

  const supabase = await createClient();

  // Get authenticated user (optional for guest purchases)
  const { data: { user } } = await supabase.auth.getUser();
  // For free products, user must be logged in
  if (!isStripePayment && !user) {
    redirect('/login');
  }

  // Marketplace: optional seller query param to scope product lookup to seller schema
  const sellerSlug = resolvedSearchParams.seller;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let productClient: any = supabase;

  if (sellerSlug) {
    const seller = await getSellerBySlug(sellerSlug);
    if (seller) {
      productClient = createSellerAdminClient(seller.schema_name);
    }
  }

  // Get product details
  const { data: product, error: productError } = await productClient
    .from('products')
    .select('id, name, slug, description, icon, price, currency, allow_custom_price, custom_price_min, success_redirect_url, pass_params_to_redirect')
    .eq('slug', resolvedParams.slug)
    .single();

  if (productError || !product) {
    redirect('/');
  }

  // Verify payment with Stripe and determine status
  let accessGranted = false;
  let errorMessage = '';
  let paymentStatus: PaymentStatus = 'processing'; // processing, completed, failed, expired, guest_purchase, magic_link_sent
  let customerEmail = '';
  let userExistsInDatabase = false; // Track if user exists in database
  let otoInfo: OtoInfo | undefined = undefined;

  try {
    if (isStripePayment && session_id) {
      // Handle paid product with Stripe Checkout Session (embedded checkout flow)
      const result = await verifyPaymentSession(session_id, user);
      customerEmail = result.customer_email || '';

      // Capture OTO info (both active and skipped)
      if (result.oto_info?.has_oto || result.oto_info?.reason) {
        otoInfo = result.oto_info;
      }

      // Check if user exists in database based on scenario
      userExistsInDatabase = result.scenario === 'existing_user_email';

      if (result.status === 'expired') {
        paymentStatus = 'expired';
        errorMessage = 'Payment session has expired. Please try again.';
      } else if (result.status === 'complete' && result.payment_status === 'paid') {
        if (result.access_granted) {
          accessGranted = true;
          paymentStatus = 'completed';

          if (result.scenario === 'existing_user_email' && result.requires_login && result.send_magic_link) {
            // User exists but needs to login - let frontend handle magic link
            paymentStatus = 'magic_link_sent';
          }
        } else if (result.scenario === 'email_validation_failed_server_side') {
          // Email validation failed without refund
          paymentStatus = 'email_validation_failed';
          errorMessage = result.error || 'Invalid email address detected.';
        } else if (result.is_guest_purchase && result.send_magic_link) {
          // Guest purchase saved - let frontend handle magic link
          paymentStatus = 'magic_link_sent';
        } else {
          errorMessage = result.error || 'Unknown error occurred';
          paymentStatus = 'failed';
        }
      } else if (result.error) {
        errorMessage = result.error;
        paymentStatus = 'failed';
      } else {
        paymentStatus = 'processing';
      }
    } else if (isStripePayment && payment_intent) {
      // Handle Payment Intent flow (custom payment form)
      const result = await verifyPaymentIntent(payment_intent, user);
      customerEmail = result.customer_email || '';

      // Capture OTO info (both active and skipped)
      if (result.oto_info?.has_oto || result.oto_info?.reason) {
        otoInfo = result.oto_info;
      }

      // Check if user exists in database based on scenario
      userExistsInDatabase = result.scenario === 'existing_user_email';

      if (result.status === 'succeeded') {
        if (result.access_granted) {
          accessGranted = true;
          paymentStatus = 'completed';

          if (result.scenario === 'existing_user_email' && result.requires_login && result.send_magic_link) {
            // User exists but needs to login - let frontend handle magic link
            paymentStatus = 'magic_link_sent';
          }
        } else if (result.scenario === 'email_validation_failed_server_side') {
          // Email validation failed without refund
          paymentStatus = 'email_validation_failed';
          errorMessage = result.error || 'Invalid email address detected.';
        } else if (result.is_guest_purchase && result.send_magic_link) {
          // Guest purchase saved - let frontend handle magic link
          paymentStatus = 'magic_link_sent';
        } else {
          errorMessage = result.error || 'Unknown error occurred';
          paymentStatus = 'failed';
        }
      } else if (result.error) {
        errorMessage = result.error;
        paymentStatus = 'failed';
      } else {
        paymentStatus = 'processing';
      }
    } else {
      // Handle free product (no session_id and no payment_intent) - user must be logged in
      if (!user) {
        redirect('/login');
      }

      customerEmail = user.email || '';

      const { data: existingAccess } = await productClient
        .from('user_product_access')
        .select('access_expires_at')
        .eq('user_id', user.id)
        .eq('product_id', product.id)
        .single();

      const adminClient = sellerSlug ? productClient : createAdminClient();
      const freeAccessResult = await grantFreeProductAccess(supabase, adminClient, {
        product: {
          id: product.id,
          slug: resolvedParams.slug,
          price: product.price,
          isPwywFree: !!(product.allow_custom_price && product.custom_price_min === 0),
        },
        user: { id: user.id, email: customerEmail },
      });

      if (freeAccessResult.accessGranted) {
        accessGranted = true;
        paymentStatus = 'completed';
        if (freeAccessResult.otoInfo) {
          otoInfo = freeAccessResult.otoInfo as unknown as OtoInfo;
        }
      } else if (freeAccessResult.error?.includes('not be free or active')) {
        paymentStatus = 'expired';
        errorMessage = 'Your access has expired. Please purchase again.';
      } else {
        paymentStatus = 'failed';
        errorMessage = 'Failed to grant access to free product';
      }
    }
  } catch (err) {
    console.error('[payment-status] Verification error:', err);
    paymentStatus = 'failed';
    errorMessage = 'An error occurred while verifying payment status';
  }

  // Calculate Funnel/OTO Redirect URL and OTO Offer Info
  let finalRedirectUrl: string | undefined = undefined;
  let otoOfferInfo: OtoOfferInfo | undefined = undefined;

  // Check for OTO offer (takes priority over regular success_redirect_url)
  if ((accessGranted || paymentStatus === 'magic_link_sent') && otoInfo?.has_oto && otoInfo.oto_product_slug) {
    // Check if customer already has access to OTO product - skip OTO if they do
    let customerHasOtoAccess = false;

    if (otoInfo.oto_product_id && customerEmail) {
      // First check if user exists with this email
      const { data: existingUser } = await productClient
        .from('users')
        .select('id')
        .eq('email', customerEmail)
        .maybeSingle();

      if (existingUser) {
        // Check if user has access to OTO product (same schema as source product)
        const { data: existingOtoAccess } = await productClient
          .from('user_product_access')
          .select('id, access_expires_at')
          .eq('user_id', existingUser.id)
          .eq('product_id', otoInfo.oto_product_id)
          .maybeSingle();

        if (existingOtoAccess) {
          // Check if access is still valid (not expired)
          const expiresAt = existingOtoAccess.access_expires_at
            ? new Date(existingOtoAccess.access_expires_at)
            : null;
          customerHasOtoAccess = !expiresAt || expiresAt > new Date();
        }
      }
    }

    if (customerHasOtoAccess) {
      // Customer already owns OTO product - skip OTO offer
    } else {
      // Build OTO checkout URL
      const otoRedirect = buildOtoRedirectUrl({
        locale: resolvedParams.locale,
        otoProductSlug: otoInfo.oto_product_slug!,
        customerEmail: customerEmail || undefined,
        couponCode: otoInfo.coupon_code,
        baseUrl: process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL,
        hideBump: hasHideBumpParam(product.success_redirect_url),
        passParams: product.pass_params_to_redirect || false,
        sourceProductId: product.id,
        sessionId: session_id
      });

      // Build OTO offer info for display on payment-status page
      otoOfferInfo = {
        hasOto: true,
        otoProductSlug: otoInfo.oto_product_slug,
        otoProductName: otoInfo.oto_product_name,
        discountType: otoInfo.discount_type,
        discountValue: otoInfo.discount_value,
        expiresAt: otoInfo.expires_at,
        checkoutUrl: otoRedirect.url,
        currency: otoInfo.oto_product_currency
      };

      // Log warning if required params are missing
      if (!otoRedirect.hasAllRequiredParams) {
        console.warn('OTO Redirect missing params:', otoRedirect.missingParams, '- OTO countdown may not work');
      }
    }
  }

  // Redirect logic:
  // 1. OTO active → handled above (otoOfferInfo is set)
  // 2. OTO skipped (user owns product) → NO redirect
  // 3. No OTO → use success_redirect_url

  // Include magic_link_sent as a success scenario (guest purchase)
  const isSuccessfulPayment = (accessGranted && paymentStatus === 'completed') || paymentStatus === 'magic_link_sent';

  if (isSuccessfulPayment && !otoOfferInfo) {
    // Check if OTO was configured but skipped (user already owns the product)
    const otoWasSkipped = otoInfo?.reason === 'already_owns_oto_product';

    if (otoWasSkipped) {
      // OTO was skipped (user owns product) - no redirect
    } else {
      // No OTO configured - use regular success_redirect_url
      // SECURITY FIX (V11): Validate success_url to prevent open redirect
      // Only allow relative paths from URL params, external URLs must come from admin config
      let overrideRedirectUrl = resolvedSearchParams.success_url;
      if (overrideRedirectUrl) {
        // Reject external URLs, protocol-relative URLs, javascript: etc.
        const decoded = decodeURIComponent(overrideRedirectUrl).trim();
        if (!decoded.startsWith('/') || decoded.startsWith('//') ||
            decoded.toLowerCase().includes('javascript:') ||
            decoded.includes('://')) {
          console.warn('Rejected unsafe success_url:', overrideRedirectUrl);
          overrideRedirectUrl = undefined; // Fall back to admin-configured URL
        }
      }
      const targetUrl = overrideRedirectUrl || product.success_redirect_url;

      if (targetUrl) {
        const redirectResult = buildSuccessRedirectUrl({
          targetUrl,
          baseUrl: process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL,
          passParams: product.pass_params_to_redirect || false,
          customerEmail: customerEmail || undefined,
          productId: product.id,
          sessionId: session_id,
          additionalParams: resolvedSearchParams as Record<string, string | undefined>
        });

        finalRedirectUrl = redirectResult.url;
      }
    }
  }

  return (
    <PaymentStatusView
      product={product}
      accessGranted={accessGranted}
      paymentStatus={paymentStatus}
      errorMessage={errorMessage}
      customerEmail={customerEmail}
      sessionId={session_id}
      paymentIntentId={payment_intent}
      redirectUrl={finalRedirectUrl}
      otoOffer={otoOfferInfo}
    />
  );
}
