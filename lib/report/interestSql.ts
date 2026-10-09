/**
 * SP_FRT_RPT_INTEREST's arithmetic and SQL pieces, apart from the database (so they can be tested on their own): the rate and the
 * days of the year, the percent expressions, and the summary format's roll-up of each party's balance into periods. PostgreSQL;
 * the SQL Server original is quoted where it differs.
 */

/** Feb of the year (of Tarikh2) has 28 days: 365; else 366. */
export const daysInYear = (yearEnd: Date): number => { const year = yearEnd.getFullYear(); return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365; };

const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** The rate typed in the runtime box (12 when blank) and its percent as the desktop rounds it (INT_PERC). */
export function interestRate(typed: string): { rate: number; percent: number; typed: boolean } {
  const text = typed.trim();
  const rate = text === "" ? 12 : Number(text);
  return { rate: Number.isFinite(rate) ? rate : 12, percent: round4((Number.isFinite(rate) ? rate : 12) / 100), typed: text !== "" };
}

/** The percent an account (or ledger line) is charged: its own INT_PERC unless 0 (the typed rate when one is typed, for every account). */
export function percentExpression(rate: { rate: number; percent: number; typed: boolean }): string {
  return rate.typed ? String(rate.percent) : `(case when ac.int_perc::numeric=0 then ${round4(rate.rate / 100)} else round(ac.int_perc::numeric/100,4) end)`;
}

/** The INTEREST column: the account's own rate, or the rate typed. */
export function interestExpression(rate: { rate: number; typed: boolean }): string {
  return rate.typed ? String(rate.rate) : `(case when ac.int_perc::numeric=0 then ${rate.rate} else ac.int_perc::numeric end)`;
}

/** DATEDIFF(d, a, b) of two dates. */
export const daysBetween = (from: Date, upto: Date): number => Math.round((Date.UTC(upto.getFullYear(), upto.getMonth(), upto.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);

/** dd/mm/yyyy as a date; null when it is not one. */
export function parseDmy(text: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

const dmy = (date: Date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
const ymd = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;

/** A row of the detail table that the summary format reads. */
export type InterestLine = { name: string; date: string; principal: number; side: string };

export type SummaryRow = { SMART_NAME: string; Name: string; CLOSING_AMT: number; FROM_DATE: string; UPTO_DATE: string; DAYS: number; INT_RATE: number; Interest_Amt: number; DR_CR: string; SORTING_DATE: string };

/**
 * The summary format: for each party the balance (credits plus, debits minus) from each date its balance changed to the day before the next
 * change, and from the last change to the Upto date, with the interest at the one rate for that period. A period whose date does not
 * change adds nothing; the last period of a party (and of the report) ends on the Upto date (the text as the desktop gives it).
 */
export function summarize(lines: readonly InterestLine[], rate: number, noOfDays: number, uptoText: string, upto: Date): SummaryRow[] {
  const out: SummaryRow[] = [];
  const same = (a: string, b: string) => a.trimEnd().toLowerCase() === b.trimEnd().toLowerCase();
  const interest = (total: number, from: Date, to: Date) => {
    const days = daysBetween(from, to) + 1;
    return { days, amount: round2(((total * round4(rate / 100)) / noOfDays) * days) };
  };
  const row = (party: string, total: number, from: string, uptoLabel: string, to: Date): SummaryRow => {
    const start = parseDmy(from) ?? to;
    const { days, amount } = interest(total, start, to);
    return { SMART_NAME: party, Name: party, CLOSING_AMT: round2(total), FROM_DATE: from, UPTO_DATE: uptoLabel, DAYS: days, INT_RATE: rate, Interest_Amt: amount, DR_CR: amount > 0 ? "Cr" : "Dr", SORTING_DATE: `${party} ${ymd(start)}A` };
  };
  let found = "";
  let foundFrom = "";
  let total = 0;
  for (const line of lines) {
    if (found !== "" && same(found, line.name) && foundFrom !== line.date) {
      const dayBefore = parseDmy(line.date);
      if (dayBefore) { dayBefore.setDate(dayBefore.getDate() - 1); out.push(row(found, total, foundFrom, dmy(dayBefore), dayBefore)); }
    }
    if (found !== "" && !same(found, line.name)) {
      out.push(row(found, total, foundFrom, uptoText, upto));
      total = 0;
    }
    found = line.name;
    foundFrom = line.date;
    total = round2(total + (line.side === "Cr" ? line.principal : -line.principal));
  }
  if (found !== "") out.push(row(found, total, foundFrom, uptoText, upto));
  return out;
}
