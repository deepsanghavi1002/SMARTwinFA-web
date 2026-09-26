import { cellText } from "./table.ts";
import type { ExportColumn, ExportTable } from "./table.ts";

/**
 * A grid as a PDF report, written without a library. Every page carries the company, the
 * master's heading and the column headings; rows are shaded alternately, numbers are right
 * aligned, a totals row closes the report, and each page ends with the print date and
 * "Page n of N". Text that does not fit its column is trimmed with "...". The standard
 * Helvetica fonts are used, so the file is small and opens anywhere.
 */

export type PdfOptions = Readonly<{
  orientation: "portrait" | "landscape";
  /** Body font size in points (headings scale from it). */
  fontSize: number;
  /** Print the totals row when the table has one. */
  totals: boolean;
  /** The footer's left text, e.g. "Printed 21/09/2026 10:15 by ADMIN". */
  footer: string;
}>;

// Character widths (per 1000 units of font size) for ASCII 32..126, from the Helvetica AFM files.
const HELVETICA = "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584".split(" ").map(Number);
const HELVETICA_BOLD = "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584".split(" ").map(Number);

/** Text in the fonts' WinAnsi encoding; characters outside it print as "?" (the rupee sign as "Rs."). */
function winAnsi(text: string): string {
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 63;
    if (character === String.fromCharCode(0x20b9)) out += "Rs.";
    else if (code >= 32 && code <= 126) out += character;
    else if (code >= 160 && code <= 255) out += character;
    else if (code === 9) out += " ";
    else out += "?";
  }
  return out;
}

export function textWidth(text: string, size: number, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    units += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (units * size) / 1000;
}

/** The text cut to fit a width, ending in "..." when cut. */
export function fit(text: string, width: number, size: number, bold: boolean): string {
  if (textWidth(text, size, bold) <= width) return text;
  let cut = text;
  while (cut.length > 0 && textWidth(`${cut}...`, size, bold) > width) cut = cut.slice(0, -1);
  return cut.length > 0 ? `${cut}...` : "";
}

/** A heading split into at most two lines that fit the column. */
function headingLines(text: string, width: number, size: number): string[] {
  if (textWidth(text, size, true) <= width) return [text];
  const words = text.split(/\s+/);
  let first = "";
  let index = 0;
  while (index < words.length && textWidth(`${first} ${words[index]}`.trim(), size, true) <= width) { first = `${first} ${words[index]}`.trim(); index += 1; }
  if (first === "") return [fit(text, width, size, true)];
  return [first, fit(words.slice(index).join(" "), width, size, true)].filter((line) => line !== "");
}

