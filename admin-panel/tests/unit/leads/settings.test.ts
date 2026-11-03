// @vitest-environment happy-dom
/** @see src/components/ProductFormModal/sections/EmbedSection.tsx */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbedSection } from '@/components/ProductFormModal/sections/EmbedSection';
import { initialFormData } from '@/components/ProductFormModal/types';
import { mapApiInputToProductRow } from '@/lib/api/dto/product';
import { validateUpdateProduct } from '@/lib/validations/product';

afterEach(cleanup);
describe('product lead consent settings', () => {
  it('defaults to optional consent and edits required, version, PL and EN wording', () => {
    const setFormData = vi.fn();
    render(createElement(EmbedSection, { formData: initialFormData, setFormData, t: (key: string) => key } as never));
    const toggle = screen.getByLabelText('embedSection.leadRequired');
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(setFormData.mock.calls.at(-1)?.[0](initialFormData).lead_consent_required).toBe(true);
    for (const [label, field] of [['leadVersion', 'lead_consent_version'], ['leadTextPl', 'lead_consent_text_pl'], ['leadTextEn', 'lead_consent_text_en']]) {
      fireEvent.change(screen.getByLabelText(`embedSection.${label}`), { target: { value: 'Updated' } });
      expect(setFormData.mock.calls.at(-1)?.[0](initialFormData)[field]).toBe('Updated');
    }
    expect(screen.getByText('embedSection.leadRisk')).toBeTruthy();
  });
  it('retains every consent field through the v1 product write mapper', () => {
    const settings = { lead_consent_required: true, lead_consent_version: 'v2', lead_consent_text_pl: 'Polska zgoda', lead_consent_text_en: 'English consent' };
    expect(mapApiInputToProductRow(settings, 'update')).toEqual(settings);
    expect(mapApiInputToProductRow({ name: 'Guide', slug: 'guide', price: 0, ...settings }, 'create')).toMatchObject(settings);
  });
  it('rejects invalid settings through the product write validator', () => {
    expect(validateUpdateProduct({ lead_consent_required: 'true' } as never).isValid).toBe(false);
    expect(validateUpdateProduct({ lead_consent_text_en: '' } as never).isValid).toBe(false);
    expect(validateUpdateProduct({ lead_consent_version: 'v2' } as never).isValid).toBe(true);
  });
});
