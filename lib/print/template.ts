/**
 * A print format as data (the web's Crystal-style report): a page of elements placed by position, each a text (with {{fields}} filled from the document),
 * a line or an image, plus repeaters (the item rows, the add / less lines) whose cells are elements placed relative to their row. One engine draws any
 * template; the Print Format Designer edits the template and a company keeps its own in smart_system.print_template.
 *
 * Positions are in "units": pixels of the sample printout at 110 dpi (1 unit = 0.6545 pt), the page is 909 x 1286 units (A4).
 */

export type Align = "l" | "r" | "c";
export type Show = "all" | "last";

export type El = {
  id: string;
  kind: "text" | "hline" | "vline" | "image";
  x: number;
  y: number;
  /** Text: the width of a right / centred / wrapping text; a horizontal line's length; an image's width. */
  w?: number;
  /** A vertical line's length; an image's height; a wrapping text's height. */
  h?: number;
  /** Text with {{field}} places (inside a repeater cell a field is the row's, else the document's). New lines are kept. */
  text?: string;
  /** An image's address ("/path.png" or a {{field}} that holds one). */
  src?: string;
  bold?: boolean;
  /** The colour of a text, or of a line (#rrggbb); black / grey when not set. */
  color?: string;
  /** Font size in points. */
  size?: number;
  align?: Align;
  wrap?: boolean;
  /** "last": only on the last sheet. */
  show?: Show;
  /** The repeater this element is a cell of (its y is then relative to the row, or to the band's own top). */
  in?: string;
  /** Inside a repeater: a row of the list (default), the heading before a group's rows, or the footing after them (a group is a run of rows with the same groupBy value). */
  band?: "row" | "groupHeader" | "groupFooter";
  hidden?: boolean;
};

export type Repeater = {
  name: string;
  /** The list of the document the rows come from (lines, slabs, taxes, hsn ...). */
  source: string;
  /** The top of the first row, and the distance between rows; or the top of each row (ys). */
  y: number;
  pitch: number;
  ys?: number[];
  show?: Show;
  /** The repeater whose rows make the sheets (a sheet takes rowsPerPage of its rows and bands). */
  paginate?: boolean;
  /** Rows with the same value of this field are a group: a heading band before, a footing band after. */
  groupBy?: string;
  headerPitch?: number;
  footerPitch?: number;
  /** Rows where this field is blank or nil are left out. */
  skipBlank?: string;
};

/** A figure worked out from a list: a sum / count / ... that {{name}} shows, in a group's footing, on a sheet or over the whole report; or a running sum down the rows. */
export type Total = {
  name: string;
  op: "sum" | "count" | "running" | "min" | "max" | "avg";
  field: string;
  list: string;
  /** Where it starts again: with each group, each sheet, or never. */
  reset: "report" | "group" | "page";
  decimals?: number;
};

export type Template = {
  version: 2;
  /** Rows of the "lines" list on a sheet. */
  rowsPerPage: number;
  repeaters: Repeater[];
  totals?: Total[];
  elements: El[];
  /** A format a company made itself: its name, and the built-in format whose fields, sample and data it uses. */
  meta?: { name: string; base: string };
};

/** What a template is filled from: single values by name, and the lists the repeaters read. */
export type Row = Readonly<Record<string, string>>;
export type Doc = Readonly<{ values: Readonly<Record<string, string>>; lists: Readonly<Record<string, readonly Row[]>> }>;

export const UNIT = 0.6545; // points
export const PAGE_UNITS = { width: 909, height: 1286 };

/** A resolved element of one sheet. */
export type Box = {
  id: string;
  kind: El["kind"];
  x: number; y: number; w?: number; h?: number;
  text: string; src: string;
  bold: boolean; color?: string; size?: number; align: Align; wrap: boolean;
  hidden: boolean;
  /** A row after the first of a repeater: shown, but not an element of its own. */
  ghost: boolean;
  repeater?: string;
};

const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10) / 10 : fallback);
const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const SRC = /^(\/[A-Za-z0-9_./-]{1,200}|\{\{[\w.]+\}\}|data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=]{1,700000})$/;

