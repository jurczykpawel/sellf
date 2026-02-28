'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getRecentActivity } from '@/lib/actions/dashboard'

interface ActivityItem {
  id: string
  type: 'access_granted' | 'product_created' | 'user_registered'
  message: string
  timestamp: string
  user_email?: string
  product_name?: string
  icon: 'user' | 'product' | 'access'
  color: string
}

export default function RecentActivity() {
  const t = useTranslations('admin.dashboard');
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchActivity() {
      try {
        const data: any = await getRecentActivity()
        if (!data) {
          setActivities([])
          return
        }

        const activityItems: ActivityItem[] = []

        // Process access grants
        if (data.accessGrants) {
          data.accessGrants.forEach((grant: any) => {
            const productName = grant.products?.name || 'Unknown product'
            activityItems.push({
              id: `access_${grant.id}`,
              type: 'access_granted',
              message: t('recentActivity.accessGranted', { product: productName }),
              timestamp: grant.created_at,
              user_email: grant.user_email,
              product_name: productName,
              icon: 'access',
              color: 'green'
            })
          })
        }

        // Process new products
        if (data.recentProducts) {
          data.recentProducts.forEach((product: any) => {
            activityItems.push({
              id: `product_${product.id}`,
              type: 'product_created',
              message: t('recentActivity.productCreated', { product: product.name }),
              timestamp: product.created_at,
              product_name: product.name,
              icon: 'product',
              color: 'blue'
            })
          })
        }

        // Sort by timestamp and take latest 8
        activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        setActivities(activityItems.slice(0, 8))

      } catch (err) {
        console.error('Failed to fetch activity', err)
      } finally {
        setLoading(false)
      }
    }

    fetchActivity()
  }, [t])

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date()
    const past = new Date(timestamp)
    const diffMs = now.getTime() - past.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return t('recentActivity.timeJustNow')
    if (diffMins < 60) return t('recentActivity.timeMinutesAgo', { minutes: diffMins })
    if (diffHours < 24) return t('recentActivity.timeHoursAgo', { hours: diffHours })
    if (diffDays < 7) return t('recentActivity.timeDaysAgo', { days: diffDays })
    return past.toLocaleDateString()
  }

  const getIcon = (type: ActivityItem['icon']) => {
    switch (type) {
      case 'access':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        )
      case 'product':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        )
      case 'user':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        )
      default:
        return null
    }
  }

  const getColorClasses = (color: string) => {
    switch (color) {
      case 'green':
        return 'bg-gf-success-soft text-gf-success'
      case 'blue':
        return 'bg-gf-accent-soft text-gf-accent'
      case 'yellow':
        return 'bg-gf-warning-soft text-gf-warning'
      default:
        return 'bg-gf-raised text-gf-body'
    }
  }

  if (loading) {
    return (
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
        <h2 className="text-xl font-semibold text-gf-heading mb-4">
          {t('recentActivity.title')}
        </h2>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center space-x-3 animate-pulse">
              <div className="w-8 h-8 bg-gf-raised rounded-full"></div>
              <div className="flex-1">
                <div className="h-4 bg-gf-raised rounded w-3/4 mb-1"></div>
                <div className="h-3 bg-gf-raised rounded w-1/2"></div>
              </div>
              <div className="h-3 bg-gf-raised rounded w-16"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
      <h2 className="text-xl font-semibold text-gf-heading mb-4">
        {t('recentActivity.title')}
      </h2>
      <div className="space-y-3">
        {activities.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gf-muted mb-2">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm text-gf-muted">{t('recentActivity.noActivity')}</p>
          </div>
        ) : (
          activities.map((activity) => (
            <div key={activity.id} className="flex items-center space-x-3 group hover:bg-gf-hover rounded-lg p-2 -m-2 transition-colors">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getColorClasses(activity.color)}`}>
                {getIcon(activity.icon)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gf-heading truncate">
                  {activity.message}
                </p>
                {activity.user_email && (
                  <p className="text-xs text-gf-muted truncate">
                    {activity.user_email}
                  </p>
                )}
              </div>
              <span className="text-xs text-gf-muted flex-shrink-0">
                {formatTimeAgo(activity.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}