// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import CategoryFormModal from '@/components/CategoryFormModal';
import TagFormModal from '@/components/TagFormModal';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const actions = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/lib/actions/categories', () => ({ createCategory: actions.save, updateCategory: actions.save }));
vi.mock('@/lib/actions/tags', () => ({ createTag: actions.save, updateTag: actions.save }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
for (const [locale, messages] of Object.entries({ en, pl })) {
  for (const kind of ['category', 'tag'] as const) {
    it.each(['slug', 'name', 'empty', ...(kind === 'category' ? ['description'] : [])])(`${locale} ${kind} validates %s at its field before saving`, async field => {
      const item = { id: 'test', name: 'Name', slug: 'valid', description: '', created_at: '' };
      render(React.createElement(NextIntlClientProvider, { locale, messages, children: kind === 'category'
        ? React.createElement(CategoryFormModal, { isOpen: true, onClose: vi.fn(), category: item })
        : React.createElement(TagFormModal, { isOpen: true, onClose: vi.fn(), tag: item }) }));
      const input = document.querySelectorAll('input,textarea')[['name', 'slug', 'description'].indexOf(field === 'empty' ? 'name' : field)] as HTMLInputElement;
      fireEvent.change(input, { target: { value: field === 'empty' ? '   ' : field === 'slug' ? 'bad slug <script>' : 'x'.repeat(field === 'description' ? 501 : 220) } });
      fireEvent.submit(document.querySelector('form')!);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const error = document.getElementById(input.getAttribute('aria-describedby')!);
      expect(error?.textContent).toBe(field === 'slug' ? messages.common.taxonomyValidation.slug : field === 'empty' ? messages.common.taxonomyValidation.required : messages.common.taxonomyValidation.tooLong.replace('{max}', String(field === 'description' ? 500 : kind === 'tag' ? 50 : 100)));
      expect(error?.textContent).not.toMatch(/regex|expected string|must match/);
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(actions.save).not.toHaveBeenCalled();
      fireEvent.input(input, { target: { value: 'valid' } });
      expect(input.getAttribute('aria-invalid')).toBe('false');
    });
  }
}
