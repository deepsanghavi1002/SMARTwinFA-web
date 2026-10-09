import assert from "node:assert/strict";
import test from "node:test";
import { checklistFrom, checklistSelect, entryAddonColumn, inBookNeedle, masterAddonColumn } from "../lib/report/checklistDaybookSql.ts";

const names = (select: string) => [...select.matchAll(/ AS "([^"]+)"/g)].map((match) => match[1]);

test("checklist daybook columns follow the book chosen", () => {
  assert.deepEqual(names(checklistSelect(-1, [], [])), ["DATE", "DOC_NO", "CHQ_NO", "CHQ_DATE", "RECO_DATE", "BOOK_NAME", "Schedule", "RECEIPT", "PAYMENT", "NARRATION"]);
  assert.ok(!names(checklistSelect(6, [], [])).includes("BOOK_NAME"));
  assert.ok(names(checklistSelect(6, [], [])).includes("CHQ_NO"));
  assert.deepEqual(names(checklistSelect(4, [], [])), ["DATE", "DOC_NO", "Schedule", "RECEIPT", "PAYMENT", "NARRATION"]);
});

test("addon columns come before the narration, entry fields before master fields", () => {
  const list = names(checklistSelect(4, [entryAddonColumn({ save: "REF", type: "M" })], [masterAddonColumn({ save: "AREA", type: "M" }, false)]));
  assert.deepEqual(list.slice(-3), ["REF", "AREA", "NARRATION"]);
  assert.match(entryAddonColumn({ save: "QTY", type: "N" }), /aent\.input_QTY/);
});

test("checklist daybook filter: one book by its account code, all books by book 4, 5, 6", () => {
  assert.match(checklistFrom("s.", 6, 77, false, "'a'", "'b'"), /led\.book_code=77/);
  assert.match(checklistFrom("s.", -1, 0, true, "'a'", "'b'"), /led\.book in \(4,5,6\)/);
  assert.ok(checklistFrom("s.", -1, 0, true, "'a'", "'b'").includes("ADDON_AENTRY"));
  assert.ok(!checklistFrom("s.", 4, 5, false, "'a'", "'b'").includes("ADDON_AENTRY"));
  assert.equal(inBookNeedle(4), " 4,");
});
