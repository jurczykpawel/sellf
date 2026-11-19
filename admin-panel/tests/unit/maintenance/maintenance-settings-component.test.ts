// @vitest-environment happy-dom
/**
 * Settings → System → Maintenance mode: the admin switches it with a note and an expected end, and
 * sees which source is in effect and how to end a server-side one. @see src/components/settings/MaintenanceSettings.tsx
 */
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MaintenanceStatus } from '@/lib/maintenance/setting';

const h = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), t: (key: string) => key }));
// next-intl returns a stable translator; a new function per render would refetch the status.
vi.mock('next-intl', () => ({ useTranslations: () => h.t }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/actions/maintenance', () => ({ getMaintenanceStatus: h.get, setMaintenanceMode: h.set }));
import MaintenanceSettings from '@/components/settings/MaintenanceSettings';

const off: MaintenanceStatus = {
  active: false, source: null, message: null, expected_end_at: null,
  database: { enabled: false, message: null, expected_end_at: null, changed_at: null },
  server: { file_path: '/opt/stacks/sellf-tsa/admin-panel/MAINTENANCE', file_present: false, file_reason: null, env: false },
};
const on: MaintenanceStatus = { ...off, active: true, source: 'database', message: 'Inventory', database: { ...off.database, enabled: true, message: 'Inventory' } };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

it('switches maintenance on with the note and the expected end, then off again @J650', async () => {
  h.get.mockResolvedValue({ success: true, data: off });
  h.set.mockResolvedValueOnce({ success: true, data: on }).mockResolvedValueOnce({ success: true, data: off });
  render(createElement(MaintenanceSettings));
  await act(async () => {});
  expect(screen.getByTestId('maintenance-status').textContent).toBe('statusOff');

  fireEvent.change(screen.getByLabelText(/^message/), { target: { value: 'Inventory' } });
  fireEvent.change(screen.getByLabelText(/^expectedEnd/), { target: { value: '2030-01-01T10:00' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'turnOn' })); });
  expect(h.set).toHaveBeenCalledWith({ enabled: true, message: 'Inventory', expected_end_at: new Date('2030-01-01T10:00').toISOString() });
  expect(screen.getByTestId('maintenance-status').textContent).toBe('statusOn.database');

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'turnOff' })); });
  expect(h.set).toHaveBeenLastCalledWith({ enabled: false, message: null, expected_end_at: null });
  expect(screen.getByTestId('maintenance-status').textContent).toBe('statusOff');
});

it('names the server file left by a failed update and the command that ends it', async () => {
  h.get.mockResolvedValue({ success: true, data: { ...off, active: true, source: 'file', server: { ...off.server, file_present: true, file_reason: 'migration_state_unknown' } } });
  render(createElement(MaintenanceSettings));
  await act(async () => {});
  expect(screen.getByTestId('maintenance-status').textContent).toBe('statusOn.file');
  expect(screen.getByTestId('maintenance-file').textContent).toContain('file.afterFailedUpdate');
  expect(screen.getByTestId('maintenance-file').textContent).toContain('rm /opt/stacks/sellf-tsa/admin-panel/MAINTENANCE');
});

it('explains the environment switch', async () => {
  h.get.mockResolvedValue({ success: true, data: { ...off, active: true, source: 'env', server: { ...off.server, env: true } } });
  render(createElement(MaintenanceSettings));
  await act(async () => {});
  expect(screen.getByTestId('maintenance-status').textContent).toBe('statusOn.env');
  expect(screen.getByTestId('maintenance-env').textContent).toBe('env');
});

it('points to a past end time without changing maintenance mode', async () => {
  h.get.mockResolvedValue({ success: true, data: off });
  render(createElement(MaintenanceSettings));
  await act(async () => {});
  const field = screen.getByLabelText(/^expectedEnd/);
  fireEvent.change(field, { target: { value: '2020-01-01T10:00' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'turnOn' })); });
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBe('expectedEndInvalid');
  expect(document.activeElement).toBe(field);
  expect(h.set).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '2030-01-01T10:00' } });
  expect(field.getAttribute('aria-invalid')).toBeNull();
});
