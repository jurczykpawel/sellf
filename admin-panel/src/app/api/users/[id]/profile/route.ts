import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const rateLimitOk = await checkRateLimit('user_profile', 30, 1);
    if (!rateLimitOk) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // SECURITY FIX (V5): Check if user is accessing their own profile OR is an admin
    if (user.id !== id) {
      // Not their own profile - check if they're an admin
      const { data: adminRecord, error: adminError } = await supabase
        .from('admin_users')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (adminError || !adminRecord) {
        // Not admin, not their own profile - forbidden
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Call our database function to get the complete user profile
    const { data, error } = await supabase
      .rpc('get_user_profile', { user_id_param: id });

    if (error) {
      console.error('Error fetching user profile:', error);
      return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in GET /api/users/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
