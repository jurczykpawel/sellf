/** Bounded public catalogue reads. @see lib/storefront-templates/catalogue.ts */
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { loadCataloguePage } from '@/lib/storefront-templates/catalogue';
import { catalogueRequestSchema } from '@/lib/storefront-templates/catalogue-section';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (!(await checkRateLimit('storefront_catalogue', 60, 1))) return respond({ error: 'RATE_LIMITED' }, 429);
    const input = request.nextUrl.searchParams.get('input');
    if (!input || input.length > 4096) return respond({ error: 'INVALID' }, 422);
    let raw: unknown;
    try {
      raw = JSON.parse(input);
    } catch {
      return respond({ error: 'INVALID' }, 422);
    }
    const parsed = catalogueRequestSchema.safeParse(raw);
    if (!parsed.success) return respond({ error: 'INVALID' }, 422);
    const result = await loadCataloguePage(createAdminClient(), parsed.data);
    return result.success
      ? respond(result.data)
      : respond({ error: result.error }, result.error === 'INVALID' ? 422 : 503);
  } catch {
    return respond({ error: 'UNAVAILABLE' }, 503);
  }
}
