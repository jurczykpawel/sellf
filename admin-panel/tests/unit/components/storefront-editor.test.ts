// @vitest-environment happy-dom
/** Composition authoring interactions. @see storefront-config.md */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StorefrontEditor from '@/components/storefront-editor/StorefrontEditor';
import { inspectTemplate } from '@/lib/storefront-templates/lifecycle-validation';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import type { TemplateReadResult } from '@/lib/storefront-templates/lifecycle';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
const action = vi.hoisted(() => vi.fn());
const products = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Automation workshop', price: 49, currency: 'PLN', is_active: true, image_url: null }, { id: '22222222-2222-4222-8222-222222222222', name: 'Reporting course', price: 99, currency: 'PLN', is_active: true, image_url: null }];
vi.mock('@/lib/api/client', () => ({ api: { list: async () => ({ data: products, pagination: { has_more: false } }), get: async (_resource: string, id: string) => products.find(item => item.id === id) } }));
vi.mock('@/lib/actions/categories', () => ({ getCategories: async () => ({ success: true, data: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Automation' }] }) }));
vi.mock('@/lib/actions/storefront-templates', () => ({ storefrontTemplateAction: action }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function snapshot(): TemplateReadResult {
  const published = { format: 1 as const, templateId: 'd' as const, settingsByTemplate: { d: { heroProduct: '11111111-1111-4111-8111-111111111111' } }, overridesByTemplate: {}, tokens: null,
    content: { 'home.hero': { sourceLocale: 'en' as const, en: { kind: 'hero' as const, heading: 'A workshop', eyebrow: '', body: '', steps: ['Choose input'] } } } };
  const rights = templateRightsForTier('free');
  return { revision: 7, draft: null, published, rights: { ...rights, canPublish: [{ templateId: 'default', allowed: true, reason: null }, { templateId: 'd', allowed: false, reason: 'ENTITLEMENT' }] }, ...inspectTemplate(published, rights, 'draft') };
}
function setup(locale = 'en') {
  return render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(StorefrontEditor, { initial: snapshot() })));
}
describe('storefront editor', () => {
  it('retains inactive bindings, slots and overrides through D/default/D and saves at the read revision', async () => {
    action.mockResolvedValueOnce({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
    const view = setup();
    fireEvent.keyDown(view.getByRole('button', { name: /Reorder Hero/ }), { key: 'ArrowDown' });
    fireEvent.click(view.getByRole('checkbox', { name: 'Show How it works' }));
    fireEvent.change(view.getByLabelText('Template'), { target: { value: 'default' } });
    fireEvent.change(view.getByLabelText('Template'), { target: { value: 'd' } });
    await waitFor(() => expect(view.getByText('Automation workshop')).toBeTruthy());
    expect(view.getByDisplayValue('A workshop')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    const input = action.mock.calls[0][0];
    expect(input.expectedRevision).toBe(7);
    expect(input.config.overridesByTemplate.d.sections.tasks.visibility).toBe('hidden');
    expect(input.config.overridesByTemplate.d.order[0]).toBe('tasks');
    expect(input.config.content).toEqual(snapshot().published.content);
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('All changes saved'));
    expect(view.getByText('Revision 8')).toBeTruthy();
  });
  it('keeps edits after a conflict and blocks further saves until explicit reload', async () => {
    action.mockResolvedValueOnce({ success: false, code: 'CONFLICT', currentRevision: 9, validation: null });
    const view = setup();
    fireEvent.change(view.getByDisplayValue('A workshop'), { target: { value: 'Local work' } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('newer revision'));
    expect(view.getByDisplayValue('Local work')).toBeTruthy();
    expect((view.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Reload saved draft' }));
    expect(action).toHaveBeenCalledTimes(1);
    action.mockResolvedValueOnce({ success: true, data: { ...snapshot(), revision: 9 } });
    fireEvent.click(view.getByRole('button', { name: 'Discard edits and reload' }));
    await waitFor(() => expect(view.getByDisplayValue('A workshop')).toBeTruthy());
    expect(action.mock.calls[1][0]).toEqual({ operation: 'read' });
  });
  it('picks products and categories by name and refreshes saved diagnostics', async () => {
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Starting offers', exact: true }));
    await waitFor(() => expect(view.getByRole('button', { name: /Add Reporting course/ })).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: /Add Reporting course/ }));
    fireEvent.click(view.getByRole('button', { name: 'How it works', exact: true }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Add Automation', exact: true })).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: 'Add Automation', exact: true }));
    action.mockResolvedValueOnce({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
    action.mockResolvedValueOnce({ success: true, data: { ...snapshot(), revision: 8, effectiveTemplateId: 'd', unusedSlots: ['home.hero'] } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[0][0].config.settingsByTemplate.d.starterProducts).toEqual([products[1].id]);
    expect(action.mock.calls[0][0].config.settingsByTemplate.d.taskCategories).toEqual(['33333333-3333-4333-8333-333333333333']);
    expect(view.getByText('Public fallback with current rights: Guided storefront')).toBeTruthy();
  });
  it('discards binding changes when reloading the same saved revision', async () => {
    const view = setup();
    await waitFor(() => expect(view.getByRole('button', { name: 'Remove Automation workshop' })).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: 'Remove Automation workshop' }));
    fireEvent.click(view.getByRole('button', { name: 'Reload saved draft' }));
    action.mockResolvedValueOnce({ success: true, data: snapshot() });
    fireEvent.click(view.getByRole('button', { name: 'Discard edits and reload' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Remove Automation workshop' })).toBeTruthy());
  });
  it('validates malformed retained data without offering UUID inputs', () => {
    const initial = snapshot(); initial.published.settingsByTemplate.d!.heroProduct = 'invalid';
    const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(StorefrontEditor, { initial })));
    fireEvent.change(view.getByDisplayValue('A workshop'), { target: { value: 'Edited' } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    expect(view.getByRole('alert').textContent).not.toContain('/settingsByTemplate');
    expect(view.getByRole('alert').textContent).toContain('Check the highlighted settings');
    expect(action).not.toHaveBeenCalled();
    expect(view.queryByDisplayValue('invalid')).toBeNull();
  });
  it('edits translated content, steps and FAQ without replacing source content', async () => {
    action.mockResolvedValue({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
    const view = setup();
    const hero = view.getByRole('group', { name: 'Hero content' });
    fireEvent.click(hero.querySelector('button[data-add-locale="pl"]')!);
    fireEvent.change(view.getByLabelText('Hero · PL · Heading'), { target: { value: 'Żółć i ćwiczenia' } });
    fireEvent.click(view.getByRole('button', { name: 'Questions & answers', exact: true }));
    fireEvent.click(view.getByRole('button', { name: 'Add question' }));
    fireEvent.change(view.getByLabelText('Questions & answers · EN · Question 1'), { target: { value: 'Requirements?' } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    const content = action.mock.calls[0][0].config.content;
    expect(content['home.hero'].en).toEqual(snapshot().published.content['home.hero']!.en);
    expect(content['home.hero'].pl.heading).toBe('Żółć i ćwiczenia');
    expect(content['home.faq'].en.items[0].question).toBe('Requirements?');
  });
  it('keeps retained content read-only while a save is in flight', () => {
    action.mockImplementation(() => new Promise(() => {}));
    const base = snapshot();
    const initial = { ...base, published: { ...base.published, templateId: 'default' as const }, unusedSlots: ['home.hero'] };
    const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(StorefrontEditor, { initial })));
    fireEvent.click(view.getByText('Technical details'));
    const heading = view.getByDisplayValue('A workshop');
    fireEvent.change(heading, { target: { value: 'Retained copy' } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    expect(heading.closest('fieldset[disabled]') ?? heading.parentElement?.closest('fieldset[disabled]')).toBeTruthy();
  });
  it.each(['en', 'pl'])('shows localized fallback, unused slots and all origins in %s', locale => {
    const view = setup(locale);
    expect(view.getByText(locale === 'pl' ? 'Szablony sklepu' : 'Storefront templates')).toBeTruthy();
    const details = view.container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('TRANSLATION_FALLBACK');
    expect(view.getByText(locale === 'pl' ? 'Ten szablon wymaga Pro — sklep pokazuje szablon darmowy.' : 'This template requires Pro — your store shows the free template.')).toBeTruthy();
    expect(view.getByText('tokens.light.accent')).toBeTruthy();
    expect(view.getByRole('button', { name: locale === 'pl' ? 'Zapisz szkic' : 'Save draft' })).toBeTruthy();
    expect(view.container.querySelector('input[type="checkbox"][disabled]')).toBeTruthy();
  });
});

it('edits appearance with live origins and contrast feedback, retaining content', async () => {
  const view = setup();
  fireEvent.click(view.getByRole('button', { name: 'Appearance', exact: true }));
  expect(view.container.querySelectorAll('[data-token-origin]')).toHaveLength(22);
  fireEvent.change(view.getByLabelText('Light · Accent'), { target: { value: '#ffffff' } });
  expect(view.getByText('Improve contrast before publishing. Your draft can still be saved.')).toBeTruthy();
  action.mockResolvedValueOnce({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
  fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(action).toHaveBeenCalled());
  expect(action.mock.calls[0][0].config.tokens).toEqual({ format: 1, light: { accent: '#ffffff' } });
  expect(action.mock.calls[0][0].config.content).toEqual(snapshot().published.content);
});
it('resets a saved seller leaf through the strict reset operation', async () => {
  const initial = snapshot(); initial.published.tokens = { format: 1, typography: { font: 'dm-sans' } };
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(StorefrontEditor, { initial })));
  fireEvent.click(view.getByRole('button', { name: 'Appearance', exact: true }));
  action.mockResolvedValueOnce({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
  action.mockResolvedValueOnce({ success: true, data: { ...snapshot(), revision: 8 } });
  fireEvent.click(view.getByRole('button', { name: 'Reset Font' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[0][0]).toEqual({ operation: 'reset', expectedRevision: 7, templateId: 'd', field: 'tokens.typography.font' });
  expect(view.getByLabelText('Font')).toHaveProperty('value', 'geist');
});
it('shows the protected appearance values separately from storefront overrides', () => {
  const initial = snapshot(); initial.published.tokens = { format: 1, shapes: { radiusMdPx: 8 } };
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(StorefrontEditor, { initial })));
  fireEvent.click(view.getByRole('button', { name: 'Appearance', exact: true }));
  expect(view.getByText('Checkout and sign-in')).toBeTruthy();
  expect(view.getAllByText(/Protected by Sellf/).length).toBeGreaterThan(0);
  expect(view.getByText('12 · Protected by Sellf')).toBeTruthy();
  expect(view.container.querySelectorAll('[data-token-origin]')).toHaveLength(22);
});

it('edits section map leaves independently and returns variants to inherited defaults', async () => {
  const view = setup();
  fireEvent.change(view.getByLabelText('Layout style'), { target: { value: 'simple' } });
  fireEvent.click(view.getByRole('checkbox', { name: 'Show How it works' }));
  fireEvent.change(view.getByLabelText('Layout style'), { target: { value: '' } });
  action.mockResolvedValueOnce({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
  fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(action).toHaveBeenCalled());
  const overrides = action.mock.calls[0][0].config.overridesByTemplate.d;
  expect(overrides.sections.tasks).toEqual({ visibility: 'hidden' });
  expect(overrides.sections.hero).toEqual({});
  expect(overrides).not.toHaveProperty('hidden'); expect(overrides).not.toHaveProperty('variants');
});

 it.each(['en', 'pl'])('describes the loaded state without claiming a save in %s', locale => {
  const view = setup(locale);
  expect(view.getByRole('status').textContent).toContain(locale === 'pl' ? 'Brak niezapisanych zmian' : 'No unsaved changes');
  expect(view.getByRole('status').textContent).not.toContain(locale === 'pl' ? 'Zapisano zmiany' : 'All changes saved');
});

it.each(['en', 'pl'])('opens only the saved draft from the editor and appearance in %s', async locale => {
  const view = setup(locale);
  const preview = locale === 'pl' ? 'Podgląd' : 'Preview';
  const history = locale === 'pl' ? 'Historia i publikacja' : 'History and publishing';
  expect(view.getByRole('button', { name: preview, exact: true })).toHaveProperty('disabled', true);
  expect(view.getByRole('button', { name: history, exact: true })).toHaveProperty('disabled', true);
  fireEvent.change(view.getByDisplayValue('A workshop'), { target: { value: 'Saved workshop' } });
  action.mockResolvedValueOnce({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
  fireEvent.click(view.getByRole('button', { name: locale === 'pl' ? 'Zapisz szkic' : 'Save draft' }));
  const url = `/template-preview/8?locale=${locale}&fixture=published-products`;
  await waitFor(() => expect(view.getByRole('link', { name: preview, exact: true }).getAttribute('href')).toBe(url));
  expect(view.getByRole('link', { name: history, exact: true }).getAttribute('href')).toBe(`${locale === 'pl' ? '/pl' : ''}/admin/templates/history`);
  fireEvent.click(view.getByRole('button', { name: locale === 'pl' ? 'Wygląd' : 'Appearance', exact: true }));
  expect(view.getAllByRole('link', { name: preview, exact: true })).toHaveLength(2);
  fireEvent.change(view.getByLabelText(locale === 'pl' ? 'Jasny · Akcent' : 'Light · Accent'), { target: { value: '#333333' } });
  expect(view.queryByRole('link', { name: preview, exact: true })).toBeNull();
  expect(view.getAllByRole('button', { name: preview, exact: true }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
});
