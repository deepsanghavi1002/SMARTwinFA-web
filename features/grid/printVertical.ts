import { formatDesktopDate } from "../../lib/master-program/legacy";
import { previewPages, printDocument } from "../../lib/export/pages";
import type { PdfOptions } from "../../lib/export/pdf";
import { safeFileName } from "../../lib/export/table";
import type { ExportTable } from "../../lib/export/table";
import { printHtmlDocument, readPrintSetup } from "./printFrame";

/**
 * Prints records in the vertical layout only (each record from a new page, every field's heading
 * beside its value), with no layout to choose: the master's New grid Print, which prints the one
 * record being entered. The font size is the one last chosen for printing in this browser.
 */
export function printVertical(table: ExportTable, name: string, userName: string) {
  const now = new Date();
  const options: PdfOptions = {
    orientation: "portrait",
    fontSize: readPrintSetup()?.fontSize ?? 10,
    totals: false,
    style: "record",
    footer: `Printed ${formatDesktopDate(now)} ${now.toTimeString().slice(0, 5)} by ${userName}`,
  };
  printHtmlDocument(printDocument(safeFileName(name), previewPages(table, options), options.orientation));
}
