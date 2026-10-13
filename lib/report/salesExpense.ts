import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { decimalRound, money, num } from "./run";

/**
 * Sales V/S Expense (report 280, SP_FRT_RPT_SALES_EXPENSE_REP): the month pivot, the % line and the % columns, apart from the database so
 * they can be tested on their own. The queries that feed it are salesExpense in reportFormating.ts.
 */

const LONG_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** One month's amount of a line (TEMP_TABLE_SALES_EXPENSE). */
export type SalesExpenseAmount = { code: number; particular: string; side: "SALES" | "EXPENSE"; head: string; month: number; amount: number };

const sqlUpper = (a: string, b: string): number => { const x = a.toUpperCase(); const y = b.toUpperCase(); return x === y ? 0 : x < y ? -1 : 1; };

/** The pivot and the % line (or the % columns), as the procedure's PivotData / SaleTotals / ExpenseTotals / SaleData. */
export function salesExpenseTable(amounts: readonly SalesExpenseAmount[], percentColumns: boolean): ResultTable {
  // The months with something, April first (SORTING_COL R01 .. R12).
  const months = [...new Set(amounts.map((line) => line.month))].sort((a, b) => ((a + 9) % 12) - ((b + 9) % 12)).map((month) => LONG_MONTH_NAMES[month]);
  const monthOf = (month: number) => LONG_MONTH_NAMES[month];
  type Line = { SMART_AC_CODE: number; Particular: string; SMART_SELECTED_ADDON1: string; SMART_SELECTED_ADDON2: string; months: Map<string, number> };
  const lines = new Map<string, Line>();
  for (const amount of amounts) {
    const key = JSON.stringify([amount.code, amount.particular, amount.side, amount.head]);
    const line = lines.get(key) ?? { SMART_AC_CODE: amount.code, Particular: amount.particular, SMART_SELECTED_ADDON1: amount.side, SMART_SELECTED_ADDON2: amount.head, months: new Map<string, number>() };
    line.months.set(monthOf(amount.month), money((line.months.get(monthOf(amount.month)) ?? 0) + amount.amount));
    lines.set(key, line);
  }
  const pivot = [...lines.values()];
  const count = months.length;
  const table = new ResultTable();
  for (const column of ["SMART_AC_CODE", "Particular", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2"]) table.addColumn(column);
  table.setKind("SMART_AC_CODE", "int");
  const cell = (line: Line, month: string) => line.months.get(month) ?? null;
  const sales = pivot.filter((line) => line.SMART_SELECTED_ADDON1 === "SALES");
  const percent = (part: number | null, whole: number | null) => (part === null || whole === null || whole === 0 ? null : decimalRound((100 * part) / whole, 2));

  if (!percentColumns) {
    for (const month of [...months, "Total", "AVG_PER_MONTH"]) table.setKind(month, "decimal");
    const total = (line: Line) => money(months.reduce((sum, month) => sum + (cell(line, month) ?? 0), 0));
    for (const line of pivot) {
      const values: ResultRow = { SMART_AC_CODE: line.SMART_AC_CODE, Particular: line.Particular, SMART_SELECTED_ADDON1: line.SMART_SELECTED_ADDON1, SMART_SELECTED_ADDON2: line.SMART_SELECTED_ADDON2 };
      for (const month of months) values[month] = cell(line, month);
      values.Total = total(line);
      values.AVG_PER_MONTH = decimalRound(total(line) / count, 2);
      table.rows.push(values);
    }
    // SaleTotals / ExpenseTotals: the side's sum a month (null when the side has no line), and of the totals; then the % line.
    const sideSum = (side: string, month: string | null) => {
      const of = pivot.filter((line) => line.SMART_SELECTED_ADDON1 === side);
      if (of.length === 0) return null;
      if (month === null) return money(of.reduce((sum, line) => sum + total(line), 0));
      const cells = of.map((line) => cell(line, month)).filter((value): value is number => value !== null);
      return cells.length === 0 ? null : money(cells.reduce((sum, value) => sum + value, 0));
    };
    const saleTotal = sideSum("SALES", null);
    const expenseTotal = sideSum("EXPENSE", null);
    const average = (value: number | null) => (value === null ? null : decimalRound(value / count, 2));
    const share: ResultRow = { SMART_AC_CODE: 0, Particular: "TOTAL EXP %", SMART_SELECTED_ADDON1: "EXP %", SMART_SELECTED_ADDON2: "EXP %" };
    for (const month of months) share[month] = percent(sideSum("EXPENSE", month), sideSum("SALES", month));
    share.Total = percent(expenseTotal, saleTotal);
    share.AVG_PER_MONTH = percent(average(expenseTotal), average(saleTotal));
    table.rows.push(share);
  } else {
    for (const month of months) { table.setKind(month, "decimal"); table.setKind(`${month}_Perc`, "decimal"); }
    table.setKind("TOTAL", "decimal");
    table.setKind("AVG_PER_MONTH", "decimal");
    // CROSS JOIN SaleData: a row for each line and SALES line (none without sales).
    for (const sale of sales) {
      for (const line of pivot) {
        const values: ResultRow = { SMART_AC_CODE: line.SMART_AC_CODE, Particular: line.Particular, SMART_SELECTED_ADDON1: line.SMART_SELECTED_ADDON1, SMART_SELECTED_ADDON2: line.SMART_SELECTED_ADDON2 };
        for (const month of months) {
          values[month] = cell(line, month);
          values[`${month}_Perc`] = percent(cell(line, month), cell(sale, month));
        }
        const totalValue = months.reduce((sum, month) => sum + decimalRound(cell(line, month) ?? 0, 2), 0);
        values.TOTAL = decimalRound(totalValue, 2);
        values.AVG_PER_MONTH = decimalRound(totalValue / count, 2);
        table.rows.push(values);
      }
    }
  }
  const totalColumn = percentColumns ? "TOTAL" : "Total";
  table.rows = table.rows.filter((row) => !(row.SMART_SELECTED_ADDON1 === "EXPENSE" && num(row[totalColumn]) <= 0));
  table.rows.sort((a, b) => sqlUpper(String(b.SMART_SELECTED_ADDON1), String(a.SMART_SELECTED_ADDON1)) || sqlUpper(String(a.SMART_SELECTED_ADDON2), String(b.SMART_SELECTED_ADDON2)) || sqlUpper(String(a.Particular), String(b.Particular)));
  return table;
}
