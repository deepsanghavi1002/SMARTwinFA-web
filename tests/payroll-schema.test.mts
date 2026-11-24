import assert from "node:assert/strict";
import test from "node:test";
import { PAYROLL_ACTIVATION, PAYROLL_STEPS, PAYROLL_VERSION, safeSchema } from "../lib/payroll/schema.ts";
import { PAYROLL_MENU, isPayrollMenuRow } from "../lib/payroll/menu.ts";

test("every payroll statement is idempotent and steps are numbered in order", () => {
  PAYROLL_STEPS.forEach((step, index) => assert.equal(step.version, index + 1));
  assert.equal(PAYROLL_VERSION, PAYROLL_STEPS.length);
  for (const statement of PAYROLL_STEPS.flatMap((step) => step.statements)) {
    assert.match(statement, /IF NOT EXISTS|ON CONFLICT/);
    assert.doesNotMatch(statement, /DROP |TRUNCATE|DELETE FROM/i);
  }
});

test("a staff profile points at the account and keeps no name or balance", () => {
  const profile = PAYROLL_STEPS[0].statements.find((statement) => statement.includes("pay_staff_profile ("))!;
  assert.match(profile, /code\s+integer\s+PRIMARY KEY REFERENCES account \(code\)/);
  assert.doesNotMatch(profile, /\bname\b|balance|opening/i);
});

test("payroll menu rows are recognised so the menu_para gate can hide them", () => {
  for (const row of PAYROLL_MENU) assert.ok(isPayrollMenuRow(row.shortName), row.shortName);
  assert.equal(isPayrollMenuRow("MENU_MASTER"), false);
  assert.equal(PAYROLL_ACTIVATION, "PAYROLL,");
});

test("schema names are quoted safely", () => {
  assert.equal(safeSchema("rishabh_plastic27"), '"rishabh_plastic27"');
  assert.throws(() => safeSchema("x; drop table y"));
});
