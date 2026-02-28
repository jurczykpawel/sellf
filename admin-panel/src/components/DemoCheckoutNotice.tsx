'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useConfig } from '@/components/providers/config-provider'

/**
 * Demo Mode Notice for Checkout pages
 *
 * Shows:
 * 1. Info banner with test card details
 * 2. Floating countdown to next hourly data reset
 */
export default function DemoCheckoutNotice() {
  const { demoMode } = useConfig()
  const t = useTranslations('demo')

  if (!demoMode) return null

  return (
    <div className="mb-4 rounded-lg border border-gf-warning/30 bg-gf-warning-soft px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gf-warning">
            {t('checkoutBanner')}
          </p>
          <p className="mt-1 text-gf-warning">
            {t('checkoutBannerDesc')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-gf-warning-soft px-2 py-0.5 font-mono text-xs text-gf-warning">
              {t('checkoutTestCardLabel')}: {t('checkoutTestCard')}
            </code>
            <span className="text-xs text-gf-warning">
              {t('checkoutTestCardDetails')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Floating demo reset countdown — shows time until next full-hour reset
 */
export function DemoResetCountdown() {
  const { demoMode } = useConfig()
  const t = useTranslations('demo')
  const [timeLeft, setTimeLeft] = useState('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!demoMode) return

    function update() {
      const now = new Date()
      const nextHour = new Date(now)
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0)
      const diffMs = nextHour.getTime() - now.getTime()
      const mins = Math.floor(diffMs / 60000)
      const secs = Math.floor((diffMs % 60000) / 1000)
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`)
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [demoMode])

  if (!demoMode || dismissed) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-gf-warning/30 bg-gf-warning-soft/95 backdrop-blur-sm px-3 py-1.5 text-xs shadow-lg">
      <span className="text-gf-warning">⏱</span>
      <span className="font-medium text-gf-warning">
        {t('resetCountdown', { time: timeLeft })}
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-1 text-gf-warning hover:opacity-80"
        aria-label={t('dismiss')}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
