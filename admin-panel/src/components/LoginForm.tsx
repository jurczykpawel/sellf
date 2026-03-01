'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { validateEmailAction } from '@/lib/actions/validate-email'
import TurnstileWidget from './TurnstileWidget'
import TermsCheckbox from './TermsCheckbox'
import { useConfig } from '@/components/providers/config-provider'

/**
 * Login form component that handles magic link authentication
 * In demo mode, switches to email+password login
 */
export default function LoginForm() {
  const { demoMode } = useConfig()
  const [email, setEmail] = useState(demoMode ? 'demo@sellf.app' : '')
  const [password, setPassword] = useState(demoMode ? 'demo123' : '')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [sentEmail, setSentEmail] = useState(false)
  const [siteUrl, setSiteUrl] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetTrigger, setCaptchaResetTrigger] = useState(0)
  const [captchaLoading, setCaptchaLoading] = useState(false) // Will be set to true only when needed
  const t = useTranslations()

  // Get current site URL for redirects (works in any environment)
  useEffect(() => {
    setSiteUrl(window.location.origin)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setMessage('')

    try {
      // Demo mode: password login (skip captcha & terms)
      if (demoMode) {
        const supabase = await createClient()
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) {
          setMessage(error.message)
        }
        // On success, AuthContext will detect user and redirect
        setIsLoading(false)
        return
      }

      // Check if terms are accepted
      if (!termsAccepted) {
        setMessage(t('compliance.pleaseAcceptTerms'))
        setIsLoading(false)
        return
      }

      // Check if Turnstile token is present
      // In development, dummy token will be present, in production real verification is required
      if (!captchaToken) {
        setMessage(t('compliance.securityVerificationRequired'))
        setIsLoading(false)
        return
      }

      // Validate email against disposable email list
      const emailValidation = await validateEmailAction(email);

      if (emailValidation.isDisposable) {
        setMessage(t('auth.disposableEmailBlocked'));
        setSentEmail(false)
        setIsLoading(false)

        // Reset captcha after failed validation (token was consumed)
        resetCaptcha()
        return;
      }

      if (!emailValidation.isValid && emailValidation.error) {
        setMessage(t('auth.emailValidationFailed'));
        setSentEmail(false)
        setIsLoading(false)

        // Reset captcha after failed validation (token was consumed)
        resetCaptcha()
        return;
      }

      // Dynamic redirect URL for Supabase auth
      const redirectUrl = `${siteUrl}/auth/callback`

      const supabase = await createClient()
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
          captchaToken: captchaToken || undefined,
        },
      })

      if (error) {
        setMessage(error.message)
        setSentEmail(false)

        // Reset captcha after ANY error (it was consumed in the failed request)
        resetCaptcha()
      } else {
        setSentEmail(true)
        setMessage(t('productView.checkEmailForMagicLink'))
      }
    } catch {
      setMessage(t('common.error'))
      setSentEmail(false)
    } finally {
      setIsLoading(false)
    }
  }

  // Function to reset captcha - simple and reliable
  const resetCaptcha = () => {
    setCaptchaToken(null)
    setCaptchaLoading(true) // Start loading immediately on reset (for invisible captcha)
    setCaptchaResetTrigger(prev => prev + 1)
  }

  // Form display before email is sent
  const renderLoginForm = () => (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gf-heading mb-2">
          {t('auth.email')}
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-4 py-3 bg-gf-float border border-gf-border rounded-xl text-gf-heading placeholder-gf-muted focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent transition-all"
          placeholder={demoMode ? 'demo@sellf.app' : t('auth.emailPlaceholder')}
        />
      </div>

      {/* Password field - demo mode only */}
      {demoMode && (
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gf-heading mb-2">
            {t('auth.password')}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-3 bg-gf-float border border-gf-border rounded-xl text-gf-heading placeholder-gf-muted focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent transition-all"
            placeholder={t('auth.passwordPlaceholder')}
          />
        </div>
      )}

      {/* Terms and Conditions Checkbox - not needed in demo */}
      {!demoMode && (
        <TermsCheckbox
          checked={termsAccepted}
          onChange={setTermsAccepted}
        />
      )}

      <button
        type="submit"
        disabled={isLoading || (!demoMode && captchaLoading)}
        className="w-full py-3 px-4 bg-gf-accent-bg hover:bg-gf-accent-hover text-white font-semibold rounded-full shadow-[var(--gf-shadow-accent)] hover:shadow-[0_6px_40px_-4px_var(--gf-accent-glow)] focus:outline-none focus:ring-2 focus:ring-gf-accent focus:ring-offset-2 focus:ring-offset-gf-deep transition-[background-color,box-shadow] duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {isLoading || (!demoMode && captchaLoading) ? (
          <div className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gf-heading" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {!demoMode && captchaLoading ? t('security.verifying') : (demoMode ? t('auth.signingIn') : t('productView.sendingMagicLink'))}
          </div>
        ) : (
          demoMode ? t('auth.signIn') : t('auth.sendMagicLink')
        )}
      </button>

      {/* Cloudflare Turnstile - not needed in demo */}
      {!demoMode && (
        <TurnstileWidget
          onVerify={(token) => {
            setCaptchaToken(token);
            setCaptchaLoading(false);
          }}
          onError={() => {
            setCaptchaToken(null);
            setCaptchaLoading(false);
          }}
          onTimeout={() => {
            setCaptchaLoading(false);
          }}
          resetTrigger={captchaResetTrigger}
        />
      )}

      {message && !sentEmail && (
        <div className="p-4 rounded-xl text-sm bg-gf-danger-soft text-gf-danger border border-gf-danger/20">
          {message}
        </div>
      )}
    </form>
  )

  // Success message after email is sent
  const renderSuccessMessage = () => {
    // Function to get email provider info
    const getEmailProviderInfo = (email: string): { name: string; domains: string[]; url: string; color: string } | null => {
      const domain = email.split('@')[1]?.toLowerCase()
      
      const providers = [
        {
          name: 'Gmail',
          domains: ['gmail.com', 'googlemail.com'],
          url: 'https://mail.google.com',
          color: 'from-red-500 to-red-600'
        },
        {
          name: 'Outlook',
          domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
          url: 'https://outlook.live.com',
          color: 'from-blue-500 to-blue-600'
        },
        {
          name: 'Yahoo',
          domains: ['yahoo.com', 'yahoo.co.uk', 'yahoo.de', 'yahoo.fr', 'ymail.com'],
          url: 'https://mail.yahoo.com',
          color: 'from-purple-500 to-purple-600'
        },
        {
          name: 'Apple Mail',
          domains: ['icloud.com', 'me.com', 'mac.com'],
          url: 'https://www.icloud.com/mail',
          color: 'from-gray-600 to-gray-700'
        },
        {
          name: 'Proton',
          domains: ['protonmail.com', 'proton.me'],
          url: 'https://mail.proton.me',
          color: 'from-indigo-500 to-indigo-600'
        }
      ]
      
      for (const provider of providers) {
        if (provider.domains.includes(domain)) {
          return provider
        }
      }
      
      // No fallback - return null for unsupported domains
      return null
    }

    const emailProvider = getEmailProviderInfo(email)
    
    return (
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <svg className="w-16 h-16 text-gf-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        
        <div className="p-4 rounded-xl text-sm bg-gf-success-soft text-gf-success border border-gf-success/20">
          {message}
        </div>
        
        <div className="text-gf-body text-sm space-y-3">
          <p>{t('productView.checkEmailAtForMagicLink', { email })}</p>
          <p>{t('auth.clickLinkToSignIn')}</p>
        </div>

        {/* Email Provider Buttons */}
        <div className="space-y-3">
          {emailProvider && (
            <button
              onClick={() => window.open(emailProvider.url, '_blank')}
              className="w-full py-3 px-4 bg-gf-accent-bg hover:bg-gf-accent-hover text-white font-semibold rounded-full shadow-[var(--gf-shadow-accent)] transition-colors duration-200 flex items-center justify-center space-x-2 active:scale-[0.98]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>{t('auth.openEmailProvider', { provider: emailProvider.name })}</span>
            </button>
          )}
          
          <button
            onClick={() => {
              setSentEmail(false)
              setMessage('')
              setEmail('')
              setTermsAccepted(false)
              setCaptchaToken(null)
            }}
            className="w-full py-2 px-4 bg-gf-float text-gf-body font-medium rounded-full border border-gf-border hover:border-gf-border-accent transition-[border-color] duration-200"
          >
            {t('auth.backToLogin')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gf-raised/80 rounded-2xl p-8 shadow-[var(--gf-shadow-accent)] border border-gf-border">
      {!sentEmail ? renderLoginForm() : renderSuccessMessage()}
    </div>
  )
}
