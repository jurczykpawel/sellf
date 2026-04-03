import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { sanitizeForLog } from '@/lib/logger';

import { SupabaseClient, User } from '@supabase/supabase-js';

// ===== TYPES =====

export type AdminRole = 'platform_admin';

export interface AdminAccessResult {
  user: User;
  role: AdminRole;
}

/**
 * Verifies admin access for Server Components (Page/Layout).
 * Redirects on failure.
 */
export async function verifyAdminAccess(): Promise<User> {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    redirect('/login');
  }

  const { data: adminNode, error: adminError } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (adminError || !adminNode) {
    console.warn(`Unauthorized access attempt by ${sanitizeForLog(user.email || 'unknown')}`);
    redirect('/');
  }

  return user;
}

/**
 * Verifies admin access for API Routes.
 * Throws 'Unauthorized' or 'Forbidden' on failure.
 */
export async function requireAdminApi(supabase: SupabaseClient): Promise<AdminAccessResult> {
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

  return { user, role: 'platform_admin' };
}

/**
 * Verifies admin access for API Routes with Bearer token or cookie auth.
 * Tries Bearer token first (for API clients), then falls back to cookie-based auth.
 */
export async function requireAdminApiWithRequest(request: NextRequest): Promise<AdminAccessResult> {
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

  // Check platform admin
  const platformClient = createPlatformClient();
  const { data: admin } = await platformClient
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (admin) {
    return { user, role: 'platform_admin' };
  }

  console.warn(`[requireAdminApiWithRequest] Non-admin access attempt by ${sanitizeForLog(user.email || 'unknown')} (${user.id}) at ${new Date().toISOString()}`);
  throw new Error('Forbidden');
}
