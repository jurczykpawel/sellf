'use server'

import { createClient } from '@/lib/supabase/server'

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
  const supabase = await createClient()
  
  const { data, error } = await supabase.rpc('get_detailed_revenue_stats', {
    p_product_id: productId || null,
    p_goal_start_date: goalStartDate ? goalStartDate.toISOString() : null
  })
  
  if (error) {
    console.error('Error fetching revenue stats:', error)
    return null
  }
  
  return data as RevenueStats
}

export async function getSalesChartData(days: number = 30, customStart?: Date, customEnd?: Date, productId?: string): Promise<ChartDataPoint[]> {
  const supabase = await createClient()

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

  const { data, error } = await supabase.rpc('get_sales_chart_data', {
    p_start_date: startDate.toISOString(),
    p_end_date: endDate.toISOString(),
    p_product_id: productId || null
  })

  if (error) {
    console.error('Error fetching sales chart data:', error)
    return []
  }

  return (data as any[]).map(item => ({
    date: item.date,
    amount: item.amount_by_currency as CurrencyAmount,
    orders: Number(item.orders)
  }))
}

export async function getHourlyRevenueStats(date?: string, productId?: string): Promise<{ hour: number, amount: CurrencyAmount, orders: number }[]> {
  const supabase = await createClient()

  const targetDate = date ? new Date(date) : new Date()

  const { data, error } = await supabase.rpc('get_hourly_revenue_stats', {
    p_target_date: targetDate.toISOString().split('T')[0], // Send YYYY-MM-DD
    p_product_id: productId || null
  })

  if (error) {
    console.error('Error fetching hourly revenue stats:', error)
    return []
  }

  return (data as any[]).map(item => ({
    hour: item.hour,
    amount: item.amount_by_currency as CurrencyAmount,
    orders: Number(item.orders)
  }))
}

export async function getRevenueGoal(productId?: string): Promise<{ amount: number, startDate: string, currency: string } | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_revenue_goal', {
    p_product_id: productId || null
  })

  if (error) {
    console.error('Error fetching revenue goal:', error)
    return null
  }

  if (data && data.length > 0) {
    return {
      amount: Number(data[0].goal_amount),
      startDate: data[0].start_date,
      currency: data[0].currency || 'USD'
    }
  }

  return null
}

export async function setRevenueGoal(amount: number, startDate: string, currency: string, productId?: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase.rpc('set_revenue_goal', {
    p_goal_amount: amount,
    p_start_date: startDate,
    p_currency: currency,
    p_product_id: productId || null
  })

  if (error) {
    console.error('[setRevenueGoal] Error:', error)
    return { success: false, error: 'Failed to set revenue goal' }
  }

  return { success: true }
}
