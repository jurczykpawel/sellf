import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminApi } from '@/lib/auth-server';

/**
 * Variant Groups API (M:N relationship)
 *
 * Uses new schema with:
 * - variant_groups table (stores group metadata)
 * - product_variant_groups junction table (links products to groups)
 */

interface ProductInGroup {
  id: string;
  product_id: string;
  group_id: string;
  variant_name: string | null;
  display_order: number;
  is_featured: boolean;
  created_at: string;
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    currency: string;
    icon: string | null;
    is_active: boolean;
  };
}

interface VariantGroupWithProducts {
  id: string;
  name: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
  products: ProductInGroup[];
}

/**
 * Get all variant groups with their products
 * GET /api/admin/variant-groups
 */
export async function GET() {
  try {
    const supabase = await createClient();
    await requireAdminApi(supabase);

    // Use admin client (seller_main schema) for FK embedding support
    const adminClient = createAdminClient();

    // Get all variant groups
    const { data: groups, error: groupsError } = await adminClient
      .from('variant_groups')
      .select('id, name, slug, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (groupsError) {
      console.error('Error fetching variant groups:', groupsError);
      return NextResponse.json(
        { error: 'Failed to fetch variant groups' },
        { status: 500 }
      );
    }

    // Get all product-group relationships with product details
    const { data: productGroups, error: pgError } = await adminClient
      .from('product_variant_groups')
      .select(`
        id,
        product_id,
        group_id,
        variant_name,
        display_order,
        is_featured,
        created_at,
        products:product_id (
          id,
          name,
          slug,
          price,
          currency,
          icon,
          is_active
        )
      `)
      .order('display_order', { ascending: true });

    if (pgError) {
      console.error('Error fetching product variant groups:', pgError);
      return NextResponse.json(
        { error: 'Failed to fetch product variant groups' },
        { status: 500 }
      );
    }

    // Build response with products nested under groups
    const groupsWithProducts: VariantGroupWithProducts[] = (groups || []).map(group => ({
      ...group,
      products: (productGroups || [])
        .filter(pg => pg.group_id === group.id)
        .map(pg => ({
          id: pg.id,
          product_id: pg.product_id,
          group_id: pg.group_id,
          variant_name: pg.variant_name,
          display_order: pg.display_order,
          is_featured: pg.is_featured,
          created_at: pg.created_at,
          product: pg.products as unknown as ProductInGroup['product']
        }))
        .sort((a, b) => a.display_order - b.display_order)
    }));

    return NextResponse.json({ groups: groupsWithProducts });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error fetching variant groups:', error);
    return NextResponse.json(
      { error: 'Failed to fetch variant groups' },
      { status: 500 }
    );
  }
}

