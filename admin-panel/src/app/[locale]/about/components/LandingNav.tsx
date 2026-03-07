'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Menu, X, Lock, Heart } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '@/contexts/AuthContext'
import SiteMenu from '@/components/SiteMenu'

export function LandingNav() {
  const t = useTranslations('landing')
  const { user, isAdmin } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const navLinks = [
    { label: t('nav.home'), href: '/store' },
    { label: t('nav.products'), href: '/store' },
    {
      label: t('nav.github'),
      href: 'https://github.com/jurczykpawel/sellf',
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
    <nav className="fixed top-0 left-0 right-0 z-50 bg-sf-raised/60 backdrop-blur-xl border-b border-sf-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link
            href="/store"
            className="flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded-lg"
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-sf-accent-bg">
              <Lock className="h-4 w-4 text-white" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sf-raised bg-sf-success">
                <span className="absolute inset-0 animate-ping rounded-full bg-sf-success opacity-75" />
              </span>
            </div>
            <span className="text-lg font-bold text-sf-accent">
              Sellf
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden lg:flex lg:items-center lg:gap-6">
            {navLinks.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-sf-body hover:text-sf-heading transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href + link.label}
                  href={link.href}
                  className="text-sm font-medium text-sf-body hover:text-sf-heading transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
                >
                  {link.label}
                </Link>
              )
            )}

            <a
              href="#"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-sf-accent hover:text-sf-accent transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
            >
              <Heart className="h-3.5 w-3.5" />
              {t('donate.title')}
            </a>

            <Link
              href={ctaLink.href}
              className="px-4 py-2 rounded-full text-sm font-semibold text-white bg-sf-accent-bg hover:bg-sf-accent-hover transition-[background-color,box-shadow] duration-200 shadow-[var(--sf-shadow-accent)] hover:shadow-[0_6px_30px_-4px_var(--sf-accent-glow)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
            >
              {ctaLink.label}
            </Link>

            <SiteMenu mode="inline" />
          </div>

          {/* Mobile: language switcher + hamburger */}
          <div className="flex items-center gap-3 lg:hidden">
            <SiteMenu mode="inline" />
            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              className="text-sf-body hover:text-sf-heading transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded-lg p-1"
              aria-label={t('nav.toggleMenu')}
              aria-expanded={mobileOpen}
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
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="lg:hidden border-t border-sf-border bg-sf-raised/95 backdrop-blur-xl overflow-hidden"
          >
            <div className="space-y-1 px-4 py-3">
              {navLinks.map((link) =>
                link.external ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg px-3 py-2 text-sm font-medium text-sf-body hover:text-sf-heading hover:bg-sf-accent-soft transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                    onClick={() => setMobileOpen(false)}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href + link.label}
                    href={link.href}
                    className="block rounded-lg px-3 py-2 text-sm font-medium text-sf-body hover:text-sf-heading hover:bg-sf-accent-soft transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                    onClick={() => setMobileOpen(false)}
                  >
                    {link.label}
                  </Link>
                )
              )}

              <a
                href="#"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sf-accent hover:text-sf-accent hover:bg-sf-accent-soft transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                onClick={() => setMobileOpen(false)}
              >
                <Heart className="h-3.5 w-3.5" />
                {t('donate.title')}
              </a>

              <Link
                href={ctaLink.href}
                className="mt-2 block rounded-full px-4 py-2 text-center text-sm font-semibold text-white bg-sf-accent-bg hover:bg-sf-accent-hover transition-[background-color,box-shadow] duration-200 shadow-[var(--sf-shadow-accent)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                onClick={() => setMobileOpen(false)}
              >
                {ctaLink.label}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
