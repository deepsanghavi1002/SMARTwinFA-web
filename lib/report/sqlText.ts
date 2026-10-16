import { orderByAliases, quotedAliases } from "../small-entry/text";

/** SQL text helpers of the report port that touch no database (tested in tests/report.test.mts). */

/** Lib_GlobalVariables.SmartVfaConstants.PCbook_*. */

/** Report_Combine.SetBooksValueInString: Lib_GlobalVariables.SmartVfaConstants.PCbook_*. */
const BOOKS: Readonly<Record<string, number>> = {
  GENLED: 1, DRSLED: 2, CRSLED: 3, CASH: 4, DIS: 5, BANK: 6, PETTYCASH: 7, SALE: 8, CASHSALE: 9, AGENCY: 10,
  DRNOTE: 11, PURCHRETN: 12, PURCH: 13, CASHPURCH: 14, EXPENSE: 15, CRNOTE: 16, SALERETN: 17, COMBINE: 18, JOURNAL: 19,
};

export function setBooksValueInString(source: string): string {
  return source.replace(/\|PCbook_([A-Z]+)\|/g, (whole, name: string) => (name in BOOKS ? String(BOOKS[name]) : whole));
}

/**
 * A setup SELECT written for SQL Server, as PostgreSQL must read it: single-quoted aliases become
 * names, the last ORDER BY names a quoted alias as it is spelt (ORDER BY VALUE_COL after AS "VALUE_COL"),
 * and SPACE(n) is REPEAT(' ', n).
 */
export function setupSelect(sql: string): string {
  let out = withAliases(quotedAliases(sql)).replace(/\bspace\s*\(/gi, "repeat(' ', ");
  // SQL Server compares char columns without their trailing spaces (STKM_ADDON = 'PF' finds 'PF   '); PostgreSQL does not.
  out = out.replace(/(STKM_ADDON|STKM_SHORT|STKM_ID)[ ]*=[ ]*'([^']*)'/gi, "rtrim($1) = '$2'");
  const at = out.toLowerCase().lastIndexOf("order by");
  if (at >= 0 && !out.slice(at).includes(")")) out = `${out.slice(0, at)}ORDER BY ${orderByAliases(out, out.slice(at + 8).trim())}`;
  return out;
}

/**
 * A WITH query's column names given in quotes (WITH REC_CTE AS (SELECT FIEL_DESC AS "COLUMN_CAPTION" ...))
 * keep their capitals in PostgreSQL, but the select after it names them bare (SELECT COLUMN_CAPTION FROM
 * REC_CTE), which SQL Server reads case-blind and PostgreSQL as column_caption. After the WITH's
 * brackets, outside quotes, those names are put in quotes as the WITH spells them, bare or after the WITH's name (slabs.SLAB_KEY).
 */
function withAliases(sql: string): string {
  const start = /^\s*with\s+(\w+)\s+as\s*\(/i.exec(sql);
  if (!start) return sql;
  let depth = 1;
  let quote = "";
  let at = start[0].length;
  for (; at < sql.length && depth > 0; at += 1) {
    const char = sql[at];
    if (quote !== "") { if (char === quote) quote = ""; } else if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
  }
  const head = sql.slice(0, at);
  const aliases = [...new Set([...head.matchAll(/\bas\s+"([^"]+)"/gi)].map((match) => match[1]).filter((name) => name !== name.toLowerCase() && /^\w+$/.test(name)))];
  if (aliases.length === 0) return sql;
  // Bare (COLUMN_CAPTION) or after the WITH's own name (slabs.SLAB_KEY); another table's column (ac.NAME) is left alone.
  const names = aliases.join("|");
  const pattern = new RegExp(`(?<![\\w.])(?:${names})(?!\\w)|(?<=\\b${start[1]}\\.)(?:${names})(?!\\w)`, "gi");
  const spelt = new Map(aliases.map((name) => [name.toLowerCase(), name]));
  // Only the text outside '...' and "..." is touched.
  const tail = sql.slice(at).split(/('(?:[^']|'')*'|"[^"]*")/).map((part, index) => (index % 2 === 1 ? part : part.replace(pattern, (name: string) => `"${spelt.get(name.toLowerCase())}"`))).join("");
  return head + tail;
}

/**
 * A |sys.x| token as a quoted literal: the procedures put it in bare (SQL Server converts), and some
 * setup queries already wrap it in quotes ('|sys.tarikh1|'); either way it reads as one literal.
 */
export function literal(sql: string, token: string, value: string): string {
  const quoted = `'${value.replace(/'/g, "''")}'`;
  return sql.split(`'${token}'`).join(quoted).split(token).join(quoted);
}

/**
 * A setup SQL fragment as PostgreSQL must read it: |sys.db| is the company schema, and a money
 * column (alias.column) is read as numeric, as SQL Server lets money and numeric mix.
 */
export function pgFragment(sql: string, plan: Readonly<{ moneyColumns: readonly string[] }>, schema: string): string {
  let out = sql.split("|sys.db|").join(`${schema}.`);
  // The few columns PostgreSQL keeps in capitals: ledger."TYPE", prod_ledger."TYPE", account."LIMIT".
  out = out.replace(/\b(led|ledger|prodled|pled|prod_ledger)\.type\b(?!")/gi, '$1."TYPE"').replace(/\b(ac|account)\.limit\b(?!")/gi, '$1."LIMIT"');
  if (plan.moneyColumns.length > 0) {
    const pattern = new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\.(${plan.moneyColumns.join("|")})\\b(?!\\s*::)`, "gi");
    out = out.replace(pattern, "$1.$2::numeric");
    // A bare money column as a CASE result (case when bk_dbcode=1 then amount else 0.00 end).
    const bare = new RegExp(`\\b(then|else)\\s+(${plan.moneyColumns.join("|")})\\b(?!\\s*::|\\s*\\.|\\s*\\()`, "gi");
    out = out.replace(bare, "$1 $2::numeric");
  }
  // The document number is text here: a number compared with it (the Numbers sort's Between boxes: led.doc_no >= 1 and led.doc_no <= 4) is read as a number, as SQL Server does.
  out = out.replace(/\b((?:led|ledger|proce|process|prodled|pled)\.)?doc_no\s*(>=|<=|>|<|=)\s*(\d+)(?![\w.'"])/gi, (_match, owner: string | undefined, operator: string, value: string) => `(CASE WHEN btrim(${owner ?? ""}doc_no) ~ '^[0-9]+$' THEN btrim(${owner ?? ""}doc_no)::numeric END) ${operator} ${value}`);
  // SQL Server reads '' as 0 in a numeric CASE (case when ... then amount else '' end).
  out = out.replace(/(::numeric\s+else\s+)''/gi, (_match, head: string) => `${head}0`);
  return out;
}
