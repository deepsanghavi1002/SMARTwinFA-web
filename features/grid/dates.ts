import { parseDesktopDate } from "../../lib/master-program/legacy";

/** Typing dates in any grid (master, small entry, entry, reports). */
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The day the accounting year ends: a year after `yearStart`, less a day. */
export function yearEndOf(yearStart: Date): Date {
  return new Date(yearStart.getFullYear() + 1, yearStart.getMonth(), yearStart.getDate() - 1);
}

/**
 * The one-letter date shortcuts (either case): T today, S accounting year start, E accounting
 * year end, F first day and L last day of the month of `base` (else today's). Today is kept
 * inside the accounting year. Null for any other key, and for S / E when the year is not known.
 */
export function shortcutDate(key: string, yearStart: Date | null, base: Date | null, today: Date = new Date()): Date | null {
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const k = key.toLowerCase();
  if (k === "s") return yearStart ? day(yearStart) : null;
  if (k === "e") return yearStart ? yearEndOf(yearStart) : null;
  if (k === "t") {
    const now = day(today);
    if (!yearStart) return now;
    const end = yearEndOf(yearStart);
    return now < day(yearStart) ? day(yearStart) : now > end ? end : now;
  }
  const month = base ?? day(today);
  if (k === "f") return new Date(month.getFullYear(), month.getMonth(), 1);
  if (k === "l") return new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return null;
}

/** `date` moved by whole months, the day kept (or cut to the month's last day). */
export function addMonths(date: Date, months: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last));
}

/**
 * Short ways to type a date. "2309", "23/9", "23-9" and "23sep" are 23 September in the
 * accounting year (tarikh1..tarikh2: a month before the year's start month falls in its
 * second calendar year). "230926" and "23092026" give the year too. A trailing +n or -n
 * adds or takes days ("0109+5" is 6 September), and a bare "+5" / "-5" counts from `base`
 * (the date already in the field, else today). Returns null when the text is not a date.
 */
export function shorthandDate(typed: string, yearStart: Date | null, base: Date | null): Date | null {
  /** A day and month (0-based) in the accounting year unless a year is given; null if no such day. */
  const build = (day: number, month: number, year?: number): Date | null => {
    if (year !== undefined && year < 100) year += 2000;
    if (year === undefined) {
      year = yearStart ? yearStart.getFullYear() : new Date().getFullYear();
      if (yearStart && month < yearStart.getMonth()) year += 1;
    }
    const date = new Date(year, month, day);
    return month >= 0 && month < 12 && date.getMonth() === month && date.getDate() === day ? date : null;
  };
  const whole = (text: string): Date | null => {
    const t = text.trim().toLowerCase();
    let day: number, month: number, year: number | undefined;
    let m = /^(\d{1,2})[\s./-]?([a-z]{3})[a-z]*(?:[\s./-]?(\d{2}|\d{4}))?$/.exec(t);
    if (m && MONTH_NAMES.includes(m[2])) { day = +m[1]; month = MONTH_NAMES.indexOf(m[2]); year = m[3] ? +m[3] : undefined; }
    else if (/^\d{2,8}$/.test(t)) return digitsDate(t);
    else if ((m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(t))) { day = +m[1]; month = +m[2] - 1; year = m[3] ? +m[3] : undefined; }
    // Only the stored full forms (ISO, or dd/MMM/yyyy with a time) go to the general reader.
    else return /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-][a-z]{3}[/-]\d{4}\s)/.test(t) ? parseDesktopDate(text) : null;
    return build(day, month, year);
  };
  /**
   * Digits only, read the first way that makes a real date: "15" 1 May, "154" 15 Apr,
   * "2309" 23 Sep, "1426" (not a day-month) 1 Apr 2026, "230926" and "23092026" with the year.
   */
  const digitsDate = (t: string): Date | null => {
    // [day, month, year, near]: a "near" reading is a guess, taken only when its year is within
    // a year of the accounting year ("3109" is not 3 Oct 2009).
    const readings: [number, number, number?, boolean?][] = [];
    const n = (from: number, to?: number) => Number(t.slice(from, to));
    if (t.length === 2) readings.push([n(0, 1), n(1)]);
    if (t.length === 3) readings.push([n(0, 2), n(2)], [n(0, 1), n(1)]);
    if (t.length === 4) readings.push([n(0, 2), n(2)], [n(0, 1), n(1, 2), n(2), true]);
    if (t.length === 5) readings.push([n(0, 2), n(2, 3), n(3), true], [n(0, 1), n(1, 3), n(3), true]);
    if (t.length === 6) readings.push([n(0, 2), n(2, 4), n(4)]);
    if (t.length === 8) readings.push([n(0, 2), n(2, 4), n(4)]);
    const around = (yearStart ?? new Date()).getFullYear();
    for (const [day, month, year, near] of readings) {
      const date = build(day, month - 1, year);
      if (date && (!near || Math.abs(date.getFullYear() - around) <= 1)) return date;
    }
    return null;
  };
  const exact = whole(typed);
  if (exact) return exact;
  const shift = /^(.*?)\s*([+-])\s*(\d{1,4})\s*$/.exec(typed);
  if (!shift) return null;
  const from = shift[1].trim() === "" ? base ?? new Date(new Date().toDateString()) : whole(shift[1]);
  if (!from) return null;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + (shift[2] === "+" ? 1 : -1) * Number(shift[3]));
}
