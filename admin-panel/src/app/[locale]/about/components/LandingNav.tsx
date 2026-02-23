'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Menu, X, Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import FloatingLanguageSwitcher from '@/components/FloatingLanguageSwitcher'

export function LandingNav() {
  const t = useTranslations('landing')
  const { user, isAdmin } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const navLinks = [
    { label: t('nav.home'), href: '/store' },
    { label: t('nav.products'), href: '/store' },
    {
      label: t('nav.github'),
      href: 'https://github.com/jurczykpawel/gateflow',
      external: true,
    },
  ]

  const ctaLink = (() => {
    if (user && isAdmin) {
      return { label: t('nav.dashboard'), href: '/dashboard' }
    }
    if (user) {
      return { label: t('nav.myProducts'), href: '/my-products' }
    }
    return { label: t('nav.getStarted'), href: '/login' }
  })()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/store" className="flex items-center gap-2">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[#00AAFF]">
              <Lock className="h-4 w-4 text-white" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-gray-900 bg-green-500">
                <span className="absolute inset-0 animate-ping rounded-full bg-green-400 opacity-75" />
              </span>
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-[#00AAFF] to-[#0088CC] bg-clip-text text-transparent">
              GateFlow
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex md:items-center md:gap-6">
            {navLinks.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#00AAFF] transition-colors"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href + link.label}
                  href={link.href}
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#00AAFF] transition-colors"
                >
                  {link.label}
                </Link>
              )
            )}

            <Link
              href={ctaLink.href}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#00AAFF] hover:bg-[#0088CC] transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
            >
              {ctaLink.label}
            </Link>

            <FloatingLanguageSwitcher mode="static" variant="compact" />
          </div>

          {/* Mobile: language switcher + hamburger */}
          <div className="flex items-center gap-3 md:hidden">
            <FloatingLanguageSwitcher mode="static" variant="compact" />
            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              className="text-gray-700 dark:text-gray-300 hover:text-[#00AAFF] transition-colors"
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl">
          <div className="space-y-1 px-4 py-3">
            {navLinks.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#00AAFF] hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href + link.label}
                  href={link.href}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#00AAFF] hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              )
            )}

            <Link
              href={ctaLink.href}
              className="mt-2 block rounded-lg px-4 py-2 text-center text-sm font-semibold text-white bg-[#00AAFF] hover:bg-[#0088CC] transition-all duration-200 shadow-lg"
              onClick={() => setMobileOpen(false)}
            >
              {ctaLink.label}
            </Link>
          </div>
        </div>
      )}
    </nav>
  )
}
