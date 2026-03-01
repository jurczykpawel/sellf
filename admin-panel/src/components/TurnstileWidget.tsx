'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Turnstile, TurnstileInstance } from '@marsidev/react-turnstile'
import { useConfig } from '@/components/providers/config-provider'

// Cloudflare dummy sitekeys for testing
const DUMMY_SITEKEYS = {
  ALWAYS_PASSES_VISIBLE: '1x00000000000000000000AA',
  ALWAYS_BLOCKS_VISIBLE: '2x00000000000000000000AB', 
  ALWAYS_PASSES_INVISIBLE: '1x00000000000000000000BB',
  ALWAYS_BLOCKS_INVISIBLE: '2x00000000000000000000BB',
  INTERACTIVE_CHALLENGE: '3x00000000000000000000FF'
} as const

interface TurnstileWidgetProps {
  onVerify: (token: string) => void
  onError?: () => void
  onTimeout?: () => void
  onBeforeInteractive?: () => void
  onAfterInteractive?: () => void
  onReset?: () => void
  siteKey?: string
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact' | 'invisible'
  /** For development testing: choose dummy sitekey behavior */
  testMode?: keyof typeof DUMMY_SITEKEYS
  /** External reset trigger */
  resetTrigger?: number
  /** Compact layout with smaller margins */
  compact?: boolean
}

export default function TurnstileWidget({
  onVerify,
  onError,
  onTimeout,
  onBeforeInteractive,
  onAfterInteractive,
  onReset,
  siteKey,
  theme = 'dark',
  size = 'normal',
  resetTrigger = 0,
  compact = false
}: TurnstileWidgetProps) {
  const turnstileRef = useRef<TurnstileInstance>(null)
  const t = useTranslations('security')
  const config = useConfig()

  // Determine which sitekey to use
  const getSiteKey = () => {
    const isDevelopment = process.env.NODE_ENV === 'development'
    
    if (isDevelopment) {
      // Get testMode from env variable or prop, with fallback
      const envTestMode = process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE as keyof typeof DUMMY_SITEKEYS
      const effectiveTestMode = envTestMode || 'ALWAYS_PASSES_VISIBLE'
      
      // Validate the test mode
      if (effectiveTestMode in DUMMY_SITEKEYS) {
        return DUMMY_SITEKEYS[effectiveTestMode]
      } else {
        console.warn(`Invalid TURNSTILE_TEST_MODE: ${effectiveTestMode}. Using ALWAYS_PASSES_VISIBLE.`)
        return DUMMY_SITEKEYS.ALWAYS_PASSES_VISIBLE
      }
    } else {
      // Use provided sitekey or fallback to runtime config
      return siteKey || config.cloudflareSiteKey
    }
  }

  const effectiveSiteKey = getSiteKey()

  useEffect(() => {
    // Reset widget when component unmounts
    const currentRef = turnstileRef.current
    return () => {
      if (currentRef) {
        try {
          currentRef.reset()
        } catch {
          // Ignore reset errors during cleanup
        }
      }
    }
  }, [])

  // Handle external reset trigger
  useEffect(() => {
    if (resetTrigger > 0) {
      const currentRef = turnstileRef.current
      if (currentRef) {
        try {
          currentRef.reset()
          onReset?.()
        } catch (error) {
          console.warn('TurnstileWidget: Failed to reset widget:', error)
        }
      }
    }
  }, [resetTrigger, onReset])

  if (!effectiveSiteKey) {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-300">
        ⚠️ {t('turnstileNotConfigured')}
      </div>
    )
  }

  // Show development info when using dummy keys
  const dummyValues = Object.values(DUMMY_SITEKEYS) as string[]
  const isUsingDummyKey = process.env.NODE_ENV === 'development' && dummyValues.includes(effectiveSiteKey)

  const handleSuccess = (token: string) => {
    onVerify(token)
  }

  const handleError = () => {
    onError?.()
  }

  const handleExpire = () => {
    onError?.()
  }

  const handleTimeout = () => {
    onTimeout?.()
  }

  const handleBeforeInteractive = () => {
    onBeforeInteractive?.()
  }

  const handleAfterInteractive = () => {
    onAfterInteractive?.()
  }

  return (
    <div className={compact ? 'mb-2' : 'mb-4'}>
      <div className="flex justify-center">
        <Turnstile
          ref={turnstileRef}
          siteKey={effectiveSiteKey}
          options={{
            theme,
            size,
            retry: 'auto'
          }}
          onSuccess={handleSuccess}
          onError={handleError}
          onExpire={handleExpire}
          onTimeout={handleTimeout}
          onBeforeInteractive={handleBeforeInteractive}
          onAfterInteractive={handleAfterInteractive}
        />
      </div>
      
      {/* Minimal development info */}
      {isUsingDummyKey && (
        <div className="text-xs text-gf-muted mt-1 opacity-50 text-center">
          🧪 Test Mode
        </div>
      )}
    </div>
  )
}
