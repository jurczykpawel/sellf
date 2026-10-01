import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminApi } from '@/lib/auth-server';
import { isDemoMode, DEMO_MODE_API_ERROR } from '@/lib/demo-guard';
import {
  validateUserAction,
  sanitizeUserActionData
} from '@/lib/validations/access';
import { escapeIlikePattern } from '@/lib/validations/product';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);
    const searchTerm = searchParams.get('search') || '';
    const sortBy = searchParams.get('sortBy') || 'user_created_at';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    // Map frontend sort keys to database view columns to prevent SQL injection or invalid column errors
    const sortMapping: Record<string, string> = {
      'user_created_at': 'user_created_at',
      'email': 'email',
      'last_sign_in_at': 'last_sign_in_at',
      'total_products': 'total_products',
      'total_value': 'total_value',
      'last_access_granted_at': 'last_access_granted_at'
    };
    const mappedSortBy = sortMapping[sortBy] || 'user_created_at';

    const supabase = await createClient();
    
    // CRITICAL: Verify admin access before using adminClient
    try {
      await requireAdminApi(supabase, request);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use Admin Client (Service Role) to bypass RLS on sensitive views
    const adminClient = createAdminClient();

    // Base query using adminClient
    let query = adminClient
      .from('user_access_stats')
      .select('*', { count: 'exact' });

    // SECURITY FIX (V13): Escape ILIKE special characters to prevent pattern injection
    if (searchTerm) {
      const escapedSearchTerm = escapeIlikePattern(searchTerm);
      query = query.ilike('email', `%${escapedSearchTerm}%`);
    }
    
    // Get users with their access statistics from the view
    const { data: userStats, error: statsError, count } = await query
      .order(mappedSortBy, { ascending: sortOrder === 'asc' })
      .range((page - 1) * limit, page * limit - 1);

    if (statsError) {
      console.error('Error fetching user stats:', statsError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Get detailed product access for all users
    const { data: userAccess, error: accessError } = await adminClient
      .from('user_product_access_detailed')
      .select('*')
      .order('access_created_at', { ascending: false });

    if (accessError) {
      console.error('Error fetching user access:', accessError);
      return NextResponse.json({ error: 'Failed to fetch user access' }, { status: 500 });
    }

    // Transform the data to match UserWithAccess interface
    const users = (userStats || []).map(userStat => {
      // Get all product access for this user
      const productAccess = (userAccess || [])
        .filter(access => access.user_id === userStat.user_id)
        .map(access => ({
          product_slug: access.product_slug,
          product_name: access.product_name,
          product_price: access.product_price,
          product_currency: access.product_currency,
          product_icon: access.product_icon,
          product_is_active: access.product_is_active,
          granted_at: access.access_created_at
        }));

      return {
        id: userStat.user_id,
        email: userStat.email,
        created_at: userStat.user_created_at,
        email_confirmed_at: userStat.email_confirmed_at,
        last_sign_in_at: userStat.last_sign_in_at,
        raw_user_meta_data: userStat.raw_user_meta_data,
        product_access: productAccess,
        stats: {
          total_products: userStat.total_products,
          total_value: userStat.total_value,
          last_access_granted_at: userStat.last_access_granted_at,
          first_access_granted_at: userStat.first_access_granted_at
        }
      };
    });

    return NextResponse.json({ 
      users,
      pagination: {
        total: count,
        totalPages: Math.ceil((count || 0) / limit),
        currentPage: page,
      }
    });
  } catch (error) {
    console.error('Error in users API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify admin access
    try {
      await requireAdminApi(supabase, request);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (isDemoMode()) {
      return NextResponse.json(DEMO_MODE_API_ERROR, { status: 403 });
    }

    const body = await readJsonBody<Record<string, unknown>>(request);

    // Sanitize input data
    const sanitizedData = sanitizeUserActionData(body);

    // Validate input data
    const validation = validateUserAction(sanitizedData);
    if (!validation.isValid) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: validation.errors 
      }, { status: 400 });
    }

    const userId = sanitizedData.userId as string;
    const productId = sanitizedData.productId as string;
    const action = sanitizedData.action as string;

    if (!userId || !productId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, productId, action' },
        { status: 400 }
      );
    }

    // Use Admin Client for data modification
    const adminClient = createAdminClient();

    if (action === 'grant') {
      // Grant access to a product
      const { error } = await adminClient
        .from('user_product_access')
        .insert([{ user_id: userId, product_id: productId }]);

      if (error) {
        console.error('Error granting access:', error);
        return NextResponse.json({ error: 'Failed to grant access' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Access granted' });
    } else if (action === 'revoke') {
      // Revoke access to a product
      const { error } = await adminClient
        .from('user_product_access')
        .delete()
        .eq('user_id', userId)
        .eq('product_id', productId);

      if (error) {
        console.error('Error revoking access:', error);
        return NextResponse.json({ error: 'Failed to revoke access' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Access revoked' });
    } else {
      return NextResponse.json({ error: 'Invalid action. Use "grant" or "revoke"' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    console.error('Error in users API POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}