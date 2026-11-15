/** Readable, localized reasons for a failed update check or update attempt. @see src/lib/system/update-failure.ts */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { describeUpdateFailure, LOCALIZED_FAILURE_CODES, sanitizeUpdateFailure, sanitizeUpdateText } from '@/lib/system/update-failure';

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

  it('explains a failed PM2 stop: nothing changed and the old version still runs', () => {
    expect(describeUpdateFailure({ code: 'pm2_stop_failed', details: { installed_version: '2026.11.0' } }, { t, formatTime: time, attempt: true, fallback: 'English text' }))
      .toEqual(['failure.pm2_stop_failed', 'failure.unchanged {"version":"2026.11.0"}']);
  });

  it('does not promise a running shop when PM2 did not bring the old process back', () => {
    expect(describeUpdateFailure({ code: 'pm2_stop_failed_offline', details: { installed_version: '2026.11.0' } }, { t, formatTime: time, attempt: true, fallback: 'English text' }))
      .toEqual(['failure.pm2_stop_failed_offline', 'failure.unchangedAppStopped {"version":"2026.11.0"}']);
    expect(describeUpdateFailure({ code: 'pm2_stop_failed_offline', details: {} }, { t, formatTime: time, attempt: true }))
      .toEqual(['failure.pm2_stop_failed_offline', 'failure.unchangedAppStoppedUnknown']);
  });

  it('explains an unknown migration outcome: app stopped, check the registry, never "nothing changed"', () => {
    expect(describeUpdateFailure({ code: 'migration_state_unknown', details: { cause: 'connection reset', installed_version: '2026.11.0' } }, { t, formatTime: time, attempt: true, fallback: 'English text' }))
      .toEqual(['failure.migration_state_unknown', 'failure.migrationStateCause {"cause":"connection reset"}', 'failure.migrationStateNext']);
    expect(describeUpdateFailure({ code: 'migration_state_unknown', details: {} }, { t, formatTime: time, attempt: true }))
      .toEqual(['failure.migration_state_unknown', 'failure.migrationStateNext']);
  });

  it.each([
    ['pl', ['nie wiadomo', 'zatrzymana', 'supabase_migrations.schema_migrations', 'kopii zapasowej', 'log aktualizacji']],
    ['en', ['not known', 'stopped', 'supabase_migrations.schema_migrations', 'backup', 'update log']],
  ] as const)('says in %s that the outcome is unknown, the shop is stopped and what to check', async (locale, phrases) => {
    const { createTranslator } = await import('next-intl');
    const messages = JSON.parse(readFileSync(path.resolve(__dirname, `../../../../src/messages/${locale}.json`), 'utf8'));
    const translate = createTranslator({ locale, messages, namespace: 'systemUpdate' });
    const text = describeUpdateFailure({ code: 'migration_state_unknown', details: { cause: 'timeout' } }, { t: (key, values) => translate(key as never, values as never), formatTime: time, attempt: true }).join(' ').toLowerCase();
    for (const phrase of phrases) expect(text).toContain(phrase.toLowerCase());
    expect(text).toContain('timeout');
  });

  it('falls back to the script message for codes the panel does not localize', () => {
    expect(describeUpdateFailure({ code: 'migration_preflight', details: {} }, { t, formatTime: time, attempt: true, fallback: 'Migration 1 is recorded as x. Nothing was changed.' }))
      .toEqual(['Migration 1 is recorded as x. Nothing was changed.']);
    expect(describeUpdateFailure(undefined, { t, formatTime: time, attempt: true, fallback: 'Old panel message' })).toEqual(['Old panel message']);
  });

  it.each(['en', 'pl'])('has %s texts for every localized code and helper line', locale => {
    const messages = JSON.parse(readFileSync(path.resolve(__dirname, `../../../../src/messages/${locale}.json`), 'utf8')).systemUpdate.failure;
    for (const key of [...LOCALIZED_FAILURE_CODES, 'githubSays', 'unchanged', 'unchangedUnknown', 'unchangedAppStopped', 'unchangedAppStoppedUnknown', 'migrationRolledBack', 'migrationStateCause', 'migrationStateNext', 'retryAt', 'retrySoon', 'checkFailed']) {
      expect(typeof messages[key], `${locale}: failure.${key}`).toBe('string');
    }
  });
});

// Credential-shaped test values, assembled from parts; none is a real key.
const fake = (...parts: string[]) => parts.join('');
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlX3NpZ25hdHVyZQ';
const samples = {
  jwt,
  stripeLive: fake('sk_', 'live_', '51FakeFakeFakeFakeFakeFake'),
  stripeTest: fake('sk_', 'test_', '51FakeFakeFakeFakeFakeFake'),
  restricted: fake('rk_', 'live_', '51FakeFakeFakeFake'),
  webhook: fake('wh', 'sec_', 'FakeFakeFakeFakeFakeFake'),
  supabaseAccess: fake('sb', 'p_', '0123456789abcdef0123456789abcdef01234567'),
  supabaseSecret: fake('sb_', 'secret_', 'FakeFakeFakeFakeFake'),
  hex: '0123456789abcdef0123456789abcdef',
  base64: 'QmFzZTY0RmFrZVNlY3JldFZhbHVlRm9yVGVzdHM9PQ==',
};

