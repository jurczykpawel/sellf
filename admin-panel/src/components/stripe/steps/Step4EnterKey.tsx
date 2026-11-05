'use client'

import { useState, useEffect } from 'react'
import {
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { useStripeConfig } from '../context/StripeConfigContext'
import { useTranslations } from 'next-intl'
import { validateStripeKey, saveStripeConfig } from '@/lib/actions/stripe-config'

export function Step4EnterKey() {
  const t = useTranslations('stripe.wizard.step4')
  const { state, setApiKey, setValidationStatus, setValidationResult, nextStep, previousStep } =
    useStripeConfig()

  const [showKey, setShowKey] = useState(false)
  const [localKey, setLocalKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Auto-trim on paste
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text').trim()
    setLocalKey(pastedText)
    setApiKey(pastedText)
  }

  // Auto-trim on blur
  const handleBlur = () => {
    const trimmed = localKey.trim()
    if (trimmed !== localKey) {
      setLocalKey(trimmed)
      setApiKey(trimmed)
    }
  }

  // Validate on input change (debounced format validation only)
  useEffect(() => {
    if (!localKey) {
      setValidationResult(null)
      setValidationStatus('idle')
      return
    }

    // Quick format check
    const timeout = setTimeout(() => {
      if (localKey.length < 30) {
        setValidationResult({
          isValid: false,
          formatValidation: {
            isValid: false,
            errors: ['API key is too short (minimum 30 characters)'],
          },
        })
      } else if (
        !localKey.startsWith('rk_test_') &&
        !localKey.startsWith('rk_live_') &&
        !localKey.startsWith('sk_test_') &&
        !localKey.startsWith('sk_live_')
      ) {
        setValidationResult({
          isValid: false,
          formatValidation: {
            isValid: false,
            errors: ['Invalid key prefix. Must start with rk_test_, rk_live_, sk_test_, or sk_live_'],
          },
        })
      } else {
        setValidationResult(null)
      }
    }, 500)

    return () => clearTimeout(timeout)
  }, [localKey, setValidationResult, setValidationStatus])

  // Full validation
  const handleValidate = async () => {
    if (!localKey || !state.mode) return

    setValidationStatus('validating')

    try {
      const result = await validateStripeKey(localKey, state.mode)

      if (!result.success) {
        setValidationStatus('error')
        setValidationResult({
          isValid: false,
          formatValidation: {
            isValid: false,
            errors: [result.error || 'Validation failed'],
          },
        })
        return
      }

      setValidationResult(result.data!)
      setValidationStatus(result.data!.isValid ? 'success' : 'error')
    } catch {
      setValidationStatus('error')
      setValidationResult({
        isValid: false,
        formatValidation: {
          isValid: false,
          errors: ['Failed to validate key. Please try again.'],
        },
      })
    }
  }

  // Save and continue
  const handleSaveAndContinue = async () => {
    if (!state.mode || !localKey) return

    setIsSaving(true)

    try {
      const result = await saveStripeConfig({
        mode: state.mode,
        apiKey: localKey,
      })

      if (!result.success) {
        setValidationStatus('error')
        setValidationResult({
          isValid: false,
          formatValidation: {
            isValid: false,
            errors: [result.error || 'Failed to save configuration'],
          },
        })
        setIsSaving(false)
        return
      }

      // Success - move to next step
      nextStep()
    } catch {
      setValidationStatus('error')
      setValidationResult({
        isValid: false,
        formatValidation: {
          isValid: false,
          errors: ['Failed to save configuration. Please try again.'],
        },
      })
    } finally {
      setIsSaving(false)
    }
  }

  const isValidFormat =
    localKey.length >= 30 &&
    (localKey.startsWith('rk_test_') ||
      localKey.startsWith('rk_live_') ||
      localKey.startsWith('sk_test_') ||
      localKey.startsWith('sk_live_'))

  const canValidate = isValidFormat && state.validationStatus === 'idle'
  const canSave = state.validationStatus === 'success' && state.validationResult?.isValid

  // Detect key type for contextual messaging
  const keyType = localKey.startsWith('sk_') ? 'secret' : localKey.startsWith('rk_') ? 'restricted' : null

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h3 className="text-2xl font-bold text-sf-heading mb-2">
          {t('title', { defaultValue: 'Enter Your API Key' })}
        </h3>
        <p className="text-sf-body">
          {t('subtitle', {
            defaultValue: 'Enter your Stripe API Key (Restricted or Secret Key)',
          })}
        </p>
      </div>

      {/* Info Box - Key Type Explanation */}
      <div className="mb-6 p-4 bg-sf-accent-soft border border-sf-accent/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-sf-accent flex-shrink-0 mt-0.5" />
          <div className="text-sm text-sf-accent">
            <p className="font-semibold mb-2">
              {t('keyTypeInfo.title', { defaultValue: 'Choose Your Key Type' })}
            </p>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                <strong>Restricted Key (rk_*):</strong>{' '}
                {t('keyTypeInfo.restricted', {
                  defaultValue: 'More secure — only grants permissions Sellf needs. Recommended for production.',
                })}
              </li>
              <li>
                <strong>Secret Key (sk_*):</strong>{' '}
                {t('keyTypeInfo.secret', {
                  defaultValue: 'Full API access. Easier to set up, but less secure if leaked. Fine for development.',
                })}
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Key Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-sf-body mb-2">
          {t('input.label', { defaultValue: 'Stripe API Key' })}
          <span className="text-red-600 ml-1">*</span>
        </label>
        <div className="relative">
          <textarea
            value={localKey}
            onChange={(e) => {
              setLocalKey(e.target.value)
              setApiKey(e.target.value)
            }}
            onPaste={handlePaste}
            onBlur={handleBlur}
            placeholder={t('input.placeholder', {
              defaultValue: state.mode === 'test' ? 'rk_test_... or sk_test_...' : 'rk_live_... or sk_live_...',
            })}
            className={`w-full px-4 py-3 pr-12 border font-mono text-sm resize-none ${
              state.validationStatus === 'success'
                ? 'border-sf-success bg-sf-success-soft'
                : state.validationStatus === 'error'
                  ? 'border-sf-danger bg-sf-danger-soft'
                  : 'border-sf-border bg-sf-input'
            } text-sf-heading focus:ring-2 focus:ring-sf-accent focus:border-transparent`}
            rows={3}
            style={{
              fontFamily: 'monospace',
              WebkitTextSecurity: showKey ? 'none' : 'disc'
            } as React.CSSProperties}
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-3 text-sf-muted hover:text-sf-body transition-colors"
            type="button"
          >
            {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
        <p className="mt-2 text-xs text-sf-muted">
          {t('input.help', {
            defaultValue: 'Your key will be encrypted with AES-256-GCM before being stored.',
          })}
        </p>
      </div>

      {/* Format Errors */}
      {state.validationResult &&
        !state.validationResult.formatValidation.isValid &&
        state.validationResult.formatValidation.errors.length > 0 && (
          <div className="mb-6 bg-sf-danger-soft border border-sf-danger/20 p-4">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-sf-danger mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-sf-heading mb-2">
                  {t('errors.format.title', { defaultValue: 'Invalid Format' })}
                </p>
                <ul className="text-sm text-sf-body space-y-1">
                  {state.validationResult.formatValidation.errors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

      {/* Connection Test Result */}
      {state.validationResult?.connectionTest && !state.validationResult.connectionTest.success && (
        <div className="mb-6 bg-sf-danger-soft border border-sf-danger/20 p-4">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-sf-danger mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-sf-heading mb-1">
                {t('errors.connection.title', { defaultValue: 'Connection Failed' })}
              </p>
              <p className="text-sm text-sf-body">
                {state.validationResult.connectionTest.error}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Permission Verification Result */}
      {state.validationResult?.permissionVerification &&
        !state.validationResult.permissionVerification.allGranted && (
          <div className="mb-6 bg-sf-warning-soft border border-sf-warning/20 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-sf-warning mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-sf-heading mb-3">
                  {t('errors.permissions.title', {
                    defaultValue: 'Missing Required Permissions',
                  })}
                </p>
                <div className="space-y-2">
                  {state.validationResult.permissionVerification.missingPermissions.map(
                    (perm, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 text-sm text-sf-body"
                      >
                        <XCircle className="w-4 h-4 text-red-600" />
                        <span>
                          {perm.resource} - {perm.operation}
                        </span>
                        {perm.errorMessage && (
                          <span className="text-xs text-sf-muted">({perm.errorMessage})</span>
                        )}
                      </div>
                    )
                  )}
                </div>
                <p className="mt-3 text-sm text-sf-body">
                  {t('errors.permissions.help', {
                    defaultValue: 'Go back to Stripe and update your key permissions.',
                  })}
                </p>
              </div>
            </div>
          </div>
        )}

      {/* Success State */}
      {state.validationStatus === 'success' && state.validationResult?.isValid && (
        <div className="mb-6 bg-sf-success-soft border border-sf-success/20 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-sf-success mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-sf-heading mb-1">
                {t('success.title', { defaultValue: 'API Key Validated Successfully!' })}
              </p>
              <p className="text-sm text-sf-body">
                {keyType === 'secret' ? (
                  t('success.descriptionSecret', {
                    defaultValue: 'Your Secret Key has been verified with full API access. All payment functionality is now available.',
                  })
                ) : keyType === 'restricted' ? (
                  t('success.descriptionRestricted', {
                    defaultValue: 'Your Restricted Key has been verified with all required permissions.',
                  })
                ) : (
                  t('success.description', {
                    defaultValue: 'Your key has been verified and all required permissions are granted.',
                  })
                )}
              </p>
              {state.validationResult.connectionTest?.accountId && (
                <p className="text-xs text-sf-muted mt-2">
                  Connected to: {state.validationResult.connectionTest.accountId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Validate Button */}
      {state.validationStatus !== 'success' && (
        <div className="mb-8">
          <button
            onClick={handleValidate}
            disabled={!canValidate || state.validationStatus === 'validating'}
            className={`w-full py-3 font-semibold flex items-center justify-center gap-2 transition-colors ${
              canValidate && state.validationStatus !== 'validating'
                ? 'bg-sf-accent-bg text-white hover:bg-sf-accent-hover'
                : 'bg-sf-raised text-sf-muted cursor-not-allowed'
            }`}
          >
            {state.validationStatus === 'validating' ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t('validateButton.validating', { defaultValue: 'Validating...' })}
              </>
            ) : (
              t('validateButton.validate', { defaultValue: 'Validate API Key' })
            )}
          </button>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={previousStep}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sf-body hover:bg-sf-hover transition-colors"
          disabled={isSaving}
        >
          <ArrowLeft className="w-4 h-4" />
          {t('backButton', { defaultValue: 'Back' })}
        </button>

        <button
          onClick={handleSaveAndContinue}
          disabled={!canSave || isSaving}
          className={`inline-flex items-center gap-2 px-6 py-2.5 font-semibold transition-colors ${
            canSave && !isSaving
              ? 'bg-sf-success hover:opacity-90 text-sf-inverse'
              : 'bg-sf-raised text-sf-muted cursor-not-allowed'
          }`}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('saveButton.saving', { defaultValue: 'Saving...' })}
            </>
          ) : (
            <>
              {t('saveButton.save', { defaultValue: 'Save & Complete' })}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}
