import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDataClientFromAuth } from '@/lib/supabase/admin';

import { requireAdminOrSellerApi } from '@/lib/auth-server';

// GET /api/admin/refund-requests - Get all refund requests (admin only)
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') || null;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Use the database function
    const { data, error } = await dataClient
      .rpc('get_admin_refund_requests', {
        status_filter: status ?? undefined,
        limit_param: limit,
        offset_param: offset,
      });

    if (error) throw error;

    return NextResponse.json({ requests: data });
  } catch (error) {
    console.error('Error fetching refund requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch refund requests' },
      { status: 500 }
    );
  }
}
