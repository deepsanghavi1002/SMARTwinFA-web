import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The library's modules import each other without the ".ts" the bundler adds; add it here.
const resolveTs = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context); throw error; }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveTs)}`, import.meta.url);
import { orderByAliases, quotedAliases, roundEven } from "../lib/small-entry/text.ts";
// cells.ts reads the shared grid rules, so it loads after the hook above.
const { commitCell, sameValue, shownValue, typingAllowed } = await import("../features/small-entry/cells.ts");

const opening = { fieldType: "N", positiveOnly: true, decimals: 2, caption: "Opening" };
const code = { fieldType: "T", positiveOnly: false, decimals: 0, caption: "Product Code" };

test("an ORDER BY naming a quoted alias is quoted the way the alias is spelt", () => {
  const sql = `SELECT 'Godown Opening' AS "DISP_COL",1 AS "VALUE_COL"`;
  assert.equal(orderByAliases(sql, "VALUE_COL"), `"VALUE_COL"`);
  assert.equal(orderByAliases(sql, "value_col desc, prod_short"), `"VALUE_COL" desc,prod_short`);
  assert.equal(orderByAliases("select a as b from t", "b"), "b");
});

test("computed quantities round half to even, as Math.Round(decimal, 2) does", () => {
  assert.equal(roundEven(2.345), "2.34");
  assert.equal(roundEven(2.355), "2.36");
  assert.equal(roundEven(33 / 12), "2.75");
  assert.equal(roundEven(10), "10");
});

test("a number cell takes digits and one point; positive-only refuses a minus", () => {
  assert.equal(typingAllowed(opening, "12.5"), true);
  assert.equal(typingAllowed(opening, "12.5.1"), false);
  assert.equal(typingAllowed(opening, "-3"), false);
  assert.equal(typingAllowed({ ...opening, positiveOnly: false }, "-3"), true);
  assert.equal(typingAllowed(opening, "1a"), false);
  assert.equal(typingAllowed(code, "O'Neil"), false);
});

test("a committed number keeps the column's decimal places; blank stays blank", () => {
  assert.deepEqual(commitCell(opening, "33"), { ok: true, value: "33.00" });
  assert.deepEqual(commitCell(opening, "12.345"), { ok: true, value: "12.35" });
  assert.deepEqual(commitCell(opening, "1,250"), { ok: true, value: "1250.00" });
  assert.deepEqual(commitCell(opening, ""), { ok: true, value: "" });
  assert.equal(commitCell(opening, "-1").ok, false);
  assert.equal(commitCell(opening, "abc").ok, false);
  assert.deepEqual(commitCell(code, "ABC 1"), { ok: true, value: "ABC 1" });
});

test("a row changed back to its loaded value is no longer marked", () => {
  assert.equal(sameValue(opening, "32.00", "32.0000"), true);
  assert.equal(sameValue(opening, "", "0"), true);
  assert.equal(sameValue(opening, "33.00", "32.0000"), false);
  assert.equal(sameValue(code, "a", "A"), false);
});

test("numbers show with the column's places, Indian grouping; a zero with no places shows blank", () => {
  assert.equal(shownValue(opening, "123456.5"), "1,23,456.50");
  assert.equal(shownValue({ fieldType: "N", decimals: 0 }, "0"), "");
  assert.equal(shownValue(code, "Gen Material"), "Gen Material");
  assert.equal(shownValue(opening, ""), "");
});

test("a column alias in single quotes (SQL Server) becomes a double-quoted name", () => {
  assert.equal(quotedAliases("case when a.ac_dbcode=1 then a.amount else 0 end as 'Withdrawals',x as 'Deposit'"), `case when a.ac_dbcode=1 then a.amount else 0 end as "Withdrawals",x as "Deposit"`);
  assert.equal(quotedAliases("where a.doc_pos<>'D' and name = 'as is'"), "where a.doc_pos<>'D' and name = 'as is'", "a string that is not an alias stays");
});

test("Bank Statement: a reconciliation date falls within 90 days after the entry", async () => {
  const { recoDateProblem } = await import("../lib/small-entry/bankReco.ts");
  assert.equal(recoDateProblem("31/Mar/2026", "05/Apr/2026"), "");
  assert.equal(recoDateProblem("31/Mar/2026", "29/Jun/2026"), "", "the 90th day is allowed");
  assert.match(recoDateProblem("31/Mar/2026", "30/Jun/2026"), /less than 29\/Jun\/2026/);
  assert.match(recoDateProblem("31/Mar/2026", "30/Mar/2026"), /more than 31\/Mar\/2026/);
  assert.equal(recoDateProblem("31/Mar/2026", ""), "", "a blank date un-reconciles");
});

test("Bank Statement: book and passbook balances, Dr when positive, Cr otherwise", async () => {
  const { bankBalances } = await import("../lib/small-entry/bankReco.ts");
  const rows = [{ Withdrawals: "0", Deposit: "5000.00" }, { Withdrawals: "1,200.50", Deposit: "0" }];
  assert.deepEqual(bankBalances(54506.49, rows), { book: "Balance As Per Bank Book : 54,506.49 Dr", passbook: "Balance As Per Passbook : 50,706.99 Dr" });
  assert.deepEqual(bankBalances(-100, []), { book: "Balance As Per Bank Book : 100.00 Cr", passbook: "Balance As Per Passbook : 100.00 Cr" });
});

test("the desktop per-entry query changes fill Production Planing and date Sale Order Allocate", async () => {
  const { entryGridSql } = await import("../lib/small-entry/gridSql.ts");
  const context = (entryId: number, controls: Record<string, string> = {}) => ({ entryId, session: { licence: 21, companySchema: "rishabh_plastic27" }, state: { firstCombo: null, controls }, entryNat: "A" }) as never;
  const date = () => "02/Oct/2026";
  const plan = entryGridSql("select x from p where e < |sys.plan_date| |sys.ent_date|", { context: context(35), date });
  assert.equal(plan.sql, "select x from p where e < '02/Oct/2026'  and prodplan.ent_date='02/Oct/2026'");
  assert.deepEqual(plan.warnings, []);
  assert.equal(entryGridSql("select 1 where 1=1", { context: context(39), date }).sql, "select 1 where 1=1 and g.p_date<='02/Oct/2026' order by c.prod_Desc");
  assert.match(entryGridSql("select 1", { context: context(69), date }).warnings[0], /not ported/);
  assert.equal(entryGridSql("select 1", { context: context(5), date }).sql, "select 1", "an entry with no desktop change is left alone");
});

test("|sys.fromdb| is the from-company schema, the company's own when there is none", async () => {
  const { replaceSessionValues } = await import("../lib/master-program/sql.ts");
  const session = (fromSchema: string) => ({ companySchema: "rishabh_plastic27", fromSchema, userNo: 1, yearId: "0104202631032027", tarikh1: new Date(2026, 3, 1), tarikh2: new Date(2027, 2, 31) }) as never;
  assert.equal(replaceSessionValues("select * from |sys.fromdb|product_master", session("rishabh_plastic27")), "select * from rishabh_plastic27.product_master");
  assert.equal(replaceSessionValues("select * from |sys.fromdb|product_master join |sys.db|x", session("group_master")), "select * from group_master.product_master join rishabh_plastic27.x");
});

test("desktop save rules that are not in the setup: rows never saved, header dates, Similar Product", async () => {
  const { entryStatements, headerDate, skipRow } = await import("../lib/small-entry/entrySave.ts");
  // Production planning saves only planned rows or rows already saved.
  assert.equal(skipRow(35, { Planing: "0" }, [], 0), true);
  assert.equal(skipRow(35, { planing: "12" }, [], 0), false);
  assert.equal(skipRow(48, { Planing: "0" }, [], 51), false, "a saved plan is updated even at 0");
  // Payment manual allot: column 3 is the amount; challan close: column 9 the quantity set off.
  assert.equal(skipRow(46, { NAME: "x", PAY_ALLOT_KEY: "0", ALLOT_AMOUNT: "0" }, ["NAME", "PAY_ALLOT_KEY", "ALLOT_AMOUNT"], 0), true);
  assert.equal(skipRow(46, { NAME: "x", PAY_ALLOT_KEY: "0", ALLOT_AMOUNT: "100" }, ["NAME", "PAY_ALLOT_KEY", "ALLOT_AMOUNT"], 0), false);
  assert.equal(skipRow(5, {}, [], 0), false, "entries without a rule save every edited row");
  const state = { firstCombo: { text: "Bowl", value: "8852" }, controls: { dtp_date: "02/Oct/2026" } };
  assert.equal(headerDate("sys.dt_date", state), "'02/Oct/2026'");
  assert.equal(headerDate("|sys.dt_date|", state), "'02/Oct/2026'");
  assert.equal(headerDate("sys.open_pcs", state), null);
  // Similar Product (51): ticked new row inserted, unticked saved row removed, others untouched.
  const keys = ["prod_sub_key", "prod_key", "prod_desc", "Tick"];
  const statements = entryStatements(51, [
    { values: { prod_sub_key: "0", prod_key: "6154", prod_desc: "Cable", Tick: "Yes" }, deleted: false },
    { values: { prod_sub_key: "7", prod_key: "6155", prod_desc: "Lid", Tick: "No" }, deleted: false },
    { values: { prod_sub_key: "0", prod_key: "6156", prod_desc: "Cap", Tick: "No" }, deleted: false },
  ], keys, state as never);
  assert.deepEqual(statements, [
    { sql: "", insert: { table: "prod_subsitude", fields: ["PARENT_PROD_ID", "SUB_PROD_ID", "PROD_SUB"], values: ["8852", "6154", "'Yes'"] } },
    { sql: "Delete from prod_subsitude where PROD_SUB_KEY=7" },
  ]);
  assert.equal(entryStatements(35, [], keys, state as never), null, "other entries save from the setup rows");
});

test("approvals post a stock line the desktop's way: whole numbers, half to even, less out and the rest in", async () => {
  const { balanceUpdate, toInt32 } = await import("../lib/small-entry/approvals.ts");
  assert.equal(toInt32("2.5"), 2);
  assert.equal(toInt32("3.5"), 4);
  assert.equal(toInt32("738.0000"), 738);
  assert.equal(toInt32("1.4"), 1);
  const line = { prod_id: "20047", trn_pcs: "738", trn_pack: "0", trn_weight: "1.5", trn_qty1: "2", trn_qty2: "0", trn_qty3: "0" };
  assert.equal(balanceUpdate(line, false), "Update prod_balance set add_pcs=add_pcs+738,add_pack=add_pack+0,add_weight=add_weight+2,add_qty1=add_qty1+2,add_qty2=add_qty2+0,add_qty3=add_qty3+0,clsg_pcs=clsg_pcs+738,clsg_pack=clsg_pack+0,clsg_weight=clsg_weight+2,clsg_qty1=clsg_qty1+2,clsg_qty2=clsg_qty2+0,clsg_qty3=clsg_qty3+0 where prec_flag='RP' and prod_id=20047");
  assert.match(balanceUpdate(line, true), /^Update prod_balance set less_pcs=less_pcs\+738,.*clsg_pcs=clsg_pcs-738,/);
});

test("payment approvals save the whole grid, the operator's ticks laid over it", async () => {
  const { overlayEdits } = await import("../lib/small-entry/payments.ts");
  const grid = [
    { out_key: "11", Name: "A", form_amt: "100", FORM_NUMBER: "No" },
    { out_key: "12", Name: "A", form_amt: "50", FORM_NUMBER: "No" },
    { out_key: "13", Name: "B", form_amt: "70", FORM_NUMBER: "No" },
  ];
  const rows = overlayEdits(grid, [{ values: { out_key: "12", Name: "A", form_amt: "50", FORM_NUMBER: "Yes" }, deleted: false }], "out_key");
  assert.deepEqual(rows.map((row) => row.values.FORM_NUMBER), ["No", "Yes", "No"]);
  assert.equal(rows.length, 3, "rows the operator did not touch still come, so their allotment is cleared as on the desktop");
});

test("Conference Order rounds as the desktop: the paisa half to even, the order total away from zero", async () => {
  const { roundPaisa, roundRupee } = await import("../lib/small-entry/conference.ts");
  assert.equal(roundPaisa(4978.656), 4978.66);
  assert.equal(roundPaisa(0.125), 0.12, "a half goes to the even paisa");
  assert.equal(roundPaisa(0.135), 0.14);
  assert.equal(roundRupee(50717.35), 50717);
  assert.equal(roundRupee(63396.5), 63397, "a half rupee goes up");
});

test("Outstanding Allocation's queries: unallocated receipts and pending bills, money compared as numbers", async () => {
  const { entryGridSql } = await import("../lib/small-entry/gridSql.ts");
  const context = { entryId: 19, session: { licence: 21, companySchema: "s" }, state: { firstCombo: null, controls: { cmb_smallentry2: "Add", cmb_smallentry1: "Sale" } }, entryNat: "A" } as never;
  const result = entryGridSql("Select c.led_key,c.doc_date,c.full_docno,c.amount,sum(OUT_SETOFF) as \"SETOFF\" from x where c.doc_pos<>'D'", { context, date: (name) => (name === "dtp_date" ? "01/Apr/2026" : "05/Oct/2026") });
  assert.match(result.sql, /a\.out_dbcode=2 and \(out_ag_outid is null or out_ag_outid=0\)/);
  assert.match(result.sql, /out_date between '01\/Apr\/2026' and '05\/Oct\/2026'/);
  assert.match(result.sql, /group by c\.LED_KEY/);
  assert.ok(result.detail, "the bills grid's query");
  assert.match(result.detail!, /c\.full_docno as "Bill_No"/);
  assert.match(result.detail!, /a\.out_dbcode=1 and \(a\.out_entryamt-out_setoff-out_ly_setoff\)::numeric>0/);
  assert.doesNotMatch(result.detail!, /sum\(OUT_SETOFF\)/);
  assert.deepEqual(result.warnings, []);
});
