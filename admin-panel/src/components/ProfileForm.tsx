'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { updateProfile } from '@/lib/actions/profile'
import { ProfileInput } from '@/lib/validations/profile'
import { validateTaxId } from '@/lib/validation/nip'
import { lookupCompanyByNip } from '@/lib/gus/lookup'

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
  const gusAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => { gusAbortRef.current?.abort() }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    gusAbortRef.current?.abort()
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
      gusAbortRef.current?.abort()
      const controller = new AbortController()
      gusAbortRef.current = controller
      setIsLoadingGUS(true)
      setGusError(null)
      setGusSuccess(false)

      const result = await lookupCompanyByNip(validation.normalized, controller.signal)
      if (controller.signal.aborted) return

      if (result.ok) {
        const data = result.data
        // Autofill company data
        setFormData(prev => ({
          ...prev,
          company_name: data.nazwa || prev.company_name,
          address_line1: `${data.ulica} ${data.nrNieruchomosci}${data.nrLokalu ? `/${data.nrLokalu}` : ''}`.trim() || prev.address_line1,
          city: data.miejscowosc || prev.city,
          zip_code: data.kodPocztowy || prev.zip_code,
          country: 'Poland',
        }))
        setGusSuccess(true)
      } else if (result.code === 'rate_limit') {
        setGusError(t('gus.rateLimitError'))
      } else if (result.code === 'not_found') {
        setGusError(t('gus.notFound'))
      } else if (result.code === 'not_configured') {
        // Silent fail - GUS not configured, user can enter manually
        setGusError(null)
      } else if (result.code === 'security') {
        setGusError(t('gus.securityError'))
      } else {
        setGusError(t('gus.fetchError'))
      }
      setIsLoadingGUS(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* 1. Personal Information */}
      <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
        <div className="px-6 py-4 border-b border-sf-border">
          <h3 className="text-lg font-bold text-sf-heading">
            {t('personalInfo.title')}
          </h3>
          <p className="text-sm text-sf-muted">{t('personalInfo.subtitle')}</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="profile-email" className="block text-sm font-medium text-sf-body mb-1">
                {t('fields.email')}
              </label>
              <input
                id="profile-email"
                type="text"
                disabled
                value={userEmail}
                className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-deep text-sf-muted cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-sf-muted">{t('fields.emailHelp')}</p>
            </div>
            
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-sf-border pt-6">
              <div>
                <label htmlFor="profile-first-name" className="block text-sm font-medium text-sf-body mb-1">
                  {t('fields.firstName')}
                </label>
                <input
                  id="profile-first-name"
                  type="text"
                  value={formData.first_name || ''}
                  onChange={(e) => handleChange('first_name', e.target.value)}
                  placeholder={t('fields.firstNamePlaceholder')}
                  className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none transition-all"
                />
              </div>
              <div>
                <label htmlFor="profile-last-name" className="block text-sm font-medium text-sf-body mb-1">
                  {t('fields.lastName')}
                </label>
                <input
                  id="profile-last-name"
                  type="text"
                  value={formData.last_name || ''}
                  onChange={(e) => handleChange('last_name', e.target.value)}
                  placeholder={t('fields.lastNamePlaceholder')}
                  className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none transition-all"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Billing / Company Information */}
      <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
        <div className="px-6 py-4 border-b border-sf-border">
          <h3 className="text-lg font-bold text-sf-heading">
            {t('billingInfo.title')}
          </h3>
          <p className="text-sm text-sf-muted">{t('billingInfo.subtitle')}</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label htmlFor="profile-company-name" className="block text-sm font-medium text-sf-body mb-1">
                {t('fields.companyName')}
              </label>
              <input
                id="profile-company-name"
                type="text"
                value={formData.company_name || ''}
                onChange={(e) => handleChange('company_name', e.target.value)}
                placeholder={t('fields.companyNamePlaceholder')}
                className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none"
              />
            </div>
            
            <div>
              <label htmlFor="profile-tax-id" className="block text-sm font-medium text-sf-body mb-1">
                {t('fields.taxId')}
              </label>
              <div className="relative">
                <input
                  id="profile-tax-id"
                  type="text"
                  value={formData.tax_id || ''}
                  onChange={(e) => handleChange('tax_id', e.target.value)}
                  onBlur={handleTaxIdBlur}
                  placeholder={t('fields.taxIdPlaceholder')}
                  className={`w-full border px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none transition-all ${
                    taxIdError
                      ? 'border-red-500'
                      : taxIdSuccess
                      ? 'border-green-500'
                      : 'border-sf-border'
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
                <p className="mt-1 text-xs text-sf-danger">{taxIdError}</p>
              )}
              {taxIdSuccess && !taxIdError && (
                <p className="mt-1 text-xs text-sf-success">{taxIdSuccess}</p>
              )}
              {gusSuccess && !isLoadingGUS && (
                <p className="mt-1 text-xs text-sf-success">{t('gus.dataLoaded')}</p>
              )}
              {gusError && (
                <p className="mt-1 text-xs text-sf-warning">⚠️ {gusError}</p>
              )}
              {!taxIdError && !taxIdSuccess && !gusError && (
                <p className="mt-1 text-xs text-sf-muted">{t('fields.taxIdHelp')}</p>
              )}
            </div>

            <div className="md:col-span-2 border-t border-sf-border pt-6">
              <h4 className="text-sm font-semibold mb-4">{t('billingInfo.addressTitle')}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label htmlFor="profile-address1" className="block text-sm font-medium text-sf-body mb-1">
                    {t('fields.address')}
                  </label>
                  <input
                    id="profile-address1"
                    type="text"
                    value={formData.address_line1 || ''}
                    onChange={(e) => handleChange('address_line1', e.target.value)}
                    placeholder={t('fields.addressPlaceholder')}
                    className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none mb-2"
                  />
                  <input
                    id="profile-address2"
                    type="text"
                    value={formData.address_line2 || ''}
                    onChange={(e) => handleChange('address_line2', e.target.value)}
                    placeholder={t('fields.address2Placeholder')}
                    aria-label={t('fields.address2Placeholder')}
                    className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none"
                  />
                </div>
                
                <div>
                  <label htmlFor="profile-city" className="block text-sm font-medium text-sf-body mb-1">
                    {t('fields.city')}
                  </label>
                  <input
                    id="profile-city"
                    type="text"
                    value={formData.city || ''}
                    onChange={(e) => handleChange('city', e.target.value)}
                    className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="profile-zip-code" className="block text-sm font-medium text-sf-body mb-1">
                    {t('fields.zipCode')}
                  </label>
                  <input
                    id="profile-zip-code"
                    type="text"
                    value={formData.zip_code || ''}
                    onChange={(e) => handleChange('zip_code', e.target.value)}
                    className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="profile-country" className="block text-sm font-medium text-sf-body mb-1">
                    {t('fields.country')}
                  </label>
                  <input
                    id="profile-country"
                    type="text"
                    value={formData.country || ''}
                    onChange={(e) => handleChange('country', e.target.value)}
                    placeholder={t('fields.countryPlaceholder')}
                    className="w-full border-2 border-sf-border-medium px-3 py-2 bg-sf-input text-sf-heading focus:ring-2 focus:ring-sf-accent outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 bg-sf-raised border-t border-sf-border flex items-center justify-between">
          <div className="flex-1">
            {message && (
              <div className={`text-sm font-medium ${message.type === 'success' ? 'text-sf-success' : 'text-sf-danger'}`}>
                {message.text}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className={`px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all ${
              loading ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          >
            {loading ? tCommon('loading') : tCommon('save')}
          </button>
        </div>
      </div>
    </form>
  )
}
