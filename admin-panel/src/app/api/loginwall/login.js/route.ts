import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { buildLoginwallScript } from '@/lib/loginwall/snippet';
import { rateLimitGuard, siteOrigin } from '@/lib/loginwall/request';

const querySchema = z.object({ id: z.string().uuid() });

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({ id: request.nextUrl.searchParams.get('id') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const origin = siteOrigin();
  if (!origin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const limited = await rateLimitGuard('loginwall_js', 60, 1);
  if (limited) return limited;

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
