// @vitest-environment happy-dom

import { createElement } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';
import SystemUpdateSettings from '@/components/settings/SystemUpdateSettings';
import UpdateNotificationModal from '@/components/UpdateNotificationModal';
import type { UpdateInfo } from '@/hooks/useUpdateCheck';

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});

const fetchMock = vi.fn();
const fresh: UpdateInfo = {
  upgrade: { runtime: 'pm2', mode: 'in-place' },
  current_version: '2026.10.0', latest_version: '2026.10.0', update_available: false,
  release_notes: null, published_at: null, release_url: null, started_at: '2026-10-01T10:00:00.000Z',
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
  vi.restoreAllMocks();
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
    expect(result.current.updateInfo).toBeNull();
  });

  it('refreshes deployment capability even when a matching cache exists', async () => {
    cache(fresh);
    const { result } = await mount();
    expect(result.current.updateInfo).toEqual(fresh);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refreshes the deployment when a six-hour-old cache exists', async () => {
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
  async function start(step: string, versionCheckOk = true, reportedVersion = '2026.11.0', startedAt = '2026-10-01T11:00:00.000Z', target = '2026.11.0') {
    cache({ ...fresh, latest_version: target });
    let baselineRead = false;
    let healthRead = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/system/update-check') return reply({ ...fresh, latest_version: target });
      if (url === '/api/v1/system/update-check?force=true' && !baselineRead) {
        baselineRead = true;
        return reply(fresh);
      }
      if (url === '/api/v1/system/upgrade') return reply({ token: 'token' });
      if (url.startsWith('/api/v1/system/upgrade-status')) return reply({ step: healthRead ? 'done' : step, progress: 0, message: '' });
      if (url === '/api/health') { healthRead = true; return { ok: true, json: async () => ({ status: 'ok', service: 'sellf-admin' }) }; }
      if (!versionCheckOk) throw new Error('Unavailable');
      return reply({ ...fresh, current_version: reportedVersion, started_at: startedAt });
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

  it('fails when the authenticated version check is unavailable', async () => {
    const { result } = await start('restarting', false);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.upgradeProgress?.step).toBe('failed');
    expect(result.current.upgradeInProgress).toBe(false);
  });

  it.each([
    ['old version', '2026.10.0', '2026-10-01T11:00:00.000Z', '2026.11.0', 'failed'],
    ['same process reinstall', '2026.10.0', fresh.started_at, '2026.10.0', 'failed'],
    ['restarted reinstall', '2026.10.0', '2026-10-01T11:00:00.000Z', '2026.10.0', 'done'],
  ])('%s requires the installed version and restart evidence', async (_, version, startedAt, target, expected) => {
    const { result } = await start('restarting', true, version, startedAt, target);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.upgradeProgress?.step).toBe(expected);
    if (expected === 'failed') expect(result.current.upgradeProgress?.message).toContain('Check the upgrade log');
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


describe('upgrade result UI', () => {
  it.each(['done', 'failed'])('renders %s in the modal after polling stops', (step) => {
    const onDismiss = vi.fn();
    render(createElement(UpdateNotificationModal, {
      updateInfo: fresh,
      upgradeInProgress: false,
      upgradeProgress: { step, progress: step === 'done' ? 100 : -1, message: 'Terminal result' },
      onUpgrade: vi.fn(),
      onDismiss,
    }));
    expect(screen.getByRole('heading').textContent).toBe(`progress.${step}`);
    expect(screen.getAllByText('Terminal result').length).toBeGreaterThan(0);
    if (step === 'failed') {
      screen.getByRole('button', { name: 'progress.close' }).click();
      expect(onDismiss).toHaveBeenCalledOnce();
    }
  });

  it.each(['done', 'pending'])('keeps settings completion visible until reload for %s status', async (step) => {
    cache(fresh);
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    let baselineRead = false;
    let healthRead = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/system/update-check') return reply(fresh);
      if (url === '/api/v1/system/update-check?force=true' && !baselineRead) {
        baselineRead = true;
        return reply(fresh);
      }
      if (url === '/api/v1/system/upgrade') return reply({ token: 'token' });
      if (url.startsWith('/api/v1/system/upgrade-status')) {
        return reply({ step: healthRead ? 'done' : step, progress: step === 'done' ? 100 : 0, message: 'Upgrade completed!' });
      }
      if (url === '/api/health') { healthRead = true; return { ok: true }; }
      return reply({ ...fresh, started_at: '2026-10-01T11:00:00.000Z' });
    });
    render(createElement(SystemUpdateSettings));
    await act(async () => {});
    await act(async () => screen.getByRole('button', { name: 'settings.reinstall' }).click());
    await act(async () => vi.advanceTimersByTimeAsync(step === 'pending' ? 180000 : 3000));
    expect(screen.getByRole('heading', { name: 'progress.done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'progress.reload' })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(2999));
    expect(screen.getByRole('heading', { name: 'progress.done' })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(reload).toHaveBeenCalledOnce();
    reload.mockRestore();
  });

  it('keeps a failed settings result visible until dismissal and resets it before retry', async () => {
    cache(fresh);
    let baselineRead = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/system/update-check') return reply(fresh);
      if (url === '/api/v1/system/update-check?force=true' && !baselineRead) {
        baselineRead = true;
        return reply(fresh);
      }
      if (url === '/api/v1/system/upgrade') return reply({ token: 'token' });
      if (url.startsWith('/api/v1/system/upgrade-status')) {
        return reply({ step: 'failed', progress: -1, message: 'Upgrade failed', rollback: true });
      }
      return reply(fresh);
    });
    render(createElement(SystemUpdateSettings));
    await act(async () => {});
    await act(async () => screen.getByRole('button', { name: 'settings.reinstall' }).click());
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('heading', { name: 'progress.failed' })).toBeTruthy();
    expect(screen.getByText('Upgrade failed')).toBeTruthy();
    expect(screen.getByText('progress.rolledBack')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(screen.getByText('Upgrade failed')).toBeTruthy();
    await act(async () => screen.getByRole('button', { name: 'progress.close' }).click());
    expect(screen.queryByText('Upgrade failed')).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'settings.reinstall' }).click());
    expect(screen.getByText('Initiating upgrade...')).toBeTruthy();
    expect(screen.queryByText('Upgrade failed')).toBeNull();
  });
});

