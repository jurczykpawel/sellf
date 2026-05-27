'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Cloud,
  Globe,
  Server,
  Clock,
  MousePointerClick,
  DollarSign,
  Check,
  ExternalLink,
  Play,
  Key,
  Database,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import {
  SELLF_VERCEL_DEPLOY_URL,
  SELLF_NETLIFY_DEPLOY_URL,
  SELLF_QUICKSTART_URL,
} from '@/lib/constants';
import { DeployDemoModal, type DemoPathKey } from './DeployDemoModal';

interface PathConfig {
  key: DemoPathKey;
  icon: LucideIcon;
  href: string;
  highlighted: boolean;
  hasBadge: boolean;
  accent: 'vercel' | 'netlify' | 'vps';
}

const PATHS: PathConfig[] = [
  { key: 'vercel',  icon: Cloud,  href: SELLF_VERCEL_DEPLOY_URL,  highlighted: true,  hasBadge: true,  accent: 'vercel' },
  { key: 'netlify', icon: Globe,  href: SELLF_NETLIFY_DEPLOY_URL, highlighted: false, hasBadge: false, accent: 'netlify' },
  { key: 'vps',     icon: Server, href: SELLF_QUICKSTART_URL,     highlighted: false, hasBadge: false, accent: 'vps' },
];

