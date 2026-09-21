/**
 * A grid as it is exported or printed: the columns shown, in their order and width, and the
 * rows shown (after search, filters and sort), with the values typed so Excel keeps numbers
 * as numbers and dates as dates.
 */

export type ExportKind = "text" | "number" | "date";

export type ExportColumn = Readonly<{
  caption: string;
  kind: ExportKind;
  /** Places after the decimal point for a number column. */
  decimals: number;
  align: "left" | "right" | "center";
  /** Width on screen, in pixels; exports scale it. */
  width: number;
}>;

export type ExportCell = string | number | Date | null;

export type ExportTable = Readonly<{
  /** The company the report belongs to, first line of every page. */
  company: string;
  /** The master's heading, e.g. "MASTER : ADDON SUB". */
  title: string;
  /** Further heading lines under the title (usually none). */
  subtitle: readonly string[];
  /** Printed at the right end of the title's line, e.g. "SUB MASTER: Area". */
  titleRight?: string;
  /** Printed in the middle of every page's footer, e.g. "342 records". */
  footerCenter?: string;
  columns: readonly ExportColumn[];
  rows: readonly (readonly ExportCell[])[];
  /** Column totals (null where a column is not summed); omitted when nothing is summed. */
  totals?: readonly (number | null)[];
}>;

/** A name that is safe as a downloaded file name on Windows. */
export function safeFileName(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "export";
}

/** How a cell reads in a PDF, a preview or a CSV: numbers with Indian digit grouping, dates dd/mm/yyyy. */
export function cellText(value: ExportCell, column: ExportColumn): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  }
  if (typeof value === "number") {
    return value.toLocaleString("en-IN", { minimumFractionDigits: column.decimals, maximumFractionDigits: column.decimals });
  }
  return value;
}

/** Offers bytes to the browser as a file download. */
export function download(bytes: Uint8Array | string, fileName: string, type: string) {
  const blob = new Blob([typeof bytes === "string" ? bytes : bytes.slice().buffer], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
