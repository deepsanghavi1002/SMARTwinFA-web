import assert from "node:assert/strict";
import test from "node:test";
import { properHeading } from "../lib/master-program/heading.ts";

test("headings show in Proper Case whatever case the setup stores", () => {
  assert.equal(properHeading("OPENING BALANCE"), "Opening Balance");
  assert.equal(properHeading("opening balance"), "Opening Balance");
  assert.equal(properHeading("* LIMIT IN Rs."), "* Limit In Rs.");
  assert.equal(properHeading("SR_NO"), "Sr No");
  assert.equal(properHeading("BOOK / LEDGER"), "Book / Ledger");
  assert.equal(properHeading("A/C NO."), "A/C No.");
  assert.equal(properHeading("ADDRESS LINE 1"), "Address Line 1");
});

test("short forms read letter by letter stay in capitals", () => {
  assert.equal(properHeading("gst no."), "GST No.");
  assert.equal(properHeading("Pan No"), "PAN No");
  assert.equal(properHeading("BANK IFSC CODE"), "Bank IFSC Code");
  assert.equal(properHeading("HSN/SAC"), "HSN/SAC");
});
