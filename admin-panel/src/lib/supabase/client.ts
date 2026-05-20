import { createBrowserClient } from '@supabase/ssr'

interface RuntimeConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  stripePublishableKey: string
  siteUrl: string
  demoMode: boolean
}

// Shared cache key with ConfigProvider
const CONFIG_CACHE_KEY = 'sf_runtime_config'
const CONFIG_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Runtime configuration with aggressive caching
let cachedConfig: RuntimeConfig | null = null
let configPromise: Promise<RuntimeConfig> | null = null

// Check sessionStorage cache (shared with ConfigProvider)
function getSessionStorageConfig(): RuntimeConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const cached = sessionStorage.getItem(CONFIG_CACHE_KEY)
    if (!cached) return null
    const { data, timestamp } = JSON.parse(cached)
    if (Date.now() - timestamp > CONFIG_CACHE_TTL) return null
    return data
  } catch {
    return null
  }
}

async function getRuntimeConfig(): Promise<RuntimeConfig> {
  // Return cached config immediately if available
  if (cachedConfig) return cachedConfig

  // Check sessionStorage (might have been set by ConfigProvider)
  const sessionConfig = getSessionStorageConfig()
  if (sessionConfig) {
    cachedConfig = sessionConfig
    return sessionConfig
  }

  // Return existing promise if already fetching
  if (configPromise) return configPromise

  configPromise = (async () => {
    try {
      const response = await fetch('/api/runtime-config', {
        // Add caching headers
        cache: 'force-cache',
        next: { revalidate: 300 } // Cache for 5 minutes
      })
      if (response.ok) {
        const config = await response.json()
        cachedConfig = config
        return config
      }
    } catch (error) {
      console.error('Failed to load runtime config:', error)
    }

    // Fallback to environment variables (if any exist)
    const fallbackConfig = {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'demo-key',
      stripePublishableKey: '',
      siteUrl: 'http://localhost:3000',
      demoMode: false,
    }
    cachedConfig = fallbackConfig
    return fallbackConfig
  })()

  return configPromise
}

let clientPromise: Promise<ReturnType<typeof createBrowserClient>> | null = null

export function createClient() {
  // Only create browser client on the client side
  if (typeof window === 'undefined') {
    throw new Error('createClient() can only be used in browser context')
  }

  if (!clientPromise) {
    clientPromise = getRuntimeConfig().then(config => {
      return createBrowserClient(config.supabaseUrl, config.supabaseAnonKey)
    })
  }
  return clientPromise
}

// Pre-load config on module import (performance boost)
// Only in production to avoid development issues
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  getRuntimeConfig().catch(() => {
    // Ignore errors during preload
  })
}
