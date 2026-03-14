import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/admin';
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
 * Verifies admin access for API Routes that support both Bearer token and cookie auth.
 * Tries Bearer token first (for API clients like Postman, MCP server), then falls back
 * to cookie-based auth (for browser clients).
 * Throws 'Unauthorized' or 'Forbidden' to be caught by the route handler.
 *
 * Uses createPlatformClient() (service role, public schema) for admin_users check
 * since Bearer-authenticated users don't have a cookie-based session.
 */
export async function requireAdminApiWithRequest(request: NextRequest) {
  let user: User | null = null;

  // Try Bearer token auth first (for API clients)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const platformClient = createPlatformClient();
    const { data: { user: tokenUser }, error: authError } = await platformClient.auth.getUser(token);
    if (!authError && tokenUser) {
      user = tokenUser;
    }
  }

  // Fall back to cookie auth (for browser clients)
  if (!user) {
    const supabase = await createClient();
    const { data: { user: cookieUser }, error: authError } = await supabase.auth.getUser();
    if (!authError && cookieUser) {
      user = cookieUser;
    }
  }

  if (!user) {
    console.warn(`[requireAdminApiWithRequest] Unauthenticated API request at ${new Date().toISOString()}`);
    throw new Error('Unauthorized');
  }

  // Check admin privileges using platform client (admin_users is in public schema)
  const platformClient = createPlatformClient();
  const { data: admin, error: adminError } = await platformClient
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (adminError || !admin) {
    console.warn(`[requireAdminApiWithRequest] Non-admin access attempt by ${sanitizeForLog(user.email || 'unknown')} (${user.id}) at ${new Date().toISOString()}`);
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
  const access = await checkMarketplaceAccess();
  if (!access.accessible) {
    throw new Error('Marketplace is not enabled');
  }

  return requireAdminApi(supabase);
}
