/** Bounded public catalogue reads. @see lib/storefront-templates/catalogue.ts */
import { NextResponse } from 'next/server';
import { z } from 'zod';
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
    const parsed = z.union([catalogueRequestSchema, z.array(catalogueRequestSchema).min(1).max(3)]).safeParse(raw);
    if (!parsed.success) return respond({ error: 'INVALID' }, 422);
    const client = createAdminClient();
    const batch = Array.isArray(parsed.data);
    const inputs = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const results = await Promise.all(inputs.map(input => loadCataloguePage(client, input)));
    const failure = results.find(result => !result.success);
    if (failure && !failure.success) return respond({ error: failure.error }, failure.error === 'INVALID' ? 422 : 503);
    const pages = results.map(result => result.success ? result.data : null);
    return respond(batch ? pages : pages[0]);
  } catch {
    return respond({ error: 'UNAVAILABLE' }, 503);
  }
}
