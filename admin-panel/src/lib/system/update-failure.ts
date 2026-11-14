/**
 * Why an update check or update attempt stopped. scripts/upgrade.sh writes the
 * same shape into failed progress files; the panel localizes known codes.
 *
 * @see scripts/upgrade.sh (write_failure)
 * @see src/lib/system/github-release.ts
 */

export interface UpdateFailureDetails {
  http_status?: number;
  github_message?: string;
  retry_at?: string;
  asset?: string;
  installed_version?: string;
  migration?: string;
  cause?: string;
}

export interface UpdateFailure {
  code: string;
  details: UpdateFailureDetails;
}

/** Codes with their own panel text; any other code shows the script's message. */
export const LOCALIZED_FAILURE_CODES = [
  'github_unreachable', 'github_http', 'release_asset_missing', 'release_lookup_invalid', 'signature_invalid',
  'manifest_invalid', 'checksum_mismatch', 'archive_invalid', 'release_older', 'upgrade_running', 'upgrade_starting',
  'migration_failed',
] as const;

const GITHUB_CODES = new Set(['github_unreachable', 'github_http']);

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface DescribeUpdateFailureOptions {
  t: Translate;
  formatTime: (iso: string) => string;
  /** An update attempt (says what still runs); false for a plain update check. */
  attempt: boolean;
  /** The previous code was restored after a failed migration. */
  rollback?: boolean;
  currentVersion?: string;
  /** Text shown when the code has no panel text (e.g. from an older script). */
  fallback?: string;
}

/** Lines explaining a failure: what happened, what still runs, when to retry. */
export function describeUpdateFailure(failure: UpdateFailure | undefined, options: DescribeUpdateFailureOptions): string[] {
  const { t, formatTime, attempt, rollback, currentVersion } = options;
  if (!failure || !(LOCALIZED_FAILURE_CODES as readonly string[]).includes(failure.code)) {
    const fallback = sanitizeUpdateText(options.fallback, MAX_UPDATE_MESSAGE_LENGTH);
    return fallback ? [fallback] : [];
  }
  const { details } = failure;
  const version = details.installed_version ?? currentVersion;
  const values: Record<string, string | number> = {};
  if (details.http_status !== undefined) values.status = details.http_status;
  if (details.asset) values.asset = details.asset;
  if (details.cause) values.cause = details.cause;
  const lines = [t(`failure.${failure.code}`, Object.keys(values).length ? values : undefined)];
  if (details.github_message) lines.push(t('failure.githubSays', { message: details.github_message }));
  if (failure.code === 'migration_failed') {
    if (rollback) lines.push(version ? t('failure.migrationRolledBack', { version }) : t('failure.unchangedUnknown'));
  } else if (attempt) {
    lines.push(version ? t('failure.unchanged', { version }) : t('failure.unchangedUnknown'));
  }
  if (details.retry_at && Number.isFinite(Date.parse(details.retry_at))) {
    lines.push(t('failure.retryAt', { time: formatTime(details.retry_at) }));
  } else if (GITHUB_CODES.has(failure.code)) {
    lines.push(t('failure.retrySoon'));
  }
  return lines;
}

/** The longest message the script writes into a progress file. */
export const MAX_UPDATE_MESSAGE_LENGTH = 2000;
const REDACTED = '[redacted]';
// C0, DEL, C1 and the bidirectional formatting and mark characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const MARKUP = /<\/?[A-Za-z!][^<>]*>|[<>]/g;
const KEY_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}/g,
  /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g,
  /whsec_[A-Za-z0-9+/=_-]+/g,
  /sbp_[A-Za-z0-9]+/g,
  /sb_secret_[A-Za-z0-9_-]+/g,
];
const HEX_RUN = /\b[0-9A-Fa-f]{32,}\b/g;
const BASE64_RUN = /[A-Za-z0-9+/]{32,}={0,2}/g;
// A random base64 value mixes digits, upper and lower case; long paths and words do not.
const looksRandom = (run: string): boolean => /[0-9]/.test(run) && /[A-Z]/.test(run) && /[a-z]/.test(run);

/**
 * Text from an upgrade progress file made safe to show: control and direction
 * characters and markup removed, key-like values and the given secret values
 * replaced, then bounded. Undefined when nothing readable is left.
 */
export function sanitizeUpdateText(value: unknown, limit: number, secretValues: readonly string[] = []): string | undefined {
  if (typeof value !== 'string') return undefined;
  let cleaned = value.replace(CONTROL, '').replace(MARKUP, '');
  for (const secret of secretValues) {
    if (secret) cleaned = cleaned.split(secret).join(REDACTED);
  }
  for (const pattern of KEY_PATTERNS) cleaned = cleaned.replace(pattern, REDACTED);
  cleaned = cleaned.replace(HEX_RUN, run => (/[0-9]/.test(run) ? REDACTED : run));
  cleaned = cleaned.replace(BASE64_RUN, run => (looksRandom(run) ? REDACTED : run));
  cleaned = cleaned.slice(0, limit).trim();
  return cleaned || undefined;
}

const CODE = /^[a-z_]{1,40}$/;
const ASSET = /^[A-Za-z0-9._-]{1,100}$/;
const MIGRATION = /^[0-9]{14}_[a-z0-9_]{1,100}$/;
const VERSION = /^v?[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$/;

/** Only known, bounded failure fields from an upgrade progress file reach the API. */
export function sanitizeUpdateFailure(raw: { code?: unknown; details?: unknown }, secretValues: readonly string[] = []): UpdateFailure | undefined {
  if (typeof raw.code !== 'string' || !CODE.test(raw.code)) return undefined;
  const input = raw.details && typeof raw.details === 'object' ? raw.details as Record<string, unknown> : {};
  const details: UpdateFailureDetails = {};
  if (Number.isInteger(input.http_status) && (input.http_status as number) >= 100 && (input.http_status as number) <= 599) {
    details.http_status = input.http_status as number;
  }
  const githubMessage = sanitizeUpdateText(input.github_message, 200, secretValues);
  if (githubMessage) details.github_message = githubMessage;
  if (typeof input.retry_at === 'string' && input.retry_at.length <= 40 && Number.isFinite(Date.parse(input.retry_at))) details.retry_at = input.retry_at;
  if (typeof input.asset === 'string' && ASSET.test(input.asset) && !input.asset.startsWith('.')) details.asset = input.asset;
  if (typeof input.installed_version === 'string' && VERSION.test(input.installed_version)) details.installed_version = input.installed_version;
  if (typeof input.migration === 'string' && MIGRATION.test(input.migration)) details.migration = input.migration;
  const cause = sanitizeUpdateText(input.cause, 300, secretValues);
  if (cause) details.cause = cause;
  return { code: raw.code, details };
}
