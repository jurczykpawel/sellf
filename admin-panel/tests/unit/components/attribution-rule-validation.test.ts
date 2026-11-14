// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import AttributionSettings from '@/components/settings/AttributionSettings';
import pl from '@/messages/pl.json';

const actions = vi.hoisted(() => ({ getAttributionConfig: vi.fn(), saveAttributionConfig: vi.fn() }));
vi.mock('@/lib/actions/attribution', () => actions);
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const view = () => createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, createElement(AttributionSettings));

it('explains an empty or malformed channel next to the field in Polish and does not call the server (W224-B16)', async () => {
  actions.getAttributionConfig.mockResolvedValue({ success: true, data: { click_id_retention_days: 30, rules: [] } });
  render(view());
  fireEvent.click(await screen.findByRole('button', { name: pl.settings.attribution.addRule }));
  fireEvent.click(screen.getByRole('button', { name: pl.settings.attribution.save }));
  const channel = screen.getAllByRole('textbox')[0];
  await waitFor(() => expect(channel.getAttribute('aria-invalid')).toBe('true'));
  const message = document.getElementById(channel.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
  expect(message).toBe(pl.settings.attribution.channelInvalid);
  expect(message).not.toMatch(/Invalid|pattern/);
  expect(actions.saveAttributionConfig).not.toHaveBeenCalled();
  fireEvent.change(channel, { target: { value: 'Moj Kanal!' } });
  fireEvent.click(screen.getByRole('button', { name: pl.settings.attribution.save }));
  expect(channel.getAttribute('aria-invalid')).toBe('true');
  expect(actions.saveAttributionConfig).not.toHaveBeenCalled();
});

it('saves a valid rule', async () => {
  actions.getAttributionConfig.mockResolvedValue({ success: true, data: { click_id_retention_days: 30, rules: [] } });
  actions.saveAttributionConfig.mockResolvedValue({ success: true });
  render(view());
  fireEvent.click(await screen.findByRole('button', { name: pl.settings.attribution.addRule }));
  const [channel, value] = screen.getAllByRole('textbox');
  fireEvent.change(channel, { target: { value: 'blog' } });
  fireEvent.change(value, { target: { value: 'example.com' } });
  fireEvent.click(screen.getByRole('button', { name: pl.settings.attribution.save }));
  await waitFor(() => expect(actions.saveAttributionConfig).toHaveBeenCalled());
});
