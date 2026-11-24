import assert from "node:assert/strict";
import test from "node:test";
import { TAG_TYPES } from "../lib/payroll/tag.ts";
import { PAYROLL_STEPS } from "../lib/payroll/schema.ts";

test("each kind of tag is limited to the side of the ledger it belongs on", () => {
  assert.equal(TAG_TYPES.SAL.side, "C"); // salary credited by a journal
  assert.equal(TAG_TYPES.PAY.side, "D"); // paid out of cash / bank
  assert.equal(TAG_TYPES.ADV.side, "D");
  assert.equal(TAG_TYPES.REC.side, "C");
  assert.equal(TAG_TYPES.OTH.side, "B");
});

test("a tag keeps no voucher data of its own, only the pointer and its share", () => {
  const sql = PAYROLL_STEPS.find((s) => s.version === 3)!.statements.join("\n");
  assert.match(sql, /led_id\s+integer\s+NOT NULL/);
  assert.match(sql, /amount\s+numeric\(14,2\)\s+NOT NULL CHECK \(amount > 0\)/);
  assert.doesNotMatch(sql, /doc_no|narration|doc_date|full_docno/);
});