describe('deployment update controls', () => {
  it.each(['docker', 'compose', 'coolify', 'systemd', 'vercel', 'netlify', 'manual'] as const)('shows %s instructions without an upgrade action', async (runtime) => {
    const data: UpdateInfo = { ...fresh, latest_version: '2026.11.0', update_available: true, upgrade: { runtime, mode: 'manual' } };
    fetchMock.mockResolvedValue(reply(data));
    render(createElement(SystemUpdateSettings));
    await act(async () => {});
    expect(screen.queryByText('settings.upgradeNow')).toBeNull();
    expect(screen.queryByText('modal.upgradeNow')).toBeNull();
    expect(screen.getAllByText(`deployment.${runtime}`).length).toBeGreaterThan(0);
  });
  it('does not offer reinstall without an in-place capability', async () => {
    fetchMock.mockResolvedValue(reply({ ...fresh, upgrade: { runtime: 'docker', mode: 'manual' } }));
    render(createElement(SystemUpdateSettings));
    await act(async () => {});
    expect(screen.queryByText('settings.reinstall')).toBeNull();
  });
});

describe('upgrade migration outcome', () => {
  it('keeps a reported migration failure visible when the new process is healthy', async () => {
    let statusReads = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/system/update-check') return reply({ ...fresh, latest_version: '2026.11.0' });
      if (url === '/api/v1/system/update-check?force=true') return reply({ ...fresh, current_version: statusReads ? '2026.11.0' : fresh.current_version });
      if (url === '/api/v1/system/upgrade') return reply({ token: 'token' });
      if (url.startsWith('/api/v1/system/upgrade-status')) {
        statusReads++;
        return reply(statusReads === 1 ? { step: 'restarting', progress: 90 } : { step: 'failed', progress: -1, message: 'Migrations incomplete' });
      }
      return { ok: true };
    });
    const { result } = await mount();
    await act(async () => result.current.startUpgrade());
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.upgradeProgress?.step).toBe('failed');
    expect(result.current.upgradeProgress?.message).toBe('Migrations incomplete');
  });
});

it('waits for the script outcome after the new version becomes healthy', async () => {
  let baselineRead = false;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/v1/system/update-check') return reply({ ...fresh, latest_version: '2026.11.0' });
    if (url === '/api/v1/system/update-check?force=true' && !baselineRead) { baselineRead = true; return reply(fresh); }
    if (url === '/api/v1/system/upgrade') return reply({ token: 'token' });
    if (url.startsWith('/api/v1/system/upgrade-status')) return reply({ step: 'restarting', progress: 90, message: 'Starting application' });
    if (url === '/api/health') return { ok: true };
    return reply({ ...fresh, current_version: '2026.11.0' });
  });
  const { result } = await mount();
  await act(async () => result.current.startUpgrade());
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(result.current.upgradeInProgress).toBe(true);
  expect(result.current.upgradeProgress?.step).not.toBe('done');
});

