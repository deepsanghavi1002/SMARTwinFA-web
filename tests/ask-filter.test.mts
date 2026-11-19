import assert from "node:assert/strict";
import test from "node:test";
import { amountColumnOf, askHideRows, closingColumnsOf, columnByPrefix, dateColumnOf, parseAsk, parseAskPlan, readValueCondition } from "../lib/report/askFilter.ts";

test("a sentence is read into a sign, an amount and names", () => {
  assert.deepEqual(parseAsk("only closing balance is zero")?.amount, { op: "zero", a: 0, b: 0 });
  const negative = parseAsk("only debtors ledger with closing balance -ve");
  assert.equal(negative?.sign, "neg");
  assert.deepEqual(negative?.words, ["debtor"]);
  assert.deepEqual(parseAsk("closing balance above 1 lakh")?.amount, { op: "gt", a: 100000, b: 0 });
  assert.deepEqual(parseAsk("closing balance between 10k and 5 lakh")?.amount, { op: "between", a: 10000, b: 500000 });
  assert.deepEqual(parseAsk("creditors with balance not zero")?.amount, { op: "nonzero", a: 0, b: 0 });
  assert.equal(parseAsk("above zero")?.sign, "pos");
  assert.equal(parseAsk("show me"), null);
  assert.deepEqual(parseAsk("market traders")?.words, ["market", "trader"]);
});

test("dates are read: a month, a day, a range of dates or of months", () => {
  const may = parseAsk("date only of may2026");
  assert.equal(may?.dates?.kind, "range");
  if (may?.dates?.kind === "range") assert.deepEqual([may.dates.from.getTime(), may.dates.to.getTime()], [new Date(2026, 4, 1).getTime(), new Date(2026, 4, 31).getTime()]);
  assert.deepEqual(parseAsk("date only of may")?.dates, { kind: "months", months: [4] });
  assert.equal(parseAsk("may 2026")?.summary, "date May 2026");
  const feb = parseAsk("date between nov and feb 2026");
  assert.equal(feb?.dates?.kind, "range");
  if (feb?.dates?.kind === "range") assert.deepEqual([feb.dates.from.getTime(), feb.dates.to.getTime()], [new Date(2025, 10, 1).getTime(), new Date(2026, 1, 28).getTime()]);
  assert.deepEqual(parseAsk("between apr and jun")?.dates, { kind: "months", months: [3, 4, 5] });
  const days = parseAsk("from 01/04/2026 to 15-05-2026");
  if (days?.dates?.kind === "range") assert.deepEqual([days.dates.from.getTime(), days.dates.to.getTime()], [new Date(2026, 3, 1).getTime(), new Date(2026, 4, 15).getTime()]);
  else assert.fail("a range of days was expected");
  assert.equal(parseAsk("10-oct-2026")?.summary, "date 10-Oct-2026");
});

test("debit and credit figures are read, each into its own column", () => {
  const both = parseAsk("debit above 10000 and credit less than zero");
  assert.deepEqual(both?.columns, [
    { column: "debit", sign: null, amount: { op: "gt", a: 10000, b: 0 } },
    { column: "credit", sign: "neg", amount: null },
  ]);
  assert.equal(both?.amount, null);
  assert.deepEqual(parseAsk("credit between 1 lakh and 2 lakh")?.columns, [{ column: "credit", sign: null, amount: { op: "between", a: 100000, b: 200000 } }]);
  // "credit balance" is the closing balance, not the credit column.
  const balance = parseAsk("credit balance");
  assert.equal(balance?.sign, "neg");
  assert.deepEqual(balance?.columns, []);
});

const row = (kind: "data" | "subtotal" | "total", level: number, rowType: string, values: Record<string, string>) => ({ kind, level, rowType, values, ledKey: 0, processKey: 0 });
const column = (key: string, kind: "text" | "number" | "date") => ({ key, caption: key, width: 90, align: "L" as const, kind, decimals: 2, visible: true });
const led = (date: string, debit: string, credit: string, closing: string, side: string) => row("data", 0, "LED", { DATE: date, DEBIT: debit, CREDIT: credit, CLOSINGS: closing, DR_CR: side });

