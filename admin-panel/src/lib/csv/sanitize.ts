/** Quote, escape, and prefix-guard a CSV cell — Excel/Sheets evaluate `"=cmd()"` from CSV so quoting alone is not enough. */
export function csvField(field: unknown): string {
  const str = String(field ?? '');
  const prefixed = /^\s*[=+\-@]/.test(str) ? `'${str}` : str;
  return `"${prefixed.replace(/"/g, '""')}"`;
}

/** Join one row into a CSV line. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(',');
}

/** Build a complete CSV document from headers + rows. */
export function buildCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join('\n');
}
