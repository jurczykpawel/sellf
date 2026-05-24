'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Check, Play } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';

const SNIPPET = `<script src="https://demo.sellf.app/embed/v1/checkout.js"
        data-product="my-product-slug"></script>`;

type Phase = 'idle' | 'loading' | 'loaded';

export function EmbedCheckoutDemo() {
  const t = useTranslations('landing.embedDemo');
  const [phase, setPhase] = useState<Phase>('idle');
  const [copied, setCopied] = useState(false);

  const handleRun = () => {
    if (phase !== 'idle') return;
    setPhase('loading');
    window.setTimeout(() => setPhase('loaded'), 900);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked (e.g., insecure context). Silently no-op —
      // the snippet is already visible in the <pre> for the user to copy manually.
    }
  };

  return (
    <section
      data-landing-section="embed-demo"
      className="py-24 md:py-32 bg-sf-deep"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-12">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">
            {t('subtitle')}
          </p>
        </Reveal>

        <Reveal animation="fade-up" delay={100}>
          <div className="rounded-2xl border border-sf-border-accent bg-sf-raised/80 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-sf-border-accent bg-black/20">
              <span className="text-xs font-mono uppercase text-sf-muted">
                {t('snippetLabel')}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  data-action="copy-snippet"
                  className="inline-flex items-center gap-1 text-xs font-mono text-sf-body hover:text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1 transition-colors"
                  aria-live="polite"
                >
                  {copied ? (
                    <Check className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                  {copied ? t('copyDone') : t('copyButton')}
                </button>
                <button
                  type="button"
                  onClick={handleRun}
                  data-action="run-snippet"
                  data-phase={phase}
                  disabled={phase !== 'idle'}
                  className="inline-flex items-center gap-1 text-xs font-mono text-sf-heading bg-sf-accent-soft border border-sf-border-accent rounded px-2 py-1 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent transition-colors"
                >
                  <Play className="h-3 w-3" aria-hidden="true" />
                  {t('runButton')}
                </button>
              </div>
            </div>
            <pre className="p-4 text-sm font-mono text-sf-body whitespace-pre overflow-x-auto bg-transparent">
              {SNIPPET}
            </pre>

            <div
              className="p-6 border-t border-sf-border-accent"
              data-checkout-state={phase}
              role="region"
              aria-label={t('shopBadge')}
            >
              {phase === 'idle' && (
                <p className="text-center text-sf-muted text-sm py-10">
                  {t('demoNote')}
                </p>
              )}
              {phase === 'loading' && (
                <div className="space-y-3 animate-pulse motion-reduce:animate-none">
                  <div className="h-4 bg-sf-muted/20 rounded w-1/3" />
                  <div className="h-10 bg-sf-muted/20 rounded" />
                  <div className="h-10 bg-sf-muted/20 rounded" />
                  <p className="text-xs text-sf-muted text-center">
                    {t('loading')}
                  </p>
                </div>
              )}
              {phase === 'loaded' && (
                <div
                  className="space-y-3"
                  data-checkout-skeleton="loaded"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono uppercase tracking-wider text-sf-muted">
                      {t('shopBadge')}
                    </span>
                    <span className="font-mono text-sf-muted">
                      demo.sellf.app
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sf-heading font-semibold">
                      {t('productLabel')}
                    </span>
                    <span className="text-sf-heading font-mono">
                      {t('productPrice')}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="w-full bg-sf-accent text-white rounded-lg py-3 font-bold opacity-90 cursor-not-allowed"
                  >
                    {t('payButton')}
                  </button>
                  <p className="text-[10px] text-sf-muted text-center">
                    {t('demoNote')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
