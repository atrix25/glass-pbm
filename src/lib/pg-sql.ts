/**
 * Quote Prisma/Postgres identifiers in raw SQL that was written for SQLite.
 *
 * Prisma creates PascalCase tables and camelCase columns with quotes.
 * Unquoted names fold to lowercase on Postgres and miss the relation.
 *
 * This is intentionally conservative: it does not parse SQL fully. Prefer
 * writing new queries with explicit "Table" / "column" quoting.
 */

const KEYWORDS = new Set(
  `
  SELECT FROM WHERE AND OR NOT IN IS AS ON JOIN LEFT RIGHT INNER OUTER FULL CROSS
  GROUP BY ORDER LIMIT OFFSET HAVING UNION ALL DISTINCT INSERT INTO VALUES UPDATE
  SET DELETE CREATE TABLE DROP ALTER INDEX VIEW WITH RECURSIVE RETURNING
  CASE WHEN THEN ELSE END TRUE FALSE NULL ASC DESC LIKE ILIKE BETWEEN EXISTS
  CAST COUNT SUM AVG MIN MAX COALESCE NULLIF GREATEST LEAST
  INTEGER INT BIGINT SMALLINT REAL FLOAT DOUBLE PRECISION NUMERIC DECIMAL
  TEXT VARCHAR CHAR BOOLEAN TIMESTAMP DATE TIME INTERVAL JSON JSONB
  EXTRACT EPOCH YEAR MONTH DAY HOUR FOR UPDATE SKIP LOCKED
  PARTITION OVER ROW ROWS RANGE UNBOUNDED PRECEDING FOLLOWING CURRENT
  FILTER WITHIN GROUP STRING_AGG ARRAY_AGG BOOL_AND BOOL_OR
  PRIMARY KEY REFERENCES CONSTRAINT UNIQUE DEFAULT
  TEMP TEMPORARY IF EXISTS REPLACE INTO
  ASCENDING DESCENDING WINDOW
  `.trim().split(/\s+/),
);

export function quotePgSql(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];

    // Single-quoted string
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // Already-quoted identifier
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '"') j += 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // Line comment
    if (ch === "-" && sql[i + 1] === "-") {
      let j = i + 2;
      while (j < sql.length && sql[j] !== "\n") j += 1;
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();
      if (
        KEYWORDS.has(upper) ||
        word.startsWith("$") ||
        // ALL_CAPS tokens are SQL keywords/functions (LOWER, ROW_NUMBER, …)
        /^[A-Z][A-Z0-9_]*$/.test(word)
      ) {
        out += word;
      } else if (/^[A-Z]/.test(word) || /[A-Z]/.test(word.slice(1))) {
        // PascalCase table or camelCase column
        out += `"${word}"`;
      } else {
        out += word;
      }
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

/** Convert SQLite-style `?` placeholders to Postgres `$1..$n`. */
export function qmarkToDollar(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** SQLite function/date idioms → Postgres. */
export function adaptSqliteDialect(sql: string): string {
  let s = sql;
  s = s.replace(/json_extract\(([^,]+),\s*'\$\[0\]'\)/gi, "($1::json->>0)");
  s = s.replace(
    /STRFTIME\('%m',\s*([^,/]+)\s*\/\s*1000,\s*'unixepoch'\)/gi,
    "EXTRACT(MONTH FROM $1)",
  );
  s = s.replace(
    /STRFTIME\('%Y',\s*([^,/]+)\s*\/\s*1000,\s*'unixepoch'\)/gi,
    "EXTRACT(YEAR FROM $1)",
  );
  s = s.replace(
    /CAST\(STRFTIME\('%m',\s*([^,/]+)\s*\/\s*1000,\s*'unixepoch'\)\s+AS\s+INTEGER\)/gi,
    "EXTRACT(MONTH FROM $1)::int",
  );
  s = s.replace(/instr\(([^,]+),\s*([^)]+)\)/gi, "position($2 in $1)");
  s = s.replace(/GROUP_CONCAT\(([^)]+)\)/gi, "string_agg(($1)::text, ',')");
  s = s.replace(
    /\((\w+\.)?(decidedAt)\s*-\s*(\w+\.)?(receivedAt)\)/gi,
    (_, a: string | undefined, b: string, c: string | undefined, d: string) =>
      `(EXTRACT(EPOCH FROM (${a ?? ""}${b} - ${c ?? ""}${d})) * 1000)`,
  );
  s = s.replace(
    /\((\w+\.)?(decidedAt)\s*-\s*(\w+\.)?(submittedAt)\)/gi,
    (_, a: string | undefined, b: string, c: string | undefined, d: string) =>
      `(EXTRACT(EPOCH FROM (${a ?? ""}${b} - ${c ?? ""}${d})) * 1000)`,
  );
  s = s.replace(
    /CAST\(\((\w+\.)?(adjudicatedAt)\s*-\s*(\w+\.)?(dateOfService)\)\s*\/\s*86400000\s+AS\s+INTEGER\)/gi,
    (_, a: string | undefined, b: string, c: string | undefined, d: string) =>
      `CAST(EXTRACT(EPOCH FROM (${a ?? ""}${b} - ${c ?? ""}${d})) / 86400 AS INTEGER)`,
  );
  s = s.replace(
    /\((\w+\.)?(adjudicatedAt)\s*-\s*(\w+\.)?(dateOfService)\)\s*\/\s*86400000/gi,
    (_, a: string | undefined, b: string, c: string | undefined, d: string) =>
      `(EXTRACT(EPOCH FROM (${a ?? ""}${b} - ${c ?? ""}${d})) / 86400)`,
  );
  s = s.replace(
    /\b(isTransdermal|convertible|is340B|isDesignatedSpecialty|awpIsSimulated|isSpecialtyClaim|rebateEligible|excludedFromDiscountGuarantee|fired|active|demoFeatures)\s*=\s*1\b/g,
    "$1 IS TRUE",
  );
  s = s.replace(
    /\b(isTransdermal|convertible|is340B|isDesignatedSpecialty|awpIsSimulated|isSpecialtyClaim|rebateEligible|excludedFromDiscountGuarantee|fired|active|demoFeatures)\s*=\s*0\b/g,
    "$1 IS FALSE",
  );
  // SQLite stored dates as ms integers; CAST(date AS REAL) meant "ms since epoch".
  s = s.replace(
    /CAST\(\s*(MIN|MAX)\s*\(\s*([^)]+?(?:dateOfService|decidedAt|receivedAt|submittedAt|publishedAt|effectiveDate|retroReportedAt|reportedTerminationDate)[^)]*)\s*\)\s*AS\s+REAL\s*\)/gi,
    "((EXTRACT(EPOCH FROM $1($2)) * 1000))",
  );
  // dateOfService + daysSupply * 86400000 (SQLite ms arithmetic)
  s = s.replace(
    /(\w+\.)?(dateOfService)\s*\+\s*(\w+\.)?(daysSupply)\s*\*\s*\d+/gi,
    "($1$2 + (($3$4) * INTERVAL '1 day'))",
  );
  return s;
}

export function sqlitePlaceholdersToPg(sql: string): string {
  return qmarkToDollar(quotePgSql(adaptSqliteDialect(sql)));
}

