import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminApiWithRequest } from '@/lib/auth-server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { emitLicenseRevokedWebhooks, type RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';

const idSchema = z.string().uuid();
const noStore = { 'Cache-Control': 'no-store' };

function rejectDemoMode(): NextResponse | null {
  return process.env.DEMO_MODE === 'true'
    ? NextResponse.json({ error: 'Disabled in demo mode' }, { status: 403, headers: noStore })
    : null;
}

async function authorize(request: NextRequest) {
  try {
    return { auth: await requireAdminApiWithRequest(request), error: null };
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'Unauthorized';
    return {
      auth: null,
      error: NextResponse.json({ error: unauthorized ? 'Unauthorized' : 'Forbidden' }, { status: unauthorized ? 401 : 403 }),
    };
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const demoResponse = rejectDemoMode();
  if (demoResponse) return demoResponse;
  const access = await authorize(request);
  if (access.error) return access.error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: 'Invalid license id' }, { status: 400, headers: noStore });
  if (!(await checkRateLimit('admin_license_reveal', 30, 60, access.auth!.user.id))) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: noStore });
  }
  const { data, error } = await createAdminClient()
    .from('issued_licenses')
    .select('license_key')
    .eq('id', id.data)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to load license' }, { status: 500, headers: noStore });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore });
  return NextResponse.json({ token: data.license_key }, { headers: noStore });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const demoResponse = rejectDemoMode();
  if (demoResponse) return demoResponse;
  const access = await authorize(request);
  if (access.error) return access.error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: 'Invalid license id' }, { status: 400, headers: noStore });
  if (!(await checkRateLimit('admin_license_revoke', 20, 60, access.auth!.user.id))) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: noStore });
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('issued_licenses')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id.data)
    .is('revoked_at', null)
    .select('id, product_id, email, order_id, seller_id, license_domain, issuance_source, issued_at, expires_at, revoked_at, products(name, slug, license_tier)')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'License revocation failed' }, { status: 500, headers: noStore });
  if (!data) return NextResponse.json({ error: 'Not found or already revoked' }, { status: 404, headers: noStore });
  const row = data as unknown as RevokedLicenseRow;
  await createPlatformClient().from('audit_log').insert({
    table_name: 'issued_licenses',
    operation: 'LICENSE_REVOKED',
    performed_by: access.auth!.user.id,
    old_values: { license_id: row.id, product_id: row.product_id, email: row.email, order_id: row.order_id },
  });

  // Notify the seller's integrations (Pro, fire-and-forget — see helper).
  await emitLicenseRevokedWebhooks(admin, [row], request.nextUrl.origin);

  return NextResponse.json({ revoked: true }, { headers: noStore });
}
