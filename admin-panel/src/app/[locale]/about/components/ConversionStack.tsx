'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Check,
  Gift,
  Sparkles,
  Clock,
  PartyPopper,
  RotateCcw,
  Ticket,
  X,
  Info,
  ArrowRight,
} from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';

type Stage = 'product' | 'checkout' | 'paid' | 'oto' | 'downsell' | 'done';

const STAGE_ORDER: Stage[] = ['product', 'checkout', 'paid', 'oto', 'downsell', 'done'];

const BASE_PRICE_PLN = 199;
const BUMP_PRICE_PLN = 39;
const OTO_PRICE_PLN = 319;
const DOWNSELL_PRICE_PLN = 79;
const COUPON_RATE = 0.5;
const OTO_COUNTDOWN_SECONDS = 30;

// Typewriter targets — populated char-by-char when checkout opens
const TYPED_CARD = '4242 4242 4242 4242';
const TYPED_EXP = '12 / 27';
const TYPED_CVC = '123';
const TYPED_POSTAL = '00-001';
const TYPE_DELAY_MS = 35;

function formatPLN(value: number): string {
  return `${value.toLocaleString('pl-PL')} zł`;
}

/**
 * Sequentially type a list of [setter, fullValue] pairs into state.
 * Returns a cleanup that aborts in-flight typing.
 */
