'use client'

import { useState, useEffect } from 'react'
import { Shield, ExternalLink, Settings, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { StripeConfigWizard } from '@/components/stripe/StripeConfigWizard'
import { listStripeConfigs } from '@/lib/actions/stripe-config'
import { getStripeKeySource } from '@/lib/stripe/server'
import type { StripeKeySource } from '@/lib/stripe/server'
import type { StripeConfiguration } from '@/types/stripe-config'
import { useTranslations } from 'next-intl'
import SourceBadge from '@/components/ui/SourceBadge'

export default function StripeSettings() {
 const t = useTranslations('settings.stripe')
 const [isWizardOpen, setIsWizardOpen] = useState(false)
 const [configs, setConfigs] = useState<StripeConfiguration[]>([])
 const [keySource, setKeySource] = useState<StripeKeySource>({ activeSource: 'none', dbConfigured: false, envConfigured: false })
 const [loading, setLoading] = useState(true)

 const loadConfigs = async () => {
 setLoading(true)
 try {
 const [configsResult, sourceResult] = await Promise.all([
 listStripeConfigs(),
 getStripeKeySource(),
 ])

 if (configsResult.success && configsResult.data) {
 setConfigs(configsResult.data)
 }
 setKeySource(sourceResult)
 } catch (error) {
 console.error('Failed to load Stripe configs:', error)
 } finally {
 setLoading(false)
 }
 }

 useEffect(() => {
 loadConfigs()
 }, [])

 const activeConfigs = configs.filter((c) => c.is_active)

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
 <>
 <div className="bg-gf-base border-2 border-gf-border-medium p-6">
 <div className="flex items-start justify-between mb-6">
 <div>
 <div className="flex items-center gap-2 mb-2">
 <h2 className="text-xl font-semibold text-gf-heading">
 {t('title')}
 </h2>
 <SourceBadge
 source={keySource.activeSource === 'none' ? 'default' : keySource.activeSource}
 envAlsoSet={keySource.activeSource === 'db' && keySource.envConfigured}
 />
 </div>
 <p className="text-sm text-gf-body">
 {t('subtitle')}
 </p>
 </div>
 <Shield className="w-8 h-8 text-gf-accent" />
 </div>

 {/* Configuration Method Info Banner */}
 {keySource.activeSource === 'none' && (
 <div className="mb-6 bg-gf-warning-soft border border-gf-warning/20 p-4">
 <div className="flex items-start gap-3">
 <Info className="w-5 h-5 text-gf-warning mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-gf-heading mb-1">
 {t('currentMethod.notConfigured.title')}
 </p>
 <p className="text-sm text-gf-body">
 {t('currentMethod.notConfigured.description')}
 </p>
 </div>
 </div>
 </div>
 )}

 {keySource.activeSource === 'env' && (
 <div className="mb-6 bg-gf-accent-soft border border-gf-accent/20 p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-gf-accent mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-gf-heading mb-1">
 {t('currentMethod.env.title')}
 </p>
 <p className="text-sm text-gf-body mb-3">
 {t('currentMethod.env.description')}
 </p>
 <p className="text-xs text-gf-muted">
 {t('currentMethod.env.alternative')}
 </p>
 </div>
 </div>
 </div>
 )}

 {keySource.activeSource === 'db' && activeConfigs.length > 0 && (
 <div className="mb-6 bg-gf-success-soft border border-gf-success/20 p-4">
 <div className="flex items-start gap-3">
 <CheckCircle2 className="w-5 h-5 text-gf-success mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-gf-heading mb-1">
 {t('currentMethod.database.title')}
 </p>
 <p className="text-sm text-gf-body mb-3">
 {t('currentMethod.database.description')}
 </p>
 <div className="space-y-3 mt-3">
 {activeConfigs.map((config) => (
 <div
 key={config.id}
 className="bg-gf-base/50 p-3 border border-gf-success/20"
 >
 <div className="flex items-center gap-3 mb-1">
 <span
 className={`px-2 py-0.5 text-xs font-medium ${
 config.mode === 'test'
 ? 'bg-gf-warning-soft text-gf-warning'
 : 'bg-gf-success-soft text-gf-success'
 }`}
 >
 {t(`mode.${config.mode}`)}
 </span>
 <span className="font-mono text-xs text-gf-body">{config.key_prefix}****{config.key_last_4}</span>
 {config.permissions_verified && (
 <span className="text-xs text-gf-success flex items-center gap-1">
 <CheckCircle2 className="w-3 h-3" />
 {t('verified')}
 </span>
 )}
 </div>
 <div className="text-xs text-gf-muted">
 {config.account_id && <span>{t('account')}: {config.account_id}</span>}
 {config.account_id && ' · '}
 {t('created')}: {new Date(config.created_at).toLocaleDateString()}
 {config.expires_at && (
 <span>
 {' · '}{t('rotationReminder')}: {new Date(config.expires_at).toLocaleDateString()}
 {new Date(config.expires_at) < new Date() && (
 <span className="ml-1 text-gf-warning font-medium">
 ({t('rotationOverdue', { defaultValue: 'overdue' })})
 </span>
 )}
 </span>
 )}
 </div>
 </div>
 ))}
 </div>
 <p className="text-xs text-gf-muted mt-3">
 {t('currentMethod.database.alternative')}
 </p>
 </div>
 </div>
 </div>
 )}

 {/* Action Buttons */}
 <div className="flex flex-wrap gap-3">
 <button
 onClick={() => setIsWizardOpen(true)}
 className="inline-flex items-center gap-2 px-4 py-2 bg-gf-accent-bg text-white font-medium hover:bg-gf-accent-hover transition-colors"
 >
 <Settings className="w-4 h-4" />
 {activeConfigs.length > 0 ? t('configureAnother') : t('configureButton')}
 </button>

 <a
 href="https://dashboard.stripe.com/settings/billing"
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 px-4 py-2 border-2 border-gf-border-medium text-gf-body font-medium hover:bg-gf-hover transition-colors"
 >
 {t('openDashboard')}
 <ExternalLink className="w-4 h-4" />
 </a>
 </div>

 {/* Info Box */}
 <div className="mt-6 bg-gf-raised p-4 border-2 border-gf-border-medium">
 <h4 className="text-sm font-medium text-gf-heading mb-2">
 {t('infoBox.title')}
 </h4>
 <ul className="text-sm text-gf-body space-y-1">
 <li>{t('infoBox.method1')}</li>
 <li>{t('infoBox.method2')}</li>
 <li className="text-xs text-gf-muted mt-2">
 {t('infoBox.footer')}
 </li>
 </ul>
 </div>
 </div>

 {/* Wizard Modal */}
 {isWizardOpen && (
 <StripeConfigWizard
 onClose={() => setIsWizardOpen(false)}
 onComplete={() => {
 setIsWizardOpen(false)
 loadConfigs() // Reload configurations
 }}
 />
 )}
 </>
 )
}
