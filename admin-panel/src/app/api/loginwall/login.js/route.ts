import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { buildLoginwallScript } from '@/lib/loginwall/snippet';
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';

const querySchema = z.object({ id: z.string().uuid() });

const RATE_LIMIT_ACTION = 'loginwall_js';
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MIN = 1;

function clientIdentifier(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({ id: request.nextUrl.searchParams.get('id') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const origin = siteOrigin();
  if (!origin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const allowed = await checkRateLimitForIdentifier(
    RATE_LIMIT_ACTION,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MIN,
    clientIdentifier(request),
  );
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  const body = buildLoginwallScript({ productId: parsed.data.id, sellfOrigin: origin });
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
