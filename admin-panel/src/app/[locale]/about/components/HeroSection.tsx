'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowRight, Play, Github, CheckCircle } from 'lucide-react'
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
            'radial-gradient(ellipse at 20% 50%, var(--gf-accent-glow) 0%, transparent 60%)',
            'radial-gradient(ellipse at 80% 20%, rgba(0,170,255,0.10) 0%, transparent 50%)',
            'radial-gradient(ellipse at 50% 100%, rgba(0,170,255,0.06) 0%, transparent 40%)',
            'var(--gf-bg-deep)',
          ].join(', '),
        }}
      />

      {/* Static soft glow — no animated blurs */}
      <div className="absolute top-16 left-[15%] w-[28rem] h-[28rem] rounded-full bg-gf-accent/[0.06] blur-3xl" />
      <div className="absolute top-32 right-[10%] w-[24rem] h-[24rem] rounded-full bg-gf-accent/[0.04] blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="inline-flex items-center gap-2 rounded-full bg-gf-raised/60 backdrop-blur-md border border-gf-border px-4 py-2 mb-8"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gf-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-gf-success" />
          </span>
          <span className="text-sm font-medium text-gf-body">
            {t('hero.badge')}
          </span>
        </motion.div>

        {/* Headline — bold sans-serif, Apple-style */}
        <h1 className="mb-8">
          <TextReveal
            text={t('hero.headlineTop')}
            className="block text-5xl md:text-7xl lg:text-8xl tracking-[-0.04em] text-gf-heading"
            wordClassName="font-bold"
            delay={0.2}
          />
          <TextReveal
            text={t('hero.headlineBottom')}
            className="block text-5xl md:text-7xl lg:text-8xl tracking-[-0.04em]"
            wordClassName="font-bold text-gf-accent"
            delay={0.5}
          />
        </h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="text-xl md:text-2xl text-gf-body max-w-4xl mx-auto leading-relaxed mb-12"
        >
          {t.rich('hero.subtitle', {
            selfHosted: (chunks) => (
              <span className="font-semibold text-gf-heading">{chunks}</span>
            ),
            secure: (chunks) => (
              <span className="font-semibold text-gf-heading">{chunks}</span>
            ),
            yours: (chunks) => (
              <span className="font-semibold text-gf-heading">{chunks}</span>
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
            className="group inline-flex items-center gap-2 bg-gf-accent hover:bg-gf-accent-hover text-white rounded-xl px-8 py-4 text-lg font-bold transition-[background-color,transform,box-shadow] duration-200 shadow-[var(--gf-shadow-accent)] hover:shadow-[0_6px_40px_-4px_var(--gf-accent-glow)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent"
          >
            {t('hero.ctaDeploy')}
            <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>

          <a
            href="https://gateflow.cytr.us/login"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-gf-accent-soft border border-gf-border-accent hover:bg-gf-accent-med text-gf-heading rounded-xl px-8 py-4 text-lg font-bold transition-[background-color,border-color] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent"
          >
            <Play className="h-5 w-5" />
            {t('hero.ctaDemo')}
          </a>

          <a
            href="https://github.com/jurczykpawel/gateflow"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-gf-raised/60 backdrop-blur-sm border border-gf-border hover:border-gf-border-accent text-gf-heading rounded-xl px-8 py-4 text-lg font-bold transition-[border-color,background-color] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent"
          >
            <Github className="h-5 w-5" />
            {t('hero.ctaGithub')}
            <span className="ml-1 rounded-full bg-gf-float px-2 py-0.5 text-xs font-medium text-gf-muted">
              MIT
            </span>
          </a>
        </motion.div>

        {/* Trust indicators */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3, duration: 0.6 }}
          className="flex flex-wrap justify-center items-center gap-8 text-sm text-gf-muted"
        >
          {trustItems.map((item) => (
            <div key={item} className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-gf-success" />
              <span>{item}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
