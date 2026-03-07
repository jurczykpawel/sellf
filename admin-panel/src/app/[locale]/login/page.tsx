'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import LoginForm from '@/components/LoginForm'
import SiteMenu from '@/components/SiteMenu'
import { useConfig } from '@/components/providers/config-provider'

export default function LoginPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations()
  const { demoMode } = useConfig()
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard')
    }
  }, [user, loading, router])

  useEffect(() => {
    const error = searchParams.get('error')
    const message = searchParams.get('message')
    
    if (error === 'disposable_email') {
      setErrorMessage(t('auth.disposableEmailBlocked'))
    } else if (message === 'payment_completed_login_required') {
      setSuccessMessage(t('auth.paymentCompletedLoginRequired'))
    }
  }, [searchParams, t])

  if (loading) {
    return (
      <div className="min-h-screen bg-sf-deep flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-sf-raised/40 backdrop-blur-sm rounded-2xl mb-4">
            <svg className="w-8 h-8 text-sf-heading animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <p className="text-sf-heading text-lg">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  if (user) {
    return null // Will redirect in useEffect
  }

  return (
    <div className="min-h-screen bg-sf-deep flex items-center justify-center p-4">
      {/* CSS Animations */}
      <style jsx>{`
        @keyframes fadeInShake {
          0% { 
            opacity: 0; 
            transform: translateY(-10px) scale(0.95); 
          }
          60% { 
            opacity: 1; 
            transform: translateY(0) scale(1.02); 
          }
          80% { 
            transform: translateY(-2px) scale(1.01); 
          }
          90% { 
            transform: translateY(1px) scale(1); 
          }
          100% { 
            opacity: 1; 
            transform: translateY(0) scale(1); 
          }
        }
        
        .animate-fade-in-shake {
          animation: fadeInShake 0.8s ease-out forwards;
        }
      `}</style>
      
      <SiteMenu mode="floating" position="top-right" />
      
      <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]"></div>
      
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-sf-raised/40 backdrop-blur-sm rounded-2xl mb-4">
            <svg className="w-8 h-8 text-sf-heading" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-sf-heading mb-2">{t('auth.title')}</h1>
          <p className="text-sf-body">{t('auth.pleaseSignIn')}</p>

          {/* Demo mode credentials */}
          {demoMode && (
            <div className="mt-4 p-4 rounded-xl text-sm bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
              <div className="font-medium text-amber-800 dark:text-amber-200 mb-1">{t('demo.banner')}</div>
              <code className="text-xs font-mono">{t('demo.credentials')}</code>
            </div>
          )}

          {/* Success message for payment completed */}
          {successMessage && (
            <div className="mt-4 p-4 rounded-xl text-sm bg-green-500/10 text-green-400 border border-green-500/20 animate-fade-in-shake">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <div className="font-medium text-green-300">{t('auth.paymentCompletedLoginTitle')}</div>
                  <div className="mt-1">{successMessage}</div>
                </div>
              </div>
            </div>
          )}
          
          {/* Error message */}
          {errorMessage && (
            <div className="mt-4 p-4 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/20 animate-fade-in-shake">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>{errorMessage}</div>
              </div>
            </div>
          )}
        </div>
        
        <LoginForm />
      </div>
    </div>
  )
}
