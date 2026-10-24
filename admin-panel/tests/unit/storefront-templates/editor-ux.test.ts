// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import SlotEditor from '@/components/storefront-editor/SlotEditor';
const actions = vi.hoisted(() => ({ storefrontTemplateAction: vi.fn() }));
vi.mock('@/lib/actions/storefront-templates', () => actions);
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/components/storefront-editor/BindingPicker', () => ({ default: () => null }));
vi.mock('@/components/storefront-editor/TemplateLicenses', () => ({ default: () => null }));
afterEach(cleanup);
it.each(['a < b', 'a > b'])('identifies the exact invalid content field: %s', heading => {
  const { container } = render(createElement(SlotEditor, { id: 'home.hero', value: { sourceLocale: 'pl', pl: { kind: 'hero', heading, eyebrow: '', body: '', steps: [] } }, onChange: vi.fn() }));
  const input = screen.getByRole('textbox', { name: 'sectionNames.hero · PL · heading' });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(container.querySelector(`[id="${input.getAttribute('aria-describedby')}"]`)?.textContent).toBe('forbiddenAngles');
  expect(screen.getByRole('textbox', { name: 'sectionNames.hero · PL · body' }).getAttribute('aria-invalid')).not.toBe('true');
});
it('does not hyphenate hero headings', () => {
  expect(readFileSync('src/components/storefront/sections/HeroProduct.module.css', 'utf8')).not.toMatch(/hyphens:\s*auto/);
});
it('keeps save disabled after returning content to its saved value', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const { fireEvent } = await import('@testing-library/react');
  const { default: StorefrontEditor } = await import('@/components/storefront-editor/StorefrontEditor');
  const { D_CONFIG } = await import('@/lib/storefront-templates/fixtures');
  render(createElement(StorefrontEditor, { initial: { unusedSlots: [], effectiveTokens: [], effectiveTemplateId: 'd', revision: 1, draft: D_CONFIG, published: null, validation: { valid: true, validatorVersion: 1, errors: [], warnings: [] }, rights: { availableTemplateIds: ['d'] } } as Parameters<typeof StorefrontEditor>[0] }));
  const input = screen.getByRole('textbox', { name: /EN · heading/ });
  const original = (input as HTMLInputElement).value;
  fireEvent.change(input, { target: { value: 'Changed' } });
  expect(screen.getByRole('button', { name: 'save', exact: true })).toHaveProperty('disabled', false);
  fireEvent.change(input, { target: { value: original } });
  expect(screen.getByRole('button', { name: 'save', exact: true })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'save', exact: true }));
  expect(actions.storefrontTemplateAction).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('identifies invalid nested FAQ answers', () => {
  render(createElement(SlotEditor, { id: 'home.faq', value: { sourceLocale: 'pl', pl: { kind: 'faq', items: [{ id: 'question-1', question: 'Question', answer: 'a > b' }] } }, onChange: vi.fn() }));
  expect(screen.getByRole('textbox', { name: 'sectionNames.faq · PL · answer' }).getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('textbox', { name: 'sectionNames.faq · PL · question' }).getAttribute('aria-invalid')).toBe('false');
});
