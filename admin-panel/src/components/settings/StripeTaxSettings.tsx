'use client'

import { useState, useEffect } from 'react'
import {
 Receipt,
 ExternalLink,
 CheckCircle2,
 AlertCircle,
 Info,
} from 'lucide-react'
import { getStripeTaxStatus, getCheckoutConfigAction } from '@/lib/actions/stripe-tax'
import type { StripeTaxStatus } from '@/lib/actions/stripe-tax'
import type { ConfigSource } from '@/lib/stripe/checkout-config'
import { getShopConfig, updateShopConfig } from '@/lib/actions/shop-config'
import type { TaxMode } from '@/lib/actions/shop-config'
import { useToast } from '@/contexts/ToastContext'
import { useTranslations } from 'next-intl'
import SourceBadge from '@/components/ui/SourceBadge'

const COUNTRY_NAMES: Record<string, string> = {
 US: 'United States', GB: 'United Kingdom', DE: 'Germany', FR: 'France',
 PL: 'Poland', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', SE: 'Sweden',
 NO: 'Norway', DK: 'Denmark', FI: 'Finland', BE: 'Belgium', AT: 'Austria',
 CH: 'Switzerland', IE: 'Ireland', PT: 'Portugal', CZ: 'Czech Republic',
 RO: 'Romania', HU: 'Hungary', BG: 'Bulgaria', HR: 'Croatia', SK: 'Slovakia',
 SI: 'Slovenia', LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', MT: 'Malta',
 CY: 'Cyprus', LU: 'Luxembourg', GR: 'Greece', AU: 'Australia', NZ: 'New Zealand',
 CA: 'Canada', JP: 'Japan', SG: 'Singapore', KR: 'South Korea', IN: 'India',
 MX: 'Mexico', BR: 'Brazil', ZA: 'South Africa',
}

function getCountryFlag(code: string): string {
 return code
 .toUpperCase()
 .split('')
 .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
 .join('')
}

function getCountryName(code: string): string {
 return COUNTRY_NAMES[code.toUpperCase()] || code.toUpperCase()
}

const DASHBOARD_LINKS = [
 { key: 'taxSettings', url: 'https://dashboard.stripe.com/settings/tax' },
 { key: 'taxRegistrations', url: 'https://dashboard.stripe.com/tax/registrations' },
 { key: 'taxReports', url: 'https://dashboard.stripe.com/tax/reporting' },
] as const

function Toggle({
 enabled,
 onChange,
 disabled,
 label,
}: {
 enabled: boolean
 onChange: (value: boolean) => void
 disabled: boolean
 label: string
}) {
 return (
 <button
 type="button"
 role="switch"
 aria-checked={enabled}
 aria-label={label}
 onClick={() => onChange(!enabled)}
 disabled={disabled}
 className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sf-accent focus:ring-offset-2 focus:ring-offset-sf-base ${
 disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
 } ${enabled ? 'bg-sf-accent-bg' : 'bg-sf-raised'}`}
 >
 <span
 className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
 enabled ? 'translate-x-5' : 'translate-x-0'
 }`}
 />
 </button>
 )
}

