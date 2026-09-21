import { fit, pageLayout } from "./pdf.ts";
import type { PageLayout, PdfOptions } from "./pdf.ts";
import { cellText } from "./table.ts";
import type { ExportTable } from "./table.ts";

/**
 * The print preview's pages as HTML, laid out in points from the same layout the PDF uses,
 * so what is seen on screen, what is printed and what is saved as PDF break at the same rows.
 * One renderer serves both the preview (a page at a time) and printing (all pages).
 */

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pt = (value: number) => `${Math.round(value * 100) / 100}pt`;

/** A search inside the preview: the text looked for, and the line (row index) of the current hit. */
export type PreviewSearch = Readonly<{ needle: string; currentLine: number }>;

export type PreviewPages = Readonly<{
  layout: PageLayout;
  pageCount: number;
  page: (index: number, search?: PreviewSearch) => string;
  /** Rows (line numbers) whose shown text contains the needle, in page order. */
  find: (needle: string) => number[];
  /** The page a row falls on. */
  pageOf: (line: number) => number;
}>;

/** Escaped text with every occurrence of the needle wrapped in <mark>. */
function marked(text: string, needle: string): string {
  if (!needle) return escape(text);
  const lower = text.toLowerCase();
  let out = "";
  let at = 0;
  for (let hit = lower.indexOf(needle); hit >= 0; hit = lower.indexOf(needle, hit + needle.length)) {
    out += `${escape(text.slice(at, hit))}<mark class="pv-hit">${escape(text.slice(hit, hit + needle.length))}</mark>`;
    at = hit + needle.length;
  }
  return out + escape(text.slice(at));
}

export function previewPages(table: ExportTable, options: PdfOptions): PreviewPages {
  const layout = pageLayout(table, options);
  const { pageWidth, pageHeight, margin, usable, widths, tableWidth, size, rowHeight, pad, heads, headHeight, topLines, topHeight, withTotals, labelColumn, lineCount, perPage, pageCount } = layout;
  const colgroup = `<colgroup>${widths.map((width) => `<col style="width:${pt(width)}">`).join("")}</colgroup>`;
  const head = `<thead><tr style="height:${pt(headHeight)}">${heads.map((lines) => `<th style="font-size:${pt(size)}">${lines.map(escape).join("<br>")}</th>`).join("")}</tr></thead>`;
  const alignClass = (align: string) => (align === "right" ? ' class="pv-r"' : align === "center" ? ' class="pv-c"' : "");

  const page = (index: number, search?: PreviewSearch): string => {
    const needle = search?.needle.trim().toLowerCase() ?? "";
    const lines: string[] = [];
    let top = margin;
    topLines.forEach((line, at) => {
      const fontSize = at === 0 ? 12 : at === 1 ? 10 : 8;
      lines.push(`<div class="pv-line${at < 2 ? " pv-bold" : ""}" style="left:${pt(margin)};top:${pt(top)};font-size:${pt(fontSize)};max-width:${pt(at === 1 && table.titleRight ? usable * 0.62 : usable)}">${escape(line)}</div>`);
      if (at === 1 && table.titleRight) lines.push(`<div class="pv-line pv-bold" style="right:${pt(margin)};top:${pt(top)};font-size:${pt(10)};max-width:${pt(usable * 0.36)}">${escape(table.titleRight)}</div>`);
      top += at === 0 ? 15 : at === 1 ? 13 : 11;
    });
    const first = index * perPage;
    const last = Math.min(lineCount, first + perPage);
    const rows: string[] = [];
    for (let line = first; line < last; line += 1) {
      const isTotal = withTotals && line === table.rows.length;
      const cells = table.columns.map((column, at) => {
        const room = widths[at] - pad * 2;
        if (isTotal) {
          const total = table.totals?.[at];
          if (total !== null && total !== undefined) return `<td class="pv-r">${escape(fit(cellText(total, column), room, size, true))}</td>`;
          return at === labelColumn ? "<td>Total</td>" : "<td></td>";
        }
        return `<td${alignClass(column.align)}>${marked(fit(cellText(table.rows[line][at] ?? null, column), room, size, false), needle)}</td>`;
      }).join("");
      const classes = [isTotal ? "pv-total" : line % 2 === 1 ? "pv-alt" : "", search && line === search.currentLine ? "pv-hit-row" : ""].filter(Boolean).join(" ");
      rows.push(`<tr style="height:${pt(rowHeight)}"${classes ? ` class="${classes}"` : ""} data-line="${line}">${cells}</tr>`);
    }
    const tableHtml = `<table class="pv-table" style="left:${pt(margin)};top:${pt(margin + topHeight)};width:${pt(tableWidth)};font-size:${pt(size)}">${colgroup}${head}<tbody>${rows.join("")}</tbody></table>`;
    const footerTop = pageHeight - margin - 7;
    const middle = table.footerCenter ? `<div class="pv-foot pv-foot-center" style="top:${pt(footerTop)};width:${pt(usable * 0.3)};left:${pt((pageWidth - usable * 0.3) / 2)}">${escape(table.footerCenter)}</div>` : "";
    const footer = `<div class="pv-foot" style="left:${pt(margin)};top:${pt(footerTop)};max-width:${pt(usable * 0.38)}">${escape(options.footer)}</div>${middle}<div class="pv-foot" style="right:${pt(margin)};top:${pt(footerTop)}">Page ${index + 1} of ${pageCount}</div>`;
    return `<section class="pv-page" style="width:${pt(pageWidth)};height:${pt(pageHeight)}">${lines.join("")}${tableHtml}${footer}</section>`;
  };

  const find = (raw: string): number[] => {
    const needle = raw.trim().toLowerCase();
    if (!needle) return [];
    const hits: number[] = [];
    table.rows.forEach((row, line) => {
      if (table.columns.some((column, at) => cellText(row[at] ?? null, column).toLowerCase().includes(needle))) hits.push(line);
    });
    return hits;
  };
  return { layout, pageCount, page, find, pageOf: (line) => Math.floor(line / perPage) };
}

