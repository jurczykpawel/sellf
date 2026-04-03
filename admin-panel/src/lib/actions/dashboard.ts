'use server'

import { withAdminClient } from '@/lib/actions/admin-auth'

export async function getDashboardStats() {
  const result = await withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient.rpc('get_dashboard_stats')

    if (error) {
      console.error('Error fetching dashboard stats:', error)
      return { success: true as const, data: null }
    }

    return { success: true as const, data }
  })

  if (!result.success) return null
  return result.data
}

export async function getRecentActivity() {
  const result = await withAdminClient(async ({ dataClient }) => {
    // 1. Get recent access grants
    const { data: accessGrants } = await dataClient
      .from('user_product_access')
      .select(`
        id,
        created_at,
        user_id,
        product_id,
        products(name)
      `)
      .order('created_at', { ascending: false })
      .limit(10)

    // 2. Get user emails from restricted view using adminClient
    const userIds = [...new Set((accessGrants || []).map((g: any) => g.user_id))]
    const { data: users } = await dataClient
      .from('user_access_stats')
      .select('user_id, email')
      .in('user_id', userIds)

    const userEmailMap = new Map((users || []).map((u: any) => [u.user_id, u.email]))

    // 3. Get recent products
    const { data: recentProducts } = await dataClient
      .from('products')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    return {
      success: true as const,
      data: {
        accessGrants: (accessGrants || []).map((g: any) => ({
          ...g,
          user_email: userEmailMap.get(g.user_id) || g.user_id
        })),
        recentProducts: recentProducts || []
      }
    }
  })

  // Preserve original return shape: object on success, [] on auth failure
  if (!result.success) {
    return []
  }

  return result.data!
}
