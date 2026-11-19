// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Wizard from '@/components/ProductFormModal/wizard/ProductCreationWizard';
import { initialFormData } from '@/components/ProductFormModal/types';
import type { Product } from '@/types';
const state = vi.hoisted(() => ({ dirty: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/components/ProductFormModal/hooks', () => ({ useProductForm: () => ({
  formData: { ...initialFormData, name: 'Saved', slug: 'saved', price: 100 },
  isDirty: state.dirty, priceDisplayValue: '100', salePriceDisplayValue: '', fieldErrors: {}, rejectedSaves: 0,
  shopConfigLoaded: true, waitlistWarning: { show: false },
}) }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
vi.mock('@/components/ProductFormModal/wizard/ScenarioBar', () => ({ ScenarioBar: () => null }));
vi.mock('@/components/ProductFormModal/wizard/FormSectionNav', () => ({ FormSectionNav: () => null }));
vi.mock('@/components/ProductFormModal/wizard/BuyerSummary', () => ({ BuyerSummary: () => null }));
vi.mock('@/components/ProductFormModal/wizard/WizardFooter', () => ({ WizardFooter: () => null }));
vi.mock('@/components/ProductFormModal/wizard/panels/BasicsPanel', () => ({ BasicsPanel: () => null }));
vi.mock('@/components/ProductFormModal/wizard/panels/DeliveryPanel', () => ({ DeliveryPanel: () => null }));
vi.mock('@/components/ProductFormModal/wizard/panels/CartPanel', () => ({ CartPanel: () => null }));
vi.mock('@/components/ProductFormModal/wizard/panels/OfferPanel', () => ({ OfferPanel: () => null }));
vi.mock('@/components/ProductFormModal/wizard/panels/SalesPanel', () => ({ SalesPanel: () => null }));
vi.mock('@/components/ProductFormModal/sections/EventSection', () => ({ EventSection: () => null }));
afterEach(cleanup);
it.each([false, true])('confirms closing only after a real edit (dirty=%s)', dirty => {
  state.dirty = dirty;
  const close = vi.fn();
  render(createElement(Wizard, { isOpen: true, onClose: close, onSubmit: vi.fn(), isSubmitting: false, error: null, product: { id: 'saved', name: 'Saved' } as Product }));
  fireEvent.click(screen.getByRole('button', { name: 'closeModal' }));
  if (dirty) {
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText('wizard.exitMessage')).toBeTruthy();
  } else {
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByText('wizard.exitMessage')).toBeNull();
  }
});
it('keeps confirmation for an unsaved duplicated draft', () => {
  state.dirty = false;
  const close = vi.fn();
  render(createElement(Wizard, { isOpen: true, onClose: close, onSubmit: vi.fn(), isSubmitting: false, error: null, product: { name: 'Saved' } as Product }));
  fireEvent.click(screen.getByRole('button', { name: 'closeModal' }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText('wizard.exitMessage')).toBeTruthy();
});
