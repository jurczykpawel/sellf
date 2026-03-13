import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_LENGTH = 2000;

// GET /api/refund-requests - Get user's refund requests
export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Step 1: Fetch refund requests (no FK embedding — proxy views don't support it)
    const { data: requests, error } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!requests || requests.length === 0) {
      return NextResponse.json({ requests: [] });
    }

    // Step 2: Fetch related products and transactions
    const productIds = [...new Set(requests.map(r => r.product_id).filter(Boolean))];
    const transactionIds = [...new Set(requests.map(r => r.transaction_id).filter(Boolean))];

    const [productsResult, transactionsResult] = await Promise.all([
      productIds.length > 0
        ? supabase.from('products').select('id, name, icon, slug').in('id', productIds)
        : { data: [], error: null },
      transactionIds.length > 0
        ? supabase.from('payment_transactions').select('id, created_at, amount, currency').in('id', transactionIds)
        : { data: [], error: null },
    ]);

    const productsMap = new Map((productsResult.data || []).map(p => [p.id, p]));
    const transactionsMap = new Map((transactionsResult.data || []).map(t => [t.id, t]));

    // Step 3: Merge results to match the original FK embedding shape
    const enrichedRequests = requests.map(r => ({
      ...r,
      products: r.product_id ? productsMap.get(r.product_id) || null : null,
      payment_transactions: r.transaction_id ? transactionsMap.get(r.transaction_id) || null : null,
    }));

    return NextResponse.json({ requests: enrichedRequests });
  } catch (error) {
    console.error('Error fetching refund requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch refund requests' },
      { status: 500 }
    );
  }
}

// POST /api/refund-requests - Create a refund request
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Rate limiting: 3 requests per 60 minutes per user
    const rateLimitOk = await checkRateLimit('refund_request', 3, 60, user.id);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many refund requests. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { transaction_id, reason } = body;

    if (!transaction_id || typeof transaction_id !== 'string') {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      );
    }
    if (!UUID_REGEX.test(transaction_id)) {
      return NextResponse.json(
        { error: 'Invalid Transaction ID format' },
        { status: 400 }
      );
    }
    if (reason !== undefined && reason !== null) {
      if (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH) {
        return NextResponse.json(
          { error: `Reason must be a string of at most ${MAX_REASON_LENGTH} characters` },
          { status: 400 }
        );
      }
    }

    // Use the database function to create the request
    const { data, error } = await supabase
      .rpc('create_refund_request', {
        transaction_id_param: transaction_id,
        reason_param: reason || null,
      });

    if (error) throw error;

    if (!data.success) {
      return NextResponse.json(
        { error: data.error, details: data.details },
        { status: 400 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error creating refund request:', error);
    return NextResponse.json(
      { error: 'Failed to create refund request' },
      { status: 500 }
    );
  }
}
