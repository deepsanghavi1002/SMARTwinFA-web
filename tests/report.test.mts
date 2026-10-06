import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { convertForOperation, dateStyle112, dateStyle6, formulaValidation, parseSelectionDate, quotedList, sqlLen, sqlServerCompare } = await import("../lib/report/formula.ts");
const { pgFragment } = await import("../lib/report/sqlText.ts");
const { literal, setBooksValueInString, setupSelect } = await import("../lib/report/sqlText.ts");

test("Report_Combine.ConvertForOperation and FormulaValidation", () => {
  assert.deepEqual(convertForOperation("!(month)"), { op: "!", rest: "month" });
  assert.deepEqual(convertForOperation("in(1,2)"), { op: "IN", rest: "1,2" });
  assert.deepEqual(convertForOperation("8"), { op: "=", rest: "8" });
  assert.equal(formulaValidation("IN", "2", "1,2,3", false), true);
  assert.equal(formulaValidation("IN", "12", "1,2,3", false), false, "an IN list is matched item by item, not by substring");
  assert.equal(formulaValidation("NOT IN", "4", "1,2,3", false), true);
  assert.equal(formulaValidation(">", "10", "8", true), true);
  assert.equal(formulaValidation(">", "x", "8", true), false);
});

test("SORTING_COL order is SQL Server's: case ignored, space before punctuation before digits before letters", () => {
  const rows = [" Zeta1   P", " alpha12   H", " Alpha12   O", " Alpha12   P20260401", " Alpha12z", null, " Alpha-1   H"];
  const sorted = [...rows].sort(sqlServerCompare);
  assert.deepEqual(sorted, [null, " Alpha-1   H", " alpha12   H", " Alpha12   O", " Alpha12   P20260401", " Alpha12z", " Zeta1   P"]);
  assert.equal(sqlServerCompare("ABC  ", "abc"), 0, "trailing blanks are ignored");
});

test("date styles the ledger procedure writes", () => {
  const date = new Date(2026, 3, 1);
  assert.equal(dateStyle6(date), "01-Apr-26");
  assert.equal(dateStyle112(date), "20260401");
  assert.equal(parseSelectionDate("05/Oct/2026")?.getMonth(), 9);
  assert.equal(parseSelectionDate("31/Feb/2026"), null);
  assert.equal(sqlLen("ab  "), 2);
  assert.equal(quotedList("1,2", "'"), "'1','2'");
});

test("setup SQL written for SQL Server reads in PostgreSQL", () => {
  assert.equal(setupSelect(`SELECT 'MAIN' AS "DISP_COL",1 AS "VALUE_COL" ORDER BY VALUE_COL`), `SELECT 'MAIN' AS "DISP_COL",1 AS "VALUE_COL" ORDER BY "VALUE_COL"`);
  assert.equal(setupSelect("select space(3) as x"), "select repeat(' ', 3) as x");
  assert.equal(literal("a = |sys.tarikh1| or b = '|sys.tarikh1|'", "|sys.tarikh1|", "01/Apr/2026"), "a = '01/Apr/2026' or b = '01/Apr/2026'");
  assert.equal(setBooksValueInString("book in (|PCbook_DRSLED|,|PCbook_JOURNAL|)"), "book in (2,19)");
  assert.equal(pgFragment("case when x then ledpost.post_amt else 0.00 end from |sys.db|ledger", { moneyColumns: ["post_amt"] }, "co"), "case when x then ledpost.post_amt::numeric else 0.00 end from co.ledger");
  assert.equal(pgFragment("ledpost.post_amt::numeric", { moneyColumns: ["post_amt"] }, "co"), "ledpost.post_amt::numeric", "a cast already there is left alone");
  assert.equal(pgFragment(`case when bk_dbcode=1 then amount else 0.00 end as "RECEIPT"`, { moneyColumns: ["amount"] }, "co"), `case when bk_dbcode=1 then amount::numeric else 0.00 end as "RECEIPT"`, "a bare money column as a CASE result");
  assert.equal(pgFragment(`sum(amount) as "amount"`, { moneyColumns: ["amount"] }, "co"), `sum(amount) as "amount"`, "only CASE results are cast bare");
  assert.equal(pgFragment("led.type=9 and led.\"TYPE\"=1 and ac.limit>0 and x.type=2", { moneyColumns: [] }, "co"), "led.\"TYPE\"=9 and led.\"TYPE\"=1 and ac.\"LIMIT\">0 and x.type=2", "the columns PostgreSQL keeps in capitals");
});

