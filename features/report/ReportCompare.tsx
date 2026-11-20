"use client";

import { useMemo, useState } from "react";
import type { CompareLine, CompareRow } from "../../lib/report/compare";
import { addDays, amountOf, changePercent, compareLines, COUNT_KEY, isEntry, compareRows, formatDate, monthBefore, parseDate, periodBefore, planPeriod } from "../../lib/report/compare";
import type { ReportOutput } from "../../lib/report/types";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";
import { columnCaption, groupCaptions } from "../../lib/report/names";
import { PanelButtons, usePanelTools } from "./panelTools";

/**
 * Compare periods (web only): the report run again for another period of the same accounting year,
 * set beside the one on screen. Each group's subtotal (and the final total) of the amount column
 * chosen is shown as now, before, the change and its percentage. A report with no group has only
 * its final total to compare, so tick a group (account, book, area ...) to compare by it.
 *
 * Periods: the one just before (the same number of days), the same dates a month earlier, or dates
 * of your own. They must lie inside the accounting year, whose data this is.
 */

export type CompareResult = Readonly<{ output: ReportOutput | null; error?: string; empty?: boolean }>;

/** The table's order: the column whose heading was clicked and which way (null: the report's own order). */
type SortState = { by: "name" | "now" | "nowCount" | "before" | "beforeCount" | "change" | "pct"; dir: "asc" | "desc" } | null;
/** Which of the Now figures to list. */
type Show = "all" | "positive" | "negative" | "zero" | "nonzero";
type SavedView = { mode: "period" | "month" | "lastyear" | "custom"; valueKey: string; sort: SortState; show: Show; by: string };

const isoOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromIso = (text: string) => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text); return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null; };
const money = (value: number, places: number) => value.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places });

/**
 * The rows sorted inside their groups. The rows come as the report prints them: the lines of a group first, then the group's own line
 * (a deeper level before the line of the level above it). So each line takes the deeper lines just before it as its children, and every
 * set of brothers is sorted on its own, the group's line staying after its children.
 */
function sortWithin(rows: readonly CompareRow[], sort: NonNullable<SortState>): CompareRow[] {
  type Node = { row: CompareRow; children: Node[] };
  const pending: Node[] = [];
  for (const row of rows) {
    const node: Node = { row, children: [] };
    while (pending.length > 0 && pending[pending.length - 1].row.level > row.level) node.children.unshift(pending.pop() as Node);
    pending.push(node);
  }
  const sign = sort.dir === "asc" ? 1 : -1;
  const byName = (x: string, y: string) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
  /** The change as a ratio of what it was; a group with nothing before sorts as the biggest rise. */
  const ratio = (row: CompareRow) => (row.then === 0 ? (row.now === 0 ? 0 : row.now > 0 ? 1e18 : -1e18) : (row.now - row.then) / Math.abs(row.then));
  const order = (x: CompareRow, y: CompareRow) => sign * (sort.by === "name" ? byName(x.label, y.label) : sort.by === "now" ? x.now - y.now : sort.by === "nowCount" ? x.nowCount - y.nowCount : sort.by === "beforeCount" ? x.thenCount - y.thenCount : sort.by === "before" ? x.then - y.then : sort.by === "change" ? (x.now - x.then) - (y.now - y.then) : ratio(x) - ratio(y));
  const flatten = (nodes: readonly Node[]): CompareRow[] => [...nodes].sort((x, y) => order(x.row, y.row)).flatMap((node) => [...flatten(node.children), node.row]);
  return flatten(pending);
}

