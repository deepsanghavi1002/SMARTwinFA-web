import assert from "node:assert/strict";
import test from "node:test";
import { groupToClose } from "../features/grid/levelStyle.ts";

// Rows: 0-3 April's entries, 4 its subtotal; 5-7 May's entries, 8 its subtotal; 9 Final Total. (A group starts after the previous subtotal.)
const startOf = new Map([[4, 0], [8, 5]]);

test("Ctrl+Enter closes the group around the cursor, so no scrolling down to its subtotal line", () => {
  assert.equal(groupToClose(2, false, startOf, new Set()), 4, "an April entry: April's group");
  assert.equal(groupToClose(6, false, startOf, new Set()), 8, "a May entry: May's group");
  assert.equal(groupToClose(0, false, startOf, new Set()), 4, "the first row of a group");
  assert.equal(groupToClose(4, true, startOf, new Set()), 4, "an open subtotal line closes itself");
  assert.equal(groupToClose(9, false, startOf, new Set()), -1, "the final total is in no group");
  // April closed and May open: from a May entry only May is offered; on April's closed line nothing is left around it
  assert.equal(groupToClose(6, false, startOf, new Set([4])), 8);
  assert.equal(groupToClose(4, false, startOf, new Set([4])), -1);
});

test("with groups inside groups, closing goes outwards one level at a time", () => {
  // Book 1: party A (rows 0-2, subtotal 3), party B (rows 4-6, subtotal 7), book subtotal 8. Book 2 follows: rows 9-11, party subtotal 12, book subtotal 13.
  const starts = new Map([[3, 0], [7, 4], [8, 0], [12, 9], [13, 9]]);
  assert.equal(groupToClose(5, false, starts, new Set()), 7, "an entry of party B: party B first");
  assert.equal(groupToClose(7, false, starts, new Set([7])), 8, "then, from B's closed line, the book around it");
  assert.equal(groupToClose(5, false, starts, new Set([7, 8])), -1, "nothing open around it any more (the row is out of sight anyway)");
  assert.equal(groupToClose(10, false, starts, new Set()), 12, "book 2's entry: the party, which is the smaller group");
});