/** A template from stored or sent JSON: only the known kinds, fields and sizes are kept. Throws when it is not a template. */
export function cleanTemplate(value: unknown): Template {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The template is not valid");
  const source = value as Record<string, unknown>;
  // (a template of the first version used other field names: it is not read, the format's default is used instead)
  if (source.version !== 2) throw new Error("This template is of an older version; design it again from the default");
  const field = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_.]{1,60}$/.test(v) ? v : undefined);
  const repeaters: Repeater[] = (Array.isArray(source.repeaters) ? source.repeaters : []).slice(0, 10).flatMap((item): Repeater[] => {
    const r = (item ?? {}) as Record<string, unknown>;
    // (older templates named the two lists "lines" and "addLess": the same names are kept for them)
    if (!ID.test(String(r.name ?? "")) || !field(r.source)) return [];
    const out: Repeater = { name: String(r.name), source: String(r.source), y: num(r.y), pitch: num(r.pitch, 30) };
    if (Array.isArray(r.ys)) out.ys = r.ys.slice(0, 80).map((y) => num(y));
    if (r.show === "last") out.show = "last";
    if (r.paginate === true) out.paginate = true;
    if (field(r.groupBy)) out.groupBy = field(r.groupBy);
    if (r.headerPitch !== undefined) out.headerPitch = num(r.headerPitch, out.pitch);
    if (r.footerPitch !== undefined) out.footerPitch = num(r.footerPitch, out.pitch);
    if (field(r.skipBlank)) out.skipBlank = field(r.skipBlank);
    return [out];
  });
  if (repeaters.length > 0 && !repeaters.some((r) => r.paginate)) { const first = repeaters.find((r) => r.source === "lines") ?? repeaters[0]; first.paginate = true; }
  const totals: Total[] = (Array.isArray(source.totals) ? source.totals : []).slice(0, 40).flatMap((item): Total[] => {
    const t = (item ?? {}) as Record<string, unknown>;
    if (!ID.test(String(t.name ?? "")) || !["sum", "count", "running", "min", "max", "avg"].includes(String(t.op)) || !field(t.field) || !field(t.list)) return [];
    return [{ name: String(t.name), op: t.op as Total["op"], field: String(t.field), list: String(t.list), reset: t.reset === "group" || t.reset === "page" ? t.reset : "report", decimals: Math.min(6, Math.max(0, Math.trunc(num(t.decimals, 2)))) }];
  });
  const seen = new Set<string>();
  const elements: El[] = (Array.isArray(source.elements) ? source.elements : []).slice(0, 800).flatMap((item): El[] => {
    const e = (item ?? {}) as Record<string, unknown>;
    const id = String(e.id ?? "");
    if (!ID.test(id) || seen.has(id) || !["text", "hline", "vline", "image"].includes(String(e.kind))) return [];
    seen.add(id);
    const out: El = { id, kind: e.kind as El["kind"], x: num(e.x), y: num(e.y) };
    if (e.w !== undefined) out.w = num(e.w);
    if (e.h !== undefined) out.h = num(e.h);
    if (e.kind === "text") out.text = str(e.text, 2000);
    if (e.kind === "image") { const src = str(e.src, 700100); if (!SRC.test(src)) return []; out.src = src; }
    if (e.bold === true) out.bold = true;
    if (typeof e.color === "string" && /^#[0-9a-fA-F]{6}$/.test(e.color)) out.color = e.color.toLowerCase();
    if (e.size !== undefined) out.size = Math.min(40, Math.max(4, num(e.size, 7.4)));
    if (e.align === "r" || e.align === "c") out.align = e.align;
    if (e.wrap === true) out.wrap = true;
    if (e.show === "last") out.show = "last";
    if (typeof e.in === "string" && repeaters.some((r) => r.name === e.in)) { out.in = e.in; if (e.band === "groupHeader" || e.band === "groupFooter") out.band = e.band; }
    if (e.hidden === true) out.hidden = true;
    return [out];
  });
  const meta = source.meta && typeof source.meta === "object" ? source.meta as Record<string, unknown> : null;
  return { version: 2, rowsPerPage: Math.min(80, Math.max(1, Math.trunc(num(source.rowsPerPage, 6)))), repeaters, totals, elements, ...(meta && ID.test(String(meta.base ?? "")) && str(meta.name, 60).trim() !== "" ? { meta: { name: str(meta.name, 60).trim(), base: String(meta.base) } } : {}) };
}

const parse = (value: string | undefined): number => { if (value === undefined || value === "") return 0; const x = Number(String(value).replace(/[^0-9.+-]/g, "")); return Number.isFinite(x) ? x : 0; };

