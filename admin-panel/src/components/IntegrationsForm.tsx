'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import { updateIntegrationsConfig, addScript, deleteScript, toggleScript } from '@/lib/actions/integrations'
import { IntegrationsInput, CustomScriptInput } from '@/lib/validations/integrations'
import CurrencySettings from '@/components/settings/CurrencySettings'
import GUSSettings from '@/components/settings/GUSSettings'
import { useToast } from '@/contexts/ToastContext'

interface Script {
  id: string
  name: string
  script_location: 'head' | 'body'
  script_content: string
  category: 'essential' | 'analytics' | 'marketing'
  is_active: boolean
  created_at: string
}

interface IntegrationsFormProps {
  initialData: IntegrationsInput
  initialScripts: Script[]
}

export default function IntegrationsForm({ initialData, initialScripts }: IntegrationsFormProps) {
  const t = useTranslations('integrations')
  const tCommon = useTranslations('common')
  const { addToast } = useToast()
  const [formData, setFormData] = useState<IntegrationsInput>(initialData)
  const [scripts, setScripts] = useState<Script[]>(initialScripts)

  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'analytics' | 'marketing' | 'consents' | 'scripts' | 'currency' | 'gus'>('analytics')

  // Script Modal State
  const [isScriptModalOpen, setIsScriptModalOpen] = useState(false)
  const [newScript, setNewScript] = useState<CustomScriptInput>({
    name: '',
    script_location: 'head',
    script_content: '',
    category: 'marketing',
    is_active: true
  })

  // --- CONFIG HANDLERS ---
  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await updateIntegrationsConfig(formData)
      if (result.error) {
        addToast(result.error, 'error')
      } else {
        addToast(t('messages.saveSuccess'), 'success')
      }
    } catch (err) {
      addToast(t('messages.saveError', { error: 'Unknown' }), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (field: keyof IntegrationsInput, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // --- SCRIPT HANDLERS ---
  const handleAddScript = async () => {
    setLoading(true)
    const result = await addScript(newScript)
    if (result.success) {
      addToast(t('messages.saveSuccess'), 'success')
      setIsScriptModalOpen(false)
      window.location.reload()
    } else {
      addToast(result.error || tCommon('error'), 'error')
    }
    setLoading(false)
  }

  const handleDeleteScript = async (id: string) => {
    if(!confirm(t('scripts.deleteConfirm'))) return
    await deleteScript(id)
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  const handleToggleScript = async (id: string, current: boolean) => {
    await toggleScript(id, !current)
    setScripts(prev => prev.map(s => s.id === id ? { ...s, is_active: !current } : s))
  }

  // --- UI COMPONENTS ---
  const TabButton = ({ id, label }: { id: typeof activeTab, label: string }) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        activeTab === id
          ? 'border-gf-accent text-gf-accent'
          : 'border-transparent text-gf-muted hover:text-gf-body'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      {/* General Quick Start Guide */}
      <details className="group bg-gradient-to-r from-gf-success-soft to-gf-success-soft border border-gf-success/20">
        <summary className="px-6 py-4 cursor-pointer list-none flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚀</span>
            <div>
              <h3 className="font-semibold text-gf-success">{t('guide.quickStart.title')}</h3>
              <p className="text-xs text-gf-success">{t('guide.quickStart.subtitle')}</p>
            </div>
          </div>
          <svg className="w-5 h-5 text-gf-success transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </summary>
        <div className="px-6 pb-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {/* Step 1 - Analytics */}
            <div className="p-4 bg-gf-base border-2 border-gf-border-medium">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 bg-gf-accent-soft text-gf-accent text-xs font-bold flex items-center justify-center">1</span>
                <h4 className="font-medium text-gf-heading text-sm">{t('guide.quickStart.analytics.title')}</h4>
              </div>
              <p className="text-xs text-gf-body mb-2">{t('guide.quickStart.analytics.desc')}</p>
              <div className="text-xs text-gf-muted">
                <div className="font-medium text-gf-success">{t('guide.quickStart.analytics.option1')}</div>
                <div className="text-gf-muted">{t('guide.quickStart.analytics.option2')}</div>
              </div>
            </div>

            {/* Step 2 - Marketing */}
            <div className="p-4 bg-gf-base border-2 border-gf-border-medium">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 bg-gf-accent-soft text-gf-accent text-xs font-bold flex items-center justify-center">2</span>
                <h4 className="font-medium text-gf-heading text-sm">{t('guide.quickStart.marketing.title')}</h4>
              </div>
              <p className="text-xs text-gf-body mb-2">{t('guide.quickStart.marketing.desc')}</p>
              <ul className="text-xs text-gf-muted space-y-1">
                <li>• {t('guide.quickStart.marketing.step1')}</li>
                <li>• {t('guide.quickStart.marketing.step2')}</li>
                <li>• {t('guide.quickStart.marketing.step3')}</li>
              </ul>
            </div>

            {/* Step 3 - Consents */}
            <div className="p-4 bg-gf-base border-2 border-gf-border-medium">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 bg-gf-warning-soft text-gf-warning text-xs font-bold flex items-center justify-center">3</span>
                <h4 className="font-medium text-gf-heading text-sm">{t('guide.quickStart.consents.title')}</h4>
              </div>
              <p className="text-xs text-gf-body mb-2">{t('guide.quickStart.consents.desc')}</p>
              <ul className="text-xs text-gf-muted space-y-1">
                <li>• {t('guide.quickStart.consents.step1')}</li>
                <li>• {t('guide.quickStart.consents.step2')}</li>
              </ul>
            </div>
          </div>

          <div className="p-3 bg-gf-success-soft">
            <p className="text-xs text-gf-success text-center">
              ✅ {t('guide.quickStart.result')}
            </p>
          </div>
        </div>
      </details>

      <div className="bg-gf-base border-2 border-gf-border-medium overflow-hidden">
        {/* Tabs Header */}
        <div className="flex border-b border-gf-border overflow-x-auto">
          <TabButton id="analytics" label={t('tabs.analytics')} />
          <TabButton id="marketing" label={t('tabs.marketing')} />
          <TabButton id="consents" label={t('tabs.consents')} />
          <TabButton id="scripts" label={t('tabs.code')} />
          <TabButton id="currency" label={t('tabs.currency')} />
          <TabButton id="gus" label={t('tabs.gus')} />
        </div>

        {/* Content */}
        <div className="p-6">
          <form onSubmit={handleConfigSubmit}>
            {/* Analytics Tab */}
            {activeTab === 'analytics' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                {/* GTM Setup Guide */}
                <details className="group border border-gf-accent/20 bg-gf-accent-soft">
                  <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between text-sm font-medium text-gf-accent hover:bg-gf-accent-soft transition-colors">
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {t('guide.gtm.title')}
                    </span>
                    <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-gf-body space-y-4">
                    <div className="border-t border-gf-accent/20 pt-4">
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.gtm.whenNeeded')}</h4>
                      <p className="text-gf-body">{t('guide.gtm.whenNeededDesc')}</p>
                    </div>

                    <div>
                      <h4 className="font-semibold text-gf-heading mb-3">{t('guide.gtm.scenarios')}</h4>

                      <div className="space-y-3">
                        {/* Scenario 1 - Meta only */}
                        <div className="p-3 bg-gf-success-soft rounded border border-gf-success/20">
                          <div className="font-medium text-gf-success mb-2">1. {t('guide.gtm.scenario1.title')}</div>
                          <div className="text-xs space-y-1 mb-2">
                            <div className="text-gf-body">{t('guide.gtm.scenario1.gtm')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario1.gtmServer')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario1.capi')}</div>
                          </div>
                          <p className="text-xs text-gf-success">{t('guide.gtm.scenario1.desc')}</p>
                        </div>

                        {/* Scenario 2 - Meta + Umami */}
                        <div className="p-3 bg-gf-base rounded border-2 border-gf-border-medium">
                          <div className="font-medium text-teal-600 mb-2">2. {t('guide.gtm.scenario2.title')}</div>
                          <div className="text-xs space-y-1 mb-2">
                            <div className="text-gf-body">{t('guide.gtm.scenario2.gtm')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario2.gtmServer')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario2.capi')}</div>
                          </div>
                          <p className="text-xs text-gf-muted">{t('guide.gtm.scenario2.desc')}</p>
                        </div>

                        {/* Scenario 3 - GA4 standard */}
                        <div className="p-3 bg-gf-base rounded border-2 border-gf-border-medium">
                          <div className="font-medium text-gf-accent mb-2">3. {t('guide.gtm.scenario3.title')}</div>
                          <div className="text-xs space-y-1 mb-2">
                            <div className="text-gf-body">{t('guide.gtm.scenario3.gtm')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario3.gtmServer')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario3.capi')}</div>
                          </div>
                          <p className="text-xs text-gf-muted">{t('guide.gtm.scenario3.desc')}</p>
                        </div>

                        {/* Scenario 4 - Full tracking */}
                        <div className="p-3 bg-gf-base rounded border-2 border-gf-border-medium">
                          <div className="font-medium text-gf-accent mb-2">4. {t('guide.gtm.scenario4.title')}</div>
                          <div className="text-xs space-y-1 mb-2">
                            <div className="text-gf-body">{t('guide.gtm.scenario4.gtm')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario4.gtmServer')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario4.capi')}</div>
                          </div>
                          <p className="text-xs text-gf-muted">{t('guide.gtm.scenario4.desc')}</p>
                        </div>

                        {/* Scenario 5 - Google Ads */}
                        <div className="p-3 bg-gf-base rounded border-2 border-gf-border-medium">
                          <div className="font-medium text-gf-warning mb-2">5. {t('guide.gtm.scenario5.title')}</div>
                          <div className="text-xs space-y-1 mb-2">
                            <div className="text-gf-body">{t('guide.gtm.scenario5.gtm')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario5.gtmServer')}</div>
                            <div className="text-gf-body">{t('guide.gtm.scenario5.capi')}</div>
                          </div>
                          <p className="text-xs text-gf-muted">{t('guide.gtm.scenario5.desc')}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.gtm.serverSetup')}</h4>
                      <p className="text-xs text-gf-body mb-2">{t('guide.gtm.serverSetupDesc')}</p>
                      <ul className="text-xs text-gf-body space-y-1 list-disc list-inside">
                        <li>{t('guide.gtm.serverOptions.stape')}</li>
                        <li>{t('guide.gtm.serverOptions.gcloud')}</li>
                        <li>{t('guide.gtm.serverOptions.aws')}</li>
                        <li>{t('guide.gtm.serverOptions.vps')}</li>
                      </ul>
                      <p className="text-xs text-gf-accent mt-2">{t('guide.gtm.serverNote')}</p>
                    </div>
                  </div>
                </details>

                <div>
                  <h3 className="text-lg font-medium text-gf-heading mb-4">{t('gtm.title')}</h3>
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gf-body mb-1">{t('gtm.containerId')}</label>
                      <input type="text" placeholder={t('gtm.containerIdPlaceholder')} value={formData.gtm_container_id || ''} onChange={(e) => handleChange('gtm_container_id', e.target.value)} className="w-full border-2 border-gf-border-medium px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gf-body mb-1">
                        {t('gtm.serverContainerUrl')}
                        <span className="text-xs text-gf-muted ml-2">(Advanced)</span>
                      </label>
                      <input type="text" placeholder={t('gtm.serverContainerUrlPlaceholder')} value={formData.gtm_server_container_url || ''} onChange={(e) => handleChange('gtm_server_container_url', e.target.value)} className="w-full border-2 border-gf-border-medium px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none" />
                      <p className="mt-1 text-xs text-gf-muted">{t('gtm.serverContainerHelp')}</p>
                    </div>
                  </div>
                  {formData.gtm_server_container_url && (
                    <div className="mt-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={formData.gtm_ss_enabled || false} onChange={(e) => handleChange('gtm_ss_enabled', e.target.checked)} className="rounded border-gf-border text-gf-accent focus:ring-gf-accent" />
                        <span className="text-sm font-medium text-gf-body">{t('gtm.ssEnabled')}</span>
                      </label>
                      <p className="mt-1 text-xs text-gf-muted ml-6">{t('gtm.ssEnabledHelp')}</p>
                    </div>
                  )}
                </div>

                <div className="border-t border-gf-border my-6"></div>

                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-lg font-medium text-gf-heading">{t('umami.title')}</h3>
                    <span className="px-2 py-0.5 rounded text-xs bg-gf-success-soft text-gf-success font-medium">{t('umami.privacyFocused')}</span>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gf-body mb-1">{t('umami.websiteId')}</label>
                      <input type="text" placeholder={t('umami.websiteIdPlaceholder')} value={formData.umami_website_id || ''} onChange={(e) => handleChange('umami_website_id', e.target.value)} className="w-full border-2 border-gf-border-medium px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gf-body mb-1">{t('umami.scriptUrl')}</label>
                      <input type="text" placeholder={t('umami.scriptUrlPlaceholder')} value={formData.umami_script_url || ''} onChange={(e) => handleChange('umami_script_url', e.target.value)} className="w-full border-2 border-gf-border-medium px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none" />
                      <p className="mt-1 text-xs text-gf-muted">{t('umami.default')}: https://cloud.umami.is/script.js</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Marketing Tab */}
            {activeTab === 'marketing' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                {/* Facebook CAPI Setup Guide */}
                <details className="group border border-gf-border-accent bg-gf-accent-soft">
                  <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between text-sm font-medium text-gf-accent hover:bg-gf-accent-soft transition-colors">
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {t('guide.facebook.title')}
                    </span>
                    <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-gf-body space-y-4">
                    {/* Quick Start - highlighted section */}
                    <div className="border-t border-gf-border-accent pt-4">
                      <div className="p-4 bg-gf-success-soft border border-gf-success/20">
                        <h4 className="font-semibold text-gf-success mb-2 flex items-center gap-2">
                          <span className="text-lg">🚀</span> {t('guide.facebook.quickStart')}
                        </h4>
                        <p className="text-xs text-gf-success mb-3">{t('guide.facebook.quickStartDesc')}</p>
                        <ol className="list-decimal list-inside space-y-2 text-gf-success text-xs mb-3">
                          <li>{t('guide.facebook.quickStartSteps.step1')}</li>
                          <li>{t('guide.facebook.quickStartSteps.step2')}</li>
                          <li>{t('guide.facebook.quickStartSteps.step3')}</li>
                          <li>{t('guide.facebook.quickStartSteps.step4')}</li>
                        </ol>
                        <p className="text-xs text-gf-success font-medium mb-2">✅ {t('guide.facebook.quickStartResult')}</p>
                        <p className="text-xs text-gf-success italic">{t('guide.facebook.quickStartOptional')}</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.facebook.whatIs')}</h4>
                      <p className="text-gf-body text-xs">{t('guide.facebook.whatIsDesc')}</p>
                    </div>

                    <div>
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.facebook.howToSetup')}</h4>
                      <ol className="list-decimal list-inside space-y-2 text-gf-body text-xs">
                        <li>{t('guide.facebook.step1')}</li>
                        <li>{t('guide.facebook.step2')}</li>
                        <li>{t('guide.facebook.step3')}</li>
                        <li>{t('guide.facebook.step4')}</li>
                        <li>{t('guide.facebook.step5')}</li>
                      </ol>
                    </div>

                    <div>
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.facebook.deduplication')}</h4>
                      <p className="text-gf-body text-xs mb-2">{t('guide.facebook.deduplicationDesc')}</p>
                      <div className="p-3 bg-gf-base rounded border-2 border-gf-border-medium">
                        <pre className="text-xs text-gf-body whitespace-pre-wrap">
{`Browser → FB Pixel (event_id: abc-123)
       → CAPI     (event_id: abc-123)
              ↓
Facebook: 1 konwersja (deduplikacja po event_id)`}
                        </pre>
                      </div>
                    </div>

                    <div className="p-3 bg-gf-base rounded border-2 border-gf-border-medium">
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.facebook.recommendation')}</h4>
                      <p className="text-xs text-gf-body mb-3">{t('guide.facebook.recommendationDesc')}</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gf-border">
                            <th className="text-left py-2 pr-2 text-gf-body">{t('guide.facebook.recommendationTable.feature')}</th>
                            <th className="text-left py-2 pr-2 text-gf-body">{t('guide.facebook.recommendationTable.ourCapi')}</th>
                            <th className="text-left py-2 text-gf-body">{t('guide.facebook.recommendationTable.gtmServer')}</th>
                          </tr>
                        </thead>
                        <tbody className="text-gf-body">
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.facebook.recommendationTable.consentIntegration')}</td>
                            <td className="py-2 pr-2">{t('guide.facebook.recommendationTable.consentOur')}</td>
                            <td className="py-2">{t('guide.facebook.recommendationTable.consentGtm')}</td>
                          </tr>
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.facebook.recommendationTable.setup')}</td>
                            <td className="py-2 pr-2">{t('guide.facebook.recommendationTable.setupOur')}</td>
                            <td className="py-2">{t('guide.facebook.recommendationTable.setupGtm')}</td>
                          </tr>
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.facebook.recommendationTable.cost')}</td>
                            <td className="py-2 pr-2">{t('guide.facebook.recommendationTable.costOur')}</td>
                            <td className="py-2">{t('guide.facebook.recommendationTable.costGtm')}</td>
                          </tr>
                          <tr>
                            <td className="py-2 pr-2">{t('guide.facebook.recommendationTable.adBlockBypass')}</td>
                            <td className="py-2 pr-2">{t('guide.facebook.recommendationTable.adBlockOur')}</td>
                            <td className="py-2">{t('guide.facebook.recommendationTable.adBlockGtm')}</td>
                          </tr>
                        </tbody>
                      </table>
                      <p className="text-xs text-gf-muted mt-2 italic">{t('guide.facebook.recommendationNote')}</p>
                    </div>

                    <div className="p-3 bg-gf-warning-soft rounded border border-gf-warning/20">
                      <h4 className="font-semibold text-gf-warning mb-1">{t('guide.facebook.gtmWarning')}</h4>
                      <p className="text-xs text-gf-warning">{t('guide.facebook.gtmWarningDesc')}</p>
                    </div>

                    <div>
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.facebook.trackedEvents')}</h4>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gf-border">
                            <th className="text-left py-2 pr-2">{t('guide.facebook.action')}</th>
                            <th className="text-left py-2 pr-2">{t('guide.facebook.event')}</th>
                            <th className="text-left py-2">{t('guide.facebook.location')}</th>
                          </tr>
                        </thead>
                        <tbody className="text-gf-body">
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.facebook.viewProduct')}</td>
                            <td className="py-2 pr-2">ViewContent</td>
                            <td className="py-2">{t('guide.facebook.checkoutPage')}</td>
                          </tr>
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.facebook.startCheckout')}</td>
                            <td className="py-2 pr-2">InitiateCheckout</td>
                            <td className="py-2">{t('guide.facebook.checkoutPage')}</td>
                          </tr>
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.facebook.addPayment')}</td>
                            <td className="py-2 pr-2">AddPaymentInfo</td>
                            <td className="py-2">{t('guide.facebook.paymentForm')}</td>
                          </tr>
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.facebook.purchase')}</td>
                            <td className="py-2 pr-2">Purchase</td>
                            <td className="py-2">{t('guide.facebook.successPage')}</td>
                          </tr>
                          <tr>
                            <td className="py-2 pr-2">{t('guide.facebook.freeProduct')}</td>
                            <td className="py-2 pr-2">Lead</td>
                            <td className="py-2">{t('guide.facebook.grantAccess')}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>

                <div>
                  <h3 className="text-lg font-medium text-gf-heading mb-4">{t('facebook.title')}</h3>
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gf-body mb-1">{t('facebook.pixelId')}</label>
                      <input type="text" placeholder={t('facebook.pixelIdPlaceholder')} value={formData.facebook_pixel_id || ''} onChange={(e) => handleChange('facebook_pixel_id', e.target.value)} className="w-full border-2 border-gf-border-medium px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none" />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gf-body mb-1">{t('facebook.capiToken')}</label>
                        <input type="password" value={formData.facebook_capi_token || ''} onChange={(e) => handleChange('facebook_capi_token', e.target.value)} className="w-full border-2 border-gf-border-medium px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none" />
                        <p className="mt-1 text-xs text-gf-muted">{t('facebook.capiTokenHelp')}</p>
                    </div>
                    <div className="md:col-span-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="fb_capi_enabled"
                          checked={formData.fb_capi_enabled ?? false}
                          onChange={(e) => handleChange('fb_capi_enabled', e.target.checked)}
                          disabled={!formData.facebook_capi_token}
                          className="w-4 h-4 text-gf-accent rounded border-gf-border focus:ring-gf-accent disabled:opacity-50"
                        />
                        <label htmlFor="fb_capi_enabled" className={`text-sm font-medium ${!formData.facebook_capi_token ? 'text-gf-muted' : 'text-gf-body'}`}>
                          {t('facebook.enableCAPI')}
                        </label>
                      </div>
                      {formData.fb_capi_enabled && !formData.facebook_capi_token && (
                        <p className="mt-1 text-xs text-amber-600">{t('facebook.capiTokenRequired')}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Consents Tab */}
            {activeTab === 'consents' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                {/* Consent Guide */}
                <details className="group border border-gf-warning/20 bg-gf-warning-soft">
                  <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between text-sm font-medium text-gf-warning hover:bg-gf-warning-soft transition-colors">
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {t('guide.consent.title')}
                    </span>
                    <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-gf-body space-y-4">
                    <div className="border-t border-gf-warning/20 pt-4">
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.consent.howItWorks')}</h4>
                      <p className="text-gf-body text-xs">{t('guide.consent.howItWorksDesc')}</p>
                    </div>

                    <div>
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.consent.consentModes')}</h4>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gf-border">
                            <th className="text-left py-2 pr-2">{t('guide.consent.scenario')}</th>
                            <th className="text-left py-2 pr-2">{t('guide.consent.clientSide')}</th>
                            <th className="text-left py-2">{t('guide.consent.serverSide')}</th>
                          </tr>
                        </thead>
                        <tbody className="text-gf-body">
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.consent.userAccepts')}</td>
                            <td className="py-2 pr-2">✅ {t('guide.consent.allEvents')}</td>
                            <td className="py-2">✅ {t('guide.consent.allEvents')}</td>
                          </tr>
                          <tr className="border-b border-gf-border">
                            <td className="py-2 pr-2">{t('guide.consent.userDeclines')}</td>
                            <td className="py-2 pr-2">❌ {t('guide.consent.blocked')}</td>
                            <td className="py-2">❌ {t('guide.consent.blocked')}</td>
                          </tr>
                          <tr>
                            <td className="py-2 pr-2">{t('guide.consent.userDeclinesWithServer')}</td>
                            <td className="py-2 pr-2">❌ {t('guide.consent.blocked')}</td>
                            <td className="py-2">✅ Purchase/Lead</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div>
                      <h4 className="font-semibold text-gf-heading mb-2">{t('guide.consent.legitimateInterest')}</h4>
                      <p className="text-gf-body text-xs mb-2">{t('guide.consent.legitimateInterestDesc')}</p>
                      <div className="p-3 bg-gf-base rounded border-2 border-gf-border-medium">
                        <p className="text-xs font-medium text-gf-body mb-1">{t('guide.consent.allowedWithoutConsent')}</p>
                        <ul className="text-xs text-gf-body list-disc list-inside">
                          <li><strong>Purchase</strong> - {t('guide.consent.purchaseDesc')}</li>
                          <li><strong>Lead</strong> - {t('guide.consent.leadDesc')}</li>
                        </ul>
                        <p className="text-xs text-gf-danger mt-2">{t('guide.consent.notAllowed')}</p>
                      </div>
                    </div>
                  </div>
                </details>

                 <div className="flex items-center h-5 gap-3">
                    <input id="consent" type="checkbox" checked={formData.cookie_consent_enabled} onChange={(e) => handleChange('cookie_consent_enabled', e.target.checked)} className="w-4 h-4 text-gf-accent rounded" />
                    <label htmlFor="consent" className="text-sm font-medium text-gf-heading">{t('cookieConsent.requireConsent')}</label>
                 </div>

                 {/* Server-side conversions without consent */}
                 <div className="mt-6 p-4 border border-gf-warning/20 bg-gf-warning-soft">
                   <div className="flex items-start gap-3">
                     <input
                       id="send_conversions_without_consent"
                       type="checkbox"
                       checked={formData.send_conversions_without_consent ?? false}
                       onChange={(e) => handleChange('send_conversions_without_consent', e.target.checked)}
                       disabled={!formData.fb_capi_enabled}
                       className="w-4 h-4 mt-0.5 text-amber-600 rounded border-gray-300 focus:ring-amber-500 disabled:opacity-50"
                     />
                     <div className="flex-1">
                       <label htmlFor="send_conversions_without_consent" className={`text-sm font-medium ${!formData.fb_capi_enabled ? 'text-gf-muted' : 'text-gf-heading'}`}>
                         {t('consent.sendConversionsWithoutConsent')}
                       </label>
                       <p className="mt-1 text-xs text-gf-body">
                         {t('consent.sendConversionsWithoutConsentHelp')}
                       </p>
                       {!formData.fb_capi_enabled && (
                         <p className="mt-2 text-xs text-amber-600">{t('consent.requiresCAPI')}</p>
                       )}
                       <div className="mt-2 p-2 bg-gf-warning-soft rounded text-xs text-gf-warning">
                         <strong>⚠️ {t('consent.legalWarning')}</strong>
                       </div>
                       <div className="mt-2 p-2 bg-gf-raised rounded text-xs text-gf-body">
                         <span>📄 {t('consent.documentsWarning')}</span>
                         <a href="/dashboard/settings" className="ml-1 underline hover:no-underline font-medium text-gf-heading">
                           {t('consent.documentsLink')} →
                         </a>
                       </div>
                     </div>
                   </div>
                 </div>
              </div>
            )}

            {!['scripts', 'currency', 'gus'].includes(activeTab) && (
                <div className="mt-6 border-t pt-4 flex justify-end">
                    <button type="submit" disabled={loading} className="px-4 py-2 bg-gf-accent-bg hover:bg-gf-accent-hover text-white">{loading ? t('messages.saving') : t('saveConfig')}</button>
                </div>
            )}
          </form>

          {/* SCRIPT MANAGER TAB */}
          {activeTab === 'scripts' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium text-gf-heading">{t('scripts.title')}</h3>
                    <button onClick={() => setIsScriptModalOpen(true)} className="px-3 py-1.5 bg-gf-success hover:opacity-90 text-gf-inverse text-sm">+ {t('scripts.addScript')}</button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gf-muted">
                        <thead className="text-xs text-gf-body uppercase bg-gf-raised">
                            <tr>
                                <th className="px-4 py-3">{t('scripts.table.name')}</th>
                                <th className="px-4 py-3">{t('scripts.table.location')}</th>
                                <th className="px-4 py-3">{t('scripts.table.category')}</th>
                                <th className="px-4 py-3">{t('scripts.table.status')}</th>
                                <th className="px-4 py-3">{t('scripts.table.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {scripts.length === 0 ? (
                                <tr><td colSpan={5} className="px-4 py-4 text-center">{t('scripts.noScripts')}</td></tr>
                            ) : (
                                scripts.map(script => (
                                    <tr key={script.id} className="bg-gf-base border-b border-gf-border">
                                        <td className="px-4 py-3 font-medium text-gf-heading">{script.name}</td>
                                        <td className="px-4 py-3 uppercase">{script.script_location}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded text-xs ${
                                                script.category === 'essential' ? 'bg-gf-raised text-gf-heading' :
                                                script.category === 'marketing' ? 'bg-gf-accent-soft text-gf-accent' :
                                                'bg-gf-accent-soft text-gf-accent'
                                            }`}>
                                                {t(`scripts.categories.${script.category}`)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <button onClick={() => handleToggleScript(script.id, script.is_active)} className={`px-2 py-1 rounded text-xs font-bold ${script.is_active ? 'bg-gf-success-soft text-gf-success' : 'bg-gf-danger-soft text-gf-danger'}`}>
                                                {script.is_active ? tCommon('active') : tCommon('inactive')}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            <button onClick={() => handleDeleteScript(script.id)} className="text-gf-danger hover:underline">{tCommon('delete')}</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
          )}

          {/* Currency Tab */}
          {activeTab === 'currency' && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <CurrencySettings />
            </div>
          )}

          {/* GUS Tab */}
          {activeTab === 'gus' && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <GUSSettings />
            </div>
          )}

        </div>
      </div>

      {/* ADD SCRIPT MODAL */}
      {isScriptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-gf-base w-full max-w-lg p-6 space-y-4">
                <h3 className="text-xl font-bold text-gf-heading">{t('scripts.modal.title')}</h3>
                
                <div>
                    <label className="block text-sm font-medium mb-1 text-gf-body">{t('scripts.modal.name')}</label>
                    <input type="text" className="w-full border-2 border-gf-border-medium rounded p-2 bg-gf-input text-gf-heading" value={newScript.name} onChange={e => setNewScript({...newScript, name: e.target.value})} placeholder={t('scripts.modal.namePlaceholder')} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gf-body">{t('scripts.modal.location')}</label>
                        <select className="w-full border-2 border-gf-border-medium rounded p-2 bg-gf-input text-gf-heading" value={newScript.script_location} onChange={e => setNewScript({...newScript, script_location: e.target.value as any})}>
                            <option value="head">{t('scripts.location.head')}</option>
                            <option value="body">{t('scripts.location.body')}</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gf-body">{t('scripts.modal.category')}</label>
                        <select className="w-full border-2 border-gf-border-medium rounded p-2 bg-gf-input text-gf-heading" value={newScript.category} onChange={e => setNewScript({...newScript, category: e.target.value as any})}>
                            <option value="marketing">{t('scripts.categories.marketing')}</option>
                            <option value="analytics">{t('scripts.categories.analytics')}</option>
                            <option value="essential">{t('scripts.categories.essential')}</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1 text-gf-body">{t('scripts.modal.code')}</label>
                    <textarea rows={5} className="w-full border-2 border-gf-border-medium rounded p-2 font-mono text-sm bg-gf-input text-gf-heading" value={newScript.script_content} onChange={e => setNewScript({...newScript, script_content: e.target.value})} placeholder={t('scripts.modal.codePlaceholder')}></textarea>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={() => setIsScriptModalOpen(false)} className="px-4 py-2 text-gf-body hover:bg-gf-hover rounded">{t('scripts.modal.cancel')}</button>
                    <button onClick={handleAddScript} disabled={loading} className="px-4 py-2 bg-gf-accent-bg text-white rounded hover:bg-gf-accent-hover">{t('scripts.modal.add')}</button>
                </div>
            </div>
        </div>
      )}
    </div>
  )
}