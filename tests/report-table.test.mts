import assert from "node:assert/strict";
import test from "node:test";
import { buildReportTable, reportSummary } from "../lib/reporting/report-table.ts";

test("report table preserves typed numbers and computes additive totals", () => {
  const table = buildReportTable({
    title: "Day Book",
    columns: ["Account", "Debit", "Credit", "Rate"],
    rows: [
      { Account: "Cash", Debit: "1,250.50", Credit: 0, Rate: 2 },
      { Account: "Sales", Debit: 49.5, Credit: "300", Rate: 3 },
    ],
  });
  assert.deepEqual(table.rows[0], ["Cash", 1250.5, 0, 2]);
  assert.deepEqual(table.totals, [null, 1300, 300, null]);
  assert.deepEqual(reportSummary(table), [
    { label: "Debit", value: 1300, decimals: 2 },
    { label: "Credit", value: 300, decimals: 2 },
  ]);
});

test("numeric-only identifiers retain leading zeroes and never enter totals", () => {
  const table = buildReportTable({ title: "Ledger", columns: ["Key", "Code", "Year", "Quantity", "Debit"], rows: [{ Key: "123", Code: "0012", Year: "2026", Quantity: "1.125", Debit: "100.50" }] });
  assert.deepEqual(table.rows[0], ["123", "0012", "2026", 1.125, 100.5]);
  assert.deepEqual(table.totals, [null, null, null, 1.125, 100.5]);
  assert.equal(table.columns[3].decimals, 3);
});

test("identifier-like numeric strings stay text when the column is mixed", () => {
  const table = buildReportTable({ title: "Register", columns: ["Document No"], rows: [{ "Document No": "0012" }, { "Document No": "A13" }] });
  assert.equal(table.columns[0].kind, "text");
  assert.deepEqual(table.rows, [["0012"], ["A13"]]);
});
