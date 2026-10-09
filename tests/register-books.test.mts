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

test("account help books: Form Summary lists the register's books, Agewise Outstanding the parties of the book", async () => {
  const { accountHelpBooks, partyBooks } = await import("../lib/report/registerBooks.ts");
  assert.deepEqual(accountHelpBooks(14, 8, true), [8, 9, 11, 16]);
  assert.equal(accountHelpBooks(14, 8, false), null, "only Form Summary's own (first combo) help");
  assert.deepEqual(accountHelpBooks(5, 15, false), [1], "EXPENSE: the general accounts");
  assert.deepEqual(accountHelpBooks(5, 8, false), [2], "SALE: the debtors");
  assert.deepEqual(accountHelpBooks(5, 13, false), [3], "PURCHASE: the creditors");
  assert.equal(accountHelpBooks(5, 4, false), null);
  assert.equal(accountHelpBooks(1, 15, false), null, "other reports list every account");
  assert.equal(partyBooks(6), null);
});
