// app/api/admin/payments/sessions/[sessionId]/cancel/route.ts
// NOTE: This endpoint is not used in embedded checkout flow
// Keeping for API compatibility but returns not implemented

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  // Auth + admin check required even on stub endpoints
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const { data: adminUser, error: adminError } = await supabase
    .from('admin_users').select('id').eq('user_id', user.id).single();
  if (adminError || !adminUser) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  return NextResponse.json({ 
    error: 'Session cancellation not supported in embedded checkout',
    sessionId 
  }, { status: 501 });
}
