import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
const { acHelpBooks, entryDialect, replaceEntryTokens, slabBook } = await import("../lib/entry/values.ts");

const session = {
  companySchema: "demo27", fromSchema: "demo27", companyKey: 1, companyName: "DEMO", companyGroup: "", licence: 21, coStateName: "", coStateCode: "27", coGstReq: true, businessNature: "",
  yearKey: 1, yearId: "0104202631032027", tarikh1: new Date(2026, 3, 1), tarikh2: new Date(2027, 2, 31), userNo: 1, userType: "AD", loginName: "ADMIN",
  setup: {}, companyWiseRights: false,
  flags: { imageReq: false, barcodeEntry: false, barcodeReport: false, productAccountPosting: false, productChildParent: false, partyAccode: false, colMrpActive: true, productCode: false, logFileSpecial: false },
};
const values = {
  session, firstCombo: { text: "SALE", value: "16" }, bookKey: 8, type: 0, bookCode: 16, bkDbcode: 2, acDbcode: 1, agBook: 0, bookActual: true, forBook: 0,
  stkmShort: "", stkmFromShort: "", acHelp: " 2, 3,", series: "DSAL/26-27", docNo: "828", docDate: "29/May/2026", acCode: 10599, entryNat: "A" as const,
  moneyColumns: ["closing", "amount"],
};

test("the register's placeholders take the book, the series (quoted once) and the party", () => {
  const sql = replaceEntryTokens("select * from |sys.db|ledger where book_code=|sys.book_code| and bk_dbcode=|sys.bk_dbcode| and doc_series='|sys.doc_series|' and code=|sys.ac_code| and year_id=|sys.yearid|", values);
  assert.equal(sql, "select * from demo27.ledger where book_code=16 and bk_dbcode=2 and doc_series='DSAL/26-27' and code=10599 and year_id='0104202631032027'");
  assert.match(replaceEntryTokens("x=|sys.doc_series|", values), /x='DSAL\/26-27'/);
});

test("the party help's book list drops the trailing comma; a bracket names a balance-sheet head", () => {
  assert.deepEqual(acHelpBooks(" 2, 3,"), { books: "2, 3", bsHead: null });
  assert.deepEqual(acHelpBooks(""), { books: "2, 3", bsHead: null });
  assert.deepEqual(acHelpBooks("(30)"), { books: "1", bsHead: "30" });
  assert.equal(replaceEntryTokens("AC.book in (|sys.achelpbook|) order by AC.NAME", values), "AC.book in (2, 3) order by AC.NAME");
});

test("the slab book: a stock module's own book, the expense book for an agency bill, else the book", () => {
  assert.equal(slabBook({ bookActual: true, bookKey: 8, forBook: 0, agBook: 0 }), 8);
  assert.equal(slabBook({ bookActual: false, bookKey: 23, forBook: 8, agBook: 0 }), 8);
  assert.equal(slabBook({ bookActual: true, bookKey: 10, forBook: 0, agBook: 0 }), 15);
  assert.equal(slabBook({ bookActual: true, bookKey: 16, forBook: 0, agBook: 8 }), 8);
});

test("money columns are read as numbers and account.limit is the capitalised column", () => {
  const sql = replaceEntryTokens("select TO_CHAR(acbal.closing, 'FM999.00'),TO_CHAR(ac.limit, 'FM999.00') from |sys.db|ac_balance acbal where led.amount=0", values);
  assert.equal(sql, `select TO_CHAR(acbal.closing::numeric, 'FM999.00'),TO_CHAR(ac."LIMIT"::numeric, 'FM999.00') from demo27.ac_balance acbal where led.amount::numeric=0`);
});

test("SQL Server's GetNumbers and the text tax_type read as PostgreSQL wants", () => {
  assert.equal(entryDialect("select smart_setup.GetNumbers(doc_no) from x order by smart_setup.GetNumbers(doc_no) desc"), "select nullif(regexp_replace(doc_no, '\\D', '', 'g'), '')::numeric from x order by nullif(regexp_replace(doc_no, '\\D', '', 'g'), '')::numeric desc");
  assert.equal(entryDialect("where tax_type = (select idopt_key from t)"), "where tax_type = (select idopt_key::varchar from t)");
  assert.equal(entryDialect("TO_CHAR(ac.credit_days, 'FM999')"), "TO_CHAR(ac.credit_days::numeric, 'FM999')");
});
