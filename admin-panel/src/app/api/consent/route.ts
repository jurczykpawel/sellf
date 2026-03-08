import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limiting'

export async function POST(request: NextRequest) {
  try {
    // Origin validation: only accept requests from our own site (prevents cross-origin DB noise)
    const origin = request.headers.get('origin');
    const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
    if (origin && siteUrl && origin !== new URL(siteUrl).origin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Rate limiting: 30 requests per minute (prevents DB flooding)
    const rateLimitOk = await checkRateLimit('consent_log', 30, 60);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
    }

    const body = await request.json()

    const {
      anonymous_id,
      consents,
      consent_version,
      user_id
    } = body

    // Input validation
    if (anonymous_id !== undefined && (typeof anonymous_id !== 'string' || anonymous_id.length > 200)) {
      return NextResponse.json({ error: 'Invalid anonymous_id' }, { status: 400 })
    }
    if (consents !== undefined && (typeof consents !== 'object' || consents === null || JSON.stringify(consents).length > 5000)) {
      return NextResponse.json({ error: 'Invalid consents' }, { status: 400 })
    }
    if (consent_version !== undefined && (typeof consent_version !== 'string' || consent_version.length > 50)) {
      return NextResponse.json({ error: 'Invalid consent_version' }, { status: 400 })
    }
    if (user_id !== undefined && user_id !== null && (typeof user_id !== 'string' || user_id.length > 200)) {
      return NextResponse.json({ error: 'Invalid user_id' }, { status: 400 })
    }

    // Get client info from headers
    const ip_address = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const user_agent = (request.headers.get('user-agent') || 'unknown').substring(0, 500)

    // Use admin client — this endpoint is public (called by Klaro consent callback
    // for anonymous visitors), so the anon-scoped client can't read integrations_config
    const supabase = createAdminClient()

    // Check if consent logging is enabled first
    const { data: config } = await supabase
      .from('integrations_config')
      .select('consent_logging_enabled')
      .single()

    if (!config?.consent_logging_enabled) {
      return NextResponse.json({ success: true, message: 'Logging disabled' })
    }

    // Never trust user_id from request body — use session if available
    // For anonymous visitors, user_id will be null
    const { error } = await supabase
      .from('consent_logs')
      .insert({
        anonymous_id: anonymous_id || null,
        consents: consents || null,
        consent_version: consent_version || null,
        user_id: null,
        ip_address,
        user_agent
      })

    if (error) {
      console.error('[consent] Failed to log consent:', error)
      return NextResponse.json({ error: 'Failed to log consent' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[consent] API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