// Book heading, then three parties. Alfa: debit 20,000 in May, paid back in June (closing 0). Beta: debit 500 in June (DR 500). Gamma: credit 70 in May (CR 70).
const rows = [
  row("data", 0, "BOOK", { NAME: "* DEBTORS LEDGER" }),
  row("data", 0, "AC", { NAME: "** Alfa" }), led("10-May-2026", "20,000.00", "", "20,000.00", "DR"), led("05-Jun-2026", "", "20,000.00", "0.00", ""), row("data", 0, "NARRATION", { NAME: "paid back" }), row("subtotal", 1, "", { NAME: "** Subtotal For : Alfa" }),
  row("data", 0, "AC", { NAME: "** Beta" }), led("12-Jun-2026", "500.00", "", "500.00", "DR"), row("subtotal", 1, "", { NAME: "** Subtotal For : Beta" }),
  row("data", 0, "AC", { NAME: "** Gamma" }), led("03-May-2026", "", "70.00", "70.00", "CR"), row("subtotal", 1, "", { NAME: "** Subtotal For : Gamma" }),
  row("subtotal", 0, "", { NAME: "* Subtotal For : DEBTORS LEDGER" }),
];
const columns = [column("NAME", "text"), column("DATE", "date"), column("DEBIT", "number"), column("CREDIT", "number"), column("CLOSINGS", "number"), column("DR_CR", "text")];
const output = { columns, rows } as never;
const groupStart = new Map([[5, 1], [8, 6], [11, 9], [12, 0]]);
const context = { isHeading: (r: { rowType: string }) => r.rowType === "BOOK" || r.rowType === "AC", headingLevel: (r: { rowType: string }) => (r.rowType === "BOOK" ? 0 : 1), groupStart };
const planOf = (sentence: string) => {
  const plan = parseAskPlan(sentence);
  if (!plan || "error" in plan) assert.fail(plan ? plan.error : "nothing was read");
  return plan;
};
const ask = (sentence: string) => {
  const result = askHideRows(output, planOf(sentence), context);
  if ("problem" in result) assert.fail(result.problem);
  return result;
};

test("the columns the report has are found", () => {
  assert.deepEqual(closingColumnsOf(columns), { closing: "CLOSINGS", side: "DR_CR" });
  assert.equal(amountColumnOf(columns, "debit"), "DEBIT");
  assert.equal(amountColumnOf(columns, "credit"), "CREDIT");
  assert.equal(dateColumnOf(columns, rows as never), "DATE");
});

test("only the ledgers that fit stay, by closing balance and by name", () => {
  const zero = ask("closing balance is zero");
  assert.deepEqual([zero.kept, zero.total], [1, 3]);
  assert.ok(zero.hide.has(6) && zero.hide.has(9) && !zero.hide.has(2) && !zero.hide.has(0));
  const credit = ask("debtors with closing balance -ve");
  assert.deepEqual([credit.kept, credit.total], [1, 3]);
  assert.ok(!credit.hide.has(9) && credit.hide.has(1));
  assert.equal(ask("creditors").kept, 0);
  assert.equal(ask("above 100").kept, 1);
});

test("a month keeps its entries, with their narration, and drops ledgers with none", () => {
  const may = ask("date only of may2026");
  assert.deepEqual([may.kept, may.total], [2, 3]);
  assert.ok(!may.hide.has(2) && may.hide.has(3) && may.hide.has(4) && may.hide.has(6) && !may.hide.has(10));
  const june = ask("date of jun2026");
  assert.deepEqual([june.kept, june.total], [2, 3]);
  assert.ok(june.hide.has(2) && !june.hide.has(3) && !june.hide.has(4));
  assert.equal(ask("between apr and jun").kept, 3);
  assert.equal(ask("date 05/06/2026").kept, 1);
});

