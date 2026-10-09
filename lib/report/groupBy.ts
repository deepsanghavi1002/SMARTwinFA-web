import { amountOf, isEntry } from "./compare";
import type { OutputColumn, OutputRow, ReportOutput } from "./types";

/**
 * Group By (web only): the rows on screen regrouped by up to three levels, a column or a period
 * of a date column, with a subtotal under each group, an outer group's after its inner ones, and a
 * final total. Worked on the rows already loaded, so it is instant and works for every report; the
 * result is an output like any other (the tree, F6, the chart and Compare all follow it).
 *
 * Only the entries are regrouped (not headings, narration, openings, closings or the report's own
 * subtotals). A running balance means nothing once rows are in a new order, so the closing balance
 * and DR / CR columns are left blank.
 */

export type PeriodUnit = "day" | "week" | "fifteen" | "fourweek" | "month" | "quarter" | "half" | "year";
export type GroupSpec = Readonly<{ kind: "column"; key: string } | { kind: "period"; key: string; unit: PeriodUnit }>;

export const PERIOD_UNITS: readonly (readonly [PeriodUnit, string])[] = [["day", "Day"], ["week", "Week"], ["fifteen", "15 Days"], ["fourweek", "4 Week Month"], ["month", "Month"], ["quarter", "Quarter"], ["half", "Half Year"], ["year", "Year"]];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** A cell's date ("03-Apr-2026", "03-Apr-26", "03/04/2026"); null when it is not one. */
export function cellDate(text: string): Date | null {
  const named = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})$/.exec(text.trim());
  if (named) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === named[2].toLowerCase());
    return month < 0 ? null : new Date(named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3]), month, Number(named[1]));
  }
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return slashed ? new Date(Number(slashed[3]), Number(slashed[2]) - 1, Number(slashed[1])) : null;
}

const dayText = (date: Date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;

/** The period a date falls in: its label and where it sorts (its first day). A week runs Sunday to Saturday, 15 Days are the 1st-15th and the 16th to month end (as the formats of the reports do), 4 Weeks are 7-day blocks from the financial year's 1 April (1-7, 8-14, 15-21, 22-28, then 29-5 ...), a quarter is Jan-Mar, Apr-Jun ..., a half year is Apr-Sep or Oct-Mar, a year is the financial year (April to March). */
export function periodOf(date: Date, unit: PeriodUnit): { label: string; order: number } {
  switch (unit) {
    case "day": return { label: `${pad(date.getDate())}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`, order: date.getTime() };
    case "week": {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      return { label: `${dayText(start)} To ${dayText(end)}`, order: start.getTime() };
    }
    case "fifteen": {
      const second = date.getDate() > 15;
      const start = new Date(date.getFullYear(), date.getMonth(), second ? 16 : 1);
      const end = second ? new Date(date.getFullYear(), date.getMonth() + 1, 0) : new Date(date.getFullYear(), date.getMonth(), 15);
      return { label: `${dayText(start)} To ${dayText(end)}`, order: start.getTime() };
    }
    case "fourweek": {
      // Weeks of a four-week month: 7-day blocks counted from the financial year's 1 April, so a month's weeks are 1-7, 8-14, 15-21 and
      // 22-28, and the next month starts on the 29th (29 Apr-5 May ...). The blocks run on across calendar months.
      const yearStart = new Date(date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1, 3, 1);
      const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(yearStart.getFullYear(), 3, 1)) / 86400000);
      const start = new Date(yearStart.getFullYear(), 3, 1 + Math.floor(days / 7) * 7);
      // The year's last block stops on 31 March: the next financial year counts from its own 1 April.
      const yearEnd = new Date(yearStart.getFullYear() + 1, 2, 31);
      const seventh = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const end = seventh.getTime() > yearEnd.getTime() ? yearEnd : seventh;
      return { label: `${dayText(start)} To ${dayText(end)}`, order: start.getTime() };
    }
    case "month": return { label: `${MONTHS[date.getMonth()]}-${date.getFullYear()}`, order: new Date(date.getFullYear(), date.getMonth(), 1).getTime() };
    case "quarter": {
      const first = Math.floor(date.getMonth() / 3) * 3;
      return { label: `${MONTHS[first]} - ${MONTHS[first + 2]} ${date.getFullYear()}`, order: new Date(date.getFullYear(), first, 1).getTime() };
    }
    case "half": {
      // The financial year's halves, as the reports' Half Year format: Apr-Sep and Oct-Mar.
      const first = date.getMonth() >= 3 && date.getMonth() <= 8;
      const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
      return first
        ? { label: `Apr - Sep ${year}`, order: new Date(year, 3, 1).getTime() }
        : { label: `Oct ${year} - Mar ${year + 1}`, order: new Date(year, 9, 1).getTime() };
    }
    case "year": {
      const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
      return { label: `FY ${start}-${String(start + 1).slice(-2)}`, order: new Date(start, 3, 1).getTime() };
    }
  }
}

/**
 * The columns a report can be grouped by period on: a column typed as a date, or any other column
 * whose name says "date" and whose filled rows read as dates (the checklist reports' DATE, CHQ_DATE ...
 * come back as text), so every report with a date offers "DATE by Day / Week / 15 Days / Month ...".
 */
export function dateColumns(output: ReportOutput): OutputColumn[] {
  const sample = output.rows.filter((row) => isEntry(row)).slice(0, 300);
  return output.columns.filter((column) => {
    if (!column.visible) return false;
    if (column.kind === "date") return true;
    if (column.kind === "number" || !/date/i.test(`${column.key} ${column.caption}`)) return false;
    const filled = sample.map((row) => (row.values[column.key] ?? "").trim()).filter((value) => value !== "");
    return filled.length > 0 && filled.filter((value) => cellDate(value) !== null).length >= filled.length * 0.8;
  });
}

