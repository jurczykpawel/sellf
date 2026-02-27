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

  // Required permissions for GateFlow
  const requiredPermissions = [
    { resource: 'Charges', access: 'Write', required: true },
    { resource: 'Customers', access: 'Write', required: true },
    { resource: 'Checkout Sessions', access: 'Write', required: true },
    { resource: 'Payment Intents', access: 'Read', required: true },
    { resource: 'Webhook Endpoints', access: 'Read', required: false },
    { resource: 'Products', access: 'Read', required: false },
    { resource: 'Prices', access: 'Read', required: false },
  ]

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div
          className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-3 ${
            isTestMode
              ? 'bg-orange-100 dark:bg-orange-900/30'
              : 'bg-green-100 dark:bg-green-900/30'
          }`}
        >
          <span
            className={`text-2xl ${isTestMode ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}
          >
            {isTestMode ? '🧪' : '🚀'}
          </span>
        </div>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {t('title', { defaultValue: 'Create Your Restricted API Key' })}
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          {t('subtitle', {
            defaultValue: 'Follow these steps to create a secure Restricted API Key in Stripe',
          })}
        </p>
        <div
          className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-medium ${
            isTestMode
              ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200'
              : 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200'
          }`}
        >
          {isTestMode
            ? t('mode.test', { defaultValue: 'Test Mode' })
            : t('mode.live', { defaultValue: 'Live Mode' })}
        </div>
      </div>

      {/* Open Stripe Dashboard CTA */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-6 mb-8 border border-blue-200 dark:border-blue-800">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-gray-900 dark:text-white mb-1">
              {t('openDashboard.title', { defaultValue: 'Step 1: Open Stripe Dashboard' })}
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('openDashboard.description', {
                defaultValue: 'Click below to open the API Keys page in a new tab',
              })}
            </p>
          </div>
          <a
            href={stripeDashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('openDashboard.button', { defaultValue: 'Open Stripe' })}
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Instructions */}
      <div className="space-y-6 mb-8">
        {/* Step 2 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center font-semibold text-blue-600 dark:text-blue-400">
              2
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
                {t('step2.title', { defaultValue: 'Create a Restricted Key' })}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {t('step2.description', {
                  defaultValue:
                    'In the Stripe dashboard, click "Create restricted key" button (not "Create secret key")',
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center font-semibold text-blue-600 dark:text-blue-400">
              3
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
                {t('step3.title', { defaultValue: 'Name Your Key' })}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {t('step3.description', {
                  defaultValue: 'Give your key a descriptive name, for example:',
                })}
              </p>
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 font-mono text-sm flex items-center justify-between">
                <span className="text-gray-900 dark:text-white">
                  GateFlow {isTestMode ? t('test') : t('live')}
                </span>
                <button
                  onClick={() => copyToClipboard(`GateFlow ${isTestMode ? 'Test' : 'Live'}`, 3)}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
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
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center font-semibold text-blue-600 dark:text-blue-400">
              4
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
                {t('step4.title', { defaultValue: 'Set Required Permissions' })}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t('step4.description', {
                  defaultValue:
                    'Configure the following permissions for GateFlow to work properly:',
                })}
              </p>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 mb-4 border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-gray-900 dark:text-white mb-1">
                      {t('step4.important', { defaultValue: 'Important' })}
                    </p>
                    <p className="text-gray-600 dark:text-gray-300">
                      {t('step4.importantText', {
                        defaultValue:
                          'Required permissions are marked with ⚠️. Without these, GateFlow will not function properly.',
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {requiredPermissions.map((perm, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {perm.required && <span className="text-red-600">⚠️</span>}
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {perm.resource}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {perm.access}
                      </span>
                      {perm.required ? (
                        <span className="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded">
                          Required
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">
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
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center font-semibold text-blue-600 dark:text-blue-400">
              5
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
                {t('step5.title', { defaultValue: 'Create & Copy the Key' })}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {t('step5.description', {
                  defaultValue:
                    'Click "Create key" and immediately copy it. You will paste it in the next step.',
                })}
              </p>
              <p className="text-sm text-orange-600 dark:text-orange-400 font-medium">
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
          className="inline-flex items-center gap-2 px-5 py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('backButton', { defaultValue: 'Back' })}
        </button>

        <button
          onClick={nextStep}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t('nextButton', { defaultValue: "I've Created the Key" })}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
