import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limiting';

function corsHeadersForSite(): Record<string, string> {
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (siteUrl) base['Access-Control-Allow-Origin'] = siteUrl;
  return base;
}

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      ...corsHeadersForSite(),
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Public status endpoint - no authentication required
 * Returns basic system status and counts
 */
export async function GET() {
  try {
    // Rate limiting: 30 requests per minute
    const rateLimitOk = await checkRateLimit('status', 30, 60);
    if (!rateLimitOk) {
      return NextResponse.json(
        {
          system: { status: 'error', error: 'Too many requests. Please try again later.' },
          error: 'Rate limit exceeded'
        },
        { status: 429 }
      );
    }

    const supabase = await createClient();

    // Get basic product count (public products only)
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, is_active')
      .eq('is_active', true);

    if (productsError) {
      console.error('Error fetching products for status:', productsError);
    }

    // Basic system status — no version/environment/counts to avoid info leak
    const status = {
      system: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'sellf-admin',
      },
      database: {
        connected: !productsError,
      }
    };

    return NextResponse.json(status, {
      status: 200,
      headers: corsHeadersForSite(),
    });
  } catch (error) {
    console.error('Error in status endpoint:', error);
    return NextResponse.json(
      {
        system: {
          status: 'error',
          timestamp: new Date().toISOString(),
          service: 'sellf-admin',
        },
        database: {
          connected: false,
        }
      },
      {
        status: 500,
        headers: corsHeadersForSite(),
      }
    );
  }
}
