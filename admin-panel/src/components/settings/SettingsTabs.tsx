'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Store, CreditCard, FileText, Wrench } from 'lucide-react'
import { useTranslations } from 'next-intl'
import ShopSettings from './ShopSettings'
import BrandingSettings from './BrandingSettings'
import CheckoutThemeSettings from './CheckoutThemeSettings'
import StripeSettings from './StripeSettings'
import StripeTaxSettings from './StripeTaxSettings'
import PaymentMethodSettingsWrapper from './PaymentMethodSettingsWrapper'
import LegalDocumentsSettings from './LegalDocumentsSettings'
import OmnibusSettings from './OmnibusSettings'
import LicenseSettings from './LicenseSettings'
import LicenseKeysSettings from './LicenseKeysSettings'
import IssuedLicensesSettings from './IssuedLicensesSettings'
import SystemUpdateSettings from './SystemUpdateSettings'
import SecurityAuditSettings from './SecurityAuditSettings'
import { useConfig } from '@/components/providers/config-provider'
import { useAuth } from '@/contexts/AuthContext'

type TabId = 'shop' | 'payments' | 'legal' | 'system'

const TABS = [
  { id: 'shop' as TabId,        icon: Store,       labelKey: 'tabs.shop' },
  { id: 'payments' as TabId,    icon: CreditCard,  labelKey: 'tabs.payments' },
  { id: 'legal' as TabId,       icon: FileText,    labelKey: 'tabs.legal' },
  { id: 'system' as TabId,      icon: Wrench,      labelKey: 'tabs.system' },
]

interface SettingsTabsProps {
  siteUrl: string
  initialCheckoutTheme?: string | null
  hasLicenseIssuance?: boolean
}

export default function SettingsTabs({ siteUrl, initialCheckoutTheme, hasLicenseIssuance }: SettingsTabsProps) {
  const t = useTranslations('settings')
  const searchParams = useSearchParams()
  // useSearchParams resolves identically on server and client, so the initial tab matches SSR (no hydration mismatch).
  const [active, setActive] = useState<TabId>(
    searchParams.has('stripe_connected') || searchParams.has('connect_return') ? 'payments' : 'shop'
  )
  const { demoMode } = useConfig()
  const { role } = useAuth()

  return (
    <div>
      {/* Tab bar */}
      <div className="border-b-2 border-sf-border-medium mb-8">
        <nav className="flex -mb-[2px] overflow-x-auto">
          {TABS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                active === id
                  ? 'border-sf-accent text-sf-heading'
                  : 'border-transparent text-sf-muted hover:text-sf-body hover:border-sf-border-light'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {t(labelKey)}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="space-y-8">
        {active === 'shop' && (
          <>
            <ShopSettings />
            {role === 'platform_admin' && <BrandingSettings />}
            <CheckoutThemeSettings initialTheme={initialCheckoutTheme} />
          </>
        )}

        {active === 'payments' && (
          <>
            {role === 'platform_admin' && <StripeSettings siteUrl={siteUrl} />}
            {role === 'platform_admin' && <StripeTaxSettings />}
            {role === 'platform_admin' && <PaymentMethodSettingsWrapper />}
          </>
        )}

        {active === 'legal' && (
          <>
            <LegalDocumentsSettings />
            <OmnibusSettings />
          </>
        )}

        {active === 'system' && (
          <>
            <LicenseKeysSettings hasLicenseIssuance={hasLicenseIssuance} />
            {role === 'platform_admin' && !demoMode && <IssuedLicensesSettings enabled={Boolean(hasLicenseIssuance)} />}
            <LicenseSettings />
            {role === 'platform_admin' && <SystemUpdateSettings />}
            {role === 'platform_admin' && !demoMode && <SecurityAuditSettings />}
          </>
        )}
      </div>
    </div>
  )
}