test("debit and credit figures keep only the entries that fit", () => {
  const big = ask("debit above 10000");
  assert.deepEqual([big.kept, big.total], [1, 3]);
  assert.ok(!big.hide.has(2) && big.hide.has(3));
  assert.equal(ask("credit less than zero").kept, 0);
  assert.equal(ask("credit above 50").kept, 2);
  // Both: Alfa's May debit and no credit above 1 lakh.
  assert.equal(ask("debit above 10000 and date only of may2026").kept, 1);
  assert.equal(ask("closing balance zero date of jun2026").kept, 1);
});

test("a report without the column asked about says so", () => {
  const bare = { columns: [column("NAME", "text")], rows: [row("subtotal", 0, "", { NAME: "x" })] } as never;
  const result = askHideRows(bare, planOf("debit above 5"), context);
  assert.ok("problem" in result);
});

test("the English conditions are read the same way for figures, dates and text", () => {
  const op = (text: string) => readValueCondition(text);
  assert.deepEqual(op("is zero"), { op: "zero", operands: [] });
  assert.deepEqual(op("is not zero"), { op: "nonzero", operands: [] });
  assert.deepEqual(op("less than 5000"), { op: "lt", operands: ["5000"] });
  assert.deepEqual(op("greater than or equal to 1 lakh"), { op: "ge", operands: ["1 lakh"] });
  assert.deepEqual(op("at most 10"), { op: "le", operands: ["10"] });
  assert.deepEqual(op("between may and jun2026"), { op: "between", operands: ["may", "jun2026"] });
  assert.deepEqual(op("contains 'sale'"), { op: "contain", operands: ["sale"] });
  assert.deepEqual(op("does not contain sale"), { op: "notcontain", operands: ["sale"] });
  assert.deepEqual(op("not equal to 'sale'"), { op: "ne", operands: ["sale"] });
  assert.deepEqual(op("is not 500"), { op: "ne", operands: ["500"] });
  assert.deepEqual(op("equal 500"), { op: "eq", operands: ["500"] });
  assert.deepEqual(op("is may2026"), { op: "eq", operands: ["may2026"] });
  assert.deepEqual(op("starts with al"), { op: "starts", operands: ["al"] });
  assert.equal(op(""), null);
});

test("a name in quotes is a column by its first letters; a hyphen makes it 'group -figure'; stars are the group's level", () => {
  assert.equal(columnByPrefix(columns, "dat")?.key, "DATE");
  assert.equal(columnByPrefix(columns, "closing")?.key, "CLOSINGS");
  assert.equal(columnByPrefix(columns, "zzz"), undefined);
  const plan = parseAskPlan("'date' between may and jun2026, 'nam -closing bal' is zero, '* debtors'");
  assert.ok(plan && !("error" in plan) && plan.kind === "structured");
  if (plan && !("error" in plan) && plan.kind === "structured") {
    assert.deepEqual(plan.clauses.map((clause) => clause.kind), ["column", "groupValue", "group"]);
    assert.equal(plan.clauses[1].kind === "groupValue" && plan.clauses[1].column, "closing bal");
    assert.equal(plan.clauses[2].kind === "group" && plan.clauses[2].level, 0);
  }
  // A party name with " - " in it is not cut at the hyphen: only " -column" (a hyphen right before the column) is.
  const named = parseAskPlan("'** alfa industries - purchase'");
  assert.ok(named && !("error" in named) && named.kind === "structured" && named.clauses[0].kind === "group");
  assert.ok("error" in (parseAskPlan("date between may and jun") as object) === false, "words with no quotes still read as a sentence");
  assert.ok("error" in (parseAskPlan("'date' ") as { error: string }), "a name with no condition is refused");
  assert.ok("error" in (parseAskPlan("'** alfa' is zero") as { error: string }), "a group with a condition is told how to ask for its figure");
});