export function DeployPaths() {
  const t = useTranslations('landing.deployPaths');
  const [openPath, setOpenPath] = useState<DemoPathKey | null>(null);

  const openModal = openPath ? PATHS.find((p) => p.key === openPath) ?? null : null;

  return (
    <section
      id="deploy-paths"
      className="py-24 md:py-32 bg-sf-deep"
      data-landing-section="deploy-paths"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-14">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-sf-body max-w-3xl mx-auto">
            {t('subtitle')}
          </p>
        </Reveal>

        {/* Shared prereqs — applies to all 3 paths. Surfaced once here
            instead of being repeated inside every tutorial. */}
        <Reveal animation="fade-up" delay={50}>
          <div className="max-w-3xl mx-auto mb-12">
            <p className="text-center text-xs font-mono uppercase tracking-wider text-sf-muted mb-3">
              {t('prereqs.label')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PrereqPill
                icon={Key}
                label={t('prereqs.stripe')}
                sub={t('prereqs.stripeSub')}
                tone="purple"
              />
              <PrereqPill
                icon={Database}
                label={t('prereqs.supabase')}
                sub={t('prereqs.supabaseSub')}
                tone="emerald"
              />
            </div>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {PATHS.map((path, i) => {
            const Icon = path.icon;
            const rawSteps = t.raw(`${path.key}.steps`);
            const steps: string[] = Array.isArray(rawSteps) ? (rawSteps as string[]) : [];

            const cardBaseClasses = path.highlighted
              ? 'border-2 border-sf-accent shadow-[var(--sf-shadow-accent)] ring-2 ring-sf-accent/20'
              : 'border border-sf-border shadow-[var(--sf-shadow)]';

            return (
              <Reveal key={path.key} animation="fade-up" delay={i * 120}>
                <button
                  type="button"
                  onClick={() => setOpenPath(path.key)}
                  className={`group relative flex flex-col h-full w-full text-left p-7 md:p-8 rounded-2xl bg-sf-raised/80 ${cardBaseClasses} transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-sf-accent hover:shadow-[0_12px_48px_-12px_var(--sf-accent-glow)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sf-accent cursor-pointer`}
                >
                  {path.hasBadge && (
                    <div className="absolute -top-3 left-6">
                      <span className="bg-sf-accent-bg text-white text-xs font-bold px-3 py-1 rounded-full shadow-[var(--sf-shadow-accent)]">
                        {t(`${path.key}.badge`)}
                      </span>
                    </div>
                  )}

                  {/* Header: icon + name */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 bg-sf-accent-soft rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-4deg]">
                      <Icon className="w-6 h-6 text-sf-accent" aria-hidden="true" />
                    </div>
                    <h3 className="text-xl font-bold text-sf-heading">
                      {t(`${path.key}.name`)}
                    </h3>
                  </div>

                  <p className="text-sf-body text-sm mb-5 leading-relaxed">
                    {t(`${path.key}.tagline`)}
                  </p>

                  {/* Metric pills: clicks · minutes · cost */}
                  <div className="grid grid-cols-3 gap-2 mb-5">
                    <MetricPill
                      icon={MousePointerClick}
                      value={t(`${path.key}.clicks`)}
                      label={t('clicksLabel')}
                    />
                    <MetricPill
                      icon={Clock}
                      value={t(`${path.key}.minutes`)}
                      label={t('minutesLabel')}
                    />
                    <MetricPill
                      icon={DollarSign}
                      value={t(`${path.key}.cost`)}
                      label={t('costLabel')}
                      accent
                    />
                  </div>

                  {/* Best for */}
                  <div className="mb-5 pb-5 border-b border-sf-border">
                    <p className="text-xs font-mono uppercase tracking-wider text-sf-muted mb-1.5">
                      {t('bestForLabel')}
                    </p>
                    <p className="text-sm text-sf-body leading-snug">
                      {t(`${path.key}.bestFor`)}
                    </p>
                  </div>

                  {/* Steps list with stagger on hover */}
                  <div className="mb-5 flex-1">
                    <p className="text-xs font-mono uppercase tracking-wider text-sf-muted mb-3">
                      {t('stepsLabel')}
                    </p>
                    <ol className="space-y-2">
                      {steps.map((step, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2.5 text-sm text-sf-body opacity-90 transition-[opacity,transform] duration-300 group-hover:opacity-100 motion-reduce:transition-none"
                          style={{
                            transitionDelay: `${idx * 40}ms`,
                          }}
                        >
                          <span className="shrink-0 w-5 h-5 rounded-full bg-sf-accent-soft text-sf-accent text-[10px] font-bold flex items-center justify-center mt-0.5 transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none">
                            {idx + 1}
                          </span>
                          <span className="leading-snug">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Footnote */}
                  <p className="text-[11px] text-sf-muted italic leading-snug mb-5">
                    {t(`${path.key}.footnote`)}
                  </p>

                  {/* Preview CTA */}
                  <div
                    className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition-[background-color,transform,box-shadow] duration-200 ${
                      path.highlighted
                        ? 'bg-sf-accent-bg text-white shadow-[var(--sf-shadow-accent)] group-hover:bg-sf-accent-hover'
                        : 'bg-sf-accent-soft border border-sf-border-accent text-sf-heading group-hover:bg-sf-accent-med'
                    }`}
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {t('previewLabel')}
                  </div>

                  {/* Tiny direct deploy link — bypass demo */}
                  <a
                    href={path.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-3 inline-flex items-center justify-center gap-1.5 text-[11px] text-sf-muted hover:text-sf-body transition-colors underline underline-offset-2"
                  >
                    {t(`${path.key}.ctaLabel`)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </button>
              </Reveal>
            );
          })}
        </div>

        {/* Honest reassurance footer */}
        <Reveal animation="fade-up" delay={400}>
          <div className="mt-12 max-w-3xl mx-auto text-center">
            <div className="inline-flex items-start gap-3 text-sm text-sf-body bg-sf-raised/60 border border-sf-border rounded-2xl px-5 py-4">
              <Check className="w-5 h-5 text-sf-success shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-left leading-relaxed">
                {t('reassurance')}
              </p>
            </div>
          </div>
        </Reveal>
      </div>

      {/* Demo modal — only mounts when open to keep idle perf clean.
          key={openModal.key} forces remount on path change → fresh state. */}
      {openModal && (
        <DeployDemoModal
          key={openModal.key}
          pathKey={openModal.key}
          open={openPath !== null}
          onClose={() => setOpenPath(null)}
          deployUrl={openModal.href}
          deployCtaLabel={t(`${openModal.key}.ctaLabel`)}
          accent={openModal.accent}
        />
      )}

      {/* Shared keyframes for visual mockup pulses */}
      <style jsx global>{`
        @keyframes demoPulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 16px -4px var(--sf-accent-glow);
          }
          50% {
            transform: scale(1.02);
            box-shadow: 0 0 32px -2px var(--sf-accent-glow);
          }
        }
        @keyframes demoNudge {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[demoPulse_1\\.6s_ease-in-out_infinite\\],
          .animate-\\[demoNudge_1\\.4s_ease-in-out_infinite\\] {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
}

interface MetricPillProps {
  icon: LucideIcon;
  value: string;
  label: string;
  accent?: boolean;
}

function MetricPill({ icon: Icon, value, label, accent = false }: MetricPillProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2.5 border ${
        accent
          ? 'bg-sf-success-soft border-sf-success/30'
          : 'bg-sf-float/60 border-sf-border'
      } transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none`}
    >
      <Icon
        className={`w-3.5 h-3.5 ${accent ? 'text-sf-success' : 'text-sf-accent'}`}
        aria-hidden="true"
      />
      <span className={`text-sm font-bold leading-none ${accent ? 'text-sf-success' : 'text-sf-heading'}`}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-sf-muted leading-none">
        {label}
      </span>
    </div>
  );
}

interface PrereqPillProps {
  icon: LucideIcon;
  label: string;
  sub: string;
  tone: 'purple' | 'emerald';
}

function PrereqPill({ icon: Icon, label, sub, tone }: PrereqPillProps) {
  const styles = tone === 'purple'
    ? { bg: 'bg-purple-500/10', border: 'border-purple-500/40', icon: 'text-purple-400' }
    : { bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', icon: 'text-emerald-400' };

  return (
    <div
      className={`flex items-center gap-3 rounded-xl ${styles.bg} ${styles.border} border px-4 py-3 transition-transform duration-300 hover:scale-[1.02] motion-reduce:transition-none`}
    >
      <div className={`w-9 h-9 rounded-lg ${styles.bg} ${styles.border} border flex items-center justify-center shrink-0`}>
        <Icon className={`w-4 h-4 ${styles.icon}`} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-sf-heading">{label}</p>
        <p className="text-xs text-sf-muted leading-snug">{sub}</p>
      </div>
      <Check className={`w-4 h-4 ${styles.icon} shrink-0`} aria-hidden="true" />
    </div>
  );
}
