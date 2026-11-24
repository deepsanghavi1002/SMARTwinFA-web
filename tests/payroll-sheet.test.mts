import assert from "node:assert/strict";
import test from "node:test";
import { attendanceFromSheet, parseCsv } from "../lib/payroll/sheetRead.ts";

test("csv: quotes, bom, tabs and blank lines", () => {
  const rows = parseCsv('﻿Code,Name,Paid Days,Remark\n13,"Shah, A",26,"said ""ok"""\n\n14,B,30,\n');
  assert.deepEqual(rows[1], ["13", "Shah, A", "26", 'said "ok"']);
  assert.equal(rows.length, 3);
});

test("attendance rows are found under their headings, whatever the column order", () => {
  const out = attendanceFromSheet([["Report"], ["Name", "Emp Code", "Days Paid", "Remarks"], ["A", "13", "26", "x"], ["B", "x", "abc", ""], ["C", "15", "", ""]]);
  assert.deepEqual(out, [{ code: 13, name: "A", paidDays: 26, remark: "x" }]);
  assert.throws(() => attendanceFromSheet([["Name", "Salary"]]), /Paid Days/);
});
