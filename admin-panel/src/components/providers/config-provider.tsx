'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

interface AppConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  stripePublishableKey: string
  cloudflareSiteKey: string
  captchaProvider: 'turnstile' | 'altcha' | 'none'
  siteUrl: string
  demoMode: boolean
  oauthProviders: string[]
}

const ConfigContext = createContext<AppConfig | null>(null)

const CONFIG_CACHE_KEY = 'sf_runtime_config'
const CONFIG_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function getCachedConfig(): AppConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const cached = sessionStorage.getItem(CONFIG_CACHE_KEY)
    if (!cached) return null
    const { data, timestamp } = JSON.parse(cached)
    if (Date.now() - timestamp > CONFIG_CACHE_TTL) {
      sessionStorage.removeItem(CONFIG_CACHE_KEY)
      return null
    }
    return data
  } catch {
    return null
  }
}

function setCachedConfig(data: AppConfig): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // Ignore storage errors
  }
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  // Start with null/true to match server render - check cache only after mount
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Check cache first on client side
    const cached = getCachedConfig()
    if (cached) {
      setConfig(cached)
      setLoading(false)
    }

    // Always fetch fresh config
    fetch('/api/runtime-config')
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load config: ${res.status}`)
        }
        return res.json()
      })
      .then(data => {
        setConfig(data)
        setCachedConfig(data)
        setLoading(false)
      })
      .catch(err => {
        // Only show error if we don't have cached config
        if (!cached) {
          setError(err.message)
        }
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-sf-deep flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-sf-accent/15 border border-sf-border-accent mb-4">
            <svg className="w-8 h-8 text-sf-accent animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <p className="text-sf-heading text-lg">Loading...</p>
          <p className="text-sf-muted text-sm mt-2">Loading configuration...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-sf-deep flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-sf-danger/15 border border-sf-danger/30 mb-4">
            <svg className="w-8 h-8 text-sf-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-sf-danger text-xl font-semibold mb-2">Configuration Error</h2>
          <p className="text-sf-body text-sm mb-4">Unable to load application configuration. Please check your connection and try again.</p>
          <p className="text-sf-muted text-xs font-mono bg-sf-danger-soft p-3">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-sf-danger/20 text-sf-danger hover:bg-sf-danger/30 transition-colors duration-200"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <ConfigContext.Provider value={config}>
      {children}
    </ConfigContext.Provider>
  )
}

export const useConfig = () => {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error('useConfig must be used within ConfigProvider')
  }
  return context
}
