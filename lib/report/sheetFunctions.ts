import type { Value } from "./sheetFormula";

/**
 * The functions of Add Column that work on plain values (one value in, one value out): more maths, the logical ones, text and dates.
 * The ones that read whole columns (SUMIFS, XLOOKUP, LARGE...) are in sheetFormula.ts, which has the columns.
 * A date is a cell's text (01/04/2026, 01-Apr-2026, 2026-04-01) or an Excel serial number; date functions give dd/MM/yyyy text, and two
 * dates subtracted give the days between them, as in Excel.
 */

const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";
const ERR_NA = "#N/A";
const ERR_NUM = "#NUM!";
const isErr = (value: Value) => typeof value === "string" && /^#(DIV[/]0!|VALUE!|N[/]A|NUM!|REF!)$/.test(value);

export function numberOf(value: Value): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") { const n = Number(value.replace(/,/g, "").trim()); return value.trim() !== "" && Number.isFinite(n) ? n : null; }
  return null;
}
const truthy = (value: Value) => { const n = numberOf(value); return n !== null ? n !== 0 : String(value ?? "") !== ""; };
const text = (value: Value) => (value === null ? "" : String(value));

// ---- dates ------------------------------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_MS = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);

const make = (y: number, m: number, d: number): Date | null => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
};

