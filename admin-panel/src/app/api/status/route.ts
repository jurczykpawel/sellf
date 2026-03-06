import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limiting';

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') || '*';
  
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', // 24 hours
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
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
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      }
    );
  }
}
