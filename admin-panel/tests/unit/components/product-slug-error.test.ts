// @vitest-environment happy-dom
import { createElement, createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StepEssentials } from '@/components/ProductFormModal/wizard/steps/StepEssentials';
import { initialFormData } from '@/components/ProductFormModal/types';
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/components/ProductFormModal/sections', async () => {
  const { BasicInfoSection } = await import('@/components/ProductFormModal/sections/BasicInfoSection');
  return { BasicInfoSection, PriceVatInline: () => null, SubscriptionSection: () => null, ProductTypeRadio: () => null };
});
afterEach(cleanup);
function Form() {
  const [formData, setFormData] = useState({ ...initialFormData, slug: 'Zła Ścieżka!' });
  const [fieldErrors, setFieldErrors] = useState({ slug: 'invalid', name: 'required' });
  return createElement(StepEssentials, { formData, setFormData, fieldErrors, setFieldErrors, t: key => key,
    nameInputRef: createRef(), slugModified: true, setSlugModified: vi.fn(), currentDomain: '', generateSlug: value => value,
    priceDisplayValue: '0', setPriceDisplayValue: vi.fn(), shopDefaultVatRate: null });
}
it('clears the slug error when the seller corrects the slug, preserving other field errors', () => {
  render(createElement(Form));
  const slug = screen.getByRole('textbox', { name: /urlSlug/ });
  expect(slug.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(slug, { target: { value: 'course-ok' } });
  expect(slug.getAttribute('aria-invalid')).toBe('false');
  expect(document.getElementById('slug-error')).toBeNull();
  expect(document.getElementById('name-error')).toBeTruthy();
});