test("quoted clauses pick the groups, the entries and the figures of each party", () => {
  assert.equal(ask("'* debtors'").kept, 3);
  assert.equal(ask("'* creditor'").kept, 0);
  assert.equal(ask("'** al'").kept, 1);
  assert.equal(ask("'** b', '** g'").kept, 0, "two clauses must both hold");
  // the date column: a month, months with a year, before / after, is not
  assert.equal(ask("'date' is may2026").kept, 2);
  assert.equal(ask("'date' between may and jun2026").kept, 3);
  assert.equal(ask("'dat' not equal may2026").kept, 2, "Alfa's June entry and Beta's June entry");
  assert.equal(ask("'date' after 31-may-2026").kept, 2);
  assert.equal(ask("'date' before 01-jun-2026").kept, 2);
  // a figure of each entry
  const big = ask("'debit' greater than 10000");
  assert.deepEqual([big.kept, big.total], [1, 3]);
  assert.equal(ask("'credit' less than zero").kept, 0);
  assert.equal(ask("'debit' between 400 and 600").kept, 1);
  assert.equal(ask("'debit' is not zero, 'date' is jun2026").kept, 1);
  // a figure of each party: the closing balance (CR is minus), or the sum of any other figure column
  assert.equal(ask("'nam -closing bal' is zero").kept, 1);
  assert.equal(ask("'** -closing' less than zero").kept, 1);
  assert.equal(ask("'** -closing' greater than 100").kept, 1);
  assert.equal(ask("'nam -debit' greater than 1000").kept, 1);
  assert.equal(ask("'* debtors', '** -closing' is not zero").kept, 2);
});

test("quoted text conditions work on text columns", () => {
  const text = { columns: [column("NAME", "text"), column("PARTICULARS", "text"), column("CREDIT", "number")], rows: [
    row("data", 0, "BOOK", { NAME: "* DEBTORS LEDGER" }),
    row("data", 0, "AC", { NAME: "** Alfa" }), row("data", 0, "LED", { PARTICULARS: "SALE" }), row("data", 0, "LED", { PARTICULARS: "RECEIPT" }), row("subtotal", 1, "", { NAME: "** Subtotal For : Alfa" }),
    row("data", 0, "AC", { NAME: "** Beta" }), row("data", 0, "LED", { PARTICULARS: "Cash receipt" }), row("subtotal", 1, "", { NAME: "** Subtotal For : Beta" }),
    row("subtotal", 0, "", { NAME: "* Subtotal For : DEBTORS LEDGER" }),
  ] } as never;
  const start = new Map([[4, 1], [7, 5], [8, 0]]);
  const here = { ...context, groupStart: start };
  const run = (sentence: string) => { const result = askHideRows(text, planOf(sentence), here); if ("problem" in result) assert.fail(result.problem); return result; };
  assert.equal(run("'parti' contains 'sale'").kept, 1);
  assert.equal(run("'parti' contains receipt").kept, 2);
  assert.equal(run("'parti' starts with rec").kept, 1);
  assert.equal(run("'parti' is 'sale'").kept, 1);
  const notSale = run("'parti' not equal 'sale'");
  assert.equal(notSale.kept, 2);
  assert.ok(notSale.hide.has(2) && !notSale.hide.has(3), "only Alfa's SALE line is taken off");
  assert.equal(run("'parti' does not contain 'receipt'").kept, 1);
  assert.ok("problem" in askHideRows(text, planOf("'parti' greater than 5"), here), "text cannot be compared with a figure");
  assert.ok("problem" in askHideRows(text, planOf("'zzz' is zero"), here), "an unknown column is named");
  assert.ok("problem" in askHideRows(text, planOf("'*** x'"), here), "a level the report does not have is named");
});

