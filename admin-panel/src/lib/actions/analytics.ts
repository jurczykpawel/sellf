'use server'

import { withAdminOrSellerAuth } from '@/lib/actions/admin-auth'

export interface CurrencyAmount {
  [currency: string]: number
}

export interface RevenueStats {
  totalRevenue: CurrencyAmount
  todayRevenue: CurrencyAmount
  todayOrders: number
  lastOrderAt: string | null
}

export interface ChartDataPoint {
  date: string
  amount: CurrencyAmount
  orders: number
}

export async function getRevenueStats(productId?: string, goalStartDate?: Date): Promise<RevenueStats | null> {
  const result = await withAdminOrSellerAuth(async ({ dataClient }) => {
    const { data, error } = await (dataClient as any).rpc('get_detailed_revenue_stats', {
      p_product_id: productId || null,
      p_goal_start_date: goalStartDate ? goalStartDate.toISOString() : null
    })

    if (error) {
      console.error('Error fetching revenue stats:', error)
      return { success: true as const, data: null }
    }

    return { success: true as const, data: data as RevenueStats }
  })

  if (!result.success) return null
  return result.data ?? null
}

export async function getSalesChartData(days: number = 30, customStart?: Date, customEnd?: Date, productId?: string): Promise<ChartDataPoint[]> {
  const result = await withAdminOrSellerAuth(async ({ dataClient }) => {
    let startDate: Date
    let endDate: Date

    if (customStart && customEnd) {
      startDate = customStart
      endDate = customEnd
    } else {
      endDate = new Date()
      startDate = new Date()
      startDate.setDate(startDate.getDate() - days)
    }

    const { data, error } = await (dataClient as any).rpc('get_sales_chart_data', {
      p_start_date: startDate.toISOString(),
      p_end_date: endDate.toISOString(),
      p_product_id: productId || null
    })

    if (error) {
      console.error('Error fetching sales chart data:', error)
      return { success: true as const, data: [] as ChartDataPoint[] }
    }

    return {
      success: true as const,
      data: (data as any[]).map(item => ({
        date: item.date,
        amount: item.amount_by_currency as CurrencyAmount,
        orders: Number(item.orders)
      }))
    }
  })

  if (!result.success) return []
  return result.data!
}

export async function getHourlyRevenueStats(date?: string, productId?: string): Promise<{ hour: number, amount: CurrencyAmount, orders: number }[]> {
  const result = await withAdminOrSellerAuth(async ({ dataClient }) => {
    const targetDate = date ? new Date(date) : new Date()

    const { data, error } = await (dataClient as any).rpc('get_hourly_revenue_stats', {
      p_target_date: targetDate.toISOString().split('T')[0],
      p_product_id: productId || null
    })

    if (error) {
      console.error('Error fetching hourly revenue stats:', error)
      return { success: true as const, data: [] as { hour: number, amount: CurrencyAmount, orders: number }[] }
    }

    return {
      success: true as const,
      data: (data as any[]).map(item => ({
        hour: item.hour,
        amount: item.amount_by_currency as CurrencyAmount,
        orders: Number(item.orders)
      }))
    }
  })

  if (!result.success) return []
  return result.data!
}

export async function getRevenueGoal(productId?: string): Promise<{ amount: number, startDate: string, currency: string } | null> {
  const result = await withAdminOrSellerAuth(async ({ dataClient }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (dataClient as any).rpc('get_revenue_goal', {
      p_product_id: productId || null
    }) as { data: any[] | null; error: any }

    if (error) {
      console.error('Error fetching revenue goal:', error)
      return { success: true as const, data: null }
    }

    if (data && data.length > 0) {
      return {
        success: true as const,
        data: {
          amount: Number(data[0].goal_amount),
          startDate: data[0].start_date as string,
          currency: (data[0].currency as string) || 'USD'
        }
      }
    }

    return { success: true as const, data: null }
  })

  if (!result.success) return null
  return result.data ?? null
}

export async function setRevenueGoal(amount: number, startDate: string, currency: string, productId?: string): Promise<{ success: boolean; error?: string }> {
  const result = await withAdminOrSellerAuth(async ({ dataClient }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (dataClient as any).rpc('set_revenue_goal', {
      p_goal_amount: amount,
      p_start_date: startDate,
      p_currency: currency,
      p_product_id: productId || null,
    })

    if (error) {
      console.error('[setRevenueGoal] Error:', error)
    }

    return {
      success: true as const,
      data: error ? { ok: false, msg: 'Failed to set revenue goal' } : { ok: true, msg: '' },
    }
  })

  if (!result.success) return { success: false, error: 'Unauthorized' }
  return { success: result.data!.ok, error: result.data!.ok ? undefined : result.data!.msg }
}
