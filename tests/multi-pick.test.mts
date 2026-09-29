import assert from "node:assert/strict";
import test from "node:test";
import { isMultiPick, keyListNames, keyListText, parseKeyList, validKeyList } from "../lib/master-program/multi-pick.ts";

const books = [{ text: "GENERAL LEDGER", value: "1" }, { text: "SALE", value: "8" }, { text: "DEBIT NOTE", value: "11" }];

test("a key list is stored as a space, the key and a comma, in key order", () => {
  assert.equal(keyListText(["12", "2", "13"]), " 2, 12, 13,");
  assert.equal(keyListText(["2", "2", " "]), " 2,");
  assert.equal(keyListText([]), "");
});

test("old stored values are read however they were spaced", () => {
  assert.deepEqual(parseKeyList(" 32,  33,"), ["32", "33"]);
  assert.deepEqual(parseKeyList("10,11,"), ["10", "11"]);
  assert.deepEqual(parseKeyList("  3,  1,"), ["3", "1"]);
  assert.equal(keyListText(parseKeyList(" 9,10,11,13,")), " 9, 10, 11, 13,");
  assert.deepEqual(parseKeyList(""), []);
});

test("the grid shows names; a key the list no longer has shows as #key", () => {
  assert.equal(keyListNames(" 1, 8, 7,", books), "GENERAL LEDGER, SALE, #7");
  assert.equal(keyListNames("", books), "");
});

test("a paste must hold only keys the list has", () => {
  assert.equal(validKeyList(" 1, 11,", books, ""), true);
  assert.equal(validKeyList(" 1, 99,", books, ""), false);
  assert.equal(validKeyList(" 1, 99,", books, " 99,"), true);
});

test("a field is multi-pick only with multiple_chkbox and a list query", () => {
  assert.equal(isMultiPick({ multiple_chkbox: true, combo_fixquery: "select book_desc, book_key from x" }), true);
  assert.equal(isMultiPick({ multiple_chkbox: true, combo_fixquery: null }), false);
  assert.equal(isMultiPick({ multiple_chkbox: false, combo_fixquery: "select 1" }), false);
});