test("'parti -#open': the balance on a ledger's opening or closing line decides, and the whole ledger stays", () => {
  // Alfa: opening 100 CR, an entry, closing 100 CR. Beta: no opening line (it was nil), an entry, closing nil. Gamma: opening 50 DR, closing 50 DR (shown as 50 on Credit).
  const book = { columns: [column("NAME", "text"), column("PARTICULARS", "text"), column("DEBIT", "number"), column("CREDIT", "number"), column("CLOSINGS", "number"), column("DR_CR", "text")], rows: [
    row("data", 0, "BOOK", { NAME: "* DEBTORS LEDGER" }),
    row("data", 0, "AC", { NAME: "** Alfa" }),
    row("data", 0, "OPENINGS", { PARTICULARS: "Opening Balance B/d", CREDIT: "100.00", CLOSINGS: "-100.00", DR_CR: "CR" }),
    row("data", 0, "LED", { PARTICULARS: "PURCHASE", CREDIT: "20.00", CLOSINGS: "-120.00", DR_CR: "CR" }),
    row("data", 0, "CLOSING", { PARTICULARS: "Closing Balance B/d", DEBIT: "120.00", DR_CR: "CR" }),
    row("subtotal", 1, "", { NAME: "** Subtotal For : Alfa" }),
    row("data", 0, "AC", { NAME: "** Beta" }),
    row("data", 0, "LED", { PARTICULARS: "SALE", DEBIT: "10.00", CLOSINGS: "10.00", DR_CR: "DR" }),
    row("data", 0, "CLOSING", { PARTICULARS: "Closing Balance B/d", CREDIT: "10.00", DR_CR: "DR" }),
    row("subtotal", 1, "", { NAME: "** Subtotal For : Beta" }),
    row("data", 0, "AC", { NAME: "** Gamma" }),
    row("data", 0, "OPENINGS", { PARTICULARS: "Opening Balance B/d", DEBIT: "50.00", CLOSINGS: "50.00", DR_CR: "DR" }),
    row("data", 0, "CLOSING", { PARTICULARS: "Closing Balance B/d", CREDIT: "50.00", DR_CR: "DR" }),
    row("subtotal", 1, "", { NAME: "** Subtotal For : Gamma" }),
    row("subtotal", 0, "", { NAME: "* Subtotal For : DEBTORS LEDGER" }),
  ] } as never;
  const start = new Map([[5, 1], [9, 6], [13, 10], [14, 0]]);
  const here = { ...context, groupStart: start };
  const run = (sentence: string) => { const result = askHideRows(book, planOf(sentence), here); if ("problem" in result) assert.fail(result.problem); return result; };
  // opening balance below zero: Alfa, and all of Alfa's lines stay
  const credit = run("'parti -#open' is less than zero");
  assert.deepEqual([credit.kept, credit.total], [1, 3]);
  assert.ok(![2, 3, 4].some((at) => credit.hide.has(at)), "the whole ledger is shown, not just its opening line");
  assert.ok(credit.hide.has(7) && credit.hide.has(11));
  // no opening line counts as nil
  assert.equal(run("'parti -#open' is zero").kept, 1);
  assert.ok(!run("'parti -#open' is zero").hide.has(7));
  assert.equal(run("'parti -#open' greater than zero").kept, 1);
  assert.equal(run("'parti -#open' is not zero").kept, 2);
  // the closing line: its balance is the one on its DR / CR side (Alfa 120 CR, Beta 10 DR, Gamma 50 DR)
  assert.equal(run("'parti -#closing' less than zero").kept, 1);
  assert.equal(run("'parti -#clos' greater than 20").kept, 1);
  assert.equal(run("'parti -#clos' between 5 and 60").kept, 2);
  // with a hyphen text and no #, only the lines that hold the word stay
  const lines = run("'parti -open' is less than zero");
  assert.equal(lines.kept, 1);
  assert.ok(!lines.hide.has(2) && lines.hide.has(3) && lines.hide.has(4), "Alfa's opening line only");
  // stars on the left, and several clauses together
  assert.equal(run("'* debtors', '** -#open' is not zero, 'parti -#clos' greater than 20").kept, 1);
  assert.ok("error" in (parseAskPlan("'parti -#' is zero") as { error: string }), "the # needs a word");
  assert.ok("problem" in askHideRows(book, planOf("'zzz -#open' is zero"), here), "an unknown column is named");
});

