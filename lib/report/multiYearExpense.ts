import { ResultTable } from "./call";
import type { ResultRow } from "./call";

/**
 * Multi Year Expense Summary (report 106, SP_FRT_RPT_MULTI_YEAR_EXPENSE_SUMMARY_REP): the expense accounts of the company's years side by
 * side, apart from the database so it can be tested on its own. The queries that feed it are multiYearExpense in reportFormating.ts.
 *
 * The rows are the last year's live accounts of book 1 whose balance sheet code starts 02 (expense), with their balance sheet head
 * (SMART_SELECTED_ADDON1), ordered by head and name. A year's figure is what was debited to the account in the year's dates (From / Upto's day
 * and month in that year); the earlier years' account is the live one of the same name. A column a year (Ex_Apr2025_Mar2026, the first and last
 * month and year), or with Month Wise a column a month, April first (Apr_25_26 ...) and the year's total (Ex_2025_2026).
 * Without Month Wise each earlier year also adds the expense accounts the rows do not have yet (by name, that year's figure only), and a figure
 * of 0 is read again as what was credited to the account of that name (any position) that year. The last year gets neither.
 */

export type ExpenseAccount = Readonly<{ code: number; name: string; live: boolean; head: string; expense: boolean }>;
export type ExpenseYear = Readonly<{
  from: Date;
  upto: Date;
  /** The accounts of book 1. */
  accounts: readonly ExpenseAccount[];
  /** What was debited to an account code: by month (1-12), 0 for the whole period. */
  debit: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /** What was credited to an account code in the whole period. */
  credit: ReadonlyMap<number, number>;
}>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const yy = (date: Date) => String(date.getFullYear()).slice(-2);

type Row = { name: string; head: string; values: (number | null)[]; months: Map<string, number> };

export function multiYearExpense(years: readonly ExpenseYear[], monthWise: boolean): ResultTable {
  const table = new ResultTable();
  table.addColumn("NAME");
  table.addColumn("SMART_SELECTED_ADDON1");
  if (years.length === 0) return table;
  const names = years.map((year) => {
    const total = monthWise ? `Ex_${year.from.getFullYear()}_${year.upto.getFullYear()}`
      : `Ex_${MONTHS[year.from.getMonth()]}${year.from.getFullYear()}_${MONTHS[year.upto.getMonth()]}${year.upto.getFullYear()}`;
    return { months: monthWise ? FISCAL_MONTHS.map((number) => ({ number, name: `${MONTHS[number - 1]}_${yy(year.from)}_${yy(year.upto)}` })) : [], total };
  });
  for (const name of names) { for (const month of name.months) table.setKind(month.name, "decimal"); table.setKind(name.total, "decimal"); }

  const last = years.length - 1;
  const liveByName = years.map((year) => {
    const map = new Map<string, ExpenseAccount>();
    for (const account of year.accounts) if (account.live && !map.has(account.name)) map.set(account.name, account);
    return map;
  });
  const anyByName = years.map((year) => {
    const map = new Map<string, ExpenseAccount>();
    for (const account of year.accounts) if (account.expense && !map.has(account.name)) map.set(account.name, account);
    return map;
  });
  const debitOf = (year: ExpenseYear, account: ExpenseAccount | undefined, month: number) => (account ? year.debit.get(account.code)?.get(month) ?? 0 : 0);

  const rows: Row[] = [];
  const known = new Set<string>();
  for (const account of years[last].accounts) {
    if (!account.live || !account.expense) continue;
    const values = years.map((year, index) => debitOf(year, index === last ? account : liveByName[index].get(account.name), 0));
    const row: Row = { name: account.name, head: account.head, values, months: new Map() };
    years.forEach((year, index) => {
      const match = index === last ? account : liveByName[index].get(account.name);
      for (const month of names[index].months) row.months.set(month.name, debitOf(year, match, month.number));
    });
    rows.push(row);
    known.add(account.name);
  }
  if (!monthWise) {
    for (let index = 0; index < last; index++) {
      const year = years[index];
      for (const account of year.accounts) {
        if (!account.live || !account.expense || known.has(account.name)) continue;
        const values = years.map((_, at) => (at === index ? debitOf(year, account, 0) : null));
        rows.push({ name: account.name, head: account.head, values, months: new Map() });
        known.add(account.name);
      }
      for (const row of rows) {
        if (row.values[index] !== 0) continue;
        const match = anyByName[index].get(row.name);
        if (match) row.values[index] = year.credit.get(match.code) ?? 0;
      }
    }
  }

  table.rows = rows
    .map((row, position) => ({ row, position }))
    .sort((a, b) => (a.row.head === b.row.head ? (a.row.name === b.row.name ? a.position - b.position : a.row.name < b.row.name ? -1 : 1) : a.row.head < b.row.head ? -1 : 1))
    .map(({ row }) => {
      const values: ResultRow = { NAME: row.name, SMART_SELECTED_ADDON1: row.head };
      names.forEach((name, index) => {
        for (const month of name.months) values[month.name] = row.months.get(month.name) ?? null;
        values[name.total] = row.values[index];
      });
      return values;
    });
  return table;
}
