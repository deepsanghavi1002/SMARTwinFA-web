"use client";

import { useMemo, useState } from "react";
import type { OutputColumn, OutputRow, ReportOutput } from "../../lib/report/types";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";
import { PlanningPanel } from "./PlanningPanel";
import { canTrend, TrendChart } from "./TrendChart";

/**
 * The report's chart panel (web only; the desktop has none): summary cards and a donut of a
 * number column split by a group, for any report, from the rows the grid shows (so a filter or the
 * search narrows the chart as it does the final total).
 *
 * - Only the voucher rows count: not openings, closings, headings, narration or totals.
 * - Split by: the report's own group (the heading rows above the vouchers: account, book ...), a
 *   month (from the date column), or any text column. The 7 largest get a slice, the rest "Others".
 * - Two amount columns (Receipt / Payment, Debit / Credit) show as two donuts side by side.
 * - Clicking a slice (or its legend row) filters the grid to it, when the grid has column filters
 *   and the split is one of its columns.
 *
 * Colours: the validated categorical order (fixed by slice position, largest first) with a neutral
 * grey for Others; every slice is also named in the legend with its amount and share.
 */

const SLICE_COLOURS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];
const OTHERS_COLOUR = "#9a9893";
const TOP = SLICE_COLOURS.length;
/** A split by one of the report's groups: GROUP + the heading row type (AC, BOOK, ADDON_1 ...). */
const GROUP = "__group:";
const MONTH = "__month";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEADING_TYPES = /^(AC|BOOK|SCHEDULE|ADDON_\d+|ST)$/;

