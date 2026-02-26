import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limiting'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 30 requests per minute (prevents DB flooding)
    const rateLimitOk = await checkRateLimit('consent_log', 30, 60);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const supabase = await createClient()
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

    // Check if consent logging is enabled first
    const { data: config } = await supabase
      .from('integrations_config')
      .select('consent_logging_enabled')
      .single()

    if (!config?.consent_logging_enabled) {
      return NextResponse.json({ success: true, message: 'Logging disabled' })
    }

    const { error } = await supabase
      .from('consent_logs')
      .insert({
        anonymous_id: anonymous_id || null,
        consents: consents || null,
        consent_version: consent_version || null,
        user_id: user_id || null,
        ip_address,
        user_agent
      })

    if (error) {
      console.error('Failed to log consent:', error)
      return NextResponse.json({ error: 'Failed to log consent' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Consent API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
