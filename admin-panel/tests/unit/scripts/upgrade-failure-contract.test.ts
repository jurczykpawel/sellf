// @vitest-environment happy-dom
/**
 * Contract: a failure written by upgrade.sh reaches the panel as a localized reason.
 * script (write_failure) -> GET /api/v1/system/upgrade-status -> useUpdateCheck -> UpdateNotificationModal.
 * @see admin-panel/scripts/upgrade.sh @see src/app/api/v1/system/upgrade-status/route.ts
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ progress: '' }));
vi.mock('fs', async (original) => ({
  ...(await original<typeof import('fs')>()),
  openSync: vi.fn(() => 7), closeSync: vi.fn(),
  fstatSync: vi.fn(() => ({ isFile: () => true, uid: 0 })),
  readFileSync: vi.fn(() => files.progress),
}));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  authenticate: vi.fn().mockResolvedValue({ admin: { userId: 'admin' } }),
}));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/system/upgrade-paths', () => ({ getUpgradeProgressFilePath: (token: string) => `/run/sellf/sellf-upgrade-${token}.json` }));
vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/system/upgrade-status/route';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';
import UpdateNotificationModal from '@/components/UpdateNotificationModal';

const token = '00000000-0000-4000-8000-000000000000';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function scriptFailure(): Promise<string> {
  const { mkdtempSync, readFileSync: readRealFile, rmSync, writeFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs');
  const source = readRealFile(path.resolve(__dirname, '../../../scripts/upgrade.sh'), 'utf8');
  const helpers = source.slice(source.indexOf('# ===== HELPERS ====='), source.indexOf('# Stage 2 is this same script'));
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-contract-'));
  try {
    writeFileSync(path.join(dir, 'version.txt'), '2026.11.0\n');
    execFileSync('bash', ['-c', `set -euo pipefail
PROGRESS_FILE="$1/progress.json"; LOG_FILE="$1/log"; INSTALL_DIR="$1"
${helpers}
( fail_unchanged release_asset_missing "Release v2026.11.1 on GitHub does not contain the release archive sellf-build.tar.gz (HTTP 404)." http_status 404 asset sellf-build.tar.gz ) || true`, 'contract', dir]);
    return readRealFile(path.join(dir, 'progress.json'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('shows the localized reason the script wrote', async () => {
  files.progress = await scriptFailure();
  const status = await (await GET(new NextRequest(`http://localhost/api/v1/system/upgrade-status?token=${token}`))).json();
  expect(status.data).toMatchObject({ step: 'failed', code: 'release_asset_missing', details: { http_status: 404, asset: 'sellf-build.tar.gz', installed_version: '2026.11.0' } });

  const fresh = {
    upgrade: { runtime: 'pm2', mode: 'in-place' }, current_version: '2026.11.0', latest_version: '2026.11.1', update_available: true,
    release_notes: null, published_at: null, release_url: null, started_at: '2026-11-01T10:00:00.000Z',
  };
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/system/upgrade-status')) return { ok: true, json: async () => status };
    if (url === '/api/v1/system/upgrade') return { ok: true, json: async () => ({ data: { token } }) };
    return { ok: true, json: async () => ({ data: fresh }) };
  }));
  const hook = renderHook(() => useUpdateCheck(true));
  await act(async () => {});
  await act(async () => hook.result.current.startUpgrade());
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  const progress = hook.result.current.upgradeProgress;
  expect(progress).toMatchObject({ step: 'failed', code: 'release_asset_missing' });

  render(createElement(UpdateNotificationModal, {
    updateInfo: fresh as never, upgradeInProgress: false, upgradeProgress: progress, onUpgrade: () => {}, onDismiss: () => {},
  }));
  expect(screen.getByText('failure.release_asset_missing')).toBeTruthy();
  expect(screen.getByText('failure.unchanged')).toBeTruthy();
  expect(screen.queryByText(/Nothing was changed/)).toBeNull();
});