const amount = (text: string | undefined) => Number((text ?? "").replace(/,/g, "")) || 0;
const money = (value: number, places = 2) => value.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places });
const percent = (part: number, whole: number) => (whole === 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`);

type Entry = { row: OutputRow; groups: ReadonlyMap<string, string> };
type Slice = { label: string; value: number; count: number; colour: string; others: boolean };

/** A voucher row: ROW_DATA_TYPE LED from a voucher (not the day book's Closing Balance), or a row of a report with no row types. */
/** (The ageing and the clearance have no ledger key: with none on any row, every LED row is an entry.) */
const isEntry = (row: OutputRow, keyed = true) => row.kind === "data" && !/^\s*Opening Balance/i.test(row.values.NAME ?? "") && ((row.rowType === "LED" && (row.ledKey > 0 || !keyed)) || row.rowType === "");

/** "01-Apr-2026" / "01/04/2026" → "Apr-2026" (null when the text is no date). */
function monthOf(text: string): string | null {
  const named = /^\d{1,2}[- ]([A-Za-z]{3})[- ](\d{2,4})$/.exec(text.trim());
  if (named) return `${named[1][0].toUpperCase()}${named[1].slice(1).toLowerCase()}-${named[2].length === 2 ? `20${named[2]}` : named[2]}`;
  const slashed = /^\d{1,2}\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return slashed ? `${MONTHS[Number(slashed[1]) - 1] ?? slashed[1]}-${slashed[2]}` : null;
}

/** Donut path of one slice, from angle a to b (radians, 0 at the top, clockwise). */
function arc(a: number, b: number, outer: number, inner: number): string {
  const point = (angle: number, radius: number) => `${(Math.sin(angle) * radius).toFixed(2)} ${(-Math.cos(angle) * radius).toFixed(2)}`;
  if (b - a >= Math.PI * 2 - 1e-6) {
    // A whole ring: two halves (an arc cannot start and end on the same point).
    return `M ${point(0, outer)} A ${outer} ${outer} 0 1 1 ${point(Math.PI, outer)} A ${outer} ${outer} 0 1 1 ${point(0, outer)} M ${point(0, inner)} A ${inner} ${inner} 0 1 0 ${point(Math.PI, inner)} A ${inner} ${inner} 0 1 0 ${point(0, inner)} Z`;
  }
  const large = b - a > Math.PI ? 1 : 0;
  return `M ${point(a, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(b, outer)} L ${point(b, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(a, inner)} Z`;
}

function Donut({ caption, slices, total, picked, onPick }: { caption: string; slices: readonly Slice[]; total: number; picked: string; onPick: (slice: Slice) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const size = 180;
  const outer = 84;
  const inner = 54;
  let angle = 0;
  const shown = hover !== null ? slices[hover] : null;
  return (
    <figure className="rp-donut">
      <figcaption>{caption}</figcaption>
      <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} width={size} height={size} role="img" aria-label={`${caption}: ${slices.map((slice) => `${slice.label} ${percent(slice.value, total)}`).join(", ")}`}>
        {total > 0 ? slices.map((slice, index) => {
          const start = angle;
          angle += (slice.value / total) * Math.PI * 2;
          const active = hover === index || (picked !== "" && picked === slice.label);
          return (
            <path
              key={slice.label}
              d={arc(start, angle, active ? outer + 5 : outer, inner)}
              fill={slice.colour}
              stroke="#ffffff"
              strokeWidth={2}
              opacity={picked !== "" && picked !== slice.label && hover === null ? 0.45 : 1}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(slice)}
              style={{ cursor: slice.others ? "default" : "pointer" }}
            />
          );
        }) : <circle r={(outer + inner) / 2} fill="none" stroke="#e4e2dd" strokeWidth={outer - inner} />}
        <text className="rp-donut-big" textAnchor="middle" y={shown ? -4 : 2}>{shown ? percent(shown.value, total) : money(total, 0)}</text>
        <text className="rp-donut-small" textAnchor="middle" y={shown ? 14 : 18}>{shown ? (shown.label.length > 18 ? `${shown.label.slice(0, 17)}…` : shown.label) : "Total"}</text>
      </svg>
      {shown && <div className="rp-donut-tip" role="status"><i style={{ background: shown.colour }} /><b>{shown.label}</b><span>{money(shown.value)} · {percent(shown.value, total)} · {shown.count} {shown.count === 1 ? "entry" : "entries"}</span></div>}
    </figure>
  );
}

export function ReportChart({ output, shownIndexes, donutIndexes, canFilter, onFilter, onClose }: {
  output: ReportOutput;
  /** Indexes (in output.rows) of the rows the grid shows now. */
  shownIndexes: ReadonlySet<number>;
  /** The same without the slice picked in the chart: the donut stays whole. */
  donutIndexes: ReadonlySet<number>;
  /** Whether the grid's column filters are on (a report with no groups). */
  canFilter: boolean;
  /** Filter the grid's column to one value; null clears that column's filter. */
  onFilter: (columnKey: string, value: string | null) => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  // Each row's value under each group the report heads: the last heading row of that type above it.
  const groupOf = useMemo(() => {
    const types = [...new Set(output.rows.filter((row) => row.kind === "data" && HEADING_TYPES.test(row.rowType)).map((row) => row.rowType))];
    const headed = (column: OutputColumn) => output.rows.some((row) => HEADING_TYPES.test(row.rowType) && (row.values[column.key] ?? "").trim() !== "");
    const nameColumn = output.columns.find((column) => /^name$/i.test(column.key) && headed(column))
      ?? output.columns.find((column) => column.kind === "text" && output.rows.some((row) => HEADING_TYPES.test(row.rowType) && (row.values[column.key] ?? "").trim() !== ""));
    const current = new Map<string, string>();
    const values: Map<string, string>[] = [];
    for (const row of output.rows) {
      if (row.kind === "data" && HEADING_TYPES.test(row.rowType) && nameColumn) current.set(row.rowType, (row.values[nameColumn.key] ?? "").replace(/^\*+\s*/, "").trim());
      values.push(new Map(current));
    }
    // Named as the operator ticked them; the outer groups (book, area ...) before the account.
    const groups = types.sort((x, y) => Number(x === "AC") - Number(y === "AC")).map((type) => ({ type, caption: output.headingCaptions[type] ?? type }));
    return { values, groups };
  }, [output]);

  // The amount columns: those the final total sums (else every number column but balances and rates).
  const totalRow = output.rows.find((row) => row.kind === "total");
  // Not the opening balance, nor a month's own pair of the Month format (its TOTAL_ columns stand for them).
  const numberColumns = output.columns.filter((column) => column.kind === "number" && !/^OPENING/i.test(column.key) && !/^[A-Za-z]{3} [A-Z_.]+$/.test(column.key));
  const summed = totalRow ? numberColumns.filter((column) => (totalRow.values[column.key] ?? "") !== "") : [];
  const valueColumns = summed.length > 0 ? summed : numberColumns.filter((column) => !/CLOSING|BAL|RATE|PERC|%/i.test(`${column.key} ${column.caption}`));
  const pair = valueColumns.length >= 2 ? [valueColumns[0], valueColumns[1]] as const : null;
  const dateColumn = output.columns.find((column) => column.kind === "date" || /date/i.test(column.key));
  const textColumns = output.columns.filter((column) => column.kind === "text");
  const defaultSplit = groupOf.groups.length > 0 ? `${GROUP}${groupOf.groups[0].type}` : textColumns.find((column) => /^name$/i.test(column.key))?.key ?? textColumns[0]?.key ?? (dateColumn ? MONTH : "");

  const [valueKey, setValueKey] = useState(pair ? "__pair" : valueColumns[0]?.key ?? "");
  const [splitKey, setSplitKey] = useState(defaultSplit);
  const [picked, setPicked] = useState<{ split: string; label: string } | null>(null);

  const ledgerKeyed = useMemo(() => output.rows.some((row) => row.rowType === "LED" && row.ledKey > 0), [output]);
  const entriesOf = (indexes: ReadonlySet<number>): Entry[] => output.rows.flatMap((row, index) => (indexes.has(index) && isEntry(row, ledgerKeyed) ? [{ row, groups: groupOf.values[index] }] : []));
  const entries = useMemo(() => entriesOf(shownIndexes), [output, shownIndexes, groupOf]); // eslint-disable-line react-hooks/exhaustive-deps -- entriesOf reads these
  const donutEntries = useMemo(() => entriesOf(donutIndexes), [output, donutIndexes, groupOf]); // eslint-disable-line react-hooks/exhaustive-deps -- entriesOf reads these
  const labelOf = (entry: Entry) => {
    const text = splitKey.startsWith(GROUP) ? entry.groups.get(splitKey.slice(GROUP.length)) ?? "" : splitKey === MONTH ? monthOf(entry.row.values[dateColumn?.key ?? ""] ?? "") ?? "" : (entry.row.values[splitKey] ?? "").trim();
    return text === "" ? "(blank)" : text;
  };

  /** The slices of one column: positive amounts by split label, largest first; past the 7th, the rest as Others. */
  const slicesOf = (column: OutputColumn): { slices: Slice[]; total: number } => {
    const sums = new Map<string, { value: number; count: number }>();
    for (const entry of donutEntries) {
      const value = amount(entry.row.values[column.key]);
      if (value <= 0) continue;
      const label = labelOf(entry);
      const sum = sums.get(label) ?? { value: 0, count: 0 };
      sums.set(label, { value: sum.value + value, count: sum.count + 1 });
    }
    const sorted = [...sums].sort((a, b) => b[1].value - a[1].value);
    const slices: Slice[] = sorted.slice(0, TOP).map(([label, sum], index) => ({ label, value: sum.value, count: sum.count, colour: SLICE_COLOURS[index], others: false }));
    if (sorted.length > TOP) {
      const rest = sorted.slice(TOP);
      slices.push({ label: `Others (${rest.length})`, value: rest.reduce((sum, [, item]) => sum + item.value, 0), count: rest.reduce((sum, [, item]) => sum + item.count, 0), colour: OTHERS_COLOUR, others: true });
    }
    return { slices, total: slices.reduce((sum, slice) => sum + slice.value, 0) };
  };

  const charted = valueKey === "__pair" && pair ? [pair[0], pair[1]] : valueColumns.filter((column) => column.key === valueKey);
  const donuts = charted.map((column) => ({ column, ...slicesOf(column) }));

  // ---- Cards ----
  const periodMode = canTrend(output);
  const unit = periodMode ? "period" : "entry";
  /** The period (its date) when a row has no split value of its own. */
  const dateText = (entry: Entry) => (entry.row.values[output.columns.find((column) => /^selected_date$/i.test(column.key))?.key ?? ""] ?? "").trim();
  const totals = charted.map((column) => entries.reduce((sum, entry) => sum + amount(entry.row.values[column.key]), 0));
  const counted = entries.filter((entry) => charted.some((column) => amount(entry.row.values[column.key]) !== 0));
  let largest: { value: number; label: string; column: string } | null = null;
  for (const entry of counted) for (const column of charted) {
    const value = amount(entry.row.values[column.key]);
    if (!largest || value > largest.value) largest = { value, label: periodMode && labelOf(entry) === "(blank)" ? dateText(entry) : labelOf(entry), column: column.caption };
  }
  const allAmounts = totals.reduce((sum, value) => sum + value, 0);
  const topSlice = donuts[0]?.slices.find((slice) => !slice.others);
  const places = Math.max(0, ...charted.map((column) => column.decimals));

  const splitCaption = splitKey.startsWith(GROUP) ? groupOf.groups.find((group) => group.type === splitKey.slice(GROUP.length))?.caption ?? "Group" : splitKey === MONTH ? "Month" : output.columns.find((column) => column.key === splitKey)?.caption ?? splitKey;
  const filterable = canFilter && !splitKey.startsWith(GROUP) && splitKey !== MONTH;
  const pick = (slice: Slice) => {
    if (slice.others) return;
    const same = picked?.split === splitKey && picked.label === slice.label;
    setPicked(same ? null : { split: splitKey, label: slice.label });
    if (filterable) onFilter(splitKey, same ? null : slice.label === "(blank)" ? "" : slice.label);
  };
  const pickedLabel = picked && picked.split === splitKey ? picked.label : "";

  return (
    <aside className="rp-chart" aria-label="Report chart">
      <div className="rp-chart-head">
        <b><Icon name="chart" />Chart</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close chart">×</button>
      </div>
      <div className="rp-chart-controls">
        <label>Value
          <select value={valueKey} onChange={(event) => { setValueKey(event.target.value); setPicked(null); }}>
            {pair && <option value="__pair">{pair[0].caption} &amp; {pair[1].caption}</option>}
            {valueColumns.map((column) => <option key={column.key} value={column.key}>{column.caption}</option>)}
          </select>
        </label>
        <label>Split by
          <select value={splitKey} onChange={(event) => { if (picked && filterable) onFilter(picked.split, null); setSplitKey(event.target.value); setPicked(null); }}>
            {groupOf.groups.map((group) => <option key={group.type} value={`${GROUP}${group.type}`}>{group.caption} (group)</option>)}
            {dateColumn && <option value={MONTH}>Month</option>}
            {textColumns.map((column) => <option key={column.key} value={column.key}>{column.caption}</option>)}
          </select>
        </label>
      </div>

      {output.planning && <PlanningPanel planning={output.planning} />}

      <div className="rp-cards">
        {charted.map((column, index) => (
          <div key={column.key} className="rp-card"><span>Total {column.caption}</span><b>{money(totals[index], places)}</b></div>
        ))}
        {charted.length === 2 && <div className="rp-card"><span>Net ({charted[0].caption} − {charted[1].caption})</span><b>{money(totals[0] - totals[1], places)}</b></div>}
        <div className="rp-card"><span>{periodMode ? "Periods" : "Entries"}</span><b>{counted.length.toLocaleString("en-IN")}</b></div>
        <div className="rp-card"><span>Average per {unit}</span><b>{money(counted.length ? allAmounts / counted.length : 0, places)}</b></div>
        {largest && <div className="rp-card rp-card-wide"><span>Largest {unit} ({largest.column})</span><b>{money(largest.value, places)}</b><small>{largest.label}</small></div>}
        {topSlice && topSlice.label !== "(blank)" && <div className="rp-card rp-card-wide"><span>Top {splitCaption.toLowerCase()} ({charted[0]?.caption})</span><b>{percent(topSlice.value, donuts[0].total)}</b><small>{topSlice.label} · {money(topSlice.value, places)}</small></div>}
      </div>

      {canTrend(output) && <TrendChart output={output} shownIndexes={shownIndexes} />}

      {donutEntries.length === 0 ? <p className="rp-chart-empty">{periodMode ? "" : "No entries to chart."}</p> : donuts.every((donut) => donut.slices.every((slice) => slice.label === "(blank)")) ? null : (
        <div className="rp-donuts">
          {donuts.map(({ column, slices, total }) => (
            <div key={column.key} className="rp-donut-block">
              <Donut caption={`${column.caption} by ${splitCaption}`} slices={slices} total={total} picked={pickedLabel} onPick={pick} />
              <table className="rp-legend">
                <tbody>
                  {slices.map((slice) => (
                    <tr key={slice.label} className={`${slice.others ? "" : "rp-legend-pick"} ${pickedLabel === slice.label ? "rp-legend-on" : ""}`} onClick={() => pick(slice)}>
                      <td><i style={{ background: slice.colour }} /></td>
                      <td className="rp-legend-name">{slice.label}</td>
                      <td className="rp-legend-num">{money(slice.value, places)}</td>
                      <td className="rp-legend-num">{percent(slice.value, total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      <p className="rp-chart-note">{filterable ? "Click a slice to filter the grid to it; click again to clear." : canFilter ? "Charted from the rows the grid shows." : "Charted from the rows the grid shows; the search box narrows it."}</p>
    </aside>
  );
}
