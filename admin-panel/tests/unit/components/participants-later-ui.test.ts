// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ParticipantsLaterForm from '@/components/checkout/ParticipantsLaterForm';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/actions/orders-missing-participants', () => ({ getOrdersMissingParticipants: mocks.load }));
import MissingParticipantsPanel from '@/components/admin/MissingParticipantsPanel';

const wrap = (node: React.ReactElement) => render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, node));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('posts the pasted list with the signed token and confirms to the buyer', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  wrap(React.createElement(ParticipantsLaterForm, { orderId: 'o1', token: 'tok', quantity: 2 }));
  fireEvent.change(screen.getByLabelText('Paste a list'), { target: { value: 'Jan, Nowak, jan@example.com\nAnna, Kowalska, anna@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fill from list' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save participants' }));
  await screen.findByText('Thank you, the participants were saved.');
  const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  expect(body).toEqual({ orderId: 'o1', token: 'tok', people: [
    { first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' }, { first_name: 'Anna', last_name: 'Kowalska', email: 'anna@example.com' }] });
});

it('shows the server verdict next to the field and keeps the buyer\'s input', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: false, errors: [{ field: 'participants.1.email', code: 'duplicate_email' }] }), { status: 422 }));
  wrap(React.createElement(ParticipantsLaterForm, { orderId: 'o1', quantity: 2 }));
  fireEvent.change(document.getElementById('participants.1.email')!, { target: { value: 'dup@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save participants' }));
  await screen.findByText('Each participant needs a different email.');
  expect((document.getElementById('participants.1.email') as HTMLInputElement).value).toBe('dup@example.com');
  expect(document.getElementById('participants.1.email')!.getAttribute('aria-invalid')).toBe('true');
});

it('lists orders missing participants for the seller and hides itself when there are none', async () => {
  mocks.load.mockResolvedValueOnce({ success: true, data: [{ id: 'o1', orderNumber: 1001, email: 'buyer@example.com', productName: 'Workshop', quantity: 4, createdAt: '2026-11-01T10:00:00Z', mailSentAt: null }] });
  const { unmount } = wrap(React.createElement(MissingParticipantsPanel));
  expect((await screen.findAllByText('1 order is missing participants')).length).toBeGreaterThan(0);
  expect(screen.getByText('#1001')).toBeTruthy();
  expect(screen.getByText('Not sent yet')).toBeTruthy();
  unmount();
  mocks.load.mockResolvedValueOnce({ success: true, data: [] });
  const empty = wrap(React.createElement(MissingParticipantsPanel));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(empty.container.innerHTML).toBe('');
});
