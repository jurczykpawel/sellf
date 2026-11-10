/**
 * User Access Management — internal API for admin panel UI
 *
 * Used by: AccessManagementModal component (session/cookie auth)
 * Data source: user_product_access_detailed view + user_product_access table
 *
 * NOT the same as /api/v1/users/:id/access which supports API key auth
 * with scopes, pagination, and standardized response format.
 *
 * Access: platform_admin only (via requireAdminApi)
 */

import { NextRequest, NextResponse } from 'next/server';
import { licenseMailKey } from '@/lib/license-keys/license-mail';
import { accessLicenseSchema, issueAccessLicense } from '@/lib/license-keys/access';
import { mutateAccess } from '@/lib/services/business-events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { requireAdminApi } from '@/lib/auth-server';
import { isDemoMode, DEMO_MODE_API_ERROR } from '@/lib/demo-guard';
import {
  validateGrantAccess,
  sanitizeGrantAccessData
} from '@/lib/validations/access';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';

// GET /api/users/[id]/access - Get user's product access
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createClient();

    // Verify admin access
    try {
      await requireAdminApi(supabase, request);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = createAdminClient();

    // Get user's product access using adminClient to access restricted view
    const { data: userAccess, error: accessError } = await adminClient
      .from('user_product_access_detailed')
      .select(`
        id,
        product_id,
        product_name,
        product_description,
        product_price,
        product_currency,
        product_is_active,
        access_created_at,
        access_granted_at,
        access_expires_at,
        access_duration_days,
        product_slug
      `)
      .eq('user_id', userId)
      .order('access_created_at', { ascending: false });

    if (accessError) {
      console.error('Error fetching user access:', accessError);
      return NextResponse.json({ error: 'Failed to fetch user access' }, { status: 500 });
    }

    const ids = (userAccess ?? []).map(access => access.id).filter((id): id is string => id !== null);
    const licenses = ids.length ? await adminClient.from('issued_licenses').select('access_grant_id,email,order_id').in('access_grant_id', ids).is('revoked_at', null) : { data: [], error: null };
    if (licenses.error) return NextResponse.json({ error: 'Failed to fetch access licenses' }, { status: 500 });
    const pending = ids.length ? await adminClient.from('user_product_access').select('id,license_requested').in('id', ids) : { data: [], error: null };
    if (pending.error) return NextResponse.json({ error: 'Failed to fetch pending licenses' }, { status: 500 });
    const keys = (licenses.data ?? []).flatMap(license => license.email ? [licenseMailKey(license.email, license.order_id)] : []);
    const receipts = keys.length ? await adminClient.from('license_mail_receipts').select('mail_key').in('mail_key', keys) : { data: [], error: null };
    const retries = keys.length ? await adminClient.from('auth_mail_retries').select('license_mail_key').in('license_mail_key', keys) : { data: [], error: null };
    if (receipts.error || retries.error) return NextResponse.json({ error: 'Failed to fetch license email state' }, { status: 500 });
    const delivered = new Set((receipts.data ?? []).map(receipt => receipt.mail_key));
    const awaitingMail = new Set((retries.data ?? []).map(retry => retry.license_mail_key));
    const sent = new Set((licenses.data ?? []).filter(license => {
      if (!license.email) return false;
      const key = licenseMailKey(license.email, license.order_id);
      return delivered.has(key) && !awaitingMail.has(key);
    }).map(license => license.access_grant_id));
    const requested = new Set((pending.data ?? []).filter(access => access.license_requested).map(access => access.id));
    const linked = new Set((licenses.data ?? []).map(license => license.access_grant_id));
    return NextResponse.json({
      user_id: userId,
      access: (userAccess ?? []).map(access => ({ ...access, has_grant_license: linked.has(access.id), license_pending: requested.has(access.id ?? '') && !sent.has(access.id) }))
    });
  } catch (error) {
    console.error('Error in GET /api/users/[id]/access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/users/[id]/access - Grant user access to a product
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createClient();

    // Verify admin access
    let authResult;
    try {
      authResult = await requireAdminApi(supabase, request);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const adminUser = authResult.user;

    if (isDemoMode()) {
      return NextResponse.json(DEMO_MODE_API_ERROR, { status: 403 });
    }

    const body = await readJsonBody<Record<string, unknown>>(request);
    const adminClient = createAdminClient();

    // Sanitize input data
    const options = accessLicenseSchema.safeParse(body);
    if (!options.success) return NextResponse.json({ error: 'Invalid license options' }, { status: 400 });
    const sanitizedData = sanitizeGrantAccessData(body);

    // Validate input data
    const validation = validateGrantAccess(sanitizedData);
    if (!validation.isValid) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: validation.errors 
      }, { status: 400 });
    }

    // Validate request body
    const productId = sanitizedData.product_id as string;
    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    // Check if product exists using adminClient
    const { data: product, error: productError } = await adminClient
      .from('products')
      .select('id, name, is_active, issue_license_on_purchase')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (!product.is_active) {
      return NextResponse.json({ error: 'Cannot grant access to inactive product' }, { status: 400 });
    }

    const issueLicense = product.issue_license_on_purchase && options.data.issue_license;

    // Check if user already has access using adminClient
    const { data: existingAccess, error: existingError } = await adminClient
      .from('user_product_access')
      .select('*')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (existingError && existingError.code !== 'PGRST116') {
      console.error('Error checking existing access:', existingError);
      return NextResponse.json({ error: 'Failed to check existing access' }, { status: 500 });
    }

    if (existingAccess && !(issueLicense && existingAccess.license_requested)) {
      return NextResponse.json({ error: 'User already has access to this product' }, { status: 409 });
    }

    // Grant access using adminClient
    const accessData: any = {
      user_id: userId,
      product_id: sanitizedData.product_id as string,
      created_at: new Date().toISOString()
    };

    if (sanitizedData.access_duration_days) {
      accessData.access_duration_days = sanitizedData.access_duration_days as number;
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + (sanitizedData.access_duration_days as number));
      accessData.access_expires_at = expirationDate.toISOString();
    } else if (sanitizedData.access_expires_at) {
      accessData.access_expires_at = sanitizedData.access_expires_at as string;
    }

    const { data: newAccess, error: accessError } = existingAccess ? { data: existingAccess, error: null } : await mutateAccess(adminClient, 'grant', userId, { type: 'user', id: adminUser.id },
      { access_duration_days: accessData.access_duration_days ?? null, access_expires_at: accessData.access_expires_at ?? null, issue_license: issueLicense }, undefined, productId).single();

    if (accessError) {
      console.error('Error granting access:', accessError);
      return NextResponse.json({ error: 'Failed to grant access' }, { status: 500 });
    }

    // Audit log: admin granted access (audit_log is in public schema)
    const platformClient = createPlatformClient();
    await platformClient.from('audit_log').insert({
      table_name: 'user_product_access',
      operation: 'INSERT',
      performed_by: adminUser.id,
      user_id: userId,
      new_values: { product_id: productId, product_name: product.name, action: 'admin_grant_access' },
    }).then(() => {}, (err: unknown) => console.error('[audit] Failed to log grant:', err));

    let license = null;
    if (issueLicense) {
      const issued = await issueAccessLicense(adminClient, {
        userId, productId, accessId: newAccess.id, actorUserId: adminUser.id,
        source: 'manual', origin: new URL(request.url).origin, license: options.data.license,
      });
      if (!issued.ok) return NextResponse.json({ error: issued.error, error_code: 'LICENSE_ISSUANCE_FAILED', access: newAccess, fieldErrors: issued.fieldErrors }, { status: issued.status });
      license = { id: issued.license.id, status: 'issued', email_sent: issued.license.emailSent };
    }

    return NextResponse.json({
      message: 'Access granted successfully',
      license,
      access: newAccess
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    console.error('Error in POST /api/users/[id]/access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/users/[id]/access - Remove user's access to a product
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createClient();

    // Verify admin access
    let authResult;
    try {
      authResult = await requireAdminApi(supabase, request);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const adminUser = authResult.user;

    if (isDemoMode()) {
      return NextResponse.json(DEMO_MODE_API_ERROR, { status: 403 });
    }

    const adminClient = createAdminClient();
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('product_id');

    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    // Check if access exists using adminClient
    const { data: existingAccess, error: existingError } = await adminClient
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (existingError || !existingAccess) {
      return NextResponse.json({ error: 'Access not found' }, { status: 404 });
    }

    const revokeValue = searchParams.get('revoke_license');
    if (revokeValue !== null && revokeValue !== 'true' && revokeValue !== 'false') {
      return NextResponse.json({ error: 'Invalid revoke_license' }, { status: 400 });
    }
    // Remove access using adminClient
    const { error: deleteError } = await mutateAccess(adminClient, 'revoke', userId, { type: 'user', id: adminUser.id }, { revoke_license: revokeValue !== 'false' }, existingAccess.id);

    if (deleteError) {
      console.error('Error removing access:', deleteError);
      return NextResponse.json({ error: 'Failed to remove access' }, { status: 500 });
    }

    // Audit log: admin revoked access (audit_log is in public schema)
    const platformClient = createPlatformClient();
    await platformClient.from('audit_log').insert({
      table_name: 'user_product_access',
      operation: 'DELETE',
      performed_by: adminUser.id,
      user_id: userId,
      old_values: { product_id: productId, action: 'admin_revoke_access' },
    }).then(() => {}, (err: unknown) => console.error('[audit] Failed to log revoke:', err));

    return NextResponse.json({
      message: 'Access removed successfully'
    });
  } catch (error) {
    console.error('Error in DELETE /api/users/[id]/access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}