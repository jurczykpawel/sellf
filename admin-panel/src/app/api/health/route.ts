import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limiting';

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', // 24 hours
    },
  });
}

export async function GET() {
  try {
    // Rate limiting: 60 requests per minute
    const rateLimitOk = await checkRateLimit('health', 60, 60);
    if (!rateLimitOk) {
      return NextResponse.json(
        { status: 'error', error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Basic health check — no version/environment to avoid info leak
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'sellf-admin',
    }

    return NextResponse.json(health, { 
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    })
  } catch {
    return NextResponse.json(
      { 
        status: 'error', 
        message: 'Health check failed',
        timestamp: new Date().toISOString()
      },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      }
    )
  }
}
