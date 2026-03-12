import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { sanitizeForLog } from '@/lib/logger';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Verifies admin access for Server Components (Page/Layout).
 * Redirects on failure.
 */
export async function verifyAdminAccess(): Promise<User> {
  const supabase = await createClient();

  // 1. Check Auth Session
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    redirect('/login');
  }

  // 2. Check Admin Status in Database
  const { data: adminNode, error: adminError } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (adminError || !adminNode) {
    // User is logged in but not an admin
    console.warn(`Unauthorized access attempt by ${sanitizeForLog(user.email || 'unknown')}`);
    redirect('/'); 
  }

  return user;
}

/**
 * Verifies admin access for API Routes.
 * Throws specific errors to be caught by the route handler.
 */
export async function requireAdminApi(supabase: SupabaseClient) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.warn(`[requireAdminApi] Unauthenticated API request at ${new Date().toISOString()}`);
    throw new Error('Unauthorized');
  }

  const { data: admin, error: adminError } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (adminError || !admin) {
    console.warn(`[requireAdminApi] Non-admin access attempt by ${sanitizeForLog(user.email || 'unknown')} (${user.id}) at ${new Date().toISOString()}`);
    throw new Error('Forbidden');
  }

  return { user, admin };
}

/**
 * Combined guard: admin auth + marketplace feature flag.
 * Use in marketplace API routes and server actions.
 * Throws on auth failure, returns { user, admin } on success.
 */
export async function requireMarketplaceAdmin(supabase: SupabaseClient) {
  const access = checkMarketplaceAccess();
  if (!access.accessible) {
    throw new Error('Marketplace is not enabled');
  }

  return requireAdminApi(supabase);
}
