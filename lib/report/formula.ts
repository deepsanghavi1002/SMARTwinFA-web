/**
 * Report_Combine helpers that touch no database, ported one for one so the browser and the
 * server answer as the desktop does. Each names its C# original.
 *
 * Report_Combine has its own FormulaValidation (an IN list is compared item by item, not by
 * substring as Lib_GlobalFunctions' is), so it is not the master's formulaValidation.
 */

import { isNumeric } from "../master-program/legacy";

export { isNumeric };

/** Report_Combine.ConvertForOperation: "!(month)" gives "!" and leaves "month"; no bracket is "=". */
export function convertForOperation(text: string): { op: string; rest: string } {
  if (!text.includes("(")) return { op: "=", rest: text };
  const open = text.indexOf("(");
  let op = text.slice(0, open);
  if (op === "") op = "=";
  if (op.toUpperCase() === "IN" || op.toUpperCase() === "NOT IN") op = op.toUpperCase();
  let rest = text.slice(open + 1);
  const close = rest.indexOf(")");
  if (close >= 0) rest = rest.slice(0, close) + rest.slice(close + 1);
  return { op, rest };
}

/** Report_Combine.FormulaValidation. A number test on text that is not a number is false (the C# would throw). */
export function formulaValidation(condition: string, actual: string, compareWith: string, numeric: boolean): boolean {
  const n = (text: string) => Number(text);
  const ok = (test: () => boolean) => numeric && Number.isFinite(n(actual)) && Number.isFinite(n(compareWith)) && test();
  switch (condition.trim()) {
    case "IN": return compareWith.includes(",") ? compareWith.split(",").includes(actual) : actual === compareWith;
    case "NOT IN": return compareWith.includes(",") ? !compareWith.split(",").includes(actual) : actual !== compareWith;
    case "=": return actual === compareWith;
    case "!": return actual !== compareWith;
    case "<": return ok(() => n(actual) < n(compareWith));
    case ">": return ok(() => n(actual) > n(compareWith));
    case "<=": return ok(() => n(actual) <= n(compareWith));
    case ">=": return ok(() => n(actual) >= n(compareWith));
    default: return false;
  }
}

/**
 * The order SQL Server's SQL_Latin1_General_CP1_CI_AS gives the report's SORTING_COL: case is
 * ignored, a space sorts first, then punctuation, then digits, then letters. The result tables are
 * built in memory here, so their final ORDER BY SORTING_COL, SORTING_DATE is this comparison rather
 * than PostgreSQL's collation (whose English collation ignores spaces and punctuation).
 */
export function sqlServerCompare(a: string | null | undefined, b: string | null | undefined): number {
  if (a === b) return 0;
  // NULL sorts first in an ascending ORDER BY.
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  // Trailing blanks are ignored in a varchar comparison.
  const left = a.replace(/ +$/, "");
  const right = b.replace(/ +$/, "");
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = weight(left.charCodeAt(index)) - weight(right.charCodeAt(index));
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function weight(code: number): number {
  if (code === 32) return 1;
  if (code >= 48 && code <= 57) return 1000 + code;
  if (code >= 65 && code <= 90) return 2000 + code;
  if (code >= 97 && code <= 122) return 2000 + code - 32;
  if (code < 128) return 100 + code;
  return 10000 + code;
}

/** SQL Server LEN: the length without trailing blanks. */
export function sqlLen(text: string): number {
  return text.replace(/ +$/, "").length;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** REPLACE(CONVERT(CHAR(9), date, 6), ' ', '-'): "01-Apr-26". */
export function dateStyle6(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}-${MONTHS[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
}

/** CONVERT(NVARCHAR, date, 112): "20260401". */
export function dateStyle112(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

/** DateTime.ToString("dd/MMM/yyyy"). */
export function desktopDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${MONTHS[date.getMonth()]}/${date.getFullYear()}`;
}

/** Parses dd/MMM/yyyy (the selection's dates); null when it is not one. */
export function parseSelectionDate(text: string): Date | null {
  const match = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[2].toLowerCase());
  if (month < 0) return null;
  const date = new Date(Number(match[3]), month, Number(match[1]));
  return date.getDate() === Number(match[1]) ? date : null;
}

/** Report_Combine.MakeThisQuotedString. */
export function quotedList(text: string, quote: string): string {
  if (text.trim() === "") return text;
  if (!text.includes(",")) return `${quote}${text}${quote}`;
  return `${quote}${text.split(",").join(`${quote},${quote}`)}${quote}`;
}
