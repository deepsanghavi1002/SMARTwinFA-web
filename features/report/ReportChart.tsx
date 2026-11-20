"use client";

import { useMemo, useState } from "react";
import type { OutputColumn, OutputRow, ReportOutput } from "../../lib/report/types";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";
import { isGroupColumn } from "../../lib/report/groupBy";
import { columnCaption } from "../../lib/report/names";
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
  const labelFor = (entry: Entry, key: string) => {
    const text = key.startsWith(GROUP) ? entry.groups.get(key.slice(GROUP.length)) ?? "" : key === MONTH ? monthOf(entry.row.values[dateColumn?.key ?? ""] ?? "") ?? "" : (entry.row.values[key] ?? "").trim();
    return text === "" ? "(blank)" : text;
  };
  const labelOf = (entry: Entry) => labelFor(entry, splitKey);

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

  const splitCaption = splitKey.startsWith(GROUP) ? groupOf.groups.find((group) => group.type === splitKey.slice(GROUP.length))?.caption ?? "Group" : splitKey === MONTH ? "Month" : (() => { const found = output.columns.find((column) => column.key === splitKey); return found ? columnCaption(output, found) : splitKey; })();
  const filterable = canFilter && !splitKey.startsWith(GROUP) && splitKey !== MONTH;
  const pick = (slice: Slice) => {
    if (slice.others) return;
    const same = picked?.split === splitKey && picked.label === slice.label;
    setPicked(same ? null : { split: splitKey, label: slice.label });
    if (filterable) onFilter(splitKey, same ? null : slice.label === "(blank)" ? "" : slice.label);
  };
  const pickedLabel = picked && picked.split === splitKey ? picked.label : "";

  // "3 groups": the chart that asks for its own three groupings (x axis, bar colours, pie), whatever Group By says; "Cards and donut": the summary cards and the donut.
  const [view, setView] = useState<"groups" | "cards">("groups");
  const splitOptions = [
    ...groupOf.groups.map((group) => ({ key: `${GROUP}${group.type}`, label: `${group.caption} (group)` })),
    ...(dateColumn ? [{ key: MONTH, label: "Month" }] : []),
    ...textColumns.map((column) => ({ key: column.key, label: columnCaption(output, column) })),
  ];

  return (
    <aside className={`rp-chart${view === "groups" ? " rp-chart-wide" : ""}`} aria-label="Report chart">
      <div className="rp-chart-head">
        <b><Icon name="chart" />Chart</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close chart">×</button>
      </div>
      <div className="rp-chart-tabs" role="tablist" aria-label="Chart view">
        <button type="button" role="tab" aria-selected={view === "groups"} className={view === "groups" ? "rp-chart-tab-on" : ""} onClick={() => setView("groups")}>3 groups</button>
        <button type="button" role="tab" aria-selected={view === "cards"} className={view === "cards" ? "rp-chart-tab-on" : ""} onClick={() => setView("cards")}>Cards and donut</button>
      </div>
      {view === "groups" ? <ThreeGroupChart entries={entries} options={splitOptions} numberColumns={numberColumns} defaultX={defaultSplit} hasMonth={dateColumn !== undefined} labelFor={labelFor} /> : (
      <>
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
            {textColumns.map((column) => <option key={column.key} value={column.key}>{columnCaption(output, column)}</option>)}
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
      </>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The "3 groups" chart (web only). It asks for its own three groupings, whatever Group By is doing:
//   X axis        : the columns of the bar chart (up to 13: the 12 largest and a grey "Others", every month when it is a month)
//   Bars split by : the colours stacked inside each column (the 10 largest, the 11th grey is "Others")
//   Pie chart by  : a second chart, a pie (the 12 largest, the 13th grey is "Others")
// and a Value (y axis) of any number column. A summary of the figures stands under the bar chart, and the pie under that.
// Clicking a column, a coloured piece or a pie slice picks it: the pie follows the column, the columns follow the slice.
// Grey is used for "Others" only.
// ---------------------------------------------------------------------------------------------------------------------

const BAR_COLOURS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948", "#0ea5b7", "#8a5a2b", "#7c9a1c", "#c04fc0"];
const MAX_COLUMNS = 13;
const MAX_PIECES = 10;
const MAX_SLICES = 12;
const OTHERS_NAME = "Others";
const PLOT_HEIGHT = 240;
/** The summary's lines under each parent: the largest ones, the rest as one Others line. */
const TREE_KEEP = 15;

type ThreePick = { a: string | null; b: string | null; c: string | null };
const NOTHING: ThreePick = { a: null, b: null, c: null };

/** "Apr-2026" → a number that sorts by time (0 when it is no month). */
const monthRank = (label: string) => {
  const found = /^([A-Za-z]{3})-(\d{4})$/.exec(label);
  const at = found ? MONTHS.findIndex((name) => name.toLowerCase() === found[1].toLowerCase()) : -1;
  return found && at >= 0 ? Number(found[2]) * 12 + at : 0;
};
/** 12,34,567 → "1.2 Cr" / "50 L" / "30 K": short enough for an axis. */
const compact = (value: number) => {
  const size = Math.abs(value);
  return size >= 1e7 ? `${+(value / 1e7).toFixed(2)} Cr` : size >= 1e5 ? `${+(value / 1e5).toFixed(2)} L` : size >= 1e3 ? `${+(value / 1e3).toFixed(1)} K` : String(Math.round(value));
};
/** The top of a y axis: 1, 2, 5 or 10 times a power of ten that holds the largest column. */
const niceTop = (value: number) => {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const lead = value / power;
  return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * power;
};

function ThreeGroupChart({ entries, options, numberColumns, defaultX, hasMonth, labelFor }: {
  entries: readonly Entry[];
  options: readonly { key: string; label: string }[];
  numberColumns: readonly OutputColumn[];
  defaultX: string;
  hasMonth: boolean;
  labelFor: (entry: Entry, key: string) => string;
}) {
  const [valueKey, setValueKey] = useState(numberColumns[0]?.key ?? "");
  const [xKey, setXKey] = useState(defaultX);
  const [barKey, setBarKey] = useState("");
  const [pieKey, setPieKey] = useState(hasMonth && defaultX !== MONTH ? MONTH : "");
  const [pick, setPick] = useState<ThreePick>(NOTHING);
  /** The summary's open and closed lines: a line the user toggled, else the all-open / all-closed button, else only the first level open. */
  const [opened, setOpened] = useState<{ mode: "all" | "none" | null; lines: ReadonlyMap<string, boolean> }>({ mode: null, lines: new Map() });
  const value = numberColumns.find((column) => column.key === valueKey) ?? numberColumns[0];
  const places = value?.decimals ?? 0;
  const nameOf = (key: string) => options.find((option) => option.key === key)?.label ?? key;

  // Every positive entry with its three labels.
  const rows = useMemo(() => {
    const list: { x: string; b: string; c: string; value: number }[] = [];
    if (!value) return list;
    for (const entry of entries) {
      const figure = amount(entry.row.values[value.key]);
      if (figure <= 0) continue;
      list.push({ x: xKey ? labelFor(entry, xKey) : "", b: barKey ? labelFor(entry, barKey) : "", c: pieKey ? labelFor(entry, pieKey) : "", value: figure });
    }
    return list;
  }, [entries, value, xKey, barKey, pieKey]); // eslint-disable-line react-hooks/exhaustive-deps -- labelFor follows the report

  /** The largest `keep` labels by value (the rest fall into Others); months stay in time order, anything else largest first. */
  const topLabels = (sums: Map<string, number>, key: string, keep: number) => {
    const largest = [...sums].sort((x, y) => y[1] - x[1]).slice(0, keep).map(([label]) => label);
    return key === MONTH ? largest.sort((x, y) => monthRank(x) - monthRank(y)) : largest;
  };
  const sumBy = (list: typeof rows, field: "x" | "b" | "c") => {
    const sums = new Map<string, number>();
    for (const row of list) sums.set(row[field], (sums.get(row[field]) ?? 0) + row.value);
    return sums;
  };

  // The columns follow the picked pie slice; the pie follows the picked column and piece.
  const columnRows = rows.filter((row) => pick.c === null || row.c === pick.c);
  const pieRows = rows.filter((row) => (pick.a === null || row.x === pick.a) && (pick.b === null || row.b === pick.b));

  const xSums = sumBy(columnRows, "x");
  const xKeep = xSums.size > MAX_COLUMNS ? MAX_COLUMNS - 1 : MAX_COLUMNS;
  const xTop = topLabels(xSums, xKey, xKeep);
  const bSums = sumBy(columnRows, "b");
  const bTop = barKey ? topLabels(bSums, barKey, MAX_PIECES) : [""];
  const pieceOf = (label: string) => (!barKey ? "" : bTop.includes(label) ? label : OTHERS_NAME);
  const colourOf = (piece: string) => (piece === OTHERS_NAME ? OTHERS_COLOUR : BAR_COLOURS[Math.max(0, bTop.indexOf(piece))]);

  type Column = { label: string; others: boolean; parts: Map<string, number>; total: number; count: number };
  const columnOf = new Map<string, Column>();
  const columns: Column[] = xTop.map((label) => ({ label, others: false, parts: new Map(), total: 0, count: 0 }));
  columns.forEach((column) => columnOf.set(column.label, column));
  const othersColumn: Column = { label: OTHERS_NAME, others: true, parts: new Map(), total: 0, count: 0 };
  for (const row of columnRows) {
    const column = columnOf.get(row.x) ?? othersColumn;
    const piece = pieceOf(row.b);
    column.parts.set(piece, (column.parts.get(piece) ?? 0) + row.value);
    column.total += row.value;
    column.count += 1;
  }
  if (othersColumn.count > 0) { othersColumn.label = `${OTHERS_NAME} (${new Set(columnRows.filter((row) => !columnOf.has(row.x)).map((row) => row.x)).size})`; columns.push(othersColumn); }
  // Anything but a month goes largest first, with Others last.
  if (xKey !== MONTH) columns.sort((x, y) => Number(x.others) - Number(y.others) || y.total - x.total);
  const pieces = barKey ? [...bTop, ...(columns.some((column) => column.parts.has(OTHERS_NAME)) ? [OTHERS_NAME] : [])] : [""];
  const grand = columns.reduce((sum, column) => sum + column.total, 0);
  const top = niceTop(Math.max(0, ...columns.map((column) => column.total)));
  const ticks = [1, 0.75, 0.5, 0.25, 0];

  // The pie.
  const cSums = sumBy(pieRows, "c");
  const cCounts = new Map<string, number>();
  for (const row of pieRows) cCounts.set(row.c, (cCounts.get(row.c) ?? 0) + 1);
  const cSorted = [...cSums].sort((x, y) => y[1] - x[1]);
  const slices: Slice[] = cSorted.slice(0, MAX_SLICES).map(([label, sum], index) => ({ label, value: sum, count: cCounts.get(label) ?? 0, colour: BAR_COLOURS[index], others: false }));
  if (cSorted.length > MAX_SLICES) {
    const rest = cSorted.slice(MAX_SLICES);
    slices.push({ label: `${OTHERS_NAME} (${rest.length})`, value: rest.reduce((sum, [, sum2]) => sum + sum2, 0), count: rest.reduce((sum, [label]) => sum + (cCounts.get(label) ?? 0), 0), colour: OTHERS_COLOUR, others: true });
  }
  const pieTotal = slices.reduce((sum, slice) => sum + slice.value, 0);

  /** Pick what was clicked; the same click again lets it go. */
  const toggle = (next: Partial<ThreePick>) => setPick((current) => {
    const keys = Object.keys(next) as (keyof ThreePick)[];
    const same = keys.every((key) => current[key] === next[key]);
    const result = { ...current };
    for (const key of keys) result[key] = same ? null : next[key] ?? null;
    return result;
  });
  const change = (set: (key: string) => void) => (event: { target: { value: string } }) => { set(event.target.value); setPick(NOTHING); };
  const pickText = [pick.a, pick.b, pick.c].filter((part): part is string => part !== null).join(" › ");
  const pieFor = [pick.a, pick.b].filter((part): part is string => part !== null).join(" › ");
  const largest = columns.filter((column) => !column.others).sort((x, y) => y.total - x.total)[0];

  // The summary as a tree: each x value, then the bar split inside it, then the pie grouping inside that (each level the 15 largest and the rest as one "Others" line).
  /** `a` / `b`: the x value and the bar split a line stands for, which the pie shows when the line is clicked (b null: the whole x value). */
  type TreeLine = { key: string; level: number; label: string; total: number; count: number; expandable: boolean; others: boolean; a: string; b: string | null };
  const isOpen = (key: string, level: number) => opened.lines.get(key) ?? (opened.mode === "all" ? true : opened.mode === "none" ? false : level === 0);
  const treeLines: TreeLine[] = [];
  const emit = (list: typeof rows, fields: ("b" | "c")[], level: number, parent: string, path: { a: string; b: string | null }) => {
    if (fields.length === 0) return;
    const [field, ...rest] = fields;
    const parts = new Map<string, { total: number; count: number }>();
    for (const row of list) { const item = parts.get(row[field]) ?? { total: 0, count: 0 }; parts.set(row[field], { total: item.total + row.value, count: item.count + 1 }); }
    const sorted = [...parts].sort((x, y) => y[1].total - x[1].total);
    for (const [label, item] of sorted.slice(0, TREE_KEEP)) {
      const key = `${parent}\u0001${label}`;
      const here = { a: path.a, b: field === "b" ? label : path.b };
      treeLines.push({ key, level, label, total: item.total, count: item.count, expandable: rest.length > 0, others: false, ...here });
      if (rest.length > 0 && isOpen(key, level)) emit(list.filter((row) => row[field] === label), rest, level + 1, key, here);
    }
    if (sorted.length > TREE_KEEP) {
      const more = sorted.slice(TREE_KEEP);
      treeLines.push({ key: `${parent}\u0001others`, level, label: `${OTHERS_NAME} (${more.length})`, total: more.reduce((sum, [, item]) => sum + item.total, 0), count: more.reduce((sum, [, item]) => sum + item.count, 0), expandable: false, others: true, ...path });
    }
  };
  const lowerFields: ("b" | "c")[] = [...(barKey ? ["b" as const] : []), ...(pieKey ? ["c" as const] : [])];
  for (const column of columns) {
    treeLines.push({ key: column.label, level: 0, label: column.label, total: column.total, count: column.count, expandable: !column.others && lowerFields.length > 0, others: column.others, a: column.label, b: null });
    if (!column.others && lowerFields.length > 0 && isOpen(column.label, 0)) emit(columnRows.filter((row) => row.x === column.label), lowerFields, 1, column.label, { a: column.label, b: null });
  }
  /** A click on a line of the summary: the pie shows that x value (an x line) or that x value's bar split (a line under it); the same click again goes back to all. */
  const selectLine = (line: TreeLine) => {
    if (line.others) return;
    setPick((current) => (current.a === line.a && current.b === line.b ? { ...current, a: null, b: null } : { ...current, a: line.a, b: line.b }));
  };
  const toggleLine = (key: string, level: number) => setOpened((current) => ({ ...current, lines: new Map(current.lines).set(key, !isOpen(key, level)) }));
  const summaryHead = [nameOf(xKey), ...(barKey ? [nameOf(barKey)] : []), ...(pieKey ? [nameOf(pieKey)] : [])].join(" › ");

  const choose = (current: string, set: (key: string) => void, none: string | null) => (
    <select value={current} onChange={change(set)}>
      {none !== null && <option value="">{none}</option>}
      {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>
  );

  return (
    <>
      <div className="rp-chart-controls rp-chart-controls-wrap">
        <label>Value (y axis)
          <select value={value?.key ?? ""} onChange={change(setValueKey)}>
            {numberColumns.map((column) => <option key={column.key} value={column.key}>{column.caption}</option>)}
          </select>
        </label>
        <label>X axis (e.g. Area){choose(xKey, setXKey, null)}</label>
        <label>Bars split by (e.g. Particulars){choose(barKey, setBarKey, "— none —")}</label>
        <label>Pie chart by (e.g. Month){choose(pieKey, setPieKey, "— none —")}</label>
      </div>
      {pick.a !== null || pick.b !== null || pick.c !== null ? <p className="rp-chart-note">Picked : <b>{pickText}</b> <button type="button" className="mp-btn mp-btn-plain" onClick={() => setPick(NOTHING)}>Clear</button></p> : null}

      {rows.length === 0 ? <p className="rp-chart-empty">No positive figures to chart.</p> : (
        <>
          {barKey !== "" && (
            <div className="rp-3g-legend">
              {pieces.map((piece) => (
                <span key={piece} className={piece === OTHERS_NAME ? "" : "rp-3g-pick"} style={{ opacity: pick.b !== null && pick.b !== piece ? 0.45 : 1 }} onClick={() => { if (piece !== OTHERS_NAME) toggle({ b: piece }); }}>
                  <i style={{ background: colourOf(piece) }} />{piece}
                </span>
              ))}
            </div>
          )}
          <div className="rp-3g-chart" role="img" aria-label={`${value?.caption} by ${nameOf(xKey)}${barKey ? `, split by ${nameOf(barKey)}` : ""}`}>
            <div className="rp-3g-axis" style={{ height: PLOT_HEIGHT }}>
              {ticks.map((part) => <span key={part} style={{ top: `${(1 - part) * 100}%` }}>{compact(top * part)}</span>)}
            </div>
            <div className="rp-3g-plot" style={{ height: PLOT_HEIGHT }}>
              {ticks.map((part) => <div key={part} className="rp-3g-grid" style={{ top: `${(1 - part) * 100}%` }} />)}
              <div className="rp-3g-columns">
                {columns.map((column) => {
                  const dim = pick.a !== null && pick.a !== column.label;
                  return (
                    <div key={column.label} className="rp-3g-col" style={{ opacity: dim ? 0.45 : 1 }}>
                      <div className="rp-3g-stack" style={{ height: `${(column.total / top) * 100}%` }}>
                        {[...pieces].reverse().filter((piece) => column.parts.has(piece)).map((piece) => {
                          const part = column.parts.get(piece) ?? 0;
                          const clickable = !column.others && piece !== OTHERS_NAME;
                          return <div key={piece} title={`${column.label}${piece ? ` › ${piece}` : ""} : ${money(part, places)}`} onClick={() => { if (clickable) toggle(barKey ? { a: column.label, b: piece } : { a: column.label }); }}
                            style={{ height: `${(part / column.total) * 100}%`, background: colourOf(piece), cursor: clickable ? "pointer" : "default", outline: pick.a === column.label && pick.b === piece ? "2px solid #1f2a4d" : undefined }} />;
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div />
            <div className="rp-3g-labels">
              {columns.map((column) => (
                <span key={column.label} title={column.label} className={column.others ? "" : "rp-3g-pick"} style={{ fontWeight: pick.a === column.label ? 800 : 500 }} onClick={() => { if (!column.others) toggle({ a: column.label }); }}><em>{column.label}</em></span>
              ))}
            </div>
          </div>

          <div className="rp-cards">
            <div className="rp-card"><span>Total {value?.caption}</span><b>{money(grand, places)}</b></div>
            <div className="rp-card"><span>{nameOf(xKey)} shown</span><b>{columns.length}</b></div>
            {largest && <div className="rp-card rp-card-wide"><span>Largest {nameOf(xKey).toLowerCase()}</span><b>{money(largest.total, places)}</b><small>{largest.label} · {percent(largest.total, grand)}</small></div>}
          </div>
          {lowerFields.length > 0 && (
            <p className="rp-chart-note">
              <button type="button" className="mp-btn mp-btn-plain" onClick={() => setOpened({ mode: "all", lines: new Map() })}>Open all</button>{" "}
              <button type="button" className="mp-btn mp-btn-plain" onClick={() => setOpened({ mode: "none", lines: new Map() })}>Close all</button>{" "}
              Click ⊞ / ⊟ to open or close a line. Each level shows its 15 largest; the share is of the total.
            </p>
          )}
          <table className="rp-3g-summary">
            <thead><tr><th>{summaryHead}</th><th>{value?.caption}</th><th>Share</th><th>Entries</th></tr></thead>
            <tbody>
              {treeLines.map((line) => (
                <tr key={line.key} className={`${line.level === 0 ? "rp-3g-top" : ""} ${line.others ? "" : "rp-3g-pick"} ${!line.others && pick.a === line.a && pick.b === line.b ? "rp-3g-on" : ""}`} onClick={() => selectLine(line)}>
                  <td style={{ paddingLeft: 8 + line.level * 18 }}>
                    {line.expandable ? <button type="button" className="rp-3g-fold" aria-label={isOpen(line.key, line.level) ? "Close" : "Open"} onClick={(event) => { event.stopPropagation(); toggleLine(line.key, line.level); }}>{isOpen(line.key, line.level) ? "⊟" : "⊞"}</button> : <span className="rp-3g-fold" />}
                    <span>{line.label}</span>
                  </td>
                  <td>{money(line.total, places)}</td><td>{percent(line.total, grand)}</td><td>{line.count}</td>
                </tr>
              ))}
              <tr className="rp-3g-total"><td>Total</td><td>{money(grand, places)}</td><td>{percent(grand, grand)}</td><td>{columns.reduce((sum, column) => sum + column.count, 0)}</td></tr>
            </tbody>
          </table>

          {pieKey !== "" && pieTotal > 0 && (
            <div className="rp-donuts">
              <div className="rp-donut-block">
                <Donut caption={`${value?.caption} by ${nameOf(pieKey)} — ${pieFor !== "" ? pieFor : "all"}`} slices={slices} total={pieTotal} picked={pick.c ?? ""} onPick={(slice) => { if (!slice.others) toggle({ c: slice.label }); }} />
                <table className="rp-legend">
                  <tbody>
                    {slices.map((slice) => (
                      <tr key={slice.label} className={`${slice.others ? "" : "rp-legend-pick"} ${pick.c === slice.label ? "rp-legend-on" : ""}`} onClick={() => { if (!slice.others) toggle({ c: slice.label }); }}>
                        <td><i style={{ background: slice.colour }} /></td>
                        <td className="rp-legend-name">{slice.label}</td>
                        <td className="rp-legend-num">{money(slice.value, places)}</td>
                        <td className="rp-legend-num">{percent(slice.value, pieTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      <p className="rp-chart-note">Charted from the rows the grid shows (a filter or the search narrows it); only positive figures count. Click a column, a coloured piece or a pie slice to pick it, click again to clear. This panel is wider for the chart: Minimize ▶ hides it and the grid gets the room back.</p>
    </>
  );
}
