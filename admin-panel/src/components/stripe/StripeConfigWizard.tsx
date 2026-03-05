'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { StripeConfigProvider, useStripeConfig } from './context/StripeConfigContext'
import { useTranslations } from 'next-intl'

// Step components (will be created next)
import { Step1Welcome } from './steps/Step1Welcome'
import { Step2ModeSelection } from './steps/Step2ModeSelection'
import { Step3CreateKey } from './steps/Step3CreateKey'
import { Step4EnterKey } from './steps/Step4EnterKey'
import { Step5Success } from './steps/Step5Success'

interface StripeConfigWizardProps {
  onClose: () => void
  onComplete?: () => void
}

function WizardContent({ onClose, onComplete }: StripeConfigWizardProps) {
  const t = useTranslations('stripe.wizard')
  const tCommon = useTranslations('common')
  const { state, loadDraft, clearDraft, resetWizard } = useStripeConfig()
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  // Load draft on mount
  useEffect(() => {
    const hasDraft = loadDraft()
    if (hasDraft) {
      // Could show a toast: "Draft restored"
    }
  }, [loadDraft])

  // Handle wizard completion
  const handleComplete = () => {
    clearDraft()
    onComplete?.()
  }

  // Handle cancel/close with confirmation if dirty
  const handleClose = () => {
    if (state.isDirty && state.currentStep < 5) {
      setShowExitConfirm(true)
    } else {
      onClose()
    }
  }

  const confirmExit = () => {
    resetWizard()
    onClose()
  }

  // Render current step
  const renderStep = () => {
    switch (state.currentStep) {
      case 1:
        return <Step1Welcome />
      case 2:
        return <Step2ModeSelection />
      case 3:
        return <Step3CreateKey />
      case 4:
        return <Step4EnterKey />
      case 5:
        return <Step5Success onComplete={handleComplete} />
      default:
        return <Step1Welcome />
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" onClick={handleClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-sf-base max-w-4xl w-full max-h-[90vh] overflow-hidden pointer-events-auto flex flex-col border-2 border-sf-border-medium"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-sf-border">
            <div>
              <h2 className="text-2xl font-bold text-sf-heading">
                {t('title', { defaultValue: 'Stripe Configuration' })}
              </h2>
              <p className="text-sm text-sf-muted mt-1">
                {t('subtitle', {
                  defaultValue: 'Configure your Stripe Restricted API Key',
                })}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-sf-muted hover:text-sf-body transition-colors"
              aria-label={tCommon('close')}
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Progress Indicator */}
          <div className="px-6 py-4 bg-sf-raised border-b border-sf-border">
            <div className="flex items-center justify-between">
              {[1, 2, 3, 4, 5].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className={`flex items-center justify-center w-8 h-8 shrink-0 text-sm font-semibold transition-colors ${
                      step === state.currentStep
                        ? 'bg-sf-accent-bg text-white'
                        : step < state.currentStep
                          ? 'bg-sf-success text-sf-inverse'
                          : 'bg-sf-base border-2 border-sf-border-strong text-sf-muted'
                    }`}
                  >
                    {step}
                  </div>
                  {step < 5 && (
                    <div
                      className={`flex-1 h-0.5 mx-2 transition-colors ${
                        step < state.currentStep
                          ? 'bg-sf-accent-bg'
                          : 'bg-sf-border-strong'
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="text-center mt-2 text-sm text-sf-body">
              {t('step', { defaultValue: 'Step' })} {state.currentStep} {t('of', { defaultValue: 'of' })} 5
            </div>
          </div>

          {/* Step Content */}
          <div className="flex-1 overflow-y-auto p-6">{renderStep()}</div>
        </div>
      </div>

      {/* Exit Confirmation Modal */}
      {showExitConfirm && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]" onClick={() => setShowExitConfirm(false)} />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
            <div
              className="bg-sf-base max-w-md w-full p-6 pointer-events-auto border-2 border-sf-border-medium"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-sf-heading mb-2">
                {t('confirmExit.title', { defaultValue: 'Exit configuration?' })}
              </h3>
              <p className="text-sf-body mb-6">
                {t('confirmExit.message', {
                  defaultValue: 'Your progress has been saved. You can continue later from where you left off.',
                })}
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowExitConfirm(false)}
                  className="px-4 py-2 text-sf-body hover:bg-sf-hover transition-colors"
                >
                  {t('confirmExit.cancel', { defaultValue: 'Continue Setup' })}
                </button>
                <button
                  onClick={confirmExit}
                  className="px-4 py-2 bg-sf-danger-bg hover:opacity-90 text-sf-inverse transition-colors"
                >
                  {t('confirmExit.confirm', { defaultValue: 'Exit Anyway' })}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export function StripeConfigWizard(props: StripeConfigWizardProps) {
  return (
    <StripeConfigProvider>
      <WizardContent {...props} />
    </StripeConfigProvider>
  )
}
