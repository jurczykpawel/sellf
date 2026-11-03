import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminApiWithRequest } from '@/lib/auth-server';
import { issueRequestedLicense, licenseRequestSchema } from '@/lib/license-keys/request';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';
import { getCanonicalOrigin } from '@/lib/utils/canonical-url';


const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  productId: z.string().uuid().optional(),
  source: z.enum(['purchase', 'manual', 'api']).optional(),
  status: z.enum(['active', 'expired', 'revoked']).optional(),
  search: z.string().trim().max(254).optional(),
});

function authError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : '';
  return NextResponse.json(
    { error: message === 'Unauthorized' ? 'Unauthorized' : 'Forbidden' },
    { status: message === 'Unauthorized' ? 401 : 403 },
  );
}

const noStore = { 'Cache-Control': 'no-store' };

function rejectDemoMode(): NextResponse | null {
  return process.env.DEMO_MODE === 'true'
    ? NextResponse.json({ error: 'Disabled in demo mode' }, { status: 403, headers: noStore })
    : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const demoResponse = rejectDemoMode();
  if (demoResponse) return demoResponse;
  let auth;
  try {
    auth = await requireAdminApiWithRequest(request);
  } catch (error) {
    return authError(error);
  }

  if (!(await checkRateLimit('admin_license_issue', 10, 60, auth.user.id))) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: noStore });
  }

  let rawBody: unknown = null;
  try {
    rawBody = await readJsonBody(request);
  } catch (err) {
    if (err instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413, headers: noStore });
    }
  }
  const parsed = licenseRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400, headers: noStore });
  }

  const issued = await issueRequestedLicense(parsed.data, { actorUserId: auth.user.id, source: 'manual', origin: getCanonicalOrigin(request) });
  if (!issued.ok) {
    return NextResponse.json({ error: issued.error, ...(issued.fieldErrors && { fieldErrors: issued.fieldErrors }) }, { status: issued.status, headers: noStore });
  }
  return NextResponse.json({ license: issued.license }, { status: 201, headers: noStore });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const demoResponse = rejectDemoMode();
  if (demoResponse) return demoResponse;
  try {
    await requireAdminApiWithRequest(request);
  } catch (error) {
    return authError(error);
  }

  const parsed = listSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400, headers: noStore });

  const admin = createAdminClient();
  const { page, limit, productId, source, status, search } = parsed.data;
  const from = (page - 1) * limit;
  const now = new Date().toISOString();
  let query = admin
    .from('issued_licenses')
    .select('id, product_id, email, order_id, kid, issued_at, expires_at, revoked_at, revoked_by_dispute_id, issuance_source, license_domain, products(name, slug, license_tier)', { count: 'exact' })
    .order('issued_at', { ascending: false })
    .range(from, from + limit - 1);
  if (productId) query = query.eq('product_id', productId);
  if (source) query = query.eq('issuance_source', source);
  if (status === 'revoked') query = query.not('revoked_at', 'is', null);
  if (status === 'expired') query = query.is('revoked_at', null).lt('expires_at', now);
  if (status === 'active') query = query.is('revoked_at', null).or(`expires_at.is.null,expires_at.gte.${now}`);
  if (search) query = query.ilike('email', `%${search.replace(/[%_,]/g, '')}%`);

  const [{ data, count, error }, productsResult] = await Promise.all([
    query,
    admin
      .from('products')
      .select('id, name, slug, license_tier, license_duration_days, custom_checkout_fields')
      .eq('issue_license_on_purchase', true)
      .order('name'),
  ]);
  if (error || productsResult.error) {
    return NextResponse.json({ error: 'Failed to load licenses' }, { status: 500, headers: noStore });
  }
  return NextResponse.json({ licenses: data ?? [], products: productsResult.data ?? [], page, limit, total: count ?? 0 }, { headers: noStore });
}
