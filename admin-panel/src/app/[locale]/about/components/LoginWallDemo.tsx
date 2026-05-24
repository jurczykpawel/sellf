'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Unlock, ArrowRight } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';

export function LoginWallDemo() {
  const t = useTranslations('landing.loginWallDemo');
  const [unlocked, setUnlocked] = useState(false);

  return (
    <section
      data-landing-section="login-wall"
      className="py-24 md:py-32 bg-sf-base"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-10">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">{t('subtitle')}</p>
        </Reveal>

        <Reveal animation="fade-up" delay={100}>
          <div className="rounded-2xl border border-sf-border-accent bg-sf-raised/80 overflow-hidden">
            {/* Mock browser chrome with URL bar */}
            <div className="px-4 py-2 border-b border-sf-border-accent bg-black/20 flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="block h-2.5 w-2.5 rounded-full bg-red-500/60" />
                <span className="block h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                <span className="block h-2.5 w-2.5 rounded-full bg-green-500/60" />
              </div>
              <div className="flex-1 rounded-full bg-sf-raised/60 border border-sf-border px-3 py-1 font-mono text-xs text-sf-muted truncate">
                <span>{t('urlPlaceholder')}</span>
                <span
                  data-token-fragment={unlocked ? 'present' : 'absent'}
                  className={`ml-1 transition-opacity duration-300 ${
                    unlocked ? 'text-sf-accent opacity-100' : 'opacity-0'
                  }`}
                >
                  #_sf_token=…
                </span>
              </div>
            </div>

            {/* Locked / unlocked content */}
            <div className="p-6 md:p-10 relative" data-wall-state={unlocked ? 'open' : 'locked'}>
              {/* Lock overlay */}
              {!unlocked && (
                <div className="absolute inset-0 z-10 bg-sf-deep/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-center p-6">
                  <div className="h-12 w-12 rounded-full bg-sf-accent-soft border border-sf-border-accent flex items-center justify-center">
                    <Lock className="h-6 w-6 text-sf-accent" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-sf-body max-w-md">{t('lockedBlurb')}</p>
                  <button
                    type="button"
                    onClick={() => setUnlocked(true)}
                    data-action="unlock"
                    className="inline-flex items-center gap-2 bg-sf-accent hover:bg-sf-accent-hover text-white rounded-full px-5 py-2.5 font-bold text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                  >
                    <Unlock className="h-4 w-4" aria-hidden="true" />
                    {t('unlockButton')}
                  </button>
                </div>
              )}

              {/* The "lesson" content — same DOM, blurred when locked */}
              <div
                className={`transition-[filter,opacity] duration-500 ${
                  unlocked ? 'blur-0 opacity-100' : 'blur-sm opacity-60'
                }`}
                aria-hidden={!unlocked}
              >
                <h3 className="text-2xl font-bold text-sf-heading mb-3">
                  {t('lockedTitle')}
                </h3>
                {unlocked && (
                  <div
                    data-unlocked-banner="show"
                    className="mb-4 inline-flex items-center gap-2 rounded-full bg-sf-success-soft border border-sf-success/30 px-3 py-1.5 text-xs font-mono text-sf-success animate-[checkoutFadeIn_360ms_ease-out_both]"
                  >
                    <Unlock className="h-3 w-3" aria-hidden="true" />
                    {t('unlockedHighlight')}
                  </div>
                )}
                {unlocked && (
                  <p className="text-xs text-sf-muted mb-4">
                    {t('unlockedSubtle')}
                  </p>
                )}
                <ul className="space-y-3 text-sf-body">
                  <li className="flex items-start gap-3">
                    <ArrowRight
                      className={`h-4 w-4 mt-1 flex-shrink-0 ${
                        unlocked ? 'text-sf-accent' : 'text-sf-muted'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{t('lockedBullet1')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <ArrowRight
                      className={`h-4 w-4 mt-1 flex-shrink-0 ${
                        unlocked ? 'text-sf-accent' : 'text-sf-muted'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{t('lockedBullet2')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <ArrowRight
                      className={`h-4 w-4 mt-1 flex-shrink-0 ${
                        unlocked ? 'text-sf-accent' : 'text-sf-muted'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{t('lockedBullet3')}</span>
                  </li>
                </ul>
                {/* Sweep highlight runs once on unlock */}
                {unlocked && (
                  <div className="relative h-px bg-sf-border my-6 overflow-hidden">
                    <span className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-sf-accent to-transparent animate-[accentSweep_1400ms_ease-out_both]" />
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-sf-border-accent bg-black/10 flex items-center justify-between">
              <p className="text-[11px] text-sf-muted">{t('demoNote')}</p>
              {unlocked && (
                <button
                  type="button"
                  onClick={() => setUnlocked(false)}
                  data-action="lock"
                  className="text-xs font-mono text-sf-muted hover:text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1"
                >
                  {t('lockButton')}
                </button>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
