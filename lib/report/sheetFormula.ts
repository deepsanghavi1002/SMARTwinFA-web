/**
 * Spreadsheet-style formulas for the columns a user adds to a report's output (and the same formulas as real Excel formulas in the export).
 *
 * A column named in a formula is that column's cell of the row the formula is in (=QTY*RATE). Inside SUM, AVERAGE, MIN, MAX or COUNT it
 * is the whole column, as an Excel range is, and arithmetic on columns there is worked out row by row first, so =SUM(QTY*RATE) is the
 * sum of each row's quantity times rate. A formula that names no column outside those functions is one figure (shown on the last
 * row), not one for each row. Columns are written by caption (QTY, [Net Amount]) or by the Excel letter they have in the grid (C).
 */

// ---- the formula's text -----------------------------------------------------------------

type Token = { kind: "num" | "str" | "id" | "op"; text: string; at: number };

export class FormulaError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const ch = source[at];
    if (/\s/.test(ch)) { at += 1; continue; }
    const start = at;
    if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(source.slice(at));
      if (!match) throw new FormulaError(`Unexpected "${ch}"`);
      tokens.push({ kind: "num", text: match[0], at: start }); at += match[0].length; continue;
    }
    if (ch === '"') {
      let end = at + 1;
      let text = "";
      while (end < source.length && !(source[end] === '"' && source[end + 1] !== '"')) { if (source[end] === '"') { text += '"'; end += 2; } else { text += source[end]; end += 1; } }
      if (end >= source.length) throw new FormulaError("A quoted text is not closed");
      tokens.push({ kind: "str", text, at: start }); at = end + 1; continue;
    }
    if (ch === "[") {
      const end = source.indexOf("]", at);
      if (end < 0) throw new FormulaError("A [column name] is not closed");
      tokens.push({ kind: "id", text: source.slice(at + 1, end).trim(), at: start }); at = end + 1; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(at))!;
      tokens.push({ kind: "id", text: match[0], at: start }); at += match[0].length; continue;
    }
    const two = source.slice(at, at + 2);
    if (two === "<>" || two === "<=" || two === ">=") { tokens.push({ kind: "op", text: two, at: start }); at += 2; continue; }
    if ("+-*/^&=<>(),%".includes(ch)) { tokens.push({ kind: "op", text: ch, at: start }); at += 1; continue; }
    throw new FormulaError(`Unexpected "${ch}"`);
  }
  return tokens;
}

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; name: string }
  | { t: "neg"; x: Node }
  | { t: "pct"; x: Node }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "call"; fn: string; args: Node[] };

export const REDUCERS = new Set(["SUM", "AVERAGE", "MIN", "MAX", "COUNT"]);
const ALIASES: Record<string, string> = { AVG: "AVERAGE" };
const ELEMENTWISE = new Set(["ROUND", "ABS", "INT", "SQRT", "MOD", "IF", "AND", "OR", "NOT", "IFERROR", "VLOOKUP"]);

export function parseFormula(source: string): Node {
  const text = source.trim().replace(/^=/, "");
  if (text === "") throw new FormulaError("The formula is empty");
  const tokens = tokenize(text);
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const isOp = (text: string) => peek()?.kind === "op" && peek().text === text;

  const comparison = (): Node => {
    let left = concat();
    while (peek()?.kind === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().text)) left = { t: "bin", op: take().text, l: left, r: concat() };
    return left;
  };
  const concat = (): Node => {
    let left = additive();
    while (isOp("&")) { take(); left = { t: "bin", op: "&", l: left, r: additive() }; }
    return left;
  };
  const additive = (): Node => {
    let left = term();
    while (isOp("+") || isOp("-")) left = { t: "bin", op: take().text, l: left, r: term() };
    return left;
  };
  const term = (): Node => {
    let left = unary();
    while (isOp("*") || isOp("/")) left = { t: "bin", op: take().text, l: left, r: unary() };
    return left;
  };
  const unary = (): Node => {
    if (isOp("-")) { take(); return { t: "neg", x: unary() }; }
    if (isOp("+")) { take(); return unary(); }
    return power();
  };
  const power = (): Node => {
    let base = postfix();
    while (isOp("^")) { take(); base = { t: "bin", op: "^", l: base, r: unary() }; }
    return base;
  };
  const postfix = (): Node => {
    let node = primary();
    while (isOp("%")) { take(); node = { t: "pct", x: node }; }
    return node;
  };
  const primary = (): Node => {
    const token = take();
    if (!token) throw new FormulaError("The formula ends too soon");
    if (token.kind === "num") return { t: "num", v: Number(token.text) };
    if (token.kind === "str") return { t: "str", v: token.text };
    if (token.kind === "op" && token.text === "(") {
      const inner = comparison();
      if (!isOp(")")) throw new FormulaError('A ")" is missing');
      take();
      return inner;
    }
    if (token.kind === "id") {
      if (isOp("(") && !text.slice(token.at).startsWith("[")) {
        take();
        const fn = (ALIASES[token.text.toUpperCase()] ?? token.text.toUpperCase());
        if (!REDUCERS.has(fn) && !ELEMENTWISE.has(fn)) throw new FormulaError(`Unknown function ${token.text}`);
        const args: Node[] = [];
        if (!isOp(")")) { args.push(comparison()); while (isOp(",")) { take(); args.push(comparison()); } }
        if (!isOp(")")) throw new FormulaError('A ")" is missing');
        take();
        return { t: "call", fn, args };
      }
      if (token.text.toUpperCase() === "TRUE") return { t: "num", v: 1 };
      if (token.text.toUpperCase() === "FALSE") return { t: "num", v: 0 };
      return { t: "ref", name: token.text };
    }
    throw new FormulaError(`Unexpected "${token.text}"`);
  };

  const node = comparison();
  if (at < tokens.length) throw new FormulaError(`Unexpected "${tokens[at].text}"`);
  return node;
}