/** The pages' look; the same rules are used on screen and when printing. */
export const PAGE_CSS = `
.pv-page{position:relative;flex:none;overflow:hidden;background:#fff;color:#000;font-family:Helvetica,Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.45)}
.pv-line{position:absolute;white-space:nowrap;overflow:hidden}
.pv-bold{font-weight:bold}
.pv-table{position:absolute;border-collapse:collapse;table-layout:fixed;line-height:1}
.pv-table th{padding:0 2.5pt;border:0.4pt solid #9eb5d4;background:#b9d7f7;color:#0b2c57;font-weight:bold;text-align:center;line-height:1.2;overflow:hidden}
.pv-table td{padding:0 2.5pt;border-left:0.4pt solid #9eb5d4;border-right:0.4pt solid #9eb5d4;white-space:nowrap;overflow:hidden}
.pv-table tbody tr:last-child td{border-bottom:0.4pt solid #9eb5d4}
.pv-table .pv-alt td{background:#e3eefb}
.pv-table .pv-total td{background:#fff2cc;font-weight:bold;border-top:0.8pt solid #9eb5d4}
.pv-r{text-align:right}
.pv-c{text-align:center}
.pv-foot{position:absolute;font-size:7pt;color:#4d4d4d;white-space:nowrap;overflow:hidden}
.pv-foot-center{text-align:center}
.pv-hit{background:#ffe066;color:#000;padding:0}
.pv-table tr.pv-hit-row td{background:#ffd76a;outline:0.8pt solid #e0a000}
`;

/** A whole document of every page, for printing: one sheet of paper per page, no margins added. */
export function printDocument(title: string, pages: PreviewPages, orientation: PdfOptions["orientation"]): string {
  const { pageHeight } = pages.layout;
  const all = Array.from({ length: pages.pageCount }, (_, index) => pages.page(index))
    .join("")
    .replace(new RegExp(`height:${pt(pageHeight)}`, "g"), `height:${pt(pageHeight - 4)}`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>${PAGE_CSS}
@page{size:A4 ${orientation};margin:0}
html,body{margin:0;padding:0;background:#fff}
.pv-page{box-shadow:none;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid}
.pv-page:last-child{break-after:auto;page-break-after:auto}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
</style></head><body>${all}</body></html>`;
}
