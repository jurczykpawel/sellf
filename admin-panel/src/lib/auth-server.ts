import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { sanitizeForLog } from '@/lib/logger';

import { SupabaseClient, User } from '@supabase/supabase-js';

// ===== TYPES =====

export type AdminRole = 'platform_admin' | 'seller_admin';

export interface AdminAccessResult {
  user: User;
  role: AdminRole;
  /** Schema name for seller admins (e.g. 'seller_kowalski_digital'). Undefined for platform admins. */
  sellerSchema?: string;
  /** Seller slug for seller admins. Undefined for platform admins. */
  sellerSlug?: string;
  /** Seller display name. Undefined for platform admins. */
  sellerDisplayName?: string;
}

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

// ===== MARKETPLACE: ADMIN OR SELLER ACCESS =====

/**
 * Check if a user is a seller owner (has a record in public.sellers with their user_id).
 * Returns seller info if found, null otherwise.
 */
async function getSellerForUser(userId: string): Promise<{
  id: string;
  slug: string;
  schema_name: string;
  display_name: string;
} | null> {
  const platformClient = createPlatformClient();
  const { data, error } = await platformClient
    .from('sellers')
    .select('id, slug, schema_name, display_name')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Verifies admin OR seller owner access for Server Components.
 * Platform admins get full access. Seller owners get access to their schema only.
 * Redirects to /login or / on failure.
 *
 * @returns AdminAccessResult with role and optional seller schema info
 */
export async function verifyAdminOrSellerAccess(): Promise<AdminAccessResult> {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !user.email) {
    redirect('/login');
  }

  // Check platform admin first
  const { data: adminNode } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (adminNode) {
    return { user, role: 'platform_admin' };
  }

  // Check seller owner
  const seller = await getSellerForUser(user.id);
  if (seller) {
    return {
      user,
      role: 'seller_admin',
      sellerSchema: seller.schema_name,
      sellerSlug: seller.slug,
      sellerDisplayName: seller.display_name,
    };
  }

  // Neither admin nor seller owner
  console.warn(`Unauthorized access attempt by ${sanitizeForLog(user.email || 'unknown')}`);
  redirect('/');
}

/**
 * Verifies admin OR seller owner access for API Routes.
 * Throws 'Unauthorized' or 'Forbidden' on failure.
 */
export async function requireAdminOrSellerApi(supabase: SupabaseClient): Promise<AdminAccessResult> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  // Check platform admin
  const { data: admin } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (admin) {
    return { user, role: 'platform_admin' };
  }

  // Check seller owner
  const seller = await getSellerForUser(user.id);
  if (seller) {
    return {
      user,
      role: 'seller_admin',
      sellerSchema: seller.schema_name,
      sellerSlug: seller.slug,
      sellerDisplayName: seller.display_name,
    };
  }

  console.warn(`[requireAdminOrSellerApi] Non-admin/non-seller access attempt by ${sanitizeForLog(user.email || 'unknown')}`);
  throw new Error('Forbidden');
}

/**
 * Verifies admin OR seller owner access for API Routes that support both Bearer token and cookie auth.
 * Tries Bearer token first (for API clients), then falls back to cookie-based auth (for browser clients).
 * Throws 'Unauthorized' or 'Forbidden' on failure.
 *
 * @returns AdminAccessResult with role and optional seller schema info
 */
export async function requireAdminOrSellerApiWithRequest(request: NextRequest): Promise<AdminAccessResult> {
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
    console.warn(`[requireAdminOrSellerApiWithRequest] Unauthenticated API request at ${new Date().toISOString()}`);
    throw new Error('Unauthorized');
  }

  // Check platform admin first
  const platformClient = createPlatformClient();
  const { data: admin } = await platformClient
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (admin) {
    return { user, role: 'platform_admin' };
  }

  // Check seller owner
  const seller = await getSellerForUser(user.id);
  if (seller) {
    return {
      user,
      role: 'seller_admin',
      sellerSchema: seller.schema_name,
      sellerSlug: seller.slug,
      sellerDisplayName: seller.display_name,
    };
  }

  console.warn(`[requireAdminOrSellerApiWithRequest] Non-admin/non-seller access attempt by ${sanitizeForLog(user.email || 'unknown')} (${user.id}) at ${new Date().toISOString()}`);
  throw new Error('Forbidden');
}