/** Each name of a column (the Particulars) once, with every number column summed over its entries, and the total of all: the lines of a compare by name. */
function partyLines(output: Pick<ReportOutput, "columns" | "rows">, key: string): CompareLine[] {
  const numbers = output.columns.filter((column) => column.kind === "number");
  const blank = (): Record<string, number> => Object.fromEntries(numbers.map((column) => [column.key, 0]));
  const sums = new Map<string, Record<string, number>>();
  const whole = blank();
  whole[COUNT_KEY] = 0;
  for (const row of output.rows) {
    if (!isEntry(row)) continue;
    const label = (row.values[key] ?? "").trim() || "(blank)";
    const sum = sums.get(label) ?? { ...blank(), [COUNT_KEY]: 0 };
    sum[COUNT_KEY] += 1;
    whole[COUNT_KEY] += 1;
    for (const column of numbers) {
      const value = amountOf(row.values[column.key]);
      sum[column.key] += value;
      whole[column.key] += value;
    }
    sums.set(label, sum);
  }
  return [
    ...[...sums].map(([label, values]): CompareLine => ({ key: `subtotal|0|${label}`, label, level: 0, kind: "subtotal", values })),
    { key: "total|-1|All entries", label: "All entries", level: -1, kind: "total", values: whole },
  ];
}

/** The lines of one group level only, a name met under several groups counted once (its figures and entries added). */
function levelLines(lines: readonly CompareLine[], level: number): CompareLine[] {
  const merged = new Map<string, CompareLine>();
  for (const line of lines.filter((item) => item.kind === "subtotal" && item.level === level)) {
    const key = `subtotal|0|${line.label}`;
    const known = merged.get(key);
    if (!known) { merged.set(key, { ...line, key, level: 0, values: { ...line.values } }); continue; }
    for (const [column, value] of Object.entries(line.values)) known.values[column] = (known.values[column] ?? 0) + value;
  }
  return [...merged.values(), ...lines.filter((item) => item.kind === "total")];
}

/** The groups of several parts of one period added together (a group is found by its level and label). */
function addLines(parts: readonly (readonly CompareLine[])[]): CompareLine[] | null {
  if (parts.length === 0) return null;
  const merged = new Map<string, CompareLine>();
  for (const part of parts) {
    for (const line of part) {
      const known = merged.get(line.key);
      if (!known) { merged.set(line.key, { ...line, values: { ...line.values } }); continue; }
      for (const [column, value] of Object.entries(line.values)) known.values[column] = (known.values[column] ?? 0) + value;
    }
  }
  const lines = [...merged.values()];
  return [...lines.filter((line) => line.kind !== "total"), ...lines.filter((line) => line.kind === "total")];
}

