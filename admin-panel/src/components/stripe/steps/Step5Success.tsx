'use client'

import { CheckCircle2, Sparkles, ExternalLink, RotateCcw } from 'lucide-react'
import { useStripeConfig } from '../context/StripeConfigContext'
import { useTranslations } from 'next-intl'

interface Step5SuccessProps {
  onComplete: () => void
}

export function Step5Success({ onComplete }: Step5SuccessProps) {
  const t = useTranslations('stripe.wizard.step5')
  const { state } = useStripeConfig()

  const isTestMode = state.mode === 'test'

  return (
    <div className="max-w-2xl mx-auto text-center">
      {/* Success Icon */}
      <div className="inline-flex items-center justify-center w-20 h-20 bg-gf-success-soft rounded-full mb-6">
        <CheckCircle2 className="w-10 h-10 text-gf-success" />
      </div>

      {/* Title */}
      <h3 className="text-3xl font-bold text-gf-heading mb-3">
        {t('title', { defaultValue: 'Configuration Complete!' })}
      </h3>

      <p className="text-lg text-gf-body mb-8">
        {t('subtitle', {
          defaultValue: 'Your Stripe integration is now configured and ready to use',
        })}
      </p>

      {/* Summary Cards */}
      <div className="space-y-4 mb-10">
        {/* Mode Card */}
        <div
          className={`rounded-lg p-5 border-2 ${
            isTestMode
              ? 'bg-gf-warning-soft border-gf-warning/20'
              : 'bg-gf-success-soft border-gf-success/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="text-left">
              <p className="text-sm text-gf-body mb-1">
                {t('summary.mode', { defaultValue: 'Configured Mode' })}
              </p>
              <p
                className={`text-lg font-semibold ${isTestMode ? 'text-gf-warning' : 'text-gf-success'}`}
              >
                {isTestMode
                  ? t('summary.test', { defaultValue: 'Test Mode 🧪' })
                  : t('summary.live', { defaultValue: 'Live Mode 🚀' })}
              </p>
            </div>
            <div
              className={`px-3 py-1 rounded-full text-xs font-medium ${isTestMode ? 'bg-gf-warning-soft text-gf-warning' : 'bg-gf-success-soft text-gf-success'}`}
            >
              {t('summary.active', { defaultValue: 'Active' })}
            </div>
          </div>
        </div>

        {/* Security Card */}
        <div className="bg-gf-accent-soft rounded-lg p-5 border-2 border-gf-accent/20">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-gf-accent mt-0.5 flex-shrink-0" />
            <div className="text-left">
              <p className="text-sm font-medium text-gf-heading mb-1">
                {t('security.title', { defaultValue: 'Encrypted & Secure' })}
              </p>
              <p className="text-sm text-gf-body">
                {t('security.description', {
                  defaultValue:
                    'Your API key has been encrypted with AES-256-GCM and securely stored in the database.',
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Rotation Reminder Card */}
        <div className="bg-gf-raised rounded-lg p-5 border border-gf-border">
          <div className="flex items-start gap-3">
            <RotateCcw className="w-5 h-5 text-gf-body mt-0.5 flex-shrink-0" />
            <div className="text-left">
              <p className="text-sm font-medium text-gf-heading mb-1">
                {t('rotation.title', { defaultValue: 'Key Rotation' })}
              </p>
              <p className="text-sm text-gf-body">
                {t('rotation.description', {
                  defaultValue:
                    'We recommend rotating your API key every 90 days as a security best practice. You can do this anytime from Settings.',
                })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Next Steps */}
      {isTestMode && (
        <div className="bg-gf-warning-soft rounded-lg p-6 mb-8 border border-gf-warning/20 text-left">
          <h4 className="font-semibold text-gf-heading mb-3">
            {t('nextSteps.title', { defaultValue: '💡 Next Steps' })}
          </h4>
          <ul className="space-y-2 text-sm text-gf-body">
            <li className="flex items-start gap-2">
              <span className="text-gf-warning">1.</span>
              <span>
                {t('nextSteps.test', {
                  defaultValue: 'Test your integration with Stripe test card numbers',
                })}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gf-warning">2.</span>
              <span>
                {t('nextSteps.verify', {
                  defaultValue: 'Verify that payments are processing correctly in test mode',
                })}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gf-warning">3.</span>
              <span>
                {t('nextSteps.live', {
                  defaultValue:
                    'When ready for production, configure Live mode using the same wizard',
                })}
              </span>
            </li>
          </ul>
          <a
            href="https://stripe.com/docs/testing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 text-sm text-gf-accent hover:underline"
          >
            {t('nextSteps.learnMore', { defaultValue: 'Learn about Stripe test cards' })}
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {!isTestMode && (
        <div className="bg-gf-success-soft rounded-lg p-6 mb-8 border border-gf-success/20 text-left">
          <h4 className="font-semibold text-gf-heading mb-3">
            {t('live.title', { defaultValue: '🎉 You\'re Live!' })}
          </h4>
          <p className="text-sm text-gf-body mb-3">
            {t('live.description', {
              defaultValue:
                'Your Stripe integration is now configured for production. You can accept real payments from customers.',
            })}
          </p>
          <p className="text-sm text-gf-body">
            {t('live.reminder', {
              defaultValue:
                'Make sure you have properly configured your webhook endpoints and tested all payment flows.',
            })}
          </p>
        </div>
      )}

      {/* Action Button */}
      <div className="flex justify-center">
        <button
          onClick={onComplete}
          className="px-8 py-3 bg-gf-success hover:opacity-90 text-gf-inverse font-semibold rounded-lg transition-colors"
        >
          {t('doneButton', { defaultValue: 'Done' })}
        </button>
      </div>

      {/* Fine Print */}
      <p className="mt-8 text-xs text-gf-muted">
        {t('finePrint', {
          defaultValue:
            'You can always update or rotate your API keys from the Settings page.',
        })}
      </p>
    </div>
  )
}