test("cash planning: balance, days of cash, and how much of a limit is drawn", async () => {
  const { planCash } = await import("../lib/report/planning.ts");
  const base = { account: "Cash", book: 4, asOf: "06/Oct/2026", opening: 10000, months: [{ month: "2026-04", receipts: 5000, payments: 9000 }, { month: "2026-05", receipts: 0, payments: 3000 }], recentPayments: 3000, windowDays: 30, limit: 0, interest: 0 };
  const cash = planCash(base);
  assert.equal(cash.closing, 3000);
  assert.deepEqual(cash.months.map((month) => month.closing), [6000, 3000]);
  assert.equal(cash.averageDailyPayment, 100);
  assert.equal(cash.daysOfCash, 30, "3000 at 100 a day");
  assert.equal(planCash({ ...base, recentPayments: 0 }).daysOfCash, null, "nothing paid out to measure against");

  // A bank cash credit: the overdrawn balance is what is drawn on the limit.
  const credit = planCash({ ...base, book: 6, opening: -80000, months: [{ month: "2026-04", receipts: 20000, payments: 40000 }], limit: 100000 });
  assert.equal(credit.closing, -100000);
  assert.equal(credit.utilised, 100000);
  assert.equal(credit.utilisation, 1);
  assert.equal(credit.available, 0);
  assert.equal(credit.daysOfCash, null, "overdrawn has no cash left");
  const part = planCash({ ...base, book: 6, opening: -50000, months: [], limit: 200000 });
  assert.equal(part.utilisation, 0.25);
  assert.equal(part.available, 150000);
  assert.equal(planCash({ ...base, book: 6, opening: -50000, months: [], limit: 0 }).available, 0, "no limit set: no gauge figures");
});

test("compare periods: the period before, a month earlier, and groups matched with their earlier subtotals", async () => {
  const { addDays, changePercent, compareLines, compareRows, formatDate, monthBefore, parseDate, periodBefore } = await import("../lib/report/compare.ts");
  const date = (text: string) => parseDate(text)!;
  assert.equal(formatDate(date("05/oct/2026")), "05/Oct/2026");
  assert.equal(parseDate("31/Feb/2026")?.getMonth(), 2, "JS rolls an impossible day over; the report screen only sends real ones");
  // The period just before: the same number of days, ending the day before From.
  const before = periodBefore(date("11/Oct/2026"), date("20/Oct/2026"));
  assert.deepEqual([formatDate(before.from), formatDate(before.upto)], ["01/Oct/2026", "10/Oct/2026"]);
  const wholeYear = periodBefore(date("01/Apr/2026"), date("30/Apr/2026"));
  assert.deepEqual([formatDate(wholeYear.from), formatDate(wholeYear.upto)], ["02/Mar/2026", "31/Mar/2026"], "30 days ending on 31 Mar");
  // A month earlier: month ends stay month ends, the 31st clamps.
  assert.equal(formatDate(monthBefore(date("31/Mar/2026"))), "28/Feb/2026");
  assert.equal(formatDate(monthBefore(date("30/Apr/2026"))), "31/Mar/2026");
  assert.equal(formatDate(monthBefore(date("15/Jan/2026"))), "15/Dec/2025");
  assert.equal(formatDate(addDays(date("01/Mar/2026"), -1)), "28/Feb/2026");

  const column = (key: string, kind: "text" | "number" = "number") => ({ key, caption: key, width: 90, align: "R" as const, kind, decimals: 2, visible: true });
  const entry = (name: string, debit: string) => ({ kind: "data" as const, level: -2, rowType: "LED", values: { NAME: name, Debit: debit }, ledKey: 1, processKey: 0 });
  const opening = (debit: string) => ({ kind: "data" as const, level: -2, rowType: "OPENINGS", values: { NAME: " Opening Balance B/d ", Debit: debit }, ledKey: 0, processKey: 0 });
  const subtotal = (label: string, debit: string, level = 0) => ({ kind: "subtotal" as const, level, rowType: "", values: { NAME: `* Subtotal For : ${label} `, Debit: debit }, ledKey: 0, processKey: 0 });
  const total = (debit: string) => ({ kind: "total" as const, level: -1, rowType: "", values: { NAME: "* Final Total : ", Debit: debit }, ledKey: 0, processKey: 0 });
  const columns = [column("NAME", "text"), column("Debit")];
  // The subtotals carry the opening balance (5,000 and 9,000); the comparison counts the entries alone.
  const now = compareLines({ columns, rows: [opening("5,000.00"), entry("Sale", "400.00"), entry("Sale", "600.00"), subtotal("Agra", "6,000.00"), entry("Sale", "500.00"), subtotal("Delhi", "500.00"), total("6,500.00")] });
  const earlier = compareLines({ columns, rows: [opening("9,000.00"), entry("Sale", "800.00"), subtotal("Agra", "9,800.00"), entry("Sale", "200.00"), subtotal("Pune", "200.00"), total("10,000.00")] });
  assert.deepEqual(now.map((line) => [line.label, line.values.Debit]), [["Agra", 1000], ["Delhi", 500], ["All entries", 1500]]);
  const rows = compareRows(now, earlier, "Debit");
  assert.deepEqual(rows.map((row) => [row.label, row.now, row.then]), [["Agra", 1000, 800], ["Delhi", 500, 0], ["Pune", 0, 200], ["All entries", 1500, 1000]], "a group in one period only counts 0 in the other; the total is last");
  // Two group levels: an inner subtotal does not reset the outer one's running amount.
  const nested = compareLines({ columns, rows: [entry("a", "10.00"), subtotal("X1", "10.00", 1), entry("b", "5.00"), subtotal("X2", "5.00", 1), subtotal("North", "15.00", 0)] });
  assert.deepEqual(nested.map((line) => [line.label, line.level, line.values.Debit]), [["X1", 1, 10], ["X2", 1, 5], ["North", 0, 15], ["All entries", -1, 15]]);
  assert.equal(changePercent(1000, 800), "25.0%");
  assert.equal(changePercent(500, 0), "new");
  assert.equal(changePercent(0, 0), "—");
  assert.equal(changePercent(500, -500), "200.0%", "against the size of the earlier amount");
});

