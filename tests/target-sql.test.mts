import assert from "node:assert/strict";
import test from "node:test";
import { customerSummary, finishRows, groupSummary, monthStarts, quarterTarget, salesExpenseRows, yyyymmdd } from "../lib/report/targetSql.ts";

test("target: a row for each month from From to Upto, a 31st going to the month's last day", () => {
  assert.deepEqual(monthStarts(new Date(2026, 3, 1), new Date(2026, 5, 30)).map(yyyymmdd), ["20260401", "20260501", "20260601"]);
  assert.deepEqual(monthStarts(new Date(2026, 0, 31), new Date(2026, 3, 30)).map(yyyymmdd), ["20260131", "20260228", "20260331", "20260430"]);
  assert.deepEqual(monthStarts(new Date(2026, 3, 15), new Date(2026, 3, 10)), []);
});

test("target: a quarter's target reads the months' percentages", () => {
  const sql = quarterTarget("s.", 4, 6);
  assert.match(sql, /MONTH FROM a\.trg_from\) between 4 and 6/);
  assert.match(sql, /between 0\.01 and 99\.99/);
  assert.match(sql, /s\.TARGET a where a\.trg_aaocode=targ\.trg_aaocode/);
});

const base = { Sales_Person: "Ram", Cust_Type: "Open Trade", Customer_Name: "A Shop", Yearly_Trg: 1200, Trg_Qtr1: 300, Trg_Qtr2: 300, Trg_Qtr3: 300, Trg_Qtr4: 300 };

test("target: shortfall and % achieved where there is a sale and a target, and the running shortfall by month", () => {
  const rows = finishRows([
    { ...base, SORTING_COL: "20260401", Month: "Apr", Month_Target: 100, Net_Sale: 80 },
    { ...base, SORTING_COL: "20260501", Month: "May", Month_Target: 100, Net_Sale: 130 },
    { ...base, SORTING_COL: "20260601", Month: "Jun", Month_Target: 100, Net_Sale: 0 },
  ]);
  assert.deepEqual(rows.map((row) => [row.Short_fall, row.Archive, row.Tot_Short]), [[20, 80, 20], [-30, 130, -10], [0, 0, -10]]);
});

test("target: customer summary adds the months", () => {
  const rows = customerSummary(finishRows([
    { ...base, SORTING_COL: "20260401", Month: "Apr", Month_Target: 100, Net_Sale: 80, SMART_SELECTED_ADDON1: "Ram" },
    { ...base, SORTING_COL: "20260501", Month: "May", Month_Target: 100, Net_Sale: 130, SMART_SELECTED_ADDON1: "Ram" },
  ]));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].Month_Target, rows[0].Net_Sale, rows[0].Short_fall, rows[0].Archive], [200, 210, -10, 105]);
});

test("target: sales with expense gives the month's percentages", () => {
  const rows = salesExpenseRows([{ ...base, Sales_Person_Code: "7", SORTING_COL: "20260401", Month: "Apr", Month_Target: 100, Net_Sale: 80 }], [{ code: "7", month: "Apr", salary: 10, expense: 6 }, { code: "8", month: "Apr", salary: 99, expense: 99 }]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].Expense, rows[0]["Target_Vs_Sale_%"], rows[0]["Sale_Vs_Exp_%"]], [16, 80, 20]);
});

test("target: group summary by customer type, with a target and no sale added, no target left out", () => {
  const rows = groupSummary([{ Cust_Type: "Open Trade", Net_Sale: 600 }, { Cust_Type: "Dispute", Net_Sale: 50 }], new Map([["Open Trade", 1000], ["Ram", 300]]));
  assert.deepEqual(rows.map((row) => [row.Sales_Person, row.Target, row.Net_Sale, row.Shortfall, row["Achieved_%"]]), [["Open Trade", 1000, 600, 400, 60], ["Ram", 300, 0, 0, 0]]);
});
