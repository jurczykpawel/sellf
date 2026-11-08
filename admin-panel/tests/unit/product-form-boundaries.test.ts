// @vitest-environment happy-dom
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCreateProduct, validateUpdateProduct } from '@/lib/validations/product';
import { collectRequiredFieldErrors, serverFieldErrors } from '@/components/ProductFormModal/hooks/required-fields';
import { initialFormData } from '@/components/ProductFormModal/types';
import { ContentDeliverySection } from '@/components/ProductFormModal/sections/ContentDeliverySection';
import { ProductTypeRadio } from '@/components/ProductFormModal/sections/ProductTypeRadio';
import { PostPurchaseSection } from '@/components/ProductFormModal/sections/PostPurchaseSection';
import { SubscriptionSection } from '@/components/ProductFormModal/sections/SubscriptionSection';
import { LicenseSection } from '@/components/ProductFormModal/sections/LicenseSection';
import { BasicInfoSection } from '@/components/ProductFormModal/sections/BasicInfoSection';
import ProductCreationWizard from '@/components/ProductFormModal/wizard/ProductCreationWizard';
import { useProductForm } from '@/components/ProductFormModal/hooks/useProductForm';
import type { Product } from '@/types';
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ trustedDownloadDomains: ['drive.google.com'] }) }));
vi.mock('@/lib/actions/categories', () => ({ getCategories: vi.fn().mockResolvedValue({ success: true, data: [] }), getProductCategories: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('@/lib/actions/tags', () => ({ getTags: vi.fn().mockResolvedValue({ success: true, data: [] }), getProductTags: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('@/lib/actions/shop-config', () => ({ getMyShopConfig: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn().mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }) }));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/api/client', async original => ({ ...(await original<typeof import('@/lib/api/client')>()), api: { getCustom: vi.fn().mockResolvedValue({ has_oto: false }) } }));
vi.mock('@/utils/themeUtils', () => ({ getIconEmoji: () => '🚀' }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
vi.mock('@/components/ui/Modal', () => {
  const Container = ({ children }: { children: React.ReactNode }) => children;
  return { BaseModal: Container, ModalSection: Container, ModalBody: Container, ModalHeader: () => null, Button: () => null, Message: () => null };
});
vi.mock('@/components/ProductFormModal/wizard/steps/StepEssentials', () => ({ StepEssentials: (props: React.ComponentProps<typeof ProductTypeRadio>) => createElement(ProductTypeRadio, props) }));
vi.mock('@/components/ProductFormModal/wizard/steps/StepContentDetails', () => ({ StepContentDetails: () => null }));
vi.mock('@/components/ProductFormModal/wizard/steps/StepSalesSettings', () => ({ StepSalesSettings: () => null }));
vi.mock('@/components/ProductFormModal/wizard/WizardStepIndicator', () => ({ WizardStepIndicator: () => null }));
vi.mock('@/components/ProductFormModal/wizard/WizardFooter', () => ({ WizardFooter: () => null }));
vi.mock('@/components/player/VideoOptionsPanel', () => ({ VideoOptionsPanel: () => null }));
vi.mock('@/components/ProductFormModal/sections/ConversionBadge', () => ({ ConversionBadge: () => null }));
const t = (key: string) => key;
const base = { ...initialFormData, name: 'Product', slug: 'product', price: 10, price_includes_vat: false, ux_product_type: 'standard' as const };
afterEach(cleanup);

describe('content URLs', () => {
  it.each([validateCreateProduct, validateUpdateProduct])('validates URL configuration for each content type', validate => {
    for (const type of ['video_embed', 'download_link']) {
      const config = type === 'download_link' ? { embed_url: 'javascript:alert(1)' } : { download_url: 'data:text/html,x' };
      expect(validate({ ...base, content_config: { content_items: [{ type, config }] } }).isValid).toBe(false);
    }
  });
  it('switching type moves the URL and subsequent edits remain visible', () => {
    function Form() {
      const [formData, setFormData] = useState({ ...base, content_config: { content_items: [{ id: '1', type: 'video_embed' as const, title: 'File', order: 1, is_active: true, config: { embed_url: 'https://drive.google.com/file/1' } }] } });
      return createElement(ContentDeliverySection, { formData, setFormData: setFormData as never, t, urlValidation: {}, setUrlValidation: vi.fn(), validateContentItemUrl: vi.fn() });
    }
    render(createElement(Form));
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'download_link' } });
    const input = document.getElementById('content_url_0') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://drive.google.com/file/2' } });
    expect(input.value).toBe('https://drive.google.com/file/2');
  });
});

describe('field errors', () => {
  it('flags invalid fields before the API call', () => {
    expect(collectRequiredFieldErrors({ ...base, name: 'x'.repeat(201), slug: 'bad-', price: 1000000, trial_days: 731, product_type: 'subscription', recurring_price: 1000000, issue_license_on_purchase: true, license_tier: '<script>x</script>' }, '1000000', 'stripe_tax'))
      .toMatchObject({ name: 'invalid', slug: 'invalid', recurring_price: 'invalid', trial_days: 'invalid', license_tier: 'invalid' });
    expect(collectRequiredFieldErrors({ ...base, price: 1000000 }, '1000000', 'stripe_tax').price).toBe('invalid');
    expect(collectRequiredFieldErrors({ ...base, slug: 'a'.repeat(81) }, '10', 'stripe_tax').slug).toBe('invalid');
  });
  it('maps actual API _errors and direct fields', () => {
    expect(serverFieldErrors({ _errors: ['name: Too big', 'Slug cannot end with hyphens', 'trial_days must be an integer between 0 and 730', 'license_tier: Too big'], price: ['too big'] }))
      .toMatchObject({ name: 'invalid', slug: 'invalid', trial_days: 'invalid', license_tier: 'invalid', price: expect.any(String) });
  });
  it('generates a valid transliterated slug', async () => {
    const { result } = renderHook(() => useProductForm({ isOpen: true, onSubmit: vi.fn() }));
    await act(async () => {});
    expect(result.current.generateSlug(' Zły slug ąę!! ')).toBe('zly-slug-ae');
  });
  it('renders accessible errors at trial, tier and slug', () => {
    const props = { formData: { ...base, product_type: 'subscription' as const, issue_license_on_purchase: true }, setFormData: vi.fn(), t, fieldErrors: { trial_days: 'invalid', license_tier: 'invalid', slug: 'invalid' } };
    render(createElement(SubscriptionSection, props));
    render(createElement(LicenseSection, props));
    render(createElement(BasicInfoSection, { ...props, nameInputRef: { current: null }, slugModified: true, setSlugModified: vi.fn(), currentDomain: '', generateSlug: (v: string) => v }));
    for (const id of ['trial_days', 'license-tier', 'slug']) {
      const field = document.getElementById(id)!;
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
    }
  });
  it.each([validateCreateProduct, validateUpdateProduct])('server rejects invalid license tier', validate => {
    expect(validate({ ...base, license_tier: '<script>x</script>' }).isValid).toBe(false);
    expect(validate({ ...base, license_tier: 'pro-yearly_1' }).isValid).toBe(true);
  });
});

it('shows recurring price in redirect selector and selected product', () => {
  const sub = { ...base, id: 'sub', slug: 'sub', name: 'Sub', price: 0, product_type: 'subscription', recurring_price: 49, billing_interval: 'month', billing_interval_count: 1 } as Product;
  render(createElement(PostPurchaseSection, { formData: { ...base, success_redirect_url: '/checkout/sub' }, setFormData: vi.fn(), t, products: [sub], loadingProducts: false, oto: { enabled: false } as never, setOto: vi.fn() }));
  expect(screen.getByRole('option', { name: /Sub/ }).textContent).toContain('49,00');
  expect(screen.getAllByText(/49,00.*mies/).length).toBe(2);
});

it('blocks visible presets below minimum, accepting hidden zero', () => {
  const tip = { ...base, price: 0, currency: 'JPY', allow_custom_price: true, ux_product_type: 'tip-jar' as const, custom_price_min: 100, show_price_presets: true, custom_price_presets: [5, 10, 25] };
  expect(collectRequiredFieldErrors(tip, '', 'stripe_tax').custom_price_presets).toBe('invalid');
  expect(validateCreateProduct(tip).isValid).toBe(false);
  const valid = { ...tip, custom_price_presets: [0, 100, 200] };
  expect(collectRequiredFieldErrors(valid, '', 'stripe_tax').custom_price_presets).toBeUndefined();
  expect(validateCreateProduct(valid).isValid).toBe(true);
});

it('validates new-product content before submission', async () => {
  const onSubmit = vi.fn();
  const { result } = renderHook(() => useProductForm({ isOpen: true, onSubmit }));
  await act(async () => {});
  act(() => result.current.setFormData({ ...base, ux_product_type: 'lead-magnet', price: 0, content_config: { content_items: [{ id: 'x', title: 'File', type: 'download_link', config: { download_url: 'javascript:alert(1)' }, order: 1, is_active: true }] } }));
  await act(async () => result.current.handleSubmit({ preventDefault() {} } as React.FormEvent));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(result.current.urlValidation[0]?.isValid).toBe(false);
  act(() => result.current.setFormData(prev => ({ ...prev, content_config: { content_items: [{ id: 'x', title: 'File', type: 'download_link', config: { download_url: 'https://drive.google.com/file/1' }, order: 1, is_active: true }] } })));
  await act(async () => result.current.handleSubmit({ preventDefault() {} } as React.FormEvent));
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0][0].content_config.content_items[0].config).toEqual({ download_url: 'https://drive.google.com/file/1' });
});


it('guards the first pointer click after opening a duplicate, then allows a later click', async () => {
  vi.useFakeTimers();
  try {
    render(createElement(ProductCreationWizard, { isOpen: true, product: { ...base, id: '' } as Product, onSubmit: vi.fn(), onClose: vi.fn(), isSubmitting: false, error: null }));
    await act(async () => {});
    const lead = document.querySelector('[data-product-type="lead-magnet"]')!;
    fireEvent.click(lead, { detail: 1 });
    expect(lead.getAttribute('aria-checked')).toBe('false');
    act(() => vi.advanceTimersByTime(501));
    fireEvent.click(lead, { detail: 1 });
    expect(lead.getAttribute('aria-checked')).toBe('true');
  } finally { vi.useRealTimers(); }
});

it('permits keyboard activation while the duplicate is opening', async () => {
  render(createElement(ProductCreationWizard, { isOpen: true, product: { ...base, id: '' } as Product, onSubmit: vi.fn(), onClose: vi.fn(), isSubmitting: false, error: null }));
  await act(async () => {});
  const lead = document.querySelector('[data-product-type="lead-magnet"]')!;
  fireEvent.click(lead, { detail: 0 });
  expect(lead.getAttribute('aria-checked')).toBe('true');
});

it('preserves a manually typed separator until the slug is complete', async () => {
  const { result } = renderHook(() => useProductForm({ isOpen: true, onSubmit: vi.fn() }));
  await act(async () => {});
  act(() => result.current.handleInputChange({ target: { name: 'slug', value: 'first-', type: 'text' } } as React.ChangeEvent<HTMLInputElement>));
  expect(result.current.formData.slug).toBe('first-');
  act(() => result.current.handleInputChange({ target: { name: 'slug', value: 'first-part', type: 'text' } } as React.ChangeEvent<HTMLInputElement>));
  expect(result.current.formData.slug).toBe('first-part');
});

it('lets the seller type a hyphenated slug in the visible field', async () => {
  function Form() {
    const form = useProductForm({ isOpen: true, onSubmit: vi.fn() });
    return createElement(BasicInfoSection, { ...form, t });
  }
  render(createElement(Form));
  await act(async () => {});
  const input = document.querySelector<HTMLInputElement>('#slug')!;
  fireEvent.change(input, { target: { value: 'first-' } });
  expect(input.value).toBe('first-');
  fireEvent.change(input, { target: { value: 'first-part' } });
  expect(input.value).toBe('first-part');
});

it('distinguishes upper price limits from minimum price feedback', () => {
  expect(serverFieldErrors({ price: ['Price cannot exceed 999999.99'] }).price).toBe('invalid');
  expect(serverFieldErrors({ price: ['Price must be at least the minimum charge'] }).price).toBe('below_minimum');
});
