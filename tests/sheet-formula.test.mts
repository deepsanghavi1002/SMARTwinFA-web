import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, normalizeFormula, parseFormula, toExcel } from "../lib/report/sheetFormula.ts";
import { excelFormulas, withFormulaColumns, workOut } from "../lib/report/formulaColumns.ts";
import type { ReportOutput } from "../lib/report/types.ts";

const cols = [{ key: "QTY", caption: "QTY", width: 80, align: "R", kind: "number", decimals: 0, visible: true }, { key: "RATE", caption: "Rate", width: 80, align: "R", kind: "number", decimals: 2, visible: true }] as const;
const row = (qty: string, rate: string, kind: "data" | "subtotal" | "total" = "data") => ({ kind, level: 0, rowType: "LED", values: { QTY: qty, RATE: rate }, ledKey: 0, processKey: 0 });
const output = { title: "t", dateLine: "", selectionLine: "", columns: cols, rows: [row("2", "10.00"), row("3", "5.50"), row("5", "1.00", "subtotal"), row("5", "1.00", "total")], groups: [], records: 2, frozen: 0, levelColours: {}, headingColours: {}, headingLevels: {}, headingCaptions: {}, subtotals: true } as unknown as ReportOutput;

test("row formula and sum of products", () => {
  const sheet = { rows: 2, cell: (name: string, i: number) => (name.toUpperCase() === "QTY" ? [2, 3][i] : name.toUpperCase() === "RATE" ? [10, 5.5][i] : undefined) };
  assert.deepEqual(evaluate(parseFormula("=qty*rate"), sheet).values, [20, 16.5]);
  assert.equal(evaluate(parseFormula("=SUM(QTY*RATE)"), sheet).scalar, 36.5);
  assert.equal(evaluate(parseFormula("=sum(qty*qty)"), sheet).scalar, 13);
  assert.deepEqual(evaluate(parseFormula("=IF(QTY>2,1,0)+ROUND(RATE/3,1)"), sheet).values, [3.3, 2.8]);
  assert.equal(evaluate(parseFormula("=AVERAGE(RATE)"), sheet).scalar, 7.75);
});
test("letters become captions", () => {
  assert.equal(normalizeFormula("=A*b", [{ key: "QTY", caption: "QTY" }, { key: "RATE", caption: "Rate" }]), "[QTY]*[Rate]");
});
test("added columns on rows, subtotal and total, and as Excel formulas", () => {
  const specs = [{ key: "F1", caption: "Amt", formula: "[QTY]*[Rate]", decimals: 2 }, { key: "F2", caption: "Grand", formula: "SUM([QTY]*[Rate])", decimals: 2 }];
  const result = withFormulaColumns(output, specs);
  assert.deepEqual(result.rows.map((r) => r.values.F1 ?? ""), ["20.00", "16.50", "36.50", "36.50"]);
  assert.equal(result.rows[3].values.F2, "36.50");
  const { worked } = workOut(output, specs);
  const columns = [...cols, ...worked.map((w) => w.column)];
  const formulas = excelFormulas({ rows: result.rows.map((r, i) => ({ kind: r.kind, level: r.level, entry: i < 2 })), columns, worked, headRow: 5 });
  assert.equal(formulas[0][2], "(A6*B6)");
  assert.equal(formulas[2][2], "SUM(C6:C7)");
  assert.equal(formulas[3][3], "(SUMPRODUCT((A6:A7*B6:B7)))");
});

import { xlsx, xlsxHeadRow } from "../lib/export/xlsx.ts";
test("the Excel file carries real formulas", () => {
  const table = { company: "Co", title: "T", subtitle: [], columns: [{ caption: "A", kind: "number", decimals: 0, align: "right", width: 60 }, { caption: "B", kind: "number", decimals: 0, align: "right", width: 60 }, { caption: "C", kind: "number", decimals: 0, align: "right", width: 60 }], rows: [[2, 3, 6], [4, 5, 20]], formulas: [[null, null, "(A4*B4)"], [null, null, "(A5*B5)"]] } as const;
  assert.equal(xlsxHeadRow(table), 4);
  const text = new TextDecoder().decode(xlsx(table as never));
  assert.ok(text.includes("<f>(A5*B5)</f><v>20</v>"));
});
