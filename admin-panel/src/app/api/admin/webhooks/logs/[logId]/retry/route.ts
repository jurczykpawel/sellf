import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDataClientFromAuth } from '@/lib/supabase/admin';

import { WebhookService } from '@/lib/services/webhook-service';
import { requireAdminOrSellerApi } from '@/lib/auth-server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ logId: string }> }
) {
  try {
    const { logId } = await context.params;
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);

    // SECURITY: Verify log belongs to the seller's schema before retrying
    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);
    const { data: log } = await dataClient
      .from('webhook_logs')
      .select('id')
      .eq('id', logId)
      .single();

    if (!log) {
      return NextResponse.json({ error: 'Webhook log not found' }, { status: 404 });
    }

    const result = await WebhookService.retry(logId, dataClient);

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    console.error('Error retrying webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}