/** The Excel column letters of a 1-based index (1 → A, 27 → AA). */
export function letterOf(index: number): string {
  let n = index, out = "";
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
function indexOfLetter(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

type NamedColumn = Readonly<{ key: string; caption: string }>;

/**
 * The formula with every column written by its caption: an Excel letter (C) becomes the caption of the column shown there, so the
 * formula keeps meaning the same column when columns are moved. Throws a FormulaError for a name that is no column.
 */
export function normalizeFormula(source: string, shown: readonly NamedColumn[], all: readonly NamedColumn[] = shown): string {
  const text = source.trim().replace(/^=/, "");
  const tokens = tokenize(text);
  let out = "";
  let last = 0;
  tokens.forEach((token, index) => {
    if (token.kind !== "id") return;
    const call = tokens[index + 1]?.kind === "op" && tokens[index + 1].text === "(" && !text.slice(token.at).startsWith("[");
    if (call) return;
    if (["TRUE", "FALSE"].includes(token.text.toUpperCase()) && !text.slice(token.at).startsWith("[")) return;
    const byName = all.find((column) => column.caption.toUpperCase() === token.text.toUpperCase() || column.key.toUpperCase() === token.text.toUpperCase());
    let caption: string | null = byName ? byName.caption : null;
    if (!caption && /^[A-Za-z]{1,3}$/.test(token.text) && !text.slice(token.at).startsWith("[")) {
      const column = shown[indexOfLetter(token.text) - 1];
      if (column) caption = column.caption;
    }
    if (!caption) throw new FormulaError(`There is no column ${token.text}`);
    const end = text.startsWith("[", token.at) ? text.indexOf("]", token.at) + 1 : token.at + token.text.length;
    out += text.slice(last, token.at) + `[${caption}]`;
    last = end;
  });
  return out + text.slice(last);
}

// ---- working a formula out ------------------------------------------------------------------

export type Value = number | string | null;
type Vec = readonly Value[];

export type Sheet = Readonly<{
  /** The number of entry rows the columns are read over. */
  rows: number;
  /** Cell of entry row `row` in the column named `name` (a caption or a key), or undefined when there is no such column. */
  cell: (name: string, row: number) => Value | undefined;
  /** The table of another open report that a VLOOKUP names (see openReports.ts), or the error Excel gives for it. */
  table?: (reference: string) => ExternalTable | string;
}>;

/** The cells of another report's columns, one array for each row; the first column is the one VLOOKUP searches. */
export type ExternalTable = { rows: readonly (readonly Value[])[]; index?: Map<string, number> };

const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";
export const isError = (value: Value) => typeof value === "string" && value.startsWith("#");

function numberOf(value: Value): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") { const n = Number(value.replace(/,/g, "").trim()); return value.trim() !== "" && Number.isFinite(n) ? n : null; }
  return null;
}

function arith(op: string, a: Value, b: Value): Value {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (op === "&") return `${a ?? ""}${b ?? ""}`;
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const x = numberOf(a), y = numberOf(b);
    const [l, r] = x !== null && y !== null ? [x, y] : [String(a ?? "").toUpperCase(), String(b ?? "").toUpperCase()];
    const test = op === "=" ? l === r : op === "<>" ? l !== r : op === "<" ? l < r : op === ">" ? l > r : op === "<=" ? l <= r : l >= r;
    return test ? 1 : 0;
  }
  const x = a === null || a === "" ? 0 : numberOf(a), y = b === null || b === "" ? 0 : numberOf(b);
  if (x === null || y === null) return ERR_VALUE;
  switch (op) {
    case "+": return x + y;
    case "-": return x - y;
    case "*": return x * y;
    case "/": return y === 0 ? ERR_DIV : x / y;
    case "^": { const p = Math.pow(x, y); return Number.isFinite(p) ? p : ERR_VALUE; }
  }
  return ERR_VALUE;
}

