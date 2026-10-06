"use client";

import { useMemo, useState } from "react";
import type { OutputColumn, OutputRow, ReportOutput } from "../../lib/report/types";

/**
 * The trend of a period format (Month, Daily, Weekly, 15 Days, Quarter, Half Year): a pair of bars
 * for each period (what came in, what went out) and the closing balance as a line, over one
 * money axis. Drawn from the rows the grid shows; with several accounts or groups a period's
 * figures are the sum of its rows. Summary (one row) has no trend.
 *
 * The day book's Month format is one row with a pair of columns per month ("Apr DEPOSIT",
 * "Apr WITHDRAWAL"); its months are read from those columns.
 */

const IN_COLOUR = "#2a78d6";
const OUT_COLOUR = "#eb6834";
const LINE_COLOUR = "#1f3b63";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const PERIOD_FORMATS = new Set(["MONTHLY", "DAILY", "WEEKLY", "HALF_MONTH", "QUATER_YEAR", "HALF_YEAR"]);

const amount = (text: string | undefined) => Number((text ?? "").replace(/,/g, "")) || 0;
const money = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 1.25 L / 3.4 Cr style axis labels (Indian digit grouping). */
function short(value: number): string {
  const size = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (size >= 1e7) return `${sign}${+(size / 1e7).toFixed(2)} Cr`;
  if (size >= 1e5) return `${sign}${+(size / 1e5).toFixed(2)} L`;
  if (size >= 1e3) return `${sign}${+(size / 1e3).toFixed(1)} K`;
  return `${sign}${+size.toFixed(0)}`;
}

type Period = { label: string; order: number; into: number; out: number; closing: number | null };

/** Where a period label sorts: a date's own day, a month name's place in the year from April, a quarter or half by its first month. */
function orderOf(label: string, at: number): number {
  const slashed = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(label);
  if (slashed) return Date.UTC(Number(slashed[3]), Number(slashed[2]) - 1, Number(slashed[1]));
  const dashed = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/.exec(label.trim());
  if (dashed) {
    const month = MONTHS.indexOf(dashed[2].toUpperCase());
    return month < 0 ? at : Date.UTC(dashed[3].length === 2 ? 2000 + Number(dashed[3]) : Number(dashed[3]), month, Number(dashed[1]));
  }
  const named = /^([A-Za-z]{3})/.exec(label.trim());
  const month = named ? MONTHS.indexOf(named[1].toUpperCase()) : -1;
  if (month >= 0) {
    const year = /(\d{4})/.exec(label);
    // With a year it is a calendar order; without one, the financial year's, from April.
    return year ? Date.UTC(Number(year[1]), month, 1) : (month + 9) % 12;
  }
  return at;
}

export function canTrend(output: ReportOutput): boolean {
  if (!PERIOD_FORMATS.has(output.formating)) return false;
  return output.formating === "MONTHLY" ? true : output.rows.filter((row) => row.kind === "data").length > 1;
}

