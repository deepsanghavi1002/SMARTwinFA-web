import assert from "node:assert/strict";
import test from "node:test";
import { calculateSalary, defaultPaidDays, emiDue, type CalcInput, type CalcSetup } from "../lib/payroll/calc.ts";

const setup: CalcSetup = { daysBasis: "CAL", fixedDays: 26, pfPct: 12, pfEmpPct: 12, pfCeiling: 15000, esiPct: 0.75, esiEmpPct: 3.25, esiCeiling: 21000, ptAmount: 200, ptFromGross: 12000 };
const structure = [
  { componentId: 1, name: "BASIC", type: "E" as const, calc: "F" as const, pf: true, esi: true, seq: 1, amount: 20000 },
  { componentId: 2, name: "HRA", type: "E" as const, calc: "P" as const, pf: false, esi: true, seq: 2, amount: 40 },
  { componentId: 4, name: "OTHER DEDUCTION", type: "D" as const, calc: "F" as const, pf: false, esi: false, seq: 9, amount: 500 },
];
const base: CalcInput = { setup, payBasis: "M", pfOn: true, esiOn: true, ptOn: true, calendarDays: 30, paidDays: 30, structure };

test("a full month pays the structure; PF is capped at the ceiling, ESI is off above its ceiling", () => {
  const r = calculateSalary(base);
  assert.equal(r.gross, 28000);
  assert.equal(r.pfEmp, 1800);
  assert.equal(r.esiEmp, 0);
  assert.equal(r.pt, 200);
  assert.equal(r.totalDed, 1800 + 200 + 500);
  assert.equal(r.net, 28000 - 2500);
});

test("part month pro-rates fixed pay and takes HRA as a percentage of the pro-rated BASIC", () => {
  const r = calculateSalary({ ...base, paidDays: 15 });
  assert.equal(r.lines.find((l) => l.name === "BASIC")?.amount, 10000);
  assert.equal(r.lines.find((l) => l.name === "HRA")?.amount, 4000);
  assert.equal(r.lines.find((l) => l.name === "OTHER DEDUCTION")?.amount, 500);
});

test("paid days above the month never pay more than the structure", () => {
  assert.equal(calculateSalary({ ...base, paidDays: 33 }).gross, 28000);
});

test("ESI applies within its ceiling and rounds up; switches off per staff member", () => {
  const low = [{ ...structure[0], amount: 10000 }, { ...structure[1], amount: 0 }];
  const r = calculateSalary({ ...base, structure: low, pfOn: false, ptOn: false });
  assert.equal(r.esiEmp, 75);
  assert.equal(calculateSalary({ ...base, structure: low, esiOn: false }).esiEmp, 0);
});

test("daily basis pays rate x days", () => {
  const r = calculateSalary({ ...base, payBasis: "D", paidDays: 10, structure: [{ ...structure[0], amount: 800 }], pfOn: false, ptOn: false, esiOn: false });
  assert.equal(r.gross, 8000);
});

test("default days: whole month, or from joining / to exit inside it", () => {
  assert.equal(defaultPaidDays("2026-11-01", "2026-11-30", "2020-01-01", null, setup), 30);
  assert.equal(defaultPaidDays("2026-11-01", "2026-11-30", "2026-11-16", null, setup), 15);
  assert.equal(defaultPaidDays("2026-11-01", "2026-11-30", "2020-01-01", "2026-11-10", setup), 10);
  assert.equal(defaultPaidDays("2026-11-01", "2026-11-30", null, null, { daysBasis: "FIX", fixedDays: 26 }), 26);
});

test("a loan instalment never takes more than is still owed", () => {
  assert.equal(emiDue(10000, 0, 2000), 2000);
  assert.equal(emiDue(10000, 8500, 2000), 1500);
  assert.equal(emiDue(10000, 10000, 2000), 0);
  assert.equal(emiDue(10000, 10500, 2000), 0);
});

test("a loan EMI row is a plain deduction that takes nothing from gross", () => {
  const withEmi = [...structure, { componentId: 0, name: "LOAN EMI", type: "D" as const, calc: "F" as const, pf: false, esi: false, seq: 800, amount: 2000 }];
  const a = calculateSalary(base), b = calculateSalary({ ...base, structure: withEmi });
  assert.equal(b.gross, a.gross);
  assert.equal(b.net, a.net - 2000);
  assert.equal(b.lines.find((l) => l.name === "LOAN EMI")?.componentId, 0);
});
