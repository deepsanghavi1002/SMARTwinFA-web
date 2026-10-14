import type { OutputColumn, OutputRow, ReportOutput } from "./types";
import { FormulaError, evaluate, isError, isRowFormula, letterOf, parseFormula, toExcel } from "./sheetFormula.ts";
import type { Node, Value } from "./sheetFormula.ts";

/**
 * Columns a user adds to a report's output, each with a spreadsheet-style formula (see sheetFormula.ts). The column goes at the end of
 * the grid; a formula that is one figure shows it on the final total row (else on the last entry row), a formula for each row shows
 * its value on every entry row and its sum on the subtotal and final total rows.
 */

export type FormulaColumn = Readonly<{ key: string; caption: string; formula: string; decimals: number }>;

export const FORMULA_KEY = "FORMULA_COL_";

/** The rows that are entries (not a heading, a gap, a subtotal or the total), whose cells a formula reads. */
export function entryIndexes(output: ReportOutput): number[] {
  const list: number[] = [];
  output.rows.forEach((row, index) => {
    if (row.kind === "data" && row.rowType !== "GAP" && row.rowType !== "COUNT" && row.rowType !== "FT" && output.headingColours[row.rowType] === undefined) list.push(index);
  });
  return list;
}

const indian = (value: number, decimals: number) => value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const show = (value: Value, decimals: number): string => (value === null ? "" : typeof value === "number" ? (Number.isFinite(value) ? indian(value, decimals) : "#VALUE!") : value);

/** The number a cell of the grid holds (its text without the thousands commas), else its text; an empty cell is nothing. */
export function cellValue(text: string | undefined, column: OutputColumn): Value {
  const raw = (text ?? "").trim();
  if (raw === "") return null;
  if (column.kind === "number") { const n = Number(raw.replace(/,/g, "")); return Number.isFinite(n) ? n : raw; }
  return raw;
}

/** Looks a column up by the caption or the key a formula names it by. */
export function findColumn(columns: readonly OutputColumn[], name: string): OutputColumn | undefined {
  const upper = name.toUpperCase();
  return columns.find((column) => column.caption.toUpperCase() === upper) ?? columns.find((column) => column.key.toUpperCase() === upper);
}

export type Worked = { column: OutputColumn; node: Node | null; error: string; perRow: boolean; values: Value[]; scalar: Value };

/** Every added column worked out over the output, in order (a formula can use the columns added before it). */
export function workOut(output: ReportOutput, specs: readonly FormulaColumn[]): { columns: OutputColumn[]; worked: Worked[]; entries: number[] } {
  const entries = entryIndexes(output);
  const columns: OutputColumn[] = [...output.columns];
  const stored = new Map<string, Value[]>();
  const worked: Worked[] = [];
  for (const spec of specs) {
    let node: Node | null = null;
    let error = "";
    let result: { perRow: boolean; values: Value[]; scalar: Value } = { perRow: true, values: entries.map(() => null), scalar: null };
    try {
      node = parseFormula(spec.formula);
      result = evaluate(node, {
        rows: entries.length,
        cell: (name, row) => {
          const column = findColumn(columns, name);
          if (!column) return undefined;
          const mine = stored.get(column.key);
          return mine ? (mine[row] ?? null) : cellValue(output.rows[entries[row]]?.values[column.key], column);
        },
      });
    } catch (failure) {
      error = failure instanceof FormulaError ? failure.message : "The formula could not be worked out";
      node = null;
    }
    const perRow = node ? isRowFormula(node) : true;
    const column: OutputColumn = { key: spec.key, caption: spec.caption, width: 96, align: "R", kind: perRow ? "number" : "text", decimals: spec.decimals, visible: true };
    columns.push(column);
    stored.set(spec.key, perRow ? result.values : []);
    worked.push({ column, node, error, perRow, values: result.values, scalar: result.scalar });
  }
  return { columns, worked, entries };
}

