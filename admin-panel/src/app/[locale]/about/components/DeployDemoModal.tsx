'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';

import { DemoVisual } from './deploy-demo-visuals';
import type { DemoVisualKind } from './deploy-demo-visuals';

export type DemoPathKey = 'vercel' | 'netlify' | 'vps';

interface SlideData {
  title: string;
  url: string;
  caption: string;
  visual: DemoVisualKind;
}

interface DeployDemoModalProps {
  pathKey: DemoPathKey;
  open: boolean;
  onClose: () => void;
  deployUrl: string;
  deployCtaLabel: string;
  accent: 'vercel' | 'netlify' | 'vps';
}

const AUTOPLAY_INTERVAL_MS = 5000;

export function DeployDemoModal({
  pathKey,
  open,
  onClose,
  deployUrl,
  deployCtaLabel,
  accent,
}: DeployDemoModalProps) {
  const t = useTranslations('landing.deployPaths.demo');
  const headingId = useId();

  const slides = useMemo(() => {
    const slidesKey =
      pathKey === 'vercel'
        ? 'vercelSlides'
        : pathKey === 'netlify'
          ? 'netlifySlides'
          : 'vpsSlides';
    const raw = t.raw(slidesKey);
    return Array.isArray(raw) ? (raw as SlideData[]) : [];
  }, [t, pathKey]);

  const titleKey =
    pathKey === 'vercel'
      ? 'vercelTitle'
      : pathKey === 'netlify'
        ? 'netlifyTitle'
        : 'vpsTitle';

  const [index, setIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Lock body scroll + focus close button on mount (modal is remounted on every
  // open via key prop in parent, so this runs once per open)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, slides.length - 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
        e.preventDefault();
        setAutoPlay((p) => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, goNext, goPrev]);

  const isLastSlide = index >= slides.length - 1;
  const effectiveAutoPlay = autoPlay && !isLastSlide;

  // Auto-advance — stops naturally on the last slide via effectiveAutoPlay
  useEffect(() => {
    if (!open || !effectiveAutoPlay) return;
    const timer = setTimeout(() => {
      setIndex((i) => Math.min(i + 1, slides.length - 1));
    }, AUTOPLAY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [open, effectiveAutoPlay, index, slides.length]);

  if (typeof document === 'undefined' || !open || slides.length === 0) return null;

  const slide = slides[index];
  const isLast = index === slides.length - 1;

  const accentClass =
    accent === 'vercel'
      ? 'from-zinc-900 to-zinc-800'
      : accent === 'netlify'
        ? 'from-teal-700 to-emerald-700'
        : 'from-sf-accent-bg to-sf-accent-hover';

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6 animate-[demoFadeIn_180ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-sf-deep border border-sf-border shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)] overflow-hidden"
      >
        {/* Top bar with progress + close */}
        <div className="flex flex-col gap-3 px-6 py-5 border-b border-sf-border bg-sf-raised/60">
          <div className="flex items-center justify-between gap-3">
            <h2 id={headingId} className="text-lg font-bold text-sf-heading truncate">
              {t(titleKey)}
            </h2>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label={t('closeLabel')}
              className="shrink-0 p-2 rounded-lg text-sf-muted hover:text-sf-heading hover:bg-sf-float transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-1.5" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={slides.length}>
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setAutoPlay(false);
                  setIndex(i);
                }}
                aria-label={`${t('slideOf', { current: i + 1, total: slides.length })}`}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none ${
                  i < index
                    ? 'bg-sf-accent'
                    : i === index
                      ? 'bg-sf-accent'
                      : 'bg-sf-float'
                } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent`}
              >
                {i === index && effectiveAutoPlay && (
                  <span
                    className="block h-full rounded-full bg-white/40 origin-left animate-[demoTick_5s_linear]"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Slide counter + accent gradient strip */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono uppercase tracking-wider text-sf-muted">
              {t('slideOf', { current: index + 1, total: slides.length })}
            </span>
            <div className={`h-1 w-16 rounded-full bg-gradient-to-r ${accentClass}`} aria-hidden="true" />
          </div>
        </div>

        {/* Slide body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 sm:py-8">
          <div key={index} className="animate-[demoSlideIn_300ms_ease-out]">
            {/* Browser chrome with URL */}
            <BrowserChrome url={slide.url} />

            {/* Visual mock */}
            <div className="mt-4 rounded-xl bg-sf-base border border-sf-border p-4 sm:p-6 min-h-[200px] flex items-center justify-center overflow-hidden">
              <DemoVisual kind={slide.visual} />
            </div>

            {/* Title + caption */}
            <div className="mt-6 space-y-2">
              <h3 className="text-xl sm:text-2xl font-bold text-sf-heading">
                {slide.title}
              </h3>
              <p className="text-sm sm:text-base text-sf-body leading-relaxed">
                {slide.caption}
              </p>
            </div>
          </div>
        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-sf-border bg-sf-raised/60">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={index === 0}
              aria-label={t('prevLabel')}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sf-heading bg-sf-float border border-sf-border hover:border-sf-border-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setAutoPlay((p) => !p)}
              aria-label={autoPlay ? t('pauseLabel') : t('playLabel')}
              aria-pressed={autoPlay}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sf-heading bg-sf-float border border-sf-border hover:border-sf-border-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
            >
              {autoPlay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={isLast}
              aria-label={t('nextLabel')}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-sf-heading bg-sf-float border border-sf-border hover:border-sf-border-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {isLast ? (
            <a
              href={deployUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-r ${accentClass} shadow-[var(--sf-shadow-accent)] hover:shadow-[0_6px_24px_-4px_var(--sf-accent-glow)] transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent`}
            >
              {deployCtaLabel}
              <ExternalLink className="w-4 h-4" />
            </a>
          ) : (
            <a
              href={deployUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs sm:text-sm text-sf-muted hover:text-sf-body transition-colors underline underline-offset-2"
            >
              {t('skipLabel')}
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes demoFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes demoSlideIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes demoTick {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[demoFadeIn_180ms_ease-out\\],
          .animate-\\[demoSlideIn_300ms_ease-out\\],
          .animate-\\[demoTick_5s_linear\\] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
}

function BrowserChrome({ url }: { url: string }) {
  const isTerminal = url.includes('terminal') || url.startsWith('root@');

  if (isTerminal) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
          </div>
          <span className="ml-2 text-xs font-mono text-zinc-400">{url}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sf-border bg-sf-float overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-sf-raised border-b border-sf-border">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
        </div>
        <div className="flex-1 ml-2 px-3 py-1 rounded text-xs font-mono text-sf-body bg-sf-base border border-sf-border truncate">
          {url}
        </div>
      </div>
    </div>
  );
}
