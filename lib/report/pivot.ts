import { amountOf, isEntry } from "./compare";
import { BALANCE, compareLabels, dateColumns, labelsOf, specCaption } from "./groupBy";
import type { GroupSpec, Label } from "./groupBy";
import type { OutputColumn, OutputRow, ReportOutput } from "./types";

/**
 * Pivot (web only): the rows on screen turned into a cross table like Excel's PivotTable. Row fields run down the left (one column
 * each, the outer field first), the values of the column fields run across (a column for each combination, for each value), and each
 * value is summed, counted, averaged or its smallest / largest found. A row total column and a final total row close it. A field is a
 * text column or a period (day, week, month ...) of a date column, as in Group By. Worked on the entries already loaded, so it is
 * instant and the same for every report; the result is an output like any other (filters, sort, export and print follow it).
 */

export type PivotAggregate = "sum" | "count" | "average" | "min" | "max";
export type PivotValue = Readonly<{ key: string; aggregate: PivotAggregate }>;
export type PivotSpec = Readonly<{ rows: readonly GroupSpec[]; columns: readonly GroupSpec[]; values: readonly PivotValue[] }>;

/** The pseudo value that counts the entries. */
export const PIVOT_COUNT_KEY = "__ROWS__";
export const PIVOT_AGGREGATES: readonly (readonly [PivotAggregate, string])[] = [["sum", "Sum"], ["count", "Count"], ["average", "Average"], ["min", "Min"], ["max", "Max"]];
/** More columns than this would not be readable (and would be slow to draw). */
export const PIVOT_MAX_COLUMNS = 150;

type Accumulator = { sum: number; count: number; min: number; max: number };

const fresh = (): Accumulator => ({ sum: 0, count: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY });
const add = (accumulator: Accumulator, amount: number): void => {
  accumulator.sum += amount;
  accumulator.count += 1;
  if (amount < accumulator.min) accumulator.min = amount;
  if (amount > accumulator.max) accumulator.max = amount;
};
const result = (accumulator: Accumulator | undefined, aggregate: PivotAggregate): number | null => {
  if (!accumulator || accumulator.count === 0) return null;
  switch (aggregate) {
    case "sum": return accumulator.sum;
    case "count": return accumulator.count;
    case "average": return accumulator.sum / accumulator.count;
    case "min": return accumulator.min;
    case "max": return accumulator.max;
  }
};

/** The columns a pivot can take values from: the visible number columns that are not running balances or rates. */
export function pivotValueColumns(output: ReportOutput): OutputColumn[] {
  return output.columns.filter((column) => column.visible && column.kind === "number" && !BALANCE.test(column.key));
}

/** The fields a pivot can use for its rows and columns: the text columns and the periods of the date columns. */
export function pivotFields(output: ReportOutput): { spec: GroupSpec; label: string }[] {
  const texts = output.columns.filter((column) => column.visible && column.kind === "text" && column.key !== "HEADING_COLUMN_BY_SYSTEM");
  const dates = new Set(dateColumns(output).map((column) => column.key));
  const fields: { spec: GroupSpec; label: string }[] = [];
  for (const column of output.columns) {
    if (!column.visible) continue;
    if (dates.has(column.key)) {
      fields.push({ spec: { kind: "column", key: column.key }, label: column.caption });
      for (const unit of ["month", "quarter", "year", "week", "day"] as const) fields.push({ spec: { kind: "period", key: column.key, unit }, label: specCaption({ kind: "period", key: column.key, unit }, output.columns) });
    } else if (texts.includes(column)) fields.push({ spec: { kind: "column", key: column.key }, label: column.caption });
  }
  return fields;
}

export const pivotSpecKey = (spec: GroupSpec): string => (spec.kind === "column" ? `col:${spec.key}` : `per:${spec.key}:${spec.unit}`);

export function valueCaption(value: PivotValue, columns: readonly OutputColumn[]): string {
  const name = value.key === PIVOT_COUNT_KEY ? "Rows" : columns.find((column) => column.key === value.key)?.caption ?? value.key;
  const aggregate = PIVOT_AGGREGATES.find(([key]) => key === value.aggregate)?.[1] ?? value.aggregate;
  return value.key === PIVOT_COUNT_KEY ? "Count of rows" : `${aggregate} of ${name}`;
}

/** How many columns the spec would produce (to refuse a pivot that is too wide before it is drawn). */
export function pivotColumnCount(output: ReportOutput, spec: PivotSpec): number {
  if (spec.columns.length === 0) return spec.values.length;
  const seen = new Set<string>();
  for (const row of output.rows) if (isEntry(row)) seen.add(labelsOf(row, spec.columns).map((label) => label.label).join("\u0001"));
  return seen.size * spec.values.length + spec.values.length;
}

