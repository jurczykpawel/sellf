'use client';
/** Native validation messages follow the current page language. @see app/[locale]/layout.tsx */
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

export default function LocalizedFormValidation() {
  const t = useTranslations('formValidation');
  const owned = useRef(new WeakSet<Element>());
  useEffect(() => {
    const field = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement ? target : null;
    const invalid = (event: Event) => {
      const target = field(event.target);
      if (!target || (target.validity.customError && !owned.current.has(target))) return;
      const message = target.validity.valueMissing ? t('required') : target.validity.typeMismatch && target instanceof HTMLInputElement && target.type === 'email' ? t('email') : null;
      if (message) { target.setCustomValidity(message); owned.current.add(target); }
    };
    const input = (event: Event) => {
      const target = field(event.target);
      if (target && owned.current.has(target)) { target.setCustomValidity(''); owned.current.delete(target); }
    };
    document.addEventListener('invalid', invalid, true);
    document.addEventListener('input', input, true);
    document.addEventListener('change', input, true);
    return () => { document.removeEventListener('invalid', invalid, true); document.removeEventListener('input', input, true); document.removeEventListener('change', input, true); };
  }, [t]);
  return null;
}
