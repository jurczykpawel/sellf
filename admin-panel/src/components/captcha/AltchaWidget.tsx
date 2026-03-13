'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'

interface AltchaWidgetProps {
  onVerify: (payload: string) => void
  onError?: () => void
  onTimeout?: () => void
  /** Trigger a reset by incrementing this value */
  resetTrigger?: number
  /** Compact layout with smaller margins */
  compact?: boolean
}

/**
 * ALTCHA proof-of-work captcha widget
 *
 * Renders the <altcha-widget> web component which:
 * 1. Fetches a challenge from /api/captcha/challenge
 * 2. Brute-forces a proof-of-work solution client-side
 * 3. Fires 'verified' event with base64-encoded payload
 *
 * The payload is verified server-side via verifyCaptchaToken().
 *
 * @see /src/lib/captcha/verify.ts
 * @see /src/app/api/captcha/challenge/route.ts
 */
export default function AltchaWidget({
  onVerify,
  onError,
  onTimeout,
  resetTrigger = 0,
  compact = false,
}: AltchaWidgetProps) {
  const widgetRef = useRef<HTMLElement>(null)
  const t = useTranslations('security')
  const importedRef = useRef(false)

  // Dynamically import altcha (registers the web component)
  useEffect(() => {
    if (importedRef.current) return
    importedRef.current = true
    import('altcha').catch((err) => {
      console.error('[AltchaWidget] Failed to load altcha:', err)
    })
  }, [])

  // Listen for verification events from the web component
  const handleStateChange = useCallback(
    (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (detail?.state === 'verified' && detail?.payload) {
        onVerify(detail.payload)
      } else if (detail?.state === 'error') {
        onError?.()
      }
    },
    [onVerify, onError],
  )

  useEffect(() => {
    const el = widgetRef.current
    if (!el) return

    el.addEventListener('statechange', handleStateChange)
    return () => {
      el.removeEventListener('statechange', handleStateChange)
    }
  }, [handleStateChange])

  // Handle external reset trigger
  useEffect(() => {
    if (resetTrigger > 0) {
      const el = widgetRef.current as any
      if (el?.reset) {
        try {
          el.reset()
        } catch {
          // Ignore reset errors
        }
      }
    }
  }, [resetTrigger])

  const strings = JSON.stringify({
    label: t('captchaRequired'),
    verifying: t('verifying'),
    verified: t('captchaVerified'),
    error: t('securityVerificationFailed'),
    expired: t('verificationExpired'),
  })

  return (
    <div className={compact ? 'mb-2' : 'mb-4'}>
      <div className="flex justify-center">
        <altcha-widget
          ref={widgetRef}
          challengeurl="/api/captcha/challenge"
          hidelogo
          hidefooter
          strings={strings}
          style={{ maxWidth: '100%' }}
        />
      </div>
    </div>
  )
}
