'use client'

import { ExternalLink, ArrowRight, ArrowLeft, Copy, CheckCircle2, AlertCircle } from 'lucide-react'
import { useStripeConfig } from '../context/StripeConfigContext'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function Step3CreateKey() {
  const t = useTranslations('stripe.wizard.step3')
  const { state, nextStep, previousStep } = useStripeConfig()
  const [copiedStep, setCopiedStep] = useState<number | null>(null)

  const isTestMode = state.mode === 'test'
  const stripeDashboardUrl = isTestMode
    ? 'https://dashboard.stripe.com/test/apikeys'
    : 'https://dashboard.stripe.com/apikeys'

  const copyToClipboard = (text: string, step: number) => {
    navigator.clipboard.writeText(text)
    setCopiedStep(step)
    setTimeout(() => setCopiedStep(null), 2000)
  }

  // Required permissions for Sellf
  const requiredPermissions: { resource: string; access: string; required: boolean; recommended?: boolean }[] = [
    { resource: 'Charges', access: 'Write', required: true },
    { resource: 'Customers', access: 'Write', required: true },
    { resource: 'Checkout Sessions', access: 'Write', required: true },
    { resource: 'Payment Intents', access: 'Read', required: true },
    { resource: 'Webhook Endpoints', access: 'Read', required: false, recommended: true },
    { resource: 'Products', access: 'Read', required: false, recommended: false },
    { resource: 'Prices', access: 'Read', required: false, recommended: false },
  ]

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div
          className={`inline-flex items-center justify-center w-12 h-12 mb-3 ${
            isTestMode
              ? 'bg-sf-warning-soft'
              : 'bg-sf-success-soft'
          }`}
        >
          <span
            className={`text-2xl ${isTestMode ? 'text-sf-warning' : 'text-sf-success'}`}
          >
            {isTestMode ? '🧪' : '🚀'}
          </span>
        </div>
        <h3 className="text-2xl font-bold text-sf-heading mb-2">
          {t('title', { defaultValue: 'Create Your Restricted API Key' })}
        </h3>
        <p className="text-sf-body">
          {t('subtitle', {
            defaultValue: 'Follow these steps to create a secure Restricted API Key in Stripe',
          })}
        </p>
        <div
          className={`inline-block mt-2 px-3 py-1 text-sm font-medium ${
            isTestMode
              ? 'bg-sf-warning-soft text-sf-warning'
              : 'bg-sf-success-soft text-sf-success'
          }`}
        >
          {isTestMode
            ? t('mode.test', { defaultValue: 'Test Mode' })
            : t('mode.live', { defaultValue: 'Live Mode' })}
        </div>
      </div>

      {/* Open Stripe Dashboard CTA */}
      <div className="bg-sf-accent-soft p-6 mb-8 border border-sf-accent/20">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-sf-heading mb-1">
              {t('openDashboard.title', { defaultValue: 'Step 1: Open Stripe Dashboard' })}
            </h4>
            <p className="text-sm text-sf-body">
              {t('openDashboard.description', {
                defaultValue: 'Click below to open the API Keys page in a new tab',
              })}
            </p>
          </div>
          <a
            href={stripeDashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-sf-accent-bg text-white font-semibold hover:bg-sf-accent-hover transition-colors"
          >
            {t('openDashboard.button', { defaultValue: 'Open Stripe' })}
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Instructions */}
      <div className="space-y-6 mb-8">
        {/* Step 2 */}
        <div className="bg-sf-base p-5 border border-sf-border">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-sf-accent-soft flex items-center justify-center font-semibold text-sf-accent">
              2
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-sf-heading mb-2">
                {t('step2.title', { defaultValue: 'Create a Restricted Key' })}
              </h4>
              <p className="text-sm text-sf-body mb-3">
                {t('step2.description', {
                  defaultValue:
                    'In the Stripe dashboard, click "Create restricted key" button (not "Create secret key")',
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="bg-sf-base p-5 border border-sf-border">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-sf-accent-soft flex items-center justify-center font-semibold text-sf-accent">
              3
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-sf-heading mb-2">
                {t('step3.title', { defaultValue: 'Name Your Key' })}
              </h4>
              <p className="text-sm text-sf-body mb-3">
                {t('step3.description', {
                  defaultValue: 'Give your key a descriptive name, for example:',
                })}
              </p>
              <div className="bg-sf-raised p-3 font-mono text-sm flex items-center justify-between">
                <span className="text-sf-heading">
                  Sellf {isTestMode ? t('test') : t('live')}
                </span>
                <button
                  onClick={() => copyToClipboard(`Sellf ${isTestMode ? 'Test' : 'Live'}`, 3)}
                  className="text-sf-muted hover:text-sf-body transition-colors"
                >
                  {copiedStep === 3 ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Step 4 - Permissions */}
        <div className="bg-sf-base p-5 border border-sf-border">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-sf-accent-soft flex items-center justify-center font-semibold text-sf-accent">
              4
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-sf-heading mb-2">
                {t('step4.title', { defaultValue: 'Set Required Permissions' })}
              </h4>
              <p className="text-sm text-sf-body mb-4">
                {t('step4.description', {
                  defaultValue:
                    'Configure the following permissions for Sellf to work properly:',
                })}
              </p>

              <div className="bg-sf-warning-soft p-4 mb-4 border border-sf-warning/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-sf-warning mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-sf-heading mb-1">
                      {t('step4.important', { defaultValue: 'Important' })}
                    </p>
                    <p className="text-sf-body">
                      {t('step4.importantText', {
                        defaultValue:
                          'Required permissions are marked with ⚠️. Without these, Sellf will not function properly.',
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {requiredPermissions.map((perm, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-sf-raised"
                  >
                    <div className="flex items-center gap-3">
                      {perm.required && <span className="text-red-600">⚠️</span>}
                      {!perm.required && perm.recommended && <span className="text-sf-accent">★</span>}
                      <div>
                        <span className="text-sm font-medium text-sf-heading">
                          {perm.resource}
                        </span>
                        {perm.recommended && (
                          <p className="text-xs text-sf-muted mt-0.5">
                            {t('step4.webhookRecommendedNote', { defaultValue: 'Enables automatic webhook configuration' })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-sf-body">
                        {perm.access}
                      </span>
                      {perm.required ? (
                        <span className="px-2 py-0.5 text-xs font-medium bg-sf-danger-soft text-sf-danger">
                          Required
                        </span>
                      ) : perm.recommended ? (
                        <span className="px-2 py-0.5 text-xs font-medium bg-sf-accent-soft text-sf-accent border border-sf-border-accent">
                          Recommended
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs font-medium bg-sf-raised text-sf-body">
                          Optional
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Step 5 */}
        <div className="bg-sf-base p-5 border border-sf-border">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-sf-accent-soft flex items-center justify-center font-semibold text-sf-accent">
              5
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-sf-heading mb-2">
                {t('step5.title', { defaultValue: 'Create & Copy the Key' })}
              </h4>
              <p className="text-sm text-sf-body mb-2">
                {t('step5.description', {
                  defaultValue:
                    'Click "Create key" and immediately copy it. You will paste it in the next step.',
                })}
              </p>
              <p className="text-sm text-sf-warning font-medium">
                ⚠️{' '}
                {t('step5.warning', {
                  defaultValue: 'The key is only shown once! Make sure to copy it.',
                })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={previousStep}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sf-body hover:bg-sf-hover transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('backButton', { defaultValue: 'Back' })}
        </button>

        <button
          onClick={nextStep}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-sf-accent-bg text-white font-semibold hover:bg-sf-accent-hover transition-colors"
        >
          {t('nextButton', { defaultValue: "I've Created the Key" })}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
