'use client'

import { useEffect, useRef, useCallback, useId, useState } from 'react'
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
  resetTrigger = 0,
}: AltchaWidgetProps) {
  const formId = useId()
  const [status, setStatus] = useState({ attempt: resetTrigger, state: 'verifying' })
  const state = status.attempt === resetTrigger ? status.state : 'verifying'
  const widgetRef = useRef<HTMLElement>(null)
  const t = useTranslations('security')
  const importedRef = useRef(false)
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError }, [onError])

  // Dynamically import altcha (registers the web component)
  useEffect(() => {
    if (importedRef.current) return
    importedRef.current = true
    import('altcha').catch((err) => {
      console.error('[AltchaWidget] Failed to load altcha:', err)
      setStatus({ attempt: resetTrigger, state: 'error' })
      onError?.()
    })
  }, [onError, resetTrigger])

  // Listen for verification events from the web component
  const handleStateChange = useCallback(
    (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (detail?.state) setStatus({ attempt: resetTrigger, state: detail.state })
      if (detail?.state === 'verified' && detail?.payload) {
        onVerify(detail.payload)
      } else if (detail?.state === 'error') {
        onError?.()
      }
    },
    [onVerify, onError, resetTrigger],
  )

  useEffect(() => {
    const el = widgetRef.current
    if (!el) return

    el.addEventListener('statechange', handleStateChange)
    return () => {
      el.removeEventListener('statechange', handleStateChange)
    }
  }, [handleStateChange])

  // Handle external reset trigger. The widget is invisible and auto-verifies only on
  // load, so a reset must start a new verification itself; otherwise the form waits
  // on "Verifying…" forever (W146 B2).
  useEffect(() => {
    if (resetTrigger > 0) {
      const el = widgetRef.current as (HTMLElement & { reset?: () => void; verify?: () => Promise<unknown> }) | null
      try {
        el?.reset?.()
        el?.verify?.()?.catch(() => onErrorRef.current?.())
      } catch {
        onErrorRef.current?.()
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
    <>
      {/* React submits the payload; internal controls do not belong to the parent form. */}
      <altcha-widget
        form={formId}
        ref={widgetRef}
        challenge="/api/captcha/challenge"
        auto="onload"
        display="invisible"
        hidelogo
        hidefooter
        strings={strings}
      />
      {state !== 'verified' && (
        <p role={state === 'error' ? 'alert' : 'status'} className="text-sm text-sf-muted text-center">
          {t(state === 'error' ? 'securityVerificationFailed' : 'verifying')}
        </p>
      )}
    </>
  )
}
