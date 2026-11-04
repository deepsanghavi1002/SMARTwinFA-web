import { printHtmlDocument } from "../grid/printFrame";
import { PATIYA_LOGO } from "./patiyaLogo";

/**
 * 150: PATIYA's Print (the desktop fills smart_system.document_body with doc_type PATIYA and opens two reports at once): the Dispatch Slip,
 * a block for each voucher with its product lines, and the Dispatch Loading Slip, the products of all of them added up. Both go to the printer
 * as one document, the loading slip on a page of its own.
 *
 * The lines are those the grid shows with a date and a name. A product's Ctn counts only on the first line of a party's same mould code
 * (the later ones are set to 0, as the desktop's rank update does).
 */

type Cells = Readonly<Record<string, string>>;
type Line = { voucher: string; party: string; transport: string; area: string; load: string; description: string; ctn: number; loose: number; qty: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const number = (text: string) => { const value = Number(text.replace(/,/g, "").trim()); return Number.isFinite(value) ? value : 0; };
/** A figure as the slip shows it: whole when whole, blank for nothing. */
const figure = (value: number) => (value === 0 ? "" : String(Math.round(value * 100) / 100));

/** A row's value by the column's name, in any case. */
function reader(row: Cells) {
  const byName = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
  return (name: string) => (byName.get(name.toLowerCase()) ?? "").trim();
}

export function patiyaLines(rows: readonly Cells[]): Line[] {
  const lines: Line[] = [];
  const seenMould = new Set<string>();
  for (const row of rows) {
    const get = reader(row);
    if (get("date") === "" || get("name") === "") continue;
    const mould = get("mouldcode");
    const party = get("name");
    let ctn = number(get("box"));
    if (mould !== "") {
      const key = `${party}\u0000${mould}`;
      if (seenMould.has(key)) ctn = 0;
      else seenMould.add(key);
    }
    lines.push({ voucher: get("full_docno"), party: `${party} ${get("city")}`.trim(), transport: get("transport"), area: get("area"), load: get("load"), description: get("description"), ctn, loose: number(get("loose")), qty: number(get("quantity")) });
  }
  return lines;
}

/**
 * The pages follow the desktop's PDFs on a Letter sheet: sizes are in `u`, a pixel of those PDFs drawn at 110 dpi, so the columns, rows and
 * heading sit where they do there. Text is Times 9 pt; the totals and the party lines are bold.
 */
const STYLE = `
@page { size: 8.5in 11in; margin: 0; }
:root { --u: calc(1in / 110); }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; font-family: "Times New Roman", Times, serif; font-size: 9pt; color: #000; }
.slip { box-sizing: border-box; width: 8.5in; height: 11in; padding: calc(33 * var(--u)) calc(60 * var(--u)) calc(60 * var(--u)) calc(28 * var(--u)); page-break-after: always; display: flex; flex-direction: column; overflow: hidden; }
.slip:last-child { page-break-after: auto; }
.company { margin: 0; text-align: right; height: calc(28 * var(--u)); }
.company img { width: calc(527 * var(--u)); height: calc(28 * var(--u)); margin-right: calc(4 * var(--u)); }
.title { margin: calc(17 * var(--u)) calc(7 * var(--u)) calc(2 * var(--u)) 0; text-align: right; font-weight: bold; font-size: 11.5pt; height: calc(14 * var(--u)); line-height: calc(14 * var(--u)); }
.head { display: grid; margin-top: calc(10 * var(--u)); height: calc(46 * var(--u)); align-content: start; }
.head b { font-weight: normal; line-height: calc(14 * var(--u)); white-space: nowrap; }
.head span { line-height: calc(14 * var(--u)); }
.head .values { padding-top: calc(13 * var(--u)); }
.head .line { height: calc(2 * var(--u)); margin-top: calc(28 * var(--u)); margin-right: calc(14 * var(--u)); border-bottom: calc(3 * var(--u)) dashed #000; }
.location { margin: calc(4 * var(--u)) 0 calc(2 * var(--u)); text-align: center; font-weight: bold; font-size: 11pt; height: calc(18 * var(--u)); line-height: calc(18 * var(--u)); }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: calc(6 * var(--u)); border: 1px dashed #aaa; }
th { font-weight: normal; height: calc(28 * var(--u)); padding: 0 calc(4 * var(--u)); text-align: left; border-bottom: 1px dashed #aaa; }
td { height: calc(21.4 * var(--u)); line-height: 1.05; padding: 0 calc(4 * var(--u)); vertical-align: middle; white-space: nowrap; overflow: hidden; }
th + th, td + td { border-left: 1px dashed #bbb; }
.r { text-align: right; }
.c { text-align: center; }
.vch td { height: calc(24 * var(--u)); padding-bottom: calc(4 * var(--u)); border-bottom: 1px dashed #aaa; }
.vch td:nth-child(2) { font-weight: bold; padding-left: calc(8 * var(--u)); }
.total td { height: calc(18 * var(--u)); font-weight: bold; border-top: 1px dashed #aaa; border-bottom: 1px dashed #aaa; }
.gap { flex: 1; }
table.final { border: 0; border-top: 1px dashed #aaa; border-bottom: 1px dashed #aaa; margin-bottom: 0; }
.final td { font-weight: bold; border: 0; height: calc(24 * var(--u)); }
.load { margin: calc(9 * var(--u)) 0 0; }
.load th { height: calc(48 * var(--u)); }
.load th, .load td { border-left: 0; }
.load td { height: calc(17.4 * var(--u)); line-height: 1; }
.load td { border-bottom: 1px dashed #aaa; }
.load th:nth-child(1), .load td:nth-child(1) { border-right: 1px dashed #aaa; }
.load th:nth-child(3), .load td:nth-child(3) { border-left: 1px dashed #aaa; }
.load .total td { height: calc(18 * var(--u)); border-bottom: 1px dashed #aaa; }
.load .total td:nth-child(3) { border-top: 1px dashed #aaa; border-bottom: 1px dashed #aaa; }
.load .total td:nth-child(1), .load .total td:nth-child(2) { border-top: 0; }
`;

/** The heading's labels over their values and the dashed boxes; `widths` are the grid's columns, the first at the table's left edge. */
function head(date: string, time: string, boxes: string[], widths: readonly number[]): string {
  const columns = [...widths.map((width) => `calc(${width} * var(--u))`), "1fr"].join(" ");
  return `<div class="head" style="grid-template-columns:${columns}">`
    + `<b>Date</b><b>Time</b>${boxes.map((name) => `<b>${name}</b>`).join("")}`
    + `<span class="values">${date}</span><span class="values">${time}</span>${boxes.map(() => `<span class="line"></span>`).join("")}</div>`;
}

const SLIP_COLUMNS = `<colgroup><col style="width:5.5%"><col style="width:37.2%"><col style="width:6.7%"><col style="width:6.3%"><col style="width:6.7%"><col style="width:4.8%"><col style="width:18.5%"><col style="width:9.4%"><col style="width:4.9%"></colgroup>`;

/** The Dispatch Slip: a block for each voucher, in the order the grid has them. */
function dispatchSlip(lines: readonly Line[], date: string, time: string, location: string): string {
  const blocks: Line[][] = [];
  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    if (last && last[0].voucher === line.voucher) last.push(line); else blocks.push([line]);
  }
  let item = 0;
  let sumCtn = 0;
  let sumLoose = 0;
  let sumQty = 0;
  const body = blocks.map((block, at) => {
    const ctn = block.reduce((sum, line) => sum + line.ctn, 0);
    const loose = block.reduce((sum, line) => sum + line.loose, 0);
    const qty = block.reduce((sum, line) => sum + line.qty, 0);
    sumCtn += ctn; sumLoose += loose; sumQty += qty;
    const first = block[0];
    const items = block.map((line) => { item += 1; return `<tr><td class="r">${item}</td><td>${escape(line.description)}</td><td></td><td class="r">${figure(line.ctn)}</td><td class="r">${figure(line.loose)}</td><td class="r">${figure(line.qty)}</td><td></td><td></td><td></td></tr>`; }).join("");
    return `<table>${SLIP_COLUMNS}`
      + `<thead><tr><th class="r">Sr.</th><th class="c">Product Description</th><th>Inv No.</th><th class="c">Ctn</th><th class="c">Loose</th><th class="c">Qty.</th><th>Transport</th><th>Area</th><th>Lod</th></tr></thead><tbody>`
      + `<tr class="vch"><td class="r">${at + 1}</td><td>${escape(first.party)}</td><td>${escape(first.voucher)}</td><td></td><td></td><td></td><td>${escape(first.transport || "None")}</td><td>${escape(first.area)}</td><td>${escape(first.load)}</td></tr>`
      + items
      + `<tr class="total"><td></td><td class="r">Total</td><td></td><td class="r">${figure(ctn)}</td><td class="r">${figure(loose)}</td><td class="r">${figure(qty)}</td><td></td><td></td><td></td></tr></tbody></table>`;
  }).join("");
  return `<section class="slip"><p class="company"><img src="${PATIYA_LOGO}" alt=""></p><p class="title">DISPATCH SLIP</p>${head(date, time, ["Vehicle No", "No Of Delivery", "Remove Time", "Head", "Superviser"], [98, 110, 170, 106, 102, 114])}`
    + `<p class="location">Location : ${escape(location)}</p>${body}<div class="gap"></div>`
    + `<table class="final">${SLIP_COLUMNS}<tbody><tr><td></td><td class="r">Final Total</td><td></td><td class="r">${figure(sumCtn)}</td><td class="r">${figure(sumLoose)}</td><td class="r">${figure(sumQty)}</td><td colspan="3"></td></tr></tbody></table></section>`;
}

