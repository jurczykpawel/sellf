'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowRight, Play, CheckCircle } from 'lucide-react'
import { motion } from 'motion/react'
import { TextReveal } from './motion/TextReveal'

export function HeroSection() {
  const t = useTranslations('landing')

  const trustItems = [
    t('hero.trustNoFees'),
    t('hero.trustOwnData'),
    t('hero.trustDeployAnywhere'),
    t('hero.trustSecurity'),
  ]

  return (
    <section className="relative pt-32 pb-20 md:pb-32 overflow-hidden">
      {/* Mesh gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse at 20% 50%, var(--sf-accent-glow) 0%, transparent 60%)',
            'radial-gradient(ellipse at 80% 20%, rgba(0,170,255,0.10) 0%, transparent 50%)',
            'radial-gradient(ellipse at 50% 100%, rgba(0,170,255,0.06) 0%, transparent 40%)',
            'var(--sf-bg-deep)',
          ].join(', '),
        }}
      />

      {/* Static soft glow — no animated blurs */}
      <div className="absolute top-16 left-[15%] w-[28rem] h-[28rem] rounded-full bg-sf-accent/[0.06] blur-3xl" />
      <div className="absolute top-32 right-[10%] w-[24rem] h-[24rem] rounded-full bg-sf-accent/[0.04] blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="inline-flex items-center gap-2 rounded-full bg-sf-raised/60 backdrop-blur-md border border-sf-border px-4 py-2 mb-8"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sf-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-sf-success" />
          </span>
          <span className="text-sm font-medium text-sf-body">
            {t('hero.badge')}
          </span>
        </motion.div>

        {/* Headline — bold sans-serif, Apple-style */}
        <h1 className="mb-8">
          <TextReveal
            text={t('hero.headlineTop')}
            className="block text-5xl md:text-7xl lg:text-8xl tracking-[-0.04em] text-sf-heading"
            wordClassName="font-bold"
            delay={0.2}
          />
          <TextReveal
            text={t('hero.headlineBottom')}
            className="block text-5xl md:text-7xl lg:text-8xl tracking-[-0.04em]"
            wordClassName="font-bold text-sf-accent"
            delay={0.5}
          />
        </h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="text-xl md:text-2xl text-sf-body max-w-4xl mx-auto leading-relaxed mb-12"
        >
          {t.rich('hero.subtitle', {
            selfHosted: (chunks) => (
              <span className="font-semibold text-sf-heading">{chunks}</span>
            ),
            secure: (chunks) => (
              <span className="font-semibold text-sf-heading">{chunks}</span>
            ),
            yours: (chunks) => (
              <span className="font-semibold text-sf-heading">{chunks}</span>
            ),
          })}
          <br />
          {t('hero.subtitleBottom')}
        </motion.p>

        {/* CTA buttons — staggered */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16"
        >
          <Link
            href="#deployment"
            className="group inline-flex items-center gap-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white rounded-full px-8 py-4 text-lg font-bold transition-[background-color,transform,box-shadow] duration-200 shadow-[var(--sf-shadow-accent)] hover:shadow-[0_6px_40px_-4px_var(--sf-accent-glow)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
          >
            {t('hero.ctaDeploy')}
            <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>

          <a
            href="https://demo.sellf.app/login"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-sf-accent-soft border border-sf-border-accent hover:bg-sf-accent-med text-sf-heading rounded-full px-8 py-4 text-lg font-bold transition-[background-color,border-color] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
          >
            <Play className="h-5 w-5" />
            {t('hero.ctaDemo')}
          </a>
        </motion.div>

        {/* Product screenshot */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="hidden md:block mb-16"
        >
          <div className="relative mx-auto max-w-5xl rounded-2xl border border-sf-border shadow-2xl overflow-hidden">
            <Image
              src="/screenshots/dashboard.png"
              alt="Sellf Admin Dashboard"
              width={1920}
              height={1080}
              priority
              className="w-full h-auto dark:hidden"
            />
            <Image
              src="/screenshots/dashboard-dark.png"
              alt="Sellf Admin Dashboard"
              width={1920}
              height={1080}
              className="w-full h-auto hidden dark:block"
            />
          </div>
        </motion.div>

        {/* Trust indicators */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3, duration: 0.6 }}
          className="flex flex-wrap justify-center items-center gap-8 text-sm text-sf-muted"
        >
          {trustItems.map((item) => (
            <div key={item} className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-sf-success" />
              <span>{item}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