/**
 * Create a new variant group
 * POST /api/admin/variant-groups
 * Body: { name?: string, products: Array<{ product_id: string, variant_name?: string, is_featured?: boolean }> }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    await requireAdminApi(supabase);

    const body = await request.json();
    const { name, slug, products } = body as {
      name?: string;
      slug?: string;
      products: Array<{
        product_id: string;
        variant_name?: string;
        is_featured?: boolean;
      }>;
    };

    if (!products || products.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 products are required to create a variant group' },
        { status: 400 }
      );
    }

    // Validate slug format if provided
    if (slug && !/^[a-z0-9_-]+$/.test(slug)) {
      return NextResponse.json(
        { error: 'Slug must contain only lowercase letters, numbers, hyphens, and underscores' },
        { status: 400 }
      );
    }

    // Create the variant group
    const { data: newGroup, error: groupError } = await supabase
      .from('variant_groups')
      .insert({ name: name || null, slug: slug || null })
      .select('id, slug')
      .single();

    if (groupError || !newGroup) {
      console.error('Error creating variant group:', groupError);
      // Check for unique constraint violation (duplicate slug)
      if (groupError?.code === '23505') {
        return NextResponse.json(
          { error: 'Slug already exists' },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to create variant group' },
        { status: 500 }
      );
    }

    // Add products to the group
    const productGroupEntries = products.map((p, index) => ({
      product_id: p.product_id,
      group_id: newGroup.id,
      variant_name: p.variant_name || null,
      display_order: index,
      is_featured: p.is_featured || false
    }));

    const { error: pgError } = await supabase
      .from('product_variant_groups')
      .insert(productGroupEntries);

    if (pgError) {
      // Rollback: delete the group
      await supabase.from('variant_groups').delete().eq('id', newGroup.id);
      console.error('Error adding products to group:', pgError);
      return NextResponse.json(
        { error: 'Failed to add products to variant group' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      groupId: newGroup.id,
      slug: newGroup.slug,
      message: `Variant group created with ${products.length} products`
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error creating variant group:', error);
    return NextResponse.json(
      { error: 'Failed to create variant group' },
      { status: 500 }
    );
  }
}

/**
 * Update a variant group
 * PATCH /api/admin/variant-groups?groupId=xxx
 * Body: { name?: string, products?: Array<{ product_id: string, variant_name?: string, display_order: number, is_featured?: boolean }> }
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    await requireAdminApi(supabase);

    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get('groupId');

    if (!groupId) {
      return NextResponse.json(
        { error: 'groupId is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, slug, products } = body as {
      name?: string;
      slug?: string;
      products?: Array<{
        product_id: string;
        variant_name?: string;
        display_order: number;
        is_featured?: boolean;
      }>;
    };

    // Validate slug format if provided
    if (slug !== undefined && slug && !/^[a-z0-9_-]+$/.test(slug)) {
      return NextResponse.json(
        { error: 'Slug must contain only lowercase letters, numbers, hyphens, and underscores' },
        { status: 400 }
      );
    }

    // Update group name and/or slug if provided
    if (name !== undefined || slug !== undefined) {
      const updates: { name?: string | null; slug?: string | null } = {};
      if (name !== undefined) updates.name = name || null;
      if (slug !== undefined) updates.slug = slug || null;

      const { error: updateError } = await supabase
        .from('variant_groups')
        .update(updates)
        .eq('id', groupId);

      if (updateError) {
        console.error('Error updating group:', updateError);
        return NextResponse.json(
          { error: updateError.code === '23505' ? 'Slug already exists' : 'Failed to update group' },
          { status: updateError.code === '23505' ? 400 : 500 }
        );
      }
    }

    // Update products if provided
    if (products && products.length > 0) {
      // Delete existing product-group relationships
      const { error: deleteError } = await supabase
        .from('product_variant_groups')
        .delete()
        .eq('group_id', groupId);

      if (deleteError) {
        console.error('Error deleting old product relationships:', deleteError);
        return NextResponse.json(
          { error: 'Failed to update products' },
          { status: 500 }
        );
      }

      // Insert new relationships
      const productGroupEntries = products.map((p, index) => ({
        product_id: p.product_id,
        group_id: groupId,
        variant_name: p.variant_name || null,
        display_order: p.display_order ?? index,
        is_featured: p.is_featured || false
      }));

      const { error: insertError } = await supabase
        .from('product_variant_groups')
        .insert(productGroupEntries);

      if (insertError) {
        console.error('Error inserting new product relationships:', insertError);
        return NextResponse.json(
          { error: 'Failed to update products' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Variant group updated'
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error updating variant group:', error);
    return NextResponse.json(
      { error: 'Failed to update variant group' },
      { status: 500 }
    );
  }
}

/**
 * Delete a variant group
 * DELETE /api/admin/variant-groups?groupId=xxx
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    await requireAdminApi(supabase);

    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get('groupId');

    if (!groupId) {
      return NextResponse.json(
        { error: 'groupId is required' },
        { status: 400 }
      );
    }

    // Delete the group (cascade will delete product_variant_groups entries)
    const { error } = await supabase
      .from('variant_groups')
      .delete()
      .eq('id', groupId);

    if (error) {
      console.error('Error deleting variant group:', error);
      return NextResponse.json(
        { error: 'Failed to delete variant group' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Variant group deleted'
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error deleting variant group:', error);
    return NextResponse.json(
      { error: 'Failed to delete variant group' },
      { status: 500 }
    );
  }
}
