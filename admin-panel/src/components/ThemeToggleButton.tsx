'use client'

import { useTranslations } from 'next-intl'
import { useTheme } from '@/components/providers/theme-provider'

interface ThemeToggleButtonProps {
  size?: 'sm' | 'md'
}

export default function ThemeToggleButton({ size = 'md' }: ThemeToggleButtonProps) {
  const t = useTranslations('navigation')
  const { theme, resolvedTheme, cycleTheme } = useTheme()

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const buttonSize = size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'

  return (
    <button
      onClick={cycleTheme}
      className={`relative flex items-center justify-center ${buttonSize} hover:bg-gray-100 dark:hover:bg-white/20 rounded-full transition-all duration-200 hover:scale-105`}
      aria-label={t('themeLabel', { theme })}
      title={t('themeLabel', { theme })}
    >
      {resolvedTheme === 'dark' ? (
        <svg className={`${iconSize} text-yellow-300`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ) : (
        <svg className={`${iconSize} text-gray-500 dark:text-gray-300`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      )}
      {theme === 'system' && (
        <span className={`absolute -bottom-0.5 -right-0.5 ${dotSize} bg-blue-400 rounded-full border border-white/20`} />
      )}
    </button>
  )
}