test("budget against actual: variance and the share of the budget used", async () => {
  const { budgetUse } = await import("../lib/report/planning.ts");
  const within = budgetUse({ code: 1, name: "A", book: 2, budget: 200000, actual: 50000 });
  assert.equal(within.variance, -150000);
  assert.equal(within.used, 0.25);
  const over = budgetUse({ code: 2, name: "B", book: 2, budget: 100000, actual: 130000.456 });
  assert.equal(over.actual, 130000.46);
  assert.equal(over.variance, 30000.46);
  assert.ok(over.used > 1);
  assert.equal(budgetUse({ code: 3, name: "C", book: 3, budget: 0, actual: 500 }).used, 0, "no budget: nothing to measure against");
});

test("group by: regroup the entries by a column or a period, with subtotals and a total", async () => {
  const { applyGroupBy, cellDate, periodOf } = await import("../lib/report/groupBy.ts");
  type ReportOutput = import("../lib/report/types.ts").ReportOutput;
  assert.equal(periodOf(cellDate("03-Apr-2026")!, "month").label, "Apr-2026");
  assert.equal(periodOf(cellDate("03-Apr-2026")!, "quarter").label, "Apr - Jun 2026");
  assert.equal(periodOf(cellDate("15-Feb-2027")!, "year").label, "FY 2026-27", "the financial year runs April to March");
  assert.equal(periodOf(cellDate("08-Apr-2026")!, "week").label, "05/04/2026 To 11/04/2026", "Sunday to Saturday");
  assert.equal(cellDate("31/12/2026")?.getMonth(), 11);

  const column = (key: string, kind: "text" | "number" | "date", decimals = 0) => ({ key, caption: key.toUpperCase(), width: 90, align: "L" as const, kind, decimals, visible: true });
  const entry = (date: string, name: string, debit: string, closing: string) => ({ kind: "data" as const, level: -2, rowType: "LED", values: { date, name, debit, closing_bal: closing }, ledKey: 1, processKey: 0 });
  const output: ReportOutput = {
    title: "T", dateLine: "", selectionLine: "", columns: [column("date", "date"), column("name", "text"), column("debit", "number", 2), column("closing_bal", "number", 2)],
    rows: [
      { kind: "data" as const, level: -2, rowType: "OPENINGS", values: { date: "01-Apr-2026", name: "Opening Balance", debit: "50.00", closing_bal: "50.00" }, ledKey: 0, processKey: 0 },
      entry("03-May-2026", "Beta", "30.00", "80.00"), entry("04-Apr-2026", "Alpha", "10.00", "90.00"), entry("20-May-2026", "Alpha", "5.00", "95.00"), entry("09-Apr-2026", "Beta", "7.00", "102.00"),
      { kind: "total" as const, level: -1, rowType: "", values: { debit: "152.00" }, ledKey: 0, processKey: 0 },
    ],
    groups: [], records: 4, frozen: 0, subtotals: false, reportKey: 1, levelColours: {}, headingColours: {}, headingCaptions: {}, formating: "", planning: null, budgets: null, elapsed: "", warnings: [],
  };
  const byName = applyGroupBy(output, [{ kind: "column", key: "name" }]);
  assert.deepEqual(byName.rows.map((row) => `${row.kind}:${row.values.name ?? ""}:${row.values.debit ?? ""}`), [
    "data:Alpha:10.00", "data:Alpha:5.00", "subtotal:* Subtotal For : Alpha :15.00",
    "data:Beta:30.00", "data:Beta:7.00", "subtotal:* Subtotal For : Beta :37.00",
    "total:** Final Total : :52.00",
  ], "the opening is left out; each group's subtotal follows it; the total is the entries only");
  assert.ok(byName.rows.filter((row) => row.kind === "data").every((row) => row.values.closing_bal === ""), "a running balance means nothing in a new order");
  assert.equal(byName.groups.length, 1);

  const byMonthThenName = applyGroupBy(output, [{ kind: "period", key: "date", unit: "month" }, { kind: "column", key: "name" }]);
  assert.deepEqual(byMonthThenName.rows.filter((row) => row.kind !== "data").map((row) => `${row.level}:${row.values.name}:${row.values.debit}`), [
    "1:** Subtotal For : Alpha :10.00", "1:** Subtotal For : Beta :7.00", "0:* Subtotal For : Apr-2026 :17.00",
    "1:** Subtotal For : Alpha :5.00", "1:** Subtotal For : Beta :30.00", "0:* Subtotal For : May-2026 :35.00",
    "-1:*** Final Total : :52.00",
  ], "April before May, the inner groups inside each period, the outer subtotal after its inner ones");
  assert.equal(applyGroupBy(output, []), output, "no levels: the report as it was");
});

