'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import TutorialHelpButton from '@/components/tutorials/TutorialHelpButton';
import { SCENARIOS, applyScenario, needsConfirmation, scenarioChanges, scenarioOf, scenarioWarnings } from './scenarios';
import type { ScenarioId, ScenarioValue } from './scenarios';
import type { ProductFormData, TranslationFunction } from '../types';

interface ScenarioBarProps {
  formData: ProductFormData;
  /** Sets the chosen scenario on the form as it is at that moment. */
  onApply: (id: ScenarioId) => void;
  t: TranslationFunction;
  /** A blank new product starts with the choice open and may skip it. */
  startOpen: boolean;
  /** Settings of a blank new product; null for an opened product, which always shows the difference first. */
  pristine: ProductFormData | null;
  /** The product is stored, so the server may still refuse a change of how it is paid for. */
  isStored: boolean;
}

type Mode = 'choose' | 'summary' | 'confirm';

const buttonClass = 'inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-sf-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent';

/** "What are you selling?": picks a starting scenario that sets existing fields, with the difference shown before a switch. */
export function ScenarioBar({ formData, onApply, t, startOpen, pristine, isStored }: ScenarioBarProps) {
  const locale = useLocale();
  const titleId = useId();
  const confirmId = useId();
  const [mode, setMode] = useState<Mode>(startOpen ? 'choose' : 'summary');
  // Until the seller picks a scenario or skips, the choice of a new product stays open.
  const [firstChoice, setFirstChoice] = useState(startOpen);
  const [manual, setManual] = useState(false);
  // Only the scenario waiting for confirmation: its difference is read from the form on every render, so edits made
  // while it is shown update it, and confirming applies the scenario to the form as it is then.
  const [pending, setPending] = useState<ScenarioId | null>(null);
  // Each request moves focus once to the panel just shown (a counter, so the same panel can be focused again).
  const [focusRequest, setFocusRequest] = useState<{ mode: Mode; count: number } | null>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  // The open question comes first in a new product: focus it once the dialog has placed its own initial focus.
  useEffect(() => {
    if (!startOpen) return;
    const timer = setTimeout(() => {
      if (!document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) firstOptionRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [startOpen]);

  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.mode === 'summary' ? changeRef : focusRequest.mode === 'confirm' ? confirmRef : firstOptionRef).current?.focus();
  }, [focusRequest]);

  const money = (amount: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: formData.currency }).format(amount);
    } catch {
      return `${amount} ${formData.currency}`;
    }
  };
  const value = ({ key, values }: ScenarioValue) => {
    const interval = values?.interval;
    return t(`scenario.values.${key}`, interval ? { ...values, interval: t(`scenario.intervals.${interval}`, { count: values.count ?? 1 }) } : values);
  };
  const name = (id: ScenarioId) => t(`scenario.options.${id}.name`);
  const show = (next: Mode) => { setMode(next); setFocusRequest(request => ({ mode: next, count: (request?.count ?? 0) + 1 })); };

  const choose = (id: ScenarioId) => {
    if (needsConfirmation(formData, applyScenario(formData, id), pristine)) {
      setPending(id);
      show('confirm');
      return;
    }
    onApply(id);
    setFirstChoice(false);
    setManual(false);
    show('summary');
  };
  const confirm = () => {
    if (pending) onApply(pending);
    setPending(null);
    setFirstChoice(false);
    setManual(false);
    show('summary');
  };
  const cancelConfirm = () => { setPending(null); show(firstChoice ? 'choose' : 'summary'); };
  const skip = () => { setFirstChoice(false); setManual(true); show('summary'); };

  const current = scenarioOf(formData);
  const preview = pending && (() => {
    const next = applyScenario(formData, pending);
    return { changes: scenarioChanges(formData, next, money), warnings: scenarioWarnings(formData, next, isStored) };
  })();
  return (
    <div data-tour="form-scenario" className="mb-6 border border-sf-border bg-sf-raised p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {mode === 'summary' ? (
          <p className="flex flex-wrap items-center gap-x-2 text-sf-body">
            <span>{t('scenario.current')} <b className="font-semibold text-sf-heading">{manual ? t('scenario.manualCurrent') : name(current)}</b></span>
            <button ref={changeRef} type="button" className={buttonClass} onClick={() => show('choose')} aria-label={manual ? undefined : t('scenario.changeLabel')}>
              {manual ? t('scenario.choose') : t('scenario.change')}
            </button>
          </p>
        ) : <span />}
        <TutorialHelpButton id="product-form" />
      </div>

      {mode === 'choose' && (
        <div role="group" aria-labelledby={titleId} className="space-y-3">
          <div>
            <p id={titleId} className="font-semibold text-sf-heading">{t('scenario.title')}</p>
            <p className="text-sf-muted">{t('scenario.hint')}</p>
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SCENARIOS.map((id, index) => (
              <li key={id}>
                <button
                  ref={index === 0 ? firstOptionRef : undefined}
                  type="button"
                  data-scenario={id}
                  aria-pressed={firstChoice ? undefined : current === id && !manual}
                  onClick={() => choose(id)}
                  className={`flex h-full min-h-11 w-full flex-col items-start border-2 p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent ${
                    !firstChoice && !manual && current === id ? 'border-sf-accent bg-sf-accent-soft' : 'border-sf-border hover:border-sf-accent'
                  }`}
                >
                  <span className="font-medium text-sf-heading">{name(id)}</span>
                  <span className="text-xs text-sf-muted">{t(`scenario.options.${id}.tagline`)}</span>
                </button>
              </li>
            ))}
          </ul>
          {firstChoice
            ? <button type="button" className={buttonClass} onClick={skip}>{t('scenario.manual')}</button>
            : <button type="button" className={buttonClass} onClick={() => show('summary')}>{t('scenario.cancel')}</button>}
        </div>
      )}

      {mode === 'confirm' && pending && preview && (
        <section aria-labelledby={confirmId} className="space-y-2">
          <h3 id={confirmId} ref={confirmRef} tabIndex={-1} className="font-semibold text-sf-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent">
            {t('scenario.confirm.title', { name: name(pending) })}
          </h3>
          <p className="text-sf-body">{t('scenario.confirm.intro')}</p>
          <ul className="list-disc space-y-1 pl-5 text-sf-body">
            {preview.changes.map(change => (
              <li key={change.key}>{t(`scenario.fields.${change.key}`)}: {value(change.before)} → {value(change.after)}</li>
            ))}
          </ul>
          {preview.warnings.map(warning => <p key={warning} className="text-sf-warning">{t(`scenario.warnings.${warning}`)}</p>)}
          <p className="text-sf-muted">{t('scenario.confirm.rest')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirm} className="min-h-11 bg-sf-accent-bg px-4 py-2 font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent">
              {t('scenario.confirm.apply')}
            </button>
            <button type="button" onClick={cancelConfirm} className="min-h-11 border border-sf-border px-4 py-2 font-medium text-sf-body hover:bg-sf-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent">
              {t('scenario.confirm.cancel')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