export function TrendChart({ output, shownIndexes }: { output: ReportOutput; shownIndexes: ReadonlySet<number> }) {
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const rows: OutputRow[] = output.rows.filter((row, index) => row.kind === "data" && shownIndexes.has(index) && !["AC", "OPENINGS", "CLOSING", "NARRATION", "COUNT"].includes(row.rowType));
    const numbers = output.columns.filter((column) => column.kind === "number");
    const periods = new Map<string, Period>();
    const add = (label: string, into: number, out: number, closing: number | null) => {
      if (label.trim() === "") return;
      const found = periods.get(label) ?? { label, order: orderOf(label, periods.size), into: 0, out: 0, closing: null };
      found.into += into;
      found.out += out;
      if (closing !== null) found.closing = (found.closing ?? 0) + closing;
      periods.set(label, found);
    };

    // The day book's Month: a pair of columns per month on one row.
    const monthColumns = output.columns.filter((column) => /^[A-Za-z]{3} (DEPOSIT|WITHDRAWAL|RECEIPT|PAYMENT|GIVEN|TAKEN)$/i.test(column.key));
    let inCaption = "In";
    let outCaption = "Out";
    if (monthColumns.length > 0) {
      const names = [...new Set(monthColumns.map((column) => column.key.slice(0, 3)))];
      const isIn = (column: OutputColumn) => /(DEPOSIT|RECEIPT|GIVEN)$/i.test(column.key);
      inCaption = monthColumns.find(isIn)?.key.slice(4) ?? "In";
      outCaption = monthColumns.find((column) => !isIn(column))?.key.slice(4) ?? "Out";
      for (const name of names) {
        let into = 0;
        let out = 0;
        for (const row of rows) {
          for (const column of monthColumns.filter((candidate) => candidate.key.startsWith(name))) {
            const value = amount(row.values[column.key]);
            if (/(DEPOSIT|RECEIPT|GIVEN)$/i.test(column.key)) into += value; else out += value;
          }
        }
        add(name, into, out, null);
      }
      return { periods: [...periods.values()].sort((a, b) => a.order - b.order), inCaption, outCaption };
    }

    const labelColumn = output.columns.find((column) => /^selected_date$/i.test(column.key)) ?? output.columns.find((column) => /^particulars$/i.test(column.key));
    // The closing balance line is one account's: with several accounts' rows a period's sum would leave out the accounts with no posting in it.
    const nameColumn = output.columns.find((column) => /^name$/i.test(column.key));
    const accounts = nameColumn ? new Set(rows.map((row) => (row.values[nameColumn.key] ?? "").trim()).filter((name) => name !== "" && !/^Opening Balance/i.test(name))) : new Set<string>();
    const closingColumn = accounts.size > 1 ? undefined : numbers.find((column) => /^closing_?bal|^closings$/i.test(column.key));
    const money2 = numbers.filter((column) => column !== closingColumn && !/RATE|PERC|%|CC_AMT|OPENING/i.test(column.key));
    const [first, second] = money2;
    if (!labelColumn || !first) return { periods: [], inCaption, outCaption };
    inCaption = first.caption;
    outCaption = second?.caption ?? "";
    for (const row of rows) {
      const label = (row.values[labelColumn.key] ?? "").trim();
      add(label, amount(row.values[first.key]), second ? amount(row.values[second.key]) : 0, closingColumn ? amount(row.values[closingColumn.key]) : null);
    }
    return { periods: [...periods.values()].sort((a, b) => a.order - b.order), inCaption, outCaption };
  }, [output, shownIndexes]);

  const { periods, inCaption, outCaption } = model;
  if (periods.length === 0) return <p className="rp-chart-empty">No periods to chart.</p>;

  const hasClosing = periods.some((period) => period.closing !== null);
  const values = periods.flatMap((period) => [period.into, period.out, ...(period.closing !== null ? [period.closing] : [])]);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const step = (() => {
    const span = (top - bottom) || 1;
    const rough = span / 4;
    const power = 10 ** Math.floor(Math.log10(rough));
    const unit = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
    return unit;
  })();
  const max = Math.ceil(top / step) * step;
  const min = Math.floor(bottom / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(tick);

  const groupWidth = Math.max(18, Math.min(46, Math.floor(318 / periods.length)));
  const left = 46;
  const height = 190;
  const topPad = 8;
  const bottomPad = 34;
  const width = left + periods.length * groupWidth + 8;
  const y = (value: number) => topPad + ((max - value) / ((max - min) || 1)) * (height - topPad - bottomPad);
  const zero = y(0);
  const bar = groupWidth * 0.34;
  const centre = (index: number) => left + index * groupWidth + groupWidth / 2;
  const line = hasClosing ? periods.map((period, index) => (period.closing === null ? null : `${centre(index).toFixed(1)},${y(period.closing).toFixed(1)}`)).filter(Boolean).join(" ") : "";
  const shown = hover !== null ? periods[hover] : null;
  const every = Math.ceil(periods.length / Math.max(1, Math.floor((width - left) / 54)));

  return (
    <figure className="rp-trend">
      <figcaption>Trend by period</figcaption>
      <div className="rp-trend-legend">
        <span><i style={{ background: IN_COLOUR }} />{inCaption}</span>
        {outCaption && <span><i style={{ background: OUT_COLOUR }} />{outCaption}</span>}
        {hasClosing && <span><i className="rp-trend-line" style={{ background: LINE_COLOUR }} />Closing balance</span>}
      </div>
      <div className="rp-trend-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`Trend by period: ${periods.map((period) => `${period.label} ${inCaption} ${money(period.into)} ${outCaption} ${money(period.out)}`).join("; ")}`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={width - 4} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#8f8d87" : "#e4e2dd"} strokeWidth={1} />
              <text x={left - 4} y={y(tick) + 3} textAnchor="end" className="rp-trend-axis">{short(tick)}</text>
            </g>
          ))}
          {periods.map((period, index) => {
            const x = centre(index);
            const active = hover === index;
            return (
              <g key={period.label} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
                <rect x={x - groupWidth / 2} y={topPad} width={groupWidth} height={height - topPad - bottomPad} fill={active ? "#eef4fc" : "transparent"} />
                {period.into !== 0 && <path d={`M ${x - bar - 0.5} ${zero} V ${y(period.into) + 3} Q ${x - bar - 0.5} ${y(period.into)} ${x - bar + 2.5} ${y(period.into)} H ${x - 3.5} Q ${x - 0.5} ${y(period.into)} ${x - 0.5} ${y(period.into) + 3} V ${zero} Z`} fill={IN_COLOUR} />}
                {period.out !== 0 && <path d={`M ${x + 0.5} ${zero} V ${y(period.out) + 3} Q ${x + 0.5} ${y(period.out)} ${x + 3.5} ${y(period.out)} H ${x + bar - 2.5} Q ${x + bar + 0.5} ${y(period.out)} ${x + bar + 0.5} ${y(period.out) + 3} V ${zero} Z`} fill={OUT_COLOUR} />}
                {index % every === 0 && <text x={x} y={height - 20} textAnchor="middle" className="rp-trend-axis" transform={periods.length > 12 ? `rotate(-35 ${x} ${height - 20})` : undefined}>{period.label.length > 14 ? `${period.label.slice(0, 13)}…` : period.label}</text>}
              </g>
            );
          })}
          {line && <polyline points={line} fill="none" stroke={LINE_COLOUR} strokeWidth={2} strokeLinejoin="round" />}
          {hasClosing && periods.map((period, index) => (period.closing === null ? null : <circle key={period.label} cx={centre(index)} cy={y(period.closing)} r={periods.length > 30 ? 2 : 3.5} fill={LINE_COLOUR} stroke="#fcfcfb" strokeWidth={2} />))}
        </svg>
      </div>
      <div className="rp-trend-tip" role="status">
        {shown ? (
          <>
            <b>{shown.label}</b>
            <span>{inCaption} {money(shown.into)}</span>
            {outCaption && <span>{outCaption} {money(shown.out)}</span>}
            {shown.closing !== null && <span>Closing {money(shown.closing)}</span>}
          </>
        ) : <span>Hover a period for its figures.</span>}
      </div>
    </figure>
  );
}
