/** Readable, localized reasons for a failed update check or update attempt. @see src/lib/system/update-failure.ts */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { describeUpdateFailure, LOCALIZED_FAILURE_CODES } from '@/lib/system/update-failure';

const t = (key: string, values?: Record<string, string | number>) => `${key}${values ? ' ' + JSON.stringify(values) : ''}`;
const time = (iso: string) => `at:${iso}`;

describe('describeUpdateFailure', () => {
  it('explains a GitHub refusal with status, GitHub message, unchanged version and retry time', () => {
    expect(describeUpdateFailure({
      code: 'github_http',
      details: { http_status: 429, github_message: 'API rate limit exceeded', retry_at: '2026-11-12T14:27:00Z', installed_version: '2026.11.0' },
    }, { t, formatTime: time, attempt: true, fallback: 'English text' })).toEqual([
      'failure.github_http {"status":429}',
      'failure.githubSays {"message":"API rate limit exceeded"}',
      'failure.unchanged {"version":"2026.11.0"}',
      'failure.retryAt {"time":"at:2026-11-12T14:27:00Z"}',
    ]);
  });

  it('uses the running version and a generic retry hint when GitHub gives none', () => {
    expect(describeUpdateFailure({ code: 'github_unreachable', details: {} }, { t, formatTime: time, attempt: true, currentVersion: '2026.11.0' })).toEqual([
      'failure.github_unreachable', 'failure.unchanged {"version":"2026.11.0"}', 'failure.retrySoon',
    ]);
  });

  it('names a missing release file and a bad signature separately', () => {
    expect(describeUpdateFailure({ code: 'release_asset_missing', details: { asset: 'sellf-build.tar.gz', installed_version: '2026.11.0' } }, { t, formatTime: time, attempt: true }))
      .toEqual(['failure.release_asset_missing {"asset":"sellf-build.tar.gz"}', 'failure.unchanged {"version":"2026.11.0"}']);
    expect(describeUpdateFailure({ code: 'signature_invalid', details: { installed_version: '2026.11.0' } }, { t, formatTime: time, attempt: true }))
      .toEqual(['failure.signature_invalid', 'failure.unchanged {"version":"2026.11.0"}']);
  });

  it('describes a check failure without claiming an attempt', () => {
    expect(describeUpdateFailure({ code: 'github_http', details: { http_status: 503 } }, { t, formatTime: time, attempt: false }))
      .toEqual(['failure.github_http {"status":503}', 'failure.retrySoon']);
  });

  it('explains a rolled-back migration batch with its cause', () => {
    expect(describeUpdateFailure({ code: 'migration_failed', details: { cause: 'Migration 2099_x failed: boom', installed_version: '2026.11.1' } }, { t, formatTime: time, attempt: true, rollback: true }))
      .toEqual(['failure.migration_failed {"cause":"Migration 2099_x failed: boom"}', 'failure.migrationRolledBack {"version":"2026.11.1"}']);
  });

  it('falls back to the script message for codes the panel does not localize', () => {
    expect(describeUpdateFailure({ code: 'migration_preflight', details: {} }, { t, formatTime: time, attempt: true, fallback: 'Migration 1 is recorded as x. Nothing was changed.' }))
      .toEqual(['Migration 1 is recorded as x. Nothing was changed.']);
    expect(describeUpdateFailure(undefined, { t, formatTime: time, attempt: true, fallback: 'Old panel message' })).toEqual(['Old panel message']);
  });

  it.each(['en', 'pl'])('has %s texts for every localized code and helper line', locale => {
    const messages = JSON.parse(readFileSync(path.resolve(__dirname, `../../../../src/messages/${locale}.json`), 'utf8')).systemUpdate.failure;
    for (const key of [...LOCALIZED_FAILURE_CODES, 'githubSays', 'unchanged', 'unchangedUnknown', 'migrationRolledBack', 'retryAt', 'retrySoon', 'checkFailed']) {
      expect(typeof messages[key], `${locale}: failure.${key}`).toBe('string');
    }
  });
});
