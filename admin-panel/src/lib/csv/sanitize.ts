/**
 * Quote and escape a value for a CSV cell.
 *
 * Excel and Google Sheets trim leading whitespace before deciding whether a
 * cell is a formula, so the historical "only prefix when first char looks
 * like a formula" heuristic missed payloads such as `" =cmd(...)"`. Wrapping
 * every cell in double quotes and doubling internal quotes is what the OWASP
 * CSV-injection guide recommends and is what spreadsheet applications expect
 * for round-tripping arbitrary strings.
 */
export function csvField(field: unknown): string {
  const str = String(field ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

/** Join one row into a CSV line. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(',');
}

/** Build a complete CSV document from headers + rows. */
export function buildCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join('\n');
}
