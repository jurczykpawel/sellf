import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminApiWithRequest } from '@/lib/auth-server';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

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
  const { data, error } = await createAdminClient().rpc('revoke_issued_licenses', {
    p_license_ids: [id.data], p_actor: access.auth!.user.id,
  });
  if (error) return NextResponse.json({ error: 'License revocation failed' }, { status: 500, headers: noStore });
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore });

  return NextResponse.json({ revoked: true }, { headers: noStore });
}
