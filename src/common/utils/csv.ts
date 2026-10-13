/**
 * CSV (RFC 4180) helpers shared by every export endpoint.
 *
 * - Cells are escaped per RFC 4180: values containing `,`, `"` or line breaks
 *   are wrapped in quotes, embedded quotes are doubled.
 * - `null`/`undefined` become empty cells; Dates become ISO strings.
 * - Lines are joined with CRLF — what Excel and RFC 4180 expect.
 */

/** Escape a single value as one CSV cell. */
export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Join one row of raw values into a CSV line (no trailing newline). */
export function toCsvRow(values: readonly unknown[]): string {
  return values.map(toCsvCell).join(',');
}

/** Build a complete CSV document: header line + data rows, CRLF separated. */
export function toCsv(headers: readonly string[], rows: readonly unknown[][] = []): string {
  return [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n');
}