describe('sanitizeUpdateText', () => {
  it.each(Object.entries(samples))('redacts a %s value', (_, secret) => {
    const cleaned = sanitizeUpdateText(`before ${secret} after`, 500);
    expect(cleaned).toBe('before [redacted] after');
  });

  it('redacts configured secret values wherever they appear', () => {
    expect(sanitizeUpdateText('key=FAKE_SERVICE_KEY_w251rb_only;', 500, ['FAKE_SERVICE_KEY_w251rb_only'])).toBe('key=[redacted];');
  });

  it('removes markup, C0, DEL, C1 and direction controls', () => {
    const cleaned = sanitizeUpdateText('a\u0000b\u0007c\u001bd\u007fe\u0085f\u009fg\u202eh\u202ai\u2066j\u2069k <img src=x onerror=alert(1)> l', 500);
    expect(cleaned).toBe('abcdefghijk  l');
  });

  it('keeps ordinary update text, migration names, versions and URLs', () => {
    const text = 'Migration 20261110235901_release_2026_11_0_storefront_templates failed: relation "x" does not exist. '
      + 'See https://github.com/jurczykpawel/sellf/releases/download/v2026.11.0/sellf-build.tar.gz (HTTP 404), zażółć.';
    expect(sanitizeUpdateText(text, 500)).toBe(text);
  });

  it('keeps a release URL whose path has upper case letters and digits', () => {
    const url = 'https://github.com/jurczykpawel/Sellf/releases/download/v2026.11.1/sellf-build.tar.gz';
    expect(sanitizeUpdateText(url, 2000)).toBe(url);
    expect(sanitizeUpdateText(`Download failed: ${url} (HTTP 404)`, 2000)).toBe(`Download failed: ${url} (HTTP 404)`);
  });

  it('redacts secrets carried in URL parameters and keeps the rest of the URL', () => {
    expect(sanitizeUpdateText(`GET https://x.supabase.co/rest/v1/?apikey=${jwt} failed`, 2000))
      .toBe('GET https://x.supabase.co/rest/v1/?apikey=[redacted] failed');
    expect(sanitizeUpdateText('https://example.com/a?page=2&key=short1&token=abc.def&Access_Token=Zz9&X-Amz-Signature=f00d#top', 2000))
      .toBe('https://example.com/a?page=2&key=[redacted]&token=[redacted]&Access_Token=[redacted]&X-Amz-Signature=[redacted]#top');
    expect(sanitizeUpdateText('curl failed for token=plainvalue, retrying', 2000)).toBe('curl failed for token=[redacted], retrying');
  });

  it('still redacts a standalone base64url value with dashes and underscores', () => {
    expect(sanitizeUpdateText('value Qm-FzZTY0RmFrZVNlY3JldF_ZhbHVlRm9yVGVzdHM9 end', 500)).toBe('value [redacted] end');
  });

  it('limits the length after redaction', () => {
    expect(sanitizeUpdateText(`${'x'.repeat(10)}${samples.stripeLive}`, 14)).toBe('xxxxxxxxxx[red');
    expect(sanitizeUpdateText('x'.repeat(50), 20)).toHaveLength(20);
  });

  it('returns undefined for non-text and for text that is empty after cleaning', () => {
    expect(sanitizeUpdateText(7, 10)).toBeUndefined();
    expect(sanitizeUpdateText('\u0000\u202e', 10)).toBeUndefined();
  });
});

describe('sanitizeUpdateFailure', () => {
  it('cleans cause and GitHub message with the same rules', () => {
    const dirty = `FAKE_SERVICE_KEY_w251rb_only ${samples.webhook} <img src=x onerror=alert(1)>\u007f\u0085\u202e`;
    const failure = sanitizeUpdateFailure({ code: 'migration_failed', details: { cause: dirty, github_message: dirty } }, ['FAKE_SERVICE_KEY_w251rb_only']);
    expect(failure?.details).toEqual({ cause: '[redacted] [redacted]', github_message: '[redacted] [redacted]' });
  });
});

describe('describeUpdateFailure fallback', () => {
  it('cleans the fallback text', () => {
    expect(describeUpdateFailure(undefined, { t, formatTime: time, attempt: true, fallback: `Failed ${samples.stripeLive}\u202e <b>x</b>` }))
      .toEqual(['Failed [redacted] x']);
  });
});