export function ReportCompare({ output, period, yearStart, yearEnd, load, onClose }: {
  output: ReportOutput;
  /** The dates the output was generated for (dd/MMM/yyyy). */
  period: Readonly<{ from: string; upto: string }>;
  yearStart: string;
  yearEnd: string;
  load: (from: string, upto: string, lastYear?: boolean) => Promise<CompareResult>;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const tools = usePanelTools<SavedView>(`smartwinfa.compare.${output.reportKey ?? output.title}`);
  const [mode, setMode] = useState<"period" | "month" | "lastyear" | "custom">(tools.saved.mode ?? "period");
  const now = { from: parseDate(period.from), upto: parseDate(period.upto) };
  const [customFrom, setCustomFrom] = useState(now.from ? isoOf(addDays(now.from, -30)) : "");
  const [customUpto, setCustomUpto] = useState(now.from ? isoOf(addDays(now.from, -1)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** What the earlier period read: its outputs (none: nothing was recorded then); the lines are worked out from them for the group chosen. */
  const [before, setBefore] = useState<{ outputs: ReportOutput[]; from: string; upto: string } | null>(null);
  const [byChoice, setByChoice] = useState(tools.saved.by ?? "");
  const [valueKey, setValueKey] = useState(tools.saved.valueKey ?? "");
  const [sort, setSort] = useState<SortState>(tools.saved.sort && typeof tools.saved.sort === "object" ? tools.saved.sort : null);
  const [show, setShow] = useState<Show>(tools.saved.show ?? "all");

  // A report with a Particulars column is compared name by name (each once), whatever groups it has; one without it, group by group.
  const partyColumn = useMemo(() => output.columns.find((candidate) => candidate.kind === "text" && /particular/i.test(`${candidate.key} ${candidate.caption}`) && output.rows.some((row) => isEntry(row) && (row.values[candidate.key] ?? "").trim() !== "")), [output]);
  // A report that has groups (Group 1, 2, 3 ...) offers them in a drop-down: its names, or its groups one level at a time, or all of them nested.
  // A group is named as the operator ticked it (Area, Account ...), not by its column (SMART_SELECTED_ADDON1, SMART_NAME).
  const ticked = groupCaptions(output);
  const groupNames = (output.groups ?? []).map((raw, at) => {
    const plain = raw.replace(/^SMART_/i, "").replace(/^SELECTED_ADDON(\d+)$/i, "Addon $1").replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
    return ticked[at] || plain;
  });
  // When the Particulars are the names of one of the groups already (a ledger by Account), that group is the by-name compare and Particulars is not offered again.
  const baseLines = useMemo(() => compareLines(output), [output]);
  const partyLevel = useMemo(() => {
    if (!partyColumn) return -1;
    const names = new Set(output.rows.filter((row) => isEntry(row)).map((row) => (row.values[partyColumn.key] ?? "").trim() || "(blank)"));
    for (let at = 0; at < (output.groups ?? []).length; at += 1) {
      const labels = new Set(baseLines.filter((line) => line.kind === "subtotal" && line.level === at).map((line) => line.label));
      if (labels.size === names.size && [...labels].every((label) => names.has(label))) return at;
    }
    return -1;
  }, [output, partyColumn, baseLines]);
  const choices = [
    ...(partyColumn && partyLevel < 0 ? [{ value: "party", label: columnCaption(output, partyColumn) }] : []),
    ...(groupNames.length > 0 ? [{ value: "all", label: "All groups" }, ...groupNames.map((name, at) => ({ value: `level:${at}`, label: name }))] : []),
  ];
  const by = choices.some((choice) => choice.value === byChoice) ? byChoice : partyLevel >= 0 ? `level:${partyLevel}` : partyColumn ? "party" : groupNames.length > 0 ? "all" : "";
  const linesOf = (from: Pick<ReportOutput, "columns" | "rows">) => (by === "party" && partyColumn ? partyLines(from, partyColumn.key) : by.startsWith("level:") ? levelLines(compareLines(from), Number(by.slice(6))) : compareLines(from));
  const nameCaption = by === "party" && partyColumn ? columnCaption(output, partyColumn) : by.startsWith("level:") ? groupNames[Number(by.slice(6))] ?? "Group" : "Group";
  const current = useMemo(() => linesOf(output), [output, by, partyColumn]); // eslint-disable-line react-hooks/exhaustive-deps -- linesOf follows by
  const total = current.find((line) => line.kind === "total");
  const summed = output.columns.filter((column) => column.kind === "number" && (total ? total.values[column.key] !== 0 || current.some((line) => line.values[column.key] !== 0) : true) && !/CLOSING|BAL|RATE|PERC|%/i.test(`${column.key} ${column.caption}`));
  const column = summed.find((candidate) => candidate.key === valueKey) ?? summed[0];

  const range = (): { from: Date; upto: Date } | string => {
    const from = parseDate(period.from);
    const upto = parseDate(period.upto);
    if (!from || !upto) return "The report's dates are not known.";
    if (mode === "month") return { from: monthBefore(from), upto: monthBefore(upto) };
    if (mode === "lastyear") return { from: new Date(from.getFullYear() - 1, from.getMonth(), from.getDate()), upto: new Date(upto.getFullYear() - 1, upto.getMonth(), upto.getDate()) };
    if (mode === "custom") {
      const a = fromIso(customFrom);
      const b = fromIso(customUpto);
      if (!a || !b) return "Enter both dates.";
      return a > b ? "The From date is after the Upto date." : { from: a, upto: b };
    }
    return periodBefore(from, upto);
  };

  const run = async () => {
    const dates = range();
    if (typeof dates === "string") { setError(dates); return; }
    // Each year is a database of its own: a period in last year, or across the year's start, is read from the years it lies in and added together.
    const plan = planPeriod(dates, yearStart, yearEnd, mode === "lastyear");
    if ("error" in plan) { setError(plan.error); return; }
    setError("");
    setBusy(true);
    try {
      const outputs: ReportOutput[] = [];
      for (const part of plan.parts) {
        const result = await load(formatDate(part.from), formatDate(part.upto), part.lastYear);
        if (result.error) { setError(result.error); return; }
        if (result.output) outputs.push(result.output);
      }
      setBefore({ outputs, from: formatDate(dates.from), upto: formatDate(dates.upto) });
    } finally {
      setBusy(false);
    }
  };

  const places = column?.decimals ?? 2;
  const previous = useMemo(() => {
    if (!before || before.outputs.length === 0) return [];
    const parts = before.outputs.map((one) => linesOf(one));
    return parts.length === 1 ? parts[0] : addLines(parts) ?? [];
  }, [before, by]); // eslint-disable-line react-hooks/exhaustive-deps -- linesOf follows by
  const table = (() => {
    if (!column || !before) return [];
    const rows = compareRows(current, previous, column.key);
    const keep = (figure: number) => (show === "positive" ? figure > 0 : show === "negative" ? figure < 0 : show === "zero" ? figure === 0 : show === "nonzero" ? figure !== 0 : true);
    const rest = rows.filter((row) => row.kind !== "total" && keep(row.now));
    const ordered = sort ? sortWithin(rest, sort) : rest;
    return [...ordered, ...rows.filter((row) => row.kind === "total")];
  })();
  /** Whether the report has any group lines at all, before the Show choice takes some off (so the choice itself never disappears). */
  const hasLines = column && before ? compareRows(current, previous, column.key).some((row) => row.kind !== "total") : false;
  const copyLines = [[nameCaption, "Now", "Count now", "Before", "Count before", "Change", "%"], ...table.map((row) => [row.label, money(row.now, places), String(row.nowCount), money(row.then, places), String(row.thenCount), money(row.now - row.then, places), changePercent(row.now, row.then)])];

  const totalRow = table.find((row) => row.kind === "total") ?? (table.length === 0 ? undefined : { label: "Total", level: -1, kind: "total" as const, now: table.reduce((sum, row) => sum + row.now, 0), then: table.reduce((sum, row) => sum + row.then, 0) });
  const change = (now: number, then: number) => now - then;
  const percent = changePercent;
  const arrow = (value: number) => (value > 0 ? "▲" : value < 0 ? "▼" : "•");

  return (
    <aside className="rp-chart rp-chart-wide rp-compare" aria-label="Compare periods">
      <div className="rp-chart-head">
        <b><Icon name="compare" />Compare periods</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close compare">×</button>
      </div>
      <p className="rp-chart-note">Now: {period.from} – {period.upto}</p>
      <div className="rp-chart-controls">
        <label>Compare with
          <select value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setBefore(null); setError(""); }}>
            <option value="period">The period just before</option>
            <option value="month">Same dates, a month earlier</option>
            <option value="lastyear">Same period, last year</option>
            <option value="custom">Dates of my own</option>
          </select>
        </label>
        {summed.length > 1 && (
          <label>Value
            <select value={column?.key ?? ""} onChange={(event) => setValueKey(event.target.value)}>
              {summed.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.caption}</option>)}
            </select>
          </label>
        )}
        {groupNames.length > 0 && (
          <label>Compare by
            <select value={by} onChange={(event) => { setByChoice(event.target.value); setSort(null); }}>
              {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {mode === "custom" && (
        <div className="rp-chart-controls">
          <label>From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
          <label>Upto<input type="date" value={customUpto} onChange={(event) => setCustomUpto(event.target.value)} /></label>
        </div>
      )}
      <button type="button" className="mp-btn mp-btn-green rp-compare-run" onClick={() => void run()} disabled={busy}>{busy ? "Comparing…" : "Compare"}</button>
      {error && <p className="rp-compare-error" role="alert">{error}</p>}
      {summed.length === 0 && <p className="rp-chart-empty">This report has no amount column to compare.</p>}

      {before && column && (
        <>
          <p className="rp-chart-note">Before: {before.from} – {before.upto}{before.outputs.length === 0 ? " · nothing was recorded in it" : ""}</p>
          {totalRow && (
            <div className="rp-cards">
              <div className="rp-card"><span>{column.caption} now</span><b>{money(totalRow.now, places)}</b></div>
              <div className="rp-card"><span>{column.caption} before</span><b>{money(totalRow.then, places)}</b></div>
              <div className="rp-card rp-card-wide"><span>Change</span><b>{arrow(change(totalRow.now, totalRow.then))} {money(Math.abs(change(totalRow.now, totalRow.then)), places)} <small className="rp-compare-pct">{percent(totalRow.now, totalRow.then)}</small></b></div>
            </div>
          )}
          {!hasLines && <p className="rp-chart-note">This report has no groups, so only its total is compared. Tick a group (account, book, area …) to compare by it.</p>}
          {hasLines && (
            <>
              <div className="rp-chart-controls rp-growth-tools">
                <label>Show ({column.caption} now)
                  <select value={show} onChange={(event) => setShow(event.target.value as Show)}>
                    <option value="all">All figures</option>
                    <option value="positive">Only positive</option>
                    <option value="negative">Only negative</option>
                    <option value="zero">Only zero</option>
                    <option value="nonzero">Not zero</option>
                  </select>
                </label>
                {sort && <button type="button" className="mp-btn mp-btn-plain" onClick={() => setSort(null)} title="Back to the order of the report">Report order</button>}
              </div>
              {!table.some((row) => row.kind !== "total") && <p className="rp-chart-note" role="status">No line has {show === "positive" ? "a positive" : show === "negative" ? "a negative" : show === "zero" ? "a zero" : "a non-zero"} {column.caption} now. Choose another Show option to see the lines again.</p>}
              <p className="rp-chart-note">Click a heading to sort by it, again to turn it round, a third time to go back to the report's order. Groups inside a group are sorted within it.</p>
              <PanelButtons note={tools.note} onCopy={() => void tools.copy(copyLines)} onSave={() => tools.save({ mode, valueKey: column?.key ?? "", sort, show, by: byChoice })} onReset={tools.reset} />
              <table className="rp-legend rp-compare-table">
                <thead>
                  <tr>
                    {([["name", nameCaption, "asc"], ["now", "Now", "desc"], ["nowCount", "Count", "desc"], ["before", "Before", "desc"], ["beforeCount", "Count", "desc"], ["change", "Change", "desc"], ["pct", "%", "desc"]] as const).map(([field, label, first]) => (
                      <th key={field} className="rp-growth-sort" aria-sort={sort?.by === field ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} title="Click to sort; again to turn it round; a third time to go back to the report's order" onClick={() => setSort(sort?.by !== field ? { by: field, dir: first } : sort.dir === first ? { by: field, dir: first === "asc" ? "desc" : "asc" } : null)}>
                        {label}{sort?.by === field ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.map((row, index) => (
                    <tr key={`${row.kind}${row.level}${row.label}${index}`} className={row.kind === "total" ? "rp-compare-total" : ""}>
                      <td className="rp-legend-name" style={{ paddingLeft: 4 + Math.max(0, row.level) * 10 }} title={row.label}>{row.label}</td>
                      <td className="rp-legend-num">{money(row.now, places)}</td>
                      <td className="rp-legend-num">{row.nowCount.toLocaleString("en-IN")}</td>
                      <td className="rp-legend-num">{money(row.then, places)}</td>
                      <td className="rp-legend-num">{row.thenCount.toLocaleString("en-IN")}</td>
                      <td className="rp-legend-num">{arrow(change(row.now, row.then))} {money(Math.abs(change(row.now, row.then)), places)}</td>
                      <td className="rp-legend-num">{percent(row.now, row.then)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </aside>
  );
}