export default function StripeTaxSettings() {
 const t = useTranslations('settings.stripeTax')
 const { addToast } = useToast()
 const [loading, setLoading] = useState(true)
 const [taxStatus, setTaxStatus] = useState<StripeTaxStatus | null>(null)
 const [error, setError] = useState<string | null>(null)

 // Tax mode state
 const [taxMode, setTaxMode] = useState<TaxMode>('stripe_tax')
 const [defaultVatRate, setDefaultVatRate] = useState('')

 // Toggle state
 const [taxIdCollection, setTaxIdCollection] = useState(true)
 const [billingAddress, setBillingAddress] = useState<'auto' | 'required'>('auto')
 const [expiresHours, setExpiresHours] = useState(24)
 const [collectTerms, setCollectTerms] = useState(false)
 const [sources, setSources] = useState({
 automatic_tax: 'default' as ConfigSource,
 tax_id_collection: 'default' as ConfigSource,
 billing_address_collection: 'default' as ConfigSource,
 expires_hours: 'default' as ConfigSource,
 collect_terms: 'default' as ConfigSource,
 })
 const [envExists, setEnvExists] = useState({
 automatic_tax: false,
 tax_id_collection: false,
 billing_address_collection: false,
 expires_hours: false,
 collect_terms: false,
 })
 const [saving, setSaving] = useState(false)

 useEffect(() => {
 const load = async () => {
 setLoading(true)
 try {
 const [statusResult, configResult, shopConfig] = await Promise.all([
 getStripeTaxStatus(),
 getCheckoutConfigAction(),
 getShopConfig(),
 ])

 if (statusResult.success && statusResult.data) {
 setTaxStatus(statusResult.data)
 } else {
 setError(statusResult.error || t('unknownError'))
 }

 if (configResult.success && configResult.data) {
 setTaxMode(configResult.data.tax_mode)
 setTaxIdCollection(configResult.data.tax_id_collection.enabled)
 setBillingAddress(configResult.data.billing_address_collection)
 setExpiresHours(configResult.data.expires_hours)
 setCollectTerms(configResult.data.collect_terms_of_service)
 setSources({
 automatic_tax: configResult.data.sources.automatic_tax,
 tax_id_collection: configResult.data.sources.tax_id_collection,
 billing_address_collection: configResult.data.sources.billing_address_collection,
 expires_hours: configResult.data.sources.expires_hours,
 collect_terms: configResult.data.sources.collect_terms,
 })
 setEnvExists({
 automatic_tax: configResult.data.envExists.automatic_tax,
 tax_id_collection: configResult.data.envExists.tax_id_collection,
 billing_address_collection: configResult.data.envExists.billing_address_collection,
 expires_hours: configResult.data.envExists.expires_hours,
 collect_terms: configResult.data.envExists.collect_terms,
 })
 }

 if (shopConfig) {
 setDefaultVatRate(
 shopConfig.tax_rate != null
 ? Math.round(shopConfig.tax_rate * 100).toString()
 : ''
 )
 }
 } catch {
 setError(t('loadError'))
 } finally {
 setLoading(false)
 }
 }
 load()
 }, [])

 const handleTaxModeChange = async (mode: TaxMode) => {
 setSaving(true)
 try {
 const success = await updateShopConfig({ tax_mode: mode })
 if (success) {
 setTaxMode(mode)
 setSources((s) => ({ ...s, automatic_tax: 'db' }))
 addToast(t('saveSuccess'), 'success')
 } else {
 addToast(t('saveError'), 'error')
 }
 } catch {
 addToast(t('saveError'), 'error')
 } finally {
 setSaving(false)
 }
 }

 const handleDefaultVatRate = async () => {
 const parsed = defaultVatRate ? parseFloat(defaultVatRate) / 100 : null
 setSaving(true)
 try {
 const success = await updateShopConfig({ tax_rate: parsed })
 if (success) {
 addToast(t('saveSuccess'), 'success')
 } else {
 addToast(t('saveError'), 'error')
 }
 } catch {
 addToast(t('saveError'), 'error')
 } finally {
 setSaving(false)
 }
 }

 const handleToggle = async (
 field: 'tax_id_collection_enabled' | 'checkout_collect_terms',
 value: boolean,
 ) => {
 setSaving(true)
 try {
 const success = await updateShopConfig({ [field]: value })
 if (success) {
 if (field === 'tax_id_collection_enabled') {
 setTaxIdCollection(value)
 setSources((s) => ({ ...s, tax_id_collection: 'db' }))
 } else {
 setCollectTerms(value)
 setSources((s) => ({ ...s, collect_terms: 'db' }))
 }
 addToast(t('saveSuccess'), 'success')
 } else {
 addToast(t('saveError'), 'error')
 }
 } catch {
 addToast(t('saveError'), 'error')
 } finally {
 setSaving(false)
 }
 }

 const handleBillingAddress = async (value: 'auto' | 'required') => {
 setSaving(true)
 try {
 const success = await updateShopConfig({ checkout_billing_address: value })
 if (success) {
 setBillingAddress(value)
 setSources((s) => ({ ...s, billing_address_collection: 'db' }))
 addToast(t('saveSuccess'), 'success')
 } else {
 addToast(t('saveError'), 'error')
 }
 } catch {
 addToast(t('saveError'), 'error')
 } finally {
 setSaving(false)
 }
 }

 const handleExpiresHours = async (value: number) => {
 const clamped = Math.min(168, Math.max(1, value))
 setSaving(true)
 try {
 const success = await updateShopConfig({ checkout_expires_hours: clamped })
 if (success) {
 setExpiresHours(clamped)
 setSources((s) => ({ ...s, expires_hours: 'db' }))
 addToast(t('saveSuccess'), 'success')
 } else {
 addToast(t('saveError'), 'error')
 }
 } catch {
 addToast(t('saveError'), 'error')
 } finally {
 setSaving(false)
 }
 }

 if (loading) {
 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-sf-raised w-1/4"></div>
 <div className="h-20 bg-sf-raised"></div>
 </div>
 </div>
 )
 }

 const isLocalMode = taxMode === 'local'
 const stripeTaxIsActive = taxStatus?.status === 'active'

 return (
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="flex items-start justify-between mb-6">
 <div>
 <h2 className="text-xl font-semibold text-sf-heading mb-2">
 {t('title')}
 </h2>
 <p className="text-sm text-sf-body">
 {t('subtitle')}
 </p>
 </div>
 <Receipt className="w-8 h-8 text-sf-accent" />
 </div>

 {/* Error Banner */}
 {error && (
 <div className="mb-6 bg-sf-danger-soft border border-sf-danger/20 p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-sf-danger mt-0.5 flex-shrink-0" />
 <p className="text-sm text-sf-danger">{error}</p>
 </div>
 </div>
 )}

 {/* Tax Mode Selector */}
 <div className="mb-6">
 <div className="mb-2">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('taxMode.label')}
 </p>
 <p className="text-xs text-sf-muted">
 {t('taxMode.description')}
 </p>
 </div>
 <div className="flex gap-1 mt-3">
 {(['local', 'stripe_tax'] as const).map((mode) => (
 <button
 key={mode}
 onClick={() => handleTaxModeChange(mode)}
 disabled={saving}
 className={`px-4 py-2 text-sm font-medium transition-colors ${
 taxMode === mode
 ? 'bg-sf-accent-bg text-white'
 : 'bg-sf-raised text-sf-body hover:bg-sf-hover'
 } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
 >
 {t(`taxMode.${mode === 'local' ? 'local' : 'stripeTax'}`)}
 </button>
 ))}
 </div>
 <p className="text-xs text-sf-muted mt-2">
 {isLocalMode ? t('taxMode.localDescription') : t('taxMode.stripeTaxDescription')}
 </p>
 </div>

 {/* Local mode: Default VAT Rate input + warnings */}
 {isLocalMode && (
 <div className="mb-6 p-4 bg-sf-raised border border-sf-border">
 <label htmlFor="default-vat-rate" className="block text-sm font-medium text-sf-heading mb-1">
 {t('taxMode.vatRateLabel')}
 </label>
 <p className="text-xs text-sf-muted mb-3">
 {t('taxMode.vatRateHelp')}
 </p>
 <div className="flex items-center gap-2 mb-3">
 <input
 id="default-vat-rate"
 type="number"
 step="1"
 min="0"
 max="100"
 value={defaultVatRate}
 onChange={(e) => setDefaultVatRate(e.target.value)}
 onBlur={handleDefaultVatRate}
 disabled={saving}
 className={`w-24 px-3 py-1.5 text-sm border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent ${
 saving ? 'opacity-50 cursor-not-allowed' : ''
 }`}
 placeholder={t('taxMode.vatRatePlaceholder')}
 />
 <span className="text-sm text-sf-muted">%</span>
 </div>

 {/* No rate warning */}
 {(!defaultVatRate || defaultVatRate === '0') && (
 <div className="flex items-start gap-2 p-2 bg-sf-warning-soft border border-sf-warning/20">
 <AlertCircle className="w-4 h-4 text-sf-warning mt-0.5 flex-shrink-0" />
 <p className="text-xs text-sf-warning">{t('taxMode.noRateWarning')}</p>
 </div>
 )}

 {/* Stripe Tax active but not used warning */}
 {stripeTaxIsActive && (
 <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800 mt-2">
 <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
 <p className="text-xs text-amber-700 dark:text-amber-300">{t('taxMode.stripeTaxActiveWarning')}</p>
 </div>
 )}
 </div>
 )}

 {/* Stripe Tax mode: show status, registrations, head office */}
 {!isLocalMode && taxStatus && (
 <>
 {taxStatus.status === 'active' && (
 <div className="mb-6 bg-sf-success-soft border border-sf-success/20 p-4">
 <div className="flex items-start gap-3">
 <CheckCircle2 className="w-5 h-5 text-sf-success mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('status.active')}
 </p>
 <p className="text-sm text-sf-body">
 {t('status.activeDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {taxStatus.status === 'pending' && (
 <div className="mb-6 bg-sf-warning-soft border border-sf-warning/20 p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-sf-warning mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('status.pending')}
 </p>
 <p className="text-sm text-sf-body">
 {t('status.pendingDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {taxStatus.status === 'no_permission' && (
 <div className="mb-6 bg-sf-accent-soft border border-sf-accent/20 p-4">
 <div className="flex items-start gap-3">
 <Info className="w-5 h-5 text-sf-accent mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('status.noPermission')}
 </p>
 <p className="text-sm text-sf-body">
 {t('status.noPermissionDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {taxStatus.status === 'stripe_not_configured' && (
 <div className="mb-6 bg-sf-raised border-2 border-sf-border-medium p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-sf-muted mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('status.stripeNotConfigured')}
 </p>
 <p className="text-sm text-sf-body">
 {t('status.stripeNotConfiguredDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {/* Head Office */}
 {taxStatus.headOffice && taxStatus.headOffice.country && (
 <div className="mb-4">
 <p className="text-xs text-sf-muted">
 {t('headOffice')}:{' '}
 {getCountryFlag(taxStatus.headOffice.country)}{' '}
 {getCountryName(taxStatus.headOffice.country)}
 {taxStatus.headOffice.state && `, ${taxStatus.headOffice.state}`}
 </p>
 </div>
 )}

 {/* Registrations */}
 {taxStatus.status !== 'stripe_not_configured' &&
 taxStatus.status !== 'no_permission' && (
 <div className="mb-6">
 <h3 className="text-sm font-medium text-sf-body mb-3">
 {t('registrations')}
 </h3>
 {taxStatus.registrations.length > 0 ? (
 <div className="flex flex-wrap gap-2">
 {taxStatus.registrations.map((reg) => (
 <span
 key={`${reg.country}-${reg.state || ''}`}
 className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-sf-raised text-sf-body"
 >
 {getCountryFlag(reg.country)}{' '}
 {getCountryName(reg.country)}
 {reg.state && ` (${reg.state})`}
 </span>
 ))}
 </div>
 ) : (
 <p className="text-sm text-sf-muted">
 {t('noRegistrations')}
 </p>
 )}
 </div>
 )}
 </>
 )}

 {/* Checkout Settings Toggles */}
 <div className="mb-6 space-y-0">
 {/* Tax ID Collection */}
 <div className="flex items-center justify-between py-3 border-t border-sf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-sf-heading">
 {t('toggles.taxIdCollection')}
 </p>
 <SourceBadge source={sources.tax_id_collection} envAlsoSet={envExists.tax_id_collection} />
 </div>
 <p className="text-xs text-sf-muted">
 {t('toggles.taxIdCollectionDescription')}
 </p>
 </div>
 <Toggle
 enabled={taxIdCollection}
 onChange={(v) => handleToggle('tax_id_collection_enabled', v)}
 disabled={saving}
 label={t('toggles.taxIdCollection')}
 />
 </div>

 {/* Billing Address */}
 <div className="flex items-center justify-between py-3 border-t border-sf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-sf-heading">
 {t('toggles.billingAddress')}
 </p>
 <SourceBadge source={sources.billing_address_collection} envAlsoSet={envExists.billing_address_collection} />
 </div>
 <p className="text-xs text-sf-muted">
 {t('toggles.billingAddressDescription')}
 </p>
 </div>
 <div className="flex gap-1">
 {(['auto', 'required'] as const).map((value) => (
 <button
 key={value}
 onClick={() => handleBillingAddress(value)}
 disabled={saving}
 className={`px-3 py-1.5 text-xs font-medium transition-colors ${
 billingAddress === value
 ? 'bg-sf-accent-bg text-white'
 : 'bg-sf-raised text-sf-body hover:bg-sf-hover'
 } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
 >
 {t(`toggles.billing${value.charAt(0).toUpperCase() + value.slice(1)}`)}
 </button>
 ))}
 </div>
 </div>

 {/* Session Expires Hours */}
 <div className="flex items-center justify-between py-3 border-t border-sf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-sf-heading">
 {t('toggles.expiresHours')}
 </p>
 <SourceBadge source={sources.expires_hours} envAlsoSet={envExists.expires_hours} />
 </div>
 <p className="text-xs text-sf-muted">
 {t('toggles.expiresHoursDescription')}
 </p>
 </div>
 <div className="flex items-center gap-2">
 <input
 type="number"
 min={1}
 max={168}
 value={expiresHours}
 onChange={(e) => setExpiresHours(Number(e.target.value))}
 onBlur={() => handleExpiresHours(expiresHours)}
 disabled={saving}
 aria-label={t('toggles.expiresHoursDescription')}
 className={`w-20 px-2 py-1.5 text-sm text-right border-2 border-sf-border-medium bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent ${
 saving ? 'opacity-50 cursor-not-allowed' : ''
 }`}
 />
 <span className="text-xs text-sf-muted">
 {t('toggles.expiresHoursSuffix')}
 </span>
 </div>
 </div>

 {/* Terms of Service Collection */}
 <div className="flex items-center justify-between py-3 border-t border-sf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-sf-heading">
 {t('toggles.collectTerms')}
 </p>
 <SourceBadge source={sources.collect_terms} envAlsoSet={envExists.collect_terms} />
 </div>
 <p className="text-xs text-sf-muted">
 {t('toggles.collectTermsDescription')}
 </p>
 </div>
 <Toggle
 enabled={collectTerms}
 onChange={(v) => handleToggle('checkout_collect_terms', v)}
 disabled={saving}
 label={t('toggles.collectTerms')}
 />
 </div>
 </div>

 {/* Dashboard Links */}
 <div className="flex flex-wrap gap-3">
 {DASHBOARD_LINKS.map((link) => (
 <a
 key={link.key}
 href={link.url}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 px-4 py-2 border-2 border-sf-border-medium text-sf-body font-medium hover:bg-sf-hover transition-colors text-sm"
 >
 {t(`links.${link.key}`)}
 <ExternalLink className="w-4 h-4" />
 </a>
 ))}
 </div>
 </div>
 )
}
