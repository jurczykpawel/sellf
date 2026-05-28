import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { buildGateScript } from '@/lib/loginwall/gate-snippet';
import { siteOrigin } from '@/lib/loginwall/request';
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';

const querySchema = z.object({
  products: z
    .string()
    .min(1)
    .transform((raw) => raw.split(','))
    .pipe(z.array(z.string().regex(/^[a-z0-9-]{1,96}$/)).min(1).max(20)),
});

const RATE_LIMIT_ACTION = 'loginwall_gate_js';
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MIN = 1;

function clientIdentifier(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({ products: request.nextUrl.searchParams.get('products') });
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

  const body = buildGateScript({ slugs: parsed.data.products, sellfOrigin: origin });
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
