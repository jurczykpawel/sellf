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
  const { t, formatTime, attempt, rollback, currentVersion, fallback } = options;
  if (!failure || !(LOCALIZED_FAILURE_CODES as readonly string[]).includes(failure.code)) {
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
