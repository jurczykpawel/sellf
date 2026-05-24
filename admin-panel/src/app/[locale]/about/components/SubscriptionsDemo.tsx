'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Play, Pause, RotateCcw, Check, X, Repeat } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';

type Status = 'idle' | 'trial' | 'active' | 'retrying' | 'cancelled';

interface MonthEvent {
  month: number;
  status: Status;
  /** Translation-key sub for the "tag" pill */
  tag: 'trial' | 'active' | 'retrying' | 'cancelled';
  /** PLN amount captured this month (positive = charge, negative = refund) */
  amount: number;
  /** Optional note shown under the month chip */
  noteKey?: 'cardFailed' | 'cardRetrySuccess' | 'customerCancels' | 'proratedRefund';
}

const MONTHLY = 129;

const TIMELINE: MonthEvent[] = [
  { month: 0, status: 'trial',     tag: 'trial',     amount: 0 },
  { month: 1, status: 'active',    tag: 'active',    amount: MONTHLY }, // first charge
  { month: 2, status: 'active',    tag: 'active',    amount: MONTHLY },
  { month: 3, status: 'active',    tag: 'active',    amount: MONTHLY },
  { month: 4, status: 'retrying',  tag: 'retrying',  amount: 0,           noteKey: 'cardFailed' },
  { month: 4, status: 'active',    tag: 'active',    amount: MONTHLY,     noteKey: 'cardRetrySuccess' },
  { month: 5, status: 'active',    tag: 'active',    amount: MONTHLY },
  { month: 6, status: 'active',    tag: 'active',    amount: MONTHLY },
  { month: 7, status: 'active',    tag: 'active',    amount: MONTHLY },
  { month: 8, status: 'active',    tag: 'active',    amount: MONTHLY },
  { month: 9, status: 'active',    tag: 'active',    amount: MONTHLY },
  { month: 10, status: 'active',   tag: 'active',    amount: MONTHLY },
  { month: 11, status: 'cancelled', tag: 'cancelled', amount: 0,           noteKey: 'customerCancels' },
  { month: 11, status: 'cancelled', tag: 'cancelled', amount: -64,        noteKey: 'proratedRefund' },
];

const STEP_MS = 700;

function statusColor(status: Status): string {
  switch (status) {
    case 'trial':
      return 'bg-sf-muted/30 border-sf-muted text-sf-muted';
    case 'active':
      return 'bg-sf-success-soft border-sf-success/40 text-sf-success';
    case 'retrying':
      return 'bg-yellow-500/15 border-yellow-500/40 text-yellow-500';
    case 'cancelled':
      return 'bg-sf-danger-bg/15 border-sf-danger-bg/40 text-sf-danger-bg';
    default:
      return 'bg-sf-raised border-sf-border text-sf-muted';
  }
}

function statusIcon(status: Status) {
  switch (status) {
    case 'trial':
      return null;
    case 'active':
      return <Check className="h-3 w-3" aria-hidden="true" />;
    case 'retrying':
      return <Repeat className="h-3 w-3" aria-hidden="true" />;
    case 'cancelled':
      return <X className="h-3 w-3" aria-hidden="true" />;
    default:
      return null;
  }
}

export function SubscriptionsDemo() {
  const t = useTranslations('landing.subscriptionsDemo');
  const [revealedCount, setRevealedCount] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Derived: actual "ticking" state. When timeline finishes, isAdvancing
  // flips off without needing setState in effect.
  const isAdvancing = playing && revealedCount < TIMELINE.length;

  useEffect(() => {
    if (!isAdvancing) return;
    const handle = window.setTimeout(() => {
      setRevealedCount((c) => c + 1);
    }, STEP_MS);
    return () => window.clearTimeout(handle);
  }, [isAdvancing, revealedCount]);

  function play() {
    if (revealedCount >= TIMELINE.length) {
      setRevealedCount(0);
    }
    setPlaying(true);
  }
  function pause() {
    setPlaying(false);
  }
  function reset() {
    setPlaying(false);
    setRevealedCount(0);
  }

  const capturedSoFar = TIMELINE.slice(0, revealedCount).reduce(
    (acc, ev) => acc + ev.amount,
    0,
  );

  return (
    <section
      data-landing-section="subscriptions-demo"
      className="py-24 md:py-32 bg-sf-deep"
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
            <div className="px-5 py-3 border-b border-sf-border-accent bg-black/20 flex items-center justify-between">
              <span className="text-sm font-bold text-sf-heading">
                {t('productLabel')}
              </span>
              <div className="flex gap-2">
                {!isAdvancing ? (
                  <button
                    type="button"
                    onClick={play}
                    data-action="play"
                    className="inline-flex items-center gap-1 text-xs font-mono text-sf-heading bg-sf-accent-soft border border-sf-border-accent rounded px-2 py-1 hover:bg-sf-accent-med transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    {t('playButton')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={pause}
                    data-action="pause"
                    className="inline-flex items-center gap-1 text-xs font-mono text-sf-body bg-sf-raised/60 border border-sf-border rounded px-2 py-1 hover:text-sf-heading transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                  >
                    <Pause className="h-3 w-3" aria-hidden="true" />
                    {t('pauseButton')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  data-action="reset"
                  className="inline-flex items-center gap-1 text-xs font-mono text-sf-muted hover:text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  {t('resetButton')}
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Horizontal timeline */}
              <ol className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {TIMELINE.map((event, idx) => {
                  const revealed = idx < revealedCount;
                  const label =
                    event.month === 0
                      ? t('trial')
                      : event.noteKey === 'cardRetrySuccess'
                        ? t('cardRetrySuccess')
                        : event.noteKey === 'proratedRefund'
                          ? t('proratedRefund')
                          : t('month', { n: event.month });
                  return (
                    <li
                      key={idx}
                      data-month-idx={idx}
                      data-month-status={event.status}
                      data-revealed={revealed ? 'true' : 'false'}
                      className={`rounded-xl border p-3 transition-all duration-300 ${
                        revealed
                          ? statusColor(event.status)
                          : 'bg-sf-raised/30 border-sf-border/40 text-sf-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] font-mono uppercase tracking-wider">
                          {t(`tags.${event.tag}`)}
                        </span>
                        {revealed ? statusIcon(event.status) : null}
                      </div>
                      <div className="text-xs font-bold">{label}</div>
                      {revealed && event.amount !== 0 && (
                        <div
                          className={`text-xs font-mono mt-1 ${
                            event.amount > 0 ? 'text-sf-heading' : 'text-sf-danger-bg'
                          }`}
                        >
                          {event.amount > 0 ? '+' : ''}
                          {event.amount} zł
                        </div>
                      )}
                      {revealed && event.noteKey && event.noteKey !== 'cardRetrySuccess' && event.noteKey !== 'proratedRefund' && (
                        <div className="text-[10px] mt-1 opacity-80">
                          {t(event.noteKey)}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>

              {/* Running counter */}
              <div className="flex items-center justify-between gap-4 pt-4 border-t border-sf-border-accent">
                <p className="text-sm text-sf-body">
                  {revealedCount >= TIMELINE.length ? t('summary') : null}
                </p>
                <div
                  data-captured-total
                  className="text-2xl font-black font-mono tabular-nums text-sf-heading"
                >
                  {capturedSoFar.toLocaleString('pl-PL')} zł
                </div>
              </div>

              <p className="text-[11px] text-sf-muted">{t('demoNote')}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
