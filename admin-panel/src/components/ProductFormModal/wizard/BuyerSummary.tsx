'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { buyerSummaryParts } from './buyer-summary';
import type { ProductFormData, TranslationFunction } from '../types';

interface BuyerSummaryProps {
  formData: ProductFormData;
  t: TranslationFunction;
}

/** Always-visible "Buyer gets" line under every section of the product form. */
export function BuyerSummary({ formData, t }: BuyerSummaryProps) {
  const locale = useLocale();
  const { access, extras, noDatesOrParticipants } = buyerSummaryParts(formData);
  const what = t(`summary.what.${access.what.key}`, access.what.values);
  const accessText = t('summary.access', {
    what: access.days ? t('summary.forDays', { what, days: access.days }) : what,
    payment: t(`summary.payment.${access.payment}`),
  });
  const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format([accessText, ...extras.map(part => t(`summary.extras.${part.key}`, part.values))]);
  const text = noDatesOrParticipants ? t('summary.withoutDates', { list }) : list;
  return (
    <p data-buyer-summary="" className="px-6 py-2 border-t border-sf-border bg-sf-accent-soft text-sm text-sf-body">
      <b className="font-semibold text-sf-heading">{t('summary.label')}</b> {t('summary.sentence', { text })}
    </p>
  );
}
