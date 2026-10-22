import type { ExternalTable, Value } from "./sheetFormula";

/**
 * The reports open in the program's windows, for VLOOKUP in the Add Column formulas: each report grid registers a snapshot of what it shows
 * (its title, its columns in the order they are shown, and the cell of every entry row), and a formula names one by its title, with
 * an optional range of columns as Excel names a range: "Ledger", "Ledger!C:H" or "Ledger!PARTICULARS:CLOSINGS". The first column of the
 * range is the one searched; the column numbers count from it.
 */

export type OpenReportSnapshot = Readonly<{
  /** The names the report answers to: the window's report name and the title of its output. */
  titles: readonly string[];
  /** The columns in the order they are shown. */
  columns: readonly { key: string; caption: string }[];
  /** The entry rows: one array of cells for each, in the order of `columns`. */
  rows: readonly (readonly Value[])[];
}>;

type Entry = { snapshot: () => OpenReportSnapshot };

const reports = new Set<Entry>();
const listeners = new Set<() => void>();
let version = 0;

/** Tells the grids that a report opened, closed or changed, so the formulas that look it up are worked out again. */
export function notifyOpenReports(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function subscribeOpenReports(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const openReportsVersion = (): number => version;

/** Registers a report (its snapshot is taken when a formula looks it up); returns the function that takes it out again. */
export function registerOpenReport(snapshot: () => OpenReportSnapshot): () => void {
  const entry: Entry = { snapshot };
  reports.add(entry);
  notifyOpenReports();
  return () => { reports.delete(entry); notifyOpenReports(); };
}

/** The other open windows with data (reports, masters, small entries), for the Add Column lookup helper: the name to write and the columns each has. `except` is the report asking, which is not offered. */
export function listOpenReports(except?: () => OpenReportSnapshot): { title: string; columns: readonly string[] }[] {
  return [...reports]
    .filter((entry) => entry.snapshot !== except)
    .map((entry) => { const shot = entry.snapshot(); return { title: shot.titles[0] ?? "", columns: shot.columns.map((column) => column.caption) }; })
    .filter((report) => report.title !== "");
}

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** The column a range end names: by caption (or key), else by its Excel letter (A is the first column shown). */
function columnAt(columns: OpenReportSnapshot["columns"], name: string): number {
  const text = name.replace(/\$/g, "").replace(/\d+$/, "").trim();
  // The whole text first (a caption such as TAX DESCRIPTION1 ends in a digit), then without a trailing row number (C1).
  const wholeAt = columns.findIndex((column) => same(column.caption, name.trim()) || same(column.key, name.trim()));
  if (wholeAt >= 0) return wholeAt;
  const byName = columns.findIndex((column) => same(column.caption, text) || same(column.key, text));
  if (byName >= 0) return byName;
  if (/^[A-Za-z]{1,3}$/.test(text)) {
    let n = 0;
    for (const ch of text.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    if (n >= 1 && n <= columns.length) return n - 1;
  }
  return -1;
}

/**
 * The table a VLOOKUP reference stands for, or the error Excel gives: #REF! when no open report answers to the name, or the range
 * names a column it does not have.
 */
export function resolveOpenReport(reference: string): ExternalTable | string {
  const bang = reference.lastIndexOf("!");
  const title = (bang >= 0 ? reference.slice(0, bang) : reference).trim().replace(/^'(.*)'$/, "$1");
  const range = bang >= 0 ? reference.slice(bang + 1).trim() : "";
  if (title === "") return "#REF!";
  const all = [...reports].map((entry) => entry.snapshot());
  const exact = all.filter((report) => report.titles.some((name) => same(name, title)));
  const partial = exact.length > 0 ? exact : all.filter((report) => report.titles.some((name) => name.toUpperCase().includes(title.toUpperCase())));
  const report = partial[0];
  if (!report) return "#REF!";
  let first = 0;
  let last = report.columns.length - 1;
  if (range !== "") {
    const [from, to = from] = range.split(":");
    first = columnAt(report.columns, from);
    last = columnAt(report.columns, to);
    if (first < 0 || last < 0) return "#REF!";
    // A range written backwards ("Ledger!H:C") still searches its first-named column: the columns are taken in that order.
  }
  const order = first <= last ? Array.from({ length: last - first + 1 }, (_, at) => first + at) : Array.from({ length: first - last + 1 }, (_, at) => first - at);
  return { rows: report.rows.map((row) => order.map((at) => row[at] ?? null)) };
}
