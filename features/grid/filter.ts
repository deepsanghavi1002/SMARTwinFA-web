import { parseDesktopDate, toDecimal } from "../../lib/master-program/legacy";

/**
 * Excel-style column filters for every grid (master, small entry, entry, reports): a column's
 * values can be ticked in or out, and up to two conditions joined by And/Or narrow it further.
 * A condition reads the stored value (numbers, dates) or the text as shown.
 */

export type FilterKind = "text" | "number" | "date";
export type Condition = { op: string; a: string; b: string };
/** A column's filter: the values left ticked, and up to two conditions joined by And/Or. */
export type ColumnFilter = { values?: string[]; first?: Condition; join?: "and" | "or"; second?: Condition };
export type FilterDraft = { key: string; chosen: string[]; first: Condition; join: "and" | "or"; second: Condition };

export const FILTER_OPS: Record<FilterKind, readonly (readonly [string, string])[]> = {
  text: [["", "(no condition)"], ["eq", "Equals"], ["ne", "Does Not Equal"], ["begins", "Begins With"], ["ends", "Ends With"], ["contains", "Contains"], ["notContains", "Does Not Contain"], ["blank", "Is Blank"], ["notBlank", "Is Not Blank"]],
  number: [["", "(no condition)"], ["eq", "Equals"], ["ne", "Does Not Equal"], ["gt", "Greater Than"], ["ge", "Greater Than or Equal To"], ["lt", "Less Than"], ["le", "Less Than or Equal To"], ["between", "Between"], ["blank", "Is Blank or Zero"], ["notBlank", "Is Not Blank or Zero"]],
  date: [["", "(no condition)"], ["eq", "On"], ["ne", "Not On"], ["lt", "Before"], ["le", "On or Before"], ["gt", "After"], ["ge", "On or After"], ["between", "Between"], ["blank", "Is Blank"], ["notBlank", "Is Not Blank"]],
};
export const FILTER_TITLE: Record<FilterKind, string> = { text: "Text Filter", number: "Numeric Filter", date: "Date Filter" };
export const NO_VALUE_OPS = ["", "blank", "notBlank"];
export const emptyCondition = (): Condition => ({ op: "", a: "", b: "" });

/** The kind of filter a column gets from its field type (D date; N, C, I number; else text). */
export function kindOfFieldType(fieldType: string, numberFormat = false): FilterKind {
  if (fieldType === "D") return "date";
  if (fieldType === "N" || fieldType === "C" || fieldType === "I" || numberFormat) return "number";
  return "text";
}

/** One condition against a stored cell value; "a" and "b" are what the operator typed (dates as yyyy-mm-dd). */
export function conditionHolds(kind: FilterKind, condition: Condition, raw: string, shown: string): boolean {
  const { op, a, b } = condition;
  if (op === "") return true;
  if (kind === "number") {
    const value = toDecimal(raw);
    const x = toDecimal(a);
    const y = toDecimal(b);
    switch (op) {
      case "eq": return value === x;
      case "ne": return value !== x;
      case "gt": return value > x;
      case "ge": return value >= x;
      case "lt": return value < x;
      case "le": return value <= x;
      case "between": return value >= Math.min(x, y) && value <= Math.max(x, y);
      case "blank": return raw.trim() === "" || value === 0;
      case "notBlank": return raw.trim() !== "" && value !== 0;
      default: return true;
    }
  }
  if (kind === "date") {
    const date = parseDesktopDate(raw);
    const day = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
    if (op === "blank") return day === "";
    if (op === "notBlank") return day !== "";
    if (day === "" || a === "") return false;
    switch (op) {
      case "eq": return day === a;
      case "ne": return day !== a;
      case "gt": return day > a;
      case "ge": return day >= a;
      case "lt": return day < a;
      case "le": return day <= a;
      case "between": return b !== "" && day >= (a < b ? a : b) && day <= (a < b ? b : a);
      default: return true;
    }
  }
  const text = shown.toLowerCase();
  const needle = a.trim().toLowerCase();
  switch (op) {
    case "eq": return text === needle;
    case "ne": return text !== needle;
    case "begins": return text.startsWith(needle);
    case "ends": return text.endsWith(needle);
    case "contains": return text.includes(needle);
    case "notContains": return !text.includes(needle);
    case "blank": return text === "";
    case "notBlank": return text !== "";
    default: return true;
  }
}

/** Whether a cell passes its column's filter: `raw` the stored value, `shown` the text in the grid. */
export function filterHolds(kind: FilterKind, filter: ColumnFilter, raw: string, shown: string): boolean {
  if (filter.values && !filter.values.includes(shown)) return false;
  if (!filter.first || filter.first.op === "") return true;
  const first = conditionHolds(kind, filter.first, raw, shown);
  if (!filter.second || filter.second.op === "") return first;
  const second = conditionHolds(kind, filter.second, raw, shown);
  return filter.join === "or" ? first || second : first && second;
}

/** A condition is complete when it needs no value, or has one (two for Between). */
export const usableCondition = (condition: Condition) => condition.op !== "" && (NO_VALUE_OPS.includes(condition.op) || (condition.a.trim() !== "" && (condition.op !== "between" || condition.b.trim() !== "")));

/** The filter a draft becomes: nothing ticked out and no condition means no filter (null). */
export function filterFromDraft(draft: FilterDraft, allValues: readonly string[]): ColumnFilter | null {
  const next: ColumnFilter = {};
  if (draft.chosen.length !== allValues.length) next.values = draft.chosen;
  if (usableCondition(draft.first)) {
    next.first = draft.first;
    if (usableCondition(draft.second)) { next.join = draft.join; next.second = draft.second; }
  }
  return next.values || next.first ? next : null;
}

/** Distinct values for a filter list: blank first, then in natural order. */
export function sortedDistinct(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, undefined, { numeric: true })));
}
