'use client';

import React, { useEffect, useId, useState } from 'react';
import { useLocale } from 'next-intl';
import { getTransferAvailability } from '@/lib/orders/transfer-public';
import { buyerSummaryParts, summaryNeedsTransfer } from './buyer-summary';
import type { SummaryPart, SummaryTransfer } from './buyer-summary';
import type { ProductFormData, TranslationFunction } from '../types';

interface BuyerSummaryProps {
  formData: ProductFormData;
  t: TranslationFunction;
}

/**
 * "Buyer gets" line under every section of the product form.
 * On a phone it starts as one line with a "show more" toggle; on wider screens it is always shown in full.
 */
export function BuyerSummary({ formData, t }: BuyerSummaryProps) {
  const locale = useLocale();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const transfer = useShopTransfer(summaryNeedsTransfer(formData));
  const { access, extras, noDatesOrParticipants } = buyerSummaryParts(formData, transfer);
  const what = t(`summary.what.${access.what.key}`, access.what.values);
  const accessText = t('summary.access', {
    what: access.days ? t('summary.forDays', { what, days: access.days }) : what,
    payment: t(`summary.payment.${access.payment}`),
  });
  const extra = (part: SummaryPart) => {
    const text = t(`summary.extras.${part.key}`, part.values);
    return part.condition ? `${text} ${t(`summary.conditions.${part.condition.key}`, part.condition.values)}` : text;
  };
  const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format([accessText, ...extras.map(extra)]);
  const text = noDatesOrParticipants ? t('summary.withoutDates', { list }) : list;
  return (
    <div data-tour="buyer-summary" className="flex items-start gap-2 px-6 py-2 border-t border-sf-border bg-sf-accent-soft text-sm text-sf-body">
      <p id={id} data-buyer-summary="" className={`min-w-0 flex-1 ${expanded ? '' : 'line-clamp-1 sm:line-clamp-none'}`}>
        <b className="font-semibold text-sf-heading">{t('summary.label')}</b> {t('summary.sentence', { text })}
      </p>
      <button
        type="button"
        className="sm:hidden shrink-0 rounded font-medium text-sf-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(value => !value)}
      >
        {t(expanded ? 'summary.less' : 'summary.more')}
      </button>
    </div>
  );
}

/** The shop's transfer switch, read only when the product asks for a transfer (same source as checkout). */
function useShopTransfer(needed: boolean): SummaryTransfer {
  const [transfer, setTransfer] = useState<SummaryTransfer>(null);
  useEffect(() => {
    if (!needed) return;
    let active = true;
    getTransferAvailability()
      .then(value => { if (active) setTransfer(value); })
      .catch(() => { if (active) setTransfer({ enabled: false, reservationHours: null }); });
    return () => { active = false; };
  }, [needed]);
  return transfer;
}
