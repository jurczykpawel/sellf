'use client'

import { useRef, useState, useTransition, useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/components/providers/theme-provider'
import { locales } from '@/lib/locales'

const languages = {
  en: { name: 'English', flag: '🇺🇸' },
  pl: { name: 'Polski', flag: '🇵🇱' },
}

interface SiteMenuProps {
  position?: 'top-right' | 'top-left'
  mode?: 'floating' | 'inline'
}

export default function SiteMenu({
  position = 'top-right',
  mode = 'floating',
}: SiteMenuProps) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const { user, signOut, loading: authLoading } = useAuth()
  const t = useTranslations('navigation')
  const { theme, setTheme, isLocked } = useTheme()
  const [isPending, startTransition] = useTransition()
  const [isOpen, setIsOpen] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openMenu = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setIsOpen(true)
  }, [])

  const closeMenu = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 150)
  }, [])

  const handleLanguageChange = (newLocale: string) => {
    startTransition(() => {
      document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=Lax`
      const segments = pathname.split('/').filter(Boolean)
      const currentLocale = segments[0]
      let newPath = ''
      if (locales.includes(currentLocale as (typeof locales)[number])) {
        newPath = `/${newLocale}/${segments.slice(1).join('/')}`
      } else {
        newPath = `/${newLocale}${pathname}`
      }
      router.push(newPath)
      setIsOpen(false)
    })
  }

  const positionClasses: Record<NonNullable<SiteMenuProps['position']>, string> = {
    'top-right': 'top-4 right-4 sm:top-6 sm:right-6',
    'top-left': 'top-4 left-4 sm:top-6 sm:left-6',
  }

  const dropdownAlignClass = position === 'top-left' ? 'left-0' : 'right-0'

  const trigger = (
    <button
      aria-label={t('userMenu')}
      aria-expanded={isOpen}
      aria-haspopup="menu"
      className="flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-sf-accent"
    >
      {user ? (
        <div className="w-9 h-9 bg-sf-accent-bg rounded-full flex items-center justify-center shadow-[var(--sf-shadow-accent)]">
          <span className="text-white text-sm font-semibold leading-none">
            {user.email?.charAt(0).toUpperCase()}
          </span>
        </div>
      ) : (
        <div className="w-9 h-9 bg-sf-raised border-2 border-sf-border-medium rounded-full flex items-center justify-center hover:border-sf-border-strong transition-colors">
          <svg className="w-4 h-4 text-sf-muted" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </button>
  )

  const dropdown = isOpen && (
    <div
      onMouseEnter={openMenu}
      onMouseLeave={closeMenu}
      className={`absolute z-50 mt-2 w-52 rounded-2xl bg-sf-base border-2 border-sf-border-medium shadow-xl overflow-hidden ${dropdownAlignClass}`}
      role="menu"
    >
      {/* Language section */}
      <div className="p-2">
        {Object.entries(languages).map(([code, lang]) => (
          <button
            key={code}
            onClick={() => handleLanguageChange(code)}
            disabled={isPending}
            role="menuitem"
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
              locale === code
                ? 'bg-sf-accent-soft text-sf-accent font-medium'
                : 'text-sf-body hover:bg-sf-hover hover:text-sf-heading'
            }`}
          >
            <span className="text-base leading-none">{lang.flag}</span>
            <span>{lang.name}</span>
            {locale === code && (
              <svg className="w-3.5 h-3.5 ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        ))}
      </div>

      <div className="border-t border-sf-border mx-2" />

      {/* User section — hidden while auth is loading to prevent false "Login" */}
      {!authLoading && <div className="p-2">
        {user ? (
          <>
            <div className="px-3 py-1.5 text-xs text-sf-muted truncate">{user.email}</div>
            <button
              onClick={() => { setIsOpen(false); router.push('/my-products') }}
              role="menuitem"
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-sf-body hover:bg-sf-hover hover:text-sf-heading transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              {t('myProducts')}
            </button>
            <button
              onClick={() => { setIsOpen(false); signOut(); window.location.reload() }}
              role="menuitem"
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-sf-body hover:bg-sf-hover hover:text-sf-heading transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
              {t('logout')}
            </button>
          </>
        ) : (
          <button
            onClick={() => { setIsOpen(false); router.push('/login') }}
            role="menuitem"
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-sf-body hover:bg-sf-hover hover:text-sf-heading transition-colors"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            {t('login')}
          </button>
        )}
      </div>}

      {/* Theme section */}
      {!isLocked && (
        <>
          <div className="border-t border-sf-border mx-2" />
          <div className="p-2">
            <div className="flex items-center gap-1 p-1 bg-sf-raised rounded-xl">
              {(
                [
                  { value: 'light', emoji: '☀️' },
                  { value: 'dark', emoji: '🌙' },
                  { value: 'system', emoji: '🖥️' },
                ] as const
              ).map(({ value, emoji }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  aria-label={t('themeLabel', { theme: value })}
                  title={t('themeLabel', { theme: value })}
                  role="menuitem"
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-lg text-sm transition-all duration-150 ${
                    theme === value
                      ? 'bg-sf-base shadow-sm'
                      : 'text-sf-muted hover:text-sf-body'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )

  const container = (
    <div
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={closeMenu}
    >
      {trigger}
      {dropdown}
    </div>
  )

  if (mode === 'inline') return container

  return (
    <div className={`fixed ${positionClasses[position]} z-50`}>
      {container}
    </div>
  )
}