describe('upgrade success requires the script outcome', () => {
  async function runWithStatusAfterHealth(statusAfterHealth: () => Promise<unknown>) {
    let baselineRead = false;
    let healthRead = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/system/update-check') return reply({ ...fresh, latest_version: '2026.11.0' });
      if (url === '/api/v1/system/update-check?force=true' && !baselineRead) { baselineRead = true; return reply(fresh); }
      if (url === '/api/v1/system/upgrade') return reply({ token: 'token' });
      if (url.startsWith('/api/v1/system/upgrade-status')) {
        return healthRead ? statusAfterHealth() : reply({ step: 'restarting', progress: 90, message: '' });
      }
      if (url === '/api/health') { healthRead = true; return { ok: true }; }
      return reply({ ...fresh, current_version: '2026.11.0', started_at: '2026-10-01T11:00:00.000Z' });
    });
    const hook = await mount();
    await act(async () => hook.result.current.startUpgrade());
    return hook;
  }

  it.each([
    ['an error response', async () => ({ ok: false, json: async () => ({}) })],
    ['a network error', async () => { throw new Error('offline'); }],
  ])('never reports success for a new version while the status is unavailable (%s)', async (_, status) => {
    const { result } = await runWithStatusAfterHealth(status);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.upgradeProgress?.step).not.toBe('done');
    expect(result.current.upgradeInProgress).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(31 * 3000));
    expect(result.current.upgradeProgress?.step).toBe('failed');
    expect(result.current.upgradeInProgress).toBe(false);
  });

  it('shows the reported failure although the new version is already running', async () => {
    const { result } = await runWithStatusAfterHealth(async () => reply({
      step: 'failed', progress: -1, message: 'Upgrade to v2026.11.0 finished with 6 migration errors. Check upgrade logs.',
    }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.upgradeProgress).toMatchObject({
      step: 'failed', message: 'Upgrade to v2026.11.0 finished with 6 migration errors. Check upgrade logs.',
    });
    expect(result.current.upgradeInProgress).toBe(false);
  });
});

describe('readable update failures', () => {
  it('shows why the check failed instead of "up to date"', async () => {
    fetchMock.mockResolvedValue(reply({ ...fresh, check_error: { code: 'github_http', details: { http_status: 429 } } }));
    render(createElement(SystemUpdateSettings));
    await act(async () => {});
    expect(screen.queryByText('settings.upToDate')).toBeNull();
    expect(screen.getByText('failure.checkFailed')).toBeTruthy();
    expect(screen.getByText('failure.github_http')).toBeTruthy();
    expect(screen.getByText('failure.retrySoon')).toBeTruthy();
  });

  it('keeps the reason when the update cannot start', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/system/upgrade') {
        return { ok: false, json: async () => ({ error: {
          code: 'UPDATER_VERIFICATION_FAILED', message: 'Could not verify',
          failure: { code: 'github_unreachable', details: {} },
        } }) };
      }
      return reply(fresh);
    });
    const { result } = await mount();
    await act(async () => result.current.startUpgrade());
    expect(result.current.upgradeProgress).toMatchObject({ step: 'failed', message: 'Could not verify', code: 'github_unreachable', details: {} });
  });

  it.each([['UPGRADE_STARTING', 'upgrade_starting'], ['UPGRADE_RUNNING', 'upgrade_running']])('maps %s to a localized reason', async (apiCode, code) => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/v1/system/upgrade'
      ? { ok: false, json: async () => ({ error: { code: apiCode, message: 'busy' } }) }
      : reply(fresh));
    const { result } = await mount();
    await act(async () => result.current.startUpgrade());
    expect(result.current.upgradeProgress).toMatchObject({ step: 'failed', code });
  });

  it('shows the localized reason from the script progress file in the modal', () => {
    render(createElement(UpdateNotificationModal, {
      updateInfo: { ...fresh, latest_version: '2026.11.1', update_available: true },
      upgradeInProgress: false,
      upgradeProgress: { step: 'failed', progress: -1, message: 'English text', code: 'release_asset_missing', details: { asset: 'sellf-build.tar.gz', installed_version: '2026.10.0' } },
      onUpgrade: () => {}, onDismiss: () => {},
    }));
    expect(screen.getByText('failure.release_asset_missing')).toBeTruthy();
    expect(screen.getByText('failure.unchanged')).toBeTruthy();
    expect(screen.queryByText('English text')).toBeNull();
  });
});
