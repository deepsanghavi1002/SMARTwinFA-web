"use client";

import { useMemo, useState } from "react";
import { addDays, formatDate, monthBefore, parseDate, periodBefore } from "../../lib/report/compare";
import { GROUP_PREFIX, movers, quietParties, rankParties, withGroups } from "../../lib/report/growth";
import type { MoverKind } from "../../lib/report/growth";
import type { ReportOutput } from "../../lib/report/types";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";
import type { CompareResult } from "./ReportCompare";

/**
 * Business growth (web only), from the entries on screen: the parties ranked by an amount with
 * their A / B / C class, the parties that grew, fell, are new or are gone against an earlier
 * period, and the parties with no entry for a number of days (a list to call, as CSV).
 * The sums are in lib/report/growth.ts.
 */

const money = (value: number, places: number) => value.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places });
const KIND: Record<MoverKind, string> = { new: "New", gone: "Gone", up: "▲ Up", down: "▼ Down", same: "Same" };
const LIMIT = 200;

function downloadCsv(name: string, lines: readonly (readonly string[])[]) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + lines.map((line) => line.map(quote).join(",")).join(String.fromCharCode(13, 10))], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function GrowthPanel({ output, period, yearStart, yearEnd, load, onClose, onPick }: {
  output: ReportOutput;
  /** The dates the output was generated for (dd/MMM/yyyy). */
  period: Readonly<{ from: string; upto: string }>;
  yearStart: string;
  yearEnd: string;
  load: (from: string, upto: string) => Promise<CompareResult>;
  onClose: () => void;
  /** Drill-down: show a party's rows in the grid (its filter on the party column); absent when the grid cannot filter. */
  onPick?: (columnKey: string, party: string) => void;
}) {
  useEscapeClose(onClose);
  const [tab, setTab] = useState<"top" | "movers" | "quiet">("top");
  // The report's own groups (area, zone, the party heading ...) join the party list, so a growth can be measured by any of them.
  const grouped = useMemo(() => withGroups(output), [output]);
  const work = grouped.output;
  const texts: { key: string; caption: string }[] = [
    ...output.columns.filter((column) => column.kind === "text" && column.key !== "HEADING_COLUMN_BY_SYSTEM"),
    ...grouped.groups.map((group) => ({ key: group.key, caption: `${group.caption} (group)` })),
  ];
  const numbers = output.columns.filter((column) => column.kind === "number" && !/CLOSING|BAL|RATE|PERC|%|^DR_CR$/i.test(`${column.key} ${column.caption}`));
  const dates = output.columns.filter((column) => column.kind === "date");
  const [byKey, setByKey] = useState("");
  const [valueKey, setValueKey] = useState("");
  const [dateKey, setDateKey] = useState("");
  const by = texts.find((column) => column.key === byKey) ?? texts.find((column) => !column.key.startsWith(GROUP_PREFIX) && /PARTICULARS|PARTY|NAME|ACCOUNT/i.test(`${column.key} ${column.caption}`)) ?? texts.find((column) => column.key === `${GROUP_PREFIX}AC`) ?? texts[0];
  const value = numbers.find((column) => column.key === valueKey) ?? numbers[0];
  const dateColumn = dates.find((column) => column.key === dateKey) ?? dates[0];
  const places = value?.decimals ?? 2;

  const ranked = by && value ? rankParties(work, by.key, value.key) : [];

  const [mode, setMode] = useState<"period" | "month">("period");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [before, setBefore] = useState<{ output: ReportOutput | null; from: string; upto: string } | null>(null);
  const moved = before && by && value ? movers(work, before.output ? withGroups(before.output).output : { columns: output.columns, rows: [] }, by.key, value.key) : [];
  const counts = { new: 0, gone: 0, up: 0, down: 0, same: 0 };
  for (const item of moved) counts[item.kind] += 1;

  const compare = async () => {
    const from = parseDate(period.from);
    const upto = parseDate(period.upto);
    if (!from || !upto) { setError("The report's dates are not known."); return; }
    const dates2 = mode === "month" ? { from: monthBefore(from), upto: monthBefore(upto) } : periodBefore(from, upto);
    const start = parseDate(yearStart);
    const end = parseDate(yearEnd);
    if ((start && dates2.from < start) || (end && dates2.upto > end)) { setError(`That period (${formatDate(dates2.from)} – ${formatDate(dates2.upto)}) is outside the accounting year ${yearStart} – ${yearEnd}.`); return; }
    setError("");
    setBusy(true);
    try {
      const result = await load(formatDate(dates2.from), formatDate(dates2.upto));
      if (result.error) { setError(result.error); return; }
      setBefore({ output: result.output, from: formatDate(dates2.from), upto: formatDate(dates2.upto) });
    } finally {
      setBusy(false);
    }
  };

  const [days, setDays] = useState(30);
  const asOf = parseDate(period.upto) ?? addDays(new Date(), 0);
  const quiet = by && value && dateColumn ? quietParties(work, by.key, value.key, dateColumn.key, asOf, Math.max(0, days)) : [];

  const gradeTotals = (["A", "B", "C"] as const).map((grade) => {
    const items = ranked.filter((item) => item.grade === grade);
    return { grade, count: items.length, share: items.reduce((all, item) => all + item.share, 0) };
  });
  const biggest = ranked[0]?.value || 1;
  const drill = onPick && by && !by.key.startsWith(GROUP_PREFIX) ? onPick : undefined;
  const pick = (party: string) => { if (by && drill) drill(by.key, party === "(blank)" ? "" : party); };
  const rowProps = (party: string) => (drill ? { onClick: () => pick(party), className: "rp-growth-pick", title: `Show ${party} in the grid` } : {});

  return (
    <aside className="rp-chart rp-growth" aria-label="Business growth">
      <div className="rp-chart-head">
        <b><Icon name="growth" />Growth</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close growth">×</button>
      </div>
      {texts.length === 0 || numbers.length === 0 ? <p className="rp-chart-empty">This report has no party column with an amount to work on.</p> : (
        <>
          <div className="rp-chart-controls">
            {texts.length > 1 && <label>Party<select value={by?.key ?? ""} onChange={(event) => setByKey(event.target.value)}>{texts.map((column) => <option key={column.key} value={column.key}>{column.caption}</option>)}</select></label>}
            {numbers.length > 1 && <label>Amount<select value={value?.key ?? ""} onChange={(event) => setValueKey(event.target.value)}>{numbers.map((column) => <option key={column.key} value={column.key}>{column.caption}</option>)}</select></label>}
          </div>
          <div className="rp-growth-tabs" role="tablist">
            {([["top", "Top parties"], ["movers", "Up / down"], ["quiet", "Follow-up"]] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "rp-btn-on" : ""} onClick={() => setTab(id)}>{label}</button>)}
          </div>

          {tab === "top" && (
            <>
              <p className="rp-chart-note">{ranked.length.toLocaleString("en-IN")} parties by {value?.caption}. A makes the first 80% of the total, B the next 15%, C the rest.</p>
              <div className="rp-cards">
                {gradeTotals.map((item) => <div key={item.grade} className="rp-card"><span>Class {item.grade} · {item.count} parties</span><b>{(item.share * 100).toFixed(1)}%</b></div>)}
              </div>
              <table className="rp-legend rp-growth-table">
                <thead><tr><th>#</th><th>Party</th><th>{value?.caption}</th><th>Share</th><th>Cum.</th><th>Cl</th></tr></thead>
                <tbody>
                  {ranked.slice(0, LIMIT).map((item, index) => (
                    <tr key={item.party} {...rowProps(item.party)}>
                      <td className="rp-legend-num">{index + 1}</td>
                      <td className="rp-legend-name" title={item.party}><span className="rp-growth-bar" style={{ width: `${Math.max(0, (item.value / biggest) * 100)}%` }} />{item.party}</td>
                      <td className="rp-legend-num">{money(item.value, places)}</td>
                      <td className="rp-legend-num">{(item.share * 100).toFixed(1)}%</td>
                      <td className="rp-legend-num">{(item.running * 100).toFixed(1)}%</td>
                      <td className={`rp-growth-grade rp-growth-${item.grade}`}>{item.grade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ranked.length > LIMIT && <p className="rp-chart-note">The first {LIMIT} of {ranked.length.toLocaleString("en-IN")} are shown; the CSV has them all.</p>}
              <button type="button" className="mp-btn mp-btn-plain" onClick={() => downloadCsv("top-parties", [["Rank", "Party", value?.caption ?? "", "Share %", "Cumulative %", "Class"], ...ranked.map((item, index) => [String(index + 1), item.party, money(item.value, places), (item.share * 100).toFixed(2), (item.running * 100).toFixed(2), item.grade])])}>Download CSV</button>
            </>
          )}

          {tab === "movers" && (
            <>
              <div className="rp-chart-controls">
                <label>Against
                  <select value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setBefore(null); setError(""); }}>
                    <option value="period">The period just before</option>
                    <option value="month">Same dates, a month earlier</option>
                  </select>
                </label>
              </div>
              <button type="button" className="mp-btn mp-btn-green rp-compare-run" onClick={() => void compare()} disabled={busy}>{busy ? "Comparing…" : "Show"}</button>
              {error && <p className="rp-compare-error" role="alert">{error}</p>}
              {before && (
                <>
                  <p className="rp-chart-note">Now {period.from} – {period.upto} against {before.from} – {before.upto}{before.output === null ? " (nothing was recorded then)" : ""}.</p>
                  <div className="rp-cards">
                    <div className="rp-card"><span>Up</span><b>{counts.up}</b></div>
                    <div className="rp-card"><span>Down</span><b>{counts.down}</b></div>
                    <div className="rp-card"><span>New</span><b>{counts.new}</b></div>
                    <div className="rp-card"><span>Gone</span><b>{counts.gone}</b></div>
                  </div>
                  <table className="rp-legend rp-growth-table">
                    <thead><tr><th>Party</th><th>Now</th><th>Before</th><th>Change</th><th></th></tr></thead>
                    <tbody>
                      {moved.filter((item) => item.kind !== "same").slice(0, LIMIT).map((item) => (
                        <tr key={item.party} {...rowProps(item.party)}>
                          <td className="rp-legend-name" title={item.party}>{item.party}</td>
                          <td className="rp-legend-num">{money(item.now, places)}</td>
                          <td className="rp-legend-num">{money(item.then, places)}</td>
                          <td className="rp-legend-num">{money(item.change, places)}</td>
                          <td className={`rp-growth-kind rp-growth-${item.kind}`}>{KIND[item.kind]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" className="mp-btn mp-btn-plain" onClick={() => downloadCsv("up-down", [["Party", "Now", "Before", "Change", "Status"], ...moved.map((item) => [item.party, money(item.now, places), money(item.then, places), money(item.change, places), KIND[item.kind]])])}>Download CSV</button>
                </>
              )}
            </>
          )}

          {tab === "quiet" && (
            !dateColumn ? <p className="rp-chart-empty">This report has no date column to count the days from.</p> : (
              <>
                <div className="rp-chart-controls">
                  <label>No entry for (days)<input type="number" min={0} value={days} onChange={(event) => setDays(Number(event.target.value) || 0)} /></label>
                  {dates.length > 1 && <label>Date<select value={dateColumn.key} onChange={(event) => setDateKey(event.target.value)}>{dates.map((column) => <option key={column.key} value={column.key}>{column.caption}</option>)}</select></label>}
                </div>
                <p className="rp-chart-note">{quiet.length.toLocaleString("en-IN")} parties whose last entry in this report is {days} days or more before {formatDate(asOf)}, the longest first.</p>
                <table className="rp-legend rp-growth-table">
                  <thead><tr><th>Party</th><th>Last entry</th><th>Days</th><th>{value?.caption}</th></tr></thead>
                  <tbody>
                    {quiet.slice(0, LIMIT).map((item) => (
                      <tr key={item.party} {...rowProps(item.party)}>
                        <td className="rp-legend-name" title={item.party}>{item.party}</td>
                        <td className="rp-legend-num">{formatDate(item.last)}</td>
                        <td className="rp-legend-num">{item.days}</td>
                        <td className="rp-legend-num">{money(item.value, places)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="mp-btn mp-btn-plain" disabled={quiet.length === 0} onClick={() => downloadCsv("follow-up", [["Party", "Last entry", "Days", value?.caption ?? "", "Entries"], ...quiet.map((item) => [item.party, formatDate(item.last), String(item.days), money(item.value, places), String(item.entries)])])}>Download CSV</button>
              </>
            )
          )}
        </>
      )}
    </aside>
  );
}
