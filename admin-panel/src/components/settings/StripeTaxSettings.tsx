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
 className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-gf-accent focus:ring-offset-2 focus:ring-offset-gf-base ${
 disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
 } ${enabled ? 'bg-gf-accent-bg' : 'bg-gf-raised'}`}
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

 // Toggle state
 const [automaticTax, setAutomaticTax] = useState(true)
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
 const [statusResult, configResult] = await Promise.all([
 getStripeTaxStatus(),
 getCheckoutConfigAction(),
 ])

 if (statusResult.success && statusResult.data) {
 setTaxStatus(statusResult.data)
 } else {
 setError(statusResult.error || t('unknownError'))
 }

 if (configResult.success && configResult.data) {
 setAutomaticTax(configResult.data.automatic_tax.enabled)
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
 } catch (err) {
 setError(t('loadError'))
 } finally {
 setLoading(false)
 }
 }
 load()
 }, [])

 const handleToggle = async (
 field: 'automatic_tax_enabled' | 'tax_id_collection_enabled' | 'checkout_collect_terms',
 value: boolean,
 ) => {
 setSaving(true)
 try {
 const success = await updateShopConfig({ [field]: value })
 if (success) {
 if (field === 'automatic_tax_enabled') {
 setAutomaticTax(value)
 setSources((s) => ({ ...s, automatic_tax: 'db' }))
 } else if (field === 'tax_id_collection_enabled') {
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
 <div className="bg-gf-base border-2 border-gf-border-medium p-6">
 <div className="animate-pulse space-y-4">
 <div className="h-4 bg-gf-raised w-1/4"></div>
 <div className="h-20 bg-gf-raised"></div>
 </div>
 </div>
 )
 }

 return (
 <div className="bg-gf-base border-2 border-gf-border-medium p-6">
 <div className="flex items-start justify-between mb-6">
 <div>
 <h2 className="text-xl font-semibold text-gf-heading mb-2">
 {t('title')}
 </h2>
 <p className="text-sm text-gf-body">
 {t('subtitle')}
 </p>
 </div>
 <Receipt className="w-8 h-8 text-gf-accent" />
 </div>

 {/* Status Banner */}
 {error && (
 <div className="mb-6 bg-gf-danger-soft border border-gf-danger/20 p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-gf-danger mt-0.5 flex-shrink-0" />
 <p className="text-sm text-gf-danger">{error}</p>
 </div>
 </div>
 )}

 {taxStatus && (
 <>
 {taxStatus.status === 'active' && (
 <div className="mb-6 bg-gf-success-soft border border-gf-success/20 p-4">
 <div className="flex items-start gap-3">
 <CheckCircle2 className="w-5 h-5 text-gf-success mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-gf-heading mb-1">
 {t('status.active')}
 </p>
 <p className="text-sm text-gf-body">
 {t('status.activeDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {taxStatus.status === 'pending' && (
 <div className="mb-6 bg-gf-warning-soft border border-gf-warning/20 p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-gf-warning mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-gf-heading mb-1">
 {t('status.pending')}
 </p>
 <p className="text-sm text-gf-body">
 {t('status.pendingDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {taxStatus.status === 'no_permission' && (
 <div className="mb-6 bg-gf-accent-soft border border-gf-accent/20 p-4">
 <div className="flex items-start gap-3">
 <Info className="w-5 h-5 text-gf-accent mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-gf-heading mb-1">
 {t('status.noPermission')}
 </p>
 <p className="text-sm text-gf-body">
 {t('status.noPermissionDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {taxStatus.status === 'stripe_not_configured' && (
 <div className="mb-6 bg-gf-raised border-2 border-gf-border-medium p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-gf-muted mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-gf-heading mb-1">
 {t('status.stripeNotConfigured')}
 </p>
 <p className="text-sm text-gf-body">
 {t('status.stripeNotConfiguredDescription')}
 </p>
 </div>
 </div>
 </div>
 )}

 {/* Head Office */}
 {taxStatus.headOffice && taxStatus.headOffice.country && (
 <div className="mb-4">
 <p className="text-xs text-gf-muted">
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
 <h3 className="text-sm font-medium text-gf-body mb-3">
 {t('registrations')}
 </h3>
 {taxStatus.registrations.length > 0 ? (
 <div className="flex flex-wrap gap-2">
 {taxStatus.registrations.map((reg) => (
 <span
 key={`${reg.country}-${reg.state || ''}`}
 className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-gf-raised text-gf-body"
 >
 {getCountryFlag(reg.country)}{' '}
 {getCountryName(reg.country)}
 {reg.state && ` (${reg.state})`}
 </span>
 ))}
 </div>
 ) : (
 <p className="text-sm text-gf-muted">
 {t('noRegistrations')}
 </p>
 )}
 </div>
 )}
 </>
 )}

 {/* Checkout Settings Toggles */}
 <div className="mb-6 space-y-0">
 {/* Automatic Tax */}
 <div className="flex items-center justify-between py-3 border-t border-gf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-gf-heading">
 {t('toggles.automaticTax')}
 </p>
 <SourceBadge source={sources.automatic_tax} envAlsoSet={envExists.automatic_tax} />
 </div>
 <p className="text-xs text-gf-muted">
 {t('toggles.automaticTaxDescription')}
 </p>
 </div>
 <Toggle
 enabled={automaticTax}
 onChange={(v) => handleToggle('automatic_tax_enabled', v)}
 disabled={saving}
 label={t('toggles.automaticTax')}
 />
 </div>

 {/* Tax ID Collection */}
 <div className="flex items-center justify-between py-3 border-t border-gf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-gf-heading">
 {t('toggles.taxIdCollection')}
 </p>
 <SourceBadge source={sources.tax_id_collection} envAlsoSet={envExists.tax_id_collection} />
 </div>
 <p className="text-xs text-gf-muted">
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
 <div className="flex items-center justify-between py-3 border-t border-gf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-gf-heading">
 {t('toggles.billingAddress')}
 </p>
 <SourceBadge source={sources.billing_address_collection} envAlsoSet={envExists.billing_address_collection} />
 </div>
 <p className="text-xs text-gf-muted">
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
 ? 'bg-gf-accent-bg text-white'
 : 'bg-gf-raised text-gf-body hover:bg-gf-hover'
 } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
 >
 {t(`toggles.billing${value.charAt(0).toUpperCase() + value.slice(1)}`)}
 </button>
 ))}
 </div>
 </div>

 {/* Session Expires Hours */}
 <div className="flex items-center justify-between py-3 border-t border-gf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-gf-heading">
 {t('toggles.expiresHours')}
 </p>
 <SourceBadge source={sources.expires_hours} envAlsoSet={envExists.expires_hours} />
 </div>
 <p className="text-xs text-gf-muted">
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
 className={`w-20 px-2 py-1.5 text-sm text-right border-2 border-gf-border-medium bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent focus:border-transparent ${
 saving ? 'opacity-50 cursor-not-allowed' : ''
 }`}
 />
 <span className="text-xs text-gf-muted">
 {t('toggles.expiresHoursSuffix')}
 </span>
 </div>
 </div>

 {/* Terms of Service Collection */}
 <div className="flex items-center justify-between py-3 border-t border-gf-border">
 <div className="flex-1 min-w-0 mr-4">
 <div className="flex items-center gap-2 mb-1">
 <p className="text-sm font-medium text-gf-heading">
 {t('toggles.collectTerms')}
 </p>
 <SourceBadge source={sources.collect_terms} envAlsoSet={envExists.collect_terms} />
 </div>
 <p className="text-xs text-gf-muted">
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
 className="inline-flex items-center gap-2 px-4 py-2 border-2 border-gf-border-medium text-gf-body font-medium hover:bg-gf-hover transition-colors text-sm"
 >
 {t(`links.${link.key}`)}
 <ExternalLink className="w-4 h-4" />
 </a>
 ))}
 </div>
 </div>
 )
}
