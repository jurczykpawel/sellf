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
  try {
    const supabase = await createClient();
    await requireAdminApi(supabase, request);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[sessions/cancel] Auth error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({
    error: 'Session cancellation not supported in embedded checkout',
    sessionId
  }, { status: 501 });
}
