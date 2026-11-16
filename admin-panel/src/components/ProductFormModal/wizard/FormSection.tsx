'use client';

import React from 'react';
import type { FormSectionId } from './form-sections';
import type { TranslationFunction } from '../types';

interface FormSectionProps {
  id: FormSectionId;
  t: TranslationFunction;
  children: React.ReactNode;
}

/** One product-form section: heading plus what the section changes for the buyer. */
export function FormSection({ id, t, children }: FormSectionProps) {
  const headingId = `product-form-section-${id}`;
  return (
    <section data-form-section={id} aria-labelledby={headingId} className="space-y-6">
      <header className="border-b border-sf-border pb-3">
        <h3 id={headingId} className="text-base font-semibold text-sf-heading">{t(`sections.${id}.title`)}</h3>
        <p className="mt-1 text-sm text-sf-muted">{t(`sections.${id}.effect`)}</p>
      </header>
      {children}
    </section>
  );
}

interface FormGroupProps {
  title: string;
  children: React.ReactNode;
}

/** Titled group of fields inside a section. */
export function FormGroup({ title, children }: FormGroupProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-sf-heading">{title}</h4>
      {children}
    </div>
  );
}
