// @vitest-environment happy-dom
/**
 * A refused save re-enables the save button, which the browser dropped focus from while it was
 * disabled; focus returns to it instead of staying on the page body.
 *
 * @see src/components/ProductFormModal/wizard/WizardFooter.tsx
 */
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WizardFooter } from '@/components/ProductFormModal/wizard/WizardFooter';
import { initialFormData } from '@/components/ProductFormModal/types';

afterEach(cleanup);
const footer = (isSubmitting: boolean) => createElement(WizardFooter, {
  isFirstSection: true, isLastSection: false, isSubmitting, isEditMode: true, formData: initialFormData, priceDisplayValue: '',
  shopConfigLoaded: true, saveBlocked: false, onBack: () => {}, onContinue: () => {}, onSubmit: () => {}, onCancel: () => {}, t: (key: string) => key,
});

it('returns focus to the save button after a refused save', () => {
  const view = render(footer(false));
  const save = view.getByRole('button', { name: 'updateProduct' });
  save.focus();
  view.rerender(footer(true));
  // A browser drops focus from a control that becomes disabled; happy-dom does not, so drop it here.
  const transient = document.body.appendChild(document.createElement('input'));
  transient.focus();
  transient.remove();
  expect(document.activeElement).toBe(document.body);
  view.rerender(footer(false));
  expect(document.activeElement).toBe(view.getByRole('button', { name: 'updateProduct' }));
});

it('does not take focus on first render or when focus is already elsewhere', () => {
  const outside = document.createElement('input');
  document.body.appendChild(outside);
  const view = render(footer(false));
  expect(document.activeElement).toBe(document.body);
  view.rerender(footer(true));
  outside.focus();
  view.rerender(footer(false));
  expect(document.activeElement).toBe(outside);
  outside.remove();
});
