import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { buildGateScript } from '@/lib/loginwall/gate-snippet';
import { rateLimitGuard, siteOrigin } from '@/lib/loginwall/request';

const querySchema = z.object({
  products: z
    .string()
    .min(1)
    .transform((raw) => raw.split(','))
    .pipe(z.array(z.string().regex(/^[a-z0-9-]{1,96}$/)).min(1).max(20)),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({ products: request.nextUrl.searchParams.get('products') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const origin = siteOrigin();
  if (!origin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const limited = await rateLimitGuard('loginwall_gate_js', 60, 1);
  if (limited) return limited;

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
