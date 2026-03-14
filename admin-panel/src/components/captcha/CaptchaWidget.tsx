'use client'

import { useConfig } from '@/components/providers/config-provider'
import TurnstileWidget from '@/components/TurnstileWidget'
import AltchaWidget from './AltchaWidget'
import type { CaptchaProvider } from '@/lib/captcha/types'

interface CaptchaWidgetProps {
  onVerify: (token: string) => void
  onError?: () => void
  onTimeout?: () => void
  onBeforeInteractive?: () => void
  onAfterInteractive?: () => void
  /** Trigger a reset by incrementing this value */
  resetTrigger?: number
  /** Compact layout with smaller margins */
  compact?: boolean
}

/**
 * Unified captcha widget — auto-detects Turnstile vs ALTCHA vs none.
 *
 * Reads `captchaProvider` from runtime config (set by /api/runtime-config)
 * and renders the appropriate widget. Forms should use this instead of
 * importing TurnstileWidget or AltchaWidget directly.
 *
 * @see /src/components/providers/config-provider.tsx — AppConfig.captchaProvider
 * @see /src/lib/captcha/config.ts — server-side detection
 */
export default function CaptchaWidget({
  onVerify,
  onError,
  onTimeout,
  onBeforeInteractive,
  onAfterInteractive,
  resetTrigger,
  compact,
}: CaptchaWidgetProps) {
  const config = useConfig()
  const provider = config.captchaProvider as CaptchaProvider

  if (provider === 'turnstile') {
    return (
      <TurnstileWidget
        onVerify={onVerify}
        onError={onError}
        onTimeout={onTimeout}
        onBeforeInteractive={onBeforeInteractive}
        onAfterInteractive={onAfterInteractive}
        resetTrigger={resetTrigger}
        compact={compact}
      />
    )
  }

  if (provider === 'altcha') {
    return (
      <AltchaWidget
        onVerify={onVerify}
        onError={onError}
        onTimeout={onTimeout}
        resetTrigger={resetTrigger}
        compact={compact}
      />
    )
  }

  // provider === 'none' — no captcha configured
  if (process.env.NODE_ENV === 'development') {
    return (
      <div className="text-xs text-sf-muted opacity-50 text-center mb-2">
        No captcha provider configured
      </div>
    )
  }

  return null
}
