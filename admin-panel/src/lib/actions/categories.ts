'use server'

import { revalidatePath } from 'next/cache'
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard'
import { withAdminClient } from '@/lib/actions/admin-auth'

export interface Category {
  id: string
  name: string
  slug: string
  description?: string | null
  parent_id?: string | null
  created_at: string
}

export async function getCategories(): Promise<{ success: boolean; data?: Category[]; error?: string }> {
  return withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient
      .from('categories')
      .select('*')
      .order('name')

    if (error) {
      console.error('[getCategories] Error:', error)
      return { success: false, error: 'Failed to fetch categories' }
    }
    return { success: true, data: data as Category[] }
  })
}

export async function createCategory(data: { name: string; slug: string; description?: string }) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  return withAdminClient(async ({ dataClient }) => {
    const { error } = await dataClient
      .from('categories')
      .insert(data)

    if (error) {
      console.error('[createCategory] Error:', error)
      return { success: false, error: 'Failed to create category' }
    }
    revalidatePath('/dashboard/categories')
    return { success: true }
  })
}

export async function updateCategory(id: string, data: { name: string; slug: string; description?: string }) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  return withAdminClient(async ({ dataClient }) => {
    const { error } = await dataClient
      .from('categories')
      .update(data)
      .eq('id', id)

    if (error) {
      console.error('[updateCategory] Error:', error)
      return { success: false, error: 'Failed to update category' }
    }
    revalidatePath('/dashboard/categories')
    return { success: true }
  })
}

export async function deleteCategory(id: string) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  return withAdminClient(async ({ dataClient }) => {
    const { error } = await dataClient
      .from('categories')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('[deleteCategory] Error:', error)
      return { success: false, error: 'Failed to delete category' }
    }
    revalidatePath('/dashboard/categories')
    return { success: true }
  })
}

export async function getProductCategories(productId: string): Promise<{ success: boolean; data?: string[]; error?: string }> {
  return withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient
      .from('product_categories')
      .select('category_id')
      .eq('product_id', productId)

    if (error) {
      console.error('[getProductCategories] Error:', error)
      return { success: false, error: 'Failed to fetch product categories' }
    }
    return { success: true, data: data.map((row: any) => row.category_id) as string[] }
  })
}

export async function updateProductCategories(productId: string, categoryIds: string[]) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  return withAdminClient(async ({ dataClient }) => {
    // 1. Delete existing
    const { error: deleteError } = await dataClient
      .from('product_categories')
      .delete()
      .eq('product_id', productId)

    if (deleteError) {
      console.error('[updateProductCategories] Delete error:', deleteError)
      return { success: false, error: 'Failed to update product categories' }
    }

    // 2. Insert new (if any)
    if (categoryIds.length > 0) {
      const { error: insertError } = await dataClient
        .from('product_categories')
        .insert(categoryIds.map(catId => ({
          product_id: productId,
          category_id: catId
        })))

      if (insertError) {
        console.error('[updateProductCategories] Insert error:', insertError)
        return { success: false, error: 'Failed to update product categories' }
      }
    }

    revalidatePath('/dashboard/products')
    return { success: true }
  })
}
