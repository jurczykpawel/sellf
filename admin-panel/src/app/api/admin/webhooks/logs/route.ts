import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSchemaAwareAdminClient } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    const { searchParams } = new URL(request.url);
    const endpointId = searchParams.get('endpointId');
    const status = searchParams.get('status') || 'all';
    const limit = parseInt(searchParams.get('limit') || '20');
    const countOnly = searchParams.get('count') === 'true';

    // Base query
    let query = (dataClient as any)
      .from('webhook_logs')
      .select(
        countOnly 
          ? '* ' 
          : `
            id,
            created_at,
            http_status,
            response_body,
            payload,
            error_message,
            event_type,
            duration_ms,
            status,
            endpoint:webhook_endpoints (
              id,
              url,
              description,
              is_active
            )
          `, 
        { count: countOnly ? 'exact' : undefined, head: countOnly }
      );

    // Filters
    // 1. Filter by Endpoint ID (if provided)
    if (endpointId) {
      query = query.eq('endpoint_id', endpointId);
    }

    // 2. Filter by Status
    if (status === 'failed') {
      query = query.eq('status', 'failed');
    } else if (status === 'success') {
      query = query.eq('status', 'success');
    } else if (status === 'archived') {
      query = query.eq('status', 'archived');
    } else if (status === 'retried') {
      query = query.eq('status', 'retried');
    }
    // else: 'all' - no status filter, show everything

    // 3. Sorting & Pagination
    if (!countOnly) {
      query = query
        .order('created_at', { ascending: false })
        .limit(limit);
    }

    const { data, count, error } = await query;

    if (error) throw error;

    if (countOnly) {
      return NextResponse.json({ count: count || 0 });
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && (error.message === 'Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    console.error('Error fetching webhook logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
