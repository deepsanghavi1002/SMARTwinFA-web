import assert from "node:assert/strict";
import test from "node:test";
import { PAYROLL_STEPS } from "../lib/payroll/schema.ts";
import { PAYROLL_MENU } from "../lib/payroll/menu.ts";

test("step 4 only adds columns to pay_slip, idempotently", () => {
  const step = PAYROLL_STEPS.find((s) => s.version === 4)!;
  for (const statement of step.statements) assert.match(statement, /ALTER TABLE pay_slip ADD COLUMN IF NOT EXISTS/);
});

test("the Salary Journal menu row exists under Payroll", () => {
  const row = PAYROLL_MENU.find((r) => r.shortName === "PAY_JOURNAL");
  assert.equal(row?.actionCode, "PAYROLL_JOURNAL");
});
