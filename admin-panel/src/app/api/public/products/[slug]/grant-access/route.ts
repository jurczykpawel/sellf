import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { WebhookService } from '@/lib/services/webhook-service';
import { trackServerSideConversion } from '@/lib/tracking';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';

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

    // Optional coupon payload. Body is best-effort: grant-access is also called with
    // no body from the free/PWYW path, so parse leniently and treat any failure as "no coupon".
    let couponCode: string | null = null;
    try {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await request.json().catch(() => null);
        const raw = body && typeof body === 'object' ? (body as { couponCode?: unknown }).couponCode : null;
        if (typeof raw === 'string' && raw.trim().length > 0) {
          couponCode = raw.trim().toUpperCase();
        }
      }
    } catch {
      couponCode = null;
    }

    // Get product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, slug, price, currency, icon, is_active, available_from, available_until')
      .eq('slug', slug)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
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
    });

    if (!accessResult.accessGranted) {
      return NextResponse.json({ error: accessResult.error }, { status: 400 });
    }

    // Trigger webhook and tracking only for new grants (not repeat calls)
    if (!accessResult.alreadyHadAccess) {
      WebhookService.trigger('lead.captured', {
        customer: { email: user.email, userId: user.id },
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          price: product.price,
          currency: product.currency,
          icon: product.icon,
        },
      }, adminClient).catch(err => console.error('Webhook trigger error:', err));

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
