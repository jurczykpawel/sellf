// app/api/admin/payments/sessions/[sessionId]/cancel/route.ts
// NOTE: This endpoint is not used in embedded checkout flow
// Keeping for API compatibility but returns not implemented

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

import { requireAdminApi } from '@/lib/auth-server';

interface RouteParams {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  // Auth + admin check required even on stub endpoints
  const supabase = await createClient();
  await requireAdminApi(supabase);

  return NextResponse.json({ 
    error: 'Session cancellation not supported in embedded checkout',
    sessionId 
  }, { status: 501 });
}