/** The slots a repeater fills: its rows, and with a group field the heading and footing around each run of equal values. */
type Slot = { kind: "row" | "groupHeader" | "groupFooter"; row: Row; group: readonly Row[]; indexInGroup: number };
function slotsOf(repeater: Repeater, doc: Doc): Slot[] {
  const raw = doc.lists[repeater.source] ?? [];
  const keep = (row: Row) => { const f = repeater.skipBlank as string; const v = (row[f] ?? "").trim(); return v !== "" && !(/^[-+]?[\d,]*\.?\d+$/.test(v) && parse(v) === 0); };
  const rows = repeater.skipBlank ? raw.filter(keep) : raw;
  if (!repeater.groupBy) return rows.map((row, at) => ({ kind: "row", row, group: rows, indexInGroup: at }));
  const slots: Slot[] = [];
  let at = 0;
  while (at < rows.length) {
    const key = rows[at][repeater.groupBy] ?? "";
    let end = at;
    while (end < rows.length && (rows[end][repeater.groupBy] ?? "") === key) end += 1;
    const group = rows.slice(at, end);
    slots.push({ kind: "groupHeader", row: group[0], group, indexInGroup: -1 });
    group.forEach((row, index) => slots.push({ kind: "row", row, group, indexInGroup: index }));
    slots.push({ kind: "groupFooter", row: group[group.length - 1], group, indexInGroup: group.length });
    at = end;
  }
  return slots;
}

/** The sheets the document takes: the paginating repeater's slots, rowsPerPage to a sheet. */
export function sheetCount(template: Template, doc: Doc): number {
  const main = template.repeaters.find((r) => r.paginate);
  return main ? Math.max(1, Math.ceil(slotsOf(main, doc).length / template.rowsPerPage)) : 1;
}

const FIELD = /\{\{\s*([\w.]+)\s*\}\}/g;
/** A text with its {{fields}} filled: a row's value first, then a worked-out total, then the document's. */
export function fill(text: string, values: Readonly<Record<string, string>>, row?: Readonly<Record<string, string>>, totals?: Readonly<Record<string, string>>): string {
  return text.replace(FIELD, (_, key: string) => (row && row[key] !== undefined ? row[key] : totals && totals[key] !== undefined ? totals[key] : values[key] ?? ""));
}

/** The elements of one sheet (0-based) with their text filled and the repeaters' rows laid out. */
export function resolveSheet(template: Template, doc: Doc, sheet: number, options: { designer?: boolean } = {}): Box[] {
  const sheets = sheetCount(template, doc);
  const last = sheet === sheets - 1;
  const values = { ...doc.values, page: String(sheet + 1), pages: String(sheets) };
  const boxes: Box[] = [];
  const slotsByRepeater = new Map(template.repeaters.map((r) => [r.name, slotsOf(r, doc)] as const));
  const main = template.repeaters.find((r) => r.paginate);
  const pageSlots = (r: Repeater): Slot[] => { const all = slotsByRepeater.get(r.name) ?? []; return r.paginate ? all.slice(sheet * template.rowsPerPage, (sheet + 1) * template.rowsPerPage) : all; };

  /** The rows a total covers: the list's rows of the group, the sheet or the report; and (for a running total) up to the given row. */
  const rowsOfList = (list: string, scope: Total["reset"], context: { group?: readonly Row[]; upTo?: Row }): Row[] => {
    let rows: readonly Row[] = doc.lists[list] ?? [];
    if (scope === "group" && context.group && context.group.some((row) => rows.includes(row))) rows = context.group.filter((row) => rows.includes(row));
    else if (scope === "page" && main && main.source === list) rows = pageSlots(main).filter((slot) => slot.kind === "row").map((slot) => slot.row);
    if (context.upTo) { const at = rows.indexOf(context.upTo); if (at >= 0) rows = rows.slice(0, at + 1); }
    return [...rows];
  };
  const totalsFor = (context: { group?: readonly Row[]; row?: Row }): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const total of template.totals ?? []) {
      const rows = rowsOfList(total.list, total.reset, { group: context.group, upTo: total.op === "running" ? context.row : undefined });
      const numbers = rows.map((row) => parse(row[total.field]));
      const value = total.op === "count" ? rows.length : numbers.length === 0 ? 0
        : total.op === "min" ? Math.min(...numbers) : total.op === "max" ? Math.max(...numbers)
          : total.op === "avg" ? numbers.reduce((sum, x) => sum + x, 0) / numbers.length : numbers.reduce((sum, x) => sum + x, 0);
      out[total.name] = total.op === "count" ? String(value) : value.toFixed(total.decimals ?? 2);
    }
    return out;
  };

  const base = (e: El, at: { x: number; y: number }, row?: Row, ghost = false, repeater?: string, totals?: Record<string, string>): Box => ({
    id: e.id, kind: e.kind, x: at.x, y: at.y, w: e.w, h: e.h,
    text: e.kind === "text" ? fill(e.text ?? "", values, row, totals) : "", src: e.kind === "image" ? fill(e.src ?? "", values, row, totals) : "",
    bold: e.bold === true, color: e.color, size: e.size, align: e.align ?? "l", wrap: e.wrap === true, hidden: e.hidden === true, ghost, repeater,
  });
  const reportTotals = totalsFor({});
  for (const e of template.elements) {
    if (e.show === "last" && !last) continue;
    if (!e.in) { boxes.push(base(e, e, undefined, false, undefined, reportTotals)); continue; }
    const repeater = template.repeaters.find((r) => r.name === e.in);
    if (!repeater || (repeater.show === "last" && !last)) continue;
    const band = e.band ?? "row";
    const slots = pageSlots(repeater);
    let top = repeater.y;
    let first = true;
    slots.forEach((slot, at) => {
      const place = repeater.ys?.[at] ?? top;
      top += slot.kind === "groupHeader" ? repeater.headerPitch ?? repeater.pitch : slot.kind === "groupFooter" ? repeater.footerPitch ?? repeater.pitch : repeater.pitch;
      if (slot.kind !== band) return;
      const totals = totalsFor({ group: slot.group, row: slot.row });
      boxes.push(base(e, { x: e.x, y: place + e.y }, slot.row, !first, repeater.name, totals));
      first = false;
    });
    // The designer needs the first row of each band: an empty one is drawn when the sheet has none to show.
    if (first && options.designer) boxes.push(base(e, { x: e.x, y: repeater.y + e.y }, {}, false, repeater.name, reportTotals));
  }
  return boxes;
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pt = (units: number) => `${Math.round(units * UNIT * 100) / 100}pt`;