export function specCaption(spec: GroupSpec, columns: readonly OutputColumn[]): string {
  const caption = columns.find((column) => column.key === spec.key)?.caption ?? spec.key;
  return spec.kind === "column" ? caption : `${caption} (${PERIOD_UNITS.find(([unit]) => unit === spec.unit)?.[1] ?? spec.unit})`;
}

/** Columns that stand for a running balance (blank after regrouping). */
const BALANCE = /^closing_?bal|^closings$|^dr_cr$|^opening_?bal/i;

type Label = { label: string; order: number | null };

/** Each level's label for an entry (and what it sorts by: a period's first day, else the text). */
function labelsOf(row: OutputRow, specs: readonly GroupSpec[]): Label[] {
  return specs.map((spec) => {
    const text = (row.values[spec.key] ?? "").trim();
    if (spec.kind === "column") return { label: text === "" ? "(blank)" : text, order: null };
    const date = cellDate(text);
    if (!date) return { label: "(no date)", order: Number.MAX_SAFE_INTEGER };
    return periodOf(date, spec.unit);
  });
}

const compareLabels = (a: Label, b: Label) => (a.order !== null && b.order !== null
  ? a.order - b.order
  : a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));

export function applyGroupBy(output: ReportOutput, specs: readonly GroupSpec[]): ReportOutput {
  if (specs.length === 0) return output;
  const numbers = output.columns.filter((column) => column.kind === "number" && !BALANCE.test(column.key) && !/RATE|PERC|%/i.test(`${column.key} ${column.caption}`));
  const total = output.rows.find((row) => row.kind === "total");
  const summed = total ? numbers.filter((column) => (total.values[column.key] ?? "") !== "") : numbers;
  const sums = summed.length > 0 ? summed : numbers;
  const headingColumn = output.columns.find((column) => column.key === "HEADING_COLUMN_BY_SYSTEM") ?? output.columns.find((column) => column.kind === "text");
  const format = (value: number, column: OutputColumn) => value.toLocaleString("en-IN", { minimumFractionDigits: column.decimals, maximumFractionDigits: column.decimals });

  const entries = output.rows.filter((row) => isEntry(row)).map((row, index) => ({ row, index, labels: labelsOf(row, specs) }));
  entries.sort((a, b) => {
    for (let level = 0; level < specs.length; level += 1) {
      const order = compareLabels(a.labels[level], b.labels[level]);
      if (order !== 0) return order;
    }
    return a.index - b.index;
  });

  const rows: OutputRow[] = [];
  const running: number[][] = specs.map(() => sums.map(() => 0));
  const whole = sums.map(() => 0);
  const subtotal = (level: number, label: string, amounts: readonly number[]): OutputRow => {
    const values: Record<string, string> = {};
    sums.forEach((column, at) => { values[column.key] = format(amounts[at], column); });
    if (headingColumn) values[headingColumn.key] = `${"*".repeat(level + 1)} Subtotal For : ${label} `;
    return { kind: "subtotal", level, rowType: "", values, ledKey: 0, processKey: 0 };
  };

  entries.forEach(({ row, labels }, at) => {
    const values: Record<string, string> = { ...row.values };
    for (const column of output.columns) if (BALANCE.test(column.key)) values[column.key] = "";
    rows.push({ ...row, values });
    sums.forEach((column, index) => {
      const amount = amountOf(row.values[column.key]);
      whole[index] += amount;
      for (const level of running) level[index] += amount;
    });
    const next = entries[at + 1];
    for (let level = specs.length - 1; level >= 0; level -= 1) {
      // A group ends where the next entry differs at this level or any level outside it.
      const ends = !next || next.labels.slice(0, level + 1).some((label, index) => label.label !== labels[index].label);
      if (!ends) continue;
      rows.push(subtotal(level, labels[level].label, running[level]));
      running[level] = sums.map(() => 0);
    }
  });
  const totalValues: Record<string, string> = {};
  sums.forEach((column, index) => { totalValues[column.key] = format(whole[index], column); });
  if (headingColumn) totalValues[headingColumn.key] = `${"*".repeat(specs.length)}* Final Total : `;
  rows.push({ kind: "total", level: -1, rowType: "", values: totalValues, ledKey: 0, processKey: 0 });

  return {
    ...output,
    rows,
    records: entries.length,
    groups: specs.map((spec) => specCaption(spec, output.columns)),
    subtotals: true,
    formating: "",
    headingCaptions: {},
  };
}

/**
 * Remove Group (web only): the report's group headings (AC, BOOK, ADDON_1 ...) and its subtotal
 * lines taken off, leaving the entries and the final total, so the ▾ column filters and the
 * Planning buttons can narrow the rows instead.
 */
export function removeGroups(output: ReportOutput): ReportOutput {
  const headings = new Set([...Object.keys(output.headingColours), ...Object.keys(output.headingLevels ?? {}), ...Object.keys(output.headingCaptions)]);
  const isHeading = (row: OutputRow) => row.kind === "data" && (row.rowType === "GAP" || headings.has(row.rowType) || /^(ADDON_\d|AC|BOOK|SCHEDULE|GROUP\d*)$/.test(row.rowType));
  const rows = output.rows.filter((row) => row.kind !== "subtotal" && !isHeading(row));
  return { ...output, rows, groups: [], subtotals: false, headingCaptions: {}, headingLevels: {} };
}
