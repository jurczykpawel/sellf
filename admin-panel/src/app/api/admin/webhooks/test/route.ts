import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDataClientFromAuth } from '@/lib/supabase/admin';

import { WebhookService } from '@/lib/services/webhook-service';
import { requireAdminOrSellerApi } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);

    const body = await request.json();
    const { endpointId, eventType } = body;

    if (!endpointId) {
      return NextResponse.json({ error: 'Endpoint ID required' }, { status: 400 });
    }

    // SECURITY: Verify endpoint belongs to the seller's schema before testing
    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);
    const { data: endpoint } = await dataClient
      .from('webhook_endpoints')
      .select('id')
      .eq('id', endpointId)
      .single();

    if (!endpoint) {
      return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 });
    }

    const result = await WebhookService.testEndpoint(endpointId, eventType, dataClient);

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    console.error('Error testing webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}