import { amountOf, isEntry } from "./compare";
import { dateColumns, labelsOf } from "./groupBy";
import type { GroupSpec, PeriodUnit } from "./groupBy";
import { PIVOT_COUNT_KEY, pivotFields, pivotSpecKey, pivotValueColumns } from "./pivot";
import type { PivotAggregate, PivotSpec, PivotValue } from "./pivot";
import type { ReportOutput } from "./types";

/**
 * A pivot asked for in words (Ask AI: "pivot register with month as column, amount as value and particulars as row"): the names the person used for
 * the row fields, the column fields and the values. They are matched to the columns of whichever report is opened, once it has run, so the same
 * request works for any report.
 */
export type PivotHint = Readonly<{
  rows: readonly string[];
  columns: readonly string[];
  values: readonly Readonly<{ name: string; aggregate: PivotAggregate }>[];
}>;

const PERIODS: Readonly<Record<string, PeriodUnit>> = {
  month: "month", months: "month", monthly: "month", monthwise: "month", quarter: "quarter", quarters: "quarter", quarterly: "quarter",
  year: "year", years: "year", yearly: "year", week: "week", weeks: "week", weekly: "week", day: "day", days: "day", daily: "day",
};

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const related = (a: string, b: string) => a !== "" && b !== "" && (a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b)));

/** The pivot a hint means for this report's columns (null when it names no value, or no row or column field, that the report has). */
function resolvers(output: ReportOutput) {
  const fields = pivotFields(output);
  const dates = dateColumns(output);

  const field = (name: string): GroupSpec | null => {
    const words = norm(name).split(" ").filter((word) => word !== "wise" && word !== "of");
    const periodWord = words.find((word) => PERIODS[word] !== undefined);
    if (periodWord) {
      const rest = words.filter((word) => word !== periodWord).join(" ");
      const column = (rest !== "" ? dates.find((candidate) => related(norm(candidate.caption), rest)) : undefined) ?? dates[0];
      return column ? { kind: "period", key: column.key, unit: PERIODS[periodWord] } : null;
    }
    const wanted = words.join(" ");
    const hit = fields.find((candidate) => candidate.spec.kind === "column" && norm(candidate.label) === wanted)
      ?? fields.find((candidate) => candidate.spec.kind === "column" && related(norm(candidate.label), wanted));
    return hit ? hit.spec : null;
  };

  const numbers = pivotValueColumns(output);
  const value = (entry: { name: string; aggregate: PivotAggregate }): PivotValue | null => {
    const wanted = norm(entry.name);
    if (entry.aggregate === "count" || /^(rows?|entries|number|count)$/.test(wanted)) return { key: PIVOT_COUNT_KEY, aggregate: "count" };
    const named = numbers.find((column) => norm(column.caption) === wanted) ?? numbers.find((column) => related(norm(column.caption), wanted));
    // "amount", "value" and "total" are what a person calls the money column whatever the report names it.
    const money = /amount|value|total|figure|sales?|money/.test(wanted)
      ? numbers.find((column) => norm(column.caption) === "amount") ?? numbers.find((column) => /amount|value|total/.test(norm(column.caption))) ?? numbers[0]
      : undefined;
    const column = named ?? money;
    return column ? { key: column.key, aggregate: entry.aggregate } : null;
  };

  return { field, value };
}

function build(output: ReportOutput, hint: PivotHint): { spec: PivotSpec | null; missing: string[] } {
  const { field, value } = resolvers(output);
  const missing: string[] = [];
  const keep = (names: readonly string[]) => names.map((name) => ({ name, spec: field(name) })).filter((entry) => { if (entry.spec === null) missing.push(entry.name); return entry.spec !== null; }).map((entry) => entry.spec as GroupSpec);
  const rows = keep(hint.rows);
  const rowKeys = new Set(rows.map(pivotSpecKey));
  const columns = keep(hint.columns).filter((spec) => !rowKeys.has(pivotSpecKey(spec)));
  const values = hint.values.map((entry) => ({ entry, found: value(entry) })).filter((item) => { if (item.found === null) missing.push(item.entry.name); return item.found !== null; }).map((item) => item.found as PivotValue);
  return { spec: values.length === 0 || rows.length + columns.length === 0 ? null : { rows, columns, values }, missing };
}

/** The pivot a hint means for this report's columns (null when it names no value, or no row or column field, that the report has). */
export function resolvePivotHint(output: ReportOutput, hint: PivotHint): PivotSpec | null {
  return build(output, hint).spec;
}

