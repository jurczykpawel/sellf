'use client';

import React, { useEffect, useRef } from 'react';
import { FORM_SECTIONS, sectionCount, type FormSectionId } from './form-sections';
import type { ProductFormData, TranslationFunction } from '../types';

interface FormSectionNavProps {
  current: FormSectionId;
  formData: ProductFormData;
  onSelect: (section: FormSectionId) => void;
  t: TranslationFunction;
}

/** Section switcher of the product form; every section stays reachable, in create and edit mode. Sections in use show a count. */
export function FormSectionNav({ current, formData, onSelect, t }: FormSectionNavProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  // On narrow screens the list scrolls sideways; keep the current section in view.
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [current]);
  return (
    <nav aria-label={t('sections.nav')} className="px-6 py-3 border-b border-sf-border">
      <ul className="flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
        {FORM_SECTIONS.map(section => {
          const active = section === current;
          const count = sectionCount(section, formData);
          return (
            <li key={section} className="shrink-0">
              <button
                ref={active ? activeRef : undefined}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(section)}
                className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent ${
                  active
                    ? 'border-sf-accent bg-sf-accent-bg text-white'
                    : 'border-sf-border text-sf-body hover:bg-sf-hover'
                }`}
              >
                {t(`sections.${section}.title`)}
                {count && <span className={active ? 'font-normal' : 'font-normal text-sf-muted'}> · {t(`sections.counts.${count.key}`, { count: count.count })}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