export function applyPivot(output: ReportOutput, spec: PivotSpec): ReportOutput {
  const entries = output.rows.filter((row) => isEntry(row));
  const valueColumns = spec.values.map((value) => (value.key === PIVOT_COUNT_KEY ? null : output.columns.find((column) => column.key === value.key) ?? null));
  const decimalsOf = (at: number): number => {
    const value = spec.values[at];
    if (value.aggregate === "count" || value.key === PIVOT_COUNT_KEY) return 0;
    return valueColumns[at]?.decimals ?? 2;
  };
  const format = (amount: number | null, at: number): string => (amount === null ? "" : amount.toLocaleString("en-IN", { minimumFractionDigits: decimalsOf(at), maximumFractionDigits: decimalsOf(at) }));

  // The rows and columns, each distinct combination once, in order (a period by its first day, else by the text).
  type Axis = { key: string; labels: Label[] };
  const axisOf = (row: OutputRow, specs: readonly GroupSpec[]): Axis => {
    const labels = labelsOf(row, specs);
    return { key: labels.map((label) => label.label).join("\u0001"), labels };
  };
  const compareAxes = (a: Axis, b: Axis): number => {
    for (let at = 0; at < a.labels.length; at += 1) {
      const order = compareLabels(a.labels[at], b.labels[at]);
      if (order !== 0) return order;
    }
    return 0;
  };
  const rowAxes = new Map<string, Axis>();
  const columnAxes = new Map<string, Axis>();
  const cells = new Map<string, Accumulator[]>();
  const rowTotals = new Map<string, Accumulator[]>();
  const columnTotals = new Map<string, Accumulator[]>();
  const grand: Accumulator[] = spec.values.map(fresh);
  const accumulators = (map: Map<string, Accumulator[]>, key: string): Accumulator[] => {
    let list = map.get(key);
    if (!list) { list = spec.values.map(fresh); map.set(key, list); }
    return list;
  };

  for (const entry of entries) {
    const rowAxis = axisOf(entry, spec.rows);
    const columnAxis = axisOf(entry, spec.columns);
    if (!rowAxes.has(rowAxis.key)) rowAxes.set(rowAxis.key, rowAxis);
    if (!columnAxes.has(columnAxis.key)) columnAxes.set(columnAxis.key, columnAxis);
    const cell = accumulators(cells, `${rowAxis.key}\u0002${columnAxis.key}`);
    const rowTotal = accumulators(rowTotals, rowAxis.key);
    const columnTotal = accumulators(columnTotals, columnAxis.key);
    spec.values.forEach((value, at) => {
      if (value.key !== PIVOT_COUNT_KEY && (entry.values[value.key] ?? "").trim() === "" && value.aggregate !== "count") return;
      const amount = value.key === PIVOT_COUNT_KEY ? 1 : amountOf(entry.values[value.key]);
      add(cell[at], amount);
      add(rowTotal[at], amount);
      add(columnTotal[at], amount);
      add(grand[at], amount);
    });
  }

  const sortedRows = [...rowAxes.values()].sort(compareAxes);
  const sortedColumns = spec.columns.length === 0 ? [{ key: "", labels: [] as Label[] }] : [...columnAxes.values()].sort(compareAxes);

  const columns: OutputColumn[] = spec.rows.map((field, at) => ({ key: `PIVOT_R${at}`, caption: specCaption(field, output.columns), width: 170, align: "L", kind: "text", decimals: 0, visible: true }));
  const heading = (axis: Axis, at: number): string => {
    const base = axis.labels.map((label) => label.label).join(" / ");
    const value = valueCaption(spec.values[at], output.columns);
    return spec.columns.length === 0 ? value : spec.values.length === 1 ? base : `${base} — ${value}`;
  };
  sortedColumns.forEach((axis, columnAt) => {
    spec.values.forEach((_, at) => columns.push({ key: `PIVOT_C${columnAt}_${at}`, caption: heading(axis, at), width: 110, align: "R", kind: "number", decimals: decimalsOf(at), visible: true }));
  });
  if (spec.columns.length > 0) {
    spec.values.forEach((value, at) => columns.push({ key: `PIVOT_T${at}`, caption: spec.values.length === 1 ? "Total" : `Total — ${valueCaption(value, output.columns)}`, width: 120, align: "R", kind: "number", decimals: decimalsOf(at), visible: true }));
  }

  const rows: OutputRow[] = [];
  for (const axis of sortedRows) {
    const values: Record<string, string> = {};
    axis.labels.forEach((label, at) => { values[`PIVOT_R${at}`] = label.label; });
    sortedColumns.forEach((columnAxis, columnAt) => {
      const cell = cells.get(`${axis.key}\u0002${columnAxis.key}`);
      spec.values.forEach((value, at) => { values[`PIVOT_C${columnAt}_${at}`] = format(result(cell?.[at], value.aggregate), at); });
    });
    if (spec.columns.length > 0) {
      const total = rowTotals.get(axis.key);
      spec.values.forEach((value, at) => { values[`PIVOT_T${at}`] = format(result(total?.[at], value.aggregate), at); });
    }
    rows.push({ kind: "data", level: -2, rowType: "", values, ledKey: 0, processKey: 0 });
  }
  const totalValues: Record<string, string> = {};
  if (spec.rows.length > 0) totalValues.PIVOT_R0 = "Final Total : ";
  sortedColumns.forEach((columnAxis, columnAt) => {
    const total = spec.columns.length === 0 ? grand : columnTotals.get(columnAxis.key);
    spec.values.forEach((value, at) => { totalValues[`PIVOT_C${columnAt}_${at}`] = format(result(total?.[at], value.aggregate), at); });
  });
  if (spec.columns.length > 0) spec.values.forEach((value, at) => { totalValues[`PIVOT_T${at}`] = format(result(grand[at], value.aggregate), at); });
  rows.push({ kind: "total", level: -1, rowType: "", values: totalValues, ledKey: 0, processKey: 0 });

  return {
    ...output,
    columns,
    rows,
    records: sortedRows.length,
    groups: [],
    frozen: Math.max(1, spec.rows.length),
    subtotals: false,
    formating: "",
    headingCaptions: {},
    headingLevels: {},
    planning: null,
    budgets: null,
  };
}
