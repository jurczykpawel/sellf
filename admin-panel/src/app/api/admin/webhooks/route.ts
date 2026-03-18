import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDataClientFromAuth } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';
import { isValidWebhookUrl } from '@/lib/validations/webhook';

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);

    const { data: endpoints, error } = await dataClient
      .from('webhook_endpoints')
      .select('id, url, events, description, is_active, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(endpoints);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && (error.message === 'Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    
    console.error('Error fetching webhooks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createDataClientFromAuth(authResult.sellerSchema);

    const body = await request.json();
    const { url, events, description } = body;

    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    // SECURITY FIX (V8): Validate webhook URL to prevent SSRF
    const urlValidation = isValidWebhookUrl(url);
    if (!urlValidation.valid) {
      return NextResponse.json({ error: `Invalid webhook URL: ${urlValidation.error}` }, { status: 400 });
    }

    const { data: endpoint, error } = await dataClient
      .from('webhook_endpoints')
      .insert({
        url,
        events,
        description,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(endpoint);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && (error.message === 'Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    console.error('Error creating webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}