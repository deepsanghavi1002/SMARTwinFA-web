import assert from "node:assert/strict";
import test from "node:test";
import { registerBooks } from "../lib/report/registerBooks.ts";

test("the books a register covers: its own, cash, debit / credit notes and returns", () => {
  assert.deepEqual(registerBooks(8), [8, 9, 11, 16]);
  assert.deepEqual(registerBooks(9), [8, 9, 11, 16]);
  assert.deepEqual(registerBooks(13), [13, 14, 11, 16]);
  assert.deepEqual(registerBooks(15), [10, 15]);
  assert.deepEqual(registerBooks(4), [4], "any other book is itself");
});