/** The output with the added columns' cells: formula values on the entry rows, sums on the subtotals and the total. */
export function withFormulaColumns(output: ReportOutput, specs: readonly FormulaColumn[]): ReportOutput {
  if (specs.length === 0) return output;
  const { columns, worked, entries } = workOut(output, specs);
  const patch = output.rows.map(() => ({} as Record<string, string>));
  const entryPosition = new Map(entries.map((index, at) => [index, at]));
  let deepest = -1;
  for (const row of output.rows) if (row.kind === "subtotal" && row.level > deepest) deepest = row.level;
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : -1;
  const totalAt = output.rows.findIndex((row) => row.kind === "total");

  for (const item of worked) {
    const key = item.column.key;
    const decimals = item.column.decimals;
    if (!item.perRow) {
      const target = totalAt >= 0 ? totalAt : lastEntry;
      if (target >= 0) patch[target][key] = item.error ? "#NAME?" : show(item.scalar, decimals);
      continue;
    }
    const sums: number[] = Array.from({ length: Math.max(deepest, -1) + 1 }, () => 0);
    let overall = 0;
    output.rows.forEach((row, index) => {
      const at = entryPosition.get(index);
      if (at !== undefined) {
        const value = item.error ? "#NAME?" : show(item.values[at] ?? null, decimals);
        patch[index][key] = value;
        const n = item.values[at];
        if (typeof n === "number" && Number.isFinite(n)) { overall += n; for (let level = 0; level <= deepest; level += 1) sums[level] += n; }
      } else if (row.kind === "subtotal") {
        patch[index][key] = indian(sums[row.level] ?? 0, decimals);
        sums[row.level] = 0;
      } else if (row.kind === "total") {
        patch[index][key] = indian(overall, decimals);
      }
    });
  }
  const rows: OutputRow[] = output.rows.map((row, index) => ({ ...row, values: { ...row.values, ...patch[index] } }));
  return { ...output, columns, rows };
}

export { isError };

/**
 * The Excel formula of each cell of the rows being exported, for the added columns: the formula itself on an entry row, a SUM of the
 * entry rows of the group on a subtotal and of every entry on the total; a one-figure formula goes where its value is shown.
 * `rows` are the exported rows in order, `columns` the exported columns in order (so a column's place is its Excel letter), and
 * `headRow` the sheet row of the headings (the first exported row is the one after it).
 */
export function excelFormulas(args: {
  rows: readonly { kind: OutputRow["kind"]; level: number; entry: boolean }[];
  columns: readonly { key: string; caption: string }[];
  worked: readonly Worked[];
  headRow: number;
}): (string | null)[][] {
  const { rows, columns, worked, headRow } = args;
  const out: (string | null)[][] = rows.map(() => columns.map(() => null));
  const sheetRow = (index: number) => headRow + 1 + index;
  const entrySheetRows = rows.flatMap((row, index) => (row.entry ? [sheetRow(index)] : []));
  const runs = (list: readonly number[]): [number, number][] => {
    const result: [number, number][] = [];
    for (const row of list) { const last = result[result.length - 1]; if (last && last[1] === row - 1) last[1] = row; else result.push([row, row]); }
    return result;
  };
  const letterFor = (name: string) => { const at = columns.findIndex((column) => column.caption.toUpperCase() === name.toUpperCase() || column.key.toUpperCase() === name.toUpperCase()); return at >= 0 ? letterOf(at + 1) : null; };
  let deepest = -1;
  for (const row of rows) if (row.kind === "subtotal" && row.level > deepest) deepest = row.level;
  const totalAt = rows.findIndex((row) => row.kind === "total");
  const lastEntry = rows.reduce((found, row, index) => (row.entry ? index : found), -1);

  for (const item of worked) {
    const col = columns.findIndex((column) => column.key === item.column.key);
    if (col < 0 || !item.node) continue;
    const letter = letterOf(col + 1);
    const all = runs(entrySheetRows);
    if (!item.perRow) {
      const target = totalAt >= 0 ? totalAt : lastEntry;
      if (target >= 0) out[target][col] = toExcel(item.node, { letter: letterFor, row: null, segments: all });
      continue;
    }
    const groups: number[][] = Array.from({ length: deepest + 1 }, () => []);
    rows.forEach((row, index) => {
      const r = sheetRow(index);
      if (row.entry) {
        out[index][col] = toExcel(item.node!, { letter: letterFor, row: r, segments: all });
        for (let level = 0; level <= deepest; level += 1) groups[level].push(r);
      } else if (row.kind === "subtotal") {
        const list = groups[row.level] ?? [];
        if (list.length > 0) out[index][col] = `SUM(${runs(list).map(([from, to]) => `${letter}${from}:${letter}${to}`).join(",")})`;
        groups[row.level] = [];
      } else if (row.kind === "total" && entrySheetRows.length > 0) {
        out[index][col] = `SUM(${all.map(([from, to]) => `${letter}${from}:${letter}${to}`).join(",")})`;
      }
    });
  }
  return out;
}