/** The date a cell or number stands for (UTC midnight), or null. */
export function dateOf(value: Value): Date | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 1 && value < 2958466 ? new Date(EPOCH + Math.floor(value) * DAY_MS) : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (iso) return make(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const match = /^(\d{1,2})[/\-. ]+([A-Za-z]{3,9}|\d{1,2})[/\-. ,]+(\d{2,4})(?:\s+\d{1,2}:\d{2}.*)?$/.exec(s);
  if (!match) return null;
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : MONTHS.findIndex((name) => name.startsWith(match[2].toLowerCase()) && match[2].length >= 3) + 1;
  if (month < 1) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return make(year, month, Number(match[1]));
}
export const serialOf = (date: Date) => Math.round((date.getTime() - EPOCH) / DAY_MS);
const p2 = (n: number) => String(n).padStart(2, "0");
export const fmtDate = (date: Date) => `${p2(date.getUTCDate())}/${p2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
/** A text that is a date and not a number: what makes two cells subtract into days. */
export const isDateText = (value: Value) => typeof value === "string" && numberOf(value) === null && dateOf(value) !== null;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const shiftMonths = (date: Date, months: number) => {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const y = Math.floor(total / 12), m = (total % 12 + 12) % 12 + 1;
  return new Date(Date.UTC(y, m - 1, Math.min(date.getUTCDate(), daysIn(y, m))));
};

function datedif(a: Date, b: Date, unit: string): Value {
  if (a.getTime() > b.getTime()) return ERR_NUM;
  const [y1, m1, d1, y2, m2, d2] = [a.getUTCFullYear(), a.getUTCMonth() + 1, a.getUTCDate(), b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate()];
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  switch (unit) {
    case "D": return Math.round((b.getTime() - a.getTime()) / DAY_MS);
    case "M": return months;
    case "Y": return Math.floor(months / 12);
    case "YM": return months % 12;
    case "MD": return d2 >= d1 ? d2 - d1 : daysIn(m2 === 1 ? y2 - 1 : y2, m2 === 1 ? 12 : m2 - 1) + d2 - d1;
    case "YD": {
      const same = make(y2, m1, Math.min(d1, daysIn(y2, m1))) as Date;
      const from = same.getTime() > b.getTime() ? new Date(Date.UTC(y2 - 1, m1 - 1, Math.min(d1, daysIn(y2 - 1, m1)))) : same;
      return Math.round((b.getTime() - from.getTime()) / DAY_MS);
    }
  }
  return ERR_NUM;
}

function networkDays(a: Date, b: Date): number {
  const forward = a.getTime() <= b.getTime();
  const [from, to] = forward ? [a, b] : [b, a];
  let count = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) { const day = new Date(t).getUTCDay(); if (day !== 0 && day !== 6) count += 1; }
  return forward ? count : -count;
}

// ---- TEXT(value, "format") -------------------------------------------------------------------------

function formatNumber(x: number, format: string): string {
  const percent = format.includes("%");
  const value = percent ? x * 100 : x;
  const core = /[#0][#0,]*(\.[#0]+)?/.exec(format);
  if (!core) return format.replace(/"/g, "");
  const [pattern] = core;
  const decimals = pattern.includes(".") ? pattern.length - pattern.indexOf(".") - 1 : 0;
  const integerPart = pattern.split(".")[0];
  const minimum = (integerPart.match(/0/g) ?? []).length;
  const grouped = integerPart.includes(",");
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split(".");
  let digits = whole.length < minimum ? whole.padStart(minimum, "0") : whole;
  if (minimum === 0 && digits === "0") digits = "";
  if (grouped) digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const prefix = format.slice(0, core.index).replace(/"/g, "");
  const suffix = format.slice(core.index + pattern.length).replace(/"/g, "");
  return `${value < 0 && Number(`${whole}.${fraction ?? 0}`) !== 0 ? "-" : ""}${prefix}${digits}${fraction !== undefined ? `.${fraction}` : ""}${suffix}`;
}

function formatDate(date: Date, format: string): string {
  return format.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, (token) => {
    const t = token.toLowerCase();
    if (t === "yyyy") return String(date.getUTCFullYear());
    if (t === "yy") return String(date.getUTCFullYear()).slice(-2);
    if (t === "mmmm") return MONTHS[date.getUTCMonth()].replace(/^./, (c) => c.toUpperCase());
    if (t === "mmm") return MONTHS[date.getUTCMonth()].slice(0, 3).replace(/^./, (c) => c.toUpperCase());
    if (t === "mm") return p2(date.getUTCMonth() + 1);
    if (t === "m") return String(date.getUTCMonth() + 1);
    if (t === "dddd") return DAYS[date.getUTCDay()].replace(/^./, (c) => c.toUpperCase());
    if (t === "ddd") return DAYS[date.getUTCDay()].slice(0, 3).replace(/^./, (c) => c.toUpperCase());
    if (t === "dd") return p2(date.getUTCDate());
    return String(date.getUTCDate());
  });
}

// ---- the functions ----------------------------------------------------------------------------------

/** Functions that look at their arguments one by one: a branch that is not taken may hold an error. */
export const LAZY = new Set(["IF", "IFS", "SWITCH", "CHOOSE", "IFERROR", "IFNA"]);

export const EXTRA_FUNCTIONS = new Set([
  "ROUNDUP", "ROUNDDOWN", "TRUNC", "CEILING.MATH", "FLOOR.MATH",
  "IFS", "XOR", "IFNA", "SWITCH", "TRUE", "FALSE", "CHOOSE",
  "LEFT", "RIGHT", "MID", "LEN", "TRIM", "CLEAN", "UPPER", "LOWER", "PROPER", "CONCAT", "SUBSTITUTE", "FIND", "TEXT", "TEXTBEFORE", "TEXTAFTER",
  "TODAY", "NOW", "DATE", "DAY", "MONTH", "YEAR", "EOMONTH", "EDATE", "DATEDIF", "NETWORKDAYS",
]);

/** Worked out only from the Excel formula in the exported sheet (they read today's date, or dates as text): the cell keeps the worked-out value. */
export const EXCEL_SAFE = new Set([
  "ROUND", "ABS", "INT", "SQRT", "MOD", "IF", "AND", "OR", "NOT", "IFERROR",
  "ROUNDUP", "ROUNDDOWN", "TRUNC", "CEILING.MATH", "FLOOR.MATH", "IFS", "XOR", "IFNA", "SWITCH", "TRUE", "FALSE", "CHOOSE",
  "LEFT", "RIGHT", "MID", "LEN", "TRIM", "CLEAN", "UPPER", "LOWER", "PROPER", "CONCAT", "SUBSTITUTE", "FIND",
]);

const roundTo = (x: number, digits: number, how: "up" | "down") => {
  const factor = Math.pow(10, digits);
  const scaled = Number((Math.abs(x) * factor).toPrecision(12));
  return Math.sign(x) * (how === "up" ? Math.ceil(scaled) : Math.floor(scaled)) / factor;
};

/** The value of one of EXTRA_FUNCTIONS for these arguments (an error value for a bad one). */
export function extra(fn: string, a: Value[]): Value {
  const n = (at: number) => numberOf(a[at] ?? null);
  const s = (at: number) => text(a[at] ?? null);
  const bad = LAZY.has(fn) ? undefined : a.find(isErr);
  if (bad !== undefined) return bad;
  switch (fn) {
    case "ROUNDUP": case "ROUNDDOWN": { const x = n(0), d = a.length > 1 ? n(1) : 0; return x === null || d === null ? ERR_VALUE : roundTo(x, d, fn === "ROUNDUP" ? "up" : "down"); }
    case "TRUNC": { const x = n(0), d = a.length > 1 ? n(1) : 0; return x === null || d === null ? ERR_VALUE : roundTo(x, d, "down"); }
    case "CEILING.MATH": case "FLOOR.MATH": {
      const x = n(0), significance = a.length > 1 ? n(1) : 1;
      if (x === null || significance === null) return ERR_VALUE;
      if (significance === 0) return 0;
      const step = Math.abs(significance);
      const q = Number((x / step).toPrecision(12));
      return (fn === "CEILING.MATH" ? Math.ceil(q) : Math.floor(q)) * step;
    }
    case "IF": { if (isErr(a[0] ?? null)) return a[0] ?? null; return truthy(a[0] ?? null) ? (a[1] ?? 0) : (a[2] ?? 0); }
    case "IFERROR": return isErr(a[0] ?? null) ? (a[1] ?? 0) : (a[0] ?? null);
    case "IFNA": return (a[0] ?? null) === ERR_NA ? (a[1] ?? 0) : (a[0] ?? null);
    case "IFS": {
      if (a.length < 2 || a.length % 2 !== 0) return ERR_VALUE;
      for (let at = 0; at < a.length; at += 2) { if (isErr(a[at] ?? null)) return a[at] ?? null; if (truthy(a[at] ?? null)) return a[at + 1] ?? 0; }
      return ERR_NA;
    }
    case "XOR": return a.filter((v) => truthy(v)).length % 2 === 1 ? 1 : 0;
    case "SWITCH": {
      if (a.length < 3) return ERR_VALUE;
      if (isErr(a[0] ?? null)) return a[0] ?? null;
      const x = numberOf(a[0] ?? null);
      for (let at = 1; at + 1 < a.length; at += 2) {
        const y = numberOf(a[at] ?? null);
        if (x !== null && y !== null ? x === y : s(0).trim().toUpperCase() === s(at).trim().toUpperCase()) return a[at + 1] ?? 0;
      }
      return a.length % 2 === 0 ? (a[a.length - 1] ?? 0) : ERR_NA;
    }
    case "CHOOSE": { const i = n(0); if (i === null || Math.trunc(i) < 1 || Math.trunc(i) >= a.length) return ERR_VALUE; return a[Math.trunc(i)] ?? 0; }
    case "TRUE": return 1;
    case "FALSE": return 0;

    case "LEFT": { const k = a.length > 1 ? n(1) : 1; return k === null || k < 0 ? ERR_VALUE : s(0).slice(0, Math.trunc(k)); }
    case "RIGHT": { const k = a.length > 1 ? n(1) : 1; return k === null || k < 0 ? ERR_VALUE : Math.trunc(k) === 0 ? "" : s(0).slice(-Math.trunc(k)); }
    case "MID": { const start = n(1), k = n(2); return start === null || k === null || start < 1 || k < 0 ? ERR_VALUE : s(0).substr(Math.trunc(start) - 1, Math.trunc(k)); }
    case "LEN": return s(0).length;
    case "TRIM": return s(0).trim().replace(/\s+/g, " ");
    case "CLEAN": return [...s(0)].filter((ch) => ch.charCodeAt(0) >= 32).join("");
    case "UPPER": return s(0).toUpperCase();
    case "LOWER": return s(0).toLowerCase();
    case "PROPER": return s(0).toLowerCase().replace(/(^|[^A-Za-z])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
    case "CONCAT": return a.map(text).join("");
    case "SUBSTITUTE": {
      const [whole, old, replacement] = [s(0), s(1), s(2)];
      if (old === "") return whole;
      if (a.length > 3) {
        const instance = n(3);
        if (instance === null || instance < 1) return ERR_VALUE;
        let from = -1;
        for (let seen = 0; seen < Math.trunc(instance); seen += 1) { from = whole.indexOf(old, from + 1); if (from < 0) return whole; }
        return whole.slice(0, from) + replacement + whole.slice(from + old.length);
      }
      return whole.split(old).join(replacement);
    }
    case "FIND": {
      const start = a.length > 2 ? n(2) : 1;
      if (start === null || start < 1) return ERR_VALUE;
      const at = s(1).indexOf(s(0), Math.trunc(start) - 1);
      return at < 0 ? ERR_VALUE : at + 1;
    }
    case "TEXTBEFORE": case "TEXTAFTER": {
      const [whole, delimiter] = [s(0), s(1)];
      const instance = a.length > 2 ? n(2) : 1;
      if (delimiter === "" || instance === null || instance < 1) return ERR_VALUE;
      let from = -1;
      for (let seen = 0; seen < Math.trunc(instance); seen += 1) { from = whole.indexOf(delimiter, from + 1); if (from < 0) return ERR_NA; }
      return fn === "TEXTBEFORE" ? whole.slice(0, from) : whole.slice(from + delimiter.length);
    }
    case "TEXT": {
      const format = s(1);
      if (/[dmy]/i.test(format.replace(/"[^"]*"/g, "")) && !/[#0]/.test(format)) {
        const date = dateOf(a[0] ?? null);
        return date ? formatDate(date, format) : ERR_VALUE;
      }
      const x = n(0);
      return x === null ? text(a[0] ?? null) : formatNumber(x, format);
    }

    case "TODAY": { const now = new Date(); return fmtDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))); }
    case "NOW": { const now = new Date(); return `${fmtDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))} ${p2(now.getHours())}:${p2(now.getMinutes())}`; }
    case "DATE": {
      const [y, m, d] = [n(0), n(1), n(2)];
      if (y === null || m === null || d === null) return ERR_VALUE;
      const date = new Date(Date.UTC(y < 100 ? 1900 + Math.trunc(y) : Math.trunc(y), Math.trunc(m) - 1, Math.trunc(d)));
      return Number.isNaN(date.getTime()) ? ERR_NUM : fmtDate(date);
    }
    case "DAY": case "MONTH": case "YEAR": {
      const date = dateOf(a[0] ?? null);
      if (!date) return ERR_VALUE;
      return fn === "DAY" ? date.getUTCDate() : fn === "MONTH" ? date.getUTCMonth() + 1 : date.getUTCFullYear();
    }
    case "EOMONTH": { const date = dateOf(a[0] ?? null), k = a.length > 1 ? n(1) : 0; if (!date || k === null) return ERR_VALUE; const moved = shiftMonths(date, Math.trunc(k)); return fmtDate(new Date(Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, 0))); }
    case "EDATE": { const date = dateOf(a[0] ?? null), k = n(1); return !date || k === null ? ERR_VALUE : fmtDate(shiftMonths(date, Math.trunc(k))); }
    case "DATEDIF": { const [from, to] = [dateOf(a[0] ?? null), dateOf(a[1] ?? null)]; return !from || !to ? ERR_VALUE : datedif(from, to, s(2).trim().toUpperCase()); }
    case "NETWORKDAYS": { const [from, to] = [dateOf(a[0] ?? null), dateOf(a[1] ?? null)]; return !from || !to ? ERR_VALUE : networkDays(from, to); }
  }
  return ERR_VALUE;
}

/** Dates in a plain formula: date - date is the days between, date + days / date - days is a date, and dates compare as dates. */
export function dateArith(op: string, a: Value, b: Value): Value | undefined {
  const [x, y] = [isDateText(a) ? dateOf(a) : null, isDateText(b) ? dateOf(b) : null];
  if (x && y) {
    if (op === "-") return Math.round((x.getTime() - y.getTime()) / DAY_MS);
    const [l, r] = [x.getTime(), y.getTime()];
    if (op === "=") return l === r ? 1 : 0;
    if (op === "<>") return l !== r ? 1 : 0;
    if (op === "<") return l < r ? 1 : 0;
    if (op === ">") return l > r ? 1 : 0;
    if (op === "<=") return l <= r ? 1 : 0;
    if (op === ">=") return l >= r ? 1 : 0;
    return undefined;
  }
  const days = numberOf(b);
  if (x && days !== null && (op === "+" || op === "-")) return fmtDate(new Date(x.getTime() + (op === "+" ? days : -days) * DAY_MS));
  return undefined;
}

export const NOT_AVAILABLE = new Set(["FILTER", "SORT", "SORTBY", "UNIQUE", "SEQUENCE", "TAKE", "DROP", "CHOOSECOLS", "CHOOSEROWS", "VSTACK", "HSTACK", "TEXTSPLIT", "LAMBDA", "MAP", "SCAN",
  "DSUM", "DCOUNT", "DAVERAGE", "HLOOKUP", "OFFSET", "INDIRECT", "COLUMN"]);

export const NOT_AVAILABLE_MESSAGE = (name: string) => NOT_AVAILABLE.has(name.toUpperCase())
  ? `${name} is not available in Add Column: ${["FILTER", "SORT", "SORTBY", "UNIQUE", "SEQUENCE", "TAKE", "DROP", "CHOOSECOLS", "CHOOSEROWS", "VSTACK", "HSTACK", "TEXTSPLIT", "LAMBDA", "MAP", "SCAN"].includes(name.toUpperCase())
    ? "it gives a whole list, not one value for each line. Use the grid's own filter, sort, Group By and Pivot buttons for that."
    : "this report has one table of columns, so it has no use here. Use SUMIFS, XLOOKUP or INDEX/MATCH instead."}`
  : `Unknown function ${name}`;

export { ERR_DIV, ERR_NA, ERR_NUM, ERR_VALUE };
