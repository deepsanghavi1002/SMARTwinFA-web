/**
 * A report's output as the table Print, PDF and Excel read, with the grid's heading and subtotal colours. Shared by the report screen and
 * the emailed report (lib/report-mail), so a file made on the server reads like the one saved from the screen.
 */
import { exportTableFrom } from "../../features/grid/exportTable.ts";
import { headingLevelOf, resolveLevelColours, rowLook, NO_SCREEN_COLOUR } from "../../features/grid/levelStyle.ts";
import type { RowKind } from "../../features/grid/levelStyle.ts";
import type { ExportRowStyle, ExportTable } from "../export/table.ts";
import type { OutputColumn, OutputRow, ReportOutput } from "./types.ts";

/** A colour as RRGGBB; "" when it is not a plain hex colour. */
const plainHex = (colour: string) => (/^#?[0-9a-f]{6}$/i.test(colour) ? colour.replace(/^#/, "").toUpperCase() : "");

export function rowKindOf(output: Pick<ReportOutput, "headingColours">, row: OutputRow): RowKind {
  if (row.kind === "total" || (row.kind === "data" && row.rowType === "FT")) return "total";
  if (row.kind === "subtotal") return "subtotal";
  return output.headingColours[row.rowType] !== undefined ? "heading" : "detail";
}

/** A report with subtotals: the final total's caption goes in the column most subtotals' captions start in. */
export function captionMover(output: Pick<ReportOutput, "columns" | "rows">): (row: OutputRow) => OutputRow {
  const captionAt = new Map<string, number>();
  for (const row of output.rows) {
    if (row.kind !== "subtotal") continue;
    const column = output.columns.find((candidate) => candidate.kind !== "number" && (row.values[candidate.key] ?? "") !== "");
    if (column) captionAt.set(column.key, (captionAt.get(column.key) ?? 0) + 1);
  }
  const captionKey = [...captionAt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return (row) => {
    if (captionKey === undefined || !(row.kind === "total" || (row.kind === "data" && row.rowType === "FT")) || (row.values[captionKey] ?? "") !== "") return row;
    const from = output.columns.find((candidate) => candidate.kind !== "number" && (row.values[candidate.key] ?? "") !== "");
    if (!from) return row;
    return { ...row, values: { ...row.values, [captionKey]: row.values[from.key] ?? "", [from.key]: "" } };
  };
}

export type ReportTableInput = Readonly<{
  output: ReportOutput;
  /** The columns and rows to put out, in order. */
  columns: readonly OutputColumn[];
  rows: readonly OutputRow[];
  widthOf: (column: OutputColumn) => number;
  company: string;
  title: string;
  entries: number;
  footerNote?: string;
}>;

export function reportExportTable({ output, columns, rows, widthOf, company, title, entries, footerNote }: ReportTableInput): ExportTable {
  const colours = resolveLevelColours(NO_SCREEN_COLOUR);
  const tickOrder = Object.keys(output.headingCaptions);
  const styleOf = (row: OutputRow): ExportRowStyle | null => {
    const kind = rowKindOf(output, row);
    const look = rowLook(kind, row.kind === "subtotal" ? row.level : headingLevelOf(row.rowType, output.headingLevels, tickOrder), colours);
    if (!look.background && !look.bold) return null;
    return { fill: look.background ? plainHex(look.background) : undefined, bold: look.bold };
  };
  return exportTableFrom(
    { company, title, titleRight: output.dateLine, footerCenter: `${entries} entries`, footerNote },
    columns.map((column) => ({ caption: column.caption, kind: column.kind, decimals: column.decimals, align: column.align === "R" ? "right" : column.align === "C" ? "center" : "left", width: widthOf(column), summed: false })),
    rows.map((row) => columns.map((column) => (row.values[column.key] ?? "").replace(/,/g, column.kind === "number" ? "" : ","))),
    rows.map(styleOf),
  );
}

/** The width the grid first gives a column (the desktop's widths are for a smaller font). */
export const gridWidth = (column: Pick<OutputColumn, "width">) => Math.max(30, Math.round(column.width * 1.2));

/** The whole report as the screen first shows it: every column and row, nothing filtered, grouped or added. */
export function wholeReportTable(output: ReportOutput, company: string, fallbackTitle: string): ExportTable {
  const move = captionMover(output);
  return reportExportTable({ output, columns: output.columns, rows: output.rows.map(move), widthOf: gridWidth, company, title: output.title || fallbackTitle, entries: output.records });
}