function useTypewriter(
  active: boolean,
  fields: Array<[Dispatch<string>, string]>,
): void {
  useEffect(() => {
    if (!active) return;
    const timers: number[] = [];
    let delay = 250; // small lead-in before first character
    for (const [setter, target] of fields) {
      for (let i = 1; i <= target.length; i += 1) {
        const slice = target.slice(0, i);
        timers.push(window.setTimeout(() => setter(slice), delay));
        delay += TYPE_DELAY_MS;
      }
      delay += 180; // pause between fields
    }
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
    // We intentionally re-run only on `active` changes — fields are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

type Dispatch<T> = (value: T) => void;

export function ConversionStack() {
  const t = useTranslations('landing.conversionStack');

  const [stage, setStage] = useState<Stage>('product');
  const [bumpAdded, setBumpAdded] = useState(false);
  // urlHasCoupon mirrors the real Sellf behavior: coupon auto-applies only
  // when the buyer arrives via a /?coupon=… link. No manual input field is
  // ever shown, which prevents code hunting.
  const [urlHasCoupon, setUrlHasCoupon] = useState(false);
  const [otoAccepted, setOtoAccepted] = useState(false);
  const [downsellAccepted, setDownsellAccepted] = useState(false);
  const [otoTimer, setOtoTimer] = useState(OTO_COUNTDOWN_SECONDS);

  // Derived: coupon is "applied" iff the buyer arrived via the coupon URL.
  const couponApplied = urlHasCoupon;
  const couponCode = 'FRIENDS50';

  // Typewriter state for card fields
  const [typedCard, setTypedCard] = useState('');
  const [typedExp, setTypedExp] = useState('');
  const [typedCvc, setTypedCvc] = useState('');
  const [typedPostal, setTypedPostal] = useState('');

  useTypewriter(stage === 'checkout', [
    [setTypedCard, TYPED_CARD],
    [setTypedExp, TYPED_EXP],
    [setTypedCvc, TYPED_CVC],
    [setTypedPostal, TYPED_POSTAL],
  ]);

  // OTO visual countdown — when 0 it just shows "expired", user still clicks.
  useEffect(() => {
    if (stage !== 'oto' || otoTimer <= 0) return;
    const handle = window.setTimeout(
      () => setOtoTimer((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => window.clearTimeout(handle);
  }, [stage, otoTimer]);

  const otoExpired = stage === 'oto' && otoTimer <= 0;

  const subtotalBeforeCoupon = BASE_PRICE_PLN + (bumpAdded ? BUMP_PRICE_PLN : 0);
  const couponDiscount = couponApplied
    ? Math.round(subtotalBeforeCoupon * COUPON_RATE)
    : 0;
  const checkoutTotal = subtotalBeforeCoupon - couponDiscount;
  const grandTotal =
    checkoutTotal +
    (otoAccepted ? OTO_PRICE_PLN : 0) +
    (downsellAccepted ? DOWNSELL_PRICE_PLN : 0);

  function reset() {
    setStage('product');
    setBumpAdded(false);
    setUrlHasCoupon(false);
    setOtoAccepted(false);
    setDownsellAccepted(false);
    setOtoTimer(OTO_COUNTDOWN_SECONDS);
    setTypedCard('');
    setTypedExp('');
    setTypedCvc('');
    setTypedPostal('');
  }

  function payNow() {
    setStage('paid');
    window.setTimeout(() => setStage('oto'), 800);
  }

  // 4 stage pills (Product → Checkout → OTO → Done)
  const pills: Array<{ key: string; label: string; reachedAt: Stage }> = [
    { key: 'product', label: t('stages.product'), reachedAt: 'product' },
    { key: 'checkout', label: t('stages.checkout'), reachedAt: 'checkout' },
    { key: 'oto', label: t('stages.oto'), reachedAt: 'oto' },
    { key: 'done', label: t('stages.done'), reachedAt: 'done' },
  ];

  function pillStatus(reachedAt: Stage): 'idle' | 'active' | 'done' {
    const ours = STAGE_ORDER.indexOf(reachedAt);
    const cur = STAGE_ORDER.indexOf(stage);
    if (cur > ours) return 'done';
    if (cur === ours) return 'active';
    // 'paid' and 'downsell' belong to the OTO bucket for indicator purposes
    if (reachedAt === 'oto' && (stage === 'paid' || stage === 'downsell')) {
      return 'active';
    }
    return 'idle';
  }

  return (
    <section
      data-landing-section="conversion-stack"
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
          {/* Stage indicator (4 pills) + applied-state chips */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <ul className="flex flex-wrap items-center justify-center gap-2">
              {pills.map((p) => {
                const status = pillStatus(p.reachedAt);
                return (
                  <li
                    key={p.key}
                    data-stage={p.key}
                    data-status={status}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider rounded-full px-2.5 py-1 border transition-colors ${
                      status === 'done'
                        ? 'bg-sf-success-soft border-sf-success/30 text-sf-success'
                        : status === 'active'
                          ? 'bg-sf-accent-soft border-sf-accent text-sf-heading'
                          : 'bg-sf-raised/40 border-sf-border text-sf-muted'
                    }`}
                  >
                    {status === 'done' && (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    )}
                    {p.label}
                  </li>
                );
              })}
            </ul>
            {(bumpAdded || couponApplied) && (
              <ul className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-mono">
                {bumpAdded && (
                  <li
                    data-applied="bump"
                    className="inline-flex items-center gap-1 rounded-full bg-sf-accent-soft border border-sf-border-accent px-2 py-0.5 text-sf-heading"
                  >
                    <Gift className="h-3 w-3" aria-hidden="true" />
                    + {formatPLN(BUMP_PRICE_PLN)}
                  </li>
                )}
                {couponApplied && (
                  <li
                    data-applied="coupon"
                    className="inline-flex items-center gap-1 rounded-full bg-sf-success-soft border border-sf-success/30 px-2 py-0.5 text-sf-success"
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {couponCode} −50%
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
            {/* Main stage screen */}
            {/* min-heights match the tallest stage (checkout panel) per
                breakpoint so the page below doesn't jump when switching stages.
                Mobile: checkout vertical stack ≈ 720 px; desktop unchanged. */}
            <div className="rounded-2xl border border-sf-border-accent bg-sf-raised/80 overflow-hidden min-h-[760px] sm:min-h-[820px] lg:min-h-[860px]">
              <div className="px-5 py-3 border-b border-sf-border-accent bg-black/20 flex items-center justify-between gap-3">
                {/* Live URL bar — reflects the coupon link state */}
                <span
                  data-url-bar={urlHasCoupon ? 'with-coupon' : 'plain'}
                  className="text-xs font-mono truncate text-sf-muted"
                >
                  {urlHasCoupon ? (
                    <>
                      shop.your-domain.com/
                      <span className="text-sf-accent">?coupon=FRIENDS50</span>
                    </>
                  ) : (
                    <>shop.your-domain.com</>
                  )}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!urlHasCoupon && (
                    <button
                      type="button"
                      onClick={() => setUrlHasCoupon(true)}
                      data-action="apply-coupon-link"
                      className="inline-flex items-center gap-1 text-xs font-mono text-sf-heading bg-sf-accent-soft border border-sf-border-accent rounded px-2 py-1 hover:bg-sf-accent-med transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                    >
                      <Ticket className="h-3 w-3" aria-hidden="true" />
                      {t('couponLinkSimulate')}
                    </button>
                  )}
                  {urlHasCoupon && (
                    <button
                      type="button"
                      onClick={() => setUrlHasCoupon(false)}
                      data-action="remove-coupon-link"
                      aria-label={t('couponRemoveLabel')}
                      className="inline-flex items-center gap-1 text-xs font-mono text-sf-muted hover:text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1 text-xs font-mono text-sf-muted hover:text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Reset
                  </button>
                </div>
              </div>

              <div
                className="p-6 flex flex-col min-h-[calc(760px-3.25rem)] sm:min-h-[calc(820px-3.25rem)] lg:min-h-[calc(860px-3.25rem)]"
                data-stage-screen={stage}
              >
                {stage === 'product' && (
                  <div className="space-y-4 my-auto w-full">
                    <div className="aspect-[5/3] rounded-xl bg-gradient-to-br from-sf-accent-soft via-sf-accent-med to-sf-accent-glow flex items-center justify-center">
                      <Sparkles className="h-16 w-16 text-white/80" aria-hidden="true" />
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold text-sf-heading">
                          {t('productLabel')}
                        </h3>
                        <p className="text-xs text-sf-muted mt-1">
                          {t('productOmnibus')}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-sf-muted line-through">
                          {t('productCompareAt')}
                        </div>
                        <div className="text-2xl font-black text-sf-heading">
                          {t('productPrice')}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStage('checkout')}
                      data-action="buy-now"
                      className="w-full bg-sf-accent hover:bg-sf-accent-hover text-white rounded-lg py-3 font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                    >
                      {t('ctaBuy')}
                    </button>
                  </div>
                )}

                {(stage === 'checkout' || stage === 'paid') && (
                  <div className="animate-[checkoutFadeIn_400ms_ease-out_both]">
                    <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-sf-muted mb-3">
                      <span>Stripe Embedded Checkout (mock)</span>
                      <span className="inline-flex items-center gap-1 normal-case text-[10px]">
                        <span aria-hidden="true">🔒</span>
                        Secure
                      </span>
                    </div>

                    {/* Realistic Stripe-styled checkout panel */}
                    <div className="rounded-xl border border-sf-border bg-white text-slate-900 p-5 space-y-4 shadow-inner relative">
                      {stage === 'paid' && (
                        <div className="absolute inset-0 z-10 bg-white/95 rounded-xl flex flex-col items-center justify-center gap-3 animate-[checkoutFadeIn_300ms_ease-out_both]">
                          <div className="h-14 w-14 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center">
                            <Check className="h-7 w-7 text-emerald-600" aria-hidden="true" />
                          </div>
                          <p className="text-lg font-bold text-slate-900">
                            {t('paySuccess')}
                          </p>
                        </div>
                      )}

                      {/* Order summary row */}
                      <div className="flex items-center gap-3 pb-3 border-b border-slate-200">
                        <div className="h-10 w-10 rounded-md bg-gradient-to-br from-sf-accent-soft via-sf-accent-med to-sf-accent-glow flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {t('productLabel')}
                          </div>
                          <div className="text-xs text-slate-500">x 1</div>
                        </div>
                        <div className="text-sm font-mono">{t('productPrice')}</div>
                      </div>

                      {/* INLINE ORDER BUMP */}
                      <label
                        className={`block rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                          bumpAdded
                            ? 'border-emerald-500 bg-emerald-50'
                            : 'border-amber-400 bg-amber-50 hover:bg-amber-100'
                        }`}
                      >
                        <div className="flex items-start gap-3 p-3">
                          <input
                            type="checkbox"
                            checked={bumpAdded}
                            onChange={(e) => setBumpAdded(e.target.checked)}
                            data-action="toggle-bump"
                            className="mt-0.5 h-5 w-5 accent-emerald-600"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
                                <Gift className="h-4 w-4 text-amber-600" aria-hidden="true" />
                                {t('bumpLabel')}
                              </span>
                              <span
                                data-bump-amount={bumpAdded ? 'added' : 'idle'}
                                className="text-sm font-mono font-bold text-slate-900"
                              >
                                +{formatPLN(BUMP_PRICE_PLN)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1">
                              {t('bumpDesc')}
                            </p>
                          </div>
                        </div>
                      </label>

                      {/* Express checkout — Apple Pay / Link / Google Pay */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="h-9 rounded-md bg-black text-white text-[11px] font-semibold flex items-center justify-center">
                          <span aria-hidden="true"></span>
                          <span className="ml-0.5">Pay</span>
                        </div>
                        <div className="h-9 rounded-md bg-emerald-600 text-white text-[11px] font-semibold flex items-center justify-center gap-1">
                          <span className="h-2.5 w-2.5 rounded-full bg-white/90" aria-hidden="true" />
                          link
                        </div>
                        <div className="h-9 rounded-md bg-white border border-slate-300 text-slate-900 text-[11px] font-semibold flex items-center justify-center">
                          <span className="text-blue-500">G</span>
                          <span className="text-red-500">o</span>
                          <span className="text-yellow-500">o</span>
                          <span className="text-blue-500">g</span>
                          <span className="text-emerald-600">l</span>
                          <span className="text-red-500">e</span>
                          <span className="ml-1">Pay</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
                        <div className="flex-1 h-px bg-slate-200" />
                        Or pay with card
                        <div className="flex-1 h-px bg-slate-200" />
                      </div>

                      {/* Email */}
                      <label className="block">
                        <span className="block text-xs font-medium text-slate-600 mb-1">
                          Email
                        </span>
                        <div className="h-10 rounded-md border border-slate-300 bg-white px-3 flex items-center text-sm text-slate-900">
                          buyer@example.com
                        </div>
                      </label>

                      {/* Card information — typewriter-typed */}
                      <label className="block">
                        <span className="block text-xs font-medium text-slate-600 mb-1">
                          Card information
                        </span>
                        <div className="h-10 rounded-t-md border border-slate-300 bg-white px-3 flex items-center justify-between text-sm text-slate-900">
                          <span
                            className="font-mono tracking-wide"
                            data-typing-field="card"
                          >
                            {typedCard || (
                              <span className="text-slate-400">
                                1234 1234 1234 1234
                              </span>
                            )}
                            {stage === 'checkout' &&
                              typedCard.length < TYPED_CARD.length && (
                                <span className="animate-pulse text-slate-400">▍</span>
                              )}
                          </span>
                          <span className="flex items-center gap-1" aria-hidden="true">
                            <span className="inline-flex h-4 w-6 rounded-sm bg-gradient-to-br from-blue-600 to-blue-900 text-[8px] font-bold text-white items-center justify-center">
                              VISA
                            </span>
                            <span className="inline-flex h-4 w-6 rounded-sm relative overflow-hidden">
                              <span className="absolute left-0 top-0 h-full w-3 bg-red-500 rounded-l-sm" />
                              <span className="absolute right-0 top-0 h-full w-3 bg-yellow-400 rounded-r-sm" />
                            </span>
                            <span className="inline-flex h-4 w-6 rounded-sm bg-blue-500 text-[7px] font-bold text-white items-center justify-center">
                              AMEX
                            </span>
                          </span>
                        </div>
                        <div className="grid grid-cols-2 -mt-px">
                          <div
                            className="h-10 rounded-bl-md border border-slate-300 bg-white px-3 flex items-center text-sm text-slate-900 font-mono"
                            data-typing-field="exp"
                          >
                            {typedExp || <span className="text-slate-400">MM / YY</span>}
                          </div>
                          <div
                            className="h-10 rounded-br-md border border-slate-300 border-l-0 bg-white px-3 flex items-center text-sm text-slate-900 font-mono"
                            data-typing-field="cvc"
                          >
                            {typedCvc || <span className="text-slate-400">CVC</span>}
                          </div>
                        </div>
                      </label>

                      {/* Country / ZIP */}
                      <label className="block">
                        <span className="block text-xs font-medium text-slate-600 mb-1">
                          Country or region
                        </span>
                        <div className="h-10 rounded-t-md border border-slate-300 bg-white px-3 flex items-center text-sm text-slate-900">
                          Polska
                        </div>
                        <div
                          className="h-10 rounded-b-md border border-slate-300 border-t-0 bg-white px-3 flex items-center text-sm text-slate-900 font-mono"
                          data-typing-field="postal"
                        >
                          {typedPostal || (
                            <span className="text-slate-400">Postal code</span>
                          )}
                        </div>
                      </label>

                      {/* COUPON — auto-applied from URL only (Sellf anti-hunting pattern) */}
                      {couponApplied && (
                        <div
                          data-coupon-state="auto-applied"
                          className="flex items-center justify-between gap-2 rounded-md bg-emerald-50 border-2 border-emerald-400 px-3 py-2.5 animate-[checkoutFadeIn_300ms_ease-out_both]"
                        >
                          <span className="inline-flex items-center gap-2 text-sm">
                            <Ticket
                              className="h-4 w-4 text-emerald-700"
                              aria-hidden="true"
                            />
                            <span className="font-mono font-bold text-emerald-700">
                              {couponCode}
                            </span>
                            <span className="text-emerald-700">−50%</span>
                            <span className="text-[10px] uppercase tracking-wider rounded-full bg-emerald-700 text-white px-1.5 py-0.5">
                              auto
                            </span>
                          </span>
                          <span className="text-xs text-slate-500 font-mono">
                            −{formatPLN(couponDiscount)}
                          </span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={payNow}
                        data-action="pay-now"
                        disabled={stage !== 'checkout'}
                        className="w-full bg-[#635BFF] hover:bg-[#5347e6] text-white rounded-md py-3 font-bold text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF] disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {t('payButton', { amount: formatPLN(checkoutTotal) })}
                      </button>

                      <p className="text-center text-[10px] text-slate-400">
                        Powered by{' '}
                        <span className="font-semibold text-[#635BFF]">stripe</span>
                        <span className="mx-1.5">·</span>
                        <a className="underline" href="#">
                          Terms
                        </a>
                        <span className="mx-1.5">·</span>
                        <a className="underline" href="#">
                          Privacy
                        </a>
                      </p>
                    </div>
                  </div>
                )}

                {stage === 'oto' && (
                  <div
                    className="space-y-4 my-auto w-full animate-[otoSlideIn_360ms_ease-out_both]"
                    data-oto-state="open"
                    role="dialog"
                    aria-label={t('otoOfferLabel')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sf-accent">
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        {t('otoTitle')}
                      </div>
                      <div className="inline-flex items-center gap-1 rounded-full bg-sf-accent-soft border border-sf-border-accent px-2.5 py-1 text-xs font-mono">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        <span data-oto-countdown>
                          {t('otoCountdown', { seconds: otoTimer })}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl border-2 border-sf-accent bg-sf-accent-soft p-5">
                      <h3 className="text-lg font-bold text-sf-heading">
                        {t('otoOfferLabel')}
                      </h3>
                      <p className="text-sm text-sf-body mt-2">
                        {t('otoOfferDesc')}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setOtoAccepted(true);
                          setStage('done');
                        }}
                        data-action="oto-accept"
                        disabled={otoExpired}
                        className="flex-1 bg-sf-accent hover:bg-sf-accent-hover text-white rounded-lg py-3 font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('otoAccept')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStage('downsell')}
                        data-action="oto-decline"
                        className="flex-1 bg-sf-raised/60 border border-sf-border text-sf-body hover:text-sf-heading rounded-lg py-3 font-mono text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                      >
                        {t('otoDecline')}
                      </button>
                    </div>
                  </div>
                )}

                {stage === 'downsell' && (
                  <div
                    className="space-y-4 my-auto w-full animate-[otoSlideIn_360ms_ease-out_both]"
                    data-downsell-state="open"
                    role="dialog"
                    aria-label={t('downsellOffer')}
                  >
                    <div className="text-xs font-mono uppercase tracking-wider text-sf-muted">
                      {t('downsellTitle')}
                    </div>
                    <div className="rounded-xl border border-sf-border-accent bg-sf-raised/40 p-5">
                      <h3 className="text-lg font-bold text-sf-heading">
                        {t('downsellOffer')}
                      </h3>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDownsellAccepted(true);
                          setStage('done');
                        }}
                        data-action="downsell-accept"
                        className="flex-1 bg-sf-accent hover:bg-sf-accent-hover text-white rounded-lg py-3 font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                      >
                        {t('downsellAccept')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStage('done')}
                        data-action="downsell-decline"
                        className="flex-1 bg-sf-raised/60 border border-sf-border text-sf-body hover:text-sf-heading rounded-lg py-3 font-mono text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                      >
                        {t('downsellDecline')}
                      </button>
                    </div>
                  </div>
                )}

                {stage === 'done' && (
                  <div className="flex flex-col items-center text-center gap-3 my-auto w-full py-12 animate-[checkoutFadeIn_300ms_ease-out_both]">
                    <div className="h-16 w-16 rounded-full bg-sf-success-soft border border-sf-success flex items-center justify-center">
                      <PartyPopper
                        className="h-8 w-8 text-sf-success"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="text-lg font-bold text-sf-heading">
                      {t('completedTitle')}
                    </p>
                    <p className="text-sm text-sf-body max-w-sm">
                      {t('completedSummary')}
                    </p>
                    {/* Primary conversion CTA after the demo lands */}
                    <a
                      href="#deployment"
                      data-action="end-cta"
                      className="mt-4 inline-flex items-center gap-2 bg-sf-accent hover:bg-sf-accent-hover text-white rounded-full px-5 py-2.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                    >
                      {t('endCtaLink')}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </a>
                    <p className="text-xs text-sf-muted max-w-sm">
                      {t('endCta')}
                    </p>
                    <button
                      type="button"
                      onClick={reset}
                      data-action="replay"
                      className="mt-2 inline-flex items-center gap-2 text-xs font-mono text-sf-muted hover:text-sf-heading transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      {t('completedReplay')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Live cart sidebar */}
            <aside
              className="rounded-2xl border border-sf-border bg-sf-raised/40 p-5 sticky top-24 h-fit"
              aria-label={t('cartLabel')}
            >
              <p className="text-xs font-mono uppercase tracking-wider text-sf-muted mb-3">
                {t('cartLabel')}
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center justify-between text-sf-body">
                  <span>{t('cartProduct')}</span>
                  <span className="font-mono">{formatPLN(BASE_PRICE_PLN)}</span>
                </li>
                {bumpAdded && (
                  <li
                    data-cart-line="bump"
                    className="flex items-center justify-between text-sf-body animate-[lineSlideIn_320ms_ease-out_both]"
                  >
                    <span>{t('cartBump')}</span>
                    <span className="font-mono">{formatPLN(BUMP_PRICE_PLN)}</span>
                  </li>
                )}
                {couponApplied && (
                  <li
                    data-cart-line="coupon"
                    className="flex items-center justify-between text-sf-success animate-[lineSlideIn_320ms_ease-out_both]"
                  >
                    <span>{t('cartCoupon')}</span>
                    <span className="font-mono">−{formatPLN(couponDiscount)}</span>
                  </li>
                )}
                {otoAccepted && (
                  <li
                    data-cart-line="oto"
                    className="flex items-center justify-between text-sf-body animate-[lineSlideIn_320ms_ease-out_both]"
                  >
                    <span>1:1</span>
                    <span className="font-mono">{formatPLN(OTO_PRICE_PLN)}</span>
                  </li>
                )}
                {downsellAccepted && (
                  <li
                    data-cart-line="downsell"
                    className="flex items-center justify-between text-sf-body animate-[lineSlideIn_320ms_ease-out_both]"
                  >
                    <span>Q&A</span>
                    <span className="font-mono">{formatPLN(DOWNSELL_PRICE_PLN)}</span>
                  </li>
                )}
              </ul>
              <div className="mt-4 pt-3 border-t border-sf-border flex items-center justify-between">
                <span className="text-sm font-bold text-sf-heading">
                  {t('cartTotal')}
                </span>
                <span
                  data-cart-total
                  className="text-xl font-black text-sf-heading font-mono tabular-nums transition-[transform] duration-200"
                >
                  {formatPLN(grandTotal)}
                </span>
              </div>
              <div className="mt-5 pt-4 border-t border-sf-border space-y-2">
                <p className="text-[11px] text-sf-muted leading-relaxed">
                  {t('demoNote')}
                </p>
                <div className="flex items-start gap-2 rounded-md bg-sf-accent-soft/40 border border-sf-border-accent/40 px-2.5 py-2">
                  <Info
                    className="h-3 w-3 mt-0.5 text-sf-accent flex-shrink-0"
                    aria-hidden="true"
                  />
                  <p className="text-[10px] text-sf-body leading-relaxed">
                    {t('couponWhy')}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
