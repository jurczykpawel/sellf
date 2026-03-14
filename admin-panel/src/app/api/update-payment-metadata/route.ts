import { NextRequest, NextResponse } from 'next/server';
import { getStripeServer } from '@/lib/stripe/server';
import { checkRateLimit } from '@/lib/rate-limiting';

/**
 * POST /api/update-payment-metadata
 *
 * Updates Payment Intent metadata with invoice/company data
 * before the payment is confirmed.
 *
 * SECURITY:
 * - CORS protection: only same-origin requests allowed
 * - Rate limiting: 10 requests per minute per IP (higher than GUS because this is critical for payment flow)
 *
 * This is necessary because the PaymentIntent is created before
 * the user fills in invoice details.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. CORS Protection - Only allow same-origin requests
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const host = request.headers.get('host');

    // Use SITE_URL (server-side runtime env) — NEXT_PUBLIC_SITE_URL is baked at build time
    const allowedOrigins = [
      process.env.SITE_URL,
    ].filter(Boolean);

    // Reject if no allowed origins configured — empty SITE_URL means origin check is meaningless
    if (allowedOrigins.length === 0) {
      console.error('[update-payment-metadata] SITE_URL not configured — rejecting request');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const isValidOrigin = origin && allowedOrigins.some(allowed =>
      origin === allowed || (allowed ? origin.startsWith(allowed) : false)
    );

    const isValidReferer = referer && allowedOrigins.some(allowed =>
      allowed ? referer.startsWith(allowed) : false
    );

    if (!isValidOrigin && !isValidReferer) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden - Invalid origin'
        },
        { status: 403 }
      );
    }

    // 2. Rate Limiting - Database-backed for production reliability
    const rateLimitOk = await checkRateLimit('update_payment_metadata', 10, 1); // 10 requests per 1 minute

    if (!rateLimitOk) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many requests. Please try again later.'
        },
        {
          status: 429,
          headers: {
            'Retry-After': '60', // 1 minute
          }
        }
      );
    }

    // 3. Parse and validate request
    const {
      clientSecret,
      firstName,
      lastName,
      fullName, // New field - if provided, split into first/last name
      termsAccepted,
      needsInvoice,
      nip,
      companyName,
      address,
      city,
      postalCode,
      country,
    } = await request.json();

    if (!clientSecret) {
      return NextResponse.json(
        { success: false, error: 'Client secret is required' },
        { status: 400 }
      );
    }

    // Extract and validate Payment Intent ID from client secret
    const paymentIntentId = clientSecret.split('_secret_')[0];

    if (!/^pi_[a-zA-Z0-9]+$/.test(paymentIntentId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid payment intent format' },
        { status: 400 }
      );
    }

    // Handle fullName - split into firstName and lastName
    let finalFirstName = firstName || '';
    let finalLastName = lastName || '';

    if (fullName && !firstName && !lastName) {
      // Split fullName into first and last name
      const nameParts = fullName.trim().split(/\s+/);
      if (nameParts.length === 1) {
        finalFirstName = nameParts[0];
      } else {
        finalFirstName = nameParts[0];
        finalLastName = nameParts.slice(1).join(' ');
      }
    }

    const stripe = await getStripeServer();

    // Verify the PaymentIntent exists and is still in a modifiable state
    // This prevents metadata updates on already-completed or cancelled payments
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!pi || !['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
      return NextResponse.json(
        { success: false, error: 'Payment intent is not in a modifiable state' },
        { status: 400 }
      );
    }

    // Update Payment Intent with customer and invoice metadata
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: {
        first_name: finalFirstName,
        last_name: finalLastName,
        full_name: fullName || `${finalFirstName} ${finalLastName}`.trim(), // Store full name too for reference
        terms_accepted: termsAccepted ? 'true' : '',
        needs_invoice: needsInvoice ? 'true' : 'false',
        nip: nip || '',
        company_name: companyName || '',
        address: address || '',
        city: city || '',
        postal_code: postalCode || '',
        country: country || '',
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating payment metadata:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update payment metadata',
      },
      { status: 500 }
    );
  }
}
