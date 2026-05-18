import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { getRecentSupporters } from '@/lib/checkout-templates/recent-supporters';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const rateLimitOk = await checkRateLimit('public_recent_supporters', 60, 1);
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const { slug } = await context.params;
  const result = await getRecentSupporters(slug);
  if (!result) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}
