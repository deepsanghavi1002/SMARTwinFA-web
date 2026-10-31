import { parseDesktopDate, toDecimal } from "../../lib/master-program/legacy";

/**
 * Excel-style column filters for every grid (master, small entry, entry, reports): a column's
 * values can be ticked in or out, and up to two conditions joined by And/Or narrow it further.
 * A condition reads the stored value (numbers, dates) or the text as shown.
 */

export type FilterKind = "text" | "number" | "date";
export type Condition = { op: string; a: string; b: string };
/** A column's filter: the values left ticked, and up to two conditions joined by And/Or. */
export type ColumnFilter = { values?: string[]; first?: Condition; join?: "and" | "or"; second?: Condition; /** The cell colours left ticked ("" is a cell with no colour). */ colours?: string[] };
export type FilterDraft = { key: string; chosen: string[]; first: Condition; join: "and" | "or"; second: Condition; /** The colours ticked, null when the column has no colours to choose from. */ colours: string[] | null };
/** What a figure column holds, for the Above / Below Average and Top / Bottom N conditions. */
export type ColumnStats = { average: number; /** The figures, largest first. */ sorted: readonly number[] };
/** What a cell brings besides its value: its colour, and its column's figures. */
export type CellExtra = { colour?: string; stats?: ColumnStats };

export const statsOf = (values: readonly number[]): ColumnStats => ({ average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0, sorted: [...values].sort((a, b) => b - a) });
/** Conditions that need the column's figures (Excel's Top 10 and Above / Below Average): offered where the screen can give them. */
export const STATS_OPS: readonly (readonly [string, string])[] = [["aboveAvg", "Above Average"], ["belowAvg", "Below Average"], ["top", "Top N Items…"], ["bottom", "Bottom N Items…"]];
/** Excel's date periods, worked from today: no value to type. */
export const DATE_PERIODS: readonly (readonly [string, string])[] = [["today", "Today"], ["yesterday", "Yesterday"], ["tomorrow", "Tomorrow"], ["thisWeek", "This Week"], ["lastWeek", "Last Week"], ["nextWeek", "Next Week"],
  ["thisMonth", "This Month"], ["lastMonth", "Last Month"], ["nextMonth", "Next Month"], ["thisQuarter", "This Quarter"], ["lastQuarter", "Last Quarter"], ["nextQuarter", "Next Quarter"],
  ["thisYear", "This Year"], ["lastYear", "Last Year"], ["nextYear", "Next Year"], ["ytd", "Year to Date"]];

const dayText = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** The first and last day (yyyy-mm-dd) of a date period, counted from today. */
function periodOf(op: string, today = new Date()): [string, string] | null {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  const at = (year: number, month: number, day: number) => dayText(new Date(year, month, day));
  const week = (shift: number) => { const start = d - today.getDay() + shift * 7; return [at(y, m, start), at(y, m, start + 6)] as [string, string]; };
  const month = (shift: number) => [at(y, m + shift, 1), at(y, m + shift + 1, 0)] as [string, string];
  const quarter = (shift: number) => { const first = Math.floor(m / 3) * 3 + shift * 3; return [at(y, first, 1), at(y, first + 3, 0)] as [string, string]; };
  switch (op) {
    case "today": return [at(y, m, d), at(y, m, d)];
    case "yesterday": return [at(y, m, d - 1), at(y, m, d - 1)];
    case "tomorrow": return [at(y, m, d + 1), at(y, m, d + 1)];
    case "thisWeek": return week(0);
    case "lastWeek": return week(-1);
    case "nextWeek": return week(1);
    case "thisMonth": return month(0);
    case "lastMonth": return month(-1);
    case "nextMonth": return month(1);
    case "thisQuarter": return quarter(0);
    case "lastQuarter": return quarter(-1);
    case "nextQuarter": return quarter(1);
    case "thisYear": return [at(y, 0, 1), at(y, 11, 31)];
    case "lastYear": return [at(y - 1, 0, 1), at(y - 1, 11, 31)];
    case "nextYear": return [at(y + 1, 0, 1), at(y + 1, 11, 31)];
    case "ytd": return [at(y, 0, 1), at(y, m, d)];
  }
  return null;
}

export const FILTER_OPS: Record<FilterKind, readonly (readonly [string, string])[]> = {
  text: [["", "(no condition)"], ["eq", "Equals"], ["ne", "Does Not Equal"], ["begins", "Begins With"], ["ends", "Ends With"], ["contains", "Contains"], ["notContains", "Does Not Contain"], ["blank", "Is Blank"], ["notBlank", "Is Not Blank"]],
  number: [["", "(no condition)"], ["eq", "Equals"], ["ne", "Does Not Equal"], ["gt", "Greater Than"], ["ge", "Greater Than or Equal To"], ["lt", "Less Than"], ["le", "Less Than or Equal To"], ["between", "Between"], ["blank", "Is Blank or Zero"], ["notBlank", "Is Not Blank or Zero"], ["whole", "Whole Numbers Only"], ["fraction", "With Decimals Only"]],
  date: [["", "(no condition)"], ["eq", "On"], ["ne", "Not On"], ["lt", "Before"], ["le", "On or Before"], ["gt", "After"], ["ge", "On or After"], ["between", "Between"], ["blank", "Is Blank"], ["notBlank", "Is Not Blank"], ...DATE_PERIODS],
};
export const FILTER_TITLE: Record<FilterKind, string> = { text: "Text Filter", number: "Numeric Filter", date: "Date Filter" };
export const NO_VALUE_OPS = ["", "blank", "notBlank", "whole", "fraction", "aboveAvg", "belowAvg", ...DATE_PERIODS.map(([op]) => op)];
export const emptyCondition = (): Condition => ({ op: "", a: "", b: "" });

