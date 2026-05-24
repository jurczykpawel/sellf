'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

interface Tick {
  label: string;
}

interface WebhookTimelineProps {
  ticks: Tick[];
  ariaLabel?: string;
  /** ms between consecutive ticks lighting up */
  step?: number;
  /** ms between loop replays once all ticks are lit */
  loopGap?: number;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(callback: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

export function WebhookTimeline({
  ticks,
  ariaLabel = 'Webhook timeline',
  step = 220,
  loopGap = 1800,
}: WebhookTimelineProps) {
  const reduce = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [animatedIndex, setAnimatedIndex] = useState<number>(-1);
  const active = reduce ? ticks.length - 1 : animatedIndex;
  const containerRef = useRef<HTMLDivElement>(null);
  const inViewRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = entry.isIntersecting;
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduce) return;

    let raf = 0;
    let timer: number | undefined;
    const playOnce = (i: number) => {
      if (!inViewRef.current) {
        timer = window.setTimeout(() => playOnce(i), 400);
        return;
      }
      if (i >= ticks.length) {
        timer = window.setTimeout(() => {
          setAnimatedIndex(-1);
          raf = window.requestAnimationFrame(() => playOnce(0));
        }, loopGap);
        return;
      }
      setAnimatedIndex(i);
      timer = window.setTimeout(() => playOnce(i + 1), step);
    };

    raf = window.requestAnimationFrame(() => playOnce(0));
    return () => {
      window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [reduce, ticks.length, step, loopGap]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className="flex items-center justify-between gap-3 w-full"
    >
      {ticks.map((tick, i) => {
        const lit = i <= active;
        return (
          <div
            key={tick.label}
            className="flex flex-col items-center gap-2 flex-1"
          >
            <span
              role="img"
              aria-label={`webhook step ${i + 1}`}
              data-state={lit ? 'lit' : 'idle'}
              className={`block h-3 w-3 rounded-full transition-all duration-200 ${
                lit
                  ? 'bg-sf-accent shadow-[0_0_12px_var(--sf-accent-glow)]'
                  : 'bg-sf-muted/30'
              }`}
            />
            <span
              className={`text-xs font-mono ${
                lit ? 'text-sf-heading' : 'text-sf-muted'
              }`}
            >
              {tick.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
