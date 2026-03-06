'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  cycleTheme: () => void
  /** True when admin forces light/dark via checkout_theme setting */
  isLocked: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'sf_theme'

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function isLockedTheme(adminTheme?: string): boolean {
  return adminTheme === 'light' || adminTheme === 'dark'
}

function readInitialTheme(adminTheme?: string): Theme {
  if (typeof window === 'undefined') return 'system'
  // When admin forces a theme, ignore user localStorage
  if (isLockedTheme(adminTheme)) return adminTheme as Theme
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  if (stored && ['light', 'dark', 'system'].includes(stored)) return stored
  if (adminTheme && ['light', 'dark', 'system'].includes(adminTheme)) return adminTheme as Theme
  return 'system'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme
}

function applyTheme(resolved: 'light' | 'dark') {
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

interface ThemeProviderProps {
  children: React.ReactNode
  adminTheme?: string
}

export function ThemeProvider({ children, adminTheme }: ThemeProviderProps) {
  const locked = isLockedTheme(adminTheme)

  // Lazy initializers read localStorage on client — avoids useEffect → setState re-render.
  // On server they return static defaults; ThemeScript handles FOUC prevention.
  const [theme, setThemeState] = useState<Theme>(() => readInitialTheme(adminTheme))
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(
    () => resolveTheme(readInitialTheme(adminTheme))
  )

  // Apply theme class on mount (ThemeScript already did this, but ensures consistency)
  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  // Listen for OS theme changes when in system mode
  useEffect(() => {
    if (locked) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'system') {
        const resolved = getSystemTheme()
        setResolvedTheme(resolved)
        applyTheme(resolved)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme, locked])

  const setTheme = useCallback((newTheme: Theme) => {
    if (locked) return
    setThemeState(newTheme)
    localStorage.setItem(STORAGE_KEY, newTheme)
    const resolved = newTheme === 'system' ? getSystemTheme() : newTheme
    setResolvedTheme(resolved)
    applyTheme(resolved)
    window.dispatchEvent(new CustomEvent('sf-theme-change', { detail: newTheme }))
  }, [locked])

  const cycleTheme = useCallback(() => {
    if (locked) return
    const order: Theme[] = ['system', 'light', 'dark']
    const next = order[(order.indexOf(theme) + 1) % order.length]
    setTheme(next)
  }, [theme, setTheme, locked])

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, cycleTheme, isLocked: locked }),
    [theme, resolvedTheme, setTheme, cycleTheme, locked]
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

/**
 * Inline script to prevent FOUC — inject into <head> before React hydration.
 * Reads localStorage and applies .dark class immediately.
 * Falls back to adminTheme from shop config when no user preference exists.
 */
export function ThemeScript({ adminTheme }: { adminTheme?: string }) {
  const forced = adminTheme === 'light' || adminTheme === 'dark'
  const script = forced
    ? `(function(){try{${adminTheme === 'dark' ? "document.documentElement.classList.add('dark')" : "document.documentElement.classList.remove('dark')"}}catch(e){}})();`
    : `
    (function() {
      try {
        var t = localStorage.getItem('${STORAGE_KEY}');
        var admin = ${JSON.stringify(adminTheme || null).replace(/<\//g, '<\\/')};
        if (t === 'dark' || t === 'light') {
          if (t === 'dark') document.documentElement.classList.add('dark');
        } else if (admin === 'dark' || admin === 'light') {
          if (admin === 'dark') document.documentElement.classList.add('dark');
        } else {
          if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
        }
      } catch(e) {}
    })();
  `
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
