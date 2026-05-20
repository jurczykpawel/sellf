import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limiting'
import { isAllowedOrigin } from '@/lib/security/origin-match'
import { getClientIp } from '@/lib/security/client-ip'
import { parseConsentBody } from './schema'

export async function POST(request: NextRequest) {
  try {
    // Origin must be present and match the configured site URL. A missing
    // Origin header on POST is a clear sign of a non-browser caller and
    // is rejected here rather than treated as "same-origin".
    const origin = request.headers.get('origin');
    const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl || !isAllowedOrigin(origin, [siteUrl])) {
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

    const parsed = parseConsentBody(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { anonymous_id, consents, consent_version } = parsed.data

    // Bind the row to the authenticated user when one is present. Any
    // user_id supplied in the body is ignored so a logged-in attacker
    // cannot attribute consent rows to a different account.
    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()
    const boundUserId = user?.id ?? null

    const ip_address = getClientIp(request)
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

    const { error } = await supabase
      .from('consent_logs')
      .insert({
        anonymous_id: anonymous_id || null,
        consents: (consents ?? null) as never,
        consent_version: consent_version || null,
        user_id: boundUserId,
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
