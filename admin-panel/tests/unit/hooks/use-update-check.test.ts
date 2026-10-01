// @vitest-environment happy-dom

import { createElement } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';
import SystemUpdateSettings from '@/components/settings/SystemUpdateSettings';
import type { UpdateInfo } from '@/hooks/useUpdateCheck';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/UpdateNotificationModal', () => ({ default: () => null }));

const fetchMock = vi.fn();
const fresh: UpdateInfo = {
  current_version: '2026.10.0', latest_version: '2026.10.0', update_available: false,
  release_notes: null, published_at: null, release_url: null,
};
const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });

function cache(data: UpdateInfo) {
  localStorage.setItem('sellf_update_check', JSON.stringify({ data, timestamp: Date.now() }));
}

async function mount() {
  const hook = renderHook(() => useUpdateCheck(true));
  await act(async () => {});
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('NEXT_PUBLIC_APP_VERSION', fresh.current_version);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', new Storage());
  fetchMock.mockReset().mockResolvedValue(reply(fresh));
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('update check across builds', () => {
  it('removes an old-build cache and fetches without showing its stale modal', async () => {
    cache({ ...fresh, current_version: '2026.9.2', update_available: true });
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { result } = await mount();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/system/update-check');
    expect(result.current.updateInfo).toBeNull();
    expect(result.current.showModal).toBe(false);
    expect(localStorage.getItem('sellf_update_check')).toBeNull();
  });

  it('serves a matching cache within six hours without fetching', async () => {
    cache(fresh);
    const { result } = await mount();
    expect(result.current.updateInfo).toEqual(fresh);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('expires the matching cache after six hours', async () => {
    cache(fresh);
    vi.setSystemTime(Date.now() + 6 * 60 * 60 * 1000);
    await mount();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not reuse a dismissal from another build for a newer release', async () => {
    localStorage.setItem('sellf_update_dismissed', JSON.stringify({
      version: '2026.11.0', current_version: '2026.9.2', timestamp: Date.now(),
    }));
    fetchMock.mockResolvedValue(reply({ ...fresh, latest_version: '2026.11.0', update_available: true }));
    const { result } = await mount();
    expect(result.current.showModal).toBe(true);
    expect(localStorage.getItem('sellf_update_dismissed')).toBeNull();
  });

  it('keeps a dismissal made on the running build', async () => {
    const newer = { ...fresh, latest_version: '2026.11.0', update_available: true };
    fetchMock.mockResolvedValue(reply(newer));
    const first = await mount();
    act(() => first.result.current.dismissUpdate());
    first.unmount();
    const second = await mount();
    expect(second.result.current.showModal).toBe(false);
  });

  it('shows the running version in settings when storage describes an older build', async () => {
    cache({ ...fresh, current_version: '2026.9.2', update_available: true });
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(createElement(SystemUpdateSettings));
    expect(screen.getByTestId('current-version').textContent).toBe('v2026.10.0');
  });
});

describe('upgrade completion', () => {
  async function start(step: string, versionCheckOk = true) {
    cache(fresh);
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/system/upgrade') return reply({ token: 'token' });
      if (url.startsWith('/api/v1/system/upgrade-status')) return reply({ step, progress: 0, message: '' });
      if (url === '/api/health') return { ok: true, json: async () => ({ status: 'ok', service: 'sellf-admin' }) };
      if (!versionCheckOk) throw new Error('Unavailable');
      return reply({ ...fresh, current_version: '2026.11.0' });
    });
    const hook = await mount();
    await act(async () => hook.result.current.startUpgrade());
    return hook;
  }

  it('uses the authenticated version check after health returns OK', async () => {
    const { result } = await start('restarting');
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.upgradeProgress?.message).not.toContain('undefined');
    expect(result.current.upgradeProgress?.message).toBe('Upgrade to v2026.11.0 completed!');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/system/update-check?force=true', expect.any(Object));
    expect(result.current.upgradeInProgress).toBe(false);
    expect(localStorage.getItem('sellf_update_check')).toBeNull();
  });

  it('completes without a version if the authenticated version check fails', async () => {
    const { result } = await start('restarting', false);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.upgradeProgress?.message).toBe('Upgrade completed!');
    expect(result.current.upgradeInProgress).toBe(false);
  });

  it('switches to health polling after three minutes of pending responses', async () => {
    const { result } = await start('pending');
    await act(async () => vi.advanceTimersByTimeAsync(177000));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/health', expect.any(Object));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.any(Object));
    expect(result.current.upgradeProgress?.step).toBe('done');
  });
});
