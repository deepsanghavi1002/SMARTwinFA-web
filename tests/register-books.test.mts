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

test("account help books: Form Summary lists the register's books, every other Account tab the parties of the book", async () => {
  const { accountHelpBooks, partyBooks } = await import("../lib/report/registerBooks.ts");
  assert.deepEqual(accountHelpBooks(14, 8, true), [8, 9, 11, 16]);
  assert.deepEqual(accountHelpBooks(14, 8, false), [2], "an Account tab that is not the first combo's help lists the parties");
  assert.deepEqual(accountHelpBooks(5, 15, false), [1], "EXPENSE: the general accounts");
  assert.deepEqual(accountHelpBooks(5, 8, false), [2], "SALE: the debtors");
  assert.deepEqual(accountHelpBooks(5, 13, false), [3], "PURCHASE: the creditors");
  assert.equal(accountHelpBooks(5, 4, false), null);
  assert.deepEqual(accountHelpBooks(1, 15, false), [1], "every report with an Account tab lists the parties of its book");
  assert.equal(accountHelpBooks(1, 15, true), null, "a first combo help of another report is left alone");
  assert.equal(partyBooks(6), null);
});

test("against book: a credit or debit note is against the sale or the purchase, two entries", async () => {
  const { againstBooksOf } = await import("../lib/report/registerBooks.ts");
  assert.deepEqual(againstBooksOf(16), [8, 13]);
  assert.deepEqual(againstBooksOf(11), [8, 13]);
  assert.deepEqual(againstBooksOf(8), []);
});