test("a heading longer than four letters needs its first four typed", () => {
  assert.equal(columnByPrefix(columns, "debi")?.key, "DEBIT");
  assert.equal(columnByPrefix(columns, "deb"), undefined, "three letters of a five-letter heading are too few");
  assert.equal(columnByPrefix(columns, "cre"), undefined);
  assert.equal(columnByPrefix(columns, "clos")?.key, "CLOSINGS");
  assert.equal(columnByPrefix(columns, "clo"), undefined);
  assert.equal(columnByPrefix(columns, "date")?.key, "DATE");
  assert.equal(columnByPrefix(columns, "dat")?.key, "DATE", "a heading of four letters or fewer needs no more than it has");
  assert.equal(columnByPrefix(columns, "dr_c")?.key, "DR_CR");
  const few = askHideRows(output, planOf("'deb' greater than 5"), context);
  assert.ok("problem" in few && /too few letters/.test(few.problem) && /'debi'/.test(few.problem), "the message says how many letters to type");
  const none = askHideRows(output, planOf("'zzzz' is zero"), context);
  assert.ok("problem" in none && /No column begins with 'zzzz'/.test(none.problem));
});

test("the export says the question in full: whole column headings, the words spelt right", () => {
  const textOf = (sentence: string) => {
    const result = askHideRows(output, planOf(sentence), context);
    if ("problem" in result) assert.fail(result.problem);
    return result.text;
  };
  // the first letters typed become the whole heading; a month and a range become dates
  assert.equal(textOf("'dat' between may and jun2026"), "'DATE' between 01-May-2026 and 30-Jun-2026");
  assert.equal(textOf("'date' is may2026"), "'DATE' is May 2026");
  assert.equal(textOf("'date' after 31-may-2026"), "'DATE' is after 31-May-2026");
  assert.equal(textOf("'debit' greater than 10000"), "'DEBIT' is greater than 10,000");
  assert.equal(textOf("'debit' at least 1 lakh"), "'DEBIT' is greater than or equal to 1,00,000");
  assert.equal(textOf("'nam -closing bal' is zero"), "'NAME -CLOSINGS' is zero");
  assert.equal(textOf("'** -closing' less than zero"), "'** -CLOSINGS' is less than zero");
  assert.equal(textOf("'* debt'"), "'* DEBTORS LEDGER'", "a group's whole name");
  assert.equal(textOf("'debit' not equal 0, 'date' is not may2026"), "'DEBIT' is not zero, 'DATE' is not May 2026");
  // misspelt condition words are mended; so is a column with a letter wrong
  assert.equal(textOf("'debi' greter then 10000"), "'DEBIT' is greater than 10,000");
  assert.equal(textOf("'date' betwen may and jun2026"), "'DATE' between 01-May-2026 and 30-Jun-2026");
  assert.equal(textOf("'nam -closng bal' is zero"), "'NAME -CLOSINGS' is zero");
  assert.equal(textOf("'closng' less thn zero"), "'CLOSINGS' is less than zero");
  // plain words come out in the bar's own words
  assert.equal(textOf("only closing balance is zero"), "closing balance zero");
});

