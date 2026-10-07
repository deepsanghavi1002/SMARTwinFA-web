import assert from "node:assert/strict";
import test from "node:test";
import { closingSubtotal, headingLevelOf, LEVEL_COLOURS, LIGHT_RED, resolveLevelColours, rowLook } from "../features/grid/levelStyle.ts";

test("a heading and the subtotal of its level share one colour; levels past 3 reuse the last", () => {
  for (let level = 0; level < 6; level += 1) {
    assert.equal(rowLook("heading", level).background, rowLook("subtotal", level).background);
  }
  assert.equal(rowLook("heading", 9).background, LEVEL_COLOURS[3].fill);
});

test("headings indent by level, details do not, subtotal captions sit right", () => {
  assert.equal(rowLook("heading", 0).indent, 0);
  assert.ok(rowLook("heading", 2).indent > rowLook("heading", 1).indent);
  assert.equal(rowLook("detail", 2).indent, 0);
  assert.equal(rowLook("detail", 2).background, undefined);
  assert.equal(rowLook("subtotal", 1).captionRight, true);
  assert.match(rowLook("total", -1).borderTop, /double/);
});

test("a screen colour equal to a level colour turns that level light red (provision)", () => {
  assert.deepEqual(resolveLevelColours(""), LEVEL_COLOURS);
  const swapped = resolveLevelColours(LEVEL_COLOURS[1].fill.toUpperCase());
  assert.equal(swapped[1], LIGHT_RED);
  assert.equal(swapped[0], LEVEL_COLOURS[0]);
});

test("heading levels and the subtotal that closes a heading", () => {
  assert.equal(headingLevelOf("AC", { AC: 1 }, []), 1);
  assert.equal(headingLevelOf("BOOK", undefined, ["AC", "BOOK"]), 1);
  const rows = [{ kind: "data", level: -2 }, { kind: "data", level: -2 }, { kind: "subtotal", level: 0 }, { kind: "data", level: -2 }, { kind: "subtotal", level: 0 }];
  const starts = new Map([[2, 0], [4, 3]]);
  assert.equal(closingSubtotal(rows, 0, 0, starts), 2);
  assert.equal(closingSubtotal(rows, 3, 0, starts), 4);
  assert.equal(closingSubtotal(rows, 1, 1, starts), -1);
});
