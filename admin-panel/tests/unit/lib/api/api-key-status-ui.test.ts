// @vitest-environment happy-dom
/** API key status updates when an open panel reaches the rotation deadline. */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ApiKeysPageContent from '@/components/ApiKeysPageContent';

const { translate } = vi.hoisted(() => ({ translate: (key: string) => key }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => translate }));
vi.mock('@/components/ApiKeyFormModal', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows grace, then expiry without reloading, and keeps revocation available', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{
    id: 'key', name: 'Retired key', key_prefix: 'sf_test_example', scopes: [],
    is_active: false, revoked_at: null, expires_at: null,
    rotation_grace_until: '2026-01-01T12:01:00Z',
    created_at: '2026-01-01T00:00:00Z', last_used_at: null, usage_count: 0,
  }] }) }));
  await act(async () => { render(React.createElement(ApiKeysPageContent)); });
  expect(screen.getByText('statusGrace')).toBeDefined();
  expect(screen.getByTitle('revokeNow')).toBeDefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
  expect(screen.getByText('statusExpired')).toBeDefined();
  expect(screen.queryByText('statusGrace')).toBeNull();
  expect(screen.getByTitle('revokeNow')).toBeDefined();
});
