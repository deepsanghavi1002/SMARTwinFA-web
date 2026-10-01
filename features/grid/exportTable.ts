import { parseDesktopDate } from "../../lib/master-program/legacy";
import type { ExportCell, ExportColumn, ExportTable } from "../../lib/export/table";

/**
 * A grid as shown turned into the table Print, Preview, Excel and PDF read: numbers as numbers,
 * dates as dates, and a totals row for amounts and quantities (not for serial numbers, keys or
 * codes). Every grid screen builds its export through this.
 */

export type ExportGridColumn = Readonly<{
  caption: string;
  kind: ExportColumn["kind"];
  decimals: number;
  align: ExportColumn["align"];
  width: number;
  /** Add the column up in the totals row. */
  summed: boolean;
}>;

/** A column name that is a serial number, key or code, never added up. */
export const NOT_SUMMED = /(^|_)(SR_?NO|SERIAL|KEY|CODE|ID|NO)$/i;

export function exportTableFrom(heading: Readonly<{ company: string; title: string; titleRight?: string; footerCenter?: string; recordTitleColumn?: number }>, columns: readonly ExportGridColumn[], rows: readonly (readonly string[])[]): ExportTable {
  const exportColumns: ExportColumn[] = columns.map(({ caption, kind, decimals, align, width }) => ({ caption, kind, decimals: kind === "number" ? decimals : 0, align, width }));
  const cells: ExportCell[][] = rows.map((row) => row.map((value, index) => {
    const raw = value.trim();
    if (raw === "") return null;
    if (exportColumns[index].kind === "number") { const number = Number(raw.replace(/,/g, "")); return Number.isFinite(number) ? number : raw; }
    if (exportColumns[index].kind === "date") return parseDesktopDate(raw) ?? raw;
    return raw;
  }));
  const totals = columns.some((column) => column.summed)
    ? columns.map((column, index) => (column.summed ? cells.reduce((sum, row) => sum + (typeof row[index] === "number" ? (row[index] as number) : 0), 0) : null))
    : undefined;
  return { company: heading.company, title: heading.title, subtitle: [], titleRight: heading.titleRight, footerCenter: heading.footerCenter, columns: exportColumns, rows: cells, totals, recordTitleColumn: heading.recordTitleColumn ?? 0 };
}
