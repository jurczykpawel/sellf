// @vitest-environment happy-dom
/**
 * Keyboard focus around an editor that first loads its stored record: the loading layer
 * takes focus while it waits, and afterwards focus must go back to the control that opened
 * the editor — after the editor closes, after Cancel on the loading layer, and after a failed read.
 *
 * @see src/hooks/useStoredRecord.ts
 * @see src/components/ui/RecordLoadingOverlay.tsx
 * @see src/components/ProductsPageContent.tsx
 * @see src/components/WebhooksPageContent.tsx
 */
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useStoredRecord } from '@/hooks/useStoredRecord';
import RecordLoadingOverlay from '@/components/ui/RecordLoadingOverlay';
import { BaseModal } from '@/components/ui/Modal';

const pending = vi.hoisted(() => ({ resolve: (_: unknown) => {}, reject: (_: unknown) => {} }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api/client', () => ({
  api: { get: () => new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; }) },
}));

function Editor() {
  const stored = useStoredRecord<{ id: string }>('products');
  const [open, setOpen] = useState(false);
  const openStored = async () => {
    try { if (await stored.load('p1')) setOpen(true); } catch { /* the page shows a toast */ }
  };
  return createElement('div', null,
    createElement('button', { type: 'button', onClick: () => void openStored() }, 'Edit'),
    createElement(BaseModal, { isOpen: open, onClose: () => setOpen(false), initialFocusSelector: 'input', returnFocusTo: stored.opener },
      createElement('input', { 'aria-label': 'Name' })),
    stored.loadingId && createElement(RecordLoadingOverlay, { onCancel: stored.cancel }),
  );
}

async function clickEdit() {
  const edit = screen.getByRole('button', { name: 'Edit' });
  edit.focus();
  fireEvent.click(edit);
  await act(async () => {});
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cancel' }));
  return edit;
}

afterEach(cleanup);

it('returns focus to the opener when the editor that loaded its record closes', async () => {
  render(createElement(Editor));
  const edit = await clickEdit();
  await act(async () => { pending.resolve({ id: 'p1' }); });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(edit);
});

it('returns focus to the opener when the load is cancelled', async () => {
  render(createElement(Editor));
  const edit = await clickEdit();
  fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
  await act(async () => { pending.resolve({ id: 'p1' }); });
  expect(screen.queryByRole('button', { name: 'cancel' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(edit);
});

it('returns focus to the opener when the stored record cannot be read', async () => {
  render(createElement(Editor));
  const edit = await clickEdit();
  await act(async () => { pending.reject(new Error('read failed')); });
  expect(screen.queryByRole('button', { name: 'cancel' })).toBeNull();
  expect(document.activeElement).toBe(edit);
});

it('keeps loading when the second click of a double click lands on the loading layer', async () => {
  render(createElement(Editor));
  await clickEdit();
  const layer = screen.getByRole('status').closest('.fixed');
  fireEvent.click(layer!);
  await act(async () => { pending.resolve({ id: 'p1' }); });
  expect(screen.getByRole('dialog')).toBeTruthy();
});
