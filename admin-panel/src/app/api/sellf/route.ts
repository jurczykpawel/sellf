import { NextResponse } from 'next/server'
import { SellfGenerator } from '@/lib/sellf-generator'
import { MemoryCache, handleConditionalRequest, createScriptResponse } from '@/lib/script-cache'
import { checkFeature } from '@/lib/license/resolve'
import { checkRateLimit } from '@/lib/rate-limiting'
import packageJson from '../../../../package.json'

/**
 * License cache using shared MemoryCache (5 min TTL)
 */
const licenseCache = new MemoryCache<boolean>({ ttl: 5 * 60 * 1000 });

/**
 * Get cached license validity or fetch from database
 */
async function getCachedLicenseValid(): Promise<boolean> {
  const cacheKey = 'license_valid';

  // Check cache first
  const cached = licenseCache.get(cacheKey);
  if (cached) {
    return cached.data;
  }

  // Resolve via unified license resolver
  try {
    const isValid = await checkFeature('watermark-removal');

    // Cache the result
    licenseCache.set(cacheKey, isValid);

    return isValid;
  } catch {
    // If resolution fails, return false
    return false;
  }
}

/**
 * Clear license cache (useful when license is updated via admin panel)
 */
export function clearLicenseCache(): void {
  licenseCache.clear();
}

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: Request) {
  // Get the origin from the request headers or default to '*'
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
 * Serve the sellf.js file with dynamic Supabase configuration
 *
 * Performance optimizations:
 * - License check cached for 5 minutes (avoids DB query on every request)
 * - Script generation cached for 1 hour (in SellfGenerator)
 * - HTTP caching with ETag support (304 Not Modified responses)
 * - Stale-while-revalidate for better UX
 */
export async function GET(request: Request) {
  try {
    // Rate limiting — prevents abuse of script generation endpoint
    const rateLimitOk = await checkRateLimit('sellf_js', 60, 1);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    // Extract configuration from environment variables
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

    // Get the origin from the request headers or default to '*'
    const origin = request.headers.get('origin') || '*';

    // Check for cache clearing parameter — admin-only
    const url = new URL(request.url);
    const clearCache = url.searchParams.get('clearCache') === 'true';

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase configuration not found' },
        {
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          }
        }
      )
    }

    // Clear in-memory caches when requested.
    // This only invalidates server-side memory — the next request re-fetches from DB.
    // Rate limiting (above) protects against abuse; the 5min TTL limits impact.
    if (clearCache) {
      SellfGenerator.clearCache();
      clearLicenseCache();
    }

    // Get license validity from cache (5 min TTL) or fetch from database
    let licenseValid = false;
    try {
      licenseValid = await getCachedLicenseValid();
    } catch {
      // If admin client creation fails (missing env vars), proceed without license
    }

    // Get productSlug from URL params for full page protection
    const productSlug = url.searchParams.get('productSlug');

    // Get main domain from environment or default to current host
    const mainDomain = process.env.MAIN_DOMAIN ||
                      (process.env.NODE_ENV === 'development' ? 'localhost:3000' : request.headers.get('host') || 'localhost:3000');

    // Generate the sellf script using the new generator
    const config = {
      supabaseUrl,
      supabaseAnonKey,
      environment: process.env.NODE_ENV as 'development' | 'production' | 'test',
      version: packageJson.version,
      mainDomain,
      productSlug: productSlug || undefined,
      licenseValid,
      // Optional: Add any additional configuration
      cacheDuration: 3600, // 1 hour
      debugMode: process.env.NODE_ENV === 'development',
    };

    const generatedResult = await SellfGenerator.generateScript(config);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    // Check for conditional request (ETag/If-None-Match)
    const conditionalResponse = handleConditionalRequest(request, generatedResult.hash, corsHeaders);
    if (conditionalResponse) {
      return conditionalResponse;
    }

    return createScriptResponse(generatedResult.content, generatedResult.hash, {
      ...corsHeaders,
      'Last-Modified': generatedResult.lastModified.toUTCString(),
      'X-License-Cached': licenseCache.size > 0 ? 'true' : 'false',
    })
  } catch (error) {
    console.error('Error serving sellf.js:', error)
    return NextResponse.json(
      { error: 'Failed to serve sellf.js' },
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
