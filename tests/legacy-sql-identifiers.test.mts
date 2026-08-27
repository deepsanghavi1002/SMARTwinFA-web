import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { columnRef, physicalColumns } from "../platform/legacy-db/master-write.ts";

// The restored SQL Server export kept a few upper-case column names
// (account."LIMIT", ledger."TYPE", prod_ledger."TYPE"). PostgreSQL folds
// unquoted identifiers to lower case, so every generated reference to one of
// them has to be quoted or the write fails at runtime.

const entryPost = readFileSync(new URL("../platform/legacy-db/entry-post.ts", import.meta.url), "utf8");
const masterWrite = readFileSync(new URL("../platform/legacy-db/master-write.ts", import.meta.url), "utf8");
const entryContext = readFileSync(new URL("../platform/legacy-db/entry-context.ts", import.meta.url), "utf8");

test("quotes the upper-case legacy columns the master write can target", () => {
  assert.equal(columnRef("account", "limit"), '"LIMIT"');
  assert.equal(columnRef("account", "name"), '"name"');
  assert.equal(columnRef("address", "city"), '"city"');
  assert.equal(physicalColumns["account.limit"], "LIMIT");
});

test("every generated master-write identifier goes through columnRef", () => {
  assert.doesNotMatch(masterWrite, /\$\{column\}=\$/, "assignments must use columnRef so upper-case columns stay quoted");
  assert.doesNotMatch(masterWrite, /map\(\(\[column\]\) => column\)/, "insert column lists must use columnRef");
});

test("the invoice product line writes the quoted prod_ledger TYPE column", () => {
  assert.match(entryPost, /rateuom_id,uomentry_id,"TYPE",il_date/);
  assert.doesNotMatch(entryPost, /uomentry_id,type,/, "unquoted type resolves to a column that does not exist");
});

test("invoice entry only offers registers flagged for stock entry", () => {
  assert.match(entryContext, /stkm_stkentry/);
  assert.match(entryContext, /kind === "invoice" \? "=" : "<>"/);
});
