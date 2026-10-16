// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WebhookSecretRotation from '@/components/webhooks/WebhookSecretRotation';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { postCustom: mocks.post } }));
vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('WebhookSecretRotation', () => {
  it('requires confirmation and clears the returned secret on close', async () => {
    mocks.post.mockResolvedValue({ secret: 'whsec_returned_once' });
    const refreshed = vi.fn();
    const { unmount } = render(React.createElement(WebhookSecretRotation, { endpointId: 'endpoint', secret: '', onRotated: refreshed }));
    fireEvent.click(screen.getByText('rotateSecret'));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByText('rotateSecretWarning')).toBeTruthy();
    fireEvent.click(screen.getByText('confirmRotateSecret'));
    await waitFor(() => expect(screen.getByDisplayValue('whsec_returned_once')).toBeTruthy());
    expect(refreshed).toHaveBeenCalledOnce();
    expect(screen.getByText('rotatedSecretOnce')).toBeTruthy();
    unmount();
    render(React.createElement(WebhookSecretRotation, { endpointId: 'endpoint', secret: '', onRotated: refreshed }));
    expect(screen.queryByDisplayValue('whsec_returned_once')).toBeNull();
  });
  it('keeps the current display when rotation fails', async () => {
    mocks.post.mockRejectedValue(new Error('failed'));
    render(React.createElement(WebhookSecretRotation, { endpointId: 'endpoint', secret: 'whsec_current', onRotated: vi.fn() }));
    fireEvent.click(screen.getByText('rotateSecret'));
    fireEvent.click(screen.getByText('confirmRotateSecret'));
    await waitFor(() => expect(screen.getByText('confirmRotateSecret').closest('button')?.disabled).toBe(false));
    expect(screen.getByDisplayValue('whsec_current')).toBeTruthy();
  });
});