test("text operands are never 'mended'; a heading with a letter wrong is found; the whole line is named for #", () => {
  const book = { columns: [column("NAME", "text"), column("PARTICULARS", "text"), column("DEBIT", "number"), column("CREDIT", "number"), column("CLOSINGS", "number"), column("DR_CR", "text")], rows: [
    row("data", 0, "BOOK", { NAME: "* DEBTORS LEDGER" }),
    row("data", 0, "AC", { NAME: "** Alfa" }),
    row("data", 0, "OPENINGS", { PARTICULARS: "Opening Balance B/d", CREDIT: "100.00", CLOSINGS: "-100.00", DR_CR: "CR" }),
    row("data", 0, "LED", { PARTICULARS: "lesss sale", DEBIT: "5.00", CLOSINGS: "-95.00", DR_CR: "CR" }),
    row("subtotal", 1, "", { NAME: "** Subtotal For : Alfa" }),
    row("subtotal", 0, "", { NAME: "* Subtotal For : DEBTORS LEDGER" }),
  ] } as never;
  const here = { ...context, groupStart: new Map([[4, 1], [5, 0]]) };
  const textOf = (sentence: string) => { const result = askHideRows(book, planOf(sentence), here); if ("problem" in result) assert.fail(result.problem); return result; };
  assert.equal(textOf("'partculars' contains lesss").text, "'PARTICULARS' contains 'lesss'", "the operand stays as typed");
  assert.equal(textOf("'partculars' conatins lesss").kept, 1, "the word 'contains' is mended, the operand is not");
  assert.equal(textOf("'parti -#open' is less than zero").text, "'PARTICULARS -#Opening Balance B/d' is less than zero");
  assert.equal(textOf("'parti -open' is less than zero").text, "'PARTICULARS -Opening Balance B/d' is less than zero");
  assert.equal(textOf("'parti' contains 'sale', 'parti -#open' is not zero").text, "'PARTICULARS' contains 'sale', 'PARTICULARS -#Opening Balance B/d' is not zero");
});

test("a report with no groups is asked about its rows", () => {
  const flat = { columns: [column("DATE", "date"), column("PARTICULARS", "text"), column("DEBIT", "number"), column("CREDIT", "number")], rows: [
    row("data", 0, "LED", { DATE: "10-May-2026", PARTICULARS: "SALE to Alfa", DEBIT: "20,000.00", CREDIT: "" }),
    row("data", 0, "NARRATION", { PARTICULARS: "against bill 5" }),
    row("data", 0, "LED", { DATE: "05-Jun-2026", PARTICULARS: "RECEIPT", DEBIT: "", CREDIT: "20,000.00" }),
    row("data", 0, "LED", { DATE: "12-Jun-2026", PARTICULARS: "SALE to Beta", DEBIT: "500.00", CREDIT: "" }),
    row("total", 0, "FT", { PARTICULARS: "Total" }),
  ] } as never;
  const here = { isHeading: () => false, headingLevel: () => 0, groupStart: new Map<number, number>() };
  const run = (sentence: string) => { const result = askHideRows(flat, planOf(sentence), here); if ("problem" in result) assert.fail(result.problem); return result; };
  const may = run("'date' is may2026");
  assert.deepEqual([may.kept, may.total, may.unit], [1, 3, "rows"]);
  assert.ok(!may.hide.has(0) && !may.hide.has(1) && may.hide.has(2) && may.hide.has(3) && !may.hide.has(4), "the narration follows its entry; the total is never taken off");
  assert.equal(run("'parti' contains 'sale'").kept, 2);
  assert.equal(run("'debit' greater than 1000").kept, 1);
  assert.equal(run("'debit' greater than 1000, 'parti' contains 'sale'").text, "'DEBIT' is greater than 1,000, 'PARTICULARS' contains 'sale'");
  // plain words work too: dates, figures and a word that is in the row
  assert.equal(run("date only of jun2026").kept, 2);
  assert.equal(run("credit above 100").kept, 1);
  assert.equal(run("alfa").kept, 1);
  // what only ledgers can answer is refused, and says so
  const stars = askHideRows(flat, planOf("'* debtors'"), here);
  assert.ok("problem" in stars && /need a report with groups/.test(stars.problem));
  const closing = askHideRows(flat, planOf("closing balance is zero"), here);
  assert.ok("problem" in closing && /has none/.test(closing.problem));
});
