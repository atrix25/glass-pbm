/**
 * Postgres SQL fragments shared by raw queries.
 *
 * Glass used to store DateTime as epoch-ms integers (SQLite) and JSON as
 * opaque strings queried with json_extract. On Postgres, DateTime is a real
 * timestamp and JSON strings are cast to json/jsonb at query time.
 */

/** Milliseconds since epoch for a timestamp column (parity with SQLite ms ints). */
export function epochMs(column: string): string {
  return `(EXTRACT(EPOCH FROM ${column}) * 1000)`;
}

/** Calendar month 1–12 from a timestamp column. */
export function monthOf(column: string): string {
  return `EXTRACT(MONTH FROM ${column})::int`;
}

/** Calendar year from a timestamp column. */
export function yearOf(column: string): string {
  return `EXTRACT(YEAR FROM ${column})::int`;
}

/** First element of a JSON array stored as text (e.g. rejectCodes). */
export function jsonArrayFirst(column: string): string {
  return `(${column}::json->>0)`;
}

/** Case-insensitive substring search over a text/json column. */
export function containsText(column: string, param: string): string {
  return `position(${param} in ${column}) > 0`;
}

/** Day difference between two timestamp columns. */
export function daysBetween(later: string, earlier: string): string {
  return `EXTRACT(EPOCH FROM (${later} - ${earlier})) / 86400`;
}

/** Boolean true literal for raw SQL. */
export const SQL_TRUE = "TRUE";
export const SQL_FALSE = "FALSE";