/** The kind of filter a column gets from its field type (D date; N, C, I number; else text). */
export function kindOfFieldType(fieldType: string, numberFormat = false): FilterKind {
  if (fieldType === "D") return "date";
  if (fieldType === "N" || fieldType === "C" || fieldType === "I" || numberFormat) return "number";
  return "text";
}

/** One condition against a stored cell value; "a" and "b" are what the operator typed (dates as yyyy-mm-dd). */
export function conditionHolds(kind: FilterKind, condition: Condition, raw: string, shown: string, stats?: ColumnStats): boolean {
  const { op, a, b } = condition;
  if (op === "") return true;
  if (kind === "number") {
    const value = toDecimal(raw);
    const x = toDecimal(a);
    const y = toDecimal(b);
    switch (op) {
      // Excel's Above / Below Average and Top / Bottom N Items, over the column's figures.
      case "aboveAvg": return stats !== undefined && raw.trim() !== "" && value > stats.average;
      case "belowAvg": return stats !== undefined && raw.trim() !== "" && value < stats.average;
      case "top": case "bottom": {
        if (!stats || raw.trim() === "" || stats.sorted.length === 0) return false;
        const n = Math.max(1, Math.min(stats.sorted.length, Math.trunc(x) || 1));
        return op === "top" ? value >= stats.sorted[n - 1] : value <= stats.sorted[stats.sorted.length - n];
      }
      case "eq": return value === x;
      case "ne": return value !== x;
      case "gt": return value > x;
      case "ge": return value >= x;
      case "lt": return value < x;
      case "le": return value <= x;
      case "between": return value >= Math.min(x, y) && value <= Math.max(x, y);
      case "blank": return raw.trim() === "" || value === 0;
      case "notBlank": return raw.trim() !== "" && value !== 0;
      // A figure with no decimal part (1.00 counts as whole), or one with a decimal figure other than zeros (1.50): judged on the figure as the grid shows it (6.004 shown as 6.00 is whole).
      case "whole": case "fraction": {
        const seen = shown.trim() !== "" ? toDecimal(shown) : value;
        const fractional = Math.abs(seen - Math.round(seen)) >= 0.00005;
        return raw.trim() !== "" && (op === "fraction" ? fractional : !fractional);
      }
      default: return true;
    }
  }
  if (kind === "date") {
    const date = parseDesktopDate(raw);
    const day = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
    if (op === "blank") return day === "";
    if (op === "notBlank") return day !== "";
    const period = periodOf(op);
    if (period) return day !== "" && day >= period[0] && day <= period[1];
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
export function filterHolds(kind: FilterKind, filter: ColumnFilter, raw: string, shown: string, extra?: CellExtra): boolean {
  if (filter.values && !filter.values.includes(shown)) return false;
  if (filter.colours && !filter.colours.includes(extra?.colour ?? "")) return false;
  if (!filter.first || filter.first.op === "") return true;
  const first = conditionHolds(kind, filter.first, raw, shown, extra?.stats);
  if (!filter.second || filter.second.op === "") return first;
  const second = conditionHolds(kind, filter.second, raw, shown, extra?.stats);
  return filter.join === "or" ? first || second : first && second;
}

/** A condition is complete when it needs no value, or has one (two for Between). */
export const usableCondition = (condition: Condition) => condition.op !== "" && (NO_VALUE_OPS.includes(condition.op) || (condition.a.trim() !== "" && (condition.op !== "between" || condition.b.trim() !== "")));

/** The filter a draft becomes: nothing ticked out and no condition means no filter (null). */
export function filterFromDraft(draft: FilterDraft, allValues: readonly string[], allColours: readonly string[] = []): ColumnFilter | null {
  const next: ColumnFilter = {};
  if (draft.chosen.length !== allValues.length) next.values = draft.chosen;
  if (draft.colours && draft.colours.length !== allColours.length) next.colours = draft.colours;
  if (usableCondition(draft.first)) {
    next.first = draft.first;
    if (usableCondition(draft.second)) { next.join = draft.join; next.second = draft.second; }
  }
  return next.values || next.colours || next.first ? next : null;
}

/** Distinct values for a filter list: blank first, then in natural order. */
// One collator for every comparison: localeCompare with options builds a new one each call, which made a column of tens of thousands of values take seconds to list.
const NATURAL = new Intl.Collator(undefined, { numeric: true });
export function sortedDistinct(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : NATURAL.compare(a, b)));
}