const flat = (value: Value | Vec): Value[] => (Array.isArray(value) ? [...value] : [value as Value]);

function reduce(fn: string, values: Value[]): Value {
  const numbers: number[] = [];
  for (const value of values) {
    if (isError(value)) return value;
    const n = typeof value === "number" ? value : numberOf(value);
    if (n !== null) numbers.push(n);
  }
  switch (fn) {
    case "SUM": return numbers.reduce((s, n) => s + n, 0);
    case "COUNT": return numbers.length;
    case "AVERAGE": return numbers.length ? numbers.reduce((s, n) => s + n, 0) / numbers.length : ERR_DIV;
    case "MIN": return numbers.length ? Math.min(...numbers) : 0;
    case "MAX": return numbers.length ? Math.max(...numbers) : 0;
  }
  return ERR_VALUE;
}

/** How a cell is compared in a lookup: as a number when it is one, else as text without case or spaces at the ends. */
const lookupKey = (value: Value): string => { const n = typeof value === "number" ? value : value === null || value === "" ? null : numberOf(value); return n !== null ? `n:${n}` : `s:${String(value ?? "").trim().toUpperCase()}`; };

/**
 * VLOOKUP(value, "Report!C:H", column, [exact]) as Excel works it: the first column of the named range of another open report is searched for
 * the value, and the cell of that row in the range's `column`th column is the answer. Left out or TRUE / 1 it is the approximate match (the
 * last row whose first cell is not above the value, the first column read as sorted); FALSE / 0 wants the value itself. A value not found is
 * #N/A, a column number below 1 is #VALUE!, one past the range is #REF!, and a report that is not open is #REF!.
 */
function vlookup(a: Value[], sheet?: Sheet): Value {
  const [value, reference, column, mode] = [a[0] ?? null, a[1] ?? null, a[2] ?? null, a.length > 3 ? a[3] : null];
  if (typeof reference !== "string" || reference.trim() === "" || isError(reference)) return ERR_VALUE;
  const index = numberOf(column);
  if (index === null || Math.trunc(index) < 1) return ERR_VALUE;
  const found = sheet?.table?.(reference);
  if (found === undefined) return "#REF!";
  if (typeof found === "string") return found;
  const exact = a.length > 3 && mode !== null && mode !== "" && (numberOf(mode) ?? (String(mode).toUpperCase() === "FALSE" ? 0 : 1)) === 0;
  const wanted = lookupKey(value);
  let at = -1;
  if (exact) {
    if (!found.index) { found.index = new Map(); found.rows.forEach((row, position) => { const key = lookupKey(row[0] ?? null); if (!found.index!.has(key)) found.index!.set(key, position); }); }
    at = found.index.get(wanted) ?? -1;
  } else {
    const x = numberOf(value);
    for (let position = 0; position < found.rows.length; position += 1) {
      const key = found.rows[position][0] ?? null;
      const y = numberOf(key);
      const below = x !== null && y !== null ? y <= x : String(key ?? "").trim().toUpperCase() <= String(value ?? "").trim().toUpperCase();
      if (below) at = position; else if (x !== null && y !== null) break;
    }
  }
  if (at < 0) return "#N/A";
  const width = found.rows[at].length;
  if (Math.trunc(index) > width) return "#REF!";
  return found.rows[at][Math.trunc(index) - 1] ?? 0;
}

function elementwise(fn: string, a: Value[], sheet?: Sheet): Value {
  const n = (at: number) => numberOf(a[at] ?? null);
  const bad = a.find(isError);
  if (bad !== undefined && fn !== "IFERROR") return bad;
  switch (fn) {
    case "ROUND": { const x = n(0); const d = a.length > 1 ? n(1) : 0; if (x === null || d === null) return ERR_VALUE; const f = Math.pow(10, d); return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f; }
    case "ABS": { const x = n(0); return x === null ? ERR_VALUE : Math.abs(x); }
    case "INT": { const x = n(0); return x === null ? ERR_VALUE : Math.floor(x); }
    case "SQRT": { const x = n(0); return x === null || x < 0 ? ERR_VALUE : Math.sqrt(x); }
    case "MOD": { const x = n(0), y = n(1); if (x === null || y === null) return ERR_VALUE; return y === 0 ? ERR_DIV : x - y * Math.floor(x / y); }
    case "IF": { const c = numberOf(a[0] ?? null); const truth = c !== null ? c !== 0 : String(a[0] ?? "") !== ""; return truth ? (a[1] ?? 0) : (a[2] ?? 0); }
    case "AND": return a.every((v) => (numberOf(v) ?? (v ? 1 : 0)) !== 0) ? 1 : 0;
    case "OR": return a.some((v) => (numberOf(v) ?? (v ? 1 : 0)) !== 0) ? 1 : 0;
    case "NOT": return (numberOf(a[0] ?? null) ?? 0) === 0 ? 1 : 0;
    case "IFERROR": return isError(a[0] ?? null) ? (a[1] ?? 0) : (a[0] ?? null);
    case "VLOOKUP": return vlookup(a, sheet);
  }
  return ERR_VALUE;
}

/** Whether the formula names a column outside SUM / AVERAGE / MIN / MAX / COUNT: one result for each row; otherwise one figure. */
export function isRowFormula(node: Node, inReducer = false): boolean {
  switch (node.t) {
    case "ref": return !inReducer;
    case "num": case "str": return false;
    case "neg": case "pct": return isRowFormula(node.x, inReducer);
    case "bin": return isRowFormula(node.l, inReducer) || isRowFormula(node.r, inReducer);
    case "call": return node.args.some((arg) => isRowFormula(arg, inReducer || REDUCERS.has(node.fn)));
  }
}

/** The names of the columns a formula uses. */
export function columnsUsed(node: Node, into = new Set<string>()): Set<string> {
  switch (node.t) {
    case "ref": into.add(node.name); break;
    case "neg": case "pct": columnsUsed(node.x, into); break;
    case "bin": columnsUsed(node.l, into); columnsUsed(node.r, into); break;
    case "call": node.args.forEach((arg) => columnsUsed(arg, into)); break;
  }
  return into;
}

/** The formula's value for each entry row (a row formula), or its one figure (any other), over `sheet`. */
export function evaluate(node: Node, sheet: Sheet): { perRow: boolean; values: Value[]; scalar: Value } {
  for (const name of columnsUsed(node)) if (sheet.rows > 0 && sheet.cell(name, 0) === undefined) throw new FormulaError(`There is no column ${name}`);
  const cache = new Map<Node, Value>();
  const ev = (n: Node, row: number | null): Value | Vec => {
    switch (n.t) {
      case "num": return n.v;
      case "str": return n.v;
      case "ref": {
        if (row !== null) return sheet.cell(n.name, row) ?? null;
        return Array.from({ length: sheet.rows }, (_, i) => sheet.cell(n.name, i) ?? null);
      }
      case "neg": { const x = ev(n.x, row); return Array.isArray(x) ? x.map((v) => arith("-", 0, v)) : arith("-", 0, x as Value); }
      case "pct": { const x = ev(n.x, row); return Array.isArray(x) ? x.map((v) => arith("/", v, 100)) : arith("/", x as Value, 100); }
      case "bin": {
        const l = ev(n.l, row), r = ev(n.r, row);
        if (Array.isArray(l) || Array.isArray(r)) {
          const size = Math.max(Array.isArray(l) ? l.length : 0, Array.isArray(r) ? r.length : 0);
          return Array.from({ length: size }, (_, i) => arith(n.op, Array.isArray(l) ? (l[i] ?? null) : (l as Value), Array.isArray(r) ? (r[i] ?? null) : (r as Value)));
        }
        return arith(n.op, l as Value, r as Value);
      }
      case "call": {
        if (REDUCERS.has(n.fn)) {
          let hit = cache.get(n);
          if (hit === undefined) {
            hit = reduce(n.fn, n.args.flatMap((arg) => flat(ev(arg, null))));
            cache.set(n, hit);
          }
          return hit;
        }
        const args = n.args.map((arg) => ev(arg, row));
        if (args.some(Array.isArray)) {
          const size = Math.max(...args.map((arg) => (Array.isArray(arg) ? arg.length : 0)));
          return Array.from({ length: size }, (_, i) => elementwise(n.fn, args.map((arg) => (Array.isArray(arg) ? (arg[i] ?? null) : (arg as Value))), sheet));
        }
        return elementwise(n.fn, args as Value[], sheet);
      }
    }
  };
  if (isRowFormula(node)) {
    const values = Array.from({ length: sheet.rows }, (_, i) => { const v = ev(node, i); return Array.isArray(v) ? (v[0] ?? null) : (v as Value); });
    return { perRow: true, values, scalar: null };
  }
  const result = ev(node, null);
  const scalar = Array.isArray(result) ? (result[0] ?? null) : (result as Value);
  return { perRow: false, values: [], scalar };
}

