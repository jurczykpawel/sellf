'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowRight, Play, Github, CheckCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export function HeroSection() {
  const t = useTranslations('landing')
  useAuth()

  const trustItems = [
    t('hero.trustNoFees'),
    t('hero.trustOwnData'),
    t('hero.trustDeployAnywhere'),
    t('hero.trustSecurity'),
  ]

  return (
    <section className="relative pt-32 pb-20 md:pb-32 overflow-hidden">
      {/* Animated gradient mesh background */}
      <div className="absolute inset-0 bg-gradient-to-br from-sky-50 via-blue-50 to-cyan-50 dark:from-gray-900 dark:via-gray-950 dark:to-gray-900">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-sky-300 dark:bg-sky-800 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-3xl opacity-30 animate-blob" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-cyan-300 dark:bg-cyan-800 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-3xl opacity-30 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-32 left-1/3 w-96 h-96 bg-blue-300 dark:bg-blue-800 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-3xl opacity-30 animate-blob animation-delay-4000" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 rounded-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-sky-200 dark:border-sky-800 px-4 py-2 mb-8">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('hero.badge')}
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-gray-900 dark:text-white mb-8">
          {t('hero.headlineTop')}
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00AAFF] to-blue-600 animate-gradient">
            {t('hero.headlineBottom')}
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-300 max-w-4xl mx-auto leading-relaxed mb-12">
          {t.rich('hero.subtitle', {
            selfHosted: (chunks) => (
              <span className="font-semibold text-gray-900 dark:text-white">{chunks}</span>
            ),
            secure: (chunks) => (
              <span className="font-semibold text-gray-900 dark:text-white">{chunks}</span>
            ),
            yours: (chunks) => (
              <span className="font-semibold text-gray-900 dark:text-white">{chunks}</span>
            ),
          })}
          <br />
          {t('hero.subtitleBottom')}
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Link
            href="#deployment"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-[#00AAFF] to-blue-600 hover:from-[#0088CC] hover:to-blue-700 text-white shadow-2xl hover:shadow-sky-500/50 rounded-xl px-8 py-4 text-lg font-bold transition-all duration-200"
          >
            {t('hero.ctaDeploy')}
            <ArrowRight className="h-5 w-5" />
          </Link>

          <a
            href="https://gateflow.cytr.us/login"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#00AAFF]/20 border-2 border-sky-400 dark:border-sky-500 hover:bg-[#00AAFF]/30 text-white rounded-xl px-8 py-4 text-lg font-bold transition-all duration-200"
          >
            <Play className="h-5 w-5" />
            {t('hero.ctaDemo')}
          </a>

          <a
            href="https://github.com/jurczykpawel/gateflow"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 hover:border-sky-300 dark:hover:border-sky-600 text-gray-900 dark:text-white rounded-xl px-8 py-4 text-lg font-bold transition-all duration-200"
          >
            <Github className="h-5 w-5" />
            {t('hero.ctaGithub')}
            <span className="ml-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300">
              MIT
            </span>
          </a>
        </div>

        {/* Trust indicators */}
        <div className="flex flex-wrap justify-center items-center gap-8 text-sm text-gray-600 dark:text-gray-400">
          {trustItems.map((item) => (
            <div key={item} className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
