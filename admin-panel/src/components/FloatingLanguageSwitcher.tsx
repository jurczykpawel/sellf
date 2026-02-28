'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import { useState, useTransition, useRef, useEffect } from 'react'
import { locales } from '@/lib/locales'

const languages = {
  en: { name: 'English', flag: '🇺🇸', short: 'EN' },
  pl: { name: 'Polski', flag: '🇵🇱', short: 'PL' }
}

interface FloatingLanguageSwitcherProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  variant?: 'minimal' | 'compact' | 'discrete'
  mode?: 'floating' | 'static'
}

export default function FloatingLanguageSwitcher({ 
  position = 'top-right',
  variant = 'discrete',
  mode = 'floating'
}: FloatingLanguageSwitcherProps) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('navigation')
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [containerRef])

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

  const positionClasses = {
    'top-right': 'top-4 right-4 sm:top-6 sm:right-6',
    'top-left': 'top-4 left-4 sm:top-6 sm:left-6',
    'bottom-right': 'bottom-4 right-4 sm:bottom-6 sm:right-6',
    'bottom-left': 'bottom-4 left-4 sm:bottom-6 sm:left-6'
  }

  const currentLanguage = languages[locale as keyof typeof languages]

  const wrapperClasses = mode === 'floating' 
    ? `fixed ${positionClasses[position]} z-50` 
    : 'relative inline-block';

  // Base button styles - adjusted for both light/dark mode compatibility
  const buttonBaseClasses = mode === 'floating'
    // Floating style (dark overlay typically)
    ? 'bg-black/20 backdrop-blur-sm border-white/10 hover:bg-black/30 hover:border-white/20 text-white'
    // Static style (fits into layout, handles light/dark)
    : 'bg-gf-base border-gf-border hover:bg-gf-hover text-gf-body';

  return (
    <div className={wrapperClasses} ref={containerRef}>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isPending}
          className={`
            group flex items-center justify-center gap-2 border rounded-lg transition-all duration-200 shadow-sm
            ${buttonBaseClasses}
            ${isPending ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}
            ${variant === 'discrete' ? 'p-2' : 'px-3 py-2'}
          `}
          aria-label={t('switchLanguage')}
        >
          <span className="text-lg leading-none">{currentLanguage.flag}</span>
          {variant !== 'discrete' && (
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">
              {currentLanguage.short}
            </span>
          )}
          <svg
            className={`w-3 h-3 opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className={`
            absolute mt-2 w-32 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200
            ${mode === 'floating' 
              ? 'top-full right-0 bg-black/40 backdrop-blur-md border border-white/20' 
              : 'top-full right-0 bg-gf-base border border-gf-border'}
          `}>
            <div className="p-1">
              {Object.entries(languages).map(([code, lang]) => (
                <button
                  key={code}
                  onClick={() => handleLanguageChange(code)}
                  className={`
                    flex items-center gap-3 w-full px-3 py-2 text-sm rounded-lg transition-colors
                    ${mode === 'floating'
                      ? (locale === code ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white')
                      : (locale === code ? 'bg-gf-accent-soft text-gf-accent' : 'text-gf-body hover:bg-gf-hover')
                    }
                  `}
                >
                  <span className="text-base leading-none">{lang.flag}</span>
                  <span className="font-medium text-xs">{lang.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}