// ---- the same formula for Excel -----------------------------------------------------------------

export type ExcelSheet = Readonly<{
  /** The Excel column letter of the column named `name`, or null. */
  letter: (name: string) => string | null;
  /** The sheet row the formula is in (a row formula), or null (one figure). */
  row: number | null;
  /** The runs of consecutive sheet rows that hold entry rows. */
  segments: readonly (readonly [number, number])[];
}>;

const unsupportedInArray = new Set(["IF", "AND", "OR", "NOT", "IFERROR", "VLOOKUP"]);

/**
 * The formula as Excel writes it, with cell references for the sheet, or null when Excel's own functions cannot say it (the cell
 * then holds the worked-out value). A column inside SUM and the like becomes the ranges of the entry rows; SUM / AVERAGE of an
 * expression over columns becomes SUMPRODUCT of each run of rows, which Excel works out without an array-formula entry.
 */
export function toExcel(node: Node, sheet: ExcelSheet): string | null {
  const rowsCount = sheet.segments.reduce((sum, [from, to]) => sum + (to - from + 1), 0);
  const ranges = (letter: string) => sheet.segments.map(([from, to]) => `${letter}${from}:${letter}${to}`).join(",");

  /** An expression as one run of rows' arrays (inside SUMPRODUCT). */
  const array = (n: Node, from: number, to: number): string | null => {
    switch (n.t) {
      case "num": return String(n.v);
      case "str": return `"${n.v.replace(/"/g, '""')}"`;
      case "ref": { const letter = sheet.letter(n.name); return letter ? `${letter}${from}:${letter}${to}` : null; }
      case "neg": { const x = array(n.x, from, to); return x === null ? null : `-(${x})`; }
      case "pct": { const x = array(n.x, from, to); return x === null ? null : `(${x})/100`; }
      case "bin": { const l = array(n.l, from, to), r = array(n.r, from, to); return l === null || r === null ? null : `(${l}${n.op}${r})`; }
      case "call": {
        if (REDUCERS.has(n.fn) || unsupportedInArray.has(n.fn)) return null;
        const args = n.args.map((arg) => array(arg, from, to));
        return args.some((arg) => arg === null) ? null : `${n.fn}(${args.join(",")})`;
      }
    }
  };
  const plainRef = (n: Node) => n.t === "ref";

  const tx = (n: Node): string | null => {
    switch (n.t) {
      case "num": return String(n.v);
      case "str": return `"${n.v.replace(/"/g, '""')}"`;
      case "ref": { const letter = sheet.letter(n.name); return letter && sheet.row !== null ? `${letter}${sheet.row}` : null; }
      case "neg": { const x = tx(n.x); return x === null ? null : `-(${x})`; }
      case "pct": { const x = tx(n.x); return x === null ? null : `(${x})/100`; }
      case "bin": { const l = tx(n.l), r = tx(n.r); return l === null || r === null ? null : `(${l}${n.op}${r})`; }
      case "call": {
        if (REDUCERS.has(n.fn)) {
          if (n.args.length > 0 && n.args.every((arg) => plainRef(arg) || columnsUsed(arg).size === 0)) {
            const parts = n.args.map((arg) => { if (arg.t === "ref") { const letter = sheet.letter(arg.name); return letter ? ranges(letter) : null; } return tx(arg); });
            return parts.some((part) => part === null || part === "") ? null : `${n.fn}(${parts.join(",")})`;
          }
          if (n.args.length === 1 && (n.fn === "SUM" || n.fn === "AVERAGE")) {
            const parts = sheet.segments.map(([from, to]) => { const inner = array(n.args[0], from, to); return inner === null ? null : `SUMPRODUCT(${inner})`; });
            if (parts.length === 0 || parts.some((part) => part === null)) return null;
            return n.fn === "SUM" ? `(${parts.join("+")})` : rowsCount > 0 ? `((${parts.join("+")})/${rowsCount})` : null;
          }
          return null;
        }
        // VLOOKUP reads another open report, which the exported sheet does not have: its cells hold the worked-out values.
        if (n.fn === "VLOOKUP") return null;
        const args = n.args.map(tx);
        return args.some((arg) => arg === null) ? null : `${n.fn}(${args.join(",")})`;
      }
    }
  };
  return tx(node);
}
