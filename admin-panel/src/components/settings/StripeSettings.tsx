'use client'

import { useState, useEffect } from 'react'
import { Shield, ExternalLink, Settings, CheckCircle2, AlertCircle, Info, Copy, Check, Globe } from 'lucide-react'
import { StripeConfigWizard } from '@/components/stripe/StripeConfigWizard'
import { listStripeConfigs, getStripeAccountInfo, getStripeKeySource, getWebhookRegistrationInfo, createStripeWebhookEndpoint } from '@/lib/actions/stripe-config'
import { STRIPE_API_VERSION, STRIPE_WEBHOOK_EVENTS } from '@/lib/constants'
import type { StripeConfiguration, WebhookRegistrationInfo } from '@/types/stripe-config'
import { useTranslations } from 'next-intl'
import SourceBadge from '@/components/ui/SourceBadge'
import { useAuth } from '@/contexts/AuthContext'

// Session-level cache for Stripe account info — cleared on config change
let _accountInfoCache: { accountId: string | null; accountName: string | null } | null | undefined = undefined

export default function StripeSettings({ siteUrl }: { siteUrl: string }) {
 const t = useTranslations('settings.stripe')
 const { role } = useAuth()
 const [isWizardOpen, setIsWizardOpen] = useState(false)
 const [configs, setConfigs] = useState<StripeConfiguration[]>([])
 const [keySource, setKeySource] = useState<{ activeSource: 'db' | 'env' | 'none'; dbConfigured: boolean; envConfigured: boolean }>({ activeSource: 'none', dbConfigured: false, envConfigured: false })
 const [loading, setLoading] = useState(true)
 const [copied, setCopied] = useState(false)
 const [webhookInfo, setWebhookInfo] = useState<WebhookRegistrationInfo | null>(null)
 const [webhookRegistering, setWebhookRegistering] = useState(false)
 const [webhookError, setWebhookError] = useState<string | null>(null)
 const [accountInfo, setAccountInfo] = useState<{ accountId: string | null; accountName: string | null } | null>(null)

 const loadConfigs = async (invalidateAccountCache = false) => {
 setLoading(true)
 if (invalidateAccountCache) _accountInfoCache = undefined
 try {
 const accountInfoPromise = _accountInfoCache !== undefined
 ? Promise.resolve(_accountInfoCache)
 : getStripeAccountInfo()

 const [configsResult, sourceResult, accountInfoResult, webhookInfoResult] = await Promise.all([
 listStripeConfigs(),
 getStripeKeySource(),
 accountInfoPromise,
 getWebhookRegistrationInfo(),
 ])

 if (configsResult.success && configsResult.data) {
 setConfigs(configsResult.data)
 }
 setKeySource(sourceResult)
 _accountInfoCache = accountInfoResult
 setAccountInfo(accountInfoResult)
 setWebhookInfo(webhookInfoResult)
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
 const webhookUrl = `${siteUrl}/api/webhooks/stripe`
 const isLocalUrl = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(siteUrl)

 const handleCopy = async () => {
   await navigator.clipboard.writeText(webhookUrl)
   setCopied(true)
   setTimeout(() => setCopied(false), 2000)
 }

 const handleRegisterWebhook = async () => {
   setWebhookRegistering(true)
   setWebhookError(null)
   const result = await createStripeWebhookEndpoint()
   if (result.success && result.data) {
     setWebhookInfo(result.data)
   } else if (!result.success) {
     setWebhookError(result.error ?? 'Unknown error')
   }
   setWebhookRegistering(false)
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

 return (
 <>
 <div className="bg-sf-base border-2 border-sf-border-medium p-6">
 <div className="flex items-start justify-between mb-6">
 <div>
 <div className="flex items-center gap-2 mb-2">
 <h2 className="text-xl font-semibold text-sf-heading">
 {t('title')}
 </h2>
 <SourceBadge
 source={keySource.activeSource === 'none' ? 'default' : keySource.activeSource}
 envAlsoSet={keySource.activeSource === 'db' && keySource.envConfigured}
 />
 </div>
 <p className="text-sm text-sf-body">
 {t('subtitle')}
 </p>
 </div>
 <Shield className="w-8 h-8 text-sf-accent" />
 </div>

 {/* Configuration Method Info Banner */}
 {keySource.activeSource === 'none' && (
 <div className="mb-6 bg-sf-warning-soft border border-sf-warning/20 p-4">
 <div className="flex items-start gap-3">
 <Info className="w-5 h-5 text-sf-warning mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('currentMethod.notConfigured.title')}
 </p>
 <p className="text-sm text-sf-body">
 {t('currentMethod.notConfigured.description')}
 </p>
 </div>
 </div>
 </div>
 )}

 {keySource.activeSource === 'env' && (
 <div className="mb-6 bg-sf-accent-soft border border-sf-accent/20 p-4">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-sf-accent mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('currentMethod.env.title')}
 </p>
 <p className="text-sm text-sf-body mb-3">
 {t('currentMethod.env.description')}
 </p>
 {accountInfo?.accountName && (
 <div className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-3 bg-sf-base/60 border border-sf-accent/20 text-sf-heading text-sm font-medium">
 <CheckCircle2 className="w-3.5 h-3.5 text-sf-accent flex-shrink-0" />
 {accountInfo.accountName}
 </div>
 )}
 <p className="text-xs text-sf-muted">
 {t('currentMethod.env.alternative')}
 </p>
 </div>
 </div>
 </div>
 )}

 {keySource.activeSource === 'db' && activeConfigs.length > 0 && (
 <div className="mb-6 bg-sf-success-soft border border-sf-success/20 p-4">
 <div className="flex items-start gap-3">
 <CheckCircle2 className="w-5 h-5 text-sf-success mt-0.5 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-sf-heading mb-1">
 {t('currentMethod.database.title')}
 </p>
 <p className="text-sm text-sf-body mb-3">
 {t('currentMethod.database.description')}
 </p>
 <div className="space-y-3 mt-3">
 {activeConfigs.map((config) => (
 <div
 key={config.id}
 className="bg-sf-base/50 p-3 border border-sf-success/20"
 >
 {accountInfo?.accountName && (
 <div className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 bg-sf-base/60 border border-sf-success/20 text-sf-heading text-sm font-medium">
 <CheckCircle2 className="w-3.5 h-3.5 text-sf-success flex-shrink-0" />
 {accountInfo.accountName}
 </div>
 )}
 <div className="flex items-center gap-3 mb-1">
 <span
 className={`px-2 py-0.5 text-xs font-medium ${
 config.mode === 'test'
 ? 'bg-sf-warning-soft text-sf-warning'
 : 'bg-sf-success-soft text-sf-success'
 }`}
 >
 {t(`mode.${config.mode}`)}
 </span>
 <span className="font-mono text-xs text-sf-body">{config.key_prefix}****{config.key_last_4}</span>
 {config.permissions_verified && (
 <span className="text-xs text-sf-success flex items-center gap-1">
 <CheckCircle2 className="w-3 h-3" />
 {t('verified')}
 </span>
 )}
 </div>
 <div className="text-xs text-sf-muted">
 {config.account_id && (
 <span>{t('account')}: {config.account_id}</span>
 )}
 {config.account_id && ' · '}
 {t('created')}: {new Date(config.created_at).toLocaleDateString()}
 {config.expires_at && (
 <span>
 {' · '}{t('rotationReminder')}: {new Date(config.expires_at).toLocaleDateString()}
 {new Date(config.expires_at) < new Date() && (
 <span className="ml-1 text-sf-warning font-medium">
 ({t('rotationOverdue', { defaultValue: 'overdue' })})
 </span>
 )}
 </span>
 )}
 </div>
 </div>
 ))}
 </div>
 <p className="text-xs text-sf-muted mt-3">
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
 className="inline-flex items-center gap-2 px-4 py-2 bg-sf-accent-bg text-white font-medium hover:bg-sf-accent-hover transition-colors"
 >
 <Settings className="w-4 h-4" />
 {activeConfigs.length > 0 ? t('configureAnother') : t('configureButton')}
 </button>

 <a
 href="https://dashboard.stripe.com/settings/billing"
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 px-4 py-2 border-2 border-sf-border-medium text-sf-body font-medium hover:bg-sf-hover transition-colors"
 >
 {t('openDashboard')}
 <ExternalLink className="w-4 h-4" />
 </a>
 </div>

 {/* Info Box — only when not yet configured */}
 {keySource.activeSource === 'none' && (
 <div className="mt-6 bg-sf-raised p-4 border-2 border-sf-border-medium">
 <h4 className="text-sm font-medium text-sf-heading mb-2">
 {t('infoBox.title')}
 </h4>
 <ul className="text-sm text-sf-body space-y-1">
 <li>{t('infoBox.method1')}</li>
 <li>{t('infoBox.method2')}</li>
 <li className="text-xs text-sf-muted mt-2">
 {t('infoBox.footer')}
 </li>
 </ul>
 </div>
 )}
 </div>

{/* Webhook Endpoint — platform admin only (marketplace uses Connect destination charges) */}
{role === 'platform_admin' && (
<div className="bg-sf-base border-2 border-sf-border-medium p-6">
   <div className="flex items-center justify-between mb-2">
     <div className="flex items-center gap-2">
       <Globe className="w-5 h-5 text-sf-accent" />
       <h4 className="text-base font-semibold text-sf-heading">{t('webhook.title')}</h4>
     </div>
     <a
       href="https://dashboard.stripe.com/webhooks"
       target="_blank"
       rel="noopener noreferrer"
       className="flex items-center gap-1.5 px-3 py-1.5 border border-sf-border-light text-sf-muted hover:text-sf-heading hover:bg-sf-hover transition-colors text-xs whitespace-nowrap"
     >
       {t('webhook.configure')}
       <ExternalLink className="w-3.5 h-3.5" />
     </a>
   </div>
   <p className="text-sm text-sf-body mb-4">{t('webhook.description')}</p>

   {/* Endpoint URL */}
   <div className="mb-3">
     <p className="text-xs text-sf-muted mb-1">{t('webhook.endpointLabel')}</p>
     <div className="flex items-center gap-2">
       <code className="flex-1 font-mono text-xs bg-sf-raised px-3 py-2 border border-sf-border-light text-sf-body truncate">
         {webhookUrl}
       </code>
       <button
         onClick={handleCopy}
         title={t('webhook.copy')}
         className="flex items-center gap-1.5 px-3 py-2 border border-sf-border-light text-sf-muted hover:text-sf-heading hover:bg-sf-hover transition-colors text-xs"
       >
         {copied ? <Check className="w-3.5 h-3.5 text-sf-success" /> : <Copy className="w-3.5 h-3.5" />}
         {copied ? t('webhook.copied') : t('webhook.copy')}
       </button>
     </div>
   </div>

   {/* API Version */}
   <div className="mb-3">
     <p className="text-xs text-sf-muted mb-1">{t('webhook.apiVersionLabel')}</p>
     <code className="font-mono text-xs bg-sf-raised px-3 py-2 border border-sf-border-light text-sf-body inline-block">
       {STRIPE_API_VERSION}
     </code>
   </div>

   {/* Events */}
   <div className="mb-3">
     <p className="text-xs text-sf-muted mb-1">{t('webhook.eventsLabel')}</p>
     <div className="flex flex-wrap gap-1.5">
       {STRIPE_WEBHOOK_EVENTS.map((event) => (
         <code key={event} className="font-mono text-xs bg-sf-raised px-2 py-1 border border-sf-border-light text-sf-body">
           {event}
         </code>
       ))}
     </div>
   </div>

   {/* Registration status + action */}
   {keySource.activeSource !== 'none' && (
     <div className="pt-3 border-t border-sf-border-light">
       {isLocalUrl ? (
         <div className="space-y-2">
           <div className="flex items-start gap-2">
             <Info className="w-4 h-4 text-sf-muted flex-shrink-0 mt-0.5" />
             <p className="text-xs text-sf-muted">
               {t('webhook.localDevNotice')}{' '}
               <a
                 href="https://stripe.com/docs/webhooks#test-webhook"
                 target="_blank"
                 rel="noopener noreferrer"
                 className="underline hover:text-sf-body"
               >
                 Stripe CLI
               </a>
             </p>
           </div>
           <div className="ml-6 space-y-1.5">
             <p className="text-xs text-sf-muted font-medium">1. {t('webhook.localStep1')}</p>
             <code className="block font-mono text-xs bg-sf-raised px-3 py-2 border border-sf-border-light text-sf-body select-all">
               stripe listen --forward-to {webhookUrl.replace(/^https?:\/\/[^/]+/, 'localhost:3000')}
             </code>
             <p className="text-xs text-sf-muted font-medium">2. {t('webhook.localStep2')}</p>
             <code className="block font-mono text-xs bg-sf-raised px-3 py-2 border border-sf-border-light text-sf-body">
               STRIPE_WEBHOOK_SECRET=whsec_...
             </code>
           </div>
         </div>
       ) : (
         <>
           {webhookError && (
             <p className="text-xs text-red-500 mb-2 flex items-center gap-1">
               <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
               {webhookError}
             </p>
           )}
           <div className="flex items-center justify-between gap-3">
             <div className="flex items-center gap-2">
               {webhookInfo?.status === 'registered' ? (
                 <>
                   <CheckCircle2 className="w-4 h-4 text-sf-success flex-shrink-0" />
                   <span className="text-xs text-sf-body">
                     {t('webhook.registered')}
                     {webhookInfo.endpointId && (
                       <span className="ml-1 font-mono text-sf-muted">{webhookInfo.endpointId}</span>
                     )}
                   </span>
                 </>
               ) : (
                 <>
                   <AlertCircle className="w-4 h-4 text-sf-warning flex-shrink-0" />
                   <span className="text-xs text-sf-body">{t('webhook.notRegistered')}</span>
                 </>
               )}
             </div>
             <button
               onClick={handleRegisterWebhook}
               disabled={webhookRegistering}
               className="flex items-center gap-1.5 px-3 py-1.5 bg-sf-accent-bg text-white text-xs font-medium hover:bg-sf-accent-hover transition-colors disabled:opacity-50"
             >
               {webhookRegistering
                 ? t('webhook.registering')
                 : webhookInfo?.status === 'registered'
                 ? t('webhook.reRegister')
                 : t('webhook.createButton')}
             </button>
           </div>
         </>
       )}
     </div>
   )}
 </div>
)}

 {/* Wizard Modal */}
 {isWizardOpen && (
 <StripeConfigWizard
 onClose={() => setIsWizardOpen(false)}
 onComplete={() => {
 setIsWizardOpen(false)
 loadConfigs(true) // Reload configurations, invalidate account cache
 }}
 />
 )}
 </>
 )
}
