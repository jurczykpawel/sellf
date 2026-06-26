'use server'

import { revalidatePath } from 'next/cache'
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard'
import { withAdminClient } from '@/lib/actions/admin-auth'
import { TagCreateDTO, TagUpdateDTO } from '@/lib/api/dto/tag'

export interface Tag {
  id: string
  name: string
  slug: string
  created_at: string
}

export async function getTags(): Promise<{ success: boolean; data?: Tag[]; error?: string }> {
  return withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient
      .from('tags')
      .select('*')
      .order('name')

    if (error) {
      console.error('[getTags] Error:', error)
      return { success: false, error: 'Failed to fetch tags' }
    }
    return { success: true, data: data as Tag[] }
  })
}

export async function createTag(data: { name: string; slug: string }) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  // Validate with the same Zod DTO as the public v1 /api/v1/tags route (slug regex,
  // trim, max length, .strict() rejects extra keys) and persist the PARSED object —
  // never spread the raw argument into .insert() (column-injection defense).
  const parsed = TagCreateDTO.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid tag data' }
  }
  return withAdminClient(async ({ dataClient }) => {
    const { error } = await dataClient
      .from('tags')
      .insert(parsed.data)

    if (error) {
      console.error('[createTag] Error:', error)
      return { success: false, error: 'Failed to create tag' }
    }
    revalidatePath('/dashboard/categories')
    return { success: true }
  })
}

export async function updateTag(id: string, data: { name: string; slug: string }) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  const parsed = TagUpdateDTO.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid tag data' }
  }
  return withAdminClient(async ({ dataClient }) => {
    const { error } = await dataClient
      .from('tags')
      .update(parsed.data)
      .eq('id', id)

    if (error) {
      console.error('[updateTag] Error:', error)
      return { success: false, error: 'Failed to update tag' }
    }
    revalidatePath('/dashboard/categories')
    return { success: true }
  })
}

export async function deleteTag(id: string) {
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR }
  return withAdminClient(async ({ dataClient }) => {
    const { error } = await dataClient
      .from('tags')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('[deleteTag] Error:', error)
      return { success: false, error: 'Failed to delete tag' }
    }
    revalidatePath('/dashboard/categories')
    return { success: true }
  })
}

// Reads the product_tags junction directly. The product form relies on this
// (not the single-GET ?embed=tags) so editing a product never wipes its tags.
export async function getProductTags(productId: string): Promise<{ success: boolean; data?: string[]; error?: string }> {
  return withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient
      .from('product_tags')
      .select('tag_id')
      .eq('product_id', productId)

    if (error) {
      console.error('[getProductTags] Error:', error)
      return { success: false, error: 'Failed to fetch product tags' }
    }
    return { success: true, data: data.map((row: { tag_id: string }) => row.tag_id) as string[] }
  })
}
