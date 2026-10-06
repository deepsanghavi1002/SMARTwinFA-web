"use client";

import { useMemo, useState } from "react";
import { addDays, changePercent, compareLines, compareRows, formatDate, monthBefore, parseDate, periodBefore } from "../../lib/report/compare";
import type { ReportOutput } from "../../lib/report/types";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";

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

const isoOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromIso = (text: string) => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text); return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null; };
const money = (value: number, places: number) => value.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places });

export function ReportCompare({ output, period, yearStart, yearEnd, load, onClose }: {
  output: ReportOutput;
  /** The dates the output was generated for (dd/MMM/yyyy). */
  period: Readonly<{ from: string; upto: string }>;
  yearStart: string;
  yearEnd: string;
  load: (from: string, upto: string) => Promise<CompareResult>;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const [mode, setMode] = useState<"period" | "month" | "custom">("period");
  const now = { from: parseDate(period.from), upto: parseDate(period.upto) };
  const [customFrom, setCustomFrom] = useState(now.from ? isoOf(addDays(now.from, -30)) : "");
  const [customUpto, setCustomUpto] = useState(now.from ? isoOf(addDays(now.from, -1)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [before, setBefore] = useState<{ output: ReportOutput | null; from: string; upto: string } | null>(null);
  const [valueKey, setValueKey] = useState("");
  const [biggest, setBiggest] = useState(false);

  const current = useMemo(() => compareLines(output), [output]);
  const total = current.find((line) => line.kind === "total");
  const summed = output.columns.filter((column) => column.kind === "number" && (total ? total.values[column.key] !== 0 || current.some((line) => line.values[column.key] !== 0) : true) && !/CLOSING|BAL|RATE|PERC|%/i.test(`${column.key} ${column.caption}`));
  const column = summed.find((candidate) => candidate.key === valueKey) ?? summed[0];

  const range = (): { from: Date; upto: Date } | string => {
    const from = parseDate(period.from);
    const upto = parseDate(period.upto);
    if (!from || !upto) return "The report's dates are not known.";
    if (mode === "month") return { from: monthBefore(from), upto: monthBefore(upto) };
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
    const start = parseDate(yearStart);
    const end = parseDate(yearEnd);
    if ((start && dates.from < start) || (end && dates.upto > end)) { setError(`That period (${formatDate(dates.from)} – ${formatDate(dates.upto)}) is outside the accounting year ${yearStart} – ${yearEnd}. Choose other dates.`); return; }
    setError("");
    setBusy(true);
    try {
      const result = await load(formatDate(dates.from), formatDate(dates.upto));
      if (result.error) { setError(result.error); return; }
      setBefore({ output: result.output, from: formatDate(dates.from), upto: formatDate(dates.upto) });
    } finally {
      setBusy(false);
    }
  };

  const places = column?.decimals ?? 2;
  const previous = useMemo(() => (before?.output ? compareLines(before.output) : []), [before]);
  const table = (() => {
    if (!column || !before) return [];
    const rows = compareRows(current, previous, column.key);
    const rest = rows.filter((row) => row.kind !== "total");
    if (biggest && new Set(rest.map((row) => row.level)).size === 1) rest.sort((x, y) => Math.abs(y.now - y.then) - Math.abs(x.now - x.then));
    return [...rest, ...rows.filter((row) => row.kind === "total")];
  })();

  const totalRow = table.find((row) => row.kind === "total") ?? (table.length === 0 ? undefined : { label: "Total", level: -1, kind: "total" as const, now: table.reduce((sum, row) => sum + row.now, 0), then: table.reduce((sum, row) => sum + row.then, 0) });
  const change = (now: number, then: number) => now - then;
  const percent = changePercent;
  const arrow = (value: number) => (value > 0 ? "▲" : value < 0 ? "▼" : "•");

  return (
    <aside className="rp-chart rp-compare" aria-label="Compare periods">
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
          <p className="rp-chart-note">Before: {before.from} – {before.upto}{before.output === null ? " · nothing was recorded in it" : ""}</p>
          {totalRow && (
            <div className="rp-cards">
              <div className="rp-card"><span>{column.caption} now</span><b>{money(totalRow.now, places)}</b></div>
              <div className="rp-card"><span>{column.caption} before</span><b>{money(totalRow.then, places)}</b></div>
              <div className="rp-card rp-card-wide"><span>Change</span><b>{arrow(change(totalRow.now, totalRow.then))} {money(Math.abs(change(totalRow.now, totalRow.then)), places)} <small className="rp-compare-pct">{percent(totalRow.now, totalRow.then)}</small></b></div>
            </div>
          )}
          {table.filter((row) => row.kind !== "total").length === 0 && <p className="rp-chart-note">This report has no groups, so only its total is compared. Tick a group (account, book, area …) to compare by it.</p>}
          {table.some((row) => row.kind !== "total") && (
            <>
              <label className="rp-compare-sort"><input type="checkbox" checked={biggest} onChange={(event) => setBiggest(event.target.checked)} /> Biggest change first</label>
              <table className="rp-legend rp-compare-table">
                <thead><tr><th>Group</th><th>Now</th><th>Before</th><th>Change</th><th>%</th></tr></thead>
                <tbody>
                  {table.map((row, index) => (
                    <tr key={`${row.kind}${row.level}${row.label}${index}`} className={row.kind === "total" ? "rp-compare-total" : ""}>
                      <td className="rp-legend-name" style={{ paddingLeft: 4 + Math.max(0, row.level) * 10 }} title={row.label}>{row.label}</td>
                      <td className="rp-legend-num">{money(row.now, places)}</td>
                      <td className="rp-legend-num">{money(row.then, places)}</td>
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
