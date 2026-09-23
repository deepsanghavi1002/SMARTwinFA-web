import type { ExportCell, ExportColumn, ExportTable } from "../export/table.ts";

export type ReportDataRow = Record<string, string | number | null>;

const moneyNames = /(?:amount|value|debit|credit|opening|closing|pending|setoff|balance|rate|target|share|discount|tax)/i;
const countNames = /(?:quantity|qty|pieces|packs|documents|invoices|(?:^|\s)count(?:$|\s)|days)/i;
const dateNames = /(?:^|\s)(?:date|from|upto)$/i;
const nonAdditive = /(?:rate|percentage|percent|%|share)/i;

function numberValue(value: string | number | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isNumericColumn(name: string, rows: readonly ReportDataRow[]): boolean {
  if (/(?:key|code|year|document no|invoice no)/i.test(name)) return false;
  if (moneyNames.test(name) || countNames.test(name)) return true;
  const values = rows.map((row) => row[name]).filter((value) => value !== null && value !== "");
  return values.length > 0 && values.every((value) => numberValue(value) !== null);
}

export function reportColumns(names: readonly string[], rows: readonly ReportDataRow[]): ExportColumn[] {
  return names.map((caption) => {
    const numeric = isNumericColumn(caption, rows);
    const date = dateNames.test(caption);
    return {
      caption,
      kind: date ? "date" : numeric ? "number" : "text",
      decimals: numeric ? (/quantity|qty|pieces|packs|weight/i.test(caption) ? 3 : moneyNames.test(caption) ? 2 : 0) : 0,
      align: numeric ? "right" : date ? "center" : "left",
      width: Math.min(260, Math.max(numeric ? 105 : 130, caption.length * 9 + 28)),
    };
  });
}

export function reportTotals(names: readonly string[], rows: readonly ReportDataRow[], columns = reportColumns(names, rows)): (number | null)[] | undefined {
  const totals = names.map((name, index) => {
    if (columns[index].kind !== "number" || nonAdditive.test(name)) return null;
    const values = rows.map((row) => numberValue(row[name])).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  });
  return totals.some((value) => value !== null) ? totals : undefined;
}

function exportCell(value: string | number | null, column: ExportColumn): ExportCell {
  if (value === null || value === "") return null;
  if (column.kind === "number") return numberValue(value);
  if (column.kind === "date") {
    const date = new Date(String(value));
    return Number.isNaN(date.valueOf()) ? String(value) : date;
  }
  return String(value);
}

export function buildReportTable(input: {
  company?: string;
  title: string;
  subtitle?: readonly string[];
  columns: readonly string[];
  rows: readonly ReportDataRow[];
}): ExportTable {
  const columns = reportColumns(input.columns, input.rows);
  return {
    company: input.company ?? "SMARTwin Financial Accounting",
    title: input.title,
    subtitle: input.subtitle ?? [],
    footerCenter: `${input.rows.length.toLocaleString("en-IN")} records`,
    columns,
    rows: input.rows.map((row) => input.columns.map((name, index) => exportCell(row[name], columns[index]))),
    totals: reportTotals(input.columns, input.rows, columns),
  };
}

export function reportSummary(table: ExportTable, limit = 3): { label: string; value: number; decimals: number }[] {
  if (!table.totals) return [];
  return table.totals.flatMap((value, index) => value === null ? [] : [{ label: table.columns[index].caption, value, decimals: table.columns[index].decimals }]).slice(0, limit);
}
