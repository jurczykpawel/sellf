'use client'

import { useTranslations } from 'next-intl'

import type { ConfigSource } from '@/lib/stripe/checkout-config'

interface SourceBadgeProps {
  source: ConfigSource
  envAlsoSet?: boolean
}

const STYLES: Record<ConfigSource, string> = {
  db: 'bg-gf-accent-soft text-gf-accent',
  env: 'bg-gf-accent-soft text-gf-accent',
  default: 'bg-gf-raised text-gf-muted',
}

export default function SourceBadge({ source, envAlsoSet }: SourceBadgeProps) {
  const t = useTranslations('settings.configSource')

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STYLES[source]}`}>
        {t(source)}
      </span>
      {source === 'db' && envAlsoSet && (
        <span className="text-[9px] text-gf-muted">
          ({t('overridesEnv')})
        </span>
      )}
    </span>
  )
}
