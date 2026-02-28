'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import { updateProfile } from '@/lib/actions/profile'
import { ProfileInput } from '@/lib/validations/profile'
import { validateTaxId, isPolishNIP, normalizeNIP } from '@/lib/validation/nip'

interface ProfileFormProps {
  initialData: ProfileInput
  userEmail: string
}

export default function ProfileForm({ initialData, userEmail }: ProfileFormProps) {
  const t = useTranslations('profile')
  const tCommon = useTranslations('common')
  const [formData, setFormData] = useState<ProfileInput>(initialData)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Tax ID / NIP validation state
  const [taxIdError, setTaxIdError] = useState<string | null>(null)
  const [taxIdSuccess, setTaxIdSuccess] = useState<string | null>(null)

  // GUS integration state
  const [isLoadingGUS, setIsLoadingGUS] = useState(false)
  const [gusError, setGusError] = useState<string | null>(null)
  const [gusSuccess, setGusSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const result = await updateProfile(formData)
      if (result.error) {
        setMessage({ type: 'error', text: t('messages.saveError', { error: result.error }) })
      } else {
        setMessage({ type: 'success', text: t('messages.saveSuccess') })
      }
    } catch (err) {
      setMessage({ type: 'error', text: t('messages.saveError', { error: 'Unexpected error' }) })
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (field: keyof ProfileInput, value: string | null) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // Reset validation states when tax_id changes
    if (field === 'tax_id') {
      setTaxIdError(null)
      setTaxIdSuccess(null)
      setGusError(null)
      setGusSuccess(false)
    }
  }

  // Handle Tax ID / NIP validation and GUS auto-fill
  const handleTaxIdBlur = async () => {
    const taxId = formData.tax_id
    if (!taxId || taxId.trim().length === 0) {
      setTaxIdError(null)
      setTaxIdSuccess(null)
      return
    }

    // Validate tax ID format
    const validation = validateTaxId(taxId, true)

    if (!validation.isValid) {
      setTaxIdError(validation.error || t('invalidTaxIdFormat'))
      setTaxIdSuccess(null)
      return
    }

    // Show success for valid tax ID
    if (validation.isPolish) {
      setTaxIdSuccess(validation.countryCode ? t('validPolishNIPWithCode', { code: validation.countryCode }) : t('validPolishNIP'))
    } else {
      setTaxIdSuccess(validation.countryCode ? t('validTaxIdWithCode', { code: validation.countryCode }) : t('validTaxId'))
    }
    setTaxIdError(null)

    // Auto-fill from GUS for Polish NIP
    if (validation.isPolish && validation.normalized) {
      setIsLoadingGUS(true)
      setGusError(null)
      setGusSuccess(false)

      try {
        const response = await fetch('/api/gus/fetch-company-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nip: validation.normalized }),
        })

        const result = await response.json()

        if (result.success && result.data) {
          // Autofill company data
          setFormData(prev => ({
            ...prev,
            company_name: result.data.nazwa || prev.company_name,
            address_line1: `${result.data.ulica} ${result.data.nrNieruchomosci}${result.data.nrLokalu ? `/${result.data.nrLokalu}` : ''}`.trim() || prev.address_line1,
            city: result.data.miejscowosc || prev.city,
            zip_code: result.data.kodPocztowy || prev.zip_code,
            country: 'Poland',
          }))
          setGusSuccess(true)
        } else {
          // GUS API returned error
          if (result.code === 'RATE_LIMIT_EXCEEDED') {
            setGusError(t('gus.rateLimitError'))
          } else if (result.code === 'NOT_FOUND') {
            setGusError(t('gus.notFound'))
          } else if (result.code === 'NOT_CONFIGURED') {
            // Silent fail - GUS not configured, user can enter manually
            setGusError(null)
          } else if (result.code === 'INVALID_ORIGIN') {
            setGusError(t('gus.securityError'))
          } else {
            setGusError(t('gus.fetchError'))
          }
        }
      } catch (error) {
        console.error('GUS fetch error:', error)
        setGusError(t('gus.fetchError'))
      } finally {
        setIsLoadingGUS(false)
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* 1. Personal Information */}
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border overflow-hidden">
        <div className="px-6 py-4 border-b border-gf-border">
          <h3 className="text-lg font-bold text-gf-heading">
            {t('personalInfo.title')}
          </h3>
          <p className="text-sm text-gray-500">{t('personalInfo.subtitle')}</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gf-body mb-1">
                {t('fields.email')}
              </label>
              <input
                type="text"
                disabled
                value={userEmail}
                className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-deep text-gf-muted cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-gray-400">{t('fields.emailHelp')}</p>
            </div>
            
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-gf-border pt-6">
              <div>
                <label className="block text-sm font-medium text-gf-body mb-1">
                  {t('fields.firstName')}
                </label>
                <input
                  type="text"
                  value={formData.first_name || ''}
                  onChange={(e) => handleChange('first_name', e.target.value)}
                  placeholder={t('fields.firstNamePlaceholder')}
                  className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gf-body mb-1">
                  {t('fields.lastName')}
                </label>
                <input
                  type="text"
                  value={formData.last_name || ''}
                  onChange={(e) => handleChange('last_name', e.target.value)}
                  placeholder={t('fields.lastNamePlaceholder')}
                  className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none transition-all"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Billing / Company Information */}
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border overflow-hidden">
        <div className="px-6 py-4 border-b border-gf-border">
          <h3 className="text-lg font-bold text-gf-heading">
            {t('billingInfo.title')}
          </h3>
          <p className="text-sm text-gray-500">{t('billingInfo.subtitle')}</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gf-body mb-1">
                {t('fields.companyName')}
              </label>
              <input
                type="text"
                value={formData.company_name || ''}
                onChange={(e) => handleChange('company_name', e.target.value)}
                placeholder={t('fields.companyNamePlaceholder')}
                className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gf-body mb-1">
                {t('fields.taxId')}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.tax_id || ''}
                  onChange={(e) => handleChange('tax_id', e.target.value)}
                  onBlur={handleTaxIdBlur}
                  placeholder={t('fields.taxIdPlaceholder')}
                  className={`w-full rounded-lg border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none transition-all ${
                    taxIdError
                      ? 'border-red-500'
                      : taxIdSuccess
                      ? 'border-green-500'
                      : 'border-gf-border'
                  } ${isLoadingGUS ? 'pr-10' : ''}`}
                />
                {isLoadingGUS && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <svg className="animate-spin h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                )}
              </div>
              {taxIdError && (
                <p className="mt-1 text-xs text-gf-danger">{taxIdError}</p>
              )}
              {taxIdSuccess && !taxIdError && (
                <p className="mt-1 text-xs text-gf-success">{taxIdSuccess}</p>
              )}
              {gusSuccess && !isLoadingGUS && (
                <p className="mt-1 text-xs text-gf-success">{t('gus.dataLoaded')}</p>
              )}
              {gusError && (
                <p className="mt-1 text-xs text-gf-warning">⚠️ {gusError}</p>
              )}
              {!taxIdError && !taxIdSuccess && !gusError && (
                <p className="mt-1 text-xs text-gray-500">{t('fields.taxIdHelp')}</p>
              )}
            </div>

            <div className="md:col-span-2 border-t border-gf-border pt-6">
              <h4 className="text-sm font-semibold mb-4">{t('billingInfo.addressTitle')}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gf-body mb-1">
                    {t('fields.address')}
                  </label>
                  <input
                    type="text"
                    value={formData.address_line1 || ''}
                    onChange={(e) => handleChange('address_line1', e.target.value)}
                    placeholder={t('fields.addressPlaceholder')}
                    className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none mb-2"
                  />
                  <input
                    type="text"
                    value={formData.address_line2 || ''}
                    onChange={(e) => handleChange('address_line2', e.target.value)}
                    placeholder={t('fields.address2Placeholder')}
                    className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gf-body mb-1">
                    {t('fields.city')}
                  </label>
                  <input
                    type="text"
                    value={formData.city || ''}
                    onChange={(e) => handleChange('city', e.target.value)}
                    className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gf-body mb-1">
                    {t('fields.zipCode')}
                  </label>
                  <input
                    type="text"
                    value={formData.zip_code || ''}
                    onChange={(e) => handleChange('zip_code', e.target.value)}
                    className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gf-body mb-1">
                    {t('fields.country')}
                  </label>
                  <input
                    type="text"
                    value={formData.country || ''}
                    onChange={(e) => handleChange('country', e.target.value)}
                    placeholder={t('fields.countryPlaceholder')}
                    className="w-full rounded-lg border border-gf-border px-3 py-2 bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 bg-gf-raised border-t border-gf-border flex items-center justify-between">
          <div className="flex-1">
            {message && (
              <div className={`text-sm font-medium ${message.type === 'success' ? 'text-gf-success' : 'text-gf-danger'}`}>
                {message.text}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className={`px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-all shadow-sm ${
              loading ? 'opacity-70 cursor-not-allowed' : 'hover:shadow-md active:scale-95'
            }`}
          >
            {loading ? tCommon('loading') : tCommon('save')}
          </button>
        </div>
      </div>
    </form>
  )
}
