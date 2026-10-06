import type { ReportOutput } from "./types";

/**
 * Compare periods: the date arithmetic for the period to compare with, and the matching of one
 * report's group subtotals with another's. Pure (no database), so it can be tested on its own;
 * the screen is features/report/ReportCompare.tsx.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400000;

/** dd/MMM/yyyy as a date (local midnight); null when it is not one. */
export function parseDate(text: string): Date | null {
  const match = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[2].toLowerCase());
  return month < 0 ? null : new Date(Number(match[3]), month, Number(match[1]));
}
export const formatDate = (date: Date): string => `${String(date.getDate()).padStart(2, "0")}/${MONTHS[date.getMonth()]}/${date.getFullYear()}`;
export const daysBetween = (a: Date, b: Date): number => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
export const addDays = (date: Date, days: number): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const lastDay = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/** The same date a month earlier (the 31st becomes the month's last day; a month end stays a month end). */
export function monthBefore(date: Date): Date {
  const month = date.getMonth() - 1;
  const year = date.getFullYear() + (month < 0 ? -1 : 0);
  const at = (month + 12) % 12;
  const isEnd = date.getDate() === lastDay(date.getFullYear(), date.getMonth());
  return new Date(year, at, isEnd ? lastDay(year, at) : Math.min(date.getDate(), lastDay(year, at)));
}

/** The period just before: as many days as from..upto, ending the day before from. */
export function periodBefore(from: Date, upto: Date): { from: Date; upto: Date } {
  const length = daysBetween(from, upto) + 1;
  const end = addDays(from, -1);
  return { from: addDays(end, -(length - 1)), upto: end };
}

export const amountOf = (text: string | undefined): number => Number((text ?? "").replace(/,/g, "")) || 0;

/** One group of a report (its subtotal's label and level) or the whole report: the amounts of each number column. */
export type CompareLine = { key: string; label: string; level: number; kind: "subtotal" | "total"; values: Record<string, number> };

/** An entry (voucher) row: not an opening or closing balance, a heading, a narration or a total. */
export const isEntry = (row: ReportOutput["rows"][number]) => row.kind === "data" && (row.rowType === "LED" || row.rowType === "") && !Object.values(row.values).some((value) => /^\s*(Opening|Closing) Balance|^Total Entries/i.test(value));

/**
 * The groups of an output and its whole, from the entries alone. The subtotal rows are no use: a
 * ledger's include the balance brought forward, which would make two periods compare their
 * openings. A group's amounts are those of the entry rows since its previous subtotal of the same
 * level; the final total is every entry.
 */
export function compareLines(output: Pick<ReportOutput, "columns" | "rows">): CompareLine[] {
  const numbers = output.columns.filter((column) => column.kind === "number");
  const text = output.columns.filter((column) => column.kind !== "number");
  const levels = Math.max(-1, ...output.rows.filter((row) => row.kind === "subtotal").map((row) => row.level)) + 1;
  const blank = () => Object.fromEntries(numbers.map((column) => [column.key, 0]));
  const running: Record<string, number>[] = Array.from({ length: levels }, blank);
  const whole = blank();
  const lines: CompareLine[] = [];
  for (const row of output.rows) {
    if (isEntry(row)) {
      for (const column of numbers) {
        const value = amountOf(row.values[column.key]);
        whole[column.key] += value;
        for (const level of running) level[column.key] += value;
      }
    } else if (row.kind === "subtotal" && row.level < levels) {
      const caption = text.map((column) => (row.values[column.key] ?? "").trim()).find((value) => value !== "") ?? "";
      const label = caption.replace(/^\*+\s*Subtotal For\s*:\s*/i, "").trim() || "(blank)";
      lines.push({ key: `subtotal|${row.level}|${label}`, label, level: row.level, kind: "subtotal", values: { ...running[row.level] } });
      running[row.level] = blank();
    }
  }
  lines.push({ key: "total|-1|All entries", label: "All entries", level: -1, kind: "total", values: whole });
  return lines;
}

export type CompareRow = { label: string; level: number; kind: "subtotal" | "total"; now: number; then: number };

/** Each group of the report now beside the same group before (a group only in one of them counts 0 in the other), the final total last. */
export function compareRows(now: readonly CompareLine[], before: readonly CompareLine[], columnKey: string): CompareRow[] {
  const earlier = new Map(before.map((line) => [line.key, line]));
  const rows: CompareRow[] = now.map((line) => ({ label: line.label, level: line.level, kind: line.kind, now: line.values[columnKey] ?? 0, then: earlier.get(line.key)?.values[columnKey] ?? 0 }));
  const seen = new Set(now.map((line) => line.key));
  for (const line of before) if (!seen.has(line.key)) rows.push({ label: line.label, level: line.level, kind: line.kind, now: 0, then: line.values[columnKey] ?? 0 });
  return [...rows.filter((row) => row.kind !== "total"), ...rows.filter((row) => row.kind === "total")];
}

/** "12.5%" of the change, "new" when there was nothing before, "—" when neither has an amount. */
export function changePercent(now: number, then: number): string {
  return then === 0 ? (now === 0 ? "—" : "new") : `${(((now - then) / Math.abs(then)) * 100).toFixed(1)}%`;
}