/** Why a pivot asked for in words could not be set up, with the names the report does have. Empty when it can. */
export function pivotHintProblem(output: ReportOutput, hint: PivotHint): string {
  const { spec, missing } = build(output, hint);
  if (spec && missing.length === 0) return "";
  const fields = pivotFields(output).filter((candidate) => candidate.spec.kind === "column").map((candidate) => candidate.label);
  const numbers = pivotValueColumns(output).map((column) => column.caption);
  return `${missing.length > 0 ? `This report has no column called: ${missing.join(", ")}.` : "The pivot needs a field for Rows or Columns and a number for Values."}

Fields: ${fields.join(", ") || "none"}
Numbers: ${numbers.join(", ") || "none"}

${spec ? "The pivot is set up without them." : "Say it again with these names, or use the Pivot button."}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// SUMIF / COUNTIF / AVERAGEIF in words: "sum of amount in purchase register where particulars = Jain Sales Corporation and month is april"

export type SumifOperator = "eq" | "ne" | "contains" | "gt" | "ge" | "lt" | "le";
export type SumifHint = Readonly<{
  value: Readonly<{ name: string; aggregate: PivotAggregate }>;
  conditions: readonly Readonly<{ field: string; op: SumifOperator; text: string }>[];
}>;

const ordinaryWords = (text: string) => norm(text).split(" ").filter((word) => word !== "");

/** Whether a row's field (a column, or a period of a date column) meets one condition. */
function meets(label: string, op: SumifOperator, text: string, isPeriod: boolean): boolean {
  if (op === "gt" || op === "ge" || op === "lt" || op === "le") {
    const left = amountOf(label);
    const right = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(right)) return false;
    return op === "gt" ? left > right : op === "ge" ? left >= right : op === "lt" ? left < right : left <= right;
  }
  const cell = norm(label);
  const wanted = norm(text);
  // A month named in words ("april") meets the label of its period ("Apr-2026"): each word of the condition begins a word of the label.
  const found = isPeriod
    ? ordinaryWords(text).every((word) => ordinaryWords(label).some((part) => part.startsWith(word.slice(0, 3)) && (/^\d/.test(word) ? part === word : true)))
    : op === "contains" ? cell.includes(wanted) : cell === wanted;
  return op === "ne" ? !found : found;
}

/** The answer to a SUMIF asked in words for this report's rows: the figure, how many rows met the conditions, and what was not found. */
export function computeSumif(output: ReportOutput, hint: SumifHint): { text: string; ok: boolean } {
  const { field, value } = resolvers(output);
  const missing: string[] = [];
  const checks = hint.conditions.map((condition) => ({ condition, spec: field(condition.field) })).filter((entry) => { if (entry.spec === null) missing.push(entry.condition.field); return entry.spec !== null; })
    .map((entry) => ({ ...entry.condition, spec: entry.spec as GroupSpec }));
  const column = value({ name: hint.value.name, aggregate: hint.value.aggregate });
  if (column === null) missing.push(hint.value.name);
  const names = pivotValueColumns(output).map((entry) => entry.caption).join(", ") || "none";
  const fields = pivotFields(output).filter((entry) => entry.spec.kind === "column").map((entry) => entry.label).join(", ") || "none";
  if (missing.length > 0 || column === null) return { ok: false, text: `This report has no column called: ${missing.join(", ")}.\n\nFields: ${fields}\nNumbers: ${names}` };

  // An "is" that finds nothing exactly is tried again as "contains" (a name typed in part).
  const run = (loose: boolean) => {
    let total = 0; let count = 0; let min = Number.POSITIVE_INFINITY; let max = Number.NEGATIVE_INFINITY;
    for (const row of output.rows) {
      if (!isEntry(row)) continue;
      if (!checks.every((check) => meets(labelsOf(row, [check.spec])[0]?.label ?? "", loose && check.op === "eq" ? "contains" : check.op, check.text, check.spec.kind === "period"))) continue;
      const amount = column.key === PIVOT_COUNT_KEY ? 1 : amountOf(row.values[column.key]);
      total += amount; count += 1; if (amount < min) min = amount; if (amount > max) max = amount;
    }
    return { total, count, min, max };
  };
  let result = run(false);
  let loose = false;
  if (result.count === 0 && checks.some((check) => check.op === "eq")) { result = run(true); loose = result.count > 0; }
  const aggregate = hint.value.aggregate;
  const figure = aggregate === "count" ? result.count : aggregate === "average" ? (result.count === 0 ? 0 : result.total / result.count) : aggregate === "min" ? (result.count === 0 ? 0 : result.min) : aggregate === "max" ? (result.count === 0 ? 0 : result.max) : result.total;
  const what = column.key === PIVOT_COUNT_KEY ? "Rows" : output.columns.find((entry) => entry.key === column.key)?.caption ?? column.key;
  const where = hint.conditions.map((condition) => `${condition.field} ${{ eq: "=", ne: "is not", contains: "contains", gt: ">", ge: ">=", lt: "<", le: "<=" }[condition.op]} ${condition.text}`).join(" and ");
  const label = { sum: "Sum", count: "Count", average: "Average", min: "Min", max: "Max" }[aggregate];
  return { ok: true, text: `${label} of ${what}${where ? ` where ${where}` : ""}\n\n${figure.toLocaleString("en-IN", { minimumFractionDigits: aggregate === "count" ? 0 : 2, maximumFractionDigits: aggregate === "count" ? 0 : 2 })}\n\n${result.count} row${result.count === 1 ? "" : "s"} met it${loose ? " (the text was found as part of the names)" : ""}.` };
}
