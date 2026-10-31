/**
 * Spreadsheet-style formulas for the columns a user adds to a report's output (and the same formulas as real Excel formulas in the export).
 *
 * A column named in a formula is that column's cell of the row the formula is in (=QTY*RATE). Inside SUM, AVERAGE, MIN, MAX or COUNT it
 * is the whole column, as an Excel range is, and arithmetic on columns there is worked out row by row first, so =SUM(QTY*RATE) is the
 * sum of each row's quantity times rate. A formula that names no column outside those functions is one figure (shown on the last
 * row), not one for each row. Columns are written by caption (QTY, [Net Amount]) or by the Excel letter they have in the grid (C).
 */

import { EXCEL_SAFE, EXTRA_FUNCTIONS, NOT_AVAILABLE_MESSAGE, dateArith, extra } from "./sheetFunctions";

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

export const REDUCERS = new Set(["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "PRODUCT", "COUNTA", "COUNTBLANK"]);
/** SUMIF(range, criteria, [sum_range]), COUNTIF(range, criteria), AVERAGEIF(range, criteria, [average_range]): the range arguments are whole columns, the criteria is one value (a cell of the row, a number or a text such as ">100"). */
export const CONDITIONAL = new Set(["SUMIF", "COUNTIF", "AVERAGEIF"]);
/** SUMIFS(sum_range, range1, criteria1, ...), COUNTIFS(range1, criteria1, ...), AVERAGEIFS, MAXIFS, MINIFS: every condition has to hold. */
const MULTI = new Set(["SUMIFS", "COUNTIFS", "AVERAGEIFS", "MAXIFS", "MINIFS"]);
/** The functions that read whole columns (and which of their arguments are the columns) besides the reducers and the conditionals. */
const RANGE_ARGS: Record<string, (at: number) => boolean> = {
  SUMIFS: (at) => at === 0 || at % 2 === 1, AVERAGEIFS: (at) => at === 0 || at % 2 === 1, MAXIFS: (at) => at === 0 || at % 2 === 1, MINIFS: (at) => at === 0 || at % 2 === 1, COUNTIFS: (at) => at % 2 === 0,
  XLOOKUP: (at) => at === 1 || at === 2, INDEX: (at) => at === 0, MATCH: (at) => at === 1, XMATCH: (at) => at === 1, LARGE: (at) => at === 0, SMALL: (at) => at === 0,
  ROWS: () => true, COLUMNS: () => true, SUBTOTAL: (at) => at >= 1, AGGREGATE: (at) => at >= 2, SUMPRODUCT: () => true, TEXTJOIN: (at) => at >= 2,
};
const RANGE_FN = new Set(["XLOOKUP", "INDEX", "MATCH", "XMATCH", "LARGE", "SMALL", "ROWS", "COLUMNS", "SUBTOTAL", "AGGREGATE", "SUMPRODUCT", "TEXTJOIN"]);
const ALIASES: Record<string, string> = { AVG: "AVERAGE" };
const ELEMENTWISE = new Set(["ROUND", "ABS", "INT", "SQRT", "MOD", "IF", "AND", "OR", "NOT", "IFERROR", "VLOOKUP", "ROW", ...EXTRA_FUNCTIONS]);

/** LET(name, value, ..., result): each name is put in place of its value in what follows, so the rest of the engine never sees it. */
function expandLet(args: Node[]): Node {
  if (args.length < 3 || args.length % 2 === 0) throw new FormulaError("LET needs pairs of a name and a value, then the result: LET(x, [Amount]*10, x+100)");
  const swap = (node: Node, name: string, value: Node): Node => {
    switch (node.t) {
      case "ref": return node.name.toUpperCase() === name.toUpperCase() ? value : node;
      case "neg": case "pct": return { ...node, x: swap(node.x, name, value) };
      case "bin": return { ...node, l: swap(node.l, name, value), r: swap(node.r, name, value) };
      case "call": return { ...node, args: node.args.map((arg) => swap(arg, name, value)) };
      default: return node;
    }
  };
  let result = args[args.length - 1];
  for (let at = args.length - 3; at >= 0; at -= 2) {
    const name = args[at];
    if (name.t !== "ref") throw new FormulaError("LET: a name (such as x) comes before each value");
    result = swap(result, name.name, args[at + 1]);
  }
  return result;
}

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
        if (!REDUCERS.has(fn) && !ELEMENTWISE.has(fn) && !CONDITIONAL.has(fn) && !MULTI.has(fn) && !RANGE_FN.has(fn) && fn !== "LET") throw new FormulaError(NOT_AVAILABLE_MESSAGE(token.text));
        const args: Node[] = [];
        if (!isOp(")")) { args.push(comparison()); while (isOp(",")) { take(); args.push(comparison()); } }
        if (!isOp(")")) throw new FormulaError('A ")" is missing');
        take();
        if (fn === "LET") return expandLet(args);
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
  // The names a LET gives (LET(x, [Amount]*10, x+100)) are not columns.
  const letNames = new Set<string>();
  tokens.forEach((token, index) => {
    if (token.kind !== "id" || token.text.toUpperCase() !== "LET" || tokens[index + 1]?.text !== "(") return;
    let depth = 0, position = 0, start = index + 2;
    for (let at = index + 1; at < tokens.length; at += 1) {
      const current = tokens[at];
      if (current.kind === "op" && current.text === "(") depth += 1;
      else if (current.kind === "op" && current.text === ")") { depth -= 1; if (depth === 0) break; }
      else if (current.kind === "op" && current.text === "," && depth === 1) {
        if (position % 2 === 0 && at - start === 1 && tokens[start].kind === "id") letNames.add(tokens[start].text.toUpperCase());
        position += 1; start = at + 1;
      }
    }
  });
  let out = "";
  let last = 0;
  tokens.forEach((token, index) => {
    if (token.kind !== "id") return;
    if (letNames.has(token.text.toUpperCase()) && !text.slice(token.at).startsWith("[")) return;
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
export type ExternalTable = { rows: readonly (readonly Value[])[]; /** The rows of each first-column value, for the exact match (built when first used). */ groups?: Map<string, number[]> };

const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";
export const isError = (value: Value) => typeof value === "string" && /^#(DIV[/]0!|VALUE!|N[/]A|NUM!|REF!)$/.test(value);

function numberOf(value: Value): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") { const n = Number(value.replace(/,/g, "").trim()); return value.trim() !== "" && Number.isFinite(n) ? n : null; }
  return null;
}

function arith(op: string, a: Value, b: Value): Value {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (op === "&") return `${a ?? ""}${b ?? ""}`;
  if (typeof a === "string" || typeof b === "string") { const dated = dateArith(op, a, b); if (dated !== undefined) return dated; }
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
  if (fn === "COUNTA") return values.filter((value) => value !== null && value !== "").length;
  if (fn === "COUNTBLANK") return values.filter((value) => value === null || value === "").length;
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
    case "MIN": return numbers.length ? numbers.reduce((m, n) => (n < m ? n : m), Infinity) : 0;
    case "MAX": return numbers.length ? numbers.reduce((m, n) => (n > m ? n : m), -Infinity) : 0;
    case "PRODUCT": return numbers.length ? numbers.reduce((p, n) => p * n, 1) : 0;
  }
  return ERR_VALUE;
}

/** How a cell is compared in a lookup: as a number when it is one, else as text without case or spaces at the ends. */
const lookupKey = (value: Value): string => { const n = typeof value === "number" ? value : value === null || value === "" ? null : numberOf(value); return n !== null ? `n:${n}` : `s:${String(value ?? "").trim().toUpperCase()}`; };

/**
 * The test a SUMIF / COUNTIF / AVERAGEIF criteria stands for, as Excel reads it: a number or a plain text means "equals" (text without case);
 * a text may start with = <> < > <= >= and then a number or a text; * and ? are wildcards in a text. An empty criteria matches the empty cells.
 */
function matcher(criteria: Value): (cell: Value) => boolean {
  if (typeof criteria === "number") return (cell) => numberOf(cell) === criteria;
  const text = String(criteria ?? "");
  const parsed = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(text) as RegExpExecArray;
  const op = parsed[1] ?? "=";
  const rest = parsed[2];
  const wanted = rest.trim() === "" ? null : numberOf(rest);
  const wildcard = /[*?]/.test(rest) ? new RegExp(`^${rest.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i") : null;
  return (cell) => {
    if (isError(cell)) return false;
    if (rest === "") { const empty = cell === null || cell === ""; return op === "<>" ? !empty : empty; }
    if (wanted !== null) {
      const n = numberOf(cell);
      if (n === null) return op === "<>";
      return op === "=" ? n === wanted : op === "<>" ? n !== wanted : op === "<" ? n < wanted : op === ">" ? n > wanted : op === "<=" ? n <= wanted : n >= wanted;
    }
    const value = String(cell ?? "");
    if (wildcard) { const hit = wildcard.test(value); return op === "<>" ? !hit : hit; }
    const l = value.trim().toUpperCase(), r = rest.trim().toUpperCase();
    return op === "=" ? l === r : op === "<>" ? l !== r : op === "<" ? l < r : op === ">" ? l > r : op === "<=" ? l <= r : l >= r;
  };
}

/** Whether a criteria is a plain "equals" (no operator, no wildcard), which an index over the range can answer. */
const plainEquals = (criteria: Value): boolean => typeof criteria === "number" || !/^(<=|>=|<>|<|>|=)|[*?]/.test(String(criteria ?? "")) && String(criteria ?? "").trim() !== "";

type Tally = { sum: number; count: number; numbers: number };
const tallyOf = (range: readonly Value[], sums: readonly Value[], test: (cell: Value) => boolean, only?: string): Tally => {
  const out: Tally = { sum: 0, count: 0, numbers: 0 };
  range.forEach((cell, at) => {
    if (only !== undefined ? lookupKey(cell) !== only : !test(cell)) return;
    out.count += 1;
    const n = numberOf(sums[at] ?? null);
    if (n !== null) { out.sum += n; out.numbers += 1; }
  });
  return out;
};

function conditional(fn: string, tally: Tally): Value {
  if (fn === "SUMIF") return tally.sum;
  if (fn === "COUNTIF") return tally.count;
  return tally.numbers > 0 ? tally.sum / tally.numbers : ERR_DIV;
}

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
  let rowsOf: number[] = [];
  if (exact) {
    if (!found.groups) { found.groups = new Map(); found.rows.forEach((row, position) => { const key = lookupKey(row[0] ?? null); const list = found.groups!.get(key); if (list) list.push(position); else found.groups!.set(key, [position]); }); }
    rowsOf = found.groups.get(wanted) ?? [];
    at = rowsOf.length > 0 ? rowsOf[0] : -1;
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
  // A value that is on several lines of the other report (a party's many lines, against one line here): their figures are added up, as SUMIF does.
  if (rowsOf.length > 1) {
    const cells = rowsOf.map((position) => found.rows[position][Math.trunc(index) - 1] ?? null);
    const figures = cells.map((cell) => (typeof cell === "number" ? cell : numberOf(cell)));
    if (figures.every((figure) => figure !== null)) return figures.reduce((sum: number, figure) => sum + (figure as number), 0);
  }
  return found.rows[at][Math.trunc(index) - 1] ?? 0;
}

function elementwise(fn: string, a: Value[], sheet?: Sheet): Value {
  const n = (at: number) => numberOf(a[at] ?? null);
  if (EXTRA_FUNCTIONS.has(fn) || fn === "IF" || fn === "IFERROR") return extra(fn, a);
  const bad = a.find(isError);
  if (bad !== undefined) return bad;
  switch (fn) {
    case "ROUND": { const x = n(0); const d = a.length > 1 ? n(1) : 0; if (x === null || d === null) return ERR_VALUE; const f = Math.pow(10, d); return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f; }
    case "ABS": { const x = n(0); return x === null ? ERR_VALUE : Math.abs(x); }
    case "INT": { const x = n(0); return x === null ? ERR_VALUE : Math.floor(x); }
    case "SQRT": { const x = n(0); return x === null || x < 0 ? ERR_VALUE : Math.sqrt(x); }
    case "MOD": { const x = n(0), y = n(1); if (x === null || y === null) return ERR_VALUE; return y === 0 ? ERR_DIV : x - y * Math.floor(x / y); }
    case "AND": return a.every((v) => (numberOf(v) ?? (v ? 1 : 0)) !== 0) ? 1 : 0;
    case "OR": return a.some((v) => (numberOf(v) ?? (v ? 1 : 0)) !== 0) ? 1 : 0;
    case "NOT": return (numberOf(a[0] ?? null) ?? 0) === 0 ? 1 : 0;
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
    case "call":
      if (CONDITIONAL.has(node.fn)) return node.args.some((arg, at) => isRowFormula(arg, inReducer || at !== 1));
      if (node.fn === "ROW") return true;
      if (RANGE_ARGS[node.fn]) { const isRange = RANGE_ARGS[node.fn]; return node.args.some((arg, at) => isRowFormula(arg, inReducer || isRange(at))); }
      return node.args.some((arg) => isRowFormula(arg, inReducer || REDUCERS.has(node.fn)));
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
  const indexes = new Map<Node, Map<string, Tally>>();
  type Multi = Tally & { max: number; min: number };
  const multiIndexes = new Map<Node, Map<string, Multi>>();
  const positions = new Map<Node, Map<string, number>>();
  const sortedColumns = new Map<Node, number[]>();
  /** A column argument as its cells (a text "Report!COLUMN" is that column of another open report); each is read once. */
  const rangeCache = new Map<Node, Value[] | string>();
  const columnOf = (arg: Node): Value[] | string => {
    let hit = rangeCache.get(arg);
    if (hit !== undefined) return hit;
    if (arg.t === "str") {
      const found = sheet.table?.(arg.v);
      hit = found === undefined ? "#REF!" : typeof found === "string" ? found : found.rows.map((line) => line[0] ?? null);
    } else hit = flat(ev(arg, null));
    rangeCache.set(arg, hit);
    return hit;
  };
  const first = (value: Value | Vec): Value => (Array.isArray(value) ? (value[0] ?? null) : (value as Value));
  const empty = (): Multi => ({ sum: 0, count: 0, numbers: 0, max: -Infinity, min: Infinity });
  const STATS: Record<number, string> = { 1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN", 6: "PRODUCT", 9: "SUM" };

  /** SUMIFS / COUNTIFS / AVERAGEIFS / MAXIFS / MINIFS. */
  const multiple = (n: Extract<Node, { t: "call" }>, row: number | null): Value => {
    const counting = n.fn === "COUNTIFS";
    const from = counting ? 0 : 1;
    if (n.args.length < from + 2 || (n.args.length - from) % 2 !== 0) return ERR_VALUE;
    const sums = counting ? null : columnOf(n.args[0]);
    if (typeof sums === "string") return sums;
    const ranges: Value[][] = [];
    const criteria: Value[] = [];
    for (let at = from; at < n.args.length; at += 2) {
      const range = columnOf(n.args[at]);
      if (typeof range === "string") return range;
      const given = first(ev(n.args[at + 1], row));
      if (isError(given)) return given;
      ranges.push(range); criteria.push(given);
    }
    const size = ranges[0].length;
    if (ranges.some((range) => range.length !== size) || (sums !== null && sums.length !== size)) return ERR_VALUE;
    const add = (tally: Multi, at: number) => {
      tally.count += 1;
      const x = sums === null ? null : numberOf(sums[at] ?? null);
      if (x !== null) { tally.sum += x; tally.numbers += 1; if (x > tally.max) tally.max = x; if (x < tally.min) tally.min = x; }
    };
    let tally: Multi;
    if (criteria.every(plainEquals)) {
      let index = multiIndexes.get(n);
      if (!index) {
        index = new Map<string, Multi>();
        for (let at = 0; at < size; at += 1) {
          const key = ranges.map((range) => lookupKey(range[at] ?? null)).join("\u0001");
          let tallied = index.get(key);
          if (!tallied) { tallied = empty(); index.set(key, tallied); }
          add(tallied, at);
        }
        multiIndexes.set(n, index);
      }
      tally = index.get(criteria.map(lookupKey).join("\u0001")) ?? empty();
    } else {
      const tests = criteria.map(matcher);
      tally = empty();
      for (let at = 0; at < size; at += 1) if (tests.every((test, k) => test(ranges[k][at] ?? null))) add(tally, at);
    }
    switch (n.fn) {
      case "COUNTIFS": return tally.count;
      case "SUMIFS": return tally.sum;
      case "AVERAGEIFS": return tally.numbers > 0 ? tally.sum / tally.numbers : ERR_DIV;
      case "MAXIFS": return tally.numbers > 0 ? tally.max : 0;
      default: return tally.numbers > 0 ? tally.min : 0;
    }
  };

  /** The functions that read whole columns (XLOOKUP, INDEX, MATCH, LARGE, SUBTOTAL, SUMPRODUCT...). */
  const columnsFunction = (n: Extract<Node, { t: "call" }>, row: number | null): Value => {
    const isRange = RANGE_ARGS[n.fn];
    const constant = n.args.every((arg, at) => isRange(at) || arg.t === "num" || arg.t === "str");
    if (constant) { const hit = cache.get(n); if (hit !== undefined) return hit; }
    const ranges = new Map<number, Value[]>();
    const scalars: Value[] = [];
    for (let at = 0; at < n.args.length; at += 1) {
      if (isRange(at)) { const range = columnOf(n.args[at]); if (typeof range === "string") return range; ranges.set(at, range); }
      else scalars[at] = first(ev(n.args[at], row));
    }
    const range = (at: number) => ranges.get(at) ?? [];
    const position = (at: number) => {
      let index = positions.get(n);
      if (!index) { index = new Map(); range(at).forEach((cell, place) => { const key = lookupKey(cell); if (!index!.has(key)) index!.set(key, place); }); positions.set(n, index); }
      return index.get(lookupKey(scalars[0] ?? null));
    };
    const stat = (code: number, values: Value[]): Value => { const name = STATS[code > 100 ? code - 100 : code]; return name ? reduce(name, values) : ERR_VALUE; };
    let result: Value;
    switch (n.fn) {
      case "XLOOKUP": {
        const found = position(1);
        if (range(1).length !== range(2).length) result = ERR_VALUE;
        else result = found === undefined ? (n.args.length > 3 ? (scalars[3] ?? null) : "#N/A") : (range(2)[found] ?? 0);
        break;
      }
      case "INDEX": {
        const at = numberOf(scalars[1] ?? null), col = n.args.length > 2 ? numberOf(scalars[2] ?? null) : 1;
        result = at === null || Math.trunc(at) < 1 || Math.trunc(at) > range(0).length || (col !== 0 && col !== 1) ? "#REF!" : (range(0)[Math.trunc(at) - 1] ?? 0);
        break;
      }
      case "MATCH": case "XMATCH": {
        const kind = n.args.length > 2 ? (numberOf(scalars[2] ?? null) ?? 1) : n.fn === "MATCH" ? 1 : 0;
        if (kind === 0) { const found = position(1); result = found === undefined ? "#N/A" : found + 1; break; }
        if (n.fn === "XMATCH") { result = ERR_VALUE; break; }
        const x = numberOf(scalars[0] ?? null);
        let at = -1;
        range(1).forEach((cell, place) => {
          const y = numberOf(cell);
          const ok = x !== null && y !== null ? (kind > 0 ? y <= x : y >= x) : (kind > 0 ? String(cell ?? "").trim().toUpperCase() <= String(scalars[0] ?? "").trim().toUpperCase() : String(cell ?? "").trim().toUpperCase() >= String(scalars[0] ?? "").trim().toUpperCase());
          if (ok) at = place;
        });
        result = at < 0 ? "#N/A" : at + 1;
        break;
      }
      case "LARGE": case "SMALL": {
        let sorted = sortedColumns.get(n);
        if (!sorted) { sorted = range(0).flatMap((cell) => { const x = numberOf(cell); return x === null ? [] : [x]; }).sort((p, q) => p - q); sortedColumns.set(n, sorted); }
        const k = numberOf(scalars[1] ?? null);
        result = k === null || Math.trunc(k) < 1 || Math.trunc(k) > sorted.length ? "#NUM!" : n.fn === "LARGE" ? sorted[sorted.length - Math.trunc(k)] : sorted[Math.trunc(k) - 1];
        break;
      }
      case "ROWS": result = range(0).length; break;
      case "COLUMNS": result = 1; break;
      case "SUBTOTAL": { const code = numberOf(scalars[0] ?? null); result = code === null ? ERR_VALUE : stat(Math.trunc(code), [...ranges.entries()].flatMap(([, values]) => values)); break; }
      case "AGGREGATE": { const code = numberOf(scalars[0] ?? null); result = code === null ? ERR_VALUE : stat(Math.trunc(code), [...ranges.values()].flatMap((values) => values).filter((value) => !isError(value))); break; }
      case "SUMPRODUCT": {
        const lists = [...ranges.values()];
        if (lists.length === 0 || lists.some((list) => list.length !== lists[0].length)) { result = ERR_VALUE; break; }
        let total = 0;
        for (let at = 0; at < lists[0].length; at += 1) { let product = 1; for (const list of lists) product *= numberOf(list[at] ?? null) ?? 0; total += product; }
        result = total;
        break;
      }
      case "TEXTJOIN": {
        const skip = numberOf(scalars[1] ?? null) !== 0 && String(scalars[1] ?? "").toUpperCase() !== "FALSE";
        const parts = [...ranges.entries()].filter(([at]) => at >= 2).flatMap(([, values]) => values).filter((value) => !skip || (value !== null && value !== ""));
        result = parts.map((value) => String(value ?? "")).join(String(scalars[0] ?? ""));
        break;
      }
      default: result = ERR_VALUE;
    }
    if (constant) cache.set(n, result);
    return result;
  };

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
        if (CONDITIONAL.has(n.fn)) {
          if (n.args.length < 2 || (n.fn === "COUNTIF" && n.args.length !== 2)) return ERR_VALUE;
          // A range written as a text "Report!COLUMN" is that column of another open report (its rows are read in the order that report shows them).
          const range = columnOf(n.args[0]);
          if (typeof range === "string") return range;
          const given = ev(n.args[1], row);
          const criteria = Array.isArray(given) ? (given[0] ?? null) : given;
          if (isError(criteria)) return criteria;
          const sums = n.args[2] ? columnOf(n.args[2]) : range;
          if (typeof sums === "string") return sums;
          if (plainEquals(criteria)) {
            let index = indexes.get(n);
            if (!index) {
              index = new Map<string, Tally>();
              range.forEach((cell, at) => {
                const key = lookupKey(cell);
                const tally = index!.get(key) ?? index!.set(key, { sum: 0, count: 0, numbers: 0 }).get(key)!;
                tally.count += 1;
                const x = numberOf(sums[at] ?? null);
                if (x !== null) { tally.sum += x; tally.numbers += 1; }
              });
              indexes.set(n, index);
            }
            return conditional(n.fn, index.get(lookupKey(criteria)) ?? { sum: 0, count: 0, numbers: 0 });
          }
          return conditional(n.fn, tallyOf(range, sums, matcher(criteria)));
        }
        if (MULTI.has(n.fn)) return multiple(n, row);
        if (RANGE_FN.has(n.fn)) return columnsFunction(n, row);
        if (n.fn === "ROW") return row === null ? 1 : row + 1;
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
/** The functions Excel works out over a run of rows inside SUMPRODUCT. */
const ARRAY_OK = new Set(["ROUND", "ABS", "INT", "SQRT", "MOD", "ROUNDUP", "ROUNDDOWN", "TRUNC", "CEILING.MATH", "FLOOR.MATH"]);

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
        if (REDUCERS.has(n.fn) || unsupportedInArray.has(n.fn) || !EXCEL_SAFE.has(n.fn) || !ARRAY_OK.has(n.fn)) return null;
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
        if (CONDITIONAL.has(n.fn)) {
          const ranged = (arg: Node | undefined, [from, to]: readonly [number, number]) => { if (!arg || arg.t !== "ref") return null; const letter = sheet.letter(arg.name); return letter ? `${letter}${from}:${letter}${to}` : null; };
          const criteria = tx(n.args[1]);
          if (criteria === null || (n.fn === "AVERAGEIF" && sheet.segments.length !== 1)) return null;
          const parts = sheet.segments.map((segment) => {
            const range = ranged(n.args[0], segment);
            const sums = n.args[2] ? ranged(n.args[2], segment) : "";
            return range === null || sums === null ? null : `${n.fn}(${range},${criteria}${sums !== "" ? `,${sums}` : ""})`;
          });
          return parts.length === 0 || parts.some((part) => part === null) ? null : parts.length === 1 ? (parts[0] as string) : `(${parts.join("+")})`;
        }
        // VLOOKUP reads another open report, which the exported sheet does not have: its cells hold the worked-out values.
        if (n.fn === "VLOOKUP" || !EXCEL_SAFE.has(n.fn)) return null;
        const args = n.args.map(tx);
        return args.some((arg) => arg === null) ? null : `${n.fn}(${args.join(",")})`;
      }
    }
  };
  return tx(node);
}
