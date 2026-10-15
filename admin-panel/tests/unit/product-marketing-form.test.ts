// @vitest-environment happy-dom
/** Product marketing editor fixtures. @see spec/contracts/product-marketing-fields.md */
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketingSection } from '@/components/ProductFormModal/sections/MarketingSection';
import { initialFormData } from '@/components/ProductFormModal/types';
import { marketingFieldsSchema } from '@/lib/validations/product-marketing';
import { mapApiInputToProductRow } from '@/lib/api/dto/product';
import type { ProductFormData } from '@/components/ProductFormModal/types';
import type { ProductMarketingFields } from '@/lib/validations/product-marketing';

vi.mock('next-intl', () => ({ useLocale: () => 'pl' }));
afterEach(cleanup);
const empty = { result: null, tools: [], requirements: [] };
const original: ProductMarketingFields = { format: null, sourceLocale: 'en', en: empty };
const t = (key: string) => key;
function Fixture({ fields = original }: { fields?: ProductMarketingFields }) {
  const [formData, setFormData] = useState<ProductFormData>({ ...initialFormData, marketing_fields: fields });
  return createElement('form', null,
    createElement(MarketingSection, { formData, setFormData, t }),
    createElement('output', { 'data-testid': 'value' }, JSON.stringify(formData.marketing_fields)),
  );
}
const value = () => JSON.parse(screen.getByTestId('value').textContent!) as ProductMarketingFields;

describe('Product marketing form', () => {
  it('shows source fallback without creating translation or result text', () => {
    render(createElement(Fixture));
    expect(screen.getByText('marketing.fallback')).toBeTruthy();
    expect(screen.queryByLabelText('marketing.result')).toBeNull();
    expect(value()).toEqual(original);
    fireEvent.click(screen.getByRole('button', { name: 'marketing.addTranslation' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('marketing.result').value).toBe('');
    expect(value().pl).toEqual(empty);
  });

  it('edits all metadata and round-trips the complete server DTO', () => {
    const view = render(createElement(Fixture));
    fireEvent.click(screen.getByRole('button', { name: 'marketing.addTranslation' }));
    fireEvent.change(screen.getByLabelText('marketing.format'), { target: { value: 'workshop' } });
    fireEvent.change(screen.getByLabelText('marketing.result'), { target: { value: 'Zbuduj raport' } });
    fireEvent.click(screen.getByRole('button', { name: 'marketing.addTools' }));
    fireEvent.change(screen.getByLabelText('marketing.tools 1'), { target: { value: 'n8n' } });
    fireEvent.click(screen.getByRole('button', { name: 'marketing.addRequirements' }));
    fireEvent.change(screen.getByLabelText('marketing.requirements 1'), { target: { value: 'Arkusz' } });
    fireEvent.change(screen.getByLabelText('marketing.sourceLocale'), { target: { value: 'pl' } });
    const fields = value();
    const saved = mapApiInputToProductRow({ marketing_fields: fields }, 'update');
    expect(saved.marketing_fields).toEqual({ format: 'workshop', sourceLocale: 'pl', en: empty, pl: { result: 'Zbuduj raport', tools: ['n8n'], requirements: ['Arkusz'] } });
    view.unmount();
    render(createElement(Fixture, { fields: saved.marketing_fields as ProductMarketingFields }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('marketing.result').value).toBe('Zbuduj raport');
    fireEvent.change(screen.getByLabelText('marketing.result'), { target: { value: '' } });
    expect(value().pl?.result).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'marketing.removeTools 1' }));
    expect(value().pl?.tools).toEqual([]);
  });

  it.each(['x'.repeat(241), '<b>result</b>', 'https://example.com'])('reports invalid copy with associated controls', (result) => {
    render(createElement(Fixture, { fields: { ...original, pl: { ...empty, result } } }));
    const control = screen.getByLabelText('marketing.result');
    expect(marketingFieldsSchema.safeParse(value()).success).toBe(false);
    expect(control.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  });

  it('keeps source text when changing editor language and removing an optional translation', () => {
    render(createElement(Fixture, { fields: { ...original, en: { ...empty, result: 'Build a report' }, pl: empty } }));
    fireEvent.click(screen.getByRole('button', { name: 'marketing.removeTranslation' }));
    expect(value().pl).toBeUndefined();
    fireEvent.change(screen.getByLabelText('marketing.locale'), { target: { value: 'en' } });
    expect(screen.getByLabelText<HTMLTextAreaElement>('marketing.result').value).toBe('Build a report');
    expect(screen.queryByRole('button', { name: 'marketing.removeTranslation' })).toBeNull();
  });

  it('bounds list additions and preserves long Unicode text', () => {
    const result = 'ą'.repeat(240);
    render(createElement(Fixture, { fields: { ...original, pl: { result, tools: Array.from({ length: 12 }, (_, i) => `Tool ${i}`), requirements: [] } } }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'marketing.addTools' }).disabled).toBe(true);
    expect(screen.getByLabelText<HTMLTextAreaElement>('marketing.result').value).toBe(result);
    expect(marketingFieldsSchema.safeParse(value()).success).toBe(true);
  });

  it.each([null, { ...original, extra: true }, { ...original, en: { ...empty, tools: ['a', 'a'] } }])('matches client/server rejection', (fields) => {
    expect(marketingFieldsSchema.safeParse(fields).success).toBe(false);
    expect(() => mapApiInputToProductRow({ marketing_fields: fields }, 'update')).toThrow();
  });
});
