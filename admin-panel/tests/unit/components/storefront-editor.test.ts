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
vi.mock('@/lib/actions/storefront-templates', () => ({ storefrontTemplateAction: action }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function snapshot(): TemplateReadResult {
  const published = { format: 1 as const, templateId: 'd' as const, settingsByTemplate: { d: { heroProduct: '11111111-1111-4111-8111-111111111111' } }, overridesByTemplate: {}, tokens: null,
    content: { 'home.hero': { sourceLocale: 'en' as const, en: { kind: 'hero' as const, heading: 'A workshop', eyebrow: '', body: '', steps: ['Choose input'] } } } };
  const rights = templateRightsForTier('free');
  return { revision: 7, draft: null, published, rights, ...inspectTemplate(published, rights, 'draft') };
}
function setup(locale = 'en') {
  return render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(StorefrontEditor, { initial: snapshot() })));
}
describe('storefront editor', () => {
  it('retains inactive bindings, slots and overrides through D/default/D and saves at the read revision', async () => {
    action.mockResolvedValueOnce({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Move hero down' }));
    fireEvent.click(view.getByRole('checkbox', { name: 'Show tasks' }));
    fireEvent.change(view.getByLabelText('Template'), { target: { value: 'default' } });
    fireEvent.change(view.getByLabelText('Template'), { target: { value: 'd' } });
    expect((view.getByLabelText('Featured offer') as HTMLInputElement).value).toBe(snapshot().published.settingsByTemplate.d!.heroProduct);
    expect(view.getByDisplayValue('A workshop')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    const input = action.mock.calls[0][0];
    expect(input.expectedRevision).toBe(7);
    expect(input.config.overridesByTemplate.d.hidden).toEqual(['tasks']);
    expect(input.config.overridesByTemplate.d.order[0]).toBe('tasks');
    expect(input.config.content).toEqual(snapshot().published.content);
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('8'));
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
  it('keeps comma-separated input editable and refreshes saved diagnostics', async () => {
    const view = setup();
    const input = view.getByLabelText('Three starts') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '22222222-2222-4222-8222-222222222222,' } });
    expect(input.value.endsWith(',')).toBe(true);
    action.mockResolvedValueOnce({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
    action.mockResolvedValueOnce({ success: true, data: { ...snapshot(), revision: 8, effectiveTemplateId: 'd', unusedSlots: ['home.hero'] } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(view.getByText('Public fallback with current rights: d')).toBeTruthy();
    expect(view.getByText('Unused slots: home.hero')).toBeTruthy();
  });
  it('discards raw binding edits when reloading the same saved revision', async () => {
    const view = setup();
    fireEvent.change(view.getByLabelText('Featured offer'), { target: { value: 'unfinished' } });
    fireEvent.click(view.getByRole('button', { name: 'Reload saved draft' }));
    action.mockResolvedValueOnce({ success: true, data: snapshot() });
    fireEvent.click(view.getByRole('button', { name: 'Discard edits and reload' }));
    await waitFor(() => expect((view.getByLabelText('Featured offer') as HTMLInputElement).value).toBe(snapshot().published.settingsByTemplate.d!.heroProduct));
  });
  it('validates invalid UUIDs locally and presents structured paths without saving', async () => {
    const view = setup();
    fireEvent.change(view.getByLabelText('Featured offer'), { target: { value: 'invalid' } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    expect(view.getByRole('alert').textContent).toContain('/settingsByTemplate/d/heroProduct');
    expect(action).not.toHaveBeenCalled();
  });
  it('edits translated content, steps and FAQ without replacing source content', async () => {
    action.mockResolvedValue({ success: true, revision: 8, validation: { valid: true, errors: [], warnings: [] } });
    const view = setup();
    const hero = view.getByRole('group', { name: 'home.hero' });
    fireEvent.click(hero.querySelector('button[data-add-locale="pl"]')!);
    fireEvent.change(view.getByLabelText('home.hero · PL · Heading'), { target: { value: 'Żółć i ćwiczenia' } });
    fireEvent.click(view.getByRole('button', { name: 'Add home.faq' }));
    fireEvent.click(view.getByRole('button', { name: 'Add question' }));
    fireEvent.change(view.getByLabelText('home.faq · EN · Question 1'), { target: { value: 'Requirements?' } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    const content = action.mock.calls[0][0].config.content;
    expect(content['home.hero'].en).toEqual(snapshot().published.content['home.hero']!.en);
    expect(content['home.hero'].pl.heading).toBe('Żółć i ćwiczenia');
    expect(content['home.faq'].en.items[0].question).toBe('Requirements?');
  });
  it.each(['en', 'pl'])('shows localized fallback, unused slots and all origins in %s', locale => {
    const view = setup(locale);
    expect(view.getByText(locale === 'pl' ? 'Szablony sklepu' : 'Storefront templates')).toBeTruthy();
    expect(view.getByText(/TRANSLATION_FALLBACK/)).toBeTruthy();
    expect(view.getByText('tokens.light.accent')).toBeTruthy();
    expect(view.getByRole('button', { name: locale === 'pl' ? 'Zapisz szkic' : 'Save draft' })).toBeTruthy();
    expect(view.container.querySelector('input[type="checkbox"][disabled]')).toBeTruthy();
  });
});
