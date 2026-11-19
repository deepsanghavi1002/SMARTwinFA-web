import type { OutputColumn, OutputRow, ReportOutput } from "./types.ts";

/**
 * The report's ask bar (web only): a sentence typed in plain words ("only closing balance is zero", "debtors with closing balance -ve",
 * "date only of may2026", "debit above 10000 between apr and jun") read into conditions, then applied to the report already on screen:
 * what does not fit is taken off and the totals are worked out again from the rest. Nothing is generated and no model is asked: the words
 * are matched to a fixed list of phrases, so a sentence that means nothing here is refused, never guessed at.
 *
 *  - closing balance (or a bare "above 1 lakh", "-ve", "zero"): a test on each ledger (its last closing balance, CR as minus);
 *  - debit / credit amounts: a test on each entry;  - a date, a month or two dates / months: a test on each entry's date;
 *  - any other word: the ledger's own name or the book it is in (debtors, creditors ...) must contain it.
 */

export type AmountCondition = Readonly<{ op: "zero" | "nonzero" | "gt" | "lt" | "between"; a: number; b: number }>;
/** A test on the figures of the entries in one column (debit or credit). */
export type ColumnCondition = Readonly<{ column: "debit" | "credit"; sign: "pos" | "neg" | null; amount: AmountCondition | null }>;
/** The dates wanted: from one day to another (a month is its first to its last day), or these months of any year. */
export type DateRule = Readonly<{ kind: "range"; from: Date; to: Date } | { kind: "months"; months: readonly number[] }>;
export type AskQuery = Readonly<{
  /** The closing balance of a ledger: "neg" a credit balance (-ve), "pos" a debit balance (+ve), and its amount. */
  sign: "pos" | "neg" | null;
  amount: AmountCondition | null;
  columns: readonly ColumnCondition[];
  dates: DateRule | null;
  /** Words the group's names (its headings: the book, the party) must contain. */
  words: readonly string[];
  /** The sentence as understood, in words, shown back to the user. */
  summary: string;
}>;

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?|cr|million)?`;
const UNIT: Readonly<Record<string, number>> = { k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7, million: 1e6 };
const figure = (digits: string, unit: string | undefined) => Number(digits.replace(/,/g, "")) * (unit ? UNIT[unit] ?? 1 : 1);

/** Words that carry no name: the grammar of the sentence and the names of the columns it talks about. */
const STOP = new Set(["show", "only", "with", "without", "ledger", "ledgers", "party", "parties", "account", "accounts", "whose", "where", "who", "is", "are", "was", "the", "an", "of", "for", "and", "having", "has", "have", "balance", "balances", "closing", "closings", "than", "more", "less", "in", "on", "list", "display", "give", "me", "all", "filter", "those", "that", "which", "at", "to", "from", "equal", "equals", "total", "amount", "rs", "rupees", "it", "be", "get", "find", "out", "side", "bal", "dr", "cr", "debit", "credit", "date", "dates", "dated", "month", "months", "during", "till", "until", "upto", "between", "year", "entries", "entry", "vouchers"]);

const inWords = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A cell's date ("03-Apr-2026", "03-Apr-26", "03/04/2026"); null when it is not one (as the Group By's). */
function cellDate(text: string): Date | null {
  const named = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})$/.exec(text.trim());
  if (named) {
    const month = MONTHS.indexOf(named[2].toLowerCase());
    return month < 0 ? null : new Date(named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3]), month, Number(named[1]));
  }
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return slashed ? new Date(Number(slashed[3]), Number(slashed[2]) - 1, Number(slashed[1])) : null;
}
const dayText = (date: Date) => `${String(date.getDate()).padStart(2, "0")}-${MONTH_NAMES[date.getMonth()]}-${date.getFullYear()}`;

/** A sign and an amount read out of a piece of the sentence, with the pieces used and what is left of it. */
function readCondition(source: string): { sign: "pos" | "neg" | null; amount: AmountCondition | null; parts: string[]; rest: string } {
  let text = ` ${source} `;
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const found = pattern.exec(text);
    if (found) text = text.replace(found[0], " ");
    return found;
  };
  let sign: "pos" | "neg" | null = null;
  let amount: AmountCondition | null = null;
  const parts: string[] = [];

  // "above zero" / "below zero" are the sign, not an amount.
  if (take(/\s(above|over|more than|greater than)\s+(zero|nil)\b/)) sign = "pos";
  else if (take(/\s(below|under|less than)\s+(zero|nil)\b/)) sign = "neg";

  const between = take(new RegExp(String.raw`\sbetween\s+${NUMBER}\s+(?:and|to|&)\s+${NUMBER}`));
  if (between) {
    const first = figure(between[1], between[2]);
    const second = figure(between[3], between[4]);
    amount = { op: "between", a: Math.min(first, second), b: Math.max(first, second) };
    parts.push(`between ${inWords(amount.a)} and ${inWords(amount.b)}`);
  }
  if (!amount) {
    const above = take(new RegExp(String.raw`\s(?:more than|greater than|above|over|exceeding|exceeds|higher than|bigger than|at least|>=|>)\s*${NUMBER}`));
    if (above) { amount = { op: "gt", a: figure(above[1], above[2]), b: 0 }; parts.push(`above ${inWords(amount.a)}`); }
  }
  if (!amount) {
    const below = take(new RegExp(String.raw`\s(?:less than|below|under|lower than|smaller than|at most|<=|<)\s*${NUMBER}`));
    if (below) { amount = { op: "lt", a: figure(below[1], below[2]), b: 0 }; parts.push(`below ${inWords(amount.a)}`); }
  }
  if (!amount) {
    if (take(/\s(?:not|non|other than|except)[\s-]*(?:zero|nil)\b|\snon-?zero\b/)) { amount = { op: "nonzero", a: 0, b: 0 }; parts.push("not zero"); }
    else if (take(/\s(?:zero|nil|no balance|cleared|settled)\b|\s0(?:\.0+)?\s/)) { amount = { op: "zero", a: 0, b: 0 }; parts.push("zero"); }
  }
  if (!sign) {
    if (take(/\s(?:-\s?ve|negative|minus)\b/)) sign = "neg";
    else if (take(/\s(?:\+\s?ve|positive)\b/)) sign = "pos";
  }
  if (sign === "neg") parts.unshift("-ve");
  if (sign === "pos") parts.unshift("+ve");
  return { sign, amount, parts, rest: text };
}

const MONTH_WORD = String.raw`(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)`;
/** One date as typed: 10-Oct-2026, 10/10/26, may2026, may 2026, april. */
const DATE_TOKEN = String.raw`(?:\d{1,2}[\s\-/.](?:\d{1,2}|${MONTH_WORD})[\s\-/.]\d{2,4}|${MONTH_WORD}(?=\b|\d)(?:[\s\-/'.]*\d{4}|\d{2}(?!\d))?)`;

type Token = Readonly<{ from: Date; to: Date; month: number; year: number | null; whole: "day" | "month" }>;

function readToken(raw: string): Token | null {
  const text = raw.trim().toLowerCase();
  const day = /^(\d{1,2})[\s\-/.](\d{1,2}|[a-z]+)[\s\-/.](\d{2,4})$/.exec(text);
  if (day) {
    const month = /^\d+$/.test(day[2]) ? Number(day[2]) - 1 : MONTHS.indexOf(day[2].slice(0, 3));
    const year = day[3].length === 2 ? 2000 + Number(day[3]) : Number(day[3]);
    const date = new Date(year, month, Number(day[1]));
    return month < 0 || month > 11 || Number.isNaN(date.getTime()) ? null : { from: date, to: date, month, year, whole: "day" };
  }
  const named = /^([a-z]+)(?:[\s\-/'.]*(\d{4})|(\d{2}))?$/.exec(text);
  if (!named) return null;
  const month = MONTHS.indexOf(named[1].slice(0, 3));
  if (month < 0) return null;
  const year = named[2] ? Number(named[2]) : named[3] ? 2000 + Number(named[3]) : null;
  return year === null
    ? { from: new Date(2000, month, 1), to: new Date(2000, month + 1, 0), month, year: null, whole: "month" }
    : { from: new Date(year, month, 1), to: new Date(year, month + 1, 0), month, year, whole: "month" };
}

const shifted = (token: Token, year: number): Token => (token.whole === "month"
  ? { ...token, year, from: new Date(year, token.month, 1), to: new Date(year, token.month + 1, 0) }
  : { ...token, year, from: new Date(year, token.from.getMonth(), token.from.getDate()), to: new Date(year, token.to.getMonth(), token.to.getDate()) });

/** The dates in a sentence: a range ("between apr and jun 2026", "from 01/04/2026 to 15-05-2026"), a month ("of may2026") or a day; the sentence without them. */
function readDates(source: string): { rule: DateRule | null; label: string; rest: string } {
  let text = ` ${source} `;
  const range = new RegExp(String.raw`\s(?:between|from)\s+(${DATE_TOKEN})\s+(?:and|to|till|until|upto|up to|&|-)\s+(${DATE_TOKEN})(?![\w])`).exec(text);
  if (range) {
    const first = readToken(range[1]);
    const second = readToken(range[2]);
    if (first && second) {
      text = text.replace(range[0], " ");
      if (first.year === null && second.year === null && first.whole === "month" && second.whole === "month") {
        const months: number[] = [];
        for (let month = first.month; ; month = (month + 1) % 12) { months.push(month); if (month === second.month) break; }
        return { rule: { kind: "months", months }, label: `${MONTH_NAMES[first.month]} to ${MONTH_NAMES[second.month]}`, rest: text };
      }
      let start = first;
      let end = second;
      if (start.year === null && end.year !== null) start = shifted(start, end.year);
      if (end.year === null && start.year !== null) end = shifted(end, start.year);
      if (start.year !== null && end.year !== null && start.from.getTime() > end.to.getTime() && first.year === null) start = shifted(start, start.year - 1);
      if (start.from.getTime() > end.to.getTime()) [start, end] = [end, start];
      return { rule: { kind: "range", from: start.from, to: end.to }, label: `${dayText(start.from)} to ${dayText(end.to)}`, rest: text };
    }
  }
  const single = new RegExp(String.raw`\s(?:(?:date|dates|dated)\s+)?(?:only\s+)?(?:(?:of|in|for|on|during)\s+)?(?:the\s+)?(?:month\s+(?:of\s+)?)?(${DATE_TOKEN})(?![\w])`).exec(text);
  if (single) {
    const token = readToken(single[1]);
    if (token) {
      text = text.replace(single[0], " ");
      if (token.year === null) return { rule: { kind: "months", months: [token.month] }, label: MONTH_NAMES[token.month], rest: text };
      return { rule: { kind: "range", from: token.from, to: token.to }, label: token.whole === "month" ? `${MONTH_NAMES[token.month]} ${token.year}` : dayText(token.from), rest: text };
    }
  }
  const now = new Date();
  const relative = /\s(this month|last month|previous month|today|yesterday)\b/.exec(text);
  if (relative) {
    text = text.replace(relative[0], " ");
    const word = relative[1];
    if (word === "today" || word === "yesterday") {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (word === "yesterday" ? 1 : 0));
      return { rule: { kind: "range", from: day, to: day }, label: `${word} (${dayText(day)})`, rest: text };
    }
    const first = new Date(now.getFullYear(), now.getMonth() - (word === "this month" ? 0 : 1), 1);
    return { rule: { kind: "range", from: first, to: new Date(first.getFullYear(), first.getMonth() + 1, 0) }, label: `${word} (${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()})`, rest: text };
  }
  return { rule: null, label: "", rest: text };
}

/** The sentence read into conditions; null when it holds nothing this bar knows (so the screen can say what it understands). */
export function parseAsk(sentence: string): AskQuery | null {
  const dated = readDates(sentence.toLowerCase().replace(/[−–—]/g, "-"));
  let text = ` ${dated.rest} `;
  let sign: "pos" | "neg" | null = null;
  // "credit balance" / "debit balance" talk about the closing balance, not the credit / debit column.
  if (/\s(?:credit balance|cr balance|in credit|credit side)\b/.test(text)) { sign = "neg"; text = text.replace(/\s(?:credit balance|cr balance|in credit|credit side)\b/, " "); }
  else if (/\s(?:debit balance|dr balance|in debit|debit side)\b/.test(text)) { sign = "pos"; text = text.replace(/\s(?:debit balance|dr balance|in debit|debit side)\b/, " "); }

  // Cut the sentence at the column words: each piece belongs to the column named at its start (what comes before the first is general).
  const cuts = [...text.matchAll(/\s(debit|credit|closing balance|closing bal|closing|balance)\b/g)].map((found) => ({ at: found.index ?? 0, column: found[1] }));
  const pieces: { column: string; text: string }[] = [{ column: "", text: cuts.length > 0 ? text.slice(0, cuts[0].at) : text }];
  cuts.forEach((cut, index) => pieces.push({ column: cut.column, text: text.slice(cut.at + 1 + cut.column.length, index + 1 < cuts.length ? cuts[index + 1].at : text.length) }));

  let amount: AmountCondition | null = null;
  const columns: ColumnCondition[] = [];
  const parts: string[] = [];
  const columnParts: string[] = [];
  const leftover: string[] = [];
  for (const piece of pieces) {
    const read = readCondition(piece.text);
    leftover.push(read.rest);
    if (piece.column === "debit" || piece.column === "credit") {
      if (read.sign !== null || read.amount !== null) {
        columns.push({ column: piece.column, sign: read.sign, amount: read.amount });
        columnParts.push(`${piece.column} ${read.parts.join(" ")}`.trim());
      }
    } else {
      if (read.sign !== null) sign = read.sign;
      if (read.amount !== null) amount = read.amount;
      if (read.sign !== null || read.amount !== null) parts.push(...read.parts);
    }
  }
  if (sign === "neg" && !parts.includes("-ve")) parts.unshift("credit (-ve)");
  if (sign === "pos" && !parts.includes("+ve")) parts.unshift("debit (+ve)");

  const words = leftover.join(" ").replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((word) => word.length >= 2 && !STOP.has(word) && !/^\d+$/.test(word))
    .map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word));
  if (!sign && !amount && columns.length === 0 && !dated.rule && words.length === 0) return null;
  const summary = [
    parts.length > 0 ? `closing balance ${parts.join(", ")}` : "",
    ...columnParts,
    dated.rule ? `date ${dated.label}` : "",
    words.length > 0 ? `name has ${words.join(" + ")}` : "",
  ].filter((part) => part !== "").join(" · ");
  return { sign, amount, columns, dates: dated.rule, words, summary };
}

/** The closing balance column and the DR / CR column that says its side, if the report has them. */
export function closingColumnsOf(columns: readonly OutputColumn[]): { closing: string; side: string | null } | null {
  const closing = columns.find((column) => /^(closings?|closing_?bal(ance)?)$/i.test(column.key.trim()))
    ?? columns.find((column) => column.kind === "number" && /closing/i.test(`${column.key} ${column.caption}`));
  if (!closing) return null;
  return { closing: closing.key, side: columns.find((column) => /^dr_?cr\d?$/i.test(column.key.trim()))?.key ?? null };
}

/** The figure column a word names: debit or credit (not the DR / CR side column). */
export function amountColumnOf(columns: readonly OutputColumn[], word: "debit" | "credit"): string | null {
  const pattern = word === "debit" ? /^(debit|dr|debit_?amt|debit_?amount)$/i : /^(credit|cr|credit_?amt|credit_?amount)$/i;
  const loose = word === "debit" ? /debit/i : /credit/i;
  return (columns.find((column) => pattern.test(column.key.trim())) ?? columns.find((column) => column.kind === "number" && loose.test(`${column.key} ${column.caption}`) && !/dr_?cr/i.test(column.key)))?.key ?? null;
}

/** The column the entries' dates are in: a date column, or the first column called date whose cells read as dates. */
export function dateColumnOf(columns: readonly OutputColumn[], rows: readonly OutputRow[]): string | null {
  const reads = (key: string) => rows.some((row) => cellDate((row.values[key] ?? "").trim()) !== null);
  return columns.find((column) => column.kind === "date" && reads(column.key))?.key ?? columns.find((column) => /date/i.test(`${column.key} ${column.caption}`) && reads(column.key))?.key ?? null;
}

export type AskContext = Readonly<{
  isHeading: (row: OutputRow) => boolean;
  headingLevel: (row: OutputRow) => number;
  /** Where each subtotal's group starts (row index of the subtotal -> row index of the group's first row). */
  groupStart: ReadonlyMap<number, number>;
}>;

const headingText = (row: OutputRow) => (Object.values(row.values).map((value) => value.trim()).find((value) => value !== "") ?? "").replace(/^[*\s]+/, "");
const NAMED = /^[a-z0-9]/i;

function fits(sign: "pos" | "neg" | null, amount: AmountCondition | null, value: number): boolean {
  if (sign === "neg" && !(value < -0.005)) return false;
  if (sign === "pos" && !(value > 0.005)) return false;
  if (!amount) return true;
  const size = Math.abs(value);
  switch (amount.op) {
    case "zero": return size < 0.005;
    case "nonzero": return size >= 0.005;
    case "gt": return size > amount.a;
    case "lt": return size < amount.a;
    default: return size >= amount.a && size <= amount.b;
  }
}

function holds(query: AskQuery, closing: number | null, names: string): boolean {
  if (query.words.some((word) => !names.includes(word))) return false;
  if (query.sign === null && query.amount === null) return true;
  return closing !== null && fits(query.sign, query.amount, closing);
}

const dateFits = (rule: DateRule, text: string): boolean => {
  const date = cellDate(text.trim());
  if (!date) return false;
  if (rule.kind === "months") return rule.months.includes(date.getMonth());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return day >= rule.from.getTime() && day <= new Date(rule.to.getFullYear(), rule.to.getMonth(), rule.to.getDate()).getTime();
};

/** `unit`: what `kept` and `total` count: the ledgers (groups) of a grouped report, or the rows of one with no groups. */
type HideCounts = Readonly<{ hide: Set<number>; kept: number; total: number; unit: "ledgers" | "rows" }>;
/** `text`: the question as it was understood, written out in full (every column by its whole heading, the words spelt right): what the export says. */
export type AskResult = (HideCounts & Readonly<{ text: string }>) | Readonly<{ problem: string }>;

/**
 * The rows to take off the report for this question. A ledger (a group of the deepest level: the party) is kept when its closing balance and
 * its names fit (its closing balance is the last figure its closing column shows, on its DR / CR side, CR being minus; its names are its own
 * heading and those of the groups it is in: the book). Inside the ledgers kept, an entry stays when its date and its debit / credit figures
 * fit (its narration lines follow it); a ledger left with no entry goes too.
 */
function hideByQuery(output: ReportOutput, query: AskQuery, context: AskContext): HideCounts | Readonly<{ problem: string }> {
  const leaf = output.rows.reduce((deepest, row) => (row.kind === "subtotal" && row.level > deepest ? row.level : deepest), -1);
  // A report with no groups is asked about its rows: dates, debit / credit figures and words in the row; a closing balance needs ledgers.
  if (leaf < 0 && (query.sign !== null || query.amount !== null)) return { problem: "A closing balance is asked of ledgers (groups); this report has none. Ask about its dates, debit / credit figures or text instead" };
  const closingColumns = closingColumnsOf(output.columns);
  if ((query.sign !== null || query.amount !== null) && !closingColumns) return { problem: "This report has no closing balance column" };
  const dateKey = query.dates ? dateColumnOf(output.columns, output.rows) : null;
  if (query.dates && !dateKey) return { problem: "This report has no date column" };
  const amountKeys = new Map<ColumnCondition, string>();
  for (const condition of query.columns) {
    const key = amountColumnOf(output.columns, condition.column);
    if (!key) return { problem: `This report has no ${condition.column} column` };
    amountKeys.set(condition, key);
  }
  const rowLevel = dateKey !== null || query.columns.length > 0;
  const signed = (row: OutputRow): number | null => {
    if (!closingColumns) return null;
    const raw = (row.values[closingColumns.closing] ?? "").replace(/[,\s]/g, "");
    if (raw === "" || !Number.isFinite(Number(raw))) return null;
    const side = closingColumns.side ? (row.values[closingColumns.side] ?? "").trim().toUpperCase() : "";
    return side === "CR" ? -Math.abs(Number(raw)) : side === "DR" ? Math.abs(Number(raw)) : Number(raw);
  };
  const entryFits = (row: OutputRow): boolean => {
    if (query.dates && dateKey && !dateFits(query.dates, row.values[dateKey] ?? "")) return false;
    for (const condition of query.columns) {
      const raw = (row.values[amountKeys.get(condition) ?? ""] ?? "").replace(/[,\s]/g, "");
      const value = raw === "" || !Number.isFinite(Number(raw)) ? 0 : Number(raw);
      if (!fits(condition.sign, condition.amount, value)) return false;
    }
    return true;
  };
  const hide = new Set<number>();
  const names: string[] = [];
  let kept = 0;
  let total = 0;
  output.rows.forEach((row, index) => {
    if (row.kind === "data" && context.isHeading(row)) {
      const level = context.headingLevel(row);
      names[level] = headingText(row).toLowerCase();
      names.length = level + 1;
      return;
    }
    if (row.kind !== "subtotal" || row.level !== leaf) return;
    const start = context.groupStart.get(index) ?? index;
    let closing: number | null = null;
    for (let at = index - 1; at >= start && closing === null; at -= 1) {
      const candidate = output.rows[at];
      if (candidate.kind === "data" && !context.isHeading(candidate)) closing = signed(candidate);
    }
    total += 1;
    let keep = holds(query, closing, names.filter((name) => NAMED.test(name)).join(" "));
    const own: number[] = [];
    if (keep && rowLevel) {
      let last = true;
      let entries = 0;
      for (let at = start; at < index; at += 1) {
        const candidate = output.rows[at];
        if (candidate.kind !== "data" || context.isHeading(candidate)) continue;
        const narration = /narration/i.test(candidate.rowType);
        const fit: boolean = narration ? last : entryFits(candidate);
        if (!narration) last = fit;
        if (!fit) own.push(at);
        else if (!narration) entries += 1;
      }
      keep = entries > 0;
    }
    if (keep) { kept += 1; for (const at of own) hide.add(at); return; }
    for (let at = start; at <= index; at += 1) hide.add(at);
  });
  if (leaf < 0) {
    let last = true;
    output.rows.forEach((row, index) => {
      if (row.kind !== "data" || context.isHeading(row) || row.rowType === "FT" || row.rowType === "COUNT") return;
      const narration = /narration/i.test(row.rowType);
      const text = Object.values(row.values).join(" ").toLowerCase();
      const fit: boolean = narration ? last : entryFits(row) && query.words.every((word) => text.includes(word));
      if (!narration) { last = fit; total += 1; if (fit) kept += 1; }
      if (!fit) hide.add(index);
    });
  }
  return { hide, kept, total, unit: leaf < 0 ? "rows" : "ledgers" };
}

// ---------------------------------------------------------------------------------------------------------------------
// The structured form: 'column' condition, 'column' condition ...  (the quotes say what a name is; a comma means "and").
//
//   'date' between may and jun2026, 'parti -closing bal' is zero, '* debtors'
//
//  - 'date' / 'debit' / 'parti': a column, by the first letters of its name (not the whole name);
//  - 'parti -closing bal': a group, a hyphen, then a figure column: for each party (the deepest group), its closing balance (the last figure
//    of a balance column, or the sum of any other figure column) is tested. The left side may also be stars: '** -closing bal';
//  - '* creditor', '** alfa': a group by its stars, as the report shows its headings (one star the first group, two the second ...) and
//    the first letters of its name; with nothing after it, it only picks those groups;
//  - the condition is plain English, the same for numbers, dates and text: is, is not, equal, not equal, less than, greater than, at most,
//    at least, between .. and .., contains, does not contain, starts with, ends with, is zero, is blank ...
// ---------------------------------------------------------------------------------------------------------------------

type ConditionOp = "eq" | "ne" | "lt" | "gt" | "le" | "ge" | "between" | "zero" | "nonzero" | "pos" | "neg" | "contain" | "notcontain" | "starts" | "ends" | "blank" | "notblank";
export type ValueCondition = Readonly<{ op: ConditionOp; operands: readonly string[] }>;
export type Clause = Readonly<
  | { kind: "group"; level: number; name: string; text: string }
  | { kind: "groupValue"; level: number | null; group: string; column: string; cond: ValueCondition; text: string }
  /** 'parti -#open' is zero: the balance on the ledger's line that holds this word (its opening or closing line); the whole ledger stays. */
  | { kind: "balanceRow"; level: number | null; group: string; word: string; cond: ValueCondition; text: string }
  | { kind: "column"; column: string; cond: ValueCondition; text: string }
>;
export type AskPlan = Readonly<{ kind: "natural"; query: AskQuery; summary: string } | { kind: "structured"; clauses: readonly Clause[]; summary: string }>;

const unquote = (value: string) => value.trim().replace(/^'+|'+$/g, "").trim();

/** The number of single-letter changes (a letter put in, left out or changed) between two words. */
export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** The words of a condition (the ones a misspelling can be mended to). */
const OPERATOR_WORDS = ["equal", "equals", "less", "than", "greater", "more", "above", "below", "under", "over", "between", "contain", "contains", "containing", "does", "starts", "ends", "with", "begins", "beginning", "starting", "ending", "zero", "positive", "negative", "blank", "empty", "least", "most", "before", "after", "like", "having", "exceeding", "higher", "lower", "smaller", "bigger", "other", "except", "includes", "including"];
/** After these the rest of the condition is what is looked for, and is left as typed. */
const OPERAND_FOLLOWS = new Set(["contain", "contains", "containing", "like", "having", "includes", "including", "with", "equal", "equals"]);

/** The condition's own words spelt right ("greter then 5000" -> "greater than 5000", "betwen", "conatins"); the operands are never touched. */
function mendWords(text: string): string {
  let operand = false;
  let quoted = false;
  return text.split(/(\s+)/).map((part) => {
    if (/^\s*$/.test(part)) return part;
    if (quoted || part.includes("'")) {
      if ((part.match(/'/g) ?? []).length % 2 === 1) quoted = !quoted;
      return part;
    }
    if (operand) return part;
    const word = part.toLowerCase();
    if (!/^[a-z]{3,}$/.test(word) || OPERATOR_WORDS.includes(word)) {
      if (OPERAND_FOLLOWS.has(word)) operand = true;
      return part;
    }
    const limit = word.length >= 7 ? 2 : 1;
    let best = "";
    let bestDistance = limit + 1;
    let tie = false;
    for (const candidate of OPERATOR_WORDS) {
      if (Math.abs(candidate.length - word.length) > limit) continue;
      const apart = distance(word, candidate);
      if (apart < bestDistance) { best = candidate; bestDistance = apart; tie = false; }
      else if (apart === bestDistance) tie = true;
    }
    if (best === "" || tie) return part;
    if (OPERAND_FOLLOWS.has(best)) operand = true;
    return best;
  }).join("");
}

/** The condition after a name, in English; null when there is none (`loose`: a bare value, "may2026", then reads as "is may2026"). */
export function readValueCondition(raw: string, loose = true): ValueCondition | null {
  const text = raw.trim().replace(/^(?:is|are|was|should be)\s+/i, "").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  const one = (pattern: RegExp, op: ConditionOp): ValueCondition | null => {
    const found = pattern.exec(text);
    return found ? { op, operands: [unquote(found[1])] } : null;
  };
  const plain = (pattern: RegExp, op: ConditionOp): ValueCondition | null => (pattern.test(text) ? { op, operands: [] } : null);
  const between = /^between\s+(.+?)\s+(?:and|to|&)\s+(.+)$/i.exec(text);
  return plain(/^(?:zero|nil|0(?:\.0+)?)$/i, "zero")
    ?? plain(/^(?:not\s+(?:equal\s+(?:to\s+)?)?(?:zero|nil|0)|non[\s-]*zero|<>\s*0|!=\s*0)$/i, "nonzero")
    ?? plain(/^(?:positive|\+\s?ve)$/i, "pos")
    ?? plain(/^(?:negative|minus|-\s?ve)$/i, "neg")
    ?? plain(/^(?:blank|empty)$/i, "blank")
    ?? plain(/^not\s+(?:blank|empty)$/i, "notblank")
    ?? one(/^(?:less\s+than\s+or\s+equal(?:\s+to)?|at\s+most|<=)\s*(.+)$/i, "le")
    ?? one(/^(?:(?:greater|more)\s+than\s+or\s+equal(?:\s+to)?|at\s+least|>=)\s*(.+)$/i, "ge")
    ?? one(/^(?:less\s+than|lower\s+than|smaller\s+than|below|under|before|<)\s*(.+)$/i, "lt")
    ?? one(/^(?:greater\s+than|more\s+than|higher\s+than|bigger\s+than|above|over|exceeding|after|>)\s*(.+)$/i, "gt")
    ?? (between ? { op: "between" as const, operands: [unquote(between[1]), unquote(between[2])] } : null)
    ?? one(/^(?:does\s*n[o']?t\s+contain|not\s+contains?|not\s+containing|not\s+like)\s+(.+)$/i, "notcontain")
    ?? one(/^(?:contains?|containing|has|having|like|includes?|including)\s+(.+)$/i, "contain")
    ?? one(/^(?:starts?|begins?|starting|beginning)\s+with\s+(.+)$/i, "starts")
    ?? one(/^(?:ends?|ending)\s+with\s+(.+)$/i, "ends")
    ?? one(/^(?:not\s+equals?(?:\s+to)?|not|<>|!=|other\s+than|except)\s*(.+)$/i, "ne")
    ?? one(/^(?:equals?(?:\s+to)?|==|=)\s*(.+)$/i, "eq")
    ?? (loose ? { op: "eq" as const, operands: [unquote(text)] } : null);
}

/** A sentence that holds quotes is the structured form; it is cut into clauses at the commas (and an "and" that begins a quoted name). */
function clausesOf(sentence: string): string[] | null {
  const text = sentence.replace(/[‘’“”"`]/g, "'");
  if (!text.includes("'")) return null;
  const pieces: string[] = [];
  let current = "";
  let open = false;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (character === "'") open = !open;
    if (!open && character === ",") { pieces.push(current); current = ""; continue; }
    const joiner = open ? null : /^\s+and\s+(?=')/i.exec(text.slice(at));
    if (joiner) { pieces.push(current); current = ""; at += joiner[0].length - 1; continue; }
    current += character;
  }
  pieces.push(current);
  return pieces.map((piece) => piece.trim()).filter((piece) => piece !== "");
}

const SPLIT = /\s-(?=\S)|^-(?=\S)/;

/** The sentence typed in quotes, or in plain words, read into a plan; { error } when a clause cannot be read; null when it is empty. */
export function parseAskPlan(sentence: string): AskPlan | { error: string } | null {
  const pieces = clausesOf(sentence);
  if (pieces === null) {
    const query = parseAsk(sentence);
    return query ? { kind: "natural", query, summary: query.summary } : null;
  }
  const clauses: Clause[] = [];
  for (const piece of pieces) {
    const found = /^'([^']*)'\s*([\s\S]*)$/.exec(piece);
    if (!found) return { error: `Put the name in single quotes, e.g. 'date' between may and jun2026\n(this part was not: ${piece})` };
    const target = found[1].trim();
    const remainder = found[2].trim();
    // The condition as typed; else with its words spelt right; else a bare value ("is may2026").
    const cond = readValueCondition(remainder, false) ?? readValueCondition(mendWords(remainder), false) ?? readValueCondition(remainder);
    const stars = /^(\*+)\s*(.*)$/.exec(target);
    const cut = (stars ? stars[2] : target).split(SPLIT).map((part) => part.trim());
    if (stars && cut.length === 1) {
      if (cut[0] === "" && !cond) return { error: `'${target}' needs a name after the stars, or a condition` };
      if (cond) return { error: `'${target}' picks a group; to test a figure of each group write it like '${stars[1]} -closing bal' ${remainder}` };
      clauses.push({ kind: "group", level: stars[1].length - 1, name: cut[0], text: piece });
      continue;
    }
    if (cut.length >= 2) {
      if (!cond) return { error: `'${target}' needs a condition after it, e.g. is zero` };
      const group = stars ? "" : cut[0];
      const right = cut.slice(1).join(" -").trim();
      if (right.startsWith("#")) {
        const word = right.slice(1).trim();
        if (word === "") return { error: `'${target}' needs the word of the line after the #, e.g. '${cut[0]} -#open' is zero` };
        clauses.push({ kind: "balanceRow", level: stars ? stars[1].length - 1 : null, group, word, cond, text: piece });
        continue;
      }
      clauses.push({ kind: "groupValue", level: stars ? stars[1].length - 1 : null, group, column: cut.slice(1).join(" -"), cond, text: piece });
      continue;
    }
    if (cut[0] === "") return { error: "There is no name in the quotes" };
    if (!cond) return { error: `'${target}' needs a condition after it, e.g. is zero, between .. and .., contains ..` };
    clauses.push({ kind: "column", column: cut[0], cond, text: piece });
  }
  if (clauses.length === 0) return null;
  return { kind: "structured", clauses, summary: clauses.map((clause) => clause.text).join(" · ") };
}

const norm = (text: string) => text.toLowerCase().replace(/[_\s]+/g, " ").trim();

/** Why no column was found for these letters: none begins with them, or they are too few (a heading of more than four letters needs four typed). */
export function columnMissing(columns: readonly OutputColumn[], letters: string): string {
  const wanted = norm(letters);
  const near = wanted === "" ? undefined : columns.find((column) => norm(column.key).startsWith(wanted) || norm(column.caption).startsWith(wanted));
  return near
    ? `'${letters}' is too few letters: type at least the first 4 letters of a column heading longer than 4 (e.g. '${norm(near.caption || near.key).slice(0, 4)}')`
    : `No column begins with '${letters}'`;
}

/** The column whose key or caption begins with these letters (a visible one first); a heading of more than 4 letters needs at least its first 4. */
export function columnByPrefix(columns: readonly OutputColumn[], letters: string): OutputColumn | undefined {
  const wanted = norm(letters);
  if (wanted === "") return undefined;
  // A heading longer than four letters needs at least its first four typed (so a stray 'd' or 'de' never picks a column by chance).
  const begins4 = (name: string, text: string) => name.startsWith(text) && (name.length <= 4 || text.length >= 4);
  let begins = columns.filter((column) => begins4(norm(column.key), wanted) || begins4(norm(column.caption), wanted));
  // "closing bal" for a column shown as CLOSINGS: when the whole phrase begins no name, its first word (4 letters or more) may.
  const first = wanted.split(" ")[0];
  if (begins.length === 0 && wanted.includes(" ") && first.length >= 4) begins = columns.filter((column) => begins4(norm(column.key), first) || begins4(norm(column.caption), first));
  // A letter wrong, left out or added in a name of more than four letters ("partculars", "closng bal"): the one heading it is nearest to.
  if (begins.length === 0 && wanted.length >= 4) {
    const nearestTo = (text: string): OutputColumn | undefined => {
      let nearest = 2;
      let found: OutputColumn | undefined;
      let tie = false;
      for (const column of columns) {
        for (const name of [norm(column.key), norm(column.caption)]) {
          if (name.length <= 4) continue;
          const apart = Math.min(...[-1, 0, 1].map((shift) => distance(text, name.slice(0, text.length + shift))));
          if (apart < nearest) { nearest = apart; found = column; tie = false; }
          else if (apart === nearest && found !== column) tie = true;
        }
      }
      return tie ? undefined : found;
    };
    const mended = nearestTo(wanted) ?? (wanted.includes(" ") && first.length >= 4 ? nearestTo(first) : undefined);
    if (mended) return mended;
  }
  return begins.find((column) => norm(column.key) === wanted || norm(column.caption) === wanted) ?? begins.find((column) => column.visible) ?? begins[0];
}

const figureOf = (operand: string): number | null => {
  const text = operand.trim().toLowerCase();
  if (text === "zero" || text === "nil") return 0;
  const found = new RegExp(String.raw`^(-?)\s*${NUMBER}$`).exec(text);
  return found ? (found[1] ? -1 : 1) * figure(found[2], found[3]) : null;
};

/** A test on a figure; a string says why the condition cannot be a test on figures. */
function numberTest(cond: ValueCondition): ((value: number) => boolean) | string {
  const numbers = cond.operands.map(figureOf);
  if (numbers.some((value) => value === null)) return `"${cond.operands.join(" and ")}" is not a number`;
  const [a, b] = numbers as number[];
  switch (cond.op) {
    case "zero": return (value) => Math.abs(value) < 0.005;
    case "nonzero": return (value) => Math.abs(value) >= 0.005;
    case "pos": return (value) => value > 0.005;
    case "neg": return (value) => value < -0.005;
    case "eq": return (value) => Math.abs(value - a) < 0.005;
    case "ne": return (value) => Math.abs(value - a) >= 0.005;
    case "lt": return (value) => value < a;
    case "le": return (value) => value <= a + 0.005;
    case "gt": return (value) => value > a;
    case "ge": return (value) => value >= a - 0.005;
    case "between": return (value) => value >= Math.min(a, b) - 0.005 && value <= Math.max(a, b) + 0.005;
    default: return `"${cond.op}" is for text, not for figures`;
  }
}

/** A test on a date cell; a string says why the condition cannot be a test on dates. */
function dateTest(cond: ValueCondition): ((cell: string) => boolean) | string {
  const ruleOf = (text: string) => readDates(` ${text.toLowerCase()} `).rule;
  const first = cond.operands[0] ?? "";
  const rule = cond.op === "between" ? ruleOf(`between ${first} and ${cond.operands[1] ?? ""}`) : ruleOf(first);
  switch (cond.op) {
    case "blank": return (cell) => cell.trim() === "";
    case "notblank": return (cell) => cell.trim() !== "";
    case "eq": case "between": case "ne": {
      if (!rule) return `"${cond.operands.join(" and ")}" is not a date`;
      const negate = cond.op === "ne";
      return (cell) => { const date = cellDate(cell.trim()); return date !== null && dateFits(rule, dayText(date)) !== negate; };
    }
    case "lt": case "le": case "gt": case "ge": {
      if (!rule || rule.kind !== "range") return `"${first}" is not a date (say a month with its year, or a day)`;
      return (cell) => {
        const date = cellDate(cell.trim());
        if (!date) return false;
        const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const from = rule.from.getTime();
        const to = new Date(rule.to.getFullYear(), rule.to.getMonth(), rule.to.getDate()).getTime();
        return cond.op === "lt" ? day < from : cond.op === "le" ? day <= to : cond.op === "gt" ? day > to : day >= from;
      };
    }
    default: return `"${cond.op}" is for text or figures, not for dates`;
  }
}

/** A test on a text cell; a string says why the condition cannot be a test on text. */
function textTest(cond: ValueCondition): ((cell: string) => boolean) | string {
  const wanted = (cond.operands[0] ?? "").toLowerCase();
  const lower = (cell: string) => cell.trim().toLowerCase();
  switch (cond.op) {
    case "contain": return (cell) => lower(cell).includes(wanted);
    case "notcontain": return (cell) => !lower(cell).includes(wanted);
    case "starts": return (cell) => lower(cell).startsWith(wanted);
    case "ends": return (cell) => lower(cell).endsWith(wanted);
    case "eq": return (cell) => lower(cell) === wanted;
    case "ne": return (cell) => lower(cell) !== wanted;
    case "blank": return (cell) => cell.trim() === "";
    case "notblank": return (cell) => cell.trim() !== "";
    default: return `"${cond.op}" is for figures or dates, not for text`;
  }
}

/** The test a column's cells must pass: by what the column holds (figures, dates or text). */
function cellTest(column: OutputColumn, rows: readonly OutputRow[], cond: ValueCondition): ((cell: string) => boolean) | string {
  const holdsDates = column.kind === "date" || (column.kind === "text" && rows.some((row) => cellDate((row.values[column.key] ?? "").trim()) !== null));
  if (holdsDates && cond.op !== "contain" && cond.op !== "notcontain" && cond.op !== "starts" && cond.op !== "ends") return dateTest(cond);
  if (column.kind === "number") {
    if (cond.op === "blank") return (cell) => cell.trim() === "";
    if (cond.op === "notblank") return (cell) => cell.trim() !== "";
    const test = numberTest(cond);
    return typeof test === "string" ? test : (cell) => { const raw = cell.replace(/[,\s]/g, ""); return test(raw === "" || !Number.isFinite(Number(raw)) ? 0 : Number(raw)); };
  }
  return textTest(cond);
}

/** What a column's cells hold, for the test they take: figures, dates or text. */
function columnMode(column: OutputColumn, rows: readonly OutputRow[], cond: ValueCondition): "number" | "date" | "text" {
  const holdsDates = column.kind === "date" || (column.kind === "text" && rows.some((row) => cellDate((row.values[column.key] ?? "").trim()) !== null));
  if (holdsDates && cond.op !== "contain" && cond.op !== "notcontain" && cond.op !== "starts" && cond.op !== "ends") return "date";
  return column.kind === "number" ? "number" : "text";
}

/** A condition written out in the bar's own words, the same for every column, with its operands as the report reads them (10,000; May 2026; 'sale'). */
function describeCondition(cond: ValueCondition, mode: "number" | "date" | "text"): string {
  const fixed: Partial<Record<ConditionOp, string>> = { zero: "is zero", nonzero: "is not zero", pos: "is positive", neg: "is negative", blank: "is blank", notblank: "is not blank" };
  if (fixed[cond.op]) return fixed[cond.op] as string;
  const [a = "", b = ""] = cond.operands;
  if (mode === "date") {
    const read = readDates(` ${(cond.op === "between" ? `between ${a} and ${b}` : a).toLowerCase()} `);
    const label = read.rule ? read.label : cond.operands.join(" and ");
    const rule = read.rule;
    switch (cond.op) {
      case "eq": return `is ${label}`;
      case "ne": return `is not ${label}`;
      case "between": return `between ${label.replace(" to ", " and ")}`;
      case "lt": return rule?.kind === "range" ? `is before ${dayText(rule.from)}` : `is before ${label}`;
      case "le": return rule?.kind === "range" ? `is on or before ${dayText(rule.to)}` : `is on or before ${label}`;
      case "gt": return rule?.kind === "range" ? `is after ${dayText(rule.to)}` : `is after ${label}`;
      default: return rule?.kind === "range" ? `is on or after ${dayText(rule.from)}` : `is on or after ${label}`;
    }
  }
  const operand = (text: string) => {
    if (mode !== "number") return `'${text}'`;
    const value = figureOf(text) ?? 0;
    return value === 0 ? "zero" : inWords(value);
  };
  switch (cond.op) {
    case "eq": return `is ${operand(a)}`;
    case "ne": return `is not ${operand(a)}`;
    case "lt": return `is less than ${operand(a)}`;
    case "le": return `is less than or equal to ${operand(a)}`;
    case "gt": return `is greater than ${operand(a)}`;
    case "ge": return `is greater than or equal to ${operand(a)}`;
    case "between": return `between ${operand(a)} and ${operand(b)}`;
    case "contain": return `contains ${operand(a)}`;
    case "notcontain": return `does not contain ${operand(a)}`;
    case "starts": return `starts with ${operand(a)}`;
    default: return `ends with ${operand(a)}`;
  }
}

function hideByClauses(output: ReportOutput, clauses: readonly Clause[], context: AskContext): AskResult {
  const leaf = output.rows.reduce((deepest, row) => (row.kind === "subtotal" && row.level > deepest ? row.level : deepest), -1);
  const closingColumns = closingColumnsOf(output.columns);
  const levels = new Set<number>();
  output.rows.forEach((row) => { if (row.kind === "data" && context.isHeading(row)) levels.add(context.headingLevel(row)); });
  const deepestHeading = Math.max(-1, ...levels);

  // A line's balance (the opening line, the closing line): its closing figure on its DR / CR side (CR is minus); a line with no closing figure
  // (the closing line) shows the balance on one side of Debit / Credit, so the larger of the two on its DR / CR side.
  const debitKey = amountColumnOf(output.columns, "debit");
  const creditKey = amountColumnOf(output.columns, "credit");
  const figureIn = (row: OutputRow, key: string | null): number | null => {
    const raw = key ? (row.values[key] ?? "").replace(/[,\s]/g, "") : "";
    return raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  };
  const balanceOf = (row: OutputRow): number => {
    const side = closingColumns?.side ? (row.values[closingColumns.side] ?? "").trim().toUpperCase() : "";
    const closing = figureIn(row, closingColumns?.closing ?? null);
    if (closing !== null) return side === "CR" ? -Math.abs(closing) : side === "DR" ? Math.abs(closing) : closing;
    const debit = figureIn(row, debitKey) ?? 0;
    const credit = figureIn(row, creditKey) ?? 0;
    const size = Math.max(Math.abs(debit), Math.abs(credit));
    return side === "CR" ? -size : side === "DR" ? size : debit - credit;
  };

  /** The question written out in full, one piece to a clause (made when the answer is known: a group's whole name, a line's whole text). */
  const canon: (() => string)[] = [];
  const captionOf = (column: OutputColumn) => column.caption || column.key;
  const stars = (level: number | null) => "*".repeat((level ?? 0) + 1);
  const groupTests: { level: number; name: string; seen: Set<string> }[] = [];
  const valueTests: { column: OutputColumn; test: (value: number) => boolean }[] = [];
  const cellTests: { column: OutputColumn; test: (cell: string) => boolean }[] = [];
  /** A line picked by a word in a column's cell and tested on its balance: `whole` (written #word) keeps the whole ledger when it passes. */
  const lineTests: { word: string; key: string | null; whole: boolean; last: boolean; test: (value: number) => boolean; seen: Set<string> }[] = [];
  const lineLabel = (row: OutputRow, key: string | null) => (key !== null ? row.values[key] ?? "" : Object.values(row.values).find((value) => value.trim() !== "") ?? "").trim();
  const lineTest = (group: string, level: number | null, word: string, whole: boolean, cond: ValueCondition, label: string): AskResult | null => {
    const column = group === "" ? undefined : columnByPrefix(output.columns, group);
    if (group !== "" && !column) return { problem: columnMissing(output.columns, group) };
    const test = numberTest(cond);
    if (typeof test === "string") return { problem: `'${label}': ${test}` };
    const lower = word.toLowerCase();
    const line = { word: lower, key: column?.key ?? null, whole, last: /^clos/.test(lower), test, seen: new Set<string>() };
    lineTests.push(line);
    const left = column ? captionOf(column) : stars(level);
    canon.push(() => `'${left} -${whole ? "#" : ""}${line.seen.size === 1 ? [...line.seen][0] : word}' ${describeCondition(cond, "number")}`);
    return null;
  };
  for (const clause of clauses) {
    if (leaf < 0 && clause.kind !== "column") return { problem: "Groups (the stars), a group's figure and a ledger's opening / closing line need a report with groups; this one has none. Name a column instead, e.g. 'date' is may2026" };
    if (clause.kind === "group") {
      if (!levels.has(clause.level)) return { problem: `This report has no group with ${clause.level + 1} star${clause.level === 0 ? "" : "s"} (it has ${[...levels].sort().map((level) => "*".repeat(level + 1)).join(" ")})` };
      const group = { level: clause.level, name: clause.name.toLowerCase(), seen: new Set<string>() };
      groupTests.push(group);
      canon.push(() => `'${stars(clause.level)} ${group.seen.size === 1 ? [...group.seen][0] : clause.name}'`);
      continue;
    }
    if (clause.kind === "balanceRow") {
      const refused = lineTest(clause.group, clause.level, clause.word, true, clause.cond, `#${clause.word}`);
      if (refused) return refused;
      continue;
    }
    const column = columnByPrefix(output.columns, clause.column);
    // 'parti -open': no figure column begins with "open", so it is a word in the column's cells: the lines that hold it stay (see #).
    if (!column && clause.kind === "groupValue") {
      const refused = lineTest(clause.group, clause.level, clause.column, false, clause.cond, clause.column);
      if (refused) return refused;
      continue;
    }
    if (!column) return { problem: columnMissing(output.columns, clause.column) };
    if (clause.kind === "groupValue") {
      if (clause.level !== null && clause.level !== deepestHeading) return { problem: `Only the deepest group (${"*".repeat(deepestHeading + 1)}) can be tested on a figure` };
      if (clause.group !== "" && !columnByPrefix(output.columns, clause.group)) return { problem: columnMissing(output.columns, clause.group) };
      const test = numberTest(clause.cond);
      if (typeof test === "string") return { problem: `'${clause.column}': ${test}` };
      valueTests.push({ column, test });
      const left = clause.group !== "" ? captionOf(columnByPrefix(output.columns, clause.group) as OutputColumn) : stars(clause.level);
      canon.push(() => `'${left} -${captionOf(column)}' ${describeCondition(clause.cond, "number")}`);
    } else {
      const test = cellTest(column, output.rows, clause.cond);
      if (typeof test === "string") return { problem: `'${clause.column}': ${test}` };
      cellTests.push({ column, test });
      canon.push(() => `'${captionOf(column)}' ${describeCondition(clause.cond, columnMode(column, output.rows, clause.cond))}`);
    }
  }
  const lineMatches = (candidate: OutputRow, key: string | null, word: string) => (key !== null
    ? (candidate.values[key] ?? "").toLowerCase().includes(word)
    : Object.values(candidate.values).some((value) => value.toLowerCase().includes(word)));
  const balanceLike = (column: OutputColumn) => /closing|bal/i.test(`${column.key} ${column.caption}`);
  const hide = new Set<number>();
  const names: string[] = [];
  let kept = 0;
  let total = 0;
  output.rows.forEach((row, index) => {
    if (row.kind === "data" && context.isHeading(row)) {
      const level = context.headingLevel(row);
      names[level] = headingText(row);
      names.length = level + 1;
      return;
    }
    if (row.kind !== "subtotal" || row.level !== leaf) return;
    const start = context.groupStart.get(index) ?? index;
    total += 1;
    let keep = groupTests.every((test) => (names[test.level] ?? "").toLowerCase().startsWith(test.name));
    if (keep) for (const test of groupTests) test.seen.add(names[test.level]);
    for (const { column, test } of valueTests) {
      if (!keep) break;
      let value = 0;
      for (let at = index - 1; at >= start; at -= 1) {
        const candidate = output.rows[at];
        if (candidate.kind !== "data" || context.isHeading(candidate)) continue;
        const raw = (candidate.values[column.key] ?? "").replace(/[,\s]/g, "");
        if (raw === "" || !Number.isFinite(Number(raw))) continue;
        if (balanceLike(column)) {
          const side = closingColumns?.closing === column.key && closingColumns.side ? (candidate.values[closingColumns.side] ?? "").trim().toUpperCase() : "";
          value = side === "CR" ? -Math.abs(Number(raw)) : side === "DR" ? Math.abs(Number(raw)) : Number(raw);
          break;
        }
        value += Number(raw);
      }
      keep = test(value);
    }
    // #open / #close: the balance on the ledger's opening (first) or closing (last) line decides, and the whole ledger stays; a ledger with
    // no such line (no opening balance is written when it is nil) counts as nil.
    for (const line of lineTests) {
      if (!line.whole || !keep) continue;
      let picked: OutputRow | null = null;
      for (let at = start; at < index; at += 1) {
        const candidate = output.rows[at];
        if (candidate.kind !== "data" || context.isHeading(candidate) || !lineMatches(candidate, line.key, line.word)) continue;
        picked = candidate;
        if (!line.last) break;
      }
      if (picked) line.seen.add(lineLabel(picked, line.key));
      keep = line.test(picked ? balanceOf(picked) : 0);
    }
    const partial = lineTests.filter((line) => !line.whole);
    const own: number[] = [];
    if (keep && (cellTests.length > 0 || partial.length > 0)) {
      let last = true;
      let entries = 0;
      for (let at = start; at < index; at += 1) {
        const candidate = output.rows[at];
        if (candidate.kind !== "data" || context.isHeading(candidate)) continue;
        const narration = /narration/i.test(candidate.rowType);
        const fit: boolean = narration ? last : cellTests.every(({ column, test }) => test(candidate.values[column.key] ?? ""))
          && partial.every((line) => {
            const hit = lineMatches(candidate, line.key, line.word) && line.test(balanceOf(candidate));
            if (hit) line.seen.add(lineLabel(candidate, line.key));
            return hit;
          });
        if (!narration) last = fit;
        if (!fit) own.push(at);
        else if (!narration) entries += 1;
      }
      keep = entries > 0;
    }
    if (keep) { kept += 1; for (const at of own) hide.add(at); return; }
    for (let at = start; at <= index; at += 1) hide.add(at);
  });
  if (leaf < 0) {
    // No groups: each row is an entry, tested on its own cells (its narration lines follow it).
    let last = true;
    output.rows.forEach((row, index) => {
      if (row.kind !== "data" || context.isHeading(row) || row.rowType === "FT" || row.rowType === "COUNT") return;
      const narration = /narration/i.test(row.rowType);
      const fit: boolean = narration ? last : cellTests.every(({ column, test }) => test(row.values[column.key] ?? ""));
      if (!narration) { last = fit; total += 1; if (fit) kept += 1; }
      if (!fit) hide.add(index);
    });
  }
  return { hide, kept, total, unit: leaf < 0 ? "rows" : "ledgers", text: canon.map((make) => make()).join(", ") };
}

/** The rows to take off the report for a plan: in plain words (see parseAsk) or in the structured form (see above). */
export function askHideRows(output: ReportOutput, plan: AskPlan, context: AskContext): AskResult {
  if (plan.kind === "structured") return hideByClauses(output, plan.clauses, context);
  const result = hideByQuery(output, plan.query, context);
  return "problem" in result ? result : { ...result, text: plan.summary };
}