const escapePdf = (text: string) => winAnsi(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (value: number) => (Math.round(value * 100) / 100).toString();

/**
 * One slice of the columns, printed side by side on a page. When the columns do not all fit
 * across the paper, pages run as Excel prints them ("down, then over"): every record with the
 * first band of columns, then every record again with the next band, until all are printed.
 */
export type PageBand = Readonly<{
  /** Indexes into table.columns, in print order. */
  columns: readonly number[];
  widths: readonly number[];
  xs: readonly number[];
  tableWidth: number;
  heads: readonly (readonly string[])[];
  /** Where "Total" is printed: the first column of the band that is not summed, or -1. */
  labelAt: number;
}>;

/** Where everything goes on the pages, in points: shared by the PDF and the on-screen print preview. */
export type PageLayout = Readonly<{
  pageWidth: number;
  pageHeight: number;
  margin: number;
  usable: number;
  bands: readonly PageBand[];
  size: number;
  rowHeight: number;
  pad: number;
  headHeight: number;
  topLines: readonly string[];
  topHeight: number;
  bodyTop: number;
  withTotals: boolean;
  lineCount: number;
  perPage: number;
  /** Pages each band of columns takes (all the records once). */
  blockCount: number;
  pageCount: number;
}>;

/** A column never prints wider than this, in points (longer text ends in "..."). */
const MAX_COLUMN = 240;

export function pageLayout(table: ExportTable, options: PdfOptions): PageLayout {
  const landscape = options.orientation === "landscape";
  const pageWidth = landscape ? 842 : 595;
  const pageHeight = landscape ? 595 : 842;
  const margin = 28;
  const usable = pageWidth - margin * 2;
  const size = options.fontSize;
  const rowHeight = size * 1.55;
  const pad = 2.5;
  const withTotals = Boolean(options.totals && table.totals && table.rows.length > 0);

  // Each column as wide as on screen (and at least its heading's longest word), so the text stays
  // readable: when they do not all fit across, the rest go on further sheets instead of shrinking.
  const natural = table.columns.map((column) => {
    const word = Math.max(0, ...column.caption.split(/\s+/).map((part) => textWidth(part, size, true)));
    return Math.min(MAX_COLUMN, usable, Math.max(24, column.width * 0.75, word + pad * 2));
  });
  const naturalTotal = natural.reduce((sum, width) => sum + width, 0) || 1;

  let groups: number[][];
  let scale = 1;
  if (naturalTotal <= usable) {
    // Everything fits across one sheet: spread the columns over the page, as before.
    groups = [table.columns.map((_, index) => index)];
    scale = Math.min(1.4, usable / naturalTotal);
  } else {
    groups = [];
    let current: number[] = [];
    let used = 0;
    table.columns.forEach((_, index) => {
      if (current.length > 0 && used + natural[index] > usable) { groups.push(current); current = []; used = 0; }
      current.push(index);
      used += natural[index];
    });
    if (current.length > 0) groups.push(current);
  }

  const summed = (index: number) => table.totals?.[index] !== null && table.totals?.[index] !== undefined;
  const bands: PageBand[] = groups.map((columns) => {
    const widths = columns.map((index) => natural[index] * scale);
    const xs: number[] = [];
    widths.reduce((x, width, at) => { xs[at] = x; return x + width; }, margin);
    return {
      columns,
      widths,
      xs,
      tableWidth: widths.reduce((sum, width) => sum + width, 0),
      heads: columns.map((index, at) => headingLines(table.columns[index].caption, widths[at] - pad * 2, size)),
      labelAt: columns.findIndex((index) => !summed(index)),
    };
  });
  const headLines = Math.max(1, ...bands.flatMap((band) => band.heads.map((lines) => lines.length)));
  const headHeight = headLines * size * 1.2 + 5;

  const topLines = [table.company, table.title, ...table.subtitle].filter((line) => line.trim() !== "");
  const topHeight = topLines.reduce((sum, _, index) => sum + (index === 0 ? 15 : index === 1 ? 13 : 11), 0) + 6;
  const bodyTop = pageHeight - margin - topHeight - headHeight;
  const bodyBottom = margin + 16;
  const perPage = Math.max(1, Math.floor((bodyTop - bodyBottom) / rowHeight));
  const lineCount = table.rows.length + (withTotals ? 1 : 0);
  const blockCount = Math.max(1, Math.ceil(lineCount / perPage));

  return { pageWidth, pageHeight, margin, usable, bands, size, rowHeight, pad, headHeight, topLines, topHeight, bodyTop, withTotals, lineCount, perPage, blockCount, pageCount: blockCount * bands.length };
}

/** Which rows and which band of columns a page carries: all the records for one band, then the next band. */
export function pageParts(layout: PageLayout, page: number): { band: PageBand; bandIndex: number; first: number; last: number } {
  const bandIndex = Math.floor(page / layout.blockCount);
  const first = (page % layout.blockCount) * layout.perPage;
  return { band: layout.bands[bandIndex], bandIndex, first, last: Math.min(layout.lineCount, first + layout.perPage) };
}

/** "Page 3 of 12", with the column part when the columns take more than one sheet across. */
export function pageLabel(layout: PageLayout, page: number): string {
  const text = `Page ${page + 1} of ${layout.pageCount}`;
  return layout.bands.length > 1 ? `${text}  (columns ${Math.floor(page / layout.blockCount) + 1}/${layout.bands.length})` : text;
}

export function pdf(table: ExportTable, options: PdfOptions): Uint8Array {
  const layout = pageLayout(table, options);
  const { pageWidth, pageHeight, margin, usable, size, rowHeight, pad, headHeight, topLines, topHeight, bodyTop, withTotals, lineCount, pageCount } = layout;
  const headSize = size;
  const pages: string[] = [];
  for (let page = 0; page < pageCount; page += 1) {
    const ops: string[] = [];
    const { band, first, last: lastLine } = pageParts(layout, page);
    const { widths, xs, tableWidth, heads } = band;
    const text = (value: string, x: number, y: number, fontSize: number, bold = false) => {
      ops.push(`BT /${bold ? "F2" : "F1"} ${num(fontSize)} Tf ${num(x)} ${num(y)} Td (${escapePdf(value)}) Tj ET`);
    };
    const place = (value: string, column: ExportColumn, index: number, y: number, bold: boolean) => {
      const shown = fit(winAnsi(value), widths[index] - pad * 2, size, bold);
      const width = textWidth(shown, size, bold);
      const x = column.align === "right" ? xs[index] + widths[index] - pad - width : column.align === "center" ? xs[index] + (widths[index] - width) / 2 : xs[index] + pad;
      text(shown, x, y, size, bold);
    };

    // Heading block: company; then the title with the group at the right end of the same line
    let y = pageHeight - margin - 11;
    const right = winAnsi(table.titleRight ?? "");
    const rightWidth = right ? textWidth(right, 10, true) : 0;
    topLines.forEach((line, index) => {
      const fontSize = index === 0 ? 12 : index === 1 ? 10 : 8;
      const room = index === 1 && right ? usable - rightWidth - 12 : usable;
      text(fit(winAnsi(line), room, fontSize, index < 2), margin, y, fontSize, index < 2);
      if (index === 1 && right) text(right, pageWidth - margin - rightWidth, y, 10, true);
      y -= index === 0 ? 15 : index === 1 ? 13 : 11;
    });

    // Column headings
    const headTop = pageHeight - margin - topHeight;
    ops.push(`0.725 0.843 0.969 rg ${num(margin)} ${num(headTop - headHeight)} ${num(tableWidth)} ${num(headHeight)} re f`);
    heads.forEach((lines, index) => {
      lines.forEach((line, at) => {
        const width = textWidth(line, headSize, true);
        const x = xs[index] + Math.max(pad, (widths[index] - width) / 2);
        ops.push("0.043 0.173 0.341 rg");
        text(line, x, headTop - 3 - headSize - at * headSize * 1.2, headSize, true);
      });
    });
    ops.push("0 g");

    // Rows (and, on the last block of rows, the totals)
    let rowY = bodyTop;
    for (let line = first; line < lastLine; line += 1) {
      const isTotal = withTotals && line === table.rows.length;
      if (isTotal) ops.push(`1 0.949 0.8 rg ${num(margin)} ${num(rowY - rowHeight)} ${num(tableWidth)} ${num(rowHeight)} re f 0 g`);
      else if (line % 2 === 1) ops.push(`0.89 0.933 0.984 rg ${num(margin)} ${num(rowY - rowHeight)} ${num(tableWidth)} ${num(rowHeight)} re f 0 g`);
      const baseline = rowY - rowHeight + (rowHeight - size) / 2 + size * 0.22;
      band.columns.forEach((source, index) => {
        const column = table.columns[source];
        if (isTotal) {
          const total = table.totals?.[source];
          if (total !== null && total !== undefined) place(cellText(total, column), { ...column, align: "right" }, index, baseline, true);
          else if (index === band.labelAt) place("Total", { ...column, align: "left" }, index, baseline, true);
          return;
        }
        place(cellText(table.rows[line][source] ?? null, column), column, index, baseline, false);
      });
      rowY -= rowHeight;
    }

    // Grid lines
    ops.push("0.62 0.71 0.83 RG 0.4 w");
    const gridBottom = rowY;
    ops.push(`${num(margin)} ${num(headTop)} ${num(tableWidth)} ${num(gridBottom - headTop)} re S`);
    ops.push(`${num(margin)} ${num(headTop - headHeight)} m ${num(margin + tableWidth)} ${num(headTop - headHeight)} l S`);
    for (let index = 1; index < xs.length; index += 1) ops.push(`${num(xs[index])} ${num(headTop)} m ${num(xs[index])} ${num(gridBottom)} l S`);
    if (withTotals && lastLine === lineCount) ops.push(`0.8 w ${num(margin)} ${num(gridBottom + rowHeight)} m ${num(margin + tableWidth)} ${num(gridBottom + rowHeight)} l S`);

    // Footer
    ops.push("0.3 g");
    text(fit(winAnsi(options.footer), usable * 0.38, 7, false), margin, margin, 7);
    if (table.footerCenter) {
      const middle = fit(winAnsi(table.footerCenter), usable * 0.3, 7, false);
      text(middle, (pageWidth - textWidth(middle, 7, false)) / 2, margin, 7);
    }
    const pageText = pageLabel(layout, page);
    text(pageText, pageWidth - margin - textWidth(pageText, 7, false), margin, 7);
    pages.push(ops.join("\n"));
  }

  // Assemble: catalog, page tree, two fonts, then a page and its content per page, and the info.
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, index) => {
    const id = pageIds[index];
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  const infoId = objects.length;
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  objects[infoId] = `<< /Title (${escapePdf(`${table.company} - ${table.title}`)}) /Producer (SMARTwinFA Web) /CreationDate (D:${stamp}) >>`;

  let body = "%PDF-1.4\n%" + String.fromCharCode(226, 227, 207, 211) + "\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(body.length);
  for (let index = 0; index < body.length; index += 1) bytes[index] = body.charCodeAt(index) & 0xff;
  return bytes;
}