/** The Dispatch Loading Slip: each product once, its quantity added up over every line, in product order. */
function loadingSlip(lines: readonly Line[], date: string, time: string): string {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.description, (totals.get(line.description) ?? 0) + line.qty);
  const products = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const sum = products.reduce((total, [, qty]) => total + qty, 0);
  const rows = products.map(([name, qty], at) => `<tr><td class="r">${at + 1}</td><td>${escape(name)}</td><td class="r"><b>${figure(qty)}</b></td></tr>`).join("");
  const columns = `<colgroup><col style="width:5.7%"><col style="width:79.2%"><col style="width:15.1%"></colgroup>`;
  return `<section class="slip"><p class="company"><img src="${PATIYA_LOGO}" alt=""></p><p class="title">DISPATCH LOADING SLIP</p>${head(date, time, ["Start Time", "End Time", "Head", "Superviser"], [98, 110, 92, 286, 112])}`
    + `<table class="load">${columns}<thead><tr><th>Sr.</th><th class="c">Product Description</th><th class="c">Ctn</th></tr></thead><tbody>${rows}`
    + `<tr class="total"><td></td><td class="r">Total</td><td class="r">${figure(sum)}</td></tr></tbody></table>`
    + `<div class="gap"></div><table class="final">${columns}<tbody><tr><td></td><td class="r">Final Total</td><td class="r">${figure(sum)}</td></tr></tbody></table></section>`;
}

/** Print on Patiya: both slips in one print job. Returns false when no line has a date and a name. */
export function printPatiya(rows: readonly Cells[]): boolean {
  const lines = patiyaLines(rows);
  if (lines.length === 0) return false;
  const now = new Date();
  const date = `${pad(now.getDate())}/${MONTHS[now.getMonth()]}/${now.getFullYear()}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const locations = new Set(rows.map((row) => reader(row)("location")).filter((text) => text !== ""));
  const location = locations.size === 1 ? [...locations][0] : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Patiya</title><style>${STYLE}</style></head><body>${dispatchSlip(lines, date, time, location)}${loadingSlip(lines, date, time)}</body></html>`;
  printHtmlDocument(html);
  return true;
}
