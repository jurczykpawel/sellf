/** Relative ages in the current UI language. @see components/StatsOverview.tsx */
export function formatRelativeTime(value: string, locale: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return format.format(0, 'second');
  if (seconds < 3600) return format.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return format.format(-Math.floor(seconds / 3600), 'hour');
  return format.format(-Math.floor(seconds / 86400), 'day');
}
