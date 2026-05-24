'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Check,
  Tag,
  Gift,
  ShoppingCart,
  Sparkles,
  Clock,
  PartyPopper,
  RotateCcw,
} from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';

type Stage = 'product' | 'checkout' | 'bump' | 'coupon' | 'pay' | 'paid' | 'oto' | 'downsell' | 'done';

const STAGE_ORDER: Stage[] = [
  'product',
  'checkout',
  'bump',
  'coupon',
  'pay',
  'paid',
  'oto',
  'downsell',
  'done',
];

type StageIndicator = 'product' | 'checkout' | 'bump' | 'coupon' | 'pay' | 'oto' | 'done';

const BASE_PRICE_PLN = 199;
const BUMP_PRICE_PLN = 39;
const OTO_PRICE_PLN = 319;
const DOWNSELL_PRICE_PLN = 79;
const COUPON_RATE = 0.5;
const OTO_COUNTDOWN_SECONDS = 30;

function formatPLN(value: number): string {
  return `${value.toLocaleString('pl-PL')} zł`;
}

export function ConversionStack() {
  const t = useTranslations('landing.conversionStack');
  const [stage, setStage] = useState<Stage>('product');
  const [bumpAdded, setBumpAdded] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [otoAccepted, setOtoAccepted] = useState(false);
  const [downsellAccepted, setDownsellAccepted] = useState(false);
  const [otoTimer, setOtoTimer] = useState(OTO_COUNTDOWN_SECONDS);

  // OTO countdown — visual only; expired state shown in render. User still
  // explicitly clicks Accept/Decline. Avoids setState-in-effect transitions.
  useEffect(() => {
    if (stage !== 'oto' || otoTimer <= 0) return;
    const handle = window.setTimeout(
      () => setOtoTimer((t) => Math.max(0, t - 1)),
      1000,
    );
    return () => window.clearTimeout(handle);
  }, [stage, otoTimer]);

  const otoExpired = stage === 'oto' && otoTimer <= 0;

  const subtotalBeforeCoupon = BASE_PRICE_PLN + (bumpAdded ? BUMP_PRICE_PLN : 0);
  const couponDiscount = couponApplied ? Math.round(subtotalBeforeCoupon * COUPON_RATE) : 0;
  const cartTotal = subtotalBeforeCoupon - couponDiscount;
  const grandTotal =
    cartTotal +
    (otoAccepted ? OTO_PRICE_PLN : 0) +
    (downsellAccepted ? DOWNSELL_PRICE_PLN : 0);

  function reset() {
    setStage('product');
    setBumpAdded(false);
    setCouponInput('');
    setCouponApplied(false);
    setOtoAccepted(false);
    setDownsellAccepted(false);
    setOtoTimer(OTO_COUNTDOWN_SECONDS);
  }

  const stagePill = (key: StageIndicator, label: string) => {
    const stageIdx = STAGE_ORDER.indexOf(stage);
    const keyMappedToOrder: Record<StageIndicator, number> = {
      product: 0,
      checkout: 1,
      bump: 2,
      coupon: 3,
      pay: 4,
      oto: 6,
      done: 8,
    };
    const targetIdx = keyMappedToOrder[key];
    const status = stageIdx > targetIdx ? 'done' : stageIdx === targetIdx ? 'active' : 'idle';
    return (
      <li
        key={key}
        data-stage={key}
        data-status={status}
        className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider rounded-full px-2.5 py-1 border transition-colors ${
          status === 'done'
            ? 'bg-sf-success-soft border-sf-success/30 text-sf-success'
            : status === 'active'
              ? 'bg-sf-accent-soft border-sf-accent text-sf-heading'
              : 'bg-sf-raised/40 border-sf-border text-sf-muted'
        }`}
      >
        {status === 'done' ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
        {label}
      </li>
    );
  };

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
          {/* Stage indicator */}
          <ul className="flex flex-wrap items-center justify-center gap-2 mb-8">
            {stagePill('product', t('stages.product'))}
            {stagePill('checkout', t('stages.checkout'))}
            {stagePill('bump', t('stages.bump'))}
            {stagePill('coupon', t('stages.coupon'))}
            {stagePill('pay', t('stages.pay'))}
            {stagePill('oto', t('stages.oto'))}
            {stagePill('done', t('stages.done'))}
          </ul>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
            {/* Stage screen */}
            <div className="rounded-2xl border border-sf-border-accent bg-sf-raised/80 overflow-hidden min-h-[440px]">
              <div className="px-5 py-3 border-b border-sf-border-accent bg-black/20 flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-sf-muted">
                  shop.your-domain.com
                </span>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center gap-1 text-xs font-mono text-sf-muted hover:text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  Reset
                </button>
              </div>

              <div className="p-6" data-stage-screen={stage}>
                {stage === 'product' && (
                  <div className="space-y-4">
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

                {stage === 'checkout' && (
                  <div className="space-y-4 animate-[checkoutFadeIn_400ms_ease-out_both]">
                    <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-sf-muted">
                      <span className="inline-flex items-center gap-2">
                        <ShoppingCart className="h-3 w-3" aria-hidden="true" />
                        Stripe Embedded Checkout (mock)
                      </span>
                      <span className="inline-flex items-center gap-1 normal-case text-[10px]">
                        <span aria-hidden="true">🔒</span>
                        Secure
                      </span>
                    </div>

                    {/* Realistic Stripe-styled checkout panel */}
                    <div className="rounded-xl border border-sf-border bg-white text-slate-900 p-5 space-y-4 shadow-inner">
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

                      {/* Express checkout — Apple Pay / Link / Google Pay row */}
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
                        <span className="block text-xs font-medium text-slate-600 mb-1">Email</span>
                        <div className="h-10 rounded-md border border-slate-300 bg-white px-3 flex items-center text-sm text-slate-900">
                          buyer@example.com
                        </div>
                      </label>

                      {/* Card number with brand icons */}
                      <label className="block">
                        <span className="block text-xs font-medium text-slate-600 mb-1">Card information</span>
                        <div className="h-10 rounded-t-md border border-slate-300 bg-white px-3 flex items-center justify-between text-sm text-slate-900">
                          <span className="font-mono tracking-wide">4242 4242 4242 4242</span>
                          <span className="flex items-center gap-1" aria-hidden="true">
                            <span className="inline-flex h-4 w-6 rounded-sm bg-gradient-to-br from-blue-600 to-blue-900 text-[8px] font-bold text-white items-center justify-center">VISA</span>
                            <span className="inline-flex h-4 w-6 rounded-sm relative overflow-hidden">
                              <span className="absolute left-0 top-0 h-full w-3 bg-red-500 rounded-l-sm" />
                              <span className="absolute right-0 top-0 h-full w-3 bg-yellow-400 rounded-r-sm" />
                            </span>
                            <span className="inline-flex h-4 w-6 rounded-sm bg-blue-500 text-[7px] font-bold text-white items-center justify-center">AMEX</span>
                          </span>
                        </div>
                        <div className="grid grid-cols-2 -mt-px">
                          <div className="h-10 rounded-bl-md border border-slate-300 bg-white px-3 flex items-center text-sm text-slate-900 font-mono">
                            12 / 27
                          </div>
                          <div className="h-10 rounded-br-md border border-slate-300 border-l-0 bg-white px-3 flex items-center text-sm text-slate-900 font-mono">
                            123
                          </div>
                        </div>
                      </label>

                      {/* Country / ZIP */}
                      <label className="block">
                        <span className="block text-xs font-medium text-slate-600 mb-1">Country or region</span>
                        <div className="h-10 rounded-t-md border border-slate-300 bg-white px-3 flex items-center text-sm text-slate-900">
                          Polska
                        </div>
                        <div className="h-10 rounded-b-md border border-slate-300 border-t-0 bg-white px-3 flex items-center text-sm text-slate-900 font-mono">
                          00-001
                        </div>
                      </label>

                      <button
                        type="button"
                        onClick={() => setStage('bump')}
                        data-action="checkout-next"
                        className="w-full bg-[#635BFF] hover:bg-[#5347e6] text-white rounded-md py-3 font-bold text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
                      >
                        Continue
                      </button>

                      <p className="text-center text-[10px] text-slate-400">
                        Powered by{' '}
                        <span className="font-semibold text-[#635BFF]">stripe</span>
                        <span className="mx-1.5">·</span>
                        <a className="underline" href="#">Terms</a>
                        <span className="mx-1.5">·</span>
                        <a className="underline" href="#">Privacy</a>
                      </p>
                    </div>
                  </div>
                )}

                {stage === 'bump' && (
                  <div className="space-y-4">
                    <label
                      className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-colors cursor-pointer ${
                        bumpAdded
                          ? 'border-sf-success bg-sf-success-soft'
                          : 'border-dashed border-sf-border-accent bg-sf-raised/40 hover:bg-sf-raised'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={bumpAdded}
                        onChange={(e) => setBumpAdded(e.target.checked)}
                        data-action="toggle-bump"
                        className="mt-1 h-5 w-5 accent-sf-accent"
                      />
                      <span className="flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 font-bold text-sf-heading">
                            <Gift className="h-4 w-4 text-sf-accent" aria-hidden="true" />
                            {t('bumpLabel')}
                          </span>
                          <span
                            data-bump-amount={bumpAdded ? 'added' : 'idle'}
                            className={`text-sm font-mono ${
                              bumpAdded ? 'text-sf-success' : 'text-sf-muted'
                            }`}
                          >
                            +{formatPLN(BUMP_PRICE_PLN)}
                          </span>
                        </span>
                        <span className="block text-sm text-sf-body mt-1">
                          {t('bumpDesc')}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setStage('coupon')}
                      data-action="bump-next"
                      className="w-full bg-sf-accent-soft border border-sf-border-accent hover:bg-sf-accent-med text-sf-heading rounded-lg py-2 font-mono text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                    >
                      Continue
                    </button>
                  </div>
                )}

                {stage === 'coupon' && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sf-muted">
                      <Tag className="h-3 w-3" aria-hidden="true" />
                      Coupon
                    </div>
                    {couponApplied ? (
                      <div
                        data-coupon-state="applied"
                        className="flex items-center justify-between rounded-xl border border-sf-success bg-sf-success-soft p-4"
                      >
                        <span className="inline-flex items-center gap-2 font-mono text-sf-success">
                          <Check className="h-4 w-4" aria-hidden="true" />
                          {t('couponBadge')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setCouponApplied(false);
                            setCouponInput('');
                          }}
                          className="text-xs font-mono text-sf-muted hover:text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder={t('couponPlaceholder')}
                          value={couponInput}
                          onChange={(e) => setCouponInput(e.target.value)}
                          data-action="coupon-input"
                          className="flex-1 rounded-lg bg-sf-raised/40 border border-sf-border focus:border-sf-accent focus:outline-none px-3 py-2 text-sf-heading font-mono text-sm transition-colors"
                          aria-label={t('couponPlaceholder')}
                        />
                        <button
                          type="button"
                          onClick={() => setCouponApplied(true)}
                          data-action="coupon-apply"
                          className="bg-sf-accent text-white rounded-lg px-4 py-2 font-bold text-sm hover:bg-sf-accent-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                        >
                          {t('couponApply')}
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-sf-muted">
                      Try the sample code:{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setCouponInput(t('couponSample'));
                          setCouponApplied(true);
                        }}
                        className="font-mono text-sf-accent hover:text-sf-accent-hover underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
                      >
                        {t('couponSample')}
                      </button>
                    </p>
                    <button
                      type="button"
                      onClick={() => setStage('pay')}
                      data-action="coupon-next"
                      className="w-full bg-sf-accent-soft border border-sf-border-accent hover:bg-sf-accent-med text-sf-heading rounded-lg py-2 font-mono text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                    >
                      Continue
                    </button>
                  </div>
                )}

                {stage === 'pay' && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-sf-border bg-sf-raised/40 p-4 space-y-2">
                      <p className="text-xs font-mono uppercase tracking-wider text-sf-muted">
                        Card
                      </p>
                      <p className="font-mono text-sm text-sf-body">
                        4242 4242 4242 4242 · 12/27 · ***
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStage('paid');
                        window.setTimeout(() => setStage('oto'), 900);
                      }}
                      data-action="pay-now"
                      className="w-full bg-sf-accent hover:bg-sf-accent-hover text-white rounded-lg py-3 font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                    >
                      {t('payButton', { amount: formatPLN(cartTotal) })}
                    </button>
                  </div>
                )}

                {stage === 'paid' && (
                  <div className="flex flex-col items-center justify-center gap-3 py-12 animate-[checkoutFadeIn_300ms_ease-out_both]">
                    <div className="h-14 w-14 rounded-full bg-sf-success-soft border border-sf-success flex items-center justify-center">
                      <Check className="h-7 w-7 text-sf-success" aria-hidden="true" />
                    </div>
                    <p className="text-lg font-bold text-sf-heading">
                      {t('paySuccess')}
                    </p>
                  </div>
                )}

                {stage === 'oto' && (
                  <div
                    className="space-y-4 animate-[otoSlideIn_360ms_ease-out_both]"
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
                        <span data-oto-countdown>{t('otoCountdown', { seconds: otoTimer })}</span>
                      </div>
                    </div>
                    <div className="rounded-xl border-2 border-sf-accent bg-sf-accent-soft p-5">
                      <h3 className="text-lg font-bold text-sf-heading">
                        {t('otoOfferLabel')}
                      </h3>
                      <p className="text-sm text-sf-body mt-2">{t('otoOfferDesc')}</p>
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
                    className="space-y-4 animate-[otoSlideIn_360ms_ease-out_both]"
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
                  <div className="flex flex-col items-center text-center gap-3 py-12 animate-[checkoutFadeIn_300ms_ease-out_both]">
                    <div className="h-16 w-16 rounded-full bg-sf-success-soft border border-sf-success flex items-center justify-center">
                      <PartyPopper className="h-8 w-8 text-sf-success" aria-hidden="true" />
                    </div>
                    <p className="text-lg font-bold text-sf-heading">
                      {t('completedTitle')}
                    </p>
                    <p className="text-sm text-sf-body max-w-sm">
                      {t('completedSummary')}
                    </p>
                    <button
                      type="button"
                      onClick={reset}
                      data-action="replay"
                      className="mt-3 inline-flex items-center gap-2 bg-sf-accent-soft border border-sf-border-accent text-sf-heading rounded-full px-4 py-2 text-sm font-mono hover:bg-sf-accent-med transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
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
                <span className="text-sm font-bold text-sf-heading">{t('cartTotal')}</span>
                <span
                  data-cart-total
                  className="text-xl font-black text-sf-heading font-mono tabular-nums transition-[transform] duration-200"
                >
                  {formatPLN(grandTotal)}
                </span>
              </div>
              <p className="text-[11px] text-sf-muted mt-4">{t('demoNote')}</p>
            </aside>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