test("business growth: ABC ranking, movers, quiet parties", async () => {
  const { rankParties, movers, quietParties } = await import("../lib/report/growth.ts");
  const column = (key: string, kind: "text" | "number" | "date", decimals = 0) => ({ key, caption: key.toUpperCase(), width: 90, align: "L" as const, kind, decimals, visible: true });
  const columns = [column("date", "date"), column("name", "text"), column("debit", "number", 2)];
  const rows = (items: [string, string, string][]) => items.map(([date, name, debit]) => ({ kind: "data" as const, level: -2, rowType: "LED", values: { date, name, debit }, ledKey: 1, processKey: 0 }));
  const now = { columns, rows: rows([["03-May-2026", "Big", "700.00"], ["04-May-2026", "Mid", "200.00"], ["05-May-2026", "Big", "50.00"], ["06-May-2026", "Small", "30.00"], ["07-May-2026", "Tiny", "20.00"]]) };
  const ranked = rankParties(now, "name", "debit");
  assert.deepEqual(ranked.map((item) => `${item.party}:${item.value}:${item.grade}`), ["Big:750:A", "Mid:200:A", "Small:30:C", "Tiny:20:C"], "the party that carries the total across 80% is still A; 95% and over is C");
  assert.equal(ranked[0].share, 0.75);
  assert.equal(ranked[3].running, 1);

  const before = { columns, rows: rows([["03-Apr-2026", "Big", "500.00"], ["04-Apr-2026", "Mid", "200.00"], ["05-Apr-2026", "Old", "40.00"]]) };
  const moved = movers(now, before, "name", "debit");
  assert.deepEqual(moved.map((item) => `${item.party}:${item.kind}:${item.change}`), ["Big:up:250", "Old:gone:-40", "Small:new:30", "Tiny:new:20", "Mid:same:0"]);

  const quiet = quietParties(now, "name", "debit", "date", new Date(2026, 4, 31), 25);
  assert.deepEqual(quiet.map((item) => `${item.party}:${item.days}`), ["Mid:27", "Big:26", "Small:25"], "longest quiet first; Tiny (24 days) is under the 25 asked for");
});