export const SHEET_CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#e9eef2;font-family:"Times New Roman",Times,serif;color:#000}
.rp-page{position:relative;width:595pt;height:842pt;margin:8pt auto;background:#fff;overflow:hidden;page-break-after:always;break-after:page}
.rp-page *{position:absolute}
.rp-page .ln{background:#8a8a8a}
.rp-page .t{font-size:7.4pt;line-height:1.25;white-space:pre}
.rp-page .b{font-weight:700}
.rp-page .w{white-space:pre-wrap}
.rp-page .r{text-align:right}.rp-page .c{text-align:center}
@media print{body{background:#fff}.rp-page{margin:0}}
`;

/** One box as HTML (the printed page). */
export function boxHtml(box: Box): string {
  const at = `left:${pt(box.x)};top:${pt(box.y)};`;
  if (box.kind === "hline") return `<i class="ln" style="${at}width:${pt(box.w ?? 100)};height:1.2pt${box.color ? `;background:${box.color}` : ""}"></i>`;
  if (box.kind === "vline") return `<i class="ln" style="${at}width:1.2pt;height:${pt(box.h ?? 100)}${box.color ? `;background:${box.color}` : ""}"></i>`;
  if (box.kind === "image") return box.src === "" ? "" : `<img src="${esc(box.src)}" alt="" style="${at}width:${pt(box.w ?? 100)};height:${pt(box.h ?? 100)}">`;
  if (box.text.trim() === "") return "";
  const cls = ["t", box.bold ? "b" : "", box.align === "r" ? "r" : box.align === "c" ? "c" : "", box.wrap ? "w" : ""].filter(Boolean).join(" ");
  return `<span class="${cls}" style="${at}${box.w ? `width:${pt(box.w)};` : ""}${box.wrap && box.h ? `height:${pt(box.h)};` : ""}${box.size ? `font-size:${box.size}pt;` : ""}${box.color ? `color:${box.color};` : ""}">${esc(box.text)}</span>`;
}

/** The document as printable HTML: a sheet for each RISHABH-style page of item rows. */
export function renderTemplate(template: Template, doc: Doc, title = ""): string {
  const sheets = sheetCount(template, doc);
  const pages = Array.from({ length: sheets }, (_, sheet) => `<section class="rp-page">${resolveSheet(template, doc, sheet).filter((box) => !box.hidden).map(boxHtml).join("")}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${SHEET_CSS}</style></head><body>${pages}</body></html>`;
}
