import { NextRequest, NextResponse } from 'next/server';
import { normalizeCouponCode } from '@/lib/coupons/normalize-code';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { trackServerSideConversion } from '@/lib/tracking';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';
import { attributionRequestContext, recordFreeAttribution } from '@/lib/attribution/store';
import {
  validateCustomFieldDefinitions,
  validateCustomFieldValues,
} from '@/lib/validations/custom-checkout-fields';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const rateLimitOk = await checkRateLimit('grant_access', 5, 60, user.id);

    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Optional coupon + custom-field payload. Body is best-effort: grant-access is
    // also called with no body (guest magic-link callback, plain free products),
    // so parse leniently. `customFieldValues` is only present when the logged-in
    // checkout form collected product-defined fields (e.g. the license domain).
    let couponCode: string | null = null;
    let customFieldValues: Record<string, string> | undefined;
    let attribution: unknown;
    try {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await readJsonBody(request).catch((err) => {
          if (err instanceof ApiPayloadTooLargeError) throw err;
          return null;
        });
        if (body && typeof body === 'object') {
          const rawCoupon = (body as { couponCode?: unknown }).couponCode;
          if (typeof rawCoupon === 'string' && rawCoupon.trim().length > 0) {
            couponCode = normalizeCouponCode(rawCoupon);
          }
          attribution = (body as { attribution?: unknown }).attribution;
          const rawFields = (body as { customFieldValues?: unknown }).customFieldValues;
          if (rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)) {
            customFieldValues = rawFields as Record<string, string>;
          }
        }
      }
    } catch (err) {
      if (err instanceof ApiPayloadTooLargeError) {
        return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
      }
      couponCode = null;
    }

    // Get product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, slug, price, currency, icon, is_active, available_from, available_until, custom_checkout_fields')
      .eq('slug', slug)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Validate product-defined custom checkout fields when the form submitted them
    // (logged-in path). Absent values keep the legacy behaviour so the guest
    // magic-link callback — which re-calls grant-access with no body — still works.
    if (customFieldValues !== undefined) {
      const definitions = validateCustomFieldDefinitions(product.custom_checkout_fields ?? []);
      if (!definitions.ok) {
        return NextResponse.json({ error: 'Invalid product configuration' }, { status: 400 });
      }
      const validated = validateCustomFieldValues(definitions.value, customFieldValues, { requireAll: true });
      if (!validated.ok) {
        return NextResponse.json({ error: 'Invalid form values', fieldErrors: validated.errors }, { status: 400 });
      }
    }

    // Check temporal availability
    const now = new Date();
    const availableFrom = product.available_from ? new Date(product.available_from) : null;
    const availableUntil = product.available_until ? new Date(product.available_until) : null;

    const isTemporallyAvailable = (!availableFrom || availableFrom <= now) && (!availableUntil || availableUntil > now);

    if (!product.is_active || !isTemporallyAvailable) {
      return NextResponse.json({ error: 'Product not available for purchase' }, { status: 400 });
    }

    // The unified grant_free_product_access RPC decides eligibility itself
    // (price=0 / PWYW-free / full-discount coupon) and validates the coupon
    // via verify_coupon internally. We just pass it through.
    const adminClient = createAdminClient();
    const accessResult = await grantFreeProductAccess(supabase, adminClient, {
      product: { id: product.id, slug },
      user: { id: user.id, email: user.email ?? '' },
      couponCode: couponCode ?? undefined,
      ...(customFieldValues !== undefined ? { customFieldValues } : {}),
    });

    if (!accessResult.accessGranted) {
      return NextResponse.json({ error: accessResult.error }, { status: 400 });
    }

    // Track only new grants; the shared grant service handles lead delivery.
    if (!accessResult.alreadyHadAccess) {
      await recordFreeAttribution(adminClient, product.id, user.id, attribution, attributionRequestContext(request.headers));
      trackServerSideConversion({
        eventName: 'Lead',
        eventSourceUrl: request.headers.get('referer') || '',
        value: 0,
        currency: 'USD',
        items: [{ item_id: product.id, item_name: product.name, price: 0, quantity: 1 }],
        userEmail: user.email || undefined,
      }).catch(err => console.error('[FB CAPI] Server-side Lead tracking error:', err));
    }

    return NextResponse.json({
      success: true,
      message: accessResult.alreadyHadAccess ? 'Access already granted' : 'Access granted successfully',
      alreadyHadAccess: accessResult.alreadyHadAccess,
      ...(accessResult.otoInfo ? { otoInfo: accessResult.otoInfo } : {}),
    });

  } catch (error) {
    console.error('Error in grant access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
