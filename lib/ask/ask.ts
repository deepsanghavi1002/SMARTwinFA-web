import type { Client } from "pg";
import { SETUP_SCHEMA, SYSTEM_SCHEMA, type MasterSession } from "../master-program/session";
import { readMenuCatalog, type MenuNode } from "../menu-catalog";
import { Loader } from "../master-program/load";
import { amountOf as amountOfCell, isEntry as isEntryRow } from "../report/compare";
import { registerBooks } from "../report/registerBooks";
import { runReport } from "../report/reportCombine";
import { loadReport } from "../report/setup";
import type { PivotAggregate } from "../report/pivot";
import type { PivotHint, SumifHint, SumifOperator } from "../report/pivotHint";

/**
 * Ask AI, without a model: a question typed in plain words is matched to one of a fixed list of questions (keywords and a period / top-N /
 * party read from the text), and answered by a fixed read-only query over the company's own tables. Nothing is generated: a question that
 * matches none is refused with the nearest ones listed, so no number is ever made up.
 *
 * Meaning of the tables used here:
 *  - OUTCLEAR is the bill-wise outstanding: one row per entry (OUT_LEDID the ledger entry), OUT_DBCODE its side (1 debit, 2 credit),
 *    OUT_ENTRYAMT the amount, OUT_SETOFF what has been set off, CLEAR_POS 'C' once cleared. A row that points at a bill (OUT_AG_OUTID)
 *    is a settlement and is not an open item. Customers are the accounts of book 2 (Debtors Ledger), suppliers of book 3 (Creditor Ledger).
 *  - LEDGER holds one row per entry for its party (CODE), BOOK its book key (8 sale, 13 purchase, 16 credit note, 11 debit note, 4 cash,
 *    6 bank); DOC_POS 'D' is a cancelled entry.
 *  - Overdue: the bill date plus the account's CREDIT_DAYS is before today.
 */

export type AskColumn = Readonly<{ key: string; caption: string; kind: "text" | "money" | "int" | "date" }>;
export type AskAnswer = Readonly<{
  id: number;
  title: string;
  columns: readonly AskColumn[];
  /** A row's `code` (not a column) is its account: the ledger can be opened from it. */
  rows: readonly Record<string, string | number>[];
  /** A row's `detail` (not a column) says the row can be opened for the parties it is made of: the key is sent back to the server. */
  /** A line under the table (the period, what was counted). */
  note?: string;
  /** Other ways to ask the same question (a period): buttons above the table, each asking its question. */
  choices?: readonly { label: string; question: string }[];
  /** The party's ledger can be opened as a report. */
  /** The answer in a sentence or two, shown above the table (the verdict of a trend, what changed). */
  summary?: string;
  /** A bar chart drawn above the table: the column of the bar names, the column of the bar values, and how many of the first rows are bars. */
  chart?: Readonly<{ label: string; value: string; count: number }>;
  ledger?: Readonly<{ code: number; name: string }>;
  /** The dates the answer is for (a ledger or report opened from it uses them). */
  period?: Readonly<{ from: string; to: string }>;
  /** The answer is a report of the program: this button opens it (name is the report's menu action). */
  report?: Readonly<{ name: string; label: string; /** The dates the question named (YYYY-MM-DD): the report opens for them. */ from?: string; to?: string; /** A pivot to set up on the report once it has run (what the question asked for, by the names used). */ pivot?: PivotHint; /** The question, for the report to choose its first combo from (purchase register, not the sale one it opens on). */ sumif?: SumifHint; /** Choices (control name to item text) and options to tick as the report opens. */ setup?: Readonly<{ choices: Readonly<Record<string, string>>; checks: readonly string[] }>; pick?: string; /** The party the question named (for single-account reports, and to narrow any other): ticked as the only account. */ party?: Readonly<{ code: number; name: string }> }>;
}>;
export type AskReply =
  | Readonly<{ kind: "answer"; answer: AskAnswer; /** What answered it (for the memory): the template and the party or product chosen. */ used?: Readonly<{ templateId: number; partyCode?: number }> }>
  | Readonly<{ kind: "choose-party"; what: "party" | "product"; question: string; templateId: number; choices: readonly { code: number; name: string }[]; /** The question can also be answered for every party. */ allParties: boolean }>
  | Readonly<{ kind: "refuse"; message: string; suggestions: readonly string[] }>;

type Period = Readonly<{ from: string; to: string; label: string }>;
type Party = Readonly<{ code: number; name: string; hint?: string }>;
type Ctx = Readonly<{
  client: Client;
  sch: string;
  session: MasterSession;
  today: string;
  period: Period;
  top: number;
  days: number;
  party?: Party;
  product?: Party;
  /** The question as asked (a party named in it narrows an answer). */
  question?: string;
}>;

type Template = Readonly<{
  id: number;
  question: string;
  /** All of these must be found in the question. */
  terms: readonly RegExp[];
  /** None of these may be. */
  not?: readonly RegExp[];
  needsParty?: boolean;
  /** The account book the party is chosen from: 2 the customers (debtors), 3 the suppliers (creditors); none: any party. */
  partyBook?: 2 | 3;
  needsProduct?: boolean;
  /** The answer for every party together (the party help offers it). */
  runAll?: (ctx: Ctx) => Promise<AskAnswer>;
  /** The period when the question names none. */
  defaultPeriod: "today" | "month" | "year" | "none";
  run: (ctx: Ctx) => Promise<AskAnswer>;
}>;

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dmy = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};
const num = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };


const money = (key: string, caption: string): AskColumn => ({ key, caption, kind: "money" });
const text = (key: string, caption: string): AskColumn => ({ key, caption, kind: "text" });
const int = (key: string, caption: string): AskColumn => ({ key, caption, kind: "int" });
const date = (key: string, caption: string): AskColumn => ({ key, caption, kind: "date" });

async function rows(ctx: Ctx, sql: string, params: unknown[] = []) {
  return (await ctx.client.query(sql, params)).rows as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Outstanding (A)

/**
 * A party's balance as the Outstanding Agewise report takes it: the year's opening (AC_BALANCE) plus the debits less the credits of its posted,
 * not cancelled entries up to the date. Customers (book 2) owe it when it is a debit; suppliers (book 3) when it is a credit.
 */
type Balance = Readonly<{ code: number; name: string; creditDays: number; opening: number; debit: number; credit: number; closing: number }>;

async function balances(ctx: Ctx, book: number, only?: readonly number[]): Promise<Balance[]> {
  const found = await rows(ctx,
    `WITH mv AS (SELECT l.code, SUM(CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE 0 END) AS debit, SUM(CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric ELSE 0 END) AS credit`
    + ` FROM ${ctx.sch}.ledger l WHERE l.doc_pos <> 'D' AND l.doc_date <= $1::date AND l.doc_posting = 'P' AND l.book_code IN (SELECT code FROM ${ctx.sch}.account WHERE a_pos <> 'D') GROUP BY l.code)`
    + ` SELECT ac.code, btrim(ac.name) AS name, COALESCE(ac.credit_days, 0) AS credit_days, COALESCE(MAX(ab.opening::numeric), 0) AS opening, COALESCE(mv.debit, 0) AS debit, COALESCE(mv.credit, 0) AS credit`
    + ` FROM ${ctx.sch}.account ac LEFT JOIN ${ctx.sch}.ac_balance ab ON ab.code = ac.code AND ab.year_id = $2 LEFT JOIN mv ON mv.code = ac.code`
    + ` WHERE ac.book = $3 AND ac.a_pos <> 'D' AND ac.os_flag <> 'N'${only ? " AND ac.code = ANY($4::int[])" : ""} GROUP BY ac.code, ac.name, ac.credit_days, mv.debit, mv.credit`,
    only ? [ctx.today, ctx.session.yearId, book, [...only]] : [ctx.today, ctx.session.yearId, book]);
  return found.map((row) => {
    const opening = num(row.opening); const debit = num(row.debit); const credit = num(row.credit);
    return { code: num(row.code), name: String(row.name), creditDays: num(row.credit_days), opening, debit, credit, closing: Math.round((opening + debit - credit) * 100) / 100 };
  }).filter((row) => row.opening !== 0 || row.debit !== 0 || row.credit !== 0);
}

/** What is owed on a party: customers' debit balances, suppliers' credit balances (the other way is an advance). */
const owed = (book: 2 | 3, balance: Balance) => (book === 2 ? balance.closing : -balance.closing);

async function totalOutstanding(ctx: Ctx, book: 2 | 3, id: number, title: string, billsCaption: string, advancesCaption: string, netCaption: string): Promise<AskAnswer> {
  const all = await balances(ctx, book);
  const bills = all.filter((row) => owed(book, row) > 0).reduce((sum, row) => sum + owed(book, row), 0);
  const advances = all.filter((row) => owed(book, row) < 0).reduce((sum, row) => sum - owed(book, row), 0);
  return {
    id, title, columns: [text("item", "Item"), money("amount", "Amount")],
    rows: [{ item: billsCaption, amount: bills, detail: `owe:${book}` }, { item: advancesCaption, amount: -advances, detail: `credit:${book}` }, { item: netCaption, amount: bills - advances }],
    note: `Party balances up to ${dmy(ctx.today)} (the year's opening plus entries), as the Outstanding Agewise report takes them: ${all.filter((row) => owed(book, row) > 0).length} ${book === 2 ? "customers" : "suppliers"} owe, ${all.filter((row) => owed(book, row) < 0).length} are in credit. Click a line to show its parties, click again to hide them.`,
  };
}

/** The parties a line of the outstanding totals is made of ("owe:2" the customers who owe, "credit:2" those in credit; 3 the suppliers), biggest first. */
async function outstandingParties(ctx: Ctx, detail: string): Promise<AskAnswer | null> {
  const match = /^(owe|credit):([23])$/.exec(detail);
  if (!match) return null;
  const book = Number(match[2]) as 2 | 3;
  const side = match[1];
  const who = book === 2 ? "Customer" : "Supplier";
  const list = (await balances(ctx, book)).map((row) => ({ row, amount: owed(book, row) })).filter((item) => (side === "owe" ? item.amount > 0 : item.amount < 0)).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const total = list.reduce((sum, item) => sum + item.amount, 0);
  const rowsOut = list.map((item, at) => ({ no: at + 1, name: item.row.name, amount: item.amount, code: item.row.code }));
  return {
    id: 0, title: `${side === "owe" ? (book === 2 ? "Customers who owe" : "Suppliers owed") : (book === 2 ? "Customers in credit" : "Suppliers in debit")} (${list.length})`,
    columns: [int("no", "No."), text("name", who), money("amount", "Amount")],
    rows: list.length === 0 ? [] : [...rowsOut, { no: "", name: "Total", amount: total }],
    note: `Party balances up to ${dmy(ctx.today)}, as the Outstanding Agewise report takes them.`,
  };
}

/** What a line of the business summary is made of, for the period asked: sales by customer, purchases by supplier, the cash and bank entries, the expenses. */
async function summaryDetail(ctx: Ctx, detail: string): Promise<AskAnswer | null> {
  const { from, to, label } = ctx.period;
  if (detail === "sales") {
    const list = (await netSales(ctx, from, to, true)).filter((row) => row.sales !== 0 || row.returns !== 0).sort((a, b) => b.net - a.net);
    const rowsOut = list.map((row) => ({ name: row.name, entries: row.entries, sales: row.sales, returns: -row.returns, net: row.net, code: row.code }));
    const sum = (key: "entries" | "sales" | "returns" | "net") => list.reduce((total, row) => total + row[key], 0);
    return { id: 0, title: `Net sales by customer (${list.length})`, columns: [text("name", "Customer"), int("entries", "Entries"), ...salesColumns], rows: list.length === 0 ? [] : [...rowsOut, { name: "Total", entries: sum("entries"), sales: sum("sales"), returns: -sum("returns"), net: sum("net") }], note: `${label}. ${SALES_NOTE}` };
  }
  if (detail === "purchase") {
    const found = await rows(ctx, `SELECT l.code, btrim(ac.name) AS name, COUNT(*) AS entries, SUM(l.amount::numeric) AS amount FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE l.book = ${PURCHASE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY l.code, ac.name ORDER BY amount DESC`, [from, to]);
    const out = found.map((row) => ({ name: String(row.name ?? ""), entries: num(row.entries), amount: num(row.amount), code: num(row.code) }));
    return { id: 0, title: `Purchases by supplier (${out.length})`, columns: [text("name", "Supplier"), int("entries", "Entries"), money("amount", "Amount")], rows: out.length === 0 ? [] : [...out, { name: "Total", entries: out.reduce((t, r) => t + r.entries, 0), amount: out.reduce((t, r) => t + r.amount, 0) }], note: `${label}: the Purchase book, with tax.` };
  }
  const monthOf = /^pmonth:(\d{4})-(\d{2}):(\d+)$/.exec(detail);
  if (monthOf) {
    const year = Number(monthOf[1]); const month = Number(monthOf[2]) - 1; const code = Number(monthOf[3]);
    const found = await rows(ctx, `SELECT l.code, l.doc_date AS d, l.full_docno AS doc, btrim(ac.name) AS party, l.amount::numeric AS amount FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = ${PURCHASE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date${code > 0 ? " AND l.code = $3" : ""} ORDER BY l.doc_date, l.led_key LIMIT 1000`,
      code > 0 ? [iso(new Date(year, month, 1)), iso(new Date(year, month + 1, 0)), code] : [iso(new Date(year, month, 1)), iso(new Date(year, month + 1, 0))]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount), code: num(row.code) }));
    return { id: 0, title: `Purchase bills of ${MONTHS_SHORT[month]}-${year} (${out.length})`, columns: [date("d", "Date"), text("doc", "Bill"), text("party", "Supplier"), money("amount", "Amount")], rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: "Total", amount: out.reduce((t, r) => t + r.amount, 0) }], note: "Double-click a row to open the supplier's ledger." };
  }
  // A row of the HSN-wise sales (hsn) or purchase (hsnp) summary: the lines of that HSN code (the notes against them as minus), in the dates of the row.
  const hsnOf = /^(hsnp?):([^:]*):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (hsnOf) {
    const side = hsnOf[1] === "hsn" ? "sale" : "purchase";
    const code = decodeURIComponent(hsnOf[2]);
    const lines = hsnLines(ctx, side);
    const found = await rows(ctx,
      `SELECT l.code, l.doc_date AS d, l.full_docno AS doc, btrim(ac.name) AS party, btrim(pm.prod_desc) AS product, ${lines.sign("pl.quantity")} AS qty, ${lines.sign("pl.il_value")} AS value`
      + ` FROM ${lines.from} LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE ${lines.where} AND COALESCE(NULLIF(btrim(pm.hsn_code), ''), '') = $3 ORDER BY l.doc_date, l.led_key, pl.il_key LIMIT 1000`,
      [hsnOf[3], hsnOf[4], code === "(no HSN)" ? "" : code]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), product: String(row.product ?? ""), qty: num(row.qty), value: num(row.value), code: num(row.code) }));
    return { id: 0, title: `${side === "sale" ? "Sales" : "Purchases"} of HSN ${code} (${out.length})`, columns: [date("d", "Date"), text("doc", "Bill"), text("party", side === "sale" ? "Customer" : "Supplier"), text("product", "Product"), qty("qty", "Quantity"), money("value", "Taxable Value")],
      rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: "Total", product: "", qty: out.reduce((t, r) => t + r.qty, 0), value: out.reduce((t, r) => t + r.value, 0) }] };
  }
  // A row of the dependence on major customers: the customers ranked from..to by net sales.
  const bandOf = /^conc:(\d+):(\d+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (bandOf) {
    const all = (await netSales(ctx, bandOf[3], bandOf[4], true)).filter((row) => row.net > 0).sort((a, b) => b.net - a.net);
    const total = sumOf(all, (row) => row.net);
    const first = Number(bandOf[1]);
    const list = all.slice(first, Number(bandOf[2]));
    const band = sumOf(list, (row) => row.net);
    return {
      id: 0, title: `Customers ranked ${first + 1} to ${first + list.length} (${list.length})`, columns: [int("no", "Rank"), text("name", "Customer"), int("entries", "Entries"), ...salesColumns, money("share", "Share of All Sales %")],
      rows: list.length === 0 ? [] : [...list.slice(0, 500).map((row, at) => ({ no: first + at + 1, name: row.name, entries: row.entries, sales: row.sales, returns: -row.returns, net: row.net, share: pctOf(row.net, total), code: row.code })), { no: "", name: "Total", entries: sumOf(list, (row) => row.entries), sales: sumOf(list, (row) => row.sales), returns: -sumOf(list, (row) => row.returns), net: band, share: pctOf(band, total) }],
      note: `${dmy(bandOf[3])} to ${dmy(bandOf[4])}. ${SALES_NOTE} Double-click a row to open the customer's ledger.${list.length > 500 ? " The first 500 are shown." : ""}`,
    };
  }
  // A row of the revenue by Sales Man / Area ...: its customers.
  const groupOf = /^grp:(\d+):([^:]*):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (groupOf) return groupCustomers(ctx, Number(groupOf[1]), decodeURIComponent(groupOf[2]), groupOf[3], groupOf[4]);
  // A row of the highest expenses: the entries of that expense account in the dates of the row.
  const entriesOf = /^expd:(\d+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (entriesOf) {
    const found = await rows(ctx, `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(bk.name, '')) AS paid_from, btrim(COALESCE(l.narration, '')) AS narration, l.amount::numeric AS amount, ac.name AS name FROM ${ctx.sch}.ledger l JOIN ${ctx.sch}.account ac ON ac.code = l.code LEFT JOIN ${ctx.sch}.account bk ON bk.code = l.book_code`
      + ` WHERE l.book = 15 AND l.doc_pos = 'A' AND l.code = $1 AND l.doc_date >= $2::date AND l.doc_date <= $3::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [Number(entriesOf[1]), entriesOf[2], entriesOf[3]]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), paid_from: String(row.paid_from ?? ""), narration: String(row.narration ?? ""), amount: num(row.amount) }));
    return { id: 0, title: `${found.length > 0 ? String(found[0].name ?? "").trim() : "Expense"}: entries (${out.length})`, columns: [date("d", "Date"), text("doc", "Voucher"), text("paid_from", "Account"), text("narration", "Narration"), money("amount", "Amount")],
      rows: out.length === 0 ? [] : [...out, { d: "", doc: "", paid_from: "", narration: "Total", amount: out.reduce((sum, row) => sum + row.amount, 0) }], note: `${dmy(entriesOf[2])} to ${dmy(entriesOf[3])}: the Expense book entries of this account, with tax.` };
  }
  // A line of the payables to suppliers: the bills falling due in its days.
  const supplierDue = /^supdue:(-?\d+):(-?\d+)$/.exec(detail);
  if (supplierDue) return supplierDueDetail(ctx, Number(supplierDue[1]), Number(supplierDue[2]));
  // A row of the expense questions: that expense account's entries in this month and in the days of last month it is compared with.
  const expenseOf = /^exp:([^:]*):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (expenseOf) {
    const name = decodeURIComponent(expenseOf[1]);
    const windows = [{ label: "This month", from: expenseOf[2], to: expenseOf[3], sch: ctx.sch }, { label: "Last month", from: expenseOf[4], to: expenseOf[5], sch: new Date(`${expenseOf[4]}T00:00:00`) < ctx.session.tarikh1 ? await previousYearSchema(ctx, ctx.session.tarikh1) : ctx.sch }];
    const out: { when: string; d: string; sort: string; doc: string; narration: string; amount: number; code: number }[] = [];
    const totals: { label: string; amount: number }[] = [];
    for (const window of windows) {
      let total = 0;
      if (window.sch) {
        for (const row of await rows(ctx, `SELECT l.doc_date AS d, to_char(l.doc_date, 'YYYY-MM-DD') AS sort, l.full_docno AS doc, btrim(COALESCE(l.narration, '')) AS narration, l.amount::numeric AS amount, l.code FROM ${window.sch}.ledger l JOIN ${window.sch}.account ac ON ac.code = l.code`
          + ` WHERE l.book = 15 AND l.doc_pos = 'A' AND btrim(ac.name) = $1 AND l.doc_date >= $2::date AND l.doc_date <= $3::date ORDER BY l.doc_date, l.led_key LIMIT 500`, [name, window.from, window.to])) {
          out.push({ when: window.label, d: dmy(row.d), sort: String(row.sort), doc: String(row.doc ?? ""), narration: String(row.narration ?? ""), amount: num(row.amount), code: window.sch === ctx.sch ? num(row.code) : 0 });
          total += num(row.amount);
        }
      }
      totals.push({ label: window.label, amount: total });
    }
    out.sort((a, b) => (a.when === b.when ? a.sort.localeCompare(b.sort) : a.when === "This month" ? -1 : 1));
    return {
      id: 0, title: `${name}: entries of this month and last month (${out.length})`, columns: [text("when", "Month"), date("d", "Date"), text("doc", "Voucher"), text("narration", "Narration"), money("amount", "Amount")],
      rows: out.length === 0 ? [] : [...out.map((row) => ({ when: row.when, d: row.d, doc: row.doc, narration: row.narration, amount: row.amount, code: row.code })), ...totals.map((row) => ({ when: `Total ${row.label.toLowerCase()}`, d: "", doc: "", narration: "", amount: row.amount }))],
    };
  }
  // A customer of the working capital answer: its open bills (as the Outstanding Agewise report lays them).
  const billsOf = /^bills:(\d+)$/.exec(detail);
  if (billsOf) {
    const list = (await agewiseBills(ctx)).filter((bill) => bill.code === Number(billsOf[1])).sort((a, b) => b.overdueDays - a.overdueDays);
    return { id: 0, title: `Open bills of ${list[0]?.name ?? "the customer"} (${list.length})`, columns: dueColumns.slice(1),
      rows: list.length === 0 ? [] : [...list, { name: "", doc: "Total", billDate: "", due: "", pending: list.reduce((sum, bill) => sum + bill.pending, 0), overdueDays: "" as unknown as number }] };
  }
  // A product of the working capital answer: its latest stock movements.
  const productOf = /^prod:(\d+)$/.exec(detail);
  if (productOf) {
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, btrim(COALESCE(bp.book_desc, 'Book ' || pl.book::text)) AS book_name, CASE WHEN pl.stock_nat = 'A' THEN 'In' ELSE 'Out' END AS direction, pl.quantity::numeric AS qty, pl.il_value::numeric AS value, l.code`
      + ` FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code LEFT JOIN ${ctx.sch}.book_properties bp ON bp.book_key = pl.book`
      + ` WHERE pl.prod_id = $1 AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date <= $2::date ORDER BY l.doc_date DESC, pl.il_key DESC LIMIT 50`, [Number(productOf[1]), ctx.today]);
    return { id: 0, title: `Latest stock movements (${found.length})`, columns: [date("d", "Date"), text("doc", "Voucher"), text("party", "Party"), text("book_name", "Book"), text("direction", "In / Out"), qty("qty", "Quantity"), money("value", "Value")],
      rows: found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), book_name: String(row.book_name), direction: String(row.direction), qty: num(row.qty), value: num(row.value), code: num(row.code) })) };
  }
  // A row that opens the answer of another question (the concerns): that question's own answer, for the same dates.
  const templateOf = /^tpl:(\d+)$/.exec(detail);
  if (templateOf) {
    const template = T.find((candidate) => candidate.id === Number(templateOf[1]) && !candidate.needsParty && !candidate.needsProduct);
    return template ? await template.run(ctx) : null;
  }
  // A customer of the returns answer: its credit notes against sales, each at the amount the Returns figure counts (before tax), with the goods on it where it has any.
  const returnsOf = /^ret:(\d+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (returnsOf) {
    const found = await rows(ctx,
      `WITH slab AS (SELECT slab_key FROM ${ctx.sch}.slab_master WHERE book = ${SALE} AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key LIMIT 1)`
      + ` SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, CASE WHEN slab.slab_key IS NULL THEN COALESCE(l.amount::numeric, 0) ELSE COALESCE(ext.s_lastot::numeric, 0) - COALESCE(ext.slab_amt::numeric, 0) END AS amt,`
      + ` (SELECT COUNT(*) FROM ${ctx.sch}.prod_ledger pl WHERE pl.led_id = l.led_key AND pl.il_pos = 'A') AS lines,`
      + ` (SELECT string_agg(DISTINCT btrim(pm.prod_desc), ', ') FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id WHERE pl.led_id = l.led_key AND pl.il_pos = 'A') AS goods, btrim(COALESCE(l.narration, '')) AS narration, l.code`
      + ` FROM ${ctx.sch}.ledger l LEFT JOIN slab ON TRUE LEFT JOIN ${ctx.sch}.ledger_ext ext ON ext.led_id = l.led_key AND ext.il_id IS NULL AND ext.slab_id = slab.slab_key LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.code = $1 AND l.book = ${CREDIT_NOTE} AND l.ag_book = ${SALE} AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $2::date AND l.doc_date <= $3::date ORDER BY l.doc_date, l.led_key LIMIT 1000`,
      [Number(returnsOf[1]), returnsOf[2], returnsOf[3]]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), goods: num(row.lines) === 0 ? `(no goods lines) ${String(row.narration ?? "")}`.trim() : String(row.goods ?? ""), lines: num(row.lines), amount: num(row.amt), code: num(row.code) }));
    return { id: 0, title: `Credit notes of ${String(found[0]?.party ?? "the customer")} (${out.length})`, columns: [date("d", "Date"), text("doc", "Credit Note"), text("goods", "Goods / Narration"), int("lines", "Lines"), money("amount", "Amount (before tax)")],
      rows: out.length === 0 ? [] : [...out, { d: "", doc: "", goods: "Total", lines: out.reduce((t, r) => t + r.lines, 0), amount: out.reduce((t, r) => t + r.amount, 0) }] };
  }
  // A GST rate of the taxable sales: the invoices that carry it.
  const rateOf = /^rate:([\d.]+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (rateOf) {
    const tv = await lineTaxable(ctx);
    const found = await rows(ctx,
      `WITH ${gstCte(ctx.sch)} SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, SUM(${GST_SIGN} * ${tv}) AS taxable, SUM(${GST_SIGN} * COALESCE(g.amt, 0)) AS tax, l.code`
      + ` FROM ${gstFrom(ctx.sch)} LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE ${gstWhere} AND COALESCE(g.perc, 0) = $3::numeric GROUP BY l.led_key, l.doc_date, l.full_docno, ac.name, l.code ORDER BY l.doc_date, l.led_key LIMIT 1000`,
      [rateOf[2], rateOf[3], Number(rateOf[1])]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), taxable: num(row.taxable), tax: num(row.tax), code: num(row.code) }));
    return { id: 0, title: `Invoices at ${Number(rateOf[1]) === 0 ? "nil GST" : `${rateOf[1]}% GST`} (${out.length})`, columns: [date("d", "Date"), text("doc", "Invoice"), text("party", "Customer"), money("taxable", "Taxable Value"), money("tax", "GST Amount")],
      rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: "Total", taxable: out.reduce((t, r) => t + r.taxable, 0), tax: out.reduce((t, r) => t + r.tax, 0) }] };
  }
  // An invoice of the tax mismatch list: its lines with the tax charged and the tax at the rate.
  const linesOf = /^gstlines:(\d+)$/.exec(detail);
  if (linesOf) {
    const tv = await lineTaxable(ctx);
    const found = await rows(ctx,
      `WITH ${gstCte(ctx.sch, false)} SELECT btrim(pm.prod_desc) AS product, pl.il_value::numeric AS item, ${tv} AS taxable, COALESCE(g.perc, NULLIF(pm.tax_perc::numeric, 0), 0) AS rate, COALESCE(g.amt, 0) AS tax, (g.il_id IS NULL) AS no_tax_rows`
      + ` FROM ${gstFrom(ctx.sch)} WHERE l.led_key = $1 AND pl.il_pos = 'A' ORDER BY pl.il_serial, pl.il_key`, [Number(linesOf[1])]);
    const out = found.map((row) => ({ product: String(row.product) + (row.no_tax_rows ? " (no tax rows on the line)" : ""), item: num(row.item), discount: num(row.item) - num(row.taxable), taxable: num(row.taxable), rate: num(row.rate), tax: num(row.tax), expected: (num(row.taxable) * num(row.rate)) / 100, diff: num(row.tax) - (num(row.taxable) * num(row.rate)) / 100 }));
    return { id: 0, title: `Lines of the invoice (${out.length})`, columns: [text("product", "Product"), money("item", "Item Value"), money("discount", "Less: Discounts"), money("taxable", "Taxable Value"), money("rate", "GST %"), money("tax", "Tax Charged"), money("expected", "Tax at the Rate"), money("diff", "Difference")],
      rows: out.length === 0 ? [] : [...out, { product: "Total", item: out.reduce((t, r) => t + r.item, 0), discount: out.reduce((t, r) => t + r.discount, 0), taxable: out.reduce((t, r) => t + r.taxable, 0), rate: "" as unknown as number, tax: out.reduce((t, r) => t + r.tax, 0), expected: out.reduce((t, r) => t + r.expected, 0), diff: out.reduce((t, r) => t + r.diff, 0) }] };
  }
  const sectionOf = /^gstrsec:([^:]*):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (sectionOf) return gstrSection(ctx, decodeURIComponent(sectionOf[1]), sectionOf[2], sectionOf[3]);
  const registerOf = /^gstrreg:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (registerOf) {
    const summary = await formSummarySale(ctx, registerOf[1], registerOf[2]);
    return "output" in summary ? outputAnswer(summary.output, "Form Summary, register SALE, Summary For Period Selected") : registerMonths(ctx, registerOf[1], registerOf[2]);
  }
  const differenceOf = /^gstrdiff:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (differenceOf) return gstrDifference(ctx, differenceOf[1], differenceOf[2]);
  // An invoice of the tax mismatch list: the tax rows of its entry and of its stock lines, as they are stored.
  const taxRowsOf = /^taxrows:(.+)$/.exec(detail);
  if (taxRowsOf) {
    const found = await rows(ctx,
      `SELECT COALESCE(btrim(pm.prod_desc), '(whole entry)') AS product, btrim(COALESCE(e.tax_desc, sm.slab_repohd, '')) AS tax, b.slab_perc::numeric AS perc, b.slab_amt::numeric AS amt, b.s_lastot::numeric AS lastot`
      + ` FROM ${ctx.sch}.ledger a JOIN ${ctx.sch}.ledger_ext b ON b.led_id = a.led_key LEFT JOIN ${ctx.sch}.slab_master sm ON sm.slab_key = b.slab_id LEFT JOIN ${ctx.sch}.tax_master e ON e.tax_rec = b.tax_id`
      + ` LEFT JOIN ${ctx.sch}.prod_ledger pl ON pl.il_key = b.il_id LEFT JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id WHERE btrim(a.full_docno) = $1 AND a.doc_pos <> 'D' AND b.tax_id > 0 ORDER BY pl.il_serial, b.il_id, b.slab_id LIMIT 500`, [decodeURIComponent(taxRowsOf[1]).trim()]);
    return { id: 0, title: `Tax lines of ${decodeURIComponent(taxRowsOf[1])} (${found.length})`, columns: [text("product", "Stock Line"), text("tax", "Tax"), money("perc", "Rate %"), money("amt", "Tax Amount"), money("lastot", "Total After This Tax")],
      rows: found.map((row) => ({ product: String(row.product), tax: String(row.tax), perc: num(row.perc), amt: num(row.amt), lastot: num(row.lastot) })) };
  }
  if (detail === "purchase-bills") {
    const codes = (await namedParties(ctx)).map((party) => party.code);
    const found = await rows(ctx, `SELECT l.code, l.doc_date AS d, l.full_docno AS doc, btrim(ac.name) AS party, l.amount::numeric AS amount FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = ${PURCHASE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date${codes.length > 0 ? " AND l.code = ANY($3::int[])" : ""} ORDER BY l.doc_date, l.led_key LIMIT 1000`, codes.length > 0 ? [from, to, codes] : [from, to]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount), code: num(row.code) }));
    return { id: 0, title: `Purchase bills (${out.length})`, columns: [date("d", "Date"), text("doc", "Bill"), text("party", "Supplier"), money("amount", "Amount")], rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: "Total", amount: out.reduce((t, r) => t + r.amount, 0) }], note: `${label}: the Purchase book, with tax. Double-click a row to open the supplier's ledger.` };
  }
  if (detail === "received" || detail === "paid" || detail === "expenses") {
    const book = detail === "expenses" ? "l.book = 15" : "l.book IN (4, 6)";
    const side = detail === "received" ? " AND l.ac_dbcode = 2" : detail === "paid" ? " AND l.ac_dbcode = 1" : "";
    const found = await rows(ctx, `SELECT l.code, l.doc_date AS d, l.full_docno AS doc, btrim(ac.name) AS party, l.amount::numeric AS amount FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE ${book}${side} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [from, to]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount), code: num(row.code) }));
    const title = detail === "received" ? "Money received" : detail === "paid" ? "Money paid" : "Expenses";
    return { id: 0, title: `${title} (${out.length})`, columns: [date("d", "Date"), text("doc", "Document"), text("party", "Party"), money("amount", "Amount")], rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: "Total", amount: out.reduce((t, r) => t + r.amount, 0) }], note: `${label}. The first 1000 entries are shown.` };
  }
  return null;
}

const T: Template[] = [];

T.push({
  id: 1, question: "What is my total outstanding receivable?", defaultPeriod: "none",
  terms: [/outstanding|receivable|to receive|customers? owe|due from/], not: [/top|highest|biggest|largest|overdue|over due|supplier|payable|\bi owe\b|bill|party|ledger|credit balance|opening|closing/],
  run: (ctx) => totalOutstanding(ctx, 2, 1, "Total outstanding receivable", "Customers owe", "Less: customers in credit", "Net receivable"),
});

T.push({
  id: 4, question: "How much do I owe to suppliers?", defaultPeriod: "none",
  terms: [/\bowe\b|payable|payables|due to suppliers/], not: [/customers? owe/],
  run: (ctx) => totalOutstanding(ctx, 3, 4, "Amount owed to suppliers", "Owed to suppliers", "Less: suppliers in debit", "Net payable"),
});

T.push({
  id: 3, question: "Show my top 10 outstanding customers.", defaultPeriod: "none",
  terms: [/top|highest|biggest|largest/, /outstanding|receivable|owe/], not: [/supplier|payable/],
  run: async (ctx) => {
    const top = (await balances(ctx, 2)).filter((row) => row.closing > 0).sort((a, b) => b.closing - a.closing).slice(0, ctx.top);
    return { id: 3, title: `Top ${ctx.top} outstanding customers`, columns: [int("no", "No."), text("name", "Customer"), money("net", "Outstanding")], rows: top.map((row, at) => ({ no: at + 1, name: row.name, net: row.closing, code: row.code })), note: `Party balances up to ${dmy(ctx.today)}, as the Outstanding Agewise report takes them.` };
  },
});

/**
 * The bills still to be paid, as the Outstanding Agewise report lays them (sale book, customers): a party's balance is spread over its open
 * bills, the newest first; a bill the balance does not reach is left out, and one it reaches in part shows what is left of it. What is left
 * after the oldest bill is one "Opening" row, dated the start of the year. A party in credit has none. Each bill is due its date plus the
 * account's credit days; it is overdue the days since then.
 */
type Bill = Readonly<{ code: number; name: string; doc: string; billDate: string; due: string; pending: number; overdueDays: number; billIso: string; dueIso: string; credit: number }>;

async function agewiseBills(ctx: Ctx, book: 2 | 3 = 2): Promise<Bill[]> {
  const open = await rows(ctx,
    `SELECT ac.code, btrim(ac.name) AS name, COALESCE(ac.credit_days, 0)::int AS credit_days, o.out_key, o.out_fulldocno AS doc, led.doc_date AS bill_date, led.doc_no, to_char(led.doc_date, 'YYYYMMDD') AS sortdate,`
    + ` (o.out_entryamt::numeric - COALESCE(s.setoff, 0) - o.out_ly_setoff::numeric) AS pending`
    + ` FROM ${ctx.sch}.outclear o JOIN ${ctx.sch}.account ac ON ac.code = o.code JOIN ${ctx.sch}.ledger led ON led.led_key = o.out_ledid`
    + ` LEFT JOIN (SELECT out_ag_outid, SUM(out_setoff::numeric) AS setoff FROM ${ctx.sch}.outclear WHERE out_date <= $1::date GROUP BY out_ag_outid) s ON s.out_ag_outid = o.out_key`
    + ` WHERE o.out_dbcode = ${book === 2 ? 1 : 2} AND ac.book = ${book} AND ac.os_flag <> 'N' AND ac.a_pos <> 'D' AND led.doc_pos <> 'D' AND led.doc_date <= $1::date`
    + ` AND ((led.doc_posting = 'L' AND o.out_entryamt::numeric - o.out_ly_setoff::numeric <> 0) OR led.doc_posting <> 'L')`
    + ` AND (o.out_entryamt::numeric - COALESCE(s.setoff, 0) - o.out_ly_setoff::numeric) > 0`, [ctx.today]);
  const byParty = new Map<number, Record<string, unknown>[]>();
  for (const row of open) { const code = num(row.code); (byParty.get(code) ?? byParty.set(code, []).get(code)!).push(row); }
  const bal = new Map((await balances(ctx, book, [...byParty.keys()])).map((row) => [row.code, row]));
  const today = new Date(`${ctx.today}T00:00:00`).getTime();
  const yearStart = new Date(ctx.session.tarikh1.getFullYear(), ctx.session.tarikh1.getMonth(), ctx.session.tarikh1.getDate());
  const out: Bill[] = [];
  for (const [code, list] of byParty) {
    const party = bal.get(code);
    if (!party) continue;
    let left = owed(book, party);
    if (left <= 0) continue;
    const credit = num(list[0].credit_days);
    const dueOf = (when: Date) => { const due = new Date(when.getFullYear(), when.getMonth(), when.getDate() + credit); return { due, days: Math.round((today - due.getTime()) / 86400000) }; };
    const digits = (value: unknown) => Number(String(value ?? "").replace(/\D/g, "")) || 0;
    const newestFirst = list.slice().sort((a, b) => String(b.sortdate).localeCompare(String(a.sortdate)) || digits(b.doc_no) - digits(a.doc_no));
    for (const bill of newestFirst) {
      const take = Math.min(left, num(bill.pending));
      if (take <= 0) continue;
      const when = bill.bill_date instanceof Date ? bill.bill_date : new Date(String(bill.bill_date));
      const { due, days } = dueOf(when);
      out.push({ code, name: party.name, doc: String(bill.doc ?? ""), billDate: dmy(when), due: dmy(due), pending: Math.round(take * 100) / 100, overdueDays: days, billIso: iso(when), dueIso: iso(due), credit });
      left = Math.round((left - take) * 100) / 100;
    }
    if (left > 0) { const { due, days } = dueOf(yearStart); out.push({ code, name: party.name, doc: "Opening", billDate: dmy(yearStart), due: dmy(due), pending: left, overdueDays: days, billIso: iso(yearStart), dueIso: iso(due), credit }); }
  }
  return out;
}

const AGEWISE_NOTE = "Bills as the Outstanding Agewise report lays them (a party's balance spread over its newest bills first; the rest as Opening), due on the bill date plus the account's credit days.";
const dueColumns = [text("name", "Customer"), text("doc", "Bill"), date("billDate", "Bill Date"), date("due", "Due Date"), money("pending", "Pending"), int("overdueDays", "Days Overdue")];
const grouping = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grandTotal = (list: readonly Bill[]) => grouping.format(list.reduce((sum, bill) => sum + bill.pending, 0));

T.push({
  id: 7, question: "Which bills are overdue by more than 90 days?", defaultPeriod: "none",
  terms: [/overdue|over due|past due/, /\d+\s*days?|more than/], not: [/between/],
  run: async (ctx) => {
    const list = (await agewiseBills(ctx)).filter((bill) => bill.overdueDays > ctx.days).sort((a, b) => b.overdueDays - a.overdueDays || a.name.localeCompare(b.name));
    return {
      id: 7, title: `Bills overdue by more than ${ctx.days} days`, columns: dueColumns, rows: list.slice(0, 500),
      note: `${list.length} bills, ${grandTotal(list)} pending. Bills as the Outstanding Agewise report lays them (a party's balance spread over its newest bills first; the rest as Opening), due on the bill date plus the account's credit days; as on ${dmy(ctx.today)}.${list.length > 500 ? " The first 500 are shown." : ""}`,
    };
  },
});

T.push({
  id: 2, question: "Which customers have overdue payments?", defaultPeriod: "none",
  terms: [/overdue|over due|past due/],
  run: async (ctx) => {
    const byParty = new Map<number, { code: number; name: string; bills: number; pending: number; days: number }>();
    for (const bill of await agewiseBills(ctx)) {
      if (bill.overdueDays <= 0) continue;
      const entry = byParty.get(bill.code) ?? byParty.set(bill.code, { code: bill.code, name: bill.name, bills: 0, pending: 0, days: 0 }).get(bill.code)!;
      entry.bills += 1; entry.pending += bill.pending; entry.days = Math.max(entry.days, bill.overdueDays);
    }
    const list = [...byParty.values()].sort((a, b) => b.pending - a.pending);
    return {
      id: 2, title: "Customers with overdue payments", columns: [text("name", "Customer"), int("bills", "Bills"), money("pending", "Overdue Amount"), int("days", "Max Days Overdue")],
      rows: list.slice(0, 500).map((row) => ({ name: row.name, bills: row.bills, pending: Math.round(row.pending * 100) / 100, days: row.days, code: row.code })),
      note: `Bills as the Outstanding Agewise report lays them, due on the bill date plus the account's credit days, past due on ${dmy(ctx.today)}.${list.length > 500 ? " The first 500 are shown." : ""}`,
    };
  },
});

T.push({
  id: 9, question: "Which customers have credit balances?", defaultPeriod: "none",
  terms: [/credit balance|advance/, /customer|party|parties|which/],
  run: async (ctx) => {
    const list = (await balances(ctx, 2)).filter((row) => row.closing < 0).sort((a, b) => a.closing - b.closing);
    return { id: 9, title: "Customers with credit balances", columns: [text("name", "Customer"), money("credit", "Credit Balance")], rows: list.slice(0, 500).map((row) => ({ name: row.name, credit: -row.closing, code: row.code })), note: `Party balances up to ${dmy(ctx.today)}.` };
  },
});

/** Every customer and supplier with a balance: the year's opening, the debits and credits up to today and the closing, each on its Dr / Cr side, with the totals. */
async function trialBalance(ctx: Ctx, id: number): Promise<AskAnswer> {
  const found = await rows(ctx,
    `WITH mv AS (SELECT l.code, SUM(CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE 0 END) AS debit, SUM(CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric ELSE 0 END) AS credit`
    + ` FROM ${ctx.sch}.ledger l WHERE l.doc_pos <> 'D' AND l.doc_date <= $1::date AND l.doc_posting = 'P' AND l.book_code IN (SELECT code FROM ${ctx.sch}.account WHERE a_pos <> 'D') GROUP BY l.code)`
    + ` SELECT ac.code, btrim(ac.name) AS name, COALESCE(MAX(ab.opening::numeric), 0) AS opening, COALESCE(mv.debit, 0) AS debit, COALESCE(mv.credit, 0) AS credit`
    + ` FROM ${ctx.sch}.account ac LEFT JOIN ${ctx.sch}.ac_balance ab ON ab.code = ac.code AND ab.year_id = $2 LEFT JOIN mv ON mv.code = ac.code WHERE ac.a_pos <> 'D' AND ac.book IN (2, 3) GROUP BY ac.code, ac.name, mv.debit, mv.credit ORDER BY btrim(ac.name)`,
    [ctx.today, ctx.session.yearId]);
  const dr = (value: number) => (value > 0 ? value : 0);
  const cr = (value: number) => (value < 0 ? -value : 0);
  const lines = found.map((row) => {
    const opening = num(row.opening); const debit = num(row.debit); const credit = num(row.credit);
    const closing = Math.round((opening + debit - credit) * 100) / 100;
    return { code: num(row.code), name: String(row.name), openDr: dr(opening), openCr: cr(opening), debit, credit, closeDr: dr(closing), closeCr: cr(closing) };
  }).filter((line) => line.openDr !== 0 || line.openCr !== 0 || line.debit !== 0 || line.credit !== 0);
  const sum = (key: "openDr" | "openCr" | "debit" | "credit" | "closeDr" | "closeCr") => Math.round(lines.reduce((total, line) => total + line[key], 0) * 100) / 100;
  const shown = lines.slice(0, 3000);
  return {
    id, title: "Trial balance of all parties (customers and suppliers)",
    columns: [text("name", "Party"), money("openDr", "Opening Dr"), money("openCr", "Opening Cr"), money("debit", "Debit"), money("credit", "Credit"), money("closeDr", "Closing Dr"), money("closeCr", "Closing Cr")],
    rows: [...shown, { name: `Total (${lines.length} accounts)`, openDr: sum("openDr"), openCr: sum("openCr"), debit: sum("debit"), credit: sum("credit"), closeDr: sum("closeDr"), closeCr: sum("closeCr") }],
    note: `The year's opening plus the entries up to ${dmy(ctx.today)}, as the Outstanding Agewise report takes balances.${lines.length > 3000 ? " The first 3000 accounts are shown; the total covers all." : ""}`,
  };
}

async function partyBalance(ctx: Ctx, id: number, title: string): Promise<AskAnswer> {
  const party = ctx.party as Party;
  const found = (await rows(ctx, `SELECT book FROM ${ctx.sch}.account WHERE code = $1`, [party.code]))[0];
  const balance = (await balances(ctx, num(found?.book), [party.code]))[0] ?? { code: party.code, name: party.name, creditDays: 0, opening: 0, debit: 0, credit: 0, closing: 0 };
  const side = (value: number) => (value >= 0 ? "Dr" : "Cr");
  const lines: { item: string; amount: number }[] = [{ item: `Opening balance (${side(balance.opening)})`, amount: Math.abs(balance.opening) }];
  if (id === 10) lines.push({ item: "Debits", amount: balance.debit }, { item: "Credits", amount: balance.credit });
  lines.push({ item: `Closing balance (${side(balance.closing)})`, amount: Math.abs(balance.closing) });
  return {
    id, title: `${title}: ${party.name}`, columns: [text("item", "Item"), money("amount", "Amount")], rows: lines,
    note: `The year's opening plus the entries up to ${dmy(ctx.today)}, as the Outstanding Agewise report takes it. The ledger report lists every entry.`, ledger: party,
  };
}

T.push({ id: 6, question: "What is the closing balance of a party?", defaultPeriod: "none", needsParty: true, runAll: (ctx) => trialBalance(ctx, 6), terms: [/closing/, /balance/], not: [/opening/], run: (ctx) => partyBalance(ctx, 6, "Closing balance") });
T.push({ id: 10, question: "Show the party's opening and closing balances.", defaultPeriod: "none", needsParty: true, runAll: (ctx) => trialBalance(ctx, 10), terms: [/opening/, /closing/], run: (ctx) => partyBalance(ctx, 10, "Opening and closing balances") });
T.push({
  id: 5, question: "Show customer ledger for this month.", defaultPeriod: "month", needsParty: true, partyBook: 2, terms: [/ledger|statement/],
  run: async (ctx) => {
    // The ledger itself is the Ledger report (its opening balance, running balance and every entry): the answer names the dates and opens it.
    const party = ctx.party as Party;
    return { id: 5, title: `Ledger of ${party.name}`, columns: [text("item", "Item")], rows: [], note: `${ctx.period.label}. The ledger report shows the opening balance and the running balance.`, ledger: party };
  },
});

T.push({
  id: 8, question: "Show today's receipts and payments.", defaultPeriod: "today", terms: [/receipts?|received/, /payments?|paid/], not: [/overdue|sales?|purchase|expense|salary|cheque|how much|money/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(ac.name) AS party, btrim(bk.name) AS book, CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric ELSE 0 END AS receipt, CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE 0 END AS payment`
      + ` FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code LEFT JOIN ${ctx.sch}.account bk ON bk.code = l.book_code`
      + ` WHERE l.book IN (4, 6) AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.period.from, ctx.period.to]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), book: String(row.book ?? ""), receipt: num(row.receipt), payment: num(row.payment) }));
    return {
      id: 8, title: "Receipts and payments (cash and bank)", columns: [date("d", "Date"), text("doc", "Document"), text("party", "Party"), text("book", "Book"), money("receipt", "Receipt"), money("payment", "Payment")],
      rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: "Total", book: "", receipt: out.reduce((sum, row) => sum + row.receipt, 0), payment: out.reduce((sum, row) => sum + row.payment, 0) }],
      note: `${ctx.period.label}: cash and bank book entries.`,
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Sales and purchase (B)

const SALE = 8, PURCHASE = 13, CREDIT_NOTE = 16;

/**
 * Sales as the company counts them: the posted, active entries of the Sale book, of the debit notes against it (they add) and of the credit
 * notes against it (they take off), each for its amount before tax: the entry's total less the tax slab (the active master slab of the Sale book)
 * from LEDGER_EXT, or the entry's amount when the book has no such slab. Returns the entries counted, the sales and the returns, in all or by customer.
 */
async function netSales(ctx: Ctx, from: string, to: string, byParty: boolean) {
  const found = await rows(ctx,
    `WITH slab AS (SELECT slab_key FROM ${ctx.sch}.slab_master WHERE book = ${SALE} AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key LIMIT 1),`
    + ` inv AS (SELECT l.code, l.full_docno, CASE WHEN l.book = ${SALE} OR (l.book = 11 AND l.ag_book = ${SALE}) THEN 1 ELSE -1 END AS sign,`
    + ` CASE WHEN slab.slab_key IS NULL THEN COALESCE(l.amount::numeric, 0) ELSE COALESCE(ext.s_lastot::numeric, 0) - COALESCE(ext.slab_amt::numeric, 0) END AS amt`
    + ` FROM ${ctx.sch}.ledger l LEFT JOIN slab ON TRUE LEFT JOIN ${ctx.sch}.ledger_ext ext ON ext.led_id = l.led_key AND ext.il_id IS NULL AND ext.slab_id = slab.slab_key`
    + ` WHERE l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND (l.book = ${SALE} OR (l.book = ${CREDIT_NOTE} AND l.ag_book = ${SALE}) OR (l.book = 11 AND l.ag_book = ${SALE})))`
    + (byParty
      ? ` SELECT inv.code, btrim(ac.name) AS name, COUNT(DISTINCT inv.full_docno) AS entries, COALESCE(SUM(inv.amt) FILTER (WHERE inv.sign = 1), 0) AS sales, COALESCE(SUM(inv.amt) FILTER (WHERE inv.sign = -1), 0) AS returns FROM inv JOIN ${ctx.sch}.account ac ON ac.code = inv.code GROUP BY inv.code, ac.name`
      : ` SELECT COUNT(DISTINCT inv.full_docno) AS entries, COALESCE(SUM(inv.amt) FILTER (WHERE inv.sign = 1), 0) AS sales, COALESCE(SUM(inv.amt) FILTER (WHERE inv.sign = -1), 0) AS returns FROM inv`),
    [from, to]);
  return found.map((row) => ({ code: num(row.code), name: String(row.name ?? ""), entries: num(row.entries), sales: num(row.sales), returns: num(row.returns), net: num(row.sales) - num(row.returns) }));
}

/** Net sales (as netSales counts them) of each month of the period, of one party or of the whole company. */
async function netSalesMonthly(ctx: Ctx, from: string, to: string, code?: number) {
  const found = await rows(ctx,
    `WITH slab AS (SELECT slab_key FROM ${ctx.sch}.slab_master WHERE book = ${SALE} AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key LIMIT 1),`
    + ` inv AS (SELECT to_char(l.doc_date, 'YYYY-MM') AS month, l.full_docno, CASE WHEN l.book = ${SALE} OR (l.book = 11 AND l.ag_book = ${SALE}) THEN 1 ELSE -1 END AS sign,`
    + ` CASE WHEN slab.slab_key IS NULL THEN COALESCE(l.amount::numeric, 0) ELSE COALESCE(ext.s_lastot::numeric, 0) - COALESCE(ext.slab_amt::numeric, 0) END AS amt`
    + ` FROM ${ctx.sch}.ledger l LEFT JOIN slab ON TRUE LEFT JOIN ${ctx.sch}.ledger_ext ext ON ext.led_id = l.led_key AND ext.il_id IS NULL AND ext.slab_id = slab.slab_key`
    + ` WHERE l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date${code ? " AND l.code = $3" : ""} AND (l.book = ${SALE} OR (l.book = ${CREDIT_NOTE} AND l.ag_book = ${SALE}) OR (l.book = 11 AND l.ag_book = ${SALE})))`
    + ` SELECT month, COUNT(DISTINCT full_docno) AS entries, COALESCE(SUM(amt) FILTER (WHERE sign = 1), 0) AS sales, COALESCE(SUM(amt) FILTER (WHERE sign = -1), 0) AS returns FROM inv GROUP BY month ORDER BY month`,
    code ? [from, to, code] : [from, to]);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return found.map((row) => {
    const [year, month] = String(row.month).split("-");
    return { month: `${names[Number(month) - 1]}-${year}`, entries: num(row.entries), sales: num(row.sales), returns: num(row.returns), net: num(row.sales) - num(row.returns) };
  });
}

const SALES_NOTE = "Sales before tax, as the company counts them: Sale book entries and debit notes against it, less credit notes (returns) against it.";
const salesColumns = [money("sales", "Sales"), money("returns", "Less: Returns"), money("net", "Net Sales")];

/** The parties a question names besides what it asks (purchase from vstar): none when its words are all about the asking. */
async function namedParties(ctx: Ctx): Promise<Party[]> {
  const question = ctx.question ?? "";
  const asking = new Set(["bill", "bills", "entries", "entry", "much", "many", "how", "what", "are", "my", "details", "detail", "amount", "month", "months", "date"]);
  if (!nameWords(question).some((word) => !NOT_NAME.has(word) && !asking.has(word))) return [];
  return findParties(ctx, question);
}

async function bookTotal(ctx: Ctx, book: number, from: string, to: string, codes?: readonly number[]) {
  const r = (await rows(ctx, `SELECT COUNT(*) AS n, COALESCE(SUM(amount::numeric), 0) AS total FROM ${ctx.sch}.ledger WHERE book = $1 AND doc_pos = 'A' AND doc_date >= $2::date AND doc_date <= $3::date${codes && codes.length > 0 ? " AND code = ANY($4::int[])" : ""}`, codes && codes.length > 0 ? [book, from, to, [...codes]] : [book, from, to]))[0];
  return { n: num(r.n), total: num(r.total) };
}

T.push({
  id: 11, question: "What are today's total sales?", defaultPeriod: "today", terms: [/sales?|sold|selling/, /total|how much|what/], not: [/compar|versus|\bvs\b|invoice|party|customer|product|return|cancel|profit|highest|most/],
  run: async (ctx) => {
    const t = (await netSales(ctx, ctx.period.from, ctx.period.to, false))[0];
    return { id: 11, title: "Total sales", choices: ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This quarter", "Last quarter", "This half year", "Last half year", "This year"].map((label) => ({ label, question: `What are the total sales ${label.toLowerCase()}?` })), columns: [text("item", "Item"), money("value", "Value")], rows: [{ item: "Entries", value: t.entries }, { item: "Sales (before tax)", value: t.sales }, { item: "Less: returns", value: -t.returns }, { item: "Net sales", value: t.net }], note: `${ctx.period.label}. ${SALES_NOTE}` };
  },
});

T.push({
  id: 15, question: "What are my total purchases this month?", defaultPeriod: "month", terms: [/purchase|purchases|bought|buying/], not: [/return|product|supplier|party/],
  run: async (ctx) => {
    // A party named in the question (purchase from vstar) narrows the answer to its bills.
    const named = await namedParties(ctx);
    const t = await bookTotal(ctx, PURCHASE, ctx.period.from, ctx.period.to, named.map((party) => party.code));
    return {
      id: 15, title: named.length > 0 ? `Purchases from ${named.map((party) => party.name).join(", ")}` : "Total purchases", columns: [text("item", "Item"), money("value", "Value")],
      rows: [{ item: "Bills", value: t.n, detail: "purchase-bills" }, { item: "Total purchases", value: t.total, detail: "" }],
      note: `${ctx.period.label}, bill totals (tax included). Click Bills to show them, click again to hide them.`,
    };
  },
});

T.push({
  id: 12, question: "Show monthly sales compared with last month.", defaultPeriod: "none", terms: [/sales?/, /compar|versus|\bvs\b|last month|previous month/], not: [/year|last year|why|reason|cause|decreas|drop|\bfall|\bfell|explain|gstr|gst return/],
  run: async (ctx) => {
    const now = new Date(`${ctx.today}T00:00:00`);
    const thisFrom = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastFrom = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastTo = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    const current = (await netSales(ctx, thisFrom, ctx.today, false))[0];
    const previous = (await netSales(ctx, lastFrom, lastTo, false))[0];
    const change = current.net - previous.net;
    return {
      id: 12, title: "Sales: this month and last month", columns: [text("item", "Month"), int("entries", "Entries"), ...salesColumns],
      rows: [
        { item: `This month (${dmy(thisFrom)} to ${dmy(ctx.today)})`, entries: current.entries, sales: current.sales, returns: -current.returns, net: current.net },
        { item: `Last month (${dmy(lastFrom)} to ${dmy(lastTo)})`, entries: previous.entries, sales: previous.sales, returns: -previous.returns, net: previous.net },
        { item: previous.net === 0 ? "Change" : `Change (${((change / previous.net) * 100).toFixed(1)}%)`, entries: current.entries - previous.entries, sales: current.sales - previous.sales, returns: previous.returns - current.returns, net: change },
      ],
      note: SALES_NOTE,
    };
  },
});

T.push({
  id: 14, question: "Show today's sales invoices.", defaultPeriod: "today", terms: [/sales?|sale/, /invoices?|bills?/], not: [/cancel|return|party|customer|for /],
  run: (ctx) => invoices(ctx, 14, "Sales invoices", "A", false),
});
T.push({
  id: 16, question: "Show cancelled sales invoices.", defaultPeriod: "year", terms: [/cancel|deleted/, /sales?|sale|invoice/],
  run: (ctx) => invoices(ctx, 16, "Cancelled sales invoices", "X", false),
});
T.push({
  id: 17, question: "Find sales invoices for a particular party.", defaultPeriod: "year", needsParty: true, partyBook: 2, terms: [/invoices?|bills?|sales?/], not: [/cancel/],
  run: (ctx) => invoices(ctx, 17, "Sales invoices", "A", true),
});

/**
 * Sales invoices of the Sale book. Cancelled ones (pos "X") are the entries whose account code is empty or 0 but still A (active); entries
 * marked D are deleted ones and are listed with them, each with its status.
 */
async function invoices(ctx: Ctx, id: number, title: string, pos: "A" | "X", withParty: boolean): Promise<AskAnswer> {
  const cancelled = pos === "X";
  const found = await rows(ctx,
    `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, l.amount::numeric AS amount, CASE WHEN l.doc_pos = 'D' THEN 'Deleted' ELSE 'Cancelled' END AS status`
    + ` FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE l.book = ${SALE} AND `
    + (cancelled ? "l.doc_pos = 'A' AND COALESCE(l.code, 0) = 0" : "l.doc_pos = 'A'")
    + ` AND l.doc_date >= $1::date AND l.doc_date <= $2::date${withParty ? " AND l.code = $3" : ""} ORDER BY l.doc_date, l.led_key LIMIT 1000`,
    withParty ? [ctx.period.from, ctx.period.to, (ctx.party as Party).code] : [ctx.period.from, ctx.period.to]);
  const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount), status: String(row.status) }));
  const columns = [date("d", "Date"), text("doc", "Invoice"), text("party", "Party"), money("amount", "Amount"), ...(cancelled ? [text("status", "Status")] : [])];
  return {
    id, title: withParty ? `${title}: ${(ctx.party as Party).name}` : title, columns,
    rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: `Total (${out.length})`, amount: out.reduce((sum, row) => sum + row.amount, 0), status: "" }],
    note: cancelled ? `${ctx.period.label}: invoices cancelled (account code empty or 0 while still active) and deleted ones.` : ctx.period.label,
  };
}

T.push({
  id: 18, question: "Show sales returns for this financial year.", defaultPeriod: "year", terms: [/return/, /sales?|sale/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(ac.name) AS party, l.amount::numeric AS amount FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = ${CREDIT_NOTE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.period.from, ctx.period.to]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount) }));
    return { id: 18, title: "Sales returns (credit notes)", columns: [date("d", "Date"), text("doc", "Document"), text("party", "Party"), money("amount", "Amount")], rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: `Total (${out.length})`, amount: out.reduce((sum, row) => sum + row.amount, 0) }], note: `${ctx.period.label}: the Credit Note book.` };
  },
});

T.push({
  id: 13, question: "Which customer purchased the most this year?", defaultPeriod: "year", terms: [/customers?|party|parties/, /most|top|highest|biggest|largest|best/, /purchas|bought|sale|sales|buy|revenue/], not: [/revenue|contribut|share|profit|outstanding|overdue|supplier|vendor|purchase\s+part(y|ies)/],
  run: async (ctx) => {
    const list = (await netSales(ctx, ctx.period.from, ctx.period.to, true)).sort((x, y) => y.net - x.net).slice(0, Math.max(ctx.top, 10));
    return { id: 13, title: "Customers by purchases", columns: [int("no", "No."), text("name", "Customer"), int("entries", "Entries"), ...salesColumns], rows: list.map((row, at) => ({ no: at + 1, name: row.name, entries: row.entries, sales: row.sales, returns: -row.returns, net: row.net, code: row.code })), note: `${ctx.period.label}. ${SALES_NOTE}` };
  },
});

T.push({
  id: 62, question: "Show my top 10 suppliers by purchases.", defaultPeriod: "year",
  terms: [/suppliers?|vendors?|purchase[ds]?\s+part(y|ies)|part(y|ies)\s+(of\s+)?purchase/, /top|highest|biggest|largest|most|best/], not: [/outstanding|overdue|owe|payable|product|item/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT l.code, btrim(ac.name) AS name, COUNT(*) AS entries, SUM(l.amount::numeric) AS amount FROM ${ctx.sch}.ledger l JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = ${PURCHASE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY l.code, ac.name ORDER BY amount DESC`, [ctx.period.from, ctx.period.to]);
    const grand = found.reduce((total, row) => total + num(row.amount), 0);
    const list = found.slice(0, ctx.top).map((row, at) => ({ no: at + 1, name: String(row.name), entries: num(row.entries), amount: num(row.amount), share: grand === 0 ? 0 : (num(row.amount) / grand) * 100, code: num(row.code) }));
    return {
      id: 62, title: `Top ${ctx.top} suppliers by purchases`, columns: [int("no", "No."), text("name", "Supplier"), int("entries", "Entries"), money("amount", "Purchases"), money("share", "Share %")],
      rows: list.length === 0 ? [] : [...list, { no: "", name: `Total of all ${found.length} suppliers`, entries: found.reduce((total, row) => total + num(row.entries), 0), amount: grand, share: 100 }],
      note: `${ctx.period.label}: the Purchase book, with tax. Double-click a row to open the ledger of that supplier.`,
    };
  },
});

T.push({
  id: 19, question: "Which products have the highest sales?", defaultPeriod: "year", terms: [/products?|items?/, /sales?|sold|selling|highest|top|best/], not: [/stock|negative|minimum|zero|slow|fast|godown|purchase|no sales?|not sold|unsold|without sales?|moving|profit|loss|margin|cost|return/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT btrim(pm.prod_desc) AS name, SUM(pl.quantity::numeric) AS qty, SUM(pl.il_value::numeric) AS value FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id WHERE pl.book = ${SALE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date`
      + ` GROUP BY pm.prod_key, pm.prod_desc ORDER BY value DESC LIMIT $3`, [ctx.period.from, ctx.period.to, ctx.top]);
    return { id: 19, title: `Top ${ctx.top} products by sales`, columns: [int("no", "No."), text("name", "Product"), money("qty", "Quantity"), money("value", "Sales Value")], rows: found.map((row, at) => ({ no: at + 1, name: String(row.name), qty: num(row.qty), value: num(row.value) })), note: `${ctx.period.label}; line values before tax.` };
  },
});

/**
 * The cost of one piece of every product that has a bill of material (MFG-BOM voucher), as the Finish Product Costing report works it out: the latest
 * BOM of the product, its materials' quantities over the BOM's own quantity, each at the BOM's rate, else the latest purchase rate of the year, else the
 * opening rate, else the report rate; a material that has a BOM of its own (semi finished) is costed from that, at most ten levels deep.
 */
async function bomCosts(ctx: Ctx): Promise<Map<number, number>> {
  const found = await rows(ctx, `SELECT full_docno AS doc, prod_id, stock_nat AS nature, quantity::numeric AS qty, rate::numeric AS rate, il_date FROM ${ctx.sch}.prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D'`);
  const latest = new Map<number, { doc: string; qty: number; date: number }>();
  const lines = new Map<string, { prod: number; qty: number; rate: number }[]>();
  for (const row of found) {
    if (String(row.nature) === "A") {
      const header = { doc: String(row.doc), qty: num(row.qty), date: row.il_date instanceof Date ? row.il_date.getTime() : 0 };
      const current = latest.get(num(row.prod_id));
      if (!current || header.date > current.date || (header.date === current.date && header.doc > current.doc)) latest.set(num(row.prod_id), header);
    } else if (String(row.nature) === "L") {
      lines.set(String(row.doc), [...(lines.get(String(row.doc)) ?? []), { prod: num(row.prod_id), qty: num(row.qty), rate: num(row.rate) }]);
    }
  }
  if (latest.size === 0) return new Map();
  const purchase = new Map((await rows(ctx, `SELECT DISTINCT ON (prod_id) prod_id, rate::numeric AS rate FROM ${ctx.sch}.prod_ledger WHERE il_pos = 'A' AND il_date BETWEEN $1::date AND $2::date AND book = ${PURCHASE} AND led_id IS NOT NULL ORDER BY prod_id, il_date DESC`, [iso(ctx.session.tarikh1), ctx.period.to])).map((row) => [num(row.prod_id), num(row.rate)] as const));
  const balance = new Map((await rows(ctx, `SELECT DISTINCT ON (prod_id) prod_id, open_rate::numeric AS open_rate, rep_rate::numeric AS rep_rate FROM ${ctx.sch}.prod_balance WHERE prec_flag = 'RP' ORDER BY prod_id`)).map((row) => [num(row.prod_id), row] as const));
  const memo = new Map<number, number>();
  const unitCost = (prod: number, depth: number, path: Set<number>): number => {
    const header = latest.get(prod);
    if (header && header.qty > 0 && depth < 10 && !path.has(prod)) {
      const known = memo.get(prod);
      if (known !== undefined) return known;
      const next = new Set(path).add(prod);
      let total = 0;
      for (const line of lines.get(header.doc) ?? []) {
        const rate = line.rate !== 0 ? line.rate : latest.has(line.prod) ? unitCost(line.prod, depth + 1, next) : materialRate(line.prod);
        total += line.qty * rate;
      }
      const each = total / header.qty;
      if (depth === 0) memo.set(prod, each);
      return each;
    }
    return materialRate(prod);
  };
  const materialRate = (prod: number) => purchase.get(prod) || num(balance.get(prod)?.open_rate) || num(balance.get(prod)?.rep_rate) || 0;
  return new Map([...latest.keys()].map((prod) => [prod, unitCost(prod, 0, new Set())] as const));
}

T.push({
  id: 20, question: "Show profit earned from each customer.", defaultPeriod: "year", terms: [/profit|margin/, /customer|party|each/],
  run: async (ctx) => {
    // Net sales are the company's sales (before tax, less returns); the cost is the net quantity sold times each product's average cost: the year's
    // opening stock at its opening rate together with the year's purchases up to today, value over quantity. A product with neither has no cost.
    const sales = await netSales(ctx, ctx.period.from, ctx.period.to, true);
    const costs = await rows(ctx,
      `WITH pur AS (SELECT pl.prod_id, SUM(pl.il_value::numeric) AS v, SUM(pl.quantity::numeric) AS q FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book = ${PURCHASE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $3::date AND l.doc_date <= $2::date GROUP BY pl.prod_id),`
      + ` opn AS (SELECT prod_id, SUM(open_qty1::numeric) AS q, MAX(open_rate::numeric) AS r FROM ${ctx.sch}.prod_balance WHERE year_id = $4 GROUP BY prod_id),`
      + ` avgc AS (SELECT COALESCE(opn.prod_id, pur.prod_id) AS prod_id, NULLIF(CASE WHEN COALESCE(opn.q, 0) + COALESCE(pur.q, 0) > 0`
      + ` THEN (COALESCE(opn.q, 0) * COALESCE(opn.r, 0) + COALESCE(pur.v, 0)) / (COALESCE(opn.q, 0) + COALESCE(pur.q, 0)) ELSE COALESCE(opn.r, 0) END, 0) AS cost FROM opn FULL JOIN pur ON pur.prod_id = opn.prod_id)`
      + ` SELECT l.code, pl.prod_id, SUM(CASE WHEN pl.book = ${SALE} THEN pl.quantity::numeric ELSE -pl.quantity::numeric END) AS qty, MAX(avgc.cost) AS cost, COUNT(*) AS lines`
      + ` FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id LEFT JOIN avgc ON avgc.prod_id = pl.prod_id`
      + ` WHERE pl.book IN (${SALE}, ${CREDIT_NOTE}) AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY l.code, pl.prod_id`,
      [ctx.period.from, ctx.period.to, iso(ctx.session.tarikh1), ctx.session.yearId]);
    // A product made in the factory (it has a bill of material, MFG-BOM) is costed as the Finish Product Costing report does: the materials of its
    // latest BOM, each at the BOM's rate, else the latest purchase rate of the year, else the opening rate, else the report rate; a semi finished
    // material is costed from its own latest BOM, in turn. Anything without a BOM (trading) keeps the average cost above.
    const boms = await bomCosts(ctx);
    const costOf = new Map<number, { cost: number; nocost: number }>();
    for (const row of costs) {
      const made = boms.get(num(row.prod_id));
      const unit = made !== undefined && made > 0 ? made : num(row.cost);
      const entry = costOf.get(num(row.code)) ?? { cost: 0, nocost: 0 };
      entry.cost += num(row.qty) * unit;
      if (unit === 0) entry.nocost += num(row.lines);
      costOf.set(num(row.code), entry);
    }
    const list = sales.map((row) => { const c = costOf.get(row.code) ?? { cost: 0, nocost: 0 }; return { ...row, cost: c.cost, nocost: c.nocost, profit: row.net - c.cost }; }).filter((row) => row.sales !== 0 || row.returns !== 0).sort((x, y) => y.profit - x.profit).slice(0, 500);
    return {
      id: 20, title: "Profit by customer", columns: [text("name", "Customer"), ...salesColumns, money("cost", "Average Cost"), money("profit", "Profit"), money("margin", "Margin %"), int("nocost", "Lines Without Cost")],
      rows: list.map((row) => ({ code: row.code, name: row.name, sales: row.sales, returns: -row.returns, net: row.net, cost: row.cost, profit: row.profit, margin: row.net === 0 ? 0 : (row.profit / row.net) * 100, nocost: row.nocost })),
      note: `${ctx.period.label}. ${SALES_NOTE} Profit is Net Sales less the net quantity times the product's cost: for a product made in the factory its bill of material costed as in the Finish Product Costing report, else the average cost (opening stock at its opening rate with the year's purchases up to today); a product with neither counts at 0 cost (Lines Without Cost). The first 500, by profit, are shown.`,
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Inventory and stock (D)
//
// A product's stock is its PROD_BALANCE row of the year: the opening, what was added and taken, and the closing (all in the product's first
// unit, which the running entries keep up to date). Valuation takes each product's average cost: the year's opening stock at its opening rate
// together with the year's purchases up to today, value over quantity.

/**
 * A product's stock quantity in its report unit: the PROD_BALANCE column of the unit that is the product's REP1_UOM (pieces, quantity 1, 2 or
 * 3, pack or weight), pieces when it matches none. `part` is the column's prefix: open, add, less or clsg.
 */
const uomQty = (part: string) => `CASE WHEN pm.rep1_uom = pm.pcs_uom THEN pb.${part}_pcs::numeric WHEN pm.rep1_uom = pm.qty1_uom THEN pb.${part}_qty1::numeric WHEN pm.rep1_uom = pm.qty2_uom THEN pb.${part}_qty2::numeric`
  + ` WHEN pm.rep1_uom = pm.qty3_uom THEN pb.${part}_qty3::numeric WHEN pm.rep1_uom = pm.pack_uom THEN pb.${part}_pack::numeric WHEN pm.rep1_uom = pm.weight_uom THEN pb.${part}_weight::numeric ELSE pb.${part}_pcs::numeric END`;

/** The year's stock of each product (one row each, in its report unit): opening, added, less, closing. */
const STOCK_CTE = (sch: string, yearParam: string) => `stk AS (SELECT pb.prod_id, SUM(${uomQty("open")}) AS oq, SUM(${uomQty("add")}) AS aq, SUM(${uomQty("less")}) AS lq, SUM(${uomQty("clsg")}) AS cq`
  + ` FROM ${sch}.prod_balance pb JOIN ${sch}.product_master pm ON pm.prod_key = pb.prod_id WHERE pb.year_id = ${yearParam} GROUP BY pb.prod_id)`;

/** Average cost of each product (see above); a product with neither opening rate nor purchase has none. */
const COST_CTES = (sch: string, fromParam: string, toParam: string, yearParam: string) =>
  `pur AS (SELECT pl.prod_id, SUM(pl.il_value::numeric) AS v, SUM(pl.quantity::numeric) AS q FROM ${sch}.prod_ledger pl JOIN ${sch}.ledger l ON l.led_key = pl.led_id`
  + ` WHERE pl.book = ${PURCHASE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= ${fromParam}::date AND l.doc_date <= ${toParam}::date GROUP BY pl.prod_id),`
  + ` opn AS (SELECT prod_id, SUM(open_qty1::numeric) AS q, MAX(open_rate::numeric) AS r FROM ${sch}.prod_balance WHERE year_id = ${yearParam} GROUP BY prod_id),`
  + ` avgc AS (SELECT COALESCE(opn.prod_id, pur.prod_id) AS prod_id, NULLIF(CASE WHEN COALESCE(opn.q, 0) + COALESCE(pur.q, 0) > 0`
  + ` THEN (COALESCE(opn.q, 0) * COALESCE(opn.r, 0) + COALESCE(pur.v, 0)) / (COALESCE(opn.q, 0) + COALESCE(pur.q, 0)) ELSE COALESCE(opn.r, 0) END, 0) AS cost FROM opn FULL JOIN pur ON pur.prod_id = opn.prod_id)`;

const qty = (key: string, caption: string): AskColumn => ({ key, caption, kind: "money" });

T.push({
  id: 31, question: "What is the current stock of a product?", defaultPeriod: "none", needsProduct: true, terms: [/stock|quantity|available|in hand/], not: [/negative|minimum|below|zero|valuation|value|godown|fast|slow|moving|no sales|without|closing stock/],
  run: async (ctx) => {
    const product = ctx.product as Party;
    const r = (await rows(ctx, `WITH ${STOCK_CTE(ctx.sch, "$2")} SELECT stk.oq, stk.aq, stk.lq, stk.cq, pm.min_qty::numeric AS min_qty FROM ${ctx.sch}.product_master pm LEFT JOIN stk ON stk.prod_id = pm.prod_key WHERE pm.prod_key = $1`, [product.code, ctx.session.yearId]))[0];
    return {
      id: 31, title: `Stock of ${product.name}`, columns: [text("item", "Item"), qty("qty", "Quantity")],
      rows: [{ item: "Opening stock", qty: num(r?.oq) }, { item: "Added", qty: num(r?.aq) }, { item: "Less", qty: -num(r?.lq) }, { item: "Current stock", qty: num(r?.cq) }, { item: "Minimum stock level", qty: num(r?.min_qty) }],
      note: "The year's running stock, in the product's first unit.",
    };
  },
});

T.push({
  id: 32, question: "Show products with negative stock.", defaultPeriod: "none", terms: [/negative|minus/, /stock/],
  run: async (ctx) => {
    // The closing is in the product's report unit (REP1_UOM): pieces, quantity 1-3, pack or weight, whichever unit that is.
    const found = await rows(ctx, `WITH ${STOCK_CTE(ctx.sch, "$1")} SELECT btrim(pm.prod_desc) AS name, stk.cq FROM stk JOIN ${ctx.sch}.product_master pm ON pm.prod_key = stk.prod_id WHERE pm.prod_pos <> 'D' AND stk.cq < 0 ORDER BY stk.cq, pm.prod_desc LIMIT 500`, [ctx.session.yearId]);
    return { id: 32, title: "Products with negative stock", columns: [text("name", "Product"), qty("cq", "Closing Qty")], rows: found.map((row) => ({ name: String(row.name), cq: num(row.cq) })), note: `${found.length} products whose closing quantity, in the product's report unit (REP1_UOM), is below zero.` };
  },
});

T.push({
  id: 33, question: "Which products are below minimum stock level?", defaultPeriod: "none", terms: [/below|under|less than|short|low/, /minimum|min\b|reorder|re-order|level/],
  run: async (ctx) => {
    const found = await rows(ctx, `WITH ${STOCK_CTE(ctx.sch, "$1")} SELECT btrim(pm.prod_desc) AS name, COALESCE(stk.cq, 0) AS cq, pm.min_qty::numeric AS min_qty FROM ${ctx.sch}.product_master pm LEFT JOIN stk ON stk.prod_id = pm.prod_key WHERE pm.prod_pos <> 'D' AND pm.min_qty::numeric > 0 AND COALESCE(stk.cq, 0) < pm.min_qty::numeric ORDER BY pm.min_qty::numeric - COALESCE(stk.cq, 0) DESC LIMIT 500`, [ctx.session.yearId]);
    return { id: 33, title: "Products below minimum stock level", columns: [text("name", "Product"), qty("cq", "Stock"), qty("min_qty", "Minimum"), qty("short", "Short By")], rows: found.map((row) => ({ name: String(row.name), cq: num(row.cq), min_qty: num(row.min_qty), short: num(row.min_qty) - num(row.cq) })), note: `${found.length} products with a minimum level set. The stock and the minimum are compared as they stand, in the product's own unit.` };
  },
});

async function stockValue(ctx: Ctx, id: number, title: string, list: boolean): Promise<AskAnswer> {
  const found = await rows(ctx,
    `WITH ${STOCK_CTE(ctx.sch, "$3")}, ${COST_CTES(ctx.sch, "$2", "$1", "$3")} SELECT pm.prod_key AS pk, btrim(pm.prod_desc) AS name, stk.cq, avgc.cost, stk.cq * avgc.cost AS value`
    + ` FROM stk JOIN ${ctx.sch}.product_master pm ON pm.prod_key = stk.prod_id LEFT JOIN avgc ON avgc.prod_id = stk.prod_id WHERE pm.prod_pos <> 'D' AND stk.cq > 0`,
    [ctx.today, iso(ctx.session.tarikh1), ctx.session.yearId]);
  const valued = found.filter((row) => row.value !== null);
  const total = valued.reduce((sum, row) => sum + num(row.value), 0);
  const without = found.length - valued.length;
  const top = valued.sort((a, b) => num(b.value) - num(a.value)).slice(0, 200).map((row) => ({ name: String(row.name), cq: num(row.cq), cost: num(row.cost), value: num(row.value), pk: num(row.pk) }));
  const note = `Stock of ${found.length} products on hand as on ${dmy(ctx.today)}, each at its average cost (opening stock at its opening rate with the year's purchases up to today). ${without} products with stock have no cost and are not valued.`;
  return list
    ? { id, title, columns: [text("name", "Product"), qty("cq", "Stock"), money("cost", "Average Cost"), money("value", "Value")], rows: [...top, { name: `Total (${valued.length} products)`, cq: 0, cost: 0, value: total }], note: `${note} The 200 largest are shown; the total covers all.` }
    : { id, title, columns: [text("item", "Item"), money("value", "Value")], rows: [{ item: "Products with stock", value: found.length, detail: "stock" }, { item: "Closing stock value", value: total }], note: `${note} Click "Products with stock" to show them, click again to hide them.` };
}

T.push({ id: 34, question: "Show stock valuation as of today.", defaultPeriod: "none", terms: [/stock/, /valuation|value|valued/], not: [/closing|financial|year|fy/], run: (ctx) => stockValue(ctx, 34, "Stock valuation", true) });
T.push({ id: 40, question: "What is the closing stock value for this financial year?", defaultPeriod: "none", terms: [/stock/, /closing|value/, /financial|year|fy/], run: (ctx) => stockValue(ctx, 40, "Closing stock value", false) });

T.push({
  id: 35, question: "Which products have no sales in the last 90 days?", defaultPeriod: "none", terms: [/no sales?|not sold|without sales?|unsold|not been sold|nothing sold/, /product|item|which/],
  run: async (ctx) => {
    const from = iso(new Date(new Date(`${ctx.today}T00:00:00`).getTime() - ctx.days * 86400000));
    const found = await rows(ctx,
      `WITH ${STOCK_CTE(ctx.sch, "$3")}, sold AS (SELECT pl.prod_id, MAX(l.doc_date) AS last_sale FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book = ${SALE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date <= $2::date GROUP BY pl.prod_id)`
      + ` SELECT btrim(pm.prod_desc) AS name, stk.cq, sold.last_sale FROM stk JOIN ${ctx.sch}.product_master pm ON pm.prod_key = stk.prod_id LEFT JOIN sold ON sold.prod_id = stk.prod_id`
      + ` WHERE pm.prod_pos <> 'D' AND stk.cq > 0 AND (sold.last_sale IS NULL OR sold.last_sale < $1::date) ORDER BY stk.cq DESC LIMIT 500`, [from, ctx.today, ctx.session.yearId]);
    return { id: 35, title: `Products with stock and no sales in the last ${ctx.days} days`, columns: [text("name", "Product"), qty("cq", "Stock"), date("last", "Last Sale")], rows: found.map((row) => ({ name: String(row.name), cq: num(row.cq), last: row.last_sale ? dmy(row.last_sale) : "Never" })), note: `Products with stock on hand and no sale since ${dmy(from)}. The first 500, by stock, are shown.` };
  },
});

/** The Sale book (credit notes against it take off) or the Purchase book (debit notes against it take off): the book of the lines, and the note book that reverses them. */
const HSN_SIDE = {
  sale: { book: SALE, back: CREDIT_NOTE, word: "sales", bills: "Sale book", note: "credit notes" },
  purchase: { book: PURCHASE, back: 11, word: "purchase", bills: "Purchase book", note: "debit notes" },
} as const;
const hsnLines = (ctx: Ctx, side: "sale" | "purchase") => {
  const { book, back } = HSN_SIDE[side];
  return { from: `${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id`,
    where: `(l.book = ${book} OR (l.book = ${back} AND l.ag_book = ${book})) AND pl.il_pos = 'A' AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date`,
    sign: (column: string) => `CASE WHEN l.book = ${book} THEN ${column}::numeric ELSE -${column}::numeric END` };
};

/** HSN-wise summary of the sales or of the purchases: each product at the HSN of its master, before tax. */
async function hsnSummary(ctx: Ctx, id: number, side: "sale" | "purchase"): Promise<AskAnswer> {
  const lines = hsnLines(ctx, side);
  const found = await rows(ctx,
    `SELECT COALESCE(NULLIF(btrim(pm.hsn_code), ''), '(no HSN)') AS hsn, COUNT(DISTINCT pl.prod_id) AS products, COALESCE(SUM(${lines.sign("pl.quantity")}), 0) AS qty, COALESCE(SUM(${lines.sign("pl.il_value")}), 0) AS value`
    + ` FROM ${lines.from} WHERE ${lines.where} GROUP BY 1 ORDER BY value DESC`, [ctx.period.from, ctx.period.to]);
  const total = (key: "qty" | "value") => found.reduce((sum, row) => sum + num(row[key]), 0);
  const prefix = side === "sale" ? "hsn" : "hsnp";
  const info = HSN_SIDE[side];
  return {
    id, title: `HSN-wise ${info.word} summary`, columns: [text("hsn", "HSN Code"), int("products", "Products"), qty("qty", "Quantity"), money("value", "Taxable Value")],
    rows: found.length === 0 ? [] : [...found.map((row) => ({ hsn: String(row.hsn), products: num(row.products), qty: num(row.qty), value: num(row.value), detail: `${prefix}:${encodeURIComponent(String(row.hsn))}:${ctx.period.from}:${ctx.period.to}` })), { hsn: "Total", products: 0, qty: total("qty"), value: total("value") }],
    note: `${ctx.period.label}. ${info.bills} lines less the ${info.note} against it, grouped by the HSN code of the product master, value before tax. Products with no HSN are shown together. Click a code to show its bills, click again to hide them.`,
  };
}

T.push({ id: 64, question: "Show the HSN-wise sales summary.", defaultPeriod: "year", terms: [/\bhsn\b|\bsac\b/, /sales?|sold|summary|outward/], not: [/purchas|bought|inward|missing|without|blank|empty|invoices?/], run: (ctx) => hsnSummary(ctx, 64, "sale") });
T.push({ id: 65, question: "Show the HSN-wise purchase summary.", defaultPeriod: "year", terms: [/\bhsn\b|\bsac\b/, /purchas|bought|inward/], run: (ctx) => hsnSummary(ctx, 65, "purchase") });

/** Whether the company's database has this column (the IRN and acknowledgement columns are only there where e-invoicing was set up). */
async function hasColumn(ctx: Ctx, table: string, column: string): Promise<boolean> {
  return (await rows(ctx, "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3", [ctx.sch, table, column])).length > 0;
}

T.push({
  id: 66, question: "Find invoices with missing GSTIN.", defaultPeriod: "year", terms: [/gstin|gst\s?(?:no|number)|gst\s?id/, /missing|without|blank|empty|invalid|not (?:entered|available|filled)|\bno\b|incorrect|wrong/], not: [/account|master|general ledger|debtors? ledger|creditors? ledger/],
  run: async (ctx) => {
    // The sale invoices whose customer has no GSTIN in its first address, or one that is not 15 characters long.
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, l.amount::numeric AS amount, btrim(COALESCE(ad.gst_no, '')) AS gstin, l.code`
      + ` FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code LEFT JOIN ${ctx.sch}.address ad ON ad.code = l.code AND ad.address_id = 1`
      + ` WHERE l.book = ${SALE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND length(btrim(COALESCE(ad.gst_no, ''))) <> 15 ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.period.from, ctx.period.to]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount), gstin: String(row.gstin) === "" ? "Missing" : `${String(row.gstin)} (not 15 characters)`, code: num(row.code) }));
    return {
      id: 66, title: "Invoices with missing GSTIN", columns: [date("d", "Date"), text("doc", "Invoice"), text("party", "Customer"), money("amount", "Amount"), text("gstin", "GSTIN")],
      rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: `Total (${out.length})`, amount: out.reduce((sum, row) => sum + row.amount, 0), gstin: "" }],
      note: `${ctx.period.label}. Sale invoices whose customer has no GSTIN in its first address, or one that is not 15 characters long (a customer who is not registered will show here too). Double-click a line to open the customer's ledger.`,
    };
  },
});

T.push({
  id: 67, question: "Show invoices with missing IRN or acknowledgement number.", defaultPeriod: "year", terms: [/\birn\b|acknowledg|\back\b|e-?invoice/, /missing|without|pending|blank|empty|not (?:generated|available|received|entered)|\bno\b/],
  run: async (ctx) => {
    const irn = await hasColumn(ctx, "ledger", "einv_irnno");
    if (!irn) return { id: 67, title: "Invoices with missing IRN or acknowledgement number", columns: [text("item", "Item")], rows: [], note: "This company's database does not keep an IRN on its invoices, so there is nothing to check." };
    const ack = await hasColumn(ctx, "ledger", "einv_ackno");
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, l.amount::numeric AS amount, btrim(COALESCE(l.einv_irnno, '')) AS irn, ${ack ? "btrim(COALESCE(l.einv_ackno::text, ''))" : "''"} AS ack, l.code`
      + ` FROM ${ctx.sch}.ledger l JOIN ${ctx.sch}.account ac ON ac.code = l.code JOIN ${ctx.sch}.address ad ON ad.code = l.code AND ad.address_id = 1`
      + ` WHERE l.book = ${SALE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND length(btrim(COALESCE(ad.gst_no, ''))) = 15`
      + ` AND (btrim(COALESCE(l.einv_irnno, '')) = ''${ack ? " OR btrim(COALESCE(l.einv_ackno::text, '')) = ''" : ""}) ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.period.from, ctx.period.to]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount), irn: String(row.irn) === "" ? "Missing" : "Yes", ack: ack ? (String(row.ack) === "" ? "Missing" : "Yes") : "", code: num(row.code) }));
    const einvoiceOn = String(ctx.session.setup.einvoice_req ?? "").toUpperCase().includes("Y");
    return {
      id: 67, title: "Invoices with missing IRN or acknowledgement number", columns: [date("d", "Date"), text("doc", "Invoice"), text("party", "Customer"), money("amount", "Amount"), text("irn", "IRN"), ...(ack ? [text("ack", "Ack. No.")] : [])],
      rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: `Total (${out.length})`, amount: out.reduce((sum, row) => sum + row.amount, 0), irn: "", ack: "" }],
      note: `${ctx.period.label}. Sale invoices of customers that have a GSTIN (the business-to-business ones an e-invoice is made for) with no IRN${ack ? " or no acknowledgement number" : ""}.${einvoiceOn ? "" : " E-invoicing is not switched on in this company's setup, so most invoices will show here."}`,
    };
  },
});

T.push({
  id: 68, question: "Show month-wise sales for this financial year.", defaultPeriod: "year", terms: [/month/, /sales?|sold|selling/, /year|financial|\bfy\b/], not: [/party|parties|customer|supplier|compar|versus|\bvs\b|last year|previous year|purchas/],
  run: async (ctx) => ({ ...(await monthlySales(ctx)), id: 68, title: "Month-wise sales" }),
});

T.push({
  id: 69, question: "Compare today's sales with yesterday's sales.", defaultPeriod: "none", terms: [/today|todays|today's/, /yesterday|yesterdays|yesterday's/, /sales?|sold/],
  run: async (ctx) => {
    const today = new Date(`${ctx.today}T00:00:00`);
    const before = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const now = (await netSales(ctx, iso(today), iso(today), false))[0];
    const earlier = (await netSales(ctx, iso(before), iso(before), false))[0];
    const change = now.net - earlier.net;
    const pct = (diff: number, base: number): string | number => (base === 0 ? "" : (diff / Math.abs(base)) * 100);
    return {
      id: 69, title: "Sales: today and yesterday", columns: [text("item", "Day"), int("entries", "Entries"), ...salesColumns],
      rows: [
        { item: `Today (${dmy(today)})`, entries: now.entries, sales: now.sales, returns: -now.returns, net: now.net },
        { item: `Yesterday (${dmy(before)})`, entries: earlier.entries, sales: earlier.sales, returns: -earlier.returns, net: earlier.net },
        { item: "Change", entries: now.entries - earlier.entries, sales: now.sales - earlier.sales, returns: earlier.returns - now.returns, net: change },
        // The change as a percentage of yesterday, column by column (blank where yesterday had nothing to divide by).
        { item: "Change %", entries: pct(now.entries - earlier.entries, earlier.entries), sales: pct(now.sales - earlier.sales, earlier.sales), returns: pct(earlier.returns - now.returns, -earlier.returns), net: pct(change, earlier.net) },
      ],
      chart: { label: "item", value: "net", count: 2 },
      note: `${SALES_NOTE}${ctx.today !== iso(new Date()) ? " The open year ends before today, so its last day is shown as today." : ""}`,
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Profit, returns and costing of products and customers (G)

/**
 * The cost of one unit of each product: a product made in the factory at the cost of its latest bill of material (as the Finish Product Costing report
 * works it out); any other at its average cost, the year's opening stock at its opening rate together with the year's purchases up to the period's end,
 * value over quantity. A product with neither is not in the map (its cost is 0).
 */
async function unitCosts(ctx: Ctx): Promise<Map<number, number>> {
  const average = await rows(ctx,
    `WITH pur AS (SELECT pl.prod_id, SUM(pl.il_value::numeric) AS v, SUM(pl.quantity::numeric) AS q FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
    + ` WHERE pl.book = ${PURCHASE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $2::date AND l.doc_date <= $1::date GROUP BY pl.prod_id),`
    + ` opn AS (SELECT prod_id, SUM(open_qty1::numeric) AS q, MAX(open_rate::numeric) AS r FROM ${ctx.sch}.prod_balance WHERE year_id = $3 GROUP BY prod_id)`
    + ` SELECT COALESCE(opn.prod_id, pur.prod_id) AS prod_id, NULLIF(CASE WHEN COALESCE(opn.q, 0) + COALESCE(pur.q, 0) > 0`
    + ` THEN (COALESCE(opn.q, 0) * COALESCE(opn.r, 0) + COALESCE(pur.v, 0)) / (COALESCE(opn.q, 0) + COALESCE(pur.q, 0)) ELSE COALESCE(opn.r, 0) END, 0) AS cost FROM opn FULL JOIN pur ON pur.prod_id = opn.prod_id`,
    [ctx.period.to, iso(ctx.session.tarikh1), ctx.session.yearId]);
  const costs = new Map<number, number>();
  for (const row of average) if (num(row.cost) > 0) costs.set(num(row.prod_id), num(row.cost));
  for (const [prod, cost] of await bomCosts(ctx)) if (cost > 0) costs.set(prod, cost);
  return costs;
}

type ProductProfit = Readonly<{ prod: number; name: string; qty: number; value: number; cost: number; profit: number; margin: number; rate: number; unit: number }>;

/** Each product's net sales of the period (the Sale book's lines less the credit notes) against the cost of the net quantity sold. */
async function productProfits(ctx: Ctx): Promise<ProductProfit[]> {
  const sold = await rows(ctx,
    `SELECT pl.prod_id, btrim(pm.prod_desc) AS name, SUM(CASE WHEN pl.book = ${SALE} THEN pl.quantity::numeric ELSE -pl.quantity::numeric END) AS qty, SUM(CASE WHEN pl.book = ${SALE} THEN pl.il_value::numeric ELSE -pl.il_value::numeric END) AS value`
    + ` FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id`
    + ` WHERE pl.book IN (${SALE}, ${CREDIT_NOTE}) AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY pl.prod_id, pm.prod_desc`, [ctx.period.from, ctx.period.to]);
  const costs = await unitCosts(ctx);
  return sold.filter((row) => num(row.qty) !== 0 || num(row.value) !== 0).map((row) => {
    const qtyNet = num(row.qty); const value = num(row.value); const unit = costs.get(num(row.prod_id)) ?? 0; const cost = qtyNet * unit;
    return { prod: num(row.prod_id), name: String(row.name ?? ""), qty: qtyNet, value, cost, profit: value - cost, margin: value === 0 ? 0 : ((value - cost) / value) * 100, rate: qtyNet === 0 ? 0 : value / qtyNet, unit };
  });
}

const PROFIT_NOTE = "Profit is the net sales of the product (before tax, less credit notes) less the net quantity sold times its cost: a product made in the factory at its bill of material cost, any other at its average cost (opening stock at its opening rate with the year's purchases up to the period's end). A product with no cost counts at 0, so its profit is on the high side.";
const profitColumns = [qty("qty", "Quantity"), money("value", "Net Sales"), money("cost", "Cost"), money("profit", "Profit"), money("margin", "Margin %")];
const profitRow = (row: ProductProfit, at: number) => ({ no: at + 1, name: row.name, qty: row.qty, value: row.value, cost: row.cost, profit: row.profit, margin: row.margin });

T.push({
  id: 70, question: "Which customers returned the most goods?", defaultPeriod: "year", terms: [/customers?|parties|party/, /return/, /most|highest|top|maximum|biggest|largest|more/],
  run: async (ctx) => {
    const list = (await netSales(ctx, ctx.period.from, ctx.period.to, true)).filter((row) => row.returns > 0).sort((a, b) => b.returns - a.returns).slice(0, Math.max(ctx.top, 20));
    const total = list.reduce((sum, row) => sum + row.returns, 0);
    const notes = new Map((await rows(ctx, `SELECT code, COUNT(DISTINCT full_docno) AS notes FROM ${ctx.sch}.ledger WHERE book = ${CREDIT_NOTE} AND ag_book = ${SALE} AND doc_pos = 'A' AND doc_posting = 'P' AND doc_date >= $1::date AND doc_date <= $2::date GROUP BY code`, [ctx.period.from, ctx.period.to])).map((row) => [num(row.code), num(row.notes)] as const));
    return {
      id: 70, title: "Customers by goods returned", columns: [int("no", "No."), text("name", "Customer"), int("entries", "Sales Entries"), int("notes", "Credit Notes"), money("sales", "Sales"), money("returns", "Returns"), money("share", "Returns % of Sales")],
      rows: list.map((row, at) => ({ no: at + 1, name: row.name, entries: row.entries - (notes.get(row.code) ?? 0), notes: notes.get(row.code) ?? 0, sales: row.sales, returns: row.returns, share: row.sales === 0 ? 0 : (row.returns / row.sales) * 100, code: row.code, detail: `ret:${row.code}:${ctx.period.from}:${ctx.period.to}` })),
      note: `${ctx.period.label}. Credit notes against sales (before tax) of each customer, largest first; together ${grouping.format(total)}. Sales Entries are its invoices and debit notes, Credit Notes the returns against them. Click a customer to show its credit notes with the goods on them, click again to hide them. ${SALES_NOTE}`,
    };
  },
});

/** The company's net sales, its customers' and its products' in a stretch of days (the customers and products by name, so another year's database can be compared). */
async function salesWindow(ctx: Ctx, from: string, to: string) {
  const total = (await netSales(ctx, from, to, false))[0];
  const parties = await netSales(ctx, from, to, true);
  const products = await rows(ctx,
    `SELECT btrim(pm.prod_desc) AS name, SUM(CASE WHEN pl.book = ${SALE} THEN pl.il_value::numeric ELSE -pl.il_value::numeric END) AS net FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
    + ` JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id WHERE pl.book IN (${SALE}, ${CREDIT_NOTE}) AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY pm.prod_desc`, [from, to]);
  return { total, parties: new Map(parties.map((row) => [row.name.toLowerCase(), { name: row.name, net: row.net }])), products: new Map(products.map((row) => [String(row.name).toLowerCase(), { name: String(row.name), net: num(row.net) }])) };
}

T.push({
  id: 71, question: "Why did sales decrease compared with last month?", defaultPeriod: "none", terms: [/why|reason|cause|how come|what happened|explain/, /sales?|sold|revenue/, /decreas|drop|fall|fell|lower|\bless\b|down|declin|reduc|low/],
  run: async (ctx) => {
    // This month up to today against the same days of last month (a month that has fewer days ends on its last day).
    const today = new Date(`${ctx.today}T00:00:00`);
    const thisFrom = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastTo = new Date(lastFrom.getFullYear(), lastFrom.getMonth(), Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth(), 0).getDate()));
    // The first month of the year has its last month in last year's database.
    const lastSchema = lastFrom < ctx.session.tarikh1 ? await previousYearSchema(ctx, ctx.session.tarikh1) : ctx.sch;
    const now = await salesWindow(ctx, iso(thisFrom), iso(today));
    const before = lastSchema ? await salesWindow({ ...ctx, sch: lastSchema }, iso(lastFrom), iso(lastTo)) : null;
    if (!before) return { id: 71, title: "Why did sales change", columns: [text("item", "Item")], rows: [], note: "Last month is in the previous year, whose database was not found on this server." };
    const change = now.total.net - before.total.net;
    const averageNow = now.total.entries === 0 ? 0 : now.total.net / now.total.entries;
    const averageBefore = before.total.entries === 0 ? 0 : before.total.net / before.total.entries;
    const drivers = (list: Map<string, { name: string; net: number }>, other: Map<string, { name: string; net: number }>, fall: boolean) => {
      const keys = new Set([...list.keys(), ...other.keys()]);
      return [...keys].map((key) => ({ name: list.get(key)?.name ?? other.get(key)?.name ?? "", last: other.get(key)?.net ?? 0, current: list.get(key)?.net ?? 0 }))
        .map((row) => ({ ...row, change: row.current - row.last })).filter((row) => (fall ? row.change < 0 : row.change > 0)).sort((a, b) => (fall ? a.change - b.change : b.change - a.change)).slice(0, 5);
    };
    const heading = (item: string) => ({ item, last: "", current: "", change: "" });
    const lines = (list: ReturnType<typeof drivers>) => (list.length === 0 ? [{ item: "  none", last: "", current: "", change: "" }] : list.map((row) => ({ item: `  ${row.name}`, last: row.last, current: row.current, change: row.change })));
    const lostParties = [...before.parties.entries()].filter(([key, row]) => row.net > 0 && !(now.parties.get(key)?.net)).reduce((acc, [, row]) => ({ count: acc.count + 1, value: acc.value + row.net }), { count: 0, value: 0 });
    const newParties = [...now.parties.entries()].filter(([key, row]) => row.net > 0 && !(before.parties.get(key)?.net)).reduce((acc, [, row]) => ({ count: acc.count + 1, value: acc.value + row.net }), { count: 0, value: 0 });
    const verdict = change < 0
      ? `Net sales fell by ${grouping.format(-change)}${before.total.net === 0 ? "" : ` (${((-change / before.total.net) * 100).toFixed(1)}%)`}: ${now.total.entries - before.total.entries} invoices and an average invoice ${averageNow < averageBefore ? "down" : "up"} by ${grouping.format(Math.abs(averageNow - averageBefore))}.`
      : `Sales did not decrease: net sales are up by ${grouping.format(change)}. The lines below show what moved.`;
    return {
      id: 71, title: "Why did sales change compared with last month", columns: [text("item", "Item"), money("last", "Last Month"), money("current", "This Month"), money("change", "Change")],
      rows: [
        { item: "Net sales", last: before.total.net, current: now.total.net, change },
        { item: "Invoices", last: before.total.entries, current: now.total.entries, change: now.total.entries - before.total.entries },
        { item: "Average invoice", last: averageBefore, current: averageNow, change: averageNow - averageBefore },
        { item: `Customers who bought last month and not this (${lostParties.count})`, last: lostParties.value, current: 0, change: -lostParties.value },
        { item: `Customers who bought only this month (${newParties.count})`, last: 0, current: newParties.value, change: newParties.value },
        heading("Customers who bought less"), ...lines(drivers(now.parties, before.parties, true)),
        heading("Products that sold less"), ...lines(drivers(now.products, before.products, true)),
        heading("Customers who bought more"), ...lines(drivers(now.parties, before.parties, false)),
        heading("Products that sold more"), ...lines(drivers(now.products, before.products, false)),
      ],
      note: `${dmy(thisFrom)} to ${dmy(today)} against ${dmy(lastFrom)} to ${dmy(lastTo)}. ${verdict} ${SALES_NOTE}`,
    };
  },
});

T.push({
  id: 72, question: "Which products are selling at a loss?", defaultPeriod: "year", terms: [/products?|items?/, /\bloss|losing|loss-making|unprofitable|not profitable|negative (?:profit|margin)/], not: [/purchase cost|last purchase|\bnet\b|account/],
  run: async (ctx) => {
    const list = (await productProfits(ctx)).filter((row) => row.profit < 0 && row.cost > 0).sort((a, b) => a.profit - b.profit).slice(0, 300);
    return { id: 72, title: "Products selling at a loss", columns: [int("no", "No."), text("name", "Product"), ...profitColumns], rows: list.map(profitRow), note: `${ctx.period.label}. Products whose net sales are less than their cost, the biggest loss first. ${PROFIT_NOTE}` };
  },
});

T.push({
  id: 73, question: "Show products sold below their last purchase cost.", defaultPeriod: "year", terms: [/products?|items?/, /below|under|less than|lower than/, /purchase (?:cost|rate|price)|last cost|cost price|bought/], not: [/stock|minimum/],
  run: async (ctx) => {
    // Each product's average selling rate of the period (value over quantity of the Sale book's lines) against the rate of its latest purchase line up to the period's end.
    const found = await rows(ctx,
      `WITH sold AS (SELECT pl.prod_id, SUM(pl.quantity::numeric) AS qty, SUM(pl.il_value::numeric) AS value FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book = ${SALE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY pl.prod_id HAVING SUM(pl.quantity::numeric) > 0),`
      + ` bought AS (SELECT DISTINCT ON (pl.prod_id) pl.prod_id, pl.il_value::numeric / NULLIF(pl.quantity::numeric, 0) AS rate, l.doc_date AS d FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book = ${PURCHASE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date <= $2::date AND pl.quantity::numeric > 0 ORDER BY pl.prod_id, l.doc_date DESC, pl.il_key DESC)`
      + ` SELECT btrim(pm.prod_desc) AS name, sold.qty, sold.value / sold.qty AS sale_rate, bought.rate AS purchase_rate, bought.d AS purchase_date FROM sold JOIN bought ON bought.prod_id = sold.prod_id JOIN ${ctx.sch}.product_master pm ON pm.prod_key = sold.prod_id`
      + ` WHERE bought.rate > 0 AND sold.value / sold.qty < bought.rate ORDER BY (bought.rate - sold.value / sold.qty) * sold.qty DESC LIMIT 300`, [ctx.period.from, ctx.period.to]);
    return {
      id: 73, title: "Products sold below their last purchase cost", columns: [int("no", "No."), text("name", "Product"), qty("qty", "Sold Qty"), money("sale_rate", "Average Selling Rate"), money("purchase_rate", "Last Purchase Rate"), date("purchase_date", "Purchased On"), money("loss", "Shortfall on Quantity Sold")],
      rows: found.map((row, at) => ({ no: at + 1, name: String(row.name), qty: num(row.qty), sale_rate: num(row.sale_rate), purchase_rate: num(row.purchase_rate), purchase_date: dmy(row.purchase_date), loss: (num(row.purchase_rate) - num(row.sale_rate)) * num(row.qty) })),
      note: `${ctx.period.label}. Rates are value before tax over quantity: the average of the Sale book's lines of the period against the latest purchase line up to the period's end. The biggest shortfall first.`,
    };
  },
});

T.push({
  id: 74, question: "Show finished-product costing for a selected product.", defaultPeriod: "none", needsProduct: true, terms: [/costing|cost sheet|bill of material|\bbom\b|cost of (?:making|manufactur)|finished|\bfg\b/, /products?|items?|finished|\bfg\b|costing/],
  run: async (ctx) => {
    const product = ctx.product as Party;
    // The latest bill of material of the product (MFG-BOM voucher), its materials' quantity over the BOM's own quantity, each at the rate the Finish Product Costing report takes.
    const header = (await rows(ctx, `SELECT full_docno AS doc, quantity::numeric AS qty, il_date FROM ${ctx.sch}.prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D' AND prod_id = $1 AND stock_nat = 'A' ORDER BY il_date DESC, full_docno DESC LIMIT 1`, [product.code]))[0];
    const columns = [text("material", "Material"), qty("bom_qty", "Quantity in BOM"), qty("per_piece", "Per Piece"), money("rate", "Rate"), text("source", "Rate Taken From"), money("cost", "Cost per Piece")];
    if (!header || num(header.qty) <= 0) return { id: 74, title: `Costing of ${product.name}`, columns, rows: [], note: "This product has no bill of material (MFG-BOM), so it is not costed as a finished product. Its cost is its average purchase cost." };
    const lines = await rows(ctx, `SELECT pl.prod_id, btrim(pm.prod_desc) AS name, pl.quantity::numeric AS qty, pl.rate::numeric AS rate FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id WHERE btrim(pl.trn_module) = 'MFG-BOM' AND pl.il_pos <> 'D' AND pl.full_docno = $1 AND pl.stock_nat = 'L' ORDER BY pl.il_serial, pl.il_key`, [header.doc]);
    const ids = lines.map((row) => num(row.prod_id));
    const purchase = new Map((await rows(ctx, `SELECT DISTINCT ON (prod_id) prod_id, rate::numeric AS rate FROM ${ctx.sch}.prod_ledger WHERE il_pos = 'A' AND il_date BETWEEN $1::date AND $2::date AND book = ${PURCHASE} AND led_id IS NOT NULL AND prod_id = ANY($3::int[]) ORDER BY prod_id, il_date DESC`, [iso(ctx.session.tarikh1), ctx.today, ids])).map((row) => [num(row.prod_id), num(row.rate)] as const));
    const balance = new Map((await rows(ctx, `SELECT DISTINCT ON (prod_id) prod_id, open_rate::numeric AS open_rate, rep_rate::numeric AS rep_rate FROM ${ctx.sch}.prod_balance WHERE prec_flag = 'RP' AND prod_id = ANY($1::int[]) ORDER BY prod_id`, [ids])).map((row) => [num(row.prod_id), row] as const));
    const own = await bomCosts(ctx);
    const out = lines.map((row) => {
      const id = num(row.prod_id);
      const [rate, source] = num(row.rate) !== 0 ? [num(row.rate), "BOM rate"] as const
        : own.has(id) && (own.get(id) ?? 0) > 0 ? [own.get(id) as number, "Its own BOM (semi finished)"] as const
        : purchase.get(id) ? [purchase.get(id) as number, "Latest purchase of the year"] as const
        : num(balance.get(id)?.open_rate) ? [num(balance.get(id)?.open_rate), "Opening rate"] as const
        : num(balance.get(id)?.rep_rate) ? [num(balance.get(id)?.rep_rate), "Report rate"] as const : [0, "No rate"] as const;
      const perPiece = num(row.qty) / num(header.qty);
      return { material: String(row.name), bom_qty: num(row.qty), per_piece: perPiece, rate, source, cost: perPiece * rate };
    });
    const total = out.reduce((sum, row) => sum + row.cost, 0);
    return {
      id: 74, title: `Costing of ${product.name}`, columns,
      rows: out.length === 0 ? [] : [...out, { material: "Cost of one piece", bom_qty: "", per_piece: "", rate: "", source: "", cost: total }, { material: `Bill of material ${String(header.doc)}: makes`, bom_qty: num(header.qty), per_piece: "", rate: "", source: "", cost: "" }],
      note: `The latest bill of material of the product (${dmy(header.il_date)}). Each material's quantity over the quantity the BOM makes, at the BOM's rate, else its own BOM's cost, else its latest purchase rate of the year, else its opening rate, else the report rate; as the Finish Product Costing report takes them.`,
    };
  },
});

T.push({
  id: 75, question: "Compare purchase cost and sales price for a product.", defaultPeriod: "year", needsProduct: true, terms: [/purchase\s+(?:cost|rate|price)|cost price|buying/, /sales?\s+(?:price|rate)|selling|sell(?:ing)? price/],
  run: async (ctx) => {
    const product = ctx.product as Party;
    const line = async (book: number, order: string) => (await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, pl.il_value::numeric / NULLIF(pl.quantity::numeric, 0) AS rate FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE pl.book = ${book} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND pl.prod_id = $1 AND pl.quantity::numeric > 0 AND l.doc_date >= $2::date AND l.doc_date <= $3::date ORDER BY ${order} LIMIT 1`, [product.code, ctx.period.from, ctx.period.to]))[0];
    const stat = async (book: number) => (await rows(ctx,
      `SELECT SUM(pl.quantity::numeric) AS qty, SUM(pl.il_value::numeric) AS value, MIN(pl.il_value::numeric / NULLIF(pl.quantity::numeric, 0)) AS low, MAX(pl.il_value::numeric / NULLIF(pl.quantity::numeric, 0)) AS high FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book = ${book} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND pl.prod_id = $1 AND pl.quantity::numeric > 0 AND l.doc_date >= $2::date AND l.doc_date <= $3::date`, [product.code, ctx.period.from, ctx.period.to]))[0];
    const [lastBuy, lastSell, bought, sold, costs] = [await line(PURCHASE, "l.doc_date DESC, pl.il_key DESC"), await line(SALE, "l.doc_date DESC, pl.il_key DESC"), await stat(PURCHASE), await stat(SALE), await unitCosts(ctx)];
    const buyAverage = num(bought?.qty) > 0 ? num(bought?.value) / num(bought?.qty) : 0;
    const sellAverage = num(sold?.qty) > 0 ? num(sold?.value) / num(sold?.qty) : 0;
    const cost = costs.get(product.code) ?? buyAverage;
    const margin = sellAverage - cost;
    const item = (name: string, value: number | string, info = "") => ({ item: name, value, info });
    return {
      id: 75, title: `Purchase cost and sales price of ${product.name}`, columns: [text("item", "Item"), money("value", "Rate"), text("info", "Detail")],
      rows: [
        item("Last purchase rate", num(lastBuy?.rate), lastBuy ? `${dmy(lastBuy.d)}  ${String(lastBuy.doc ?? "")}  ${String(lastBuy.party ?? "")}` : "no purchase in the period"),
        item("Average purchase rate", buyAverage, `${grouping.format(num(bought?.qty))} bought`),
        item("Lowest / highest purchase rate", `${grouping.format(num(bought?.low))} / ${grouping.format(num(bought?.high))}`),
        item("Cost used for profit", cost, "bill of material cost for a made product, else the average cost"),
        item("Last selling rate", num(lastSell?.rate), lastSell ? `${dmy(lastSell.d)}  ${String(lastSell.doc ?? "")}  ${String(lastSell.party ?? "")}` : "no sale in the period"),
        item("Average selling rate", sellAverage, `${grouping.format(num(sold?.qty))} sold`),
        item("Lowest / highest selling rate", `${grouping.format(num(sold?.low))} / ${grouping.format(num(sold?.high))}`),
        item("Margin per unit (average selling rate less cost)", margin, sellAverage === 0 ? "" : `${((margin / sellAverage) * 100).toFixed(1)}% of the selling rate`),
      ],
      note: `${ctx.period.label}. Rates are value before tax over quantity of the product's own lines in the Purchase and Sale books.`,
    };
  },
});

T.push({
  id: 76, question: "Which products generate the highest profit?", defaultPeriod: "year", terms: [/products?|items?/, /profit/, /highest|most|top|best|generat|maximum|biggest|largest|earn/], not: [/margin|lowest|\blow\b|loss|customer|party|parties|net profit|gross/],
  run: async (ctx) => {
    const list = (await productProfits(ctx)).sort((a, b) => b.profit - a.profit).slice(0, Math.max(ctx.top, 20));
    return { id: 76, title: `Top ${list.length} products by profit`, columns: [int("no", "No."), text("name", "Product"), ...profitColumns], rows: list.map(profitRow), note: `${ctx.period.label}. ${PROFIT_NOTE}` };
  },
});

T.push({
  id: 77, question: "Which products have a low profit margin?", defaultPeriod: "year", terms: [/products?|items?/, /margin|profit/, /\blow|lowest|poor|thin|least|less/], not: [/highest|customer|party|parties|\bloss|gross|net profit/],
  run: async (ctx) => {
    // Products with a cost and some sales, the lowest margin first.
    const list = (await productProfits(ctx)).filter((row) => row.cost > 0 && row.value > 0).sort((a, b) => a.margin - b.margin).slice(0, Math.max(ctx.top, 20));
    return { id: 77, title: `Products with the lowest profit margin`, columns: [int("no", "No."), text("name", "Product"), ...profitColumns], rows: list.map(profitRow), note: `${ctx.period.label}. Products with a cost and sales, the lowest margin % first. ${PROFIT_NOTE}` };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Collection, payment prediction, customers, suppliers and entry control (H)

/** The last day of this week (weeks run Monday to Sunday), as a date. */
const endOfWeek = (today: string) => { const day = new Date(`${today}T00:00:00`); return new Date(day.getFullYear(), day.getMonth(), day.getDate() + ((7 - day.getDay()) % 7)); };
/** The first whole number that follows a pattern in the question (null when none). */
const numberAfter = (question: string, pattern: RegExp): number | null => { const found = pattern.exec(question); return found ? Number(found[1].replace(/,/g, "")) : null; };

type Expected = Bill & Readonly<{ expectedIso: string; basis: string }>;

/**
 * When each open bill of a customer is likely to be paid: the bill's date plus the days this customer has actually taken to pay (the settled bills of the
 * year, weighted by what each receipt set off), else the bill's own credit days. A bill that is already later than that is expected today.
 */
async function paymentForecast(ctx: Ctx): Promise<Expected[]> {
  const habit = new Map((await rows(ctx,
    `SELECT b.code, SUM(((s.out_date::date - led.doc_date::date)) * s.out_setoff::numeric) / NULLIF(SUM(s.out_setoff::numeric), 0) AS days, COUNT(DISTINCT b.out_key) AS bills`
    + ` FROM ${ctx.sch}.outclear s JOIN ${ctx.sch}.outclear b ON b.out_key = s.out_ag_outid JOIN ${ctx.sch}.ledger led ON led.led_key = b.out_ledid`
    + ` WHERE s.out_dbcode = 2 AND b.out_dbcode = 1 AND s.out_setoff::numeric > 0 AND s.out_date::date >= led.doc_date::date GROUP BY b.code`)).map((row) => [num(row.code), { days: num(row.days), bills: num(row.bills) }] as const));
  const today = new Date(`${ctx.today}T00:00:00`);
  return (await agewiseBills(ctx)).map((bill) => {
    const own = habit.get(bill.code);
    const days = own && own.bills > 0 ? Math.round(own.days) : bill.credit;
    const when = new Date(`${bill.billIso}T00:00:00`);
    const expected = new Date(when.getFullYear(), when.getMonth(), when.getDate() + days);
    return { ...bill, expectedIso: iso(expected < today ? today : expected), basis: own && own.bills > 0 ? `pays in about ${days} days (${own.bills} bills)` : `credit terms (${bill.credit} days)` };
  });
}

const expectedColumns = [text("name", "Customer"), text("doc", "Bill"), date("billDate", "Bill Date"), money("pending", "Pending"), date("expected", "Expected On"), text("basis", "Based On")];
const expectedRow = (bill: Expected) => ({ code: bill.code, name: bill.name, doc: bill.doc, billDate: bill.billDate, pending: bill.pending, expected: dmy(bill.expectedIso), basis: bill.basis });

T.push({
  id: 80, question: "Show payment predictions.", defaultPeriod: "none", terms: [/predict|forecast|likely to pay|when will/, /payments?|collect|receive|customers?|pay\b/], not: [/week/],
  run: async (ctx) => {
    const list = (await paymentForecast(ctx)).sort((a, b) => a.expectedIso.localeCompare(b.expectedIso) || b.pending - a.pending);
    const sumTo = (until: string) => list.filter((bill) => bill.expectedIso <= until).reduce((sum, bill) => sum + bill.pending, 0);
    const today = new Date(`${ctx.today}T00:00:00`);
    const within = (days: number) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
    return {
      id: 80, title: "Payment predictions", columns: expectedColumns, rows: list.slice(0, 500).map(expectedRow),
      note: `${list.length} open bills. Expected: ${grouping.format(sumTo(ctx.today))} today, ${grouping.format(sumTo(within(7)))} within 7 days, ${grouping.format(sumTo(within(30)))} within 30 days, of ${grouping.format(list.reduce((sum, bill) => sum + bill.pending, 0))} pending. A customer's habit is the days it took to settle its bills this year (weighted by amount); one with no settled bill is taken at its credit days. It is a forecast from past behaviour, not a promise.`,
    };
  },
});

T.push({
  id: 95, question: "How much payment is expected this week?", defaultPeriod: "none", terms: [/expect|forecast|predict|likely|collect|receiv|coming/, /payments?|collection|money|amount|cash/, /week/], not: [/\bdid\b|\breceived\b/],
  run: async (ctx) => {
    const last = iso(endOfWeek(ctx.today));
    const list = (await paymentForecast(ctx)).filter((bill) => bill.expectedIso <= last);
    const byParty = new Map<number, { code: number; name: string; bills: number; pending: number; first: string }>();
    for (const bill of list) {
      const entry = byParty.get(bill.code) ?? byParty.set(bill.code, { code: bill.code, name: bill.name, bills: 0, pending: 0, first: bill.expectedIso }).get(bill.code)!;
      entry.bills += 1; entry.pending += bill.pending; if (bill.expectedIso < entry.first) entry.first = bill.expectedIso;
    }
    const out = [...byParty.values()].sort((a, b) => b.pending - a.pending);
    const due = (await agewiseBills(ctx)).filter((bill) => bill.dueIso >= ctx.today && bill.dueIso <= last).reduce((sum, bill) => sum + bill.pending, 0);
    return {
      id: 95, title: "Payment expected this week", columns: [int("no", "No."), text("name", "Customer"), int("bills", "Bills"), money("pending", "Expected"), date("first", "From")],
      rows: out.length === 0 ? [] : [...out.slice(0, 300).map((row, at) => ({ no: at + 1, name: row.name, bills: row.bills, pending: row.pending, first: dmy(row.first), code: row.code })), { no: 0, name: "Total", bills: list.length, pending: list.reduce((sum, bill) => sum + bill.pending, 0), first: "" }],
      note: `Till ${dmy(last)}. Bills expected to be paid by then from each customer's own payment habit (or its credit days), including bills already late. For comparison, bills falling due by their credit days this week come to ${grouping.format(due)}.`,
    };
  },
});

T.push({
  id: 90, question: "Which bills are due this week?", defaultPeriod: "none", terms: [/bills?|invoices?|payments?/, /\bdue\b/, /this week|week/], not: [/overdue|expect|call/],
  run: async (ctx) => {
    const last = iso(endOfWeek(ctx.today));
    const list = (await agewiseBills(ctx)).filter((bill) => bill.dueIso >= ctx.today && bill.dueIso <= last).sort((a, b) => a.dueIso.localeCompare(b.dueIso) || b.pending - a.pending);
    return { id: 90, title: "Bills due this week", columns: dueColumns, rows: list.slice(0, 500), note: `${list.length} bills, ${grandTotal(list)} pending, falling due from today to ${dmy(last)} (the bill date plus the account's credit days). ${AGEWISE_NOTE}` };
  },
});

T.push({
  id: 91, question: "Show overdue bills between 30 and 60 days.", defaultPeriod: "none", terms: [/overdue|over due|past due/, /between|from\s+\d+/, /bills?|invoices?/],
  run: async (ctx) => {
    const found = /between\s+(\d+)\s*(?:and|to|-)\s*(\d+)/i.exec(ctx.question ?? "") ?? /from\s+(\d+)\s*(?:and|to|-)\s*(\d+)/i.exec(ctx.question ?? "");
    const [low, high] = found ? [Math.min(Number(found[1]), Number(found[2])), Math.max(Number(found[1]), Number(found[2]))] : [30, 60];
    const list = (await agewiseBills(ctx)).filter((bill) => bill.overdueDays >= low && bill.overdueDays <= high).sort((a, b) => b.overdueDays - a.overdueDays || a.name.localeCompare(b.name));
    return { id: 91, title: `Bills overdue by ${low} to ${high} days`, columns: dueColumns, rows: list.slice(0, 500), note: `${list.length} bills, ${grandTotal(list)} pending. ${AGEWISE_NOTE}` };
  },
});

T.push({
  id: 92, question: "Which customer has the oldest outstanding bill?", defaultPeriod: "none", terms: [/oldest|earliest|longest/, /outstanding|pending|unpaid|open|due/, /bills?|invoices?|customers?/],
  run: async (ctx) => {
    const list = (await agewiseBills(ctx)).filter((bill) => bill.doc !== "Opening").sort((a, b) => a.billIso.localeCompare(b.billIso) || b.pending - a.pending);
    const opening = (await agewiseBills(ctx)).filter((bill) => bill.doc === "Opening").length;
    return { id: 92, title: "Oldest outstanding bills", columns: dueColumns, rows: list.slice(0, Math.max(ctx.top, 20)), note: `The oldest first (${list.length} open bills; ${opening} customers also have an opening balance from the year before that is not a bill). ${AGEWISE_NOTE}` };
  },
});

T.push({
  id: 93, question: "Show outstanding bills due today.", defaultPeriod: "none", terms: [/bills?|invoices?/, /due\s+today|due\s+on\s+today|falling due today|today.s due/],
  run: async (ctx) => {
    const list = (await agewiseBills(ctx)).filter((bill) => bill.dueIso === ctx.today).sort((a, b) => b.pending - a.pending);
    return { id: 93, title: "Outstanding bills due today", columns: dueColumns, rows: list.slice(0, 500), note: `${list.length} bills, ${grandTotal(list)} pending, due on ${dmy(ctx.today)} (the bill date plus the account's credit days). ${AGEWISE_NOTE}` };
  },
});

T.push({
  id: 94, question: "Which customers should I call for payment today?", defaultPeriod: "none", terms: [/call|phone|contact|follow ?up|remind|chase|ring/, /payments?|collect|dues?|outstanding|money/, /customers?|today|parties/],
  run: async (ctx) => {
    const all = await agewiseBills(ctx);
    const byParty = new Map<number, { code: number; name: string; bills: number; overdue: number; days: number; pending: number }>();
    for (const bill of all) {
      const entry = byParty.get(bill.code) ?? byParty.set(bill.code, { code: bill.code, name: bill.name, bills: 0, overdue: 0, days: 0, pending: 0 }).get(bill.code)!;
      entry.pending += bill.pending;
      if (bill.overdueDays >= 0) { entry.bills += 1; entry.overdue += bill.pending; entry.days = Math.max(entry.days, bill.overdueDays); }
    }
    const list = [...byParty.values()].filter((row) => row.bills > 0).sort((a, b) => b.overdue - a.overdue).slice(0, Math.max(ctx.top, 20));
    const phones = new Map((await rows(ctx, `SELECT code, btrim(COALESCE(mobile_no, '')) AS mobile, btrim(COALESCE(tel_no, '')) AS tel FROM ${ctx.sch}.address WHERE address_id = 1 AND code = ANY($1::int[])`, [list.map((row) => row.code)])).map((row) => [num(row.code), [String(row.mobile), String(row.tel)].filter((value) => value !== "").join(" / ")] as const));
    return {
      id: 94, title: "Customers to call for payment today", columns: [int("no", "No."), text("name", "Customer"), text("phone", "Phone"), int("bills", "Bills Due"), money("overdue", "Due or Overdue"), int("days", "Oldest (Days Overdue)"), money("pending", "Total Pending")],
      rows: list.map((row, at) => ({ no: at + 1, name: row.name, phone: phones.get(row.code) ?? "", bills: row.bills, overdue: row.overdue, days: row.days, pending: row.pending, code: row.code })),
      note: `Customers with a bill due today or already past due, the largest amount first (the phone is the mobile and telephone of the first address). ${AGEWISE_NOTE}`,
    };
  },
});

T.push({
  id: 96, question: "Which customers have exceeded their credit limit?", defaultPeriod: "none", terms: [/credit\s+limit|\blimit/, /exceed|cross|over|beyond|above|breach/],
  run: async (ctx) => {
    const limits = await rows(ctx, `SELECT code, "LIMIT"::numeric AS lim FROM ${ctx.sch}.account WHERE book = 2 AND a_pos <> 'D' AND COALESCE("LIMIT"::numeric, 0) > 0`);
    const bal = new Map((await balances(ctx, 2, limits.map((row) => num(row.code)))).map((row) => [row.code, row]));
    const list = limits.map((row) => ({ code: num(row.code), name: bal.get(num(row.code))?.name ?? "", limit: num(row.lim), balance: bal.get(num(row.code))?.closing ?? 0 })).filter((row) => row.balance > row.limit)
      .map((row) => ({ ...row, excess: row.balance - row.limit })).sort((a, b) => b.excess - a.excess);
    return {
      id: 96, title: "Customers over their credit limit", columns: [int("no", "No."), text("name", "Customer"), money("limit", "Credit Limit"), money("balance", "Balance"), money("excess", "Over By"), money("pct", "Over By %")],
      rows: list.map((row, at) => ({ no: at + 1, name: row.name, limit: row.limit, balance: row.balance, excess: row.excess, pct: (row.excess / row.limit) * 100, code: row.code })),
      note: `Balance as on ${dmy(ctx.today)} against the credit limit of the account (customers with a limit set; ${limits.length} have one).`,
    };
  },
});

T.push({
  id: 89, question: "Explain why this party's balance increased.", defaultPeriod: "month", needsParty: true, terms: [/why|explain|reason|how come|what made/, /balance/, /increas|rose|grew|higher|more|went up|up\b/],
  run: async (ctx) => {
    const party = ctx.party as Party;
    const account = (await rows(ctx, `SELECT book FROM ${ctx.sch}.account WHERE code = $1`, [party.code]))[0];
    const book = num(account?.book);
    const before = iso(new Date(new Date(`${ctx.period.from}T00:00:00`).getTime() - 86400000));
    const at = async (day: string) => (await balances({ ...ctx, today: day }, book, [party.code]))[0]?.closing ?? 0;
    const opening = await at(before);
    const closing = await at(ctx.period.to);
    const moves = await rows(ctx,
      `SELECT l.book, btrim(COALESCE(bp.book_desc, 'Book ' || l.book::text)) AS book_name, COUNT(*) AS entries, COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.ac_dbcode = 1), 0) AS debit, COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.ac_dbcode = 2), 0) AS credit`
      + ` FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.book_properties bp ON bp.book_key = l.book WHERE l.code = $1 AND l.doc_pos <> 'D' AND l.doc_posting = 'P' AND l.doc_date >= $2::date AND l.doc_date <= $3::date GROUP BY l.book, bp.book_desc ORDER BY GREATEST(SUM(l.amount::numeric) FILTER (WHERE l.ac_dbcode = 1), SUM(l.amount::numeric) FILTER (WHERE l.ac_dbcode = 2)) DESC NULLS LAST`,
      [party.code, ctx.period.from, ctx.period.to]);
    const change = closing - opening;
    const rowsOut = [
      { item: `Balance on ${dmy(before)}`, entries: "", debit: "", credit: "", balance: opening },
      ...moves.map((row) => ({ item: String(row.book_name), entries: num(row.entries), debit: num(row.debit), credit: num(row.credit), balance: num(row.debit) - num(row.credit) })),
      { item: `Balance on ${dmy(ctx.period.to)}`, entries: "", debit: "", credit: "", balance: closing },
    ];
    const biggest = moves.map((row) => ({ name: String(row.book_name), net: num(row.debit) - num(row.credit) })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net))[0];
    return {
      id: 89, title: `Why the balance of ${party.name} ${change >= 0 ? "increased" : "decreased"}`, columns: [text("item", "Item"), int("entries", "Entries"), money("debit", "Debit"), money("credit", "Credit"), money("balance", "Balance / Net")],
      rows: rowsOut, ledger: { code: party.code, name: party.name },
      note: `${ctx.period.label}. The balance ${change >= 0 ? "rose" : "fell"} by ${grouping.format(Math.abs(change))} (debit balance positive).${biggest ? ` The biggest movement is ${biggest.name}: ${grouping.format(biggest.net)} net.` : " There are no entries in the period."} Open the ledger for the entries.`,
    };
  },
});

T.push({
  id: 83, question: "Which customers have not purchased in the last 6 months?", defaultPeriod: "none", terms: [/customers?|parties/, /not (?:purchased|bought|ordered|buy)|haven.t|no (?:purchase|sale)s?|inactive|dormant|stopped|lapsed/, /\d+\s*months?|six|months/],
  run: async (ctx) => {
    const months = numberAfter(ctx.question ?? "", /(\d+)\s*months?/i) ?? (/\bsix\b/i.test(ctx.question ?? "") ? 6 : /\b(three|3)\b/i.test(ctx.question ?? "") ? 3 : 6);
    const today = new Date(`${ctx.today}T00:00:00`);
    const cutoff = iso(new Date(today.getFullYear(), today.getMonth() - months, today.getDate()));
    // The last sale of each customer in this year's database and in last year's (the company of the same name), by the customer's name.
    const last = new Map<string, { name: string; day: string }>();
    const schemas = [ctx.sch, await previousYearSchema(ctx, ctx.session.tarikh1)].filter((schema): schema is string => schema !== null);
    for (const schema of schemas) {
      for (const row of await rows(ctx, `SELECT btrim(ac.name) AS name, to_char(MAX(l.doc_date), 'YYYY-MM-DD') AS day FROM ${schema}.ledger l JOIN ${schema}.account ac ON ac.code = l.code WHERE l.book = ${SALE} AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND ac.book = 2 GROUP BY ac.name`)) {
        const key = String(row.name).toLowerCase();
        const kept = last.get(key);
        if (!kept || String(row.day) > kept.day) last.set(key, { name: String(row.name), day: String(row.day) });
      }
    }
    const list = [...last.values()].filter((row) => row.day < cutoff).sort((a, b) => b.day.localeCompare(a.day));
    return {
      id: 83, title: `Customers with no purchase in ${months} months`, columns: [int("no", "No."), text("name", "Customer"), date("last", "Last Purchase"), int("days", "Days Ago")],
      rows: list.slice(0, 500).map((row, at) => ({ no: at + 1, name: row.name, last: dmy(row.day), days: Math.round((today.getTime() - new Date(`${row.day}T00:00:00`).getTime()) / 86400000) })),
      note: `Customers who bought before ${dmy(cutoff)} (this year's and last year's sales) but not since, the most recent first. ${list.length} customers.`,
    };
  },
});

/** Last month's days against this month's so far, with last month's database where it is in the year before. */
async function monthPair(ctx: Ctx) {
  const today = new Date(`${ctx.today}T00:00:00`);
  const thisFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastTo = new Date(lastFrom.getFullYear(), lastFrom.getMonth(), Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth(), 0).getDate()));
  const lastSchema = lastFrom < ctx.session.tarikh1 ? await previousYearSchema(ctx, ctx.session.tarikh1) : ctx.sch;
  return { today, thisFrom, lastFrom, lastTo, lastCtx: lastSchema ? { ...ctx, sch: lastSchema } : null };
}

T.push({
  id: 84, question: "Which customers' sales have decreased?", defaultPeriod: "none", terms: [/customers?|parties/, /sales?|purchas|buying|business|order/, /decreas|drop|fall|fell|declin|reduc|lower|\bless\b|down/], not: [/why|reason|explain|balance|supplier|product|compar/],
  run: async (ctx) => {
    const pair = await monthPair(ctx);
    if (!pair.lastCtx) return { id: 84, title: "Customers whose sales decreased", columns: [text("name", "Customer")], rows: [], note: "Last month is in the previous year, whose database was not found on this server." };
    const now = await salesWindow(ctx, iso(pair.thisFrom), iso(pair.today));
    const before = await salesWindow(pair.lastCtx, iso(pair.lastFrom), iso(pair.lastTo));
    const list = [...before.parties.entries()].map(([key, row]) => ({ name: row.name, last: row.net, current: now.parties.get(key)?.net ?? 0 })).map((row) => ({ ...row, change: row.current - row.last }))
      .filter((row) => row.change < 0 && row.last > 0).sort((a, b) => a.change - b.change);
    return {
      id: 84, title: "Customers whose sales decreased", columns: [int("no", "No."), text("name", "Customer"), money("last", "Last Month"), money("current", "This Month"), money("change", "Change"), money("pct", "Change %")],
      rows: list.slice(0, 300).map((row, at) => ({ no: at + 1, name: row.name, last: row.last, current: row.current, change: row.change, pct: (row.change / row.last) * 100 })),
      note: `${dmy(pair.thisFrom)} to ${dmy(pair.today)} against ${dmy(pair.lastFrom)} to ${dmy(pair.lastTo)}: ${list.length} customers bought less, the biggest fall first. ${SALES_NOTE}`,
    };
  },
});

T.push({
  id: 85, question: "Show customers with no transactions this year.", defaultPeriod: "none", terms: [/customers?|parties/, /no (?:transactions?|entries|activity|business)|without (?:any )?(?:transactions?|entries)|inactive|zero transactions?|never/, /year|so far|till now/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT btrim(ac.name) AS name, ac.code, COALESCE(MAX(ab.opening::numeric), 0) AS opening FROM ${ctx.sch}.account ac LEFT JOIN ${ctx.sch}.ac_balance ab ON ab.code = ac.code AND ab.year_id = $1`
      + ` WHERE ac.book = 2 AND ac.a_pos <> 'D' AND NOT EXISTS (SELECT 1 FROM ${ctx.sch}.ledger l WHERE l.code = ac.code AND l.doc_pos <> 'D') GROUP BY ac.code, ac.name ORDER BY ac.name LIMIT 1000`, [ctx.session.yearId]);
    return {
      id: 85, title: "Customers with no transactions this year", columns: [int("no", "No."), text("name", "Customer"), money("opening", "Opening Balance")],
      rows: found.map((row, at) => ({ no: at + 1, name: String(row.name), opening: num(row.opening), code: num(row.code) })),
      note: `Customers (debtor accounts) with no entry at all in this accounting year, ${found.length} of them; those with an opening balance still owe it.`,
    };
  },
});

T.push({
  id: 86, question: "Which suppliers have the highest purchase value?", defaultPeriod: "year", terms: [/suppliers?|vendors?/, /highest|most|top|biggest|largest/, /purchas/, /value|amount|total/], not: [/outstanding|overdue|owe|payable|pending|product|item/],
  run: async (ctx) => { const answer = await (T.find((template) => template.id === 62) as Template).run(ctx); return { ...answer, id: 86 }; },
});

T.push({
  id: 87, question: "Show suppliers whose outstanding increased this month.", defaultPeriod: "none", terms: [/suppliers?|vendors?/, /outstanding|payable|balance|owe|due/, /increas|rose|higher|more|grew|up\b/, /this month|month/],
  run: async (ctx) => {
    const today = new Date(`${ctx.today}T00:00:00`);
    const endLast = iso(new Date(today.getFullYear(), today.getMonth(), 0));
    const now = new Map((await balances(ctx, 3)).map((row) => [row.code, row]));
    const before = new Map((await balances({ ...ctx, today: endLast }, 3)).map((row) => [row.code, row]));
    const list = [...now.values()].map((row) => ({ code: row.code, name: row.name, last: owed(3, before.get(row.code) ?? { ...row, closing: 0 }), current: owed(3, row) })).map((row) => ({ ...row, change: row.current - row.last })).filter((row) => row.change > 0).sort((a, b) => b.change - a.change);
    return {
      id: 87, title: "Suppliers whose outstanding increased this month", columns: [int("no", "No."), text("name", "Supplier"), money("last", `On ${dmy(endLast)}`), money("current", `On ${dmy(ctx.today)}`), money("change", "Increase")],
      rows: list.slice(0, 300).map((row, at) => ({ no: at + 1, name: row.name, last: row.last, current: row.current, change: row.change, code: row.code })),
      note: `What is owed to each supplier (credit balance) at the end of last month and today; ${list.length} suppliers owe more now, the biggest increase first.`,
    };
  },
});

T.push({
  id: 88, question: "Which suppliers have pending bills?", defaultPeriod: "none", terms: [/suppliers?|vendors?/, /pending|unpaid|open|outstanding|due/, /bills?|invoices?/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT ac.code, btrim(ac.name) AS name, COUNT(*) AS bills, SUM(o.out_entryamt::numeric - COALESCE(s.setoff, 0) - o.out_ly_setoff::numeric) AS pending, MIN(led.doc_date) AS oldest`
      + ` FROM ${ctx.sch}.outclear o JOIN ${ctx.sch}.account ac ON ac.code = o.code JOIN ${ctx.sch}.ledger led ON led.led_key = o.out_ledid`
      + ` LEFT JOIN (SELECT out_ag_outid, SUM(out_setoff::numeric) AS setoff FROM ${ctx.sch}.outclear WHERE out_date <= $1::date GROUP BY out_ag_outid) s ON s.out_ag_outid = o.out_key`
      + ` WHERE o.out_dbcode = 2 AND o.out_ag_outid IS NULL AND ac.book = 3 AND ac.os_flag <> 'N' AND ac.a_pos <> 'D' AND led.doc_pos <> 'D' AND led.doc_date <= $1::date AND (o.out_entryamt::numeric - COALESCE(s.setoff, 0) - o.out_ly_setoff::numeric) > 0`
      + ` GROUP BY ac.code, ac.name ORDER BY pending DESC LIMIT 500`, [ctx.today]);
    const total = found.reduce((sum, row) => sum + num(row.pending), 0);
    return {
      id: 88, title: "Suppliers with pending bills", columns: [int("no", "No."), text("name", "Supplier"), int("bills", "Pending Bills"), money("pending", "Pending"), date("oldest", "Oldest Bill")],
      rows: found.length === 0 ? [] : [...found.map((row, at) => ({ no: at + 1, name: String(row.name), bills: num(row.bills), pending: num(row.pending), oldest: dmy(row.oldest), code: num(row.code) })), { no: 0, name: "Total", bills: found.reduce((sum, row) => sum + num(row.bills), 0), pending: total, oldest: "" }],
      note: `The purchase bills of suppliers not yet fully paid, as on ${dmy(ctx.today)} (the outstanding of the Creditor ledger, bill by bill).`,
    };
  },
});

T.push({
  id: 81, question: "Which invoices were entered today but have an older bill date?", defaultPeriod: "none", terms: [/entered|entry|booked|posted|keyed|saved/, /today/, /older|back.?dated|previous|past|old\b|earlier/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, to_char(l.last_savedate, 'DD/Mon/YYYY') AS entered, l.last_savetime AS at, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, l.amount::numeric AS amount, CASE WHEN l.book = ${SALE} THEN 'Sale' ELSE 'Purchase' END AS kind, ($1::date - l.doc_date::date) AS days, l.code`
      + ` FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE l.book IN (${SALE}, ${PURCHASE}) AND l.doc_pos = 'A' AND l.last_savedate::date = $1::date AND l.doc_date::date < $1::date ORDER BY l.doc_date, l.led_key LIMIT 500`, [ctx.today]);
    return {
      id: 81, title: "Invoices entered today with an older bill date", columns: [text("kind", "Book"), text("doc", "Invoice"), date("d", "Bill Date"), int("days", "Days Back"), text("party", "Party"), money("amount", "Amount"), text("at", "Entered At")],
      rows: found.map((row) => ({ kind: String(row.kind), doc: String(row.doc ?? ""), d: dmy(row.d), days: num(row.days), party: String(row.party ?? ""), amount: num(row.amount), at: String(row.at ?? ""), code: num(row.code) })),
      note: `Sale and purchase invoices last saved on ${dmy(ctx.today)} whose bill date is earlier. The save date is that of the last save of the entry, so an old entry edited today shows here too.`,
    };
  },
});

T.push({
  id: 82, question: "Show invoices above 50000", defaultPeriod: "year", terms: [/invoices?|bills?/, /above|over|greater than|more than|exceed|bigger than|>/, /\d[\d,]{3,}/], not: [/overdue|days|older|credit limit|outstanding|stock|purchase|supplier/],
  run: async (ctx) => {
    const limit = numberAfter(ctx.question ?? "", /(?:above|over|greater than|more than|exceed(?:ing|s)?|bigger than|>)\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d+)?)/i) ?? 50000;
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, l.amount::numeric AS amount, l.code FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = ${SALE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND l.amount::numeric > $3 ORDER BY l.amount::numeric DESC LIMIT 500`, [ctx.period.from, ctx.period.to, limit]);
    const total = found.reduce((sum, row) => sum + num(row.amount), 0);
    return {
      id: 82, title: `Sale invoices above ${grouping.format(limit)}`, columns: [date("d", "Date"), text("doc", "Invoice"), text("party", "Party"), money("amount", "Amount")],
      rows: found.length === 0 ? [] : [...found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount), code: num(row.code) })), { d: "", doc: "", party: `Total (${found.length})`, amount: total }],
      note: `${ctx.period.label}. Sale invoices (with tax) larger than ${grouping.format(limit)}, the largest first. Say another amount, for example "show invoices above 1,00,000".`,
    };
  },
});

/** Who did what to an entry today, from the special log (<company>_biglog.log_entry); a deleted entry is also found from the ledger when there is no log. */
async function logToday(ctx: Ctx, id: number, title: string, mode: "D" | "E"): Promise<AskAnswer> {
  const log = `${ctx.sch}_biglog`;
  const hasLog = (await rows(ctx, "SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'log_entry'", [log])).length > 0;
  const columns = [text("doc", "Entry"), text("party", "Party"), money("amount", "Amount"), text("who", "By"), text("at", "Time")];
  if (hasLog) {
    const found = await rows(ctx,
      `SELECT l.lentry_savetime AS at, COALESCE(led.full_docno, proce.full_docno, '') AS doc, btrim(COALESCE(ac.name, '')) AS party, COALESCE(led.amount::numeric, proce.p_amount::numeric, 0) AS amount, COALESCE(us.login_name, '') AS who, l.lentry_code AS code`
      + ` FROM ${log}.log_entry l LEFT JOIN ${ctx.sch}.ledger led ON led.led_key = l.lentry_ledid LEFT JOIN ${ctx.sch}.process proce ON proce.process_key = l.lentry_processid LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.lentry_code`
      + ` LEFT JOIN ${SYSTEM_SCHEMA}.user_master us ON us.user_no = l.lentry_user WHERE l.lentry_mode = $1 AND l.lentry_savedate >= $2::date AND l.lentry_savedate < $2::date + 1 ORDER BY l.lentry_key LIMIT 500`, [mode, ctx.today]);
    return { id, title, columns, rows: found.map((row) => ({ doc: String(row.doc), party: String(row.party), amount: num(row.amount), who: String(row.who), at: String(row.at ?? ""), code: num(row.code) })), note: `${dmy(ctx.today)}, from the entry log (LOG_ENTRY): ${found.length} entries.` };
  }
  if (mode === "E") return { id, title, columns, rows: [], note: "There is no entry log in this company (the special log is kept only when the setup's log file is S), so edits cannot be listed." };
  const found = await rows(ctx,
    `SELECT l.last_savetime AS at, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, l.amount::numeric AS amount, l.code FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE l.doc_pos = 'D' AND l.last_savedate::date = $1::date ORDER BY l.led_key LIMIT 500`, [ctx.today]);
  return { id, title, columns, rows: found.map((row) => ({ doc: String(row.doc ?? ""), party: String(row.party), amount: num(row.amount), who: "", at: String(row.at ?? ""), code: num(row.code) })), note: `${dmy(ctx.today)}, from the ledger (the company keeps no entry log, so who deleted them is not known): ${found.length} entries.` };
}

T.push({ id: 97, question: "Which entries were deleted today?", defaultPeriod: "none", terms: [/delet/, /entries|entry|vouchers?|invoices?|bills?/, /today/], run: (ctx) => logToday(ctx, 97, "Entries deleted today", "D") });
T.push({ id: 98, question: "Which vouchers were modified today?", defaultPeriod: "none", terms: [/modif|edit|chang|updat|amend|alter/, /vouchers?|entries|entry|invoices?|bills?/, /today/], run: (ctx) => logToday(ctx, 98, "Vouchers modified today", "E") });

T.push({
  id: 99, question: "Find vouchers with missing narration.", defaultPeriod: "year", terms: [/missing|without|no\b|blank|empty|not entered/, /narration|remark/, /vouchers?|entries|entry/],
  run: async (ctx) => {
    // Vouchers are the entries of the books other than the sale, purchase, debit note and credit note; a voucher is listed when none of its lines carries a narration.
    const found = await rows(ctx,
      `SELECT MIN(l.doc_date) AS d, l.full_docno AS doc, MIN(btrim(COALESCE(ac.name, ''))) AS party, MAX(l.amount::numeric) AS amount, btrim(COALESCE(bp.book_desc, 'Book ' || l.book::text)) AS book_name, MIN(l.code) AS code`
      + ` FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code LEFT JOIN ${ctx.sch}.book_properties bp ON bp.book_key = l.book WHERE l.doc_pos = 'A' AND l.book NOT IN (${SALE}, ${PURCHASE}, 11, ${CREDIT_NOTE})`
      + ` AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY l.book, bp.book_desc, l.full_docno HAVING bool_and(btrim(COALESCE(l.narration, '')) = '') ORDER BY MIN(l.doc_date), l.full_docno LIMIT 1000`, [ctx.period.from, ctx.period.to]);
    return {
      id: 99, title: "Vouchers with missing narration", columns: [date("d", "Date"), text("book", "Book"), text("doc", "Voucher"), text("party", "Party"), money("amount", "Amount")],
      rows: found.map((row) => ({ d: dmy(row.d), book: String(row.book_name), doc: String(row.doc ?? ""), party: String(row.party ?? ""), amount: num(row.amount), code: num(row.code) })),
      note: `${ctx.period.label}. Vouchers (cash, bank, journal, expense and the other books apart from sale, purchase and their notes) whose lines have no narration; ${found.length} found (at most 1,000 are shown).`,
    };
  },
});

T.push({
  id: 100, question: "Show ledger balances that are different from the previous month.", defaultPeriod: "none", terms: [/balances?/, /differ|changed|change|vary|moved/, /previous month|last month|month/],
  run: async (ctx) => {
    const today = new Date(`${ctx.today}T00:00:00`);
    const endLast = iso(new Date(today.getFullYear(), today.getMonth(), 0));
    const list: { name: string; kind: string; last: number; current: number; change: number; code: number }[] = [];
    for (const [book, kind] of [[2, "Customer"], [3, "Supplier"]] as const) {
      const before = new Map((await balances({ ...ctx, today: endLast }, book)).map((row) => [row.code, row]));
      for (const row of await balances(ctx, book)) {
        const last = before.get(row.code)?.closing ?? 0;
        if (Math.abs(row.closing - last) >= 0.005) list.push({ name: row.name, kind, last, current: row.closing, change: row.closing - last, code: row.code });
      }
    }
    list.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return {
      id: 100, title: "Ledger balances different from the previous month", columns: [int("no", "No."), text("name", "Account"), text("kind", "Type"), money("last", `On ${dmy(endLast)}`), money("current", `On ${dmy(ctx.today)}`), money("change", "Change")],
      rows: list.slice(0, 500).map((row, at) => ({ no: at + 1, name: row.name, kind: row.kind, last: row.last, current: row.current, change: row.change, code: row.code })),
      note: `The balance of each customer and supplier at the end of last month against today (debit balance positive), ${list.length} accounts changed, the biggest change first.`,
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Trends and what needs attention (I)

/** Net sales of each of the last months (this month so far), the earlier ones from last year's database where this year does not reach back. */
async function recentSales(ctx: Ctx, months: number) {
  const today = new Date(`${ctx.today}T00:00:00`);
  const from = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  const yearStart = ctx.session.tarikh1;
  const list: { month: string; net: number; entries: number; partial: boolean }[] = [];
  if (from < yearStart) {
    const lastSchema = await previousYearSchema(ctx, yearStart);
    if (lastSchema) for (const row of await netSalesMonthly({ ...ctx, sch: lastSchema }, iso(from), iso(new Date(yearStart.getFullYear(), yearStart.getMonth(), yearStart.getDate() - 1)))) list.push({ month: row.month, net: row.net, entries: row.entries, partial: false });
  }
  for (const row of await netSalesMonthly(ctx, iso(from < yearStart ? yearStart : from), ctx.today)) list.push({ month: row.month, net: row.net, entries: row.entries, partial: false });
  if (list.length > 0) list[list.length - 1] = { ...list[list.length - 1], partial: list[list.length - 1].month === `${MONTHS_SHORT[today.getMonth()]}-${today.getFullYear()}` && today.getDate() < new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() };
  return list;
}

T.push({
  id: 101, question: "Are sales increasing or decreasing?", defaultPeriod: "none", terms: [/sales?|sold|revenue|business/, /increas|decreas|grow|declin|trend|rising|falling|up or down|going up|going down|improv/], not: [/customer|party|product|why|reason|expense|purchas|compar/],
  run: async (ctx) => {
    // The whole financial year so far (at least six months, taking the months before the year from last year's database), or the months the question names ("last 12 months").
    const today = new Date(`${ctx.today}T00:00:00`);
    const sinceStart = (today.getFullYear() - ctx.session.tarikh1.getFullYear()) * 12 + today.getMonth() - ctx.session.tarikh1.getMonth() + 1;
    const asked = numberAfter(ctx.question ?? "", /(\d+)\s*months?/i);
    const count = Math.min(36, Math.max(2, asked ?? Math.max(6, sinceStart)));
    const list = await recentSales(ctx, count);
    const complete = list.filter((row) => !row.partial);
    const rowsOut = list.map((row, at) => {
      const before = at === 0 ? null : list[at - 1].net;
      return { month: row.partial ? `${row.month} (so far)` : row.month, net: row.net, entries: row.entries, diff: before === null ? 0 : row.net - before, pct: before === null || before === 0 ? 0 : ((row.net - before) / Math.abs(before)) * 100 };
    });
    const average = (part: typeof complete) => (part.length === 0 ? 0 : part.reduce((sum, row) => sum + row.net, 0) / part.length);
    let verdict = "There are not enough complete months to see a trend.";
    if (complete.length >= 2) {
      const recentMonths = complete.slice(-3);
      const earlierMonths = complete.length >= 4 ? complete.slice(-6, -3) : complete.slice(-2, -1);
      const recent = average(recentMonths);
      const earlier = average(earlierMonths);
      const change = earlier === 0 ? 0 : ((recent - earlier) / Math.abs(earlier)) * 100;
      const span = (part: typeof complete) => (part.length === 1 ? part[0].month : `${part[0].month} to ${part[part.length - 1].month}`);
      const figures = `${span(recentMonths)} averaged ${grouping.format(recent)} a month against ${grouping.format(earlier)} for ${span(earlierMonths)}`;
      verdict = Math.abs(change) < 3 ? `Sales are about flat (${change >= 0 ? "+" : ""}${change.toFixed(1)}%): ${figures}.` : change > 0 ? `Sales are increasing, up ${change.toFixed(1)}%: ${figures}.` : `Sales are decreasing, down ${(-change).toFixed(1)}%: ${figures}.`;
    }
    const partial = list.some((row) => row.partial);
    return {
      id: 101, title: `Sales trend, ${list.length} months`, summary: verdict, columns: [text("month", "Month"), int("entries", "Entries"), money("net", "Net Sales"), money("diff", "Change from Last Month"), money("pct", "Change %")],
      rows: rowsOut, ...(rowsOut.length > 0 ? { chart: { label: "month", value: "net", count: rowsOut.length } } : {}),
      note: `The verdict compares the average of the last three complete months with the three before them.${partial ? " The month marked (so far) is only up to today, so it is left out of the verdict." : ""} ${SALES_NOTE}`,
    };
  },
});

T.push({
  id: 102, question: "What is tying up most of our working capital?", defaultPeriod: "none", terms: [/working capital|tied up|tying up|blocked|locked|stuck/, /what|which|most|where|biggest|capital/],
  run: async (ctx) => {
    const customers = (await balances(ctx, 2)).filter((row) => row.closing > 0).sort((a, b) => b.closing - a.closing);
    const suppliers = (await balances(ctx, 3)).filter((row) => row.closing < 0);
    const stock = await stockValue(ctx, 0, "", true);
    const stockTotal = num(stock.rows[stock.rows.length - 1]?.value);
    const receivable = customers.reduce((sum, row) => sum + row.closing, 0);
    const payable = suppliers.reduce((sum, row) => sum - row.closing, 0);
    const tied = receivable + stockTotal;
    const share = (value: number) => (tied === 0 ? 0 : (value / tied) * 100);
    const heading = (item: string) => ({ item, value: "", share: "", detail: "" });
    const bigger = receivable >= stockTotal ? "customers' outstanding (money to collect)" : "stock";
    return {
      id: 102, title: "What ties up the working capital", columns: [text("item", "Item"), money("value", "Amount"), money("share", "% of Receivable and Stock")],
      rows: [
        { item: "Customers owe (receivable)", value: receivable, share: share(receivable), detail: "owe:2" },
        { item: "Stock on hand, at cost", value: stockTotal, share: share(stockTotal), detail: "stock" },
        { item: "Tied up in receivable and stock", value: tied, share: 100, detail: "" },
        { item: "Less: owed to suppliers (payable)", value: -payable, share: "", detail: "owe:3" },
        { item: "Net working capital (without cash and bank)", value: tied - payable, share: "", detail: "" },
        heading("Customers who owe the most"), ...customers.slice(0, 5).map((row) => ({ item: `  ${row.name}`, value: row.closing, share: share(row.closing), code: row.code, detail: `bills:${row.code}` })),
        heading("Products with the most stock value"), ...stock.rows.slice(0, 5).map((row) => ({ item: `  ${String(row.name)}`, value: num(row.value), share: share(num(row.value)), detail: `prod:${num(row.pk)}` })),
      ],
      note: `As on ${dmy(ctx.today)}. Most is tied up in ${bigger}. Cash and bank are not counted. Stock is valued at average cost (opening stock at its opening rate with the year's purchases up to today); customers in credit are not counted.`,
    };
  },
});

T.push({
  id: 103, question: "Compare sales, purchases and collections this month.", defaultPeriod: "none", terms: [/sales?/, /purchas/, /collection|receipt|received|receive/, /compar|versus|\bvs\b|month/],
  run: async (ctx) => {
    const pair = await monthPair(ctx);
    if (!pair.lastCtx) return { id: 103, title: "Sales, purchases and collections", columns: [text("item", "Item")], rows: [], note: "Last month is in the previous year, whose database was not found on this server." };
    const figures = async (c: Ctx, from: string, to: string) => ({
      sales: (await netSales(c, from, to, false))[0].net, purchases: (await bookTotal(c, PURCHASE, from, to)).total,
      collections: num((await rows(c, `SELECT COALESCE(SUM(amount::numeric), 0) AS total FROM ${c.sch}.ledger WHERE book IN (4, 6) AND ac_dbcode = 2 AND doc_pos = 'A' AND doc_date >= $1::date AND doc_date <= $2::date`, [from, to]))[0]?.total),
    });
    const now = await figures(ctx, iso(pair.thisFrom), iso(pair.today));
    const before = await figures(pair.lastCtx, iso(pair.lastFrom), iso(pair.lastTo));
    const line = (item: string, last: number, current: number) => ({ item, last, current, change: current - last, pct: last === 0 ? "" : ((current - last) / Math.abs(last)) * 100 });
    return {
      id: 103, title: "Sales, purchases and collections this month", columns: [text("item", "Item"), money("last", "Last Month"), money("current", "This Month"), money("change", "Change"), money("pct", "Change %")],
      rows: [line("Net sales (before tax)", before.sales, now.sales), line("Purchases (with tax)", before.purchases, now.purchases), line("Collections (cash and bank received)", before.collections, now.collections),
        { item: "Collections as % of sales", last: before.sales === 0 ? "" : (before.collections / before.sales) * 100, current: now.sales === 0 ? "" : (now.collections / now.sales) * 100, change: "", pct: "" }],
      note: `${dmy(pair.thisFrom)} to ${dmy(pair.today)} against ${dmy(pair.lastFrom)} to ${dmy(pair.lastTo)}. ${SALES_NOTE} Collections are the money received in the cash and bank books, whoever it came from.`,
    };
  },
});

/** The expense accounts of the month so far against last month's same days, with each one's increase. */
async function expenseChanges(ctx: Ctx) {
  const pair = await monthPair(ctx);
  const read = async (c: Ctx | null, from: string, to: string) => new Map((c ? await rows(c, `SELECT btrim(ac.name) AS name, SUM(l.amount::numeric) AS amount FROM ${c.sch}.ledger l JOIN ${c.sch}.account ac ON ac.code = l.code WHERE l.book = 15 AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY ac.name`, [from, to]) : []).map((row) => [String(row.name).toLowerCase(), { name: String(row.name), amount: num(row.amount) }] as const));
  const now = await read(ctx, iso(pair.thisFrom), iso(pair.today));
  const before = await read(pair.lastCtx, iso(pair.lastFrom), iso(pair.lastTo));
  const keys = new Set([...now.keys(), ...before.keys()]);
  const list = [...keys].map((key) => ({ name: now.get(key)?.name ?? before.get(key)?.name ?? "", last: before.get(key)?.amount ?? 0, current: now.get(key)?.amount ?? 0 })).map((row) => ({ ...row, change: row.current - row.last, pct: row.last === 0 ? 100 : ((row.current - row.last) / row.last) * 100 }));
  return { pair, list, totalNow: [...now.values()].reduce((sum, row) => sum + row.amount, 0), totalBefore: [...before.values()].reduce((sum, row) => sum + row.amount, 0) };
}

T.push({
  id: 104, question: "Which expenses increased significantly?", defaultPeriod: "none", terms: [/expenses?|expenditure|spending|costs?/, /significant|sharp|big|large|substantial|jump|spike|a lot|heavily|much/, /increas|rose|grew|higher|more|up\b|jump|spike/],
  run: async (ctx) => {
    const percent = numberAfter(ctx.question ?? "", /(\d+)\s*%/) ?? 25;
    const { pair, list } = await expenseChanges(ctx);
    const big = list.filter((row) => row.change >= 5000 && row.pct >= percent).sort((a, b) => b.change - a.change);
    return {
      id: 104, title: "Expenses that increased significantly", columns: [int("no", "No."), text("name", "Expense"), money("last", "Last Month"), money("current", "This Month"), money("change", "Increase"), money("pct", "Increase %")],
      rows: big.slice(0, 300).map((row, at) => ({ no: at + 1, name: row.name, last: row.last, current: row.current, change: row.change, pct: row.pct, detail: `exp:${encodeURIComponent(row.name)}:${iso(pair.thisFrom)}:${ctx.today}:${iso(pair.lastFrom)}:${iso(pair.lastTo)}` })),
      note: `${dmy(pair.thisFrom)} to ${dmy(pair.today)} against ${dmy(pair.lastFrom)} to ${dmy(pair.lastTo)}. An increase counts as significant when it is at least 5,000 and at least ${percent}% (say another percentage in the question, for example "expenses that increased by more than 50%"). An expense that is new this month shows 100%.`,
    };
  },
});

/** The question of each concern, to the template that answers it (a row of the concerns opens that answer). */
const CONCERN_ANSWERS: Readonly<Record<string, number>> = {
  "Which customers have overdue payments?": 2, "Why did sales decrease compared with last month?": 71, "Which expenses increased significantly?": 104, "Which customers have exceeded their credit limit?": 96,
  "Show products with negative stock.": 32, "Which products are selling at a loss?": 72, "How much do I owe to suppliers?": 4,
};

T.push({
  id: 105, question: "Show the five biggest financial concerns this month.", defaultPeriod: "none", terms: [/concerns?|worr|risks?|problems?|issues?|red flags?|attention|warning/, /five|5|biggest|top|main|major|key|financial|business/],
  run: async (ctx) => {
    // Each check gives a severity from 0 to 100 and the question that explains it; the five most severe are shown.
    type Concern = { name: string; figure: number; detail: string; ask: string; severity: number };
    const concerns: Concern[] = [];
    const bills = await agewiseBills(ctx);
    const pending = bills.reduce((sum, bill) => sum + bill.pending, 0);
    const overdue = bills.filter((bill) => bill.overdueDays > 0).reduce((sum, bill) => sum + bill.pending, 0);
    const over90 = bills.filter((bill) => bill.overdueDays > 90).reduce((sum, bill) => sum + bill.pending, 0);
    if (pending > 0 && overdue > 0) concerns.push({ name: "Overdue payments from customers", figure: overdue, detail: `${((overdue / pending) * 100).toFixed(0)}% of the ${grouping.format(pending)} outstanding is past its due date; ${grouping.format(over90)} is over 90 days.`, ask: "Which customers have overdue payments?", severity: Math.min(100, (overdue / pending) * 100 + (over90 / pending) * 40) });
    const pair = await monthPair(ctx);
    if (pair.lastCtx) {
      const now = (await netSales(ctx, iso(pair.thisFrom), iso(pair.today), false))[0].net;
      const before = (await netSales(pair.lastCtx, iso(pair.lastFrom), iso(pair.lastTo), false))[0].net;
      if (before > 0 && now < before) concerns.push({ name: "Sales are lower than last month", figure: before - now, detail: `Net sales ${grouping.format(now)} against ${grouping.format(before)} in the last month (${(((now - before) / before) * 100).toFixed(1)}%).`, ask: "Why did sales decrease compared with last month?", severity: Math.min(100, ((before - now) / before) * 150) });
    }
    const expenses = await expenseChanges(ctx);
    const rise = expenses.list.filter((row) => row.change >= 5000 && row.pct >= 25);
    if (rise.length > 0) concerns.push({ name: "Expenses have jumped", figure: rise.reduce((sum, row) => sum + row.change, 0), detail: `${rise.length} expense accounts are up by 25% or more${expenses.totalBefore > 0 ? `; all expenses ${(((expenses.totalNow - expenses.totalBefore) / expenses.totalBefore) * 100).toFixed(0)}% against the last month` : ""}.`, ask: "Which expenses increased significantly?", severity: Math.min(100, expenses.totalBefore > 0 ? Math.max(0, ((expenses.totalNow - expenses.totalBefore) / expenses.totalBefore) * 100) + rise.length * 3 : 30) });
    const limits = await rows(ctx, `SELECT code, "LIMIT"::numeric AS lim FROM ${ctx.sch}.account WHERE book = 2 AND a_pos <> 'D' AND COALESCE("LIMIT"::numeric, 0) > 0`);
    const over = (await balances(ctx, 2, limits.map((row) => num(row.code)))).filter((row) => row.closing > num(limits.find((limit) => num(limit.code) === row.code)?.lim));
    if (over.length > 0) concerns.push({ name: "Customers over their credit limit", figure: over.length, detail: `${over.length} customers owe more than the limit set on their account.`, ask: "Which customers have exceeded their credit limit?", severity: Math.min(100, 35 + over.length * 8) });
    const negative = (await (T.find((template) => template.id === 32) as Template).run(ctx)).rows.length;
    if (negative > 0) concerns.push({ name: "Products with negative stock", figure: negative, detail: `${negative} products show less than zero in stock, so entries or stock are wrong somewhere.`, ask: "Show products with negative stock.", severity: Math.min(100, 30 + negative * 4) });
    const year = await productProfits({ ...ctx, period: { ...ctx.period, from: iso(ctx.session.tarikh1), to: ctx.today } });
    const losses = year.filter((row) => row.profit < 0 && row.cost > 0);
    const salesTotal = year.reduce((sum, row) => sum + row.value, 0);
    if (losses.length > 0) concerns.push({ name: "Products selling at a loss", figure: -losses.reduce((sum, row) => sum + row.profit, 0), detail: `${losses.length} products sold for less than their cost this year${salesTotal > 0 ? ` (${((-losses.reduce((sum, row) => sum + row.profit, 0) / salesTotal) * 100).toFixed(1)}% of sales)` : ""}.`, ask: "Which products are selling at a loss?", severity: Math.min(100, salesTotal > 0 ? (-losses.reduce((sum, row) => sum + row.profit, 0) / salesTotal) * 600 : 30) });
    const creditors = (await balances(ctx, 3)).filter((row) => row.closing < 0).reduce((sum, row) => sum - row.closing, 0);
    const debtors = (await balances(ctx, 2)).filter((row) => row.closing > 0).reduce((sum, row) => sum + row.closing, 0);
    if (creditors > debtors * 1.5 && creditors > 0) concerns.push({ name: "More owed to suppliers than customers owe", figure: creditors - debtors, detail: `Suppliers are owed ${grouping.format(creditors)} while customers owe ${grouping.format(debtors)}: payments may be hard to meet.`, ask: "How much do I owe to suppliers?", severity: Math.min(100, ((creditors - debtors) / creditors) * 70) });
    const top = concerns.sort((a, b) => b.severity - a.severity).slice(0, 5);
    return {
      id: 105, title: "The biggest financial concerns this month", columns: [int("no", "No."), text("name", "Concern"), money("figure", "Amount / Count"), text("what", "What it is"), text("ask", "Ask next")],
      rows: top.map((row, at) => ({ no: at + 1, name: row.name, figure: row.figure, what: row.detail, ask: row.ask, detail: `tpl:${CONCERN_ANSWERS[row.ask] ?? 0}` })),
      note: `As on ${dmy(ctx.today)}. Checks made: overdue receivables, sales against last month, expense jumps, credit limits, negative stock, products sold at a loss and payables against receivables; the most severe are shown (${concerns.length} found). Copy the question under "Ask next" to see the details.`,
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// GST checks (J)
//
// A sale line's GST is read from its LEDGER_EXT rows (the slabs of the line: the rate and the amount of each, IGST for another state, CGST and SGST for the
// same one), as the GST reports of the program take it; the rate is the CGST and SGST together. The Sale book and the notes against it (a credit note
// takes off, a debit note adds) are the sales.

const GST_BOOKS = `(l.book = ${SALE} OR (l.book IN (11, ${CREDIT_NOTE}) AND l.ag_book = ${SALE}))`;
const GST_SIGN = `(CASE WHEN l.book = ${CREDIT_NOTE} THEN -1 ELSE 1 END)`;
/** The GST rate and amount of every stock line (a CTE named gst). */
const gstCte = (sch: string, dated = true) => `gst AS (SELECT ledext.il_id, MAX(CASE WHEN idopt.opt_desc = 'IGST' THEN ledext.slab_perc::numeric ELSE ledext.slab_perc::numeric * 2 END) AS perc, MAX(CASE WHEN idopt.opt_desc = 'IGST' THEN ledext.slab_amt::numeric ELSE ledext.slab_amt::numeric * 2 END) AS amt, MAX(ledext.s_lastot::numeric - ledext.slab_amt::numeric) AS taxable`
  + ` FROM ${sch}.ledger_ext ledext JOIN ${sch}.slab_master slabmst ON ledext.slab_id = slabmst.slab_key JOIN ${sch}.tax_master taxmst ON ledext.tax_id = taxmst.tax_rec JOIN ${sch}.idopt_master idopt ON idopt.idopt_key = NULLIF(taxmst.tax_type, '')::int`
  + (dated ? ` JOIN ${sch}.prod_ledger plx ON plx.il_key = ledext.il_id AND plx.il_date >= $1::date AND plx.il_date <= $2::date` : "")
  + ` WHERE ledext.tax_id > 0 AND slabmst.slab_link = 0 AND ledext.il_id IS NOT NULL AND idopt.opt_desc IN ('IGST', 'CGST', 'SGST', 'UTGST') GROUP BY ledext.il_id)`;
/**
 * A line's taxable value, before tax and after every discount: what its tax slab is applied to (the line's last total less the tax, as the GST reports take it); a line
 * with no tax rows has its item value less its discount.
 */
async function lineTaxable(ctx: Ctx): Promise<string> {
  const discount = await hasColumn(ctx, "prod_ledger", "dis_value");
  return `COALESCE(g.taxable, pl.il_value::numeric${discount ? " - COALESCE(pl.dis_value::numeric, 0)" : ""})`;
}
const gstFrom = (sch: string) => `${sch}.prod_ledger pl JOIN ${sch}.ledger l ON l.led_key = pl.led_id JOIN ${sch}.product_master pm ON pm.prod_key = pl.prod_id LEFT JOIN gst g ON g.il_id = pl.il_key`;
const gstWhere = `${GST_BOOKS} AND pl.il_pos = 'A' AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date`;

T.push({
  id: 106, question: "Find account master like general ledger, debtors ledger, creditors ledger with missing GSTIN.", defaultPeriod: "none", terms: [/accounts?|ledgers?|master|parties|party/, /gstin|gst\s?(?:no|number)|gst\s?id/, /missing|without|blank|empty|invalid|not (?:entered|available)|\bno\b/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT ac.code, btrim(ac.name) AS name, btrim(COALESCE(bp.book_desc, 'Book ' || ac.book::text)) AS ledger, btrim(COALESCE(reg.opt_desc, '')) AS registration, btrim(COALESCE(ad.gst_no, '')) AS gstin`
      + ` FROM ${ctx.sch}.account ac LEFT JOIN ${ctx.sch}.book_properties bp ON bp.book_key = ac.book LEFT JOIN ${ctx.sch}.address ad ON ad.code = ac.code AND ad.address_id = 1 LEFT JOIN ${ctx.sch}.idopt_master reg ON reg.idopt_key::text = ad.p_reg::text`
      + ` WHERE ac.a_pos <> 'D' AND ac.book IN (1, 2, 3) AND length(btrim(COALESCE(ad.gst_no, ''))) <> 15 ORDER BY (upper(btrim(COALESCE(reg.opt_desc, ''))) = 'REGISTER') DESC, ac.book, ac.name LIMIT 1000`);
    const registered = found.filter((row) => String(row.registration).toUpperCase() === "REGISTER").length;
    return {
      id: 106, title: "Accounts with a missing GSTIN", columns: [int("no", "No."), text("name", "Account"), text("ledger", "Ledger"), text("registration", "Registration"), text("gstin", "GSTIN")],
      rows: found.map((row, at) => ({ no: at + 1, name: String(row.name), ledger: String(row.ledger), registration: String(row.registration), gstin: String(row.gstin) === "" ? "Missing" : `${String(row.gstin)} (not 15 characters)`, code: num(row.code) })),
      note: `Accounts of the general ledger (expense), debtors and creditors books whose first address has no GSTIN, or one that is not 15 characters long: ${found.length} found, ${registered} of them marked Registered (those are the ones to correct first; an unregistered party has none). Double-click an account to open its ledger.`,
    };
  },
});

T.push({
  id: 107, question: "Show taxable sales grouped by GST rate.", defaultPeriod: "year", terms: [/taxable|gst/, /sales?|sale register|outward/, /rate|slab|grouped|wise|percent/],
  run: async (ctx) => {
    const tv = await lineTaxable(ctx);
    const found = await rows(ctx,
      `WITH ${gstCte(ctx.sch)} SELECT COALESCE(g.perc, 0) AS rate, COUNT(DISTINCT l.led_key) AS invoices, COUNT(*) AS lines, SUM(${GST_SIGN} * ${tv}) AS taxable, SUM(${GST_SIGN} * COALESCE(g.amt, 0)) AS tax`
      + ` FROM ${gstFrom(ctx.sch)} WHERE ${gstWhere} GROUP BY 1 ORDER BY 1 DESC`, [ctx.period.from, ctx.period.to]);
    const total = (key: "taxable" | "tax") => found.reduce((sum, row) => sum + num(row[key]), 0);
    return {
      id: 107, title: "Taxable sales by GST rate", columns: [text("rate", "GST Rate"), int("invoices", "Invoices"), int("lines", "Lines"), money("taxable", "Taxable Value"), money("tax", "GST Amount"), money("total", "Taxable + GST")],
      rows: found.length === 0 ? [] : [...found.map((row) => ({ rate: num(row.rate) === 0 ? "Nil / no GST" : `${num(row.rate)}%`, invoices: num(row.invoices), lines: num(row.lines), taxable: num(row.taxable), tax: num(row.tax), total: num(row.taxable) + num(row.tax), detail: `rate:${num(row.rate)}:${ctx.period.from}:${ctx.period.to}` })),
        { rate: "Total", invoices: 0, lines: found.reduce((sum, row) => sum + num(row.lines), 0), taxable: total("taxable"), tax: total("tax"), total: total("taxable") + total("tax") }],
      note: `${ctx.period.label}. Stock lines of the Sale book and the notes against it (credit notes taken off), by the GST rate on the line (CGST and SGST together, or IGST), before tax. Click a rate to show its invoices, click again to hide them.`,
    };
  },
});

/** dd/MMM/yyyy, the date a report's selection is given in. */
const reportDay = (isoDay: string) => { const [year, month, day] = isoDay.split("-"); return `${day}/${MONTHS_SHORT[Number(month) - 1]}/${year}`; };

/**
 * The invoices behind a difference between the sale register and GSTR-1, one by one. GSTR-1's B2B and B2C Large sections list each invoice, so they are
 * read by invoice number and set against the Sale book's entries (all of them, posted or not, with their status): an invoice only one side has, or one
 * both have at different values, is listed with the reason. The small B2C sales are in GSTR-1 only as a summary, so an unregistered customer's invoice
 * is not expected there.
 */
async function gstrDifference(ctx: Ctx, from: string, to: string): Promise<AskAnswer> {
  const found = (await rows(ctx, `SELECT btrim(report_name) AS name FROM ${SETUP_SCHEMA}.report_properties WHERE report_key = 130 LIMIT 1`))[0];
  const columns = [text("doc", "Invoice"), date("d", "Date"), text("party", "Customer"), money("reg", "Register"), money("gstr", "GSTR-1"), money("diff", "Difference"), text("why", "Reason")];
  if (!found) return { id: 0, title: "Register against GSTR-1, invoice by invoice", columns, rows: [] };
  const reportName = String(found.name);
  const menus: MenuNode[] = [];
  const walk = (list: readonly MenuNode[]) => { for (const node of list) { menus.push(node); walk(node.children); } };
  walk(await readMenuCatalog(ctx.session.companyGroup));
  const loader = new Loader(ctx.client, ctx.session);
  const definition = await loadReport(loader, reportName, menus.find((node) => node.actionMenu?.toUpperCase() === reportName.toUpperCase())?.menuShortName ?? "");
  // The invoices GSTR-1 lists (the sections that give an invoice number), with their taxable value added up over the rate rows.
  const gstr = new Map<string, number>();
  for (const option of definition.firstCombo.options.filter((candidate) => /^b2b$|b2c\s*large/i.test(candidate.text.trim()))) {
    const output = await runReport(loader, reportName, { firstCombo: option.value, from: reportDay(from), upto: reportDay(to), groups: [], ticks: {}, choices: {}, columns: [], texts: {}, checks: {} });
    const number = output.columns.find((candidate) => /^invoice_?number$/i.test(candidate.key))?.key;
    const taxable = output.columns.find((candidate) => /^taxable_?value$/i.test(candidate.key))?.key;
    if (!number || !taxable) continue;
    for (const row of output.rows) {
      if (!isEntryRow(row)) continue;
      const key = String(row.values[number] ?? "").trim();
      if (key !== "") gstr.set(key, (gstr.get(key) ?? 0) + amountOfCell(row.values[taxable]));
    }
  }
  const entries = await rows(ctx,
    `WITH slab AS (SELECT slab_key FROM ${ctx.sch}.slab_master WHERE book = ${SALE} AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key LIMIT 1)`
    + ` SELECT btrim(l.full_docno) AS doc, l.doc_date AS d, btrim(COALESCE(ac.name, '')) AS party, l.code, l.doc_pos, l.doc_posting, (upper(btrim(COALESCE(reg.opt_desc, ''))) = 'REGISTER') AS registered,`
    + ` (CASE WHEN slab.slab_key IS NULL THEN COALESCE(l.amount::numeric, 0) ELSE COALESCE(ext.s_lastot::numeric, 0) - COALESCE(ext.slab_amt::numeric, 0) END) AS taxable`
    + ` FROM ${ctx.sch}.ledger l LEFT JOIN slab ON TRUE LEFT JOIN ${ctx.sch}.ledger_ext ext ON ext.led_id = l.led_key AND ext.il_id IS NULL AND ext.slab_id = slab.slab_key LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
    + ` LEFT JOIN ${ctx.sch}.address ad ON ad.code = l.code AND ad.address_id = 1 LEFT JOIN ${ctx.sch}.idopt_master reg ON reg.idopt_key::text = ad.p_reg::text`
    + ` WHERE l.book = ${SALE} AND l.doc_pos <> 'D' AND l.doc_date >= $1::date AND l.doc_date <= $2::date`, [from, to]);
  type Line = { doc: string; d: string; party: string; reg: number; gstr: number; why: string; code: number };
  const listed: Line[] = [];
  const seen = new Set<string>();
  for (const row of entries) {
    const doc = String(row.doc ?? "");
    const posted = String(row.doc_pos) === "A" && String(row.doc_posting) === "P";
    const registerValue = posted ? num(row.taxable) : 0;
    const inGstr = gstr.has(doc);
    seen.add(doc);
    const gstrValue = gstr.get(doc) ?? 0;
    const line = (why: string): Line => ({ doc, d: dmy(row.d), party: String(row.party), reg: registerValue, gstr: gstrValue, why, code: num(row.code) });
    if (inGstr && !posted) listed.push(line(`In GSTR-1, but not counted in the register (entry status ${String(row.doc_pos)} / posting ${String(row.doc_posting)})`));
    else if (inGstr && Math.abs(registerValue - gstrValue) > 1) listed.push(line("Value differs between the register and GSTR-1"));
    else if (!inGstr && posted && row.registered === true && Math.abs(registerValue) > 1) listed.push(line("Registered customer, but the invoice is not in GSTR-1 B2B"));
  }
  for (const [doc, value] of gstr) if (!seen.has(doc)) listed.push({ doc, d: "", party: "", reg: 0, gstr: value, why: "In GSTR-1, but not a Sale book entry of these dates", code: 0 });
  listed.sort((a, b) => Math.abs(b.reg - b.gstr) - Math.abs(a.reg - a.gstr));
  const reasons = new Map<string, { count: number; diff: number }>();
  for (const line of listed) { const kept = reasons.get(line.why.replace(/ \(entry status.*\)$/, "")) ?? { count: 0, diff: 0 }; kept.count += 1; kept.diff += line.reg - line.gstr; reasons.set(line.why.replace(/ \(entry status.*\)$/, ""), kept); }
  const out = listed.slice(0, 500).map((line) => ({ doc: line.doc, d: line.d, party: line.party, reg: line.reg, gstr: line.gstr, diff: line.reg - line.gstr, why: line.why, code: line.code }));
  return {
    id: 0, title: `Invoices behind the difference (${listed.length})`, columns,
    rows: listed.length === 0 ? [] : [...out, ...[...reasons.entries()].map(([why, total]) => ({ doc: `${total.count} invoices`, d: "", party: "Total", reg: "", gstr: "", diff: total.diff, why }))],
  };
}


/** One section of the GSTR-1 report, row by row as the report gives it (the first columns, up to a thousand rows), with the numbers added up. */
async function gstrSection(ctx: Ctx, value: string, from: string, to: string): Promise<AskAnswer> {
  const found = (await rows(ctx, `SELECT btrim(report_name) AS name FROM ${SETUP_SCHEMA}.report_properties WHERE report_key = 130 LIMIT 1`))[0];
  if (!found) return { id: 0, title: "GSTR-1", columns: [text("item", "Item")], rows: [] };
  const reportName = String(found.name);
  const menus: MenuNode[] = [];
  const walk = (list: readonly MenuNode[]) => { for (const node of list) { menus.push(node); walk(node.children); } };
  walk(await readMenuCatalog(ctx.session.companyGroup));
  const loader = new Loader(ctx.client, ctx.session);
  const definition = await loadReport(loader, reportName, menus.find((node) => node.actionMenu?.toUpperCase() === reportName.toUpperCase())?.menuShortName ?? "");
  const output = await runReport(loader, reportName, { firstCombo: value, from: reportDay(from), upto: reportDay(to), groups: [], ticks: {}, choices: {}, columns: [], texts: {}, checks: {} });
  const name = definition.firstCombo.options.find((option) => option.value === value)?.text ?? "GSTR-1";
  return outputAnswer(output, `GSTR-1 ${name}`);
}

/** A report's output as an answer: its first visible columns, the entry rows (up to a thousand) and the numbers added up. */
function outputAnswer(output: Awaited<ReturnType<typeof runReport>>, title: string): AskAnswer {
  // All the number columns (the values the report adds up: taxable value, rate, invoice value ...) and as many of the text columns, in the report's order, as fit beside them.
  const usable = output.columns.filter((candidate) => candidate.visible && !/^(out_?key|skip_?key|out_?ag_?outid|pre_?gst|app_?tax_?rate|state_?code|doc_?no|smart_)/i.test(candidate.key));
  const numbersOf = usable.filter((candidate) => candidate.kind === "number");
  let room = Math.max(4, 11 - numbersOf.length);
  const shown = usable.filter((candidate) => candidate.kind === "number" || room-- > 0);
  const columns = shown.map((candidate) => (candidate.kind === "number" ? money(candidate.key, candidate.caption) : text(candidate.key, candidate.caption)));
  const entries = output.rows.filter((row) => isEntryRow(row));
  const body = entries.slice(0, 1000).map((row) => Object.fromEntries(shown.map((candidate) => [candidate.key, candidate.kind === "number" ? amountOfCell(row.values[candidate.key]) : String(row.values[candidate.key] ?? "")])));
  const sums = Object.fromEntries(shown.map((candidate, at) => [candidate.key, candidate.kind === "number" && !/^(rate|app_?tax_?rate)$/i.test(candidate.key) ? entries.reduce((total, row) => total + amountOfCell(row.values[candidate.key]), 0) : at === 0 ? `Total (${entries.length} rows)` : ""]));
  return { id: 0, title: `${title} (${entries.length} rows${entries.length > 1000 ? ", the first 1,000 shown" : ""})`, columns, rows: body.length === 0 ? [] : [...body, sums as Record<string, string | number>] };
}

/**
 * The Form Summary of the REPORT menu, register SALE, format "Summary For Period Selected", run for the dates with every account of the register ticked as the
 * screen opens it: a row for each tax line, whose net, tax and final amounts are the sale register's figures. Null (with why) when it cannot be run here.
 */
async function formSummarySale(ctx: Ctx, from: string, to: string): Promise<{ output: Awaited<ReturnType<typeof runReport>> } | { problem: string }> {
  try {
    const found = (await rows(ctx, `SELECT btrim(report_name) AS name FROM ${SETUP_SCHEMA}.report_properties WHERE report_key = 14 LIMIT 1`))[0];
    if (!found) return { problem: "this installation has no Form Summary report" };
    const reportName = String(found.name);
    const menus: MenuNode[] = [];
    const walk = (list: readonly MenuNode[]) => { for (const node of list) { menus.push(node); walk(node.children); } };
    walk(await readMenuCatalog(ctx.session.companyGroup));
    const loader = new Loader(ctx.client, ctx.session);
    const definition = await loadReport(loader, reportName, menus.find((node) => node.actionMenu?.toUpperCase() === reportName.toUpperCase())?.menuShortName ?? "");
    const option = definition.firstCombo.options.find((candidate) => /^sale$/i.test(candidate.text.trim())) ?? definition.firstCombo.options.find((candidate) => /sale/i.test(candidate.text));
    if (!option) return { problem: "the Form Summary has no SALE register" };
    const control = definition.controls.find((candidate) => /^lbox_formating$/i.test(candidate.name));
    const format = control?.items.find((item) => /summary\s+for\s+period/i.test(item.text));
    // The register's own accounts (the first combo's help) are all ticked, as the screen opens.
    const help = definition.helps.find((candidate) => candidate.first);
    const bookKey = Object.keys(help?.rows[0] ?? {}).find((key) => key.toLowerCase() === "book");
    const books = registerBooks(option.book ?? Number(option.value));
    const keys = help ? help.rows.filter((row) => !bookKey || books.includes(Number(row[bookKey]))).map((row) => row[help.keyColumn] ?? "").filter((key) => key !== "") : [];
    const output = await runReport(loader, reportName, {
      firstCombo: option.value, from: reportDay(from), upto: reportDay(to), groups: [], ticks: help ? { [help.grid]: keys } : {},
      choices: control && format ? { [control.name]: `${format.controlValKey}|${format.value}` } : {}, columns: [], texts: {}, checks: {},
    });
    return { output };
  } catch (error) {
    return { problem: error instanceof Error ? error.message.split("\n")[0] : "it could not be run" };
  }
}

/** The sale register's month-by-month figures that make up its total in the comparison. */
async function registerMonths(ctx: Ctx, from: string, to: string): Promise<AskAnswer> {
  const found = await rows(ctx,
    `WITH slab AS (SELECT slab_key FROM ${ctx.sch}.slab_master WHERE book = ${SALE} AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key LIMIT 1)`
    + ` SELECT to_char(l.doc_date, 'YYYY-MM') AS month, COUNT(DISTINCT l.full_docno) AS entries, SUM(${GST_SIGN} * COALESCE(l.amount::numeric, 0)) AS total,`
    + ` SUM(${GST_SIGN} * (CASE WHEN slab.slab_key IS NULL THEN COALESCE(l.amount::numeric, 0) ELSE COALESCE(ext.s_lastot::numeric, 0) - COALESCE(ext.slab_amt::numeric, 0) END)) AS taxable`
    + ` FROM ${ctx.sch}.ledger l LEFT JOIN slab ON TRUE LEFT JOIN ${ctx.sch}.ledger_ext ext ON ext.led_id = l.led_key AND ext.il_id IS NULL AND ext.slab_id = slab.slab_key`
    + ` WHERE ${GST_BOOKS} AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY 1 ORDER BY 1`, [from, to]);
  const out = found.map((row) => { const [year, month] = String(row.month).split("-"); return { month: `${MONTHS_SHORT[Number(month) - 1]}-${year}`, entries: num(row.entries), taxable: num(row.taxable), tax: num(row.total) - num(row.taxable), total: num(row.total) }; });
  const sum = (key: "entries" | "taxable" | "tax" | "total") => out.reduce((total, row) => total + row[key], 0);
  return { id: 0, title: "Sale register by month", columns: [text("month", "Month"), int("entries", "Entries"), money("taxable", "Taxable Value"), money("tax", "Tax"), money("total", "Invoice Value")],
    rows: out.length === 0 ? [] : [...out, { month: "Total", entries: sum("entries"), taxable: sum("taxable"), tax: sum("tax"), total: sum("total") }] };
}

T.push({
  id: 108, question: "Compare sales register totals with GSTR-1 totals.", defaultPeriod: "year", terms: [/gstr.?1|gstr ?one|gst return/, /compar|reconcil|match|differ|tally|versus|\bvs\b|check/, /sales?|register|total|taxable|tax|invoice/],
  run: async (ctx) => {
    // The GSTR-1 of the GST menu is run itself, section by section (B2B, B2C large, B2C small, credit / debit notes of registered and of unregistered persons,
    // exempted / nil rated; the HSN summary only repeats them and is left out), and the figures it gives are added up.
    const found = (await rows(ctx, `SELECT btrim(report_name) AS name FROM ${SETUP_SCHEMA}.report_properties WHERE report_key = 130 LIMIT 1`))[0];
    if (!found) return { id: 108, title: "Sales register against GSTR-1 totals", columns: [text("item", "Item")], rows: [], note: "This installation has no GSTR-1 report (report 130) to read." };
    const reportName = String(found.name);
    const menus: MenuNode[] = [];
    const walk = (list: readonly MenuNode[]) => { for (const node of list) { menus.push(node); walk(node.children); } };
    walk(await readMenuCatalog(ctx.session.companyGroup));
    const shortName = menus.find((node) => node.actionMenu?.toUpperCase() === reportName.toUpperCase())?.menuShortName ?? "";
    const loader = new Loader(ctx.client, ctx.session);
    const definition = await loadReport(loader, reportName, shortName);
    const sections = definition.firstCombo.options.filter((option) => !/hsn/i.test(option.text));

    type Totals = { taxable: number; raw: number; invoice: number; exempt: number; igst: number; cgst: number; sgst: number; cess: number; lines: number };
    const total: Totals = { taxable: 0, raw: 0, invoice: 0, exempt: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, lines: 0 };
    const out: Record<string, string | number>[] = [];
    for (const option of sections) {
      const part: Totals = { taxable: 0, raw: 0, invoice: 0, exempt: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, lines: 0 };
      let problem = "";
      try {
        const output = await runReport(loader, reportName, { firstCombo: option.value, from: reportDay(ctx.period.from), upto: reportDay(ctx.period.to), groups: [], ticks: {}, choices: {}, columns: [], texts: {}, checks: {} });
        const column = (pattern: RegExp) => output.columns.filter((candidate) => candidate.kind === "number" && pattern.test(`${candidate.key}`));
        const taxable = column(/^taxable_?value$/i); const exempt = column(/nill?_?rated|^exempted$|non_?gst/i);
        const cess = column(/^cess_?amount$/i);
        const invoiceValue = column(/^invoice_?value$|^note_?refund_?voucher_?value$/i);
        // The GSTR-1 gives each row's value and its GST rate (not the tax): the tax is the value at the rate, split in half into CGST and SGST for a supply within the company's state, else IGST.
        const rate = output.columns.find((candidate) => /^rate$/i.test(candidate.key))?.key;
        const place = output.columns.find((candidate) => /^place_of_supply$/i.test(candidate.key))?.key;
        const ownState = String(ctx.session.coStateCode ?? "").trim().padStart(2, "0");
        const documentType = output.columns.find((candidate) => /^document_?type$/i.test(candidate.key))?.key;
        for (const row of output.rows) {
          if (!isEntryRow(row)) continue;
          // A credit note takes off, a debit note adds.
          const sign = documentType && /^c/i.test(String(row.values[documentType] ?? "").trim()) ? -1 : 1;
          // The report gives a credit note a plus taxable value; a debit note a minus one when it is set off against a bill and a plus one when it is not (the procedure's two inserts),
          // so the sale side takes the size of each value and signs it by the note's type: a credit note takes off, a debit note adds. "raw" is what the report itself adds up.
          const sum = (list: typeof taxable) => { const added = list.reduce((add, candidate) => add + amountOfCell(row.values[candidate.key]), 0); return documentType ? Math.abs(added) * sign : added; };
          const value = sum(taxable);
          const tax = rate ? (value * amountOfCell(row.values[rate])) / 100 : 0;
          const within = place !== undefined && ownState !== "00" && String(row.values[place] ?? "").trim().startsWith(ownState);
          part.taxable += value; part.raw += taxable.reduce((add, candidate) => add + amountOfCell(row.values[candidate.key]), 0); part.invoice += invoiceValue.reduce((add, candidate) => add + amountOfCell(row.values[candidate.key]), 0); part.exempt += sum(exempt); part.cess += sum(cess); part.lines += 1;
          if (within) { part.cgst += tax / 2; part.sgst += tax / 2; } else part.igst += tax;
        }
      } catch (error) {
        problem = error instanceof Error ? error.message.split("\n")[0] : "could not be read";
      }
      for (const key of Object.keys(total) as (keyof Totals)[]) total[key] += part[key];
      out.push({ item: problem === "" ? option.text : `${option.text}: ${problem}`, detail: problem === "" ? `gstrsec:${encodeURIComponent(option.value)}:${ctx.period.from}:${ctx.period.to}` : "", lines: part.lines, invoice: part.invoice, raw: part.raw, taxable: part.taxable, exempt: part.exempt, tax: part.igst + part.cgst + part.sgst + part.cess, igst: part.igst, cgst: part.cgst, sgst: part.sgst });
    }

    // The register side is the Form Summary of the REPORT menu (register SALE, Summary For Period Selected): the sums of its net and tax columns. Where that cannot be run the sale
    // entries are read directly (their total, and the total less the tax slab).
    const summary = await formSummarySale(ctx, ctx.period.from, ctx.period.to);
    let regTaxable = 0; let regTax = 0; let registerLabel = "Sales register (Form Summary)"; let registerNote = "";
    if ("output" in summary) {
      const net = summary.output.columns.find((candidate) => /^tot_?net$/i.test(candidate.key))?.key; const taxColumn = summary.output.columns.find((candidate) => /^tot_?tax$/i.test(candidate.key))?.key;
      for (const row of summary.output.rows) {
        if (!isEntryRow(row)) continue;
        if (net) regTaxable += amountOfCell(row.values[net]);
        if (taxColumn) regTax += amountOfCell(row.values[taxColumn]);
      }
      if (!net || !taxColumn) registerNote = " The Form Summary has no TOT_NET / TOT_TAX column to add up.";
    } else {
      const register = (await rows(ctx,
        `WITH slab AS (SELECT slab_key FROM ${ctx.sch}.slab_master WHERE book = ${SALE} AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key LIMIT 1)`
        + ` SELECT COUNT(DISTINCT l.full_docno) AS entries, SUM(${GST_SIGN} * COALESCE(l.amount::numeric, 0)) AS total, SUM(${GST_SIGN} * (CASE WHEN slab.slab_key IS NULL THEN COALESCE(l.amount::numeric, 0) ELSE COALESCE(ext.s_lastot::numeric, 0) - COALESCE(ext.slab_amt::numeric, 0) END)) AS taxable`
        + ` FROM ${ctx.sch}.ledger l LEFT JOIN slab ON TRUE LEFT JOIN ${ctx.sch}.ledger_ext ext ON ext.led_id = l.led_key AND ext.il_id IS NULL AND ext.slab_id = slab.slab_key`
        + ` WHERE ${GST_BOOKS} AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date`, [ctx.period.from, ctx.period.to]))[0];
      regTaxable = num(register?.taxable); regTax = num(register?.total) - regTaxable;
      registerLabel = `Sales register (${num(register?.entries)} entries, read directly)`;
      registerNote = ` The Form Summary could not be run here (${summary.problem}), so the sale entries were read directly.`;
    }
    const gstrBase = total.taxable + total.exempt; const gstrTax = total.igst + total.cgst + total.sgst + total.cess;
    const line = (item: string, taxable: number | string, tax: number | string) => ({ item, detail: "", lines: "", invoice: "", raw: "", taxable, exempt: "", tax, igst: "", cgst: "", sgst: "" });
    const diffTaxable = regTaxable - gstrBase; const diffTax = regTax - gstrTax;
    const verdict = Math.abs(diffTaxable) <= 1 && Math.abs(diffTax) <= 1 ? "The sales register and the GSTR-1 agree."
      : `The sales register is ${diffTaxable >= 0 ? "more" : "less"} than GSTR-1 by ${grouping.format(Math.abs(diffTaxable))} in value and ${diffTax >= 0 ? "more" : "less"} by ${grouping.format(Math.abs(diffTax))} in tax.`;
    return {
      id: 108, title: "Sales register against GSTR-1", summary: verdict,
      columns: [text("item", "GSTR-1 Section"), int("lines", "Rows"), money("invoice", "Invoice Value (report total)"), money("raw", "Taxable Value (as the report adds it)"), money("taxable", "Taxable Value (effect on sales)"), money("exempt", "Nil / Exempt Value"), money("tax", "Tax"), money("igst", "IGST"), money("cgst", "CGST"), money("sgst", "SGST / UTGST")],
      rows: [
        ...out,
        { item: "GSTR-1 total (without HSN)", detail: "", lines: total.lines, invoice: "", raw: "", taxable: total.taxable, exempt: total.exempt, tax: gstrTax, igst: total.igst, cgst: total.cgst, sgst: total.sgst },
        { ...line(registerLabel, regTaxable, regTax), detail: `gstrreg:${ctx.period.from}:${ctx.period.to}` },
        { ...line("Register less GSTR-1", diffTaxable, diffTax), detail: `gstrdiff:${ctx.period.from}:${ctx.period.to}` },
      ],
      note: `${ctx.period.label}. GSTR-1 is run for the dates, section by section, as the GST menu does (the HSN summary is left out as it repeats the others; credit notes are taken off). The register is the Form Summary of the REPORT menu (register SALE, format Summary For Period Selected): value is the sum of its Net column, tax the sum of its Tax column. GSTR-1 value is the taxable and the nil / exempt supplies together. In the note sections the report adds credit notes as plus and some debit notes as minus, so the column "as the report adds it" is that figure and "effect on sales" takes a credit note off and adds a debit note; its tax is each row's taxable value at its GST rate (CGST and SGST in halves for a supply within the company's state, otherwise IGST), as the report gives the rate and not the tax. Click a section to show its rows, the "Sales register" line to show the Form Summary rows, and the "Register less GSTR-1" line to list the invoices behind the difference, with the reason for each. Open the GSTR-1 report for any section.${registerNote}`,
      report: { name: reportName, label: "Open GSTR-1 report (GST menu)", from: ctx.period.from, to: ctx.period.to },
    };
  },
});

T.push({
  id: 109, question: "Find invoices with missing HSN codes.", defaultPeriod: "year", terms: [/invoices?|bills?|sales?/, /\bhsn\b|\bsac\b/, /missing|without|blank|empty|no\b|not (?:entered|available)/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, btrim(pm.prod_desc) AS product, ${GST_SIGN} * pl.il_value::numeric AS value, l.code, l.led_key`
      + ` FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = ${SALE} AND pl.il_pos = 'A' AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND btrim(COALESCE(pm.hsn_code, '')) = '' ORDER BY l.doc_date, l.led_key, pl.il_key LIMIT 1000`, [ctx.period.from, ctx.period.to]);
    const products = new Set(found.map((row) => String(row.product))).size;
    const invoices = new Set(found.map((row) => num(row.led_key))).size;
    return {
      id: 109, title: "Sale invoices with missing HSN codes", columns: [date("d", "Date"), text("doc", "Invoice"), text("party", "Customer"), text("product", "Product (no HSN)"), money("value", "Taxable Value")],
      rows: found.length === 0 ? [] : [...found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), product: String(row.product), value: num(row.value), code: num(row.code) })), { d: "", doc: "", party: `${invoices} invoices`, product: `${products} products`, value: found.reduce((sum, row) => sum + num(row.value), 0) }],
      note: `${ctx.period.label}. Lines of sale invoices whose product has no HSN code in the product master (up to 1,000 lines). Fix the ${products} products in the product master and every invoice is corrected for the returns.`,
    };
  },
});

T.push({
  id: 110, question: "Show invoices with a mismatch between taxable value and tax amount.", defaultPeriod: "year", terms: [/invoices?|bills?/, /mismatch|differ|wrong|incorrect|error|not match|doesn.t match|inconsisten/, /taxable|tax amount|gst amount|tax|gst/],
  run: async (ctx) => {
    // Each line's tax should be its taxable value (the item value less every discount, before tax) at the line's GST rate (the rate of its tax rows, else the product master's); an invoice is listed when its lines' tax is off by more than 1.50 rupees in all.
    const tv = await lineTaxable(ctx);
    const found = await rows(ctx,
      `WITH ${gstCte(ctx.sch)} SELECT l.led_key, l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, l.code, SUM(pl.il_value::numeric) AS item, SUM(${tv}) AS taxable, SUM(COALESCE(g.amt, 0)) AS tax,`
      + ` SUM(${tv} * COALESCE(g.perc, NULLIF(pm.tax_perc::numeric, 0), 0) / 100) AS expected FROM ${gstFrom(ctx.sch)} LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = ${SALE} AND pl.il_pos = 'A' AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY l.led_key, l.doc_date, l.full_docno, ac.name, l.code`
      + ` HAVING ABS(SUM(COALESCE(g.amt, 0)) - SUM(${tv} * COALESCE(g.perc, NULLIF(pm.tax_perc::numeric, 0), 0) / 100)) > 1.5 ORDER BY ABS(SUM(COALESCE(g.amt, 0)) - SUM(${tv} * COALESCE(g.perc, NULLIF(pm.tax_perc::numeric, 0), 0) / 100)) DESC LIMIT 500`, [ctx.period.from, ctx.period.to]);
    return {
      id: 110, title: "Invoices whose tax does not match the taxable value", columns: [date("d", "Date"), text("doc", "Invoice"), text("party", "Customer"), money("item", "Item Value"), money("discount", "Less: Discounts"), money("taxable", "Taxable Value"), money("tax", "Tax Charged"), money("expected", "Tax at the Rate"), money("diff", "Difference")],
      rows: found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), item: num(row.item), discount: num(row.item) - num(row.taxable), taxable: num(row.taxable), tax: num(row.tax), expected: num(row.expected), diff: num(row.tax) - num(row.expected), code: num(row.code), detail: `gstlines:${num(row.led_key)}` })),
      note: `${ctx.period.label}. Sale invoices whose total tax differs from the taxable value at the rate of each line by more than 1.50 (rounding is allowed for). The taxable value is the item value less every discount, before tax: what the line's tax slab is applied to (for a line with no tax rows, its item value less its discount). Click an invoice to show its lines.`,
    };
  },
});

T.push({
  id: 36, question: "Show product-wise sales and purchase quantities.", defaultPeriod: "year", terms: [/product|item/, /sales?|sold/, /purchas|bought/], not: [/below|under|loss|profit|margin|cost|compar/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT btrim(pm.prod_desc) AS name, COALESCE(SUM(pl.quantity::numeric) FILTER (WHERE pl.book = ${SALE}), 0) AS sold, COALESCE(SUM(pl.quantity::numeric) FILTER (WHERE pl.book = ${PURCHASE}), 0) AS bought`
      + ` FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id`
      + ` WHERE pl.book IN (${SALE}, ${PURCHASE}) AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY pm.prod_key, pm.prod_desc ORDER BY sold DESC, bought DESC LIMIT 300`, [ctx.period.from, ctx.period.to]);
    return { id: 36, title: "Product-wise sales and purchase quantities", columns: [text("name", "Product"), qty("sold", "Sold Qty"), qty("bought", "Purchased Qty")], rows: found.map((row) => ({ name: String(row.name), sold: num(row.sold), bought: num(row.bought) })), note: `${ctx.period.label}. The 300 with the most sold are shown.` };
  },
});

T.push({
  id: 37, question: "What is the stock available in each godown?", defaultPeriod: "none", terms: [/godown|warehouse|location/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT btrim(COALESCE(NULLIF(ai.txt_godown, ''), '')) AS godown, COUNT(DISTINCT pl.prod_id) AS products, SUM(CASE WHEN pl.stock_nat = 'A' THEN pl.quantity::numeric ELSE -pl.quantity::numeric END) AS net`
      + ` FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.addon_ientry ai ON ai.aoni_il_id = pl.il_key WHERE pl.il_pos = 'A' AND pl.inventory = 'Y' AND COALESCE(btrim(ai.txt_godown), '') <> '' GROUP BY 1 ORDER BY 1`);
    return found.length === 0
      ? { id: 37, title: "Stock by godown", columns: [text("godown", "Godown")], rows: [], note: "No godown is entered on the stock lines of this company, so there is no stock by godown to show." }
      : { id: 37, title: "Stock by godown", columns: [text("godown", "Godown"), int("products", "Products"), qty("net", "Net Quantity")], rows: found.map((row) => ({ godown: String(row.godown), products: num(row.products), net: num(row.net) })), note: "Quantities added less taken on the lines of each godown (opening stock is not split by godown)." };
  },
});

T.push({
  id: 38, question: "Show fast-moving and slow-moving products.", defaultPeriod: "none", terms: [/fast|slow/, /moving|products?|items?/],
  run: async (ctx) => {
    const from = iso(new Date(new Date(`${ctx.today}T00:00:00`).getTime() - ctx.days * 86400000));
    const found = await rows(ctx,
      `WITH ${STOCK_CTE(ctx.sch, "$3")}, sold AS (SELECT pl.prod_id, SUM(pl.quantity::numeric) AS q FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book = ${SALE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY pl.prod_id)`
      + ` SELECT btrim(pm.prod_desc) AS name, sold.q AS sold, COALESCE(stk.cq, 0) AS cq FROM sold JOIN ${ctx.sch}.product_master pm ON pm.prod_key = sold.prod_id LEFT JOIN stk ON stk.prod_id = sold.prod_id WHERE pm.prod_pos <> 'D' AND sold.q > 0`, [from, ctx.today, ctx.session.yearId]);
    const fast = found.slice().sort((a, b) => num(b.sold) - num(a.sold)).slice(0, 15).map((row) => ({ kind: "Fast moving", name: String(row.name), sold: num(row.sold), cq: num(row.cq) }));
    const slow = found.filter((row) => num(row.cq) > 0).sort((a, b) => num(a.sold) - num(b.sold)).slice(0, 15).map((row) => ({ kind: "Slow moving", name: String(row.name), sold: num(row.sold), cq: num(row.cq) }));
    return { id: 38, title: `Fast and slow moving products (last ${ctx.days} days)`, columns: [text("kind", "Movement"), text("name", "Product"), qty("sold", "Sold Qty"), qty("cq", "Stock")], rows: [...fast, ...slow], note: `Fast: the 15 with the most quantity sold since ${dmy(from)}. Slow: the 15 with the least sold (but some) among those with stock. Products with no sale at all are in "no sales in the last ${ctx.days} days".` };
  },
});

T.push({
  id: 39, question: "Find products with zero stock.", defaultPeriod: "none", terms: [/zero|nil|no stock|out of stock|empty/, /stock|products?|items?/],
  run: async (ctx) => {
    // The closing, in the product's report unit (REP1_UOM), is zero, whatever the product's movement.
    const found = await rows(ctx, `WITH ${STOCK_CTE(ctx.sch, "$1")} SELECT btrim(pm.prod_desc) AS name FROM stk JOIN ${ctx.sch}.product_master pm ON pm.prod_key = stk.prod_id WHERE pm.prod_pos <> 'D' AND pm.inventory = 'Y' AND stk.cq = 0 ORDER BY pm.prod_desc`, [ctx.session.yearId]);
    return { id: 39, title: "Products with zero stock", columns: [text("name", "Product"), qty("cq", "Closing Qty")], rows: found.slice(0, 500).map((row) => ({ name: String(row.name), cq: 0 })), note: `${found.length} stock-keeping products whose closing quantity, in the product's report unit (REP1_UOM), is zero.${found.length > 500 ? " The first 500 are shown." : ""}` };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Banking, cash and expenses (E)
//
// A cash or bank account's movement is its book side (BOOK_CODE with BK_DBCODE / BOOK_AMT) and its own entries (CODE), plus the posting lines
// (LEDGER_POST) that are neither of those; the balance is the year's opening (AC_BALANCE) with that movement up to the date.

type CashAccount = Readonly<{ code: number; name: string; opening: number; movement: number; cleared: number; pending: number }>;

async function cashAccounts(ctx: Ctx, book: 4 | 6, upto: string): Promise<CashAccount[]> {
  const found = await rows(ctx,
    `WITH bk AS (SELECT l.book_code AS code, SUM(CASE WHEN l.bk_dbcode = 1 THEN l.book_amt::numeric ELSE -l.book_amt::numeric END) AS amt,`
    + ` SUM(CASE WHEN l.bk_dbcode = 1 THEN l.book_amt::numeric ELSE -l.book_amt::numeric END) FILTER (WHERE l.reco_date IS NULL) AS pending FROM ${ctx.sch}.ledger l`
    + ` WHERE l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date <= $1::date GROUP BY l.book_code),`
    + ` cd AS (SELECT l.code, SUM(CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE -l.amount::numeric END) AS amt FROM ${ctx.sch}.ledger l WHERE l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date <= $1::date GROUP BY l.code),`
    + ` ex AS (SELECT lp.post_code AS code, SUM(CASE WHEN lp.post_dbcode = 1 THEN lp.post_amt::numeric ELSE -lp.post_amt::numeric END) AS amt FROM ${ctx.sch}.ledger_post lp JOIN ${ctx.sch}.ledger l ON l.led_key = lp.led_id`
    + ` WHERE l.doc_pos = 'A' AND l.doc_date <= $1::date AND lp.post_code <> COALESCE(l.code, 0) AND lp.post_code <> COALESCE(l.book_code, 0) GROUP BY lp.post_code)`
    + ` SELECT ac.code, btrim(ac.name) AS name, COALESCE(MAX(ab.opening::numeric), 0) AS opening, COALESCE(MAX(bk.amt), 0) + COALESCE(MAX(cd.amt), 0) + COALESCE(MAX(ex.amt), 0) AS movement, COALESCE(MAX(bk.pending), 0) AS pending`
    + ` FROM ${ctx.sch}.account ac LEFT JOIN ${ctx.sch}.ac_balance ab ON ab.code = ac.code AND ab.year_id = $2 LEFT JOIN bk ON bk.code = ac.code LEFT JOIN cd ON cd.code = ac.code LEFT JOIN ex ON ex.code = ac.code`
    + ` WHERE ac.book = $3 AND ac.a_pos <> 'D' GROUP BY ac.code, ac.name ORDER BY btrim(ac.name)`, [upto, ctx.session.yearId, book]);
  return found.map((row) => ({ code: num(row.code), name: String(row.name), opening: num(row.opening), movement: num(row.movement), cleared: num(row.opening) + num(row.movement) - num(row.pending), pending: num(row.pending) }));
}

async function cashOrBank(ctx: Ctx, id: number, book: 4 | 6, title: string): Promise<AskAnswer> {
  const list = await cashAccounts(ctx, book, ctx.today);
  const shown = list.filter((row) => row.opening !== 0 || row.movement !== 0);
  const side = (value: number) => (value >= 0 ? "Dr" : "Cr");
  const total = shown.reduce((sum, row) => sum + row.opening + row.movement, 0);
  return {
    id, title, columns: [text("name", "Account"), money("balance", "Balance"), text("side", "Dr / Cr")],
    rows: [...shown.map((row) => ({ name: row.name, balance: Math.abs(row.opening + row.movement), side: side(row.opening + row.movement), code: row.code })), { name: "Total", balance: Math.abs(total), side: side(total) }],
    note: `The year's opening plus the entries up to ${dmy(ctx.today)}.`,
  };
}

T.push({ id: 41, question: "What is today's cash balance?", defaultPeriod: "none", terms: [/cash/, /balance|how much|in hand/], not: [/bank|book|daily|ledger/], run: (ctx) => cashOrBank(ctx, 41, 4, "Cash balance") });
T.push({ id: 42, question: "Show all bank balances.", defaultPeriod: "none", terms: [/bank/, /balance|balances/], not: [/reco|reconcil|difference/], run: (ctx) => cashOrBank(ctx, 42, 6, "Bank balances") });

async function cashEntries(ctx: Ctx, id: number, title: string, side: 1 | 2, books: string, ask: (when: string) => string): Promise<AskAnswer> {
  const found = await rows(ctx,
    `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, btrim(COALESCE(bk.name, '')) AS book, l.amount::numeric AS amount FROM ${ctx.sch}.ledger l`
    + ` LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code LEFT JOIN ${ctx.sch}.account bk ON bk.code = l.book_code WHERE l.book IN (${books}) AND l.doc_pos = 'A' AND l.ac_dbcode = $3`
    + ` AND l.doc_date >= $1::date AND l.doc_date <= $2::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.period.from, ctx.period.to, side]);
  const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), book: String(row.book), amount: num(row.amount) }));
  return {
    id, title, columns: [date("d", "Date"), text("doc", "Document"), text("party", "Party"), text("book", "Book"), money("amount", "Amount")],
    choices: ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This year", "All"].map((label) => ({ label, question: ask(label === "All" ? "for all dates" : label.toLowerCase()) })),
    rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: `Total (${out.length})`, book: "", amount: out.reduce((sum, row) => sum + row.amount, 0) }], note: `${ctx.period.label}: cash and bank book entries.`,
  };
}

T.push({ id: 43, question: "How much money did we receive today?", defaultPeriod: "today", terms: [/receive|received|receipts?|collection|collected/], not: [/payment|paid|overdue|outstanding|customers?|invoice|cheque|bill/], run: (ctx) => cashEntries(ctx, 43, "Money received", 2, "4, 6", (when) => `How much money did we receive ${when}?`) });
T.push({ id: 44, question: "Show today's payments.", defaultPeriod: "today", terms: [/payments?|paid|pay out|paid out/], not: [/receipt|received|overdue|outstanding|cheque|salary|supplier|customers?|due|pending/], run: (ctx) => cashEntries(ctx, 44, "Payments made", 1, "4, 6", (when) => `Show payments ${when}.`) });

T.push({
  id: 45, question: "List expenses for the current month.", defaultPeriod: "month", terms: [/expenses?/], not: [/compar|increase|increased|more than|salary|last month/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, l.amount::numeric AS amount FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = 15 AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.period.from, ctx.period.to]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), amount: num(row.amount) }));
    return { id: 45, title: "Expenses", columns: [date("d", "Date"), text("doc", "Document"), text("party", "Party"), money("amount", "Amount")], rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: `Total (${out.length})`, amount: out.reduce((sum, row) => sum + row.amount, 0) }], note: `${ctx.period.label}: the Expense book's entries (amounts with tax).` };
  },
});

T.push({
  id: 46, question: "Which expenses increased compared with last month?", defaultPeriod: "none", terms: [/expenses?/, /increase|increased|more|higher|compar|rose|grew/],
  run: async (ctx) => {
    const now = new Date(`${ctx.today}T00:00:00`);
    const thisFrom = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastFrom = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastTo = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    const found = await rows(ctx,
      `SELECT btrim(ac.name) AS name, COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.doc_date >= $1::date AND l.doc_date <= $2::date), 0) AS this_month, COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.doc_date >= $3::date AND l.doc_date <= $4::date), 0) AS last_month`
      + ` FROM ${ctx.sch}.ledger l JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE l.book = 15 AND l.doc_pos = 'A' AND l.doc_date >= $3::date AND l.doc_date <= $2::date GROUP BY ac.code, ac.name`
      + ` HAVING COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.doc_date >= $1::date AND l.doc_date <= $2::date), 0) > COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.doc_date >= $3::date AND l.doc_date <= $4::date), 0) ORDER BY 2 - 3 DESC LIMIT 300`,
      [thisFrom, ctx.today, lastFrom, lastTo]);
    return { id: 46, title: "Expenses that increased compared with last month", columns: [text("name", "Party"), money("last", "Last Month"), money("current", "This Month"), money("increase", "Increase")], rows: found.map((row) => ({ name: String(row.name), last: num(row.last_month), current: num(row.this_month), increase: num(row.this_month) - num(row.last_month), detail: `exp:${encodeURIComponent(String(row.name))}:${thisFrom}:${ctx.today}:${lastFrom}:${lastTo}` })), note: `${dmy(thisFrom)} to ${dmy(ctx.today)} against ${dmy(lastFrom)} to ${dmy(lastTo)}: the Expense book's entries by party.` };
  },
});

T.push({
  id: 47, question: "Show cheque payments due for clearance.", defaultPeriod: "none", terms: [/cheque|check|chq/, /clear|due|pending|uncleared|not cleared/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, btrim(COALESCE(bk.name, '')) AS bank, l.amount::numeric AS amount FROM ${ctx.sch}.ledger l`
      + ` LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code LEFT JOIN ${ctx.sch}.account bk ON bk.code = l.book_code WHERE l.book = 6 AND l.doc_pos = 'A' AND l.ac_dbcode = 1 AND l.reco_date IS NULL AND l.doc_date <= $1::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.today]);
    const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), bank: String(row.bank), amount: num(row.amount) }));
    return { id: 47, title: "Bank payments not yet cleared", columns: [date("d", "Date"), text("doc", "Document"), text("party", "Party"), text("bank", "Bank"), money("amount", "Amount")], rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: `Total (${out.length})`, bank: "", amount: out.reduce((sum, row) => sum + row.amount, 0) }], note: `Payments through the bank books that have no bank-reconciliation date yet, up to ${dmy(ctx.today)}.` };
  },
});

T.push({
  id: 48, question: "Show bank reconciliation differences.", defaultPeriod: "none", terms: [/bank/, /reco|reconcil|difference|differences/],
  run: async (ctx) => {
    const list = (await cashAccounts(ctx, 6, ctx.today)).filter((row) => row.opening !== 0 || row.movement !== 0);
    return {
      id: 48, title: "Bank reconciliation differences", columns: [text("name", "Bank"), money("book", "Book Balance"), money("cleared", "Cleared Balance"), money("difference", "Difference")],
      rows: [...list.map((row) => ({ name: row.name, book: row.opening + row.movement, cleared: row.cleared, difference: row.opening + row.movement - row.cleared, code: row.code })),
        { name: "Total", book: list.reduce((s, r) => s + r.opening + r.movement, 0), cleared: list.reduce((s, r) => s + r.cleared, 0), difference: list.reduce((s, r) => s + r.pending, 0) }],
      note: `Book balance is the year's opening with all entries to ${dmy(ctx.today)}; Cleared Balance leaves out entries with no bank-reconciliation date; the Difference is what is still to be cleared.`,
    };
  },
});

T.push({
  id: 49, question: "What is the total salary expense this month?", defaultPeriod: "month", terms: [/salary|salaries|wages|payroll/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `WITH acs AS (SELECT code, btrim(name) AS name FROM ${ctx.sch}.account WHERE a_pos <> 'D' AND (name ILIKE '%salary%' OR name ILIKE '%salaries%' OR name ILIKE '%wages%')),`
      + ` mv AS (SELECT l.code AS code, CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE -l.amount::numeric END AS amt FROM ${ctx.sch}.ledger l WHERE l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date`
      + ` UNION ALL SELECT l.book_code, CASE WHEN l.bk_dbcode = 1 THEN l.book_amt::numeric ELSE -l.book_amt::numeric END FROM ${ctx.sch}.ledger l WHERE l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date`
      + ` UNION ALL SELECT lp.post_code, CASE WHEN lp.post_dbcode = 1 THEN lp.post_amt::numeric ELSE -lp.post_amt::numeric END FROM ${ctx.sch}.ledger_post lp JOIN ${ctx.sch}.ledger l ON l.led_key = lp.led_id WHERE l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND lp.post_code <> COALESCE(l.code, 0) AND lp.post_code <> COALESCE(l.book_code, 0))`
      + ` SELECT acs.code, acs.name, COALESCE(SUM(mv.amt), 0) AS amt FROM acs LEFT JOIN mv ON mv.code = acs.code GROUP BY acs.code, acs.name HAVING COALESCE(SUM(mv.amt), 0) <> 0 ORDER BY acs.name`, [ctx.period.from, ctx.period.to]);
    const total = found.reduce((sum, row) => sum + num(row.amt), 0);
    return { id: 49, title: "Salary expense", columns: [text("name", "Account"), money("amt", "Amount")], rows: found.length === 0 ? [] : [...found.map((row) => ({ name: String(row.name), amt: num(row.amt), code: num(row.code) })), { name: "Total", amt: total }], note: `${ctx.period.label}: the net debit of the accounts whose name has salary, salaries or wages.` };
  },
});

T.push({
  id: 50, question: "Show the daily cash book.", defaultPeriod: "today", terms: [/cash/, /book|daily|day book|daybook/],
  run: async (ctx) => {
    const before = iso(new Date(new Date(`${ctx.period.from}T00:00:00`).getTime() - 86400000));
    const opening = (await cashAccounts(ctx, 4, before)).reduce((sum, row) => sum + row.opening + row.movement, 0);
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric ELSE 0 END AS receipt, CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE 0 END AS payment`
      + ` FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code WHERE l.book = 4 AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.period.from, ctx.period.to]);
    const receipts = found.reduce((sum, row) => sum + num(row.receipt), 0);
    const payments = found.reduce((sum, row) => sum + num(row.payment), 0);
    return {
      id: 50, title: "Cash book", columns: [date("d", "Date"), text("doc", "Document"), text("party", "Particulars"), money("receipt", "Receipt"), money("payment", "Payment")],
      rows: [{ d: "", doc: "", party: "Opening balance", receipt: opening, payment: 0 }, ...found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), receipt: num(row.receipt), payment: num(row.payment) })),
        { d: "", doc: "", party: "Total", receipt: receipts, payment: payments }, { d: "", doc: "", party: "Closing balance", receipt: 0, payment: opening + receipts - payments }],
      note: `${ctx.period.label}: the Cash book. Opening and closing are the balance of the cash accounts (the closing is shown in the Payment column).`,
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Financial reports and business analysis (F)
//
// The statements themselves are the existing reports (Trial Balance, Profit / Loss, Balance Sheet, Fund Flow): the answer opens them, so the
// figures are the ones the report gives. The others are worked out here from the sales and cost definitions above.

const openReport = (id: number, title: string, report: string, label: string, note: string): AskAnswer => ({ id, title, columns: [text("item", "Item")], rows: [], note, report: { name: report, label } });

T.push({ id: 51, question: "Show the trial balance.", defaultPeriod: "none", terms: [/trial/, /balance/], run: async () => openReport(51, "Trial balance", "REPORT_TRIAL_BALANCE", "Open Trial Balance", "The Trial Balance report gives every account's opening, debit, credit and closing. Open it and press Show.") });
T.push({ id: 52, question: "What is my net profit this year?", defaultPeriod: "none", terms: [/net/, /profit|loss/], not: [/customer|party|product|each|gross|margin/], run: async () => openReport(52, "Net profit", "REPORT_PROFIT_LOSS", "Open Profit / Loss", "The net profit is the result of the Profit / Loss report for the year. Open it and press Show.") });
T.push({ id: 54, question: "What are my total assets and liabilities?", defaultPeriod: "none", terms: [/assets?/, /liabilit/], run: async () => openReport(54, "Assets and liabilities", "REPORT_BAL_SHEET", "Open Balance Sheet", "The Balance Sheet report gives the totals of assets and liabilities. Open it and press Show.") });
T.push({ id: 56, question: "Show the balance sheet as of today.", defaultPeriod: "none", terms: [/balance sheet|balancesheet/], run: async () => openReport(56, "Balance sheet", "REPORT_BAL_SHEET", "Open Balance Sheet", "Open the Balance Sheet report, set Report Upto to the date you want and press Show.") });
T.push({ id: 59, question: "Show the monthly fund flow.", defaultPeriod: "none", terms: [/fund/, /flow/], run: async () => openReport(59, "Fund flow", "REPORT_FUND_FLOW", "Open Fund Flow", "Open the Fund Flow report and press Show.") });

/**
 * The schema of the company's previous accounting year: every financial year has a database of its own, so last year's figures are in the
 * company of the same name whose year starts a year before this one's (null when there is none on this server).
 */
async function previousYearSchema(ctx: Ctx, yearStart: Date): Promise<string | null> {
  const found = await rows(ctx,
    `SELECT LOWER(BTRIM(c.co_dataname)) AS schema_name FROM ${SYSTEM_SCHEMA}.company c JOIN ${SYSTEM_SCHEMA}.cname n ON n.c_id = c.co_key JOIN ${SYSTEM_SCHEMA}.year_ac y ON y.year_key = n.c_yearid`
    + ` WHERE c.co_pos = 'A' AND BTRIM(c.name) = $1 AND y.year_start::date = $2::date AND LOWER(BTRIM(c.co_dataname)) <> $3`
    + ` AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = LOWER(BTRIM(c.co_dataname))) ORDER BY c.co_key DESC LIMIT 1`,
    [ctx.session.companyName, iso(new Date(yearStart.getFullYear() - 1, yearStart.getMonth(), yearStart.getDate())), ctx.sch]);
  return found[0] ? String(found[0].schema_name) : null;
}

T.push({
  id: 55, question: "Compare this year's sales with last year.", defaultPeriod: "none", terms: [/sales?/, /compar|versus|\bvs\b|with last year|last year|previous year/], not: [/month/],
  run: async (ctx) => {
    const from = ctx.session.tarikh1;
    const to = new Date(`${ctx.today}T00:00:00`) < ctx.session.tarikh2 ? new Date(`${ctx.today}T00:00:00`) : ctx.session.tarikh2;
    const back = (date: Date) => new Date(date.getFullYear() - 1, date.getMonth(), date.getDate());
    const current = (await netSales(ctx, iso(from), iso(to), false))[0];
    // Last year is in the database of last year.
    const lastSchema = await previousYearSchema(ctx, from);
    const previous = lastSchema ? (await netSales({ ...ctx, sch: lastSchema }, iso(back(from)), iso(back(to)), false))[0] : { entries: 0, sales: 0, returns: 0, net: 0 };
    const change = current.net - previous.net;
    return {
      id: 55, title: "Sales: this year and last year", columns: [text("item", "Period"), int("entries", "Entries"), ...salesColumns],
      rows: [
        { item: `This year (${dmy(from)} to ${dmy(to)})`, entries: current.entries, sales: current.sales, returns: -current.returns, net: current.net },
        { item: `Last year (${dmy(back(from))} to ${dmy(back(to))})`, entries: previous.entries, sales: previous.sales, returns: -previous.returns, net: previous.net },
        { item: previous.net === 0 ? "Change" : `Change (${((change / previous.net) * 100).toFixed(1)}%)`, entries: current.entries - previous.entries, sales: current.sales - previous.sales, returns: previous.returns - current.returns, net: change },
      ],
      note: `${lastSchema ? "The same days of both years, last year from its own database." : "Last year's database was not found on this server, so last year shows nothing."} ${SALES_NOTE}`,
    };
  },
});

T.push({
  id: 57, question: "Which customers contribute the most revenue?", defaultPeriod: "year", terms: [/customers?|parties/, /contribut|revenue|most|share|biggest/], not: [/profit|outstanding|overdue|purchased/],
  run: async (ctx) => {
    const all = await netSales(ctx, ctx.period.from, ctx.period.to, true);
    const total = all.reduce((sum, row) => sum + row.net, 0);
    const top = all.sort((a, b) => b.net - a.net).slice(0, Math.max(ctx.top, 20));
    return { id: 57, title: "Customers by revenue", columns: [int("no", "No."), text("name", "Customer"), money("net", "Net Sales"), money("share", "Share %")], rows: top.map((row, at) => ({ no: at + 1, name: row.name, net: row.net, share: total === 0 ? 0 : (row.net / total) * 100, code: row.code })), note: `${ctx.period.label}. Net sales (before tax, less returns) of all customers: ${grouping.format(total)}.` };
  },
});

T.push({
  id: 58, question: "What is my gross profit margin?", defaultPeriod: "year", terms: [/gross/, /profit|margin/],
  run: async (ctx) => {
    const profit = await (T.find((template) => template.id === 20) as Template).run(ctx);
    const sum = (key: string) => profit.rows.reduce((total, row) => total + num(row[key]), 0);
    const net = sum("net"); const cost = sum("cost"); const gross = sum("profit");
    return {
      id: 58, title: "Gross profit margin", columns: [text("item", "Item"), money("value", "Value")],
      rows: [{ item: "Sales (before tax)", value: sum("sales") }, { item: "Less: returns", value: sum("returns") }, { item: "Net sales", value: net }, { item: "Cost of goods sold", value: cost }, { item: "Gross profit", value: gross }, { item: "Gross profit margin %", value: net === 0 ? 0 : (gross / net) * 100 }],
      note: `${ctx.period.label}. From the customer-wise profit: net sales less the cost of what was sold (a factory-made product at its bill-of-material cost, a trading product at its average cost). Products with no cost count at 0, so the margin is on the high side by that much.`,
    };
  },
});

T.push({
  id: 61, question: "Show month-wise sales of a party.", defaultPeriod: "year", needsParty: true, partyBook: 2, terms: [/month/, /sales?|sold|selling/], not: [/compar|versus|\bvs\b|last month|previous month|this month|current month|business|summar/],
  runAll: (ctx) => monthlySalesMatrix(ctx),
  run: (ctx) => monthlySales(ctx, ctx.party as Party),
});

async function monthlySales(ctx: Ctx, party?: Party): Promise<AskAnswer> {
  const list = await netSalesMonthly(ctx, ctx.period.from, ctx.period.to, party?.code);
  const sum = (key: "entries" | "sales" | "returns" | "net") => list.reduce((total, row) => total + row[key], 0);
  // Each month against the month before it: the first month is 0 (nothing before it), a month after a month of no sales is 0 too (no base to divide by).
  const changed = list.map((row, at) => {
    const before = at === 0 ? null : list[at - 1].net;
    const diff = before === null ? 0 : row.net - before;
    return { ...row, diff, pct: before === null || before === 0 ? 0 : (diff / Math.abs(before)) * 100 };
  });
  return {
    id: 61, title: party ? `Month-wise sales: ${party.name}` : "Month-wise sales", columns: [text("month", "Month"), int("entries", "Entries"), ...salesColumns, money("diff", "Change from Last Month"), money("pct", "Change %")],
    rows: list.length === 0 ? [] : [...changed.map((row) => ({ month: row.month, entries: row.entries, sales: row.sales, returns: -row.returns, net: row.net, diff: row.diff, pct: row.pct })), { month: "Total", entries: sum("entries"), sales: sum("sales"), returns: -sum("returns"), net: sum("net"), diff: "", pct: "" }],
    ...(party ? { ledger: { code: party.code, name: party.name } } : {}),
    ...(list.length > 0 ? { chart: { label: "month", value: "net", count: list.length } } : {}),
    note: `${ctx.period.label}. ${SALES_NOTE} Change is each month's net sales against the month before (the first month shows 0; a month after a month with no sales also shows 0 %, as there is nothing to divide by).`,
  };
}

/**
 * Month-wise net sales of every party: a row for each party (largest first), a column for each month of the period and a total. The months are
 * those of the period, so a party with no sale in a month shows 0 there; a month a party was only returned goods in shows less than 0.
 */
async function monthlySalesMatrix(ctx: Ctx): Promise<AskAnswer> {
  const found = await rows(ctx,
    `WITH slab AS (SELECT slab_key FROM ${ctx.sch}.slab_master WHERE book = ${SALE} AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key LIMIT 1)`
    + ` SELECT l.code, btrim(ac.name) AS name, to_char(l.doc_date, 'YYYY-MM') AS month,`
    + ` COALESCE(SUM((CASE WHEN l.book = ${SALE} OR (l.book = 11 AND l.ag_book = ${SALE}) THEN 1 ELSE -1 END) * (CASE WHEN slab.slab_key IS NULL THEN COALESCE(l.amount::numeric, 0) ELSE COALESCE(ext.s_lastot::numeric, 0) - COALESCE(ext.slab_amt::numeric, 0) END)), 0) AS net`
    + ` FROM ${ctx.sch}.ledger l LEFT JOIN slab ON TRUE LEFT JOIN ${ctx.sch}.ledger_ext ext ON ext.led_id = l.led_key AND ext.il_id IS NULL AND ext.slab_id = slab.slab_key JOIN ${ctx.sch}.account ac ON ac.code = l.code`
    + ` WHERE l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND (l.book = ${SALE} OR (l.book = ${CREDIT_NOTE} AND l.ag_book = ${SALE}) OR (l.book = 11 AND l.ag_book = ${SALE}))`
    + ` GROUP BY l.code, ac.name, 3`, [ctx.period.from, ctx.period.to]);
  // The months from the first day of the period to its last.
  const months: { key: string; caption: string }[] = [];
  const start = new Date(`${ctx.period.from}T00:00:00`);
  const end = new Date(`${ctx.period.to}T00:00:00`);
  for (let at = new Date(start.getFullYear(), start.getMonth(), 1); at <= end; at = new Date(at.getFullYear(), at.getMonth() + 1, 1)) {
    months.push({ key: `${at.getFullYear()}-${pad(at.getMonth() + 1)}`, caption: `${MONTHS_SHORT[at.getMonth()]}-${at.getFullYear()}` });
  }
  const byParty = new Map<number, { name: string; code: number; net: Record<string, number>; total: number }>();
  for (const row of found) {
    const entry = byParty.get(num(row.code)) ?? { name: String(row.name ?? ""), code: num(row.code), net: {}, total: 0 };
    entry.net[String(row.month)] = (entry.net[String(row.month)] ?? 0) + num(row.net);
    entry.total += num(row.net);
    byParty.set(num(row.code), entry);
  }
  const list = [...byParty.values()].filter((entry) => entry.total !== 0 || Object.values(entry.net).some((value) => value !== 0)).sort((a, b) => b.total - a.total).slice(0, 500);
  const monthKey = (key: string) => `m_${key.replace("-", "_")}`;
  const out = list.map((entry) => ({ name: entry.name, code: entry.code, ...Object.fromEntries(months.map((month) => [monthKey(month.key), entry.net[month.key] ?? 0])), total: entry.total }));
  const sum = (key: string) => out.reduce((total, row) => total + num((row as Record<string, string | number>)[key]), 0);
  return {
    id: 61, title: "Month-wise sales of each party", columns: [text("name", "Party"), ...months.map((month) => money(monthKey(month.key), month.caption)), money("total", "Total")],
    rows: out.length === 0 ? [] : [...out, { name: "Total", ...Object.fromEntries(months.map((month) => [monthKey(month.key), sum(monthKey(month.key))])), total: sum("total") }],
    note: `${ctx.period.label}. Net sales before tax for each party and month (the 500 largest parties). ${SALES_NOTE}`,
  };
}

T.push({
  id: 63, question: "Show month-wise purchases of a supplier.", defaultPeriod: "year", needsParty: true, partyBook: 3, terms: [/month/, /purchas|bought|buying/], not: [/compar|versus|\bvs\b|last month|previous month|this month|current month|business|summar|sale|sales|return/],
  runAll: (ctx) => monthlyPurchasesMatrix(ctx),
  run: (ctx) => monthlyPurchases(ctx, ctx.party as Party),
});

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Purchases (the Purchase book's bills, tax included) of each month of the period, of one supplier or of the whole company; a month opens into its bills. */
async function monthlyPurchases(ctx: Ctx, party?: Party): Promise<AskAnswer> {
  const found = await rows(ctx,
    `SELECT to_char(doc_date, 'YYYY-MM') AS month, COUNT(*) AS bills, COALESCE(SUM(amount::numeric), 0) AS amount FROM ${ctx.sch}.ledger WHERE book = ${PURCHASE} AND doc_pos = 'A' AND doc_date >= $1::date AND doc_date <= $2::date${party ? " AND code = $3" : ""} GROUP BY 1 ORDER BY 1`,
    party ? [ctx.period.from, ctx.period.to, party.code] : [ctx.period.from, ctx.period.to]);
  const list = found.map((row) => { const [year, month] = String(row.month).split("-"); return { key: String(row.month), month: `${MONTHS_SHORT[Number(month) - 1]}-${year}`, bills: num(row.bills), amount: num(row.amount) }; });
  // Each month against the month before it, as the sales do: the first month is 0 (nothing before it), a month after a month of no purchases 0 % too.
  const changed = list.map((row, at) => {
    const before = at === 0 ? null : list[at - 1].amount;
    const diff = before === null ? 0 : row.amount - before;
    return { ...row, diff, pct: before === null || before === 0 ? 0 : (diff / Math.abs(before)) * 100 };
  });
  return {
    id: 63, title: party ? `Month-wise purchases: ${party.name}` : "Month-wise purchases", columns: [text("month", "Month"), int("bills", "Bills"), money("amount", "Purchases"), money("diff", "Change from Last Month"), money("pct", "Change %")],
    rows: list.length === 0 ? [] : [...changed.map((row) => ({ month: row.month, bills: row.bills, amount: row.amount, diff: row.diff, pct: row.pct, detail: `pmonth:${row.key}:${party?.code ?? 0}` })), { month: "Total", bills: list.reduce((t, r) => t + r.bills, 0), amount: list.reduce((t, r) => t + r.amount, 0), diff: "", pct: "", detail: "" }],
    ...(party ? { ledger: { code: party.code, name: party.name } } : {}),
    ...(list.length > 0 ? { chart: { label: "month", value: "amount", count: list.length } } : {}),
    note: `${ctx.period.label}: the Purchase book, with tax. Change is each month against the month before (the first month shows 0; a month after a month with no purchases also shows 0 %). Click a month to show its bills, click again to hide them.`,
  };
}

/** Month-wise purchases of every supplier: a row for each supplier (largest first), a column for each month of the period and a total, as the sales have it. */
async function monthlyPurchasesMatrix(ctx: Ctx): Promise<AskAnswer> {
  const found = await rows(ctx,
    `SELECT l.code, btrim(ac.name) AS name, to_char(l.doc_date, 'YYYY-MM') AS month, COALESCE(SUM(l.amount::numeric), 0) AS amount FROM ${ctx.sch}.ledger l JOIN ${ctx.sch}.account ac ON ac.code = l.code`
    + ` WHERE l.book = ${PURCHASE} AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY l.code, ac.name, 3`, [ctx.period.from, ctx.period.to]);
  const months: { key: string; caption: string }[] = [];
  const start = new Date(`${ctx.period.from}T00:00:00`);
  const end = new Date(`${ctx.period.to}T00:00:00`);
  for (let at = new Date(start.getFullYear(), start.getMonth(), 1); at <= end; at = new Date(at.getFullYear(), at.getMonth() + 1, 1)) {
    months.push({ key: `${at.getFullYear()}-${pad(at.getMonth() + 1)}`, caption: `${MONTHS_SHORT[at.getMonth()]}-${at.getFullYear()}` });
  }
  const bySupplier = new Map<number, { name: string; code: number; amounts: Record<string, number>; total: number }>();
  for (const row of found) {
    const entry = bySupplier.get(num(row.code)) ?? { name: String(row.name ?? ""), code: num(row.code), amounts: {}, total: 0 };
    entry.amounts[String(row.month)] = (entry.amounts[String(row.month)] ?? 0) + num(row.amount);
    entry.total += num(row.amount);
    bySupplier.set(num(row.code), entry);
  }
  const list = [...bySupplier.values()].filter((entry) => entry.total !== 0).sort((a, b) => b.total - a.total).slice(0, 500);
  const monthKey = (key: string) => `m_${key.replace("-", "_")}`;
  const out = list.map((entry) => ({ name: entry.name, code: entry.code, ...Object.fromEntries(months.map((month) => [monthKey(month.key), entry.amounts[month.key] ?? 0])), total: entry.total }));
  const sum = (key: string) => out.reduce((total, row) => total + num((row as Record<string, string | number>)[key]), 0);
  return {
    id: 63, title: "Month-wise purchases of each supplier", columns: [text("name", "Supplier"), ...months.map((month) => money(monthKey(month.key), month.caption)), money("total", "Total")],
    rows: out.length === 0 ? [] : [...out, { name: "Total", ...Object.fromEntries(months.map((month) => [monthKey(month.key), sum(monthKey(month.key))])), total: sum("total") }],
    note: `${ctx.period.label}: the Purchase book, with tax, for each supplier and month (the 500 largest suppliers). A supplier with no purchase in a month shows 0 there.`,
  };
}

T.push({
  id: 60, question: "Summarize my business performance this month.", defaultPeriod: "month", terms: [/summar|performance|overview|how is my business|business/], not: [/customer|product/],
  run: async (ctx) => {
    const sales = (await netSales(ctx, ctx.period.from, ctx.period.to, false))[0];
    const purchases = await bookTotal(ctx, PURCHASE, ctx.period.from, ctx.period.to);
    const flows = (await rows(ctx,
      `SELECT COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.book IN (4, 6) AND l.ac_dbcode = 2), 0) AS received, COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.book IN (4, 6) AND l.ac_dbcode = 1), 0) AS paid,`
      + ` COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.book = 15), 0) AS expenses FROM ${ctx.sch}.ledger l WHERE l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND l.book IN (4, 6, 15)`, [ctx.period.from, ctx.period.to]))[0];
    const receivable = (await balances(ctx, 2)).filter((row) => row.closing > 0).reduce((sum, row) => sum + row.closing, 0);
    const payable = (await balances(ctx, 3)).filter((row) => row.closing < 0).reduce((sum, row) => sum - row.closing, 0);
    return {
      id: 60, title: "Business summary", choices: ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This quarter", "Last quarter", "This half year", "Last half year", "This year"].map((label) => ({ label, question: `Summarize my business performance ${label.toLowerCase()}.` })), columns: [text("item", "Item"), money("value", "Value")],
      rows: [{ item: "Net sales (before tax)", value: sales.net, detail: "sales" }, { item: "Sales entries", value: sales.entries, detail: "sales" }, { item: "Purchases (with tax)", value: purchases.total, detail: "purchase" }, { item: "Money received (cash and bank)", value: num(flows.received), detail: "received" }, { item: "Money paid (cash and bank)", value: num(flows.paid), detail: "paid" },
        { item: "Expenses (with tax)", value: num(flows.expenses), detail: "expenses" }, { item: "Customers owe (as on today)", value: receivable, detail: "owe:2" }, { item: "Owed to suppliers (as on today)", value: payable, detail: "owe:3" }],
      note: `${ctx.period.label}. ${SALES_NOTE} Click a line to show what it is made of, click again to hide it.`,
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Management review, cash flow, suppliers, expenses and manufacturing costing (L)
//
// Questions an owner asks of the whole business. Each one is a fixed read-only query over the company's own tables, built from the pieces above
// (sales, balances, the bills of the Outstanding Agewise report, cash and bank, purchases, expenses, the bill of material). Where the books do not
// hold what a question needs (delivery dates, production orders), the answer says so instead of guessing.

const addDays = (day: string, days: number) => { const at = new Date(`${day}T00:00:00`); return iso(new Date(at.getFullYear(), at.getMonth(), at.getDate() + days)); };
const spanDays = (from: string, to: string) => Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1);
const pctOf = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);
const round2 = (value: number) => Math.round(value * 100) / 100;
const asRows = (list: Record<string, string | number>[]) => list;
const monthLabel = (day: Date) => `${MONTHS_SHORT[day.getMonth()]}-${day.getFullYear()}`;
const sumOf = <Row>(list: readonly Row[], pick: (row: Row) => number) => list.reduce((total, row) => total + pick(row), 0);

/** An amount written in the question: 500000, 5,00,000, 5 lakh, 2.5 crore, 50k (a number followed by days, months, weeks or % is not one). */
function amountIn(question: string): number | null {
  const pattern = /(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?|thousand|k\b)?/gi;
  for (let found = pattern.exec(question); found; found = pattern.exec(question)) {
    const after = question.slice(found.index + found[0].length);
    if (/^\s*(days?|months?|weeks?|years?|%|percent|per cent)/i.test(after)) continue;
    const unit = (found[2] ?? "").toLowerCase();
    const factor = unit.startsWith("cr") ? 10000000 : unit.startsWith("lakh") || unit.startsWith("lac") ? 100000 : unit === "thousand" || unit === "k" ? 1000 : 1;
    const value = Number(found[1].replace(/,/g, "")) * factor;
    if (Number.isFinite(value) && value >= 1) return value;
  }
  return null;
}

/** Cash in hand and at the banks: each account's opening with its entries up to today. */
async function cashPosition(ctx: Ctx) {
  const total = async (book: 4 | 6) => sumOf(await cashAccounts(ctx, book, ctx.today), (row) => row.opening + row.movement);
  const cash = await total(4);
  const bank = await total(6);
  return { cash, bank, total: cash + bank };
}

const receivableTotal = async (ctx: Ctx) => sumOf((await balances(ctx, 2)).filter((row) => row.closing > 0), (row) => row.closing);
const payableTotal = async (ctx: Ctx) => sumOf((await balances(ctx, 3)).filter((row) => row.closing < 0), (row) => -row.closing);
const expenseTotal = async (ctx: Ctx, from: string, to: string) => num((await rows(ctx, `SELECT COALESCE(SUM(amount::numeric), 0) AS total FROM ${ctx.sch}.ledger WHERE book = 15 AND doc_pos = 'A' AND doc_date >= $1::date AND doc_date <= $2::date`, [from, to]))[0]?.total);
/** Bills falling due after `after` (exclusive; none: from the beginning) up to `upto` (inclusive), by their due date. */
const dueBetween = (bills: readonly Bill[], upto: string, after?: string) => round2(sumOf(bills.filter((bill) => bill.dueIso <= upto && (after === undefined || bill.dueIso > after)), (bill) => bill.pending));

/** The months of the year so far (a fraction), for turning a year's total into a monthly average. */
const monthsSoFar = (from: string, to: string) => Math.max(1, spanDays(from, to) / 30.4375);

const supplierBillColumns = [text("name", "Supplier"), text("doc", "Bill"), date("billDate", "Bill Date"), date("due", "Due Date"), money("pending", "Pending"), int("overdueDays", "Days Overdue")];

/** The supplier bills falling due in a window of days from today (offsets, the first exclusive): a row of the payables answers opens them. */
async function supplierDueDetail(ctx: Ctx, after: number, upto: number): Promise<AskAnswer> {
  const low = addDays(ctx.today, after);
  const high = addDays(ctx.today, upto);
  const list = (await agewiseBills(ctx, 3)).filter((bill) => bill.dueIso > low && bill.dueIso <= high).sort((a, b) => a.dueIso.localeCompare(b.dueIso) || b.pending - a.pending);
  const shown = list.slice(0, 500).map((bill) => ({ name: bill.name, doc: bill.doc, billDate: bill.billDate, due: bill.due, pending: bill.pending, overdueDays: bill.overdueDays, code: bill.code }));
  return { id: 0, title: `Supplier bills due (${list.length})`, columns: supplierBillColumns, rows: list.length === 0 ? [] : [...shown, { name: "Total", doc: "", billDate: "", due: "", pending: sumOf(list, (bill) => bill.pending), overdueDays: "" }], note: `${AGEWISE_NOTE.replace("(a party's", "(a supplier's")} ${list.length > 500 ? "The first 500 are shown." : ""}` };
}

// --- 111: where to look first

T.push({
  id: 111, question: "Which areas of the business need immediate attention?", defaultPeriod: "none",
  terms: [/areas?|parts?|aspects?|things?/, /business|company|firm/, /immediate|urgent|attention|priority|first|critical/, /need|require|which|what/],
  run: async (ctx) => ({ ...(await (T.find((template) => template.id === 105) as Template).run(ctx)), id: 111, title: "Areas of the business that need immediate attention" }),
});

// --- 112: next month's sales

T.push({
  id: 112, question: "Forecast next month's sales using historical data.", defaultPeriod: "none",
  terms: [/forecast|predict|projection|project|expected|estimate|anticipate/, /sales?|revenue|turnover/, /next|coming|upcoming|future/], not: [/payment|collection|receipt|cash|expense|purchase/],
  run: async (ctx) => {
    const all = await recentSales(ctx, 12);
    const list = all.filter((row) => !row.partial);
    const columns = [text("month", "Month"), money("net", "Net Sales"), text("basis", "Basis")];
    if (list.length < 3) return { id: 112, title: "Sales forecast", columns, rows: [], note: "There are fewer than three complete months of sales to forecast from." };
    const today = new Date(`${ctx.today}T00:00:00`);
    const steps = all.length > 0 && all[all.length - 1].partial ? 2 : 1;
    const target = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    // A straight line through the months (least squares) carried on to next month, and the average of the last three months; the forecast is the two together.
    const ys = list.map((row) => row.net);
    const n = ys.length;
    const meanX = (n - 1) / 2;
    const meanY = sumOf(ys, (value) => value) / n;
    const slope = sumOf(ys, (value) => value) === 0 ? 0 : ys.reduce((total, value, at) => total + (at - meanX) * (value - meanY), 0) / ys.reduce((total, _value, at) => total + (at - meanX) ** 2, 0);
    const trend = Math.max(0, meanY + slope * (n - 1 + steps - meanX));
    const recent = sumOf(ys.slice(-3), (value) => value) / 3;
    const forecast = (trend + recent) / 2;
    const spread = Math.sqrt(sumOf(ys, (value) => (value - meanY) ** 2) / n);
    const label = monthLabel(target);
    const history = list.map((row) => ({ month: row.month, net: row.net, basis: "Actual" }));
    const change = recent === 0 ? 0 : pctOf(forecast - recent, recent);
    return {
      id: 112, title: `Sales forecast for ${label}`, columns,
      summary: `Sales for ${label} are forecast at about ${grouping.format(forecast)} (${change >= 0 ? "+" : ""}${change.toFixed(1)}% on the last three months' average of ${grouping.format(recent)}), most likely between ${grouping.format(Math.max(0, forecast - spread))} and ${grouping.format(forecast + spread)}.`,
      rows: [...history, { month: label, net: recent, basis: "Average of the last 3 months" }, { month: label, net: trend, basis: `Trend line through ${n} months (${slope >= 0 ? "rising" : "falling"} ${grouping.format(Math.abs(slope))} a month)` }, { month: label, net: forecast, basis: "Forecast (the two together)" }],
      chart: { label: "month", value: "net", count: history.length },
      note: `Net sales of the last ${n} complete months${steps === 2 ? " (this month is not complete, so it is left out)" : ""}. The range is the usual month-to-month swing of those months. A forecast from history only: it does not know of new orders, price changes or seasons. ${SALES_NOTE}`,
    };
  },
});

// --- 113: sales by region, branch, salesman and area

const DIMENSIONS: readonly { label: string; pattern: string }[] = [
  { label: "Salesman", pattern: "sales ?m[ae]n|sales ?person|sales ?rep|\\msalesm" }, { label: "Area", pattern: "\\marea" }, { label: "Region", pattern: "region" }, { label: "Branch", pattern: "branch" }, { label: "Zone", pattern: "\\mzone" },
];

/** Each customer's value of an account master add-on field (Sales Man, Area ...): the field's caption and the group name by customer code; null when the company has no such field. */
async function dimensionGroups(ctx: Ctx, dimension: { label: string; pattern: string }): Promise<{ label: string; of: Map<number, string> } | null> {
  const field = (await rows(ctx, `SELECT fiel_key, btrim(fiel_desc) AS fiel_desc, lower(btrim(fiel_save)) AS fiel_save, upper(btrim(fiel_type)) AS fiel_type FROM ${ctx.sch}.addon_fld WHERE fiel_relate = 'A' AND fiel_pos <> 'D' AND (fiel_desc ~* $1 OR fiel_save ~* $1) AND fiel_save ~ '^[A-Za-z0-9_]+$' ORDER BY fiel_serial, fiel_key LIMIT 1`, [dimension.pattern]))[0];
  const save = field ? String(field.fiel_save) : "";
  // The account master keeps an add-on field in addon_data as txt_<field> (the name) and key_<field> (the code of the choice in addon_sub).
  const named = field && await hasColumn(ctx, "addon_data", `txt_${save}`);
  const keyed = field && !named && await hasColumn(ctx, "addon_data", `key_${save}`);
  const plain = field && !named && !keyed && await hasColumn(ctx, "addon_data", save);
  if (!field || (!named && !keyed && !plain)) return null;
  const group = named ? `COALESCE(NULLIF(btrim(ad.txt_${save}::text), ''), '(not set)')`
    : keyed ? `COALESCE(NULLIF(btrim(s.sub_name), ''), '(not set)')` : `COALESCE(NULLIF(btrim(ad.${save}::text), ''), '(not set)')`;
  const found = await rows(ctx, `SELECT DISTINCT ON (ad.code) ad.code, ${group} AS grp FROM ${ctx.sch}.addon_data ad ${keyed ? `LEFT JOIN ${ctx.sch}.addon_sub s ON s.sub_code::text = ad.key_${save}::text AND s.para_id = ${num(field.fiel_key)}` : ""} WHERE ad.code IS NOT NULL ORDER BY ad.code, ad.aon_key DESC`);
  return { label: String(field.fiel_desc) || dimension.label, of: new Map(found.map((row) => [num(row.code), String(row.grp)] as const)) };
}

/** A row of the revenue-by-group answer: the customers of that Sales Man / Area ... with their net sales. */
async function groupCustomers(ctx: Ctx, index: number, name: string, from: string, to: string): Promise<AskAnswer | null> {
  const dimension = DIMENSIONS[index];
  const groups = dimension ? await dimensionGroups(ctx, dimension) : null;
  if (!groups) return null;
  const list = (await netSales(ctx, from, to, true)).filter((row) => row.net !== 0 && (groups.of.get(row.code) ?? "(not set)") === name).sort((a, b) => b.net - a.net);
  const total = sumOf(list, (row) => row.net);
  return {
    id: 0, title: `${groups.label} ${name}: customers (${list.length})`, columns: [int("no", "No."), text("name", "Customer"), int("entries", "Entries"), ...salesColumns, money("share", "Share %")],
    rows: list.length === 0 ? [] : [...list.map((row, at) => ({ no: at + 1, name: row.name, entries: row.entries, sales: row.sales, returns: -row.returns, net: row.net, share: pctOf(row.net, total), code: row.code })), { no: "", name: "Total", entries: sumOf(list, (row) => row.entries), sales: sumOf(list, (row) => row.sales), returns: -sumOf(list, (row) => row.returns), net: total, share: 100 }],
    note: `${dmy(from)} to ${dmy(to)}. ${SALES_NOTE} Double-click a row to open the customer's ledger.`,
  };
}

T.push({
  id: 113, question: "Which regions, branches or salesmen or area generate the most revenue?", defaultPeriod: "year",
  terms: [/regions?|branch(?:es)?|salesm[ae]n|sales ?persons?|areas?|zones?|territor/, /revenue|sales|turnover|generat|business|most/], not: [/profit|outstanding|overdue|party|product/],
  run: async (ctx) => {
    const sales = await netSales(ctx, ctx.period.from, ctx.period.to, true);
    const total = sumOf(sales, (row) => row.net);
    const out: Record<string, string | number>[] = [];
    const missing: string[] = [];
    for (const dimension of DIMENSIONS) {
      try {
        const groups = await dimensionGroups(ctx, dimension);
        if (!groups) { missing.push(dimension.label); continue; }
        const of = groups.of;
        const totals = new Map<string, { net: number; customers: number }>();
        for (const row of sales) {
          if (row.net === 0) continue;
          const name = of.get(row.code) ?? "(not set)";
          const entry = totals.get(name) ?? totals.set(name, { net: 0, customers: 0 }).get(name)!;
          entry.net += row.net; entry.customers += 1;
        }
        for (const [name, entry] of [...totals].sort((a, b) => b[1].net - a[1].net).slice(0, 25)) out.push({ dimension: groups.label, name, customers: entry.customers, net: entry.net, share: pctOf(entry.net, total), detail: `grp:${DIMENSIONS.indexOf(dimension)}:${encodeURIComponent(name)}:${ctx.period.from}:${ctx.period.to}` });
      } catch { missing.push(dimension.label); }
    }
    return {
      id: 113, title: "Revenue by region, branch, salesman and area", columns: [text("dimension", "Grouped By"), text("name", "Name"), int("customers", "Customers"), money("net", "Net Sales"), money("share", "Share %")],
      rows: out,
      note: `${ctx.period.label}. Each customer's net sales are put under the value set on its account master (the add-on field), largest first; "(not set)" are customers without one. Click a row to show its customers.${missing.length > 0 ? ` No field was found for: ${missing.join(", ")}.` : ""} ${SALES_NOTE}`,
    };
  },
});

// --- 114, 115: dependence on the biggest customers

async function concentration(ctx: Ctx, id: number, title: string, bands: boolean): Promise<AskAnswer> {
  const list = (await netSales(ctx, ctx.period.from, ctx.period.to, true)).filter((row) => row.net > 0).sort((a, b) => b.net - a.net);
  const total = sumOf(list, (row) => row.net);
  const share = (count: number) => pctOf(sumOf(list.slice(0, count), (row) => row.net), total);
  const topN = ctx.top;
  const verdict = share(1) >= 25 || share(10) >= 70 ? "High dependence: a few customers carry most of the sales, so losing one would hurt." : share(1) >= 15 || share(10) >= 50 ? "Moderate dependence: watch the biggest customers." : "Healthy spread: no small group of customers carries the sales.";
  const summary = `The top ${topN} customers bring ${share(topN).toFixed(1)}% of net sales (${grouping.format(sumOf(list.slice(0, topN), (row) => row.net))} of ${grouping.format(total)}); the biggest alone ${share(1).toFixed(1)}%. ${verdict}`;
  if (bands) {
    const span = `${ctx.period.from}:${ctx.period.to}`;
    const band = (item: string, count: number) => ({ item, customers: Math.min(count, list.length), net: sumOf(list.slice(0, count), (row) => row.net), share: share(count), detail: `conc:0:${count}:${span}` });
    let cumulative = 0; let eighty = 0;
    for (const row of list) { cumulative += row.net; eighty += 1; if (cumulative >= total * 0.8) break; }
    return {
      id, title, summary, columns: [text("item", "Group"), int("customers", "Customers"), money("net", "Net Sales"), money("share", "Share of Sales %")],
      rows: [band("Biggest customer", 1), band("Top 3 customers", 3), band("Top 5 customers", 5), band("Top 10 customers", 10), band("Top 20 customers", 20), { item: "All other customers", customers: Math.max(0, list.length - 20), net: sumOf(list.slice(20), (row) => row.net), share: pctOf(sumOf(list.slice(20), (row) => row.net), total), detail: `conc:20:99999:${span}` },
        { item: `Customers that make 80% of sales`, customers: eighty, net: sumOf(list.slice(0, eighty), (row) => row.net), share: share(eighty), detail: `conc:0:${eighty}:${span}` }],
      note: `${ctx.period.label}. ${list.length} customers bought. Dependence is high when the biggest customer is 25% of sales or the top 10 are 70%. Click a row to show its customers. ${SALES_NOTE}`,
    };
  }
  let running = 0;
  const top = list.slice(0, topN).map((row, at) => { running += row.net; return { no: at + 1, name: row.name, net: row.net, share: pctOf(row.net, total), cumulative: pctOf(running, total), code: row.code }; });
  return {
    id, title, summary, columns: [int("no", "No."), text("name", "Customer"), money("net", "Net Sales"), money("share", "Share %"), money("cumulative", "Cumulative %")],
    rows: top.length === 0 ? [] : [...top, { no: "", name: `Top ${top.length} together`, net: sumOf(top, (row) => row.net), share: share(topN), cumulative: "" }, { no: "", name: "All customers", net: total, share: 100, cumulative: "" }],
    note: `${ctx.period.label}. ${SALES_NOTE}`,
  };
}

T.push({
  id: 114, question: "Are we too dependent on a few major customers?", defaultPeriod: "year",
  terms: [/depend|concentrat|relian|reliant|too much|too many|few/, /customers?|clients?/, /few|major|key|top|big|main|handful|small number/], not: [/outstanding|overdue|credit|profit|percent|%/],
  run: (ctx) => concentration(ctx, 114, "Dependence on major customers", true),
});

T.push({
  id: 115, question: "What percentage of total sales comes from our top 10 customers?", defaultPeriod: "year",
  terms: [/percent|%|share|proportion|how much/, /sales|revenue|turnover/, /top|biggest|largest|major|key|best/, /customers?|clients?/], not: [/outstanding|overdue|profit|supplier|product|depend/],
  run: (ctx) => concentration(ctx, 115, `Share of sales from the top ${ctx.top} customers`, false),
});

// --- 116: sales needed to cover the monthly expenses

T.push({
  id: 116, question: "What sales amount is required to cover our monthly expenses?", defaultPeriod: "year",
  terms: [/sales?|revenue|turnover/, /required|needed|need|break[- ]?even|cover|target|enough/, /monthly|month|expenses?|overheads?|costs?/], not: [/forecast|compar|increas|top|which/],
  run: async (asked) => {
    // The year so far, whatever the wording says ("monthly" would make the period a month).
    const ctx: Ctx = { ...asked, period: { from: iso(asked.session.tarikh1), to: asked.today, label: `This financial year (${dmy(asked.session.tarikh1)} to ${dmy(asked.today)})` } };
    const months = monthsSoFar(ctx.period.from, ctx.period.to);
    const expenses = await expenseTotal(ctx, ctx.period.from, ctx.period.to);
    const monthly = expenses / months;
    const profit = await (T.find((template) => template.id === 58) as Template).run(ctx);
    const margin = num(profit.rows.find((row) => String(row.item) === "Gross profit margin %")?.value);
    const net = num(profit.rows.find((row) => String(row.item) === "Net sales")?.value);
    const required = margin > 0 ? monthly / (margin / 100) : 0;
    const actual = net / months;
    return {
      id: 116, title: "Sales needed each month to cover the expenses",
      columns: [text("item", "Item"), money("value", "Value")],
      ...(margin > 0 ? { summary: `To cover ${grouping.format(monthly)} of expenses a month at a gross margin of ${margin.toFixed(1)}%, net sales of about ${grouping.format(required)} a month are needed; the business sells ${grouping.format(actual)} a month, which is ${actual >= required ? `${grouping.format(actual - required)} above` : `${grouping.format(required - actual)} below`} that.` } : {}),
      rows: [{ item: "Expenses of the period (with tax)", value: expenses }, { item: "Months in the period", value: round2(months) }, { item: "Average expenses a month", value: monthly }, { item: "Gross profit margin %", value: margin },
        { item: "Net sales needed a month to cover the expenses", value: required }, { item: "Average net sales a month so far", value: actual }, { item: margin > 0 && actual >= required ? "Cushion above break-even a month" : "Shortfall below break-even a month", value: Math.abs(actual - required) }],
      note: `${ctx.period.label}. Expenses are the Expense book (book 15). Break-even sales are the monthly expenses divided by the gross profit margin of the year so far (from "What is my gross profit margin?"; a product with no cost counts at 0, so the margin is on the high side).`,
    };
  },
});

// --- 117: working capital

T.push({
  id: 117, question: "What is our working capital position?", defaultPeriod: "none",
  terms: [/working capital/, /position|status|health|adequate|level|situation/, /what|how|show|our|is|are|do/], not: [/tying|tied|blocked|locked|stuck|most|biggest/],
  run: async (ctx) => {
    const cash = await cashPosition(ctx);
    const receivable = await receivableTotal(ctx);
    const payable = await payableTotal(ctx);
    const stock = await stockValue(ctx, 0, "", true);
    const stockTotal = num(stock.rows[stock.rows.length - 1]?.value);
    const assets = cash.total + receivable + stockTotal;
    const capital = assets - payable;
    const ratio = payable === 0 ? 0 : assets / payable;
    const quick = payable === 0 ? 0 : (cash.total + receivable) / payable;
    return {
      id: 117, title: "Working capital position",
      summary: payable === 0 ? `Working capital is ${grouping.format(capital)}; there is nothing owed to suppliers.` : `Working capital is ${grouping.format(capital)}: current assets are ${ratio.toFixed(2)} times the amount owed to suppliers (quick ratio ${quick.toFixed(2)}). ${ratio >= 1.5 ? "The position is comfortable." : ratio >= 1 ? "The position is adequate but not wide." : "Current assets do not cover what is owed: payments may be hard to meet."}`,
      columns: [text("item", "Item"), money("value", "Amount")],
      rows: asRows([{ item: "Cash in hand", value: cash.cash }, { item: "Bank balances", value: cash.bank, }, { item: "Customers owe (receivable)", value: receivable, detail: "owe:2" }, { item: "Stock on hand, at cost", value: stockTotal, detail: "stock" },
        { item: "Current assets", value: assets }, { item: "Less: owed to suppliers (payable)", value: -payable, detail: "owe:3" }, { item: "Working capital", value: capital }, { item: "Current ratio (assets over payable)", value: round2(ratio) }, { item: "Quick ratio (cash, bank and receivable over payable)", value: round2(quick) }]),
      note: `As on ${dmy(ctx.today)}. Only what the books hold is counted: other short-term liabilities (taxes, salaries due, loans) are not, so the real position is lower by those. Stock is valued at average cost; customers in credit and suppliers in debit are not counted.`,
    };
  },
});

// --- 118: can a purchase be afforded

/** Cash and bank now, the customer bills falling due in `days` days (not yet overdue) and the supplier bills due by then (including those already due). */
async function cashOutlook(ctx: Ctx, days: number) {
  const cash = await cashPosition(ctx);
  const horizon = addDays(ctx.today, days);
  const inflow = round2(sumOf((await agewiseBills(ctx)).filter((bill) => bill.dueIso > ctx.today && bill.dueIso <= horizon), (bill) => bill.pending));
  const outflow = dueBetween(await agewiseBills(ctx, 3), horizon);
  return { cash, inflow, outflow, horizon, net: cash.total + inflow - outflow };
}

T.push({
  id: 118, question: "Can we afford a proposed purchase based on current cash flow?", defaultPeriod: "none",
  terms: [/afford|can we (?:buy|purchase|pay|spend)|enough (?:cash|money)|manage to (?:buy|pay)/, /purchase|buy|buying|expense|spend|investment|equipment|machine|proposed/], not: [/upcoming|payments?\b.*meet/],
  run: async (ctx) => {
    const amount = amountIn(ctx.question ?? "");
    const outlook = await cashOutlook(ctx, 30);
    const buffer = (await expenseTotal(ctx, iso(ctx.session.tarikh1), ctx.today)) / monthsSoFar(iso(ctx.session.tarikh1), ctx.today);
    const free = outlook.net - buffer;
    const rowsOut: Record<string, string | number>[] = [{ item: "Cash in hand and at the banks", value: outlook.cash.total }, { item: "Add: customer bills falling due in the next 30 days", value: outlook.inflow }, { item: "Less: supplier bills due by then (including those already due)", value: -outlook.outflow },
      { item: "Less: one month's average expenses kept aside", value: -buffer }, { item: "Cash that can be spent on the purchase", value: free }];
    if (amount === null) return { id: 118, title: "Can we afford the purchase?", columns: [text("item", "Item"), money("value", "Amount")], summary: "Say the amount of the purchase in the question, for example: Can we afford a purchase of 5 lakh based on current cash flow?", rows: rowsOut, note: `As on ${dmy(ctx.today)}. This is the cash that is free for a purchase, before the amount is known.` };
    const left = free - amount;
    rowsOut.push({ item: "Proposed purchase", value: -amount }, { item: left >= 0 ? "Cash left after the purchase" : "Shortfall after the purchase", value: left });
    return {
      id: 118, title: `Can we afford a purchase of ${grouping.format(amount)}?`, columns: [text("item", "Item"), money("value", "Amount")],
      summary: left >= 0 ? `Yes: after supplier payments and a month's expenses there is ${grouping.format(free)} free, so ${grouping.format(left)} is left after the purchase.` : `Not comfortably: only ${grouping.format(Math.max(0, free))} is free after supplier payments and a month's expenses, ${grouping.format(-left)} short of the purchase. Collecting ${grouping.format(-left)} of the overdue bills, or paying in instalments, would cover it.`,
      rows: rowsOut, note: `As on ${dmy(ctx.today)}. Customer bills are counted when they fall due in the next 30 days (overdue bills are not counted as they may not come); supplier bills when due by ${dmy(outlook.horizon)}, including those already due. Expenses are the year's average a month.`,
    };
  },
});

// --- 119: the largest customer pays late

T.push({
  id: 119, question: "What happens to cash flow if our largest customer pays 30 days late?", defaultPeriod: "year",
  terms: [/largest|biggest|top|major|main|key/, /customer|client/, /late|delay|defer|postpone|slow|\d+\s*days/, /cash ?flow|cash|payment|pays?|money/], not: [/outstanding|overdue bills/],
  run: async (ctx) => {
    const days = numberAfter(ctx.question ?? "", /(\d+)\s*days?/) ?? 30;
    const sales = (await netSales(ctx, ctx.period.from, ctx.period.to, true)).sort((a, b) => b.net - a.net);
    const top = sales[0];
    if (!top) return { id: 119, title: "A late payment from the largest customer", columns: [text("item", "Item")], rows: [], note: "There are no sales in the period." };
    const outlook = await cashOutlook(ctx, days);
    const mine = (await agewiseBills(ctx)).filter((bill) => bill.code === top.code);
    const slipping = round2(sumOf(mine.filter((bill) => bill.dueIso > ctx.today && bill.dueIso <= outlook.horizon), (bill) => bill.pending));
    const already = round2(sumOf(mine.filter((bill) => bill.dueIso <= ctx.today), (bill) => bill.pending));
    const received = num((await rows(ctx, `SELECT COALESCE(SUM(amount::numeric), 0) AS total FROM ${ctx.sch}.ledger WHERE book IN (4, 6) AND ac_dbcode = 2 AND doc_pos = 'A' AND code = $1 AND doc_date >= $2::date AND doc_date <= $3::date`, [top.code, ctx.period.from, ctx.period.to]))[0]?.total);
    const monthly = received / monthsSoFar(ctx.period.from, ctx.period.to);
    const delayed = Math.max(slipping, monthly * (days / 30));
    const after = outlook.net - delayed;
    return {
      id: 119, title: `If ${top.name} pays ${days} days late`, columns: [text("item", "Item"), money("value", "Amount")],
      summary: after >= 0 ? `The cash flow of the next ${days} days stays positive (${grouping.format(after)}), though ${grouping.format(delayed)} of the inflow slips out of the window.` : `The next ${days} days turn negative: ${grouping.format(-after)} short, because ${grouping.format(delayed)} of the inflow slips out of the window.`,
      rows: asRows([{ item: `Largest customer: ${top.name}`, value: top.net }, { item: "Share of net sales %", value: pctOf(top.net, sumOf(sales, (row) => row.net)) }, { item: "Its average receipts a month", value: monthly }, { item: "Its bills already due (unpaid)", value: already, detail: `bills:${top.code}` }, { item: `Its bills falling due in the next ${days} days`, value: slipping },
        { item: "Cash in hand and at the banks", value: outlook.cash.total }, { item: `Customer bills falling due in the next ${days} days (all)`, value: outlook.inflow }, { item: `Supplier bills due in the next ${days} days (and already due)`, value: -outlook.outflow }, { item: "Cash position at the end, as things stand", value: outlook.net },
        { item: `Less: cash that slips by ${days} days (the larger of its bills due and its usual receipts)`, value: -delayed }, { item: "Cash position at the end, if it pays late", value: after }]),
      note: `${ctx.period.label} for the sales and receipts; bills as on ${dmy(ctx.today)}, looking ${days} days ahead (say another number of days in the question). The largest customer is the one with the most net sales.`,
    };
  },
});

// --- 120: customers who delay the cash flow

T.push({
  id: 120, question: "Which customers are delaying our cash flow the most?", defaultPeriod: "none",
  terms: [/customers?|clients?|parties/, /delay|late|slow|holding|withholding|stuck/, /cash ?flow|cash|money|collection|payments?/], not: [/exceed|limit|risk|oldest|call/],
  run: async (ctx) => {
    const byParty = new Map<number, { code: number; name: string; bills: number; pending: number; weight: number; days: number }>();
    for (const bill of await agewiseBills(ctx)) {
      if (bill.overdueDays <= 0) continue;
      const entry = byParty.get(bill.code) ?? byParty.set(bill.code, { code: bill.code, name: bill.name, bills: 0, pending: 0, weight: 0, days: 0 }).get(bill.code)!;
      entry.bills += 1; entry.pending += bill.pending; entry.weight += bill.pending * bill.overdueDays; entry.days = Math.max(entry.days, bill.overdueDays);
    }
    const list = [...byParty.values()].sort((a, b) => b.weight - a.weight);
    const total = sumOf(list, (row) => row.pending);
    return {
      id: 120, title: "Customers holding back the cash flow", columns: [int("no", "No."), text("name", "Customer"), int("bills", "Overdue Bills"), money("pending", "Overdue Amount"), money("average", "Average Days Late"), int("days", "Max Days Late"), money("share", "Share of Overdue %")],
      rows: list.slice(0, 100).map((row, at) => ({ no: at + 1, name: row.name, bills: row.bills, pending: round2(row.pending), average: round2(row.weight / row.pending), days: row.days, share: pctOf(row.pending, total), code: row.code, detail: `bills:${row.code}` })),
      note: `Ranked by amount times days late, so a big old debt comes before a small recent one. ${grouping.format(total)} is overdue in all, from ${list.length} customers. Click a customer to show its open bills. ${AGEWISE_NOTE}`,
    };
  },
});

// --- 121, 122: payables to suppliers and the cash to meet them

T.push({
  id: 121, question: "How much money is payable to suppliers in the next 7, 15 and 30 days?", defaultPeriod: "none",
  terms: [/payable|\bowe\b|\bdue\b|\bpay\b|to be paid|payments?/, /suppliers?|vendors?|creditors?/, /next|within|coming|upcoming/, /\bdays?\b/],
  run: async (ctx) => {
    const bills = await agewiseBills(ctx, 3);
    const today = ctx.today;
    const windows = [{ item: "Already due (before today)", after: -99999, upto: -1 }, { item: "Due in the next 7 days", after: -1, upto: 7 }, { item: "Due in 8 to 15 days", after: 7, upto: 15 }, { item: "Due in 16 to 30 days", after: 15, upto: 30 }, { item: "Due after 30 days", after: 30, upto: 99999 }];
    let cumulative = 0;
    const out = windows.map((window) => {
      const amount = dueBetween(bills.filter((bill) => bill.dueIso > addDays(today, window.after)), addDays(today, window.upto));
      cumulative += amount;
      return { item: window.item, amount, cumulative: round2(cumulative), bills: bills.filter((bill) => bill.dueIso > addDays(today, window.after) && bill.dueIso <= addDays(today, window.upto)).length, detail: `supdue:${window.after}:${window.upto}` };
    });
    const upTo = (days: number) => dueBetween(bills, addDays(today, days));
    return {
      id: 121, title: "Payable to suppliers by due date",
      summary: `Payable by ${dmy(addDays(today, 7))}: ${grouping.format(upTo(7))}; by ${dmy(addDays(today, 15))}: ${grouping.format(upTo(15))}; by ${dmy(addDays(today, 30))}: ${grouping.format(upTo(30))} (each including what is already due).`,
      columns: [text("item", "When"), money("amount", "Amount"), money("cumulative", "Total Up To Here"), int("bills", "Bills")],
      rows: [...out, { item: "Total payable (open bills)", amount: round2(sumOf(out, (row) => row.amount)), cumulative: "", bills: sumOf(out, (row) => row.bills) }],
      note: `As on ${dmy(today)}. Open supplier bills laid as the Outstanding Agewise report does for customers (a supplier's balance spread over its newest bills first, the rest as Opening), each due on its date plus the supplier's credit days. Click a line to show its bills.`,
    };
  },
});

T.push({
  id: 122, question: "Do we have enough cash to meet upcoming payments?", defaultPeriod: "none",
  terms: [/enough|sufficient|adequate|cover|meet|afford|able to/, /cash|funds|money|bank/, /upcoming|payments?|commitments?|dues?|obligations?|bills?/], not: [/purchase|buy|proposed/],
  run: async (ctx) => {
    const cash = await cashPosition(ctx);
    const suppliers = await agewiseBills(ctx, 3);
    const customers = (await agewiseBills(ctx)).filter((bill) => bill.dueIso > ctx.today);
    const line = (days: number) => {
      const upto = addDays(ctx.today, days);
      const due = dueBetween(suppliers, upto);
      const coming = round2(sumOf(customers.filter((bill) => bill.dueIso <= upto), (bill) => bill.pending));
      return { item: `Next ${days} days`, due, cash: cash.total, surplus: cash.total - due, coming, withComing: cash.total + coming - due };
    };
    const lines = [7, 15, 30].map(line);
    const worst = lines.find((row) => row.surplus < 0);
    return {
      id: 122, title: "Cash against the payments due",
      summary: worst ? `Not by cash alone: the cash of ${grouping.format(cash.total)} falls short by ${grouping.format(-worst.surplus)} for the supplier bills due in the ${worst.item.toLowerCase()}${lines.every((row) => row.withComing >= 0) ? "; the customer bills falling due in that time would cover it" : ", and even the customer bills falling due would not cover it"}.` : `Yes: the cash of ${grouping.format(cash.total)} covers every supplier bill due in the next 30 days (${grouping.format(lines[2].due)}), leaving ${grouping.format(lines[2].surplus)}.`,
      columns: [text("item", "Window"), money("due", "Supplier Bills Due"), money("cash", "Cash and Bank"), money("surplus", "Cash Left / Short"), money("coming", "Customer Bills Falling Due"), money("withComing", "Left / Short With Them")],
      rows: lines, note: `As on ${dmy(ctx.today)}. Supplier bills due by the end of each window include those already due. Customer bills are counted when they fall due inside the window (overdue ones are not counted, they may not come). Cash is cash in hand plus the bank balances as the books show them.`,
    };
  },
});

// --- 123, 124: risky customers

T.push({
  id: 123, question: "Which customers are becoming risky for credit?", defaultPeriod: "none",
  terms: [/customers?|clients?|parties/, /risk|risky|bad debts?|doubtful|default|unsafe|dangerous/, /credit|payment|dues?|becoming|getting|growing/],
  run: async (ctx) => {
    const bills = await agewiseBills(ctx);
    const limits = new Map((await rows(ctx, `SELECT code, "LIMIT"::numeric AS lim FROM ${ctx.sch}.account WHERE book = 2 AND a_pos <> 'D' AND COALESCE("LIMIT"::numeric, 0) > 0`)).map((row) => [num(row.code), num(row.lim)] as const));
    const now = (await balances(ctx, 2)).filter((row) => row.closing > 0);
    const before = new Map((await balances({ ...ctx, today: addDays(ctx.today, -30) }, 2, now.map((row) => row.code))).map((row) => [row.code, row.closing] as const));
    const list = now.map((party) => {
      const mine = bills.filter((bill) => bill.code === party.code);
      const overdue = sumOf(mine.filter((bill) => bill.overdueDays > 0), (bill) => bill.pending);
      const old = sumOf(mine.filter((bill) => bill.overdueDays > 90), (bill) => bill.pending);
      const days = mine.reduce((most, bill) => Math.max(most, bill.overdueDays), 0);
      const limit = limits.get(party.code) ?? 0;
      const grew = before.has(party.code) ? party.closing - (before.get(party.code) ?? 0) : party.closing;
      const reasons: string[] = [];
      let score = 0;
      if (old > 0) { score += 40 + Math.min(20, pctOf(old, party.closing) / 5); reasons.push(`${grouping.format(old)} over 90 days`); }
      else if (overdue > 0) { score += 15 + Math.min(15, pctOf(overdue, party.closing) / 5); reasons.push("overdue bills"); }
      if (limit > 0 && party.closing > limit) { score += 25; reasons.push("over its credit limit"); }
      if (grew > 0 && party.closing >= 10000 && grew >= party.closing * 0.25) { score += 15; reasons.push("balance up 25% in 30 days"); }
      if (days > 60) { score += 10; reasons.push(`oldest bill ${days} days late`); }
      return { code: party.code, name: party.name, outstanding: party.closing, overdue, old, limit, grew, days, score, reasons };
    }).filter((row) => row.score >= 40).sort((a, b) => b.score - a.score || b.outstanding - a.outstanding);
    return {
      id: 123, title: `Customers becoming risky for credit (${list.length})`, columns: [int("no", "No."), text("name", "Customer"), money("outstanding", "Outstanding"), money("overdue", "Overdue"), money("old", "Over 90 Days"), money("limit", "Credit Limit"), money("grew", "Change in 30 Days"), text("risk", "Risk"), text("why", "Why")],
      rows: list.slice(0, 200).map((row, at) => ({ no: at + 1, name: row.name, outstanding: row.outstanding, overdue: round2(row.overdue), old: round2(row.old), limit: row.limit, grew: round2(row.grew), risk: row.score >= 60 ? "High" : "Medium", why: row.reasons.join("; "), code: row.code, detail: `bills:${row.code}` })),
      note: `As on ${dmy(ctx.today)}. A customer scores for bills over 90 days (most), other overdue bills, being over its credit limit, a balance up 25% in 30 days and an oldest bill over 60 days late; 60 and above is High, 40 and above Medium (overdue bills alone do not reach it). Click a customer to show its open bills.`,
    };
  },
});

T.push({
  id: 124, question: "Which major customers have not paid despite repeated transactions?", defaultPeriod: "none",
  terms: [/customers?|clients?|parties/, /not paid|unpaid|no payments?|not made|without pay|haven'?t paid|not paying|never paid|not received/, /repeat|despite|again|continue|regular|transactions?|still|buying/],
  run: async (ctx) => {
    const days = ctx.days;
    const from = addDays(ctx.today, -days);
    const bought = await rows(ctx,
      `SELECT l.code, btrim(ac.name) AS name, COUNT(DISTINCT l.full_docno) AS entries, SUM(l.amount::numeric) AS amount, MAX(l.doc_date) AS last_sale FROM ${ctx.sch}.ledger l JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = ${SALE} AND l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.doc_date >= $1::date AND l.doc_date <= $2::date AND ac.book = 2 GROUP BY l.code, ac.name HAVING COUNT(DISTINCT l.full_docno) >= 3`, [from, ctx.today]);
    const paid = new Map((await rows(ctx, `SELECT code, SUM(amount::numeric) AS total, MAX(doc_date) AS last_receipt FROM ${ctx.sch}.ledger WHERE book IN (4, 6) AND ac_dbcode = 2 AND doc_pos = 'A' AND doc_date >= $1::date AND doc_date <= $2::date GROUP BY code`, [iso(ctx.session.tarikh1), ctx.today])).map((row) => [num(row.code), row] as const));
    const owing = new Map((await balances(ctx, 2, bought.map((row) => num(row.code)))).map((row) => [row.code, row.closing] as const));
    const list = bought.filter((row) => (owing.get(num(row.code)) ?? 0) > 0)
      .filter((row) => { const last = paid.get(num(row.code))?.last_receipt; return !last || new Date(String(last)).getTime() < new Date(`${from}T00:00:00`).getTime(); })
      .map((row) => ({ code: num(row.code), name: String(row.name), entries: num(row.entries), amount: num(row.amount), last: dmy(row.last_sale), receipt: paid.get(num(row.code))?.last_receipt ? dmy(paid.get(num(row.code))?.last_receipt) : "None this year", outstanding: owing.get(num(row.code)) ?? 0 }))
      .sort((a, b) => b.amount - a.amount);
    return {
      id: 124, title: `Customers who kept buying but paid nothing in ${days} days (${list.length})`, columns: [int("no", "No."), text("name", "Customer"), int("entries", "Sale Entries"), money("amount", `Sales in ${days} Days`), date("last", "Last Sale"), text("receipt", "Last Receipt"), money("outstanding", "Outstanding")],
      rows: list.slice(0, 200).map((row, at) => ({ no: at + 1, name: row.name, entries: row.entries, amount: row.amount, last: row.last, receipt: row.receipt, outstanding: row.outstanding, code: row.code, detail: `bills:${row.code}` })),
      note: `Customers with at least 3 sale entries in the last ${days} days (say another number of days in the question), no money received from them in those days and a balance still owing, biggest buyers first. Click a customer to show its open bills.`,
    };
  },
});

// --- 125, 126: collection

T.push({
  id: 125, question: "What is our average collection period?", defaultPeriod: "year",
  terms: [/average|avg|mean|typical/, /collection|recovery|receivable|debtors?|realis|realiz/, /period|days|time|take|long/], not: [/target|week|should/],
  run: async (ctx) => {
    const receivable = await receivableTotal(ctx);
    const span = spanDays(ctx.period.from, ctx.period.to);
    const sold = (await bookTotal(ctx, SALE, ctx.period.from, ctx.period.to)).total;
    const perDay = sold / span;
    const period = perDay === 0 ? 0 : receivable / perDay;
    const customers = (await balances(ctx, 2)).filter((row) => row.closing > 0);
    const allowed = sumOf(customers, (row) => row.creditDays * row.closing) / Math.max(1, sumOf(customers, (row) => row.closing));
    return {
      id: 125, title: "Average collection period",
      summary: `Customers take about ${period.toFixed(0)} days to pay (receivable over sales a day), against ${allowed.toFixed(0)} days of credit allowed on their accounts${period > allowed + 5 ? `: ${(period - allowed).toFixed(0)} days slower than agreed.` : "."}`,
      columns: [text("item", "Item"), money("value", "Value")],
      rows: asRows([{ item: "Customers owe (receivable)", value: receivable, detail: "owe:2" }, { item: "Days in the period", value: span }, { item: "Sales in the period (with tax)", value: sold }, { item: "Sales a day", value: perDay }, { item: "Average collection period (days)", value: round2(period) }, { item: "Average credit days allowed (weighted by balance)", value: round2(allowed) }]),
      note: `${ctx.period.label}. Days of sales outstanding: the receivable now divided by the Sale book's sales (with tax) a day. Credit days are those set on each customer's account.`,
    };
  },
});

T.push({
  id: 126, question: "How much collection should we target this week to meet our cash requirements?", defaultPeriod: "none",
  terms: [/collection|collect|recover|receive|realise|realize/, /target|should|need|require|goal|aim/, /week|cash|requirements?|needs?/], not: [/expected|predict|average|period/],
  run: async (ctx) => {
    const cash = await cashPosition(ctx);
    const supplierDue = dueBetween(await agewiseBills(ctx, 3), addDays(ctx.today, 7));
    const weekly = ((await expenseTotal(ctx, iso(ctx.session.tarikh1), ctx.today)) / spanDays(iso(ctx.session.tarikh1), ctx.today)) * 7;
    const need = supplierDue + weekly;
    const target = Math.max(0, need - cash.total);
    const bills = (await agewiseBills(ctx)).filter((bill) => bill.dueIso <= addDays(ctx.today, 7));
    const byParty = new Map<number, { code: number; name: string; pending: number; days: number }>();
    for (const bill of bills) { const entry = byParty.get(bill.code) ?? byParty.set(bill.code, { code: bill.code, name: bill.name, pending: 0, days: 0 }).get(bill.code)!; entry.pending += bill.pending; entry.days = Math.max(entry.days, bill.overdueDays); }
    const chase = [...byParty.values()].sort((a, b) => b.pending - a.pending).slice(0, 10);
    const available = sumOf(bills, (bill) => bill.pending);
    return {
      id: 126, title: "Collection to target this week",
      summary: target === 0 ? `No collection is needed to meet this week's needs: cash of ${grouping.format(cash.total)} covers the ${grouping.format(need)} required.` : `Target a collection of about ${grouping.format(target)} this week: ${grouping.format(need)} is needed for supplier bills and expenses against ${grouping.format(cash.total)} of cash. ${available >= target ? `Bills due or overdue from customers come to ${grouping.format(available)}, so it is within reach.` : `Bills due or overdue from customers come to only ${grouping.format(available)}.`}`,
      columns: [text("item", "Item"), money("value", "Amount"), int("days", "Days Overdue")],
      rows: [{ item: "Supplier bills due by next week (including those already due)", value: supplierDue, days: "" }, { item: "Add: a week's average expenses", value: weekly, days: "" }, { item: "Cash needed this week", value: need, days: "" }, { item: "Less: cash in hand and at the banks", value: -cash.total, days: "" }, { item: "Collection to target this week", value: target, days: "" },
        { item: "Customer bills due or overdue (what can be collected)", value: available, days: "" }, { item: "Collect first from:", value: "", days: "" }, ...chase.map((row) => ({ item: `  ${row.name}`, value: round2(row.pending), days: row.days, code: row.code, detail: `bills:${row.code}` }))],
      note: `As on ${dmy(ctx.today)}. The cash needed is the supplier bills due within 7 days plus a week of the year's average expenses (Expense book); customers are listed by the amount due or overdue.`,
    };
  },
});

// --- 127 to 130: suppliers

/** Each product's purchases by supplier (name) in the dates: quantity and value, from the Purchase book's stock lines. */
async function supplierPurchases(ctx: Ctx, from: string, to: string, product?: number) {
  const found = await rows(ctx,
    `SELECT pl.prod_id, btrim(pm.prod_desc) AS product, lower(btrim(ac.name)) AS key, btrim(ac.name) AS supplier, to_char(l.doc_date, 'YYYY-MM') AS month, SUM(pl.il_value::numeric) AS value, SUM(pl.quantity::numeric) AS qty`
    + ` FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id JOIN ${ctx.sch}.account ac ON ac.code = l.code`
    + ` WHERE pl.book = ${PURCHASE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND pl.quantity::numeric > 0 AND l.doc_date >= $1::date AND l.doc_date <= $2::date${product ? " AND pl.prod_id = $3" : ""} GROUP BY pl.prod_id, pm.prod_desc, ac.name, to_char(l.doc_date, 'YYYY-MM')`,
    product ? [from, to, product] : [from, to]);
  return found.map((row) => ({ prod: num(row.prod_id), product: String(row.product), key: String(row.key), supplier: String(row.supplier), month: String(row.month), value: num(row.value), qty: num(row.qty) }));
}

T.push({
  id: 127, question: "Which suppliers offer the best prices for comparable products?", defaultPeriod: "year",
  terms: [/suppliers?|vendors?/, /best|lowest|cheapest|cheap|better|competitive|offer/, /prices?|rates?|cost/, /products?|items?|comparable|same|goods/], not: [/compar.*(?:six|6)|last (?:six|6)|months/],
  run: async (ctx) => {
    const bought = await supplierPurchases(ctx, ctx.period.from, ctx.period.to);
    const byProduct = new Map<number, { product: string; suppliers: Map<string, { supplier: string; value: number; qty: number }> }>();
    for (const row of bought) {
      const entry = byProduct.get(row.prod) ?? byProduct.set(row.prod, { product: row.product, suppliers: new Map() }).get(row.prod)!;
      const supplier = entry.suppliers.get(row.key) ?? entry.suppliers.set(row.key, { supplier: row.supplier, value: 0, qty: 0 }).get(row.key)!;
      supplier.value += row.value; supplier.qty += row.qty;
    }
    const list = [...byProduct.values()].filter((entry) => entry.suppliers.size >= 2).map((entry) => {
      const rated = [...entry.suppliers.values()].filter((supplier) => supplier.qty > 0).map((supplier) => ({ ...supplier, rate: supplier.value / supplier.qty })).sort((a, b) => a.rate - b.rate);
      const best = rated[0]; const dearest = rated[rated.length - 1];
      const saving = sumOf(rated, (supplier) => supplier.qty * (supplier.rate - best.rate));
      return { product: entry.product, best: best.supplier, bestRate: best.rate, dearest: dearest.supplier, dearestRate: dearest.rate, gap: pctOf(dearest.rate - best.rate, best.rate), suppliers: rated.length, saving };
    }).filter((row) => row.saving > 0).sort((a, b) => b.saving - a.saving);
    return {
      id: 127, title: `Best supplier price for products bought from more than one supplier (${list.length})`, columns: [int("no", "No."), text("product", "Product"), int("suppliers", "Suppliers"), text("best", "Cheapest Supplier"), money("bestRate", "Its Rate"), text("dearest", "Dearest Supplier"), money("dearestRate", "Its Rate"), money("gap", "Gap %"), money("saving", "Possible Saving")],
      rows: list.slice(0, 200).map((row, at) => ({ no: at + 1, ...row })),
      note: `${ctx.period.label}. Rates are the value over the quantity bought from each supplier (before tax). Possible saving is what the quantity bought from the dearer suppliers would have cost less at the cheapest supplier's rate. Prices are compared for the same product only; units and quality are as the stock entry has them.`,
    };
  },
});

/** The purchase order lines still to be received (the order module ORD-IN of the Purchase book), with the date they are scheduled for where the entry addon has it. */
async function pendingPurchaseOrders(ctx: Ctx) {
  const scheduled = await hasColumn(ctx, "addon_ientry", "input_sch_date");
  const found = await rows(ctx,
    `SELECT pl.full_docno AS doc, pl.il_date AS d, pl.code, btrim(COALESCE(ac.name, '')) AS supplier, btrim(pm.prod_desc) AS product, pl.quantity::numeric AS qty, (pl.ag_qty::numeric + COALESCE(pl.setof_qty::numeric, 0)) AS got, pl.rate::numeric AS rate,`
    + ` ${scheduled ? "ient.input_sch_date" : "NULL::date"} AS scheduled FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.process proce ON proce.process_key = pl.process_id AND proce.il_pos = 'A' LEFT JOIN ${ctx.sch}.account ac ON ac.code = pl.code`
    + ` JOIN ${ctx.sch}.product_master pm ON pm.prod_key = pl.prod_id${scheduled ? ` LEFT JOIN ${ctx.sch}.addon_ientry ient ON ient.aoni_il_id = pl.il_key` : ""}`
    + ` WHERE pl.il_pos = 'A' AND pl.book = ${PURCHASE} AND btrim(pl.trn_module) = 'ORD-IN' AND pl.quantity::numeric - (pl.ag_qty::numeric + COALESCE(pl.setof_qty::numeric, 0)) > 0 AND pl.il_date <= $1::date ORDER BY COALESCE(${scheduled ? "ient.input_sch_date" : "NULL::date"}, pl.il_date), pl.il_key`, [ctx.today]);
  const today = new Date(`${ctx.today}T00:00:00`).getTime();
  return { scheduled, list: found.map((row) => {
    const due = row.scheduled ? new Date(String(row.scheduled)) : null;
    const pending = num(row.qty) - num(row.got);
    return { doc: String(row.doc ?? ""), ordered: dmy(row.d), code: num(row.code), supplier: String(row.supplier), product: String(row.product), qty: num(row.qty), got: num(row.got), pending, rate: num(row.rate), value: pending * num(row.rate), due: due ? dmy(due) : "", late: due ? Math.max(0, Math.round((today - due.getTime()) / 86400000)) : 0 };
  }) };
}

T.push({
  id: 128, question: "Which suppliers have frequent delivery delays, if delivery data is available?", defaultPeriod: "none",
  terms: [/suppliers?|vendors?/, /delay|late|delayed|slow|overdue|on time|punctual/, /deliver|delivery|supply|supplies|orders?|receiv/],
  run: async (ctx) => {
    const { scheduled, list } = await pendingPurchaseOrders(ctx);
    const columns = [int("no", "No."), text("supplier", "Supplier"), int("lines", "Pending Order Lines"), int("late", "Past Scheduled Date"), money("average", "Average Days Late"), int("most", "Most Days Late"), money("value", "Pending Value")];
    if (!scheduled) return { id: 128, title: "Supplier delivery delays", columns, rows: [], note: "This company's purchase orders carry no scheduled delivery date (the order entry has no such field), and the books record no delivery against an order, so delays cannot be measured. The pending purchase orders can be seen with \"Which purchase orders are pending delivery?\"." };
    const bySupplier = new Map<string, { code: number; supplier: string; lines: number; late: number; days: number; most: number; value: number }>();
    for (const row of list) {
      const entry = bySupplier.get(row.supplier) ?? bySupplier.set(row.supplier, { code: row.code, supplier: row.supplier, lines: 0, late: 0, days: 0, most: 0, value: 0 }).get(row.supplier)!;
      entry.lines += 1; entry.value += row.value;
      if (row.late > 0) { entry.late += 1; entry.days += row.late; entry.most = Math.max(entry.most, row.late); }
    }
    const out = [...bySupplier.values()].filter((entry) => entry.late > 0).sort((a, b) => b.late - a.late || b.days - a.days);
    return {
      id: 128, title: `Suppliers with orders past their scheduled date (${out.length})`, columns,
      rows: out.map((entry, at) => ({ no: at + 1, supplier: entry.supplier, lines: entry.lines, late: entry.late, average: round2(entry.days / entry.late), most: entry.most, value: round2(entry.value), code: entry.code })),
      note: `As on ${dmy(ctx.today)}. Delivery is measured from the purchase orders still pending: a line is late when its scheduled date has passed and it has not been received in full. Orders already received are not kept with a receipt date, so past delays cannot be counted.`,
    };
  },
});

T.push({
  id: 129, question: "Which purchase orders are pending delivery?", defaultPeriod: "none",
  terms: [/purchase orders?|\bpos?\b|orders?/, /pending|outstanding|not (?:yet )?(?:received|delivered)|awaiting|open|undelivered/, /deliver|received|supply|supplied|pending/],
  not: [/sales? orders?|production|customers?/],
  run: async (ctx) => {
    const { list } = await pendingPurchaseOrders(ctx);
    const shown = list.slice(0, 500).map((row) => ({ ordered: row.ordered, doc: row.doc, supplier: row.supplier, product: row.product, qty: row.qty, got: row.got, pending: row.pending, value: round2(row.value), due: row.due, late: row.late || "", code: row.code }));
    return {
      id: 129, title: `Purchase orders pending delivery (${list.length} lines)`, columns: [date("ordered", "Order Date"), text("doc", "Order"), text("supplier", "Supplier"), text("product", "Product"), qty("qty", "Ordered"), qty("got", "Received"), qty("pending", "Pending"), money("value", "Pending Value"), date("due", "Scheduled"), int("late", "Days Late")],
      rows: list.length === 0 ? [] : [...shown, { ordered: "", doc: "", supplier: "Total", product: "", qty: "", got: "", pending: "", value: round2(sumOf(list, (row) => row.value)), due: "", late: "" }],
      note: `As on ${dmy(ctx.today)}. Order lines of the Purchase book whose received quantity is less than the ordered one; the value is the pending quantity at the order rate.${list.length > 500 ? " The first 500 are shown." : ""}`,
    };
  },
});

T.push({
  id: 130, question: "Compare supplier prices for the same product over the last six months.", defaultPeriod: "none", needsProduct: true,
  terms: [/compar|against|versus|\bvs\b|difference|trend|wise/, /suppliers?|vendors?/, /prices?|rates?|cost/, /months?|six|6/],
  run: async (ctx) => {
    const product = ctx.product as Party;
    const today = new Date(`${ctx.today}T00:00:00`);
    const months = Array.from({ length: 6 }, (_unused, at) => new Date(today.getFullYear(), today.getMonth() - 5 + at, 1));
    const from = iso(months[0]);
    const lastYear = months[0] < ctx.session.tarikh1 ? await previousYearSchema(ctx, ctx.session.tarikh1) : null;
    const bought = [...(lastYear ? await supplierPurchases({ ...ctx, sch: lastYear }, from, iso(new Date(ctx.session.tarikh1.getFullYear(), ctx.session.tarikh1.getMonth(), ctx.session.tarikh1.getDate() - 1)), product.code) : []),
      ...await supplierPurchases(ctx, from < iso(ctx.session.tarikh1) ? iso(ctx.session.tarikh1) : from, ctx.today, product.code)];
    const keys = months.map((month) => `${month.getFullYear()}-${pad(month.getMonth() + 1)}`);
    const suppliers = new Map<string, { supplier: string; cells: Map<string, { value: number; qty: number }> }>();
    for (const row of bought) {
      const entry = suppliers.get(row.key) ?? suppliers.set(row.key, { supplier: row.supplier, cells: new Map() }).get(row.key)!;
      const cell = entry.cells.get(row.month) ?? entry.cells.set(row.month, { value: 0, qty: 0 }).get(row.month)!;
      cell.value += row.value; cell.qty += row.qty;
    }
    const out = [...suppliers.values()].map((entry) => {
      const cells = Object.fromEntries(keys.map((key, at) => { const cell = entry.cells.get(key); return [`m${at}`, cell && cell.qty > 0 ? cell.value / cell.qty : ""] as const; }));
      const value = sumOf([...entry.cells.values()], (cell) => cell.value); const quantity = sumOf([...entry.cells.values()], (cell) => cell.qty);
      return { supplier: entry.supplier, ...cells, average: quantity > 0 ? value / quantity : 0, qty: quantity };
    }).filter((row) => row.qty > 0).sort((a, b) => a.average - b.average);
    return {
      id: 130, title: `Supplier rates for ${product.name}, last six months`, columns: [text("supplier", "Supplier"), ...months.map((month, at) => money(`m${at}`, monthLabel(month))), money("average", "Average Rate"), qty("qty", "Quantity Bought")],
      rows: out, ...(out.length > 1 ? { summary: `${out[0].supplier} has been the cheapest at an average of ${grouping.format(out[0].average)}; ${out[out.length - 1].supplier} the dearest at ${grouping.format(out[out.length - 1].average)} (${pctOf(out[out.length - 1].average - out[0].average, out[0].average).toFixed(1)}% more).` } : {}),
      note: `Purchase rates (value before tax over quantity) of each supplier for each month from ${dmy(from)}; a blank month means nothing was bought from that supplier then. Cheapest average first.${out.length === 0 ? " Nothing was bought of this product in these six months." : ""}${lastYear ? " Months before this year's start are read from last year's database." : ""}`,
    };
  },
});

// --- 131, 132: stock held and stock that does not sell

T.push({
  id: 131, question: "How many days of stock do we currently hold?", defaultPeriod: "none",
  terms: [/how many|days?|number of days|cover/, /stock|inventory/, /hold|have|held|currently|cover|last|worth|lasts?/], not: [/no sales|not sold|without|negative|zero|valuation|godown|minimum|below/],
  run: async (ctx) => {
    const window = 90;
    // The 90 days up to the last sale (today, unless nothing has been sold lately).
    const lastSale = (await rows(ctx, `SELECT to_char(MAX(doc_date), 'YYYY-MM-DD') AS d FROM ${ctx.sch}.ledger WHERE book = ${SALE} AND doc_pos = 'A' AND doc_date <= $1::date`, [ctx.today]))[0]?.d;
    const end = typeof lastSale === "string" && lastSale < ctx.today ? lastSale : ctx.today;
    const from = addDays(end, -window + 1);
    const stock = await stockValue(ctx, 0, "", true);
    const valued = stock.rows.slice(0, -1);
    const total = num(stock.rows[stock.rows.length - 1]?.value);
    const sold = new Map((await rows(ctx,
      `SELECT pl.prod_id, SUM(CASE WHEN pl.book = ${SALE} THEN pl.quantity::numeric ELSE -pl.quantity::numeric END) AS qty FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book IN (${SALE}, ${CREDIT_NOTE}) AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY pl.prod_id`, [from, end])).map((row) => [num(row.prod_id), num(row.qty)] as const));
    const costOfSales = sumOf(await productProfits({ ...ctx, period: { ...ctx.period, from, to: end } }), (row) => (row.qty > 0 ? row.cost : 0));
    const perDay = costOfSales / window;
    const days = perDay === 0 ? 0 : total / perDay;
    const products = valued.map((row) => { const perDayQty = Math.max(0, sold.get(num(row.pk)) ?? 0) / window; return { name: String(row.name), cq: num(row.cq), value: num(row.value), perDay: perDayQty, days: perDayQty > 0 ? num(row.cq) / perDayQty : "", pk: num(row.pk) }; });
    return {
      id: 131, title: "Days of stock held",
      summary: perDay === 0 ? "Nothing was sold in the last 90 days, so the days of stock cannot be worked out." : `The stock of ${grouping.format(total)} would last about ${days.toFixed(0)} days at the pace of the ${window} days up to ${dmy(end)} (${grouping.format(perDay)} of cost sold a day).${end < ctx.today ? ` Nothing has been sold since ${dmy(end)}.` : ""}`,
      columns: [text("item", "Item"), qty("cq", "Stock"), money("value", "Stock Value"), qty("perDay", "Sold a Day"), money("days", "Days of Stock")],
      rows: [{ item: "All stock", cq: "", value: total, perDay: "", days: perDay === 0 ? "" : round2(days) }, { item: `Cost of goods sold in the ${window} days up to ${dmy(end)}`, cq: "", value: costOfSales, perDay: "", days: "" }, { item: "Largest stocks, product by product:", cq: "", value: "", perDay: "", days: "" },
        ...products.slice(0, 30).map((row) => ({ item: `  ${row.name}`, cq: row.cq, value: row.value, perDay: round2(row.perDay), days: typeof row.days === "number" ? round2(row.days) : "", detail: `prod:${row.pk}` }))],
      note: `As on ${dmy(ctx.today)}. Stock at average cost over the cost of what was sold in the ${window} days up to the last sale (${dmy(end)}) a day; per product, its quantity over the quantity sold a day (blank where none was sold). ${stock.note ?? ""}`,
    };
  },
});

T.push({
  id: 132, question: "Which products have not sold in the last 6 months?", defaultPeriod: "none",
  terms: [/products?|items?|stock|goods/, /not sold|no sales?|unsold|not been sold|without sales?|haven'?t sold|not selling|dead|non[- ]?moving/, /months?|six|6/],
  run: async (ctx) => {
    const months = numberAfter(ctx.question ?? "", /(\d+)\s*months?/) ?? 6;
    const today = new Date(`${ctx.today}T00:00:00`);
    const since = iso(new Date(today.getFullYear(), today.getMonth() - months, today.getDate()));
    const found = await rows(ctx,
      `WITH ${STOCK_CTE(ctx.sch, "$3")}, ${COST_CTES(ctx.sch, "$4", "$2", "$3")}, sold AS (SELECT pl.prod_id, MAX(l.doc_date) AS last_sale FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book = ${SALE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date <= $2::date GROUP BY pl.prod_id)`
      + ` SELECT btrim(pm.prod_desc) AS name, stk.cq, avgc.cost, stk.cq * avgc.cost AS value, sold.last_sale FROM stk JOIN ${ctx.sch}.product_master pm ON pm.prod_key = stk.prod_id LEFT JOIN sold ON sold.prod_id = stk.prod_id LEFT JOIN avgc ON avgc.prod_id = stk.prod_id`
      + ` WHERE pm.prod_pos <> 'D' AND stk.cq > 0 AND (sold.last_sale IS NULL OR sold.last_sale < $1::date) ORDER BY stk.cq * COALESCE(avgc.cost, 0) DESC, stk.cq DESC LIMIT 500`, [since, ctx.today, ctx.session.yearId, iso(ctx.session.tarikh1)]);
    const out = found.map((row) => ({ name: String(row.name), cq: num(row.cq), cost: num(row.cost), value: num(row.value), last: row.last_sale ? dmy(row.last_sale) : "Not this year" }));
    return {
      id: 132, title: `Products with stock and no sale in ${months} months (${out.length})`, columns: [int("no", "No."), text("name", "Product"), qty("cq", "Stock"), money("cost", "Average Cost"), money("value", "Stock Value"), text("last", "Last Sale")],
      rows: out.length === 0 ? [] : [...out.map((row, at) => ({ no: at + 1, ...row })), { no: "", name: "Total tied up", cq: "", cost: "", value: sumOf(out, (row) => row.value), last: "" }],
      note: `Products with stock on hand and no sale since ${dmy(since)} (say another number of months in the question), the most money tied up first. The first 500 are shown. Stock at average cost.`,
    };
  },
});

// --- 133 to 137: expenses and overheads

/** The expense accounts' totals by name for the dates of a database. */
async function expensesByName(ctx: Ctx, sch: string, from: string, to: string) {
  const found = await rows(ctx, `SELECT btrim(ac.name) AS name, MAX(ac.code) AS code, SUM(l.amount::numeric) AS amount FROM ${sch}.ledger l JOIN ${sch}.account ac ON ac.code = l.code WHERE l.book = 15 AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY btrim(ac.name)`, [from, to]);
  return new Map(found.map((row) => [String(row.name).toLowerCase(), { name: String(row.name), code: num(row.code), amount: num(row.amount) }] as const));
}

/** This year's expenses so far against the same days of last year (from its own database), by expense account. */
async function expenseYears(ctx: Ctx) {
  const from = iso(ctx.session.tarikh1);
  const back = (day: string) => { const at = new Date(`${day}T00:00:00`); return iso(new Date(at.getFullYear() - 1, at.getMonth(), at.getDate())); };
  const lastSchema = await previousYearSchema(ctx, ctx.session.tarikh1);
  const now = await expensesByName(ctx, ctx.sch, from, ctx.today);
  const before = lastSchema ? await expensesByName(ctx, lastSchema, back(from), back(ctx.today)) : new Map<string, { name: string; code: number; amount: number }>();
  const list = [...new Set([...now.keys(), ...before.keys()])].map((key) => {
    const current = now.get(key)?.amount ?? 0; const last = before.get(key)?.amount ?? 0;
    return { name: now.get(key)?.name ?? before.get(key)?.name ?? "", code: now.get(key)?.code ?? 0, current, last, change: current - last, pct: last === 0 ? (current === 0 ? 0 : 100) : ((current - last) / last) * 100 };
  });
  return { list, lastSchema, from, back };
}

T.push({
  id: 133, question: "Which expenses are higher than the previous financial year?", defaultPeriod: "none",
  terms: [/expenses?|expenditure|costs?|overheads?/, /previous|last|prior|earlier/, /year|financial|fy/, /higher|more|increase|greater|above|rose|up\b/], not: [/month/],
  run: async (ctx) => {
    const { list, lastSchema, from, back } = await expenseYears(ctx);
    const up = list.filter((row) => row.change > 0).sort((a, b) => b.change - a.change);
    return {
      id: 133, title: `Expenses higher than the same days of last year (${up.length})`, columns: [int("no", "No."), text("name", "Expense"), money("last", "Last Year"), money("current", "This Year"), money("change", "Increase"), money("pct", "Increase %")],
      rows: up.length === 0 ? [] : [...up.slice(0, 300).map((row, at) => ({ no: at + 1, name: row.name, last: row.last, current: row.current, change: row.change, pct: row.pct, code: row.code })), { no: "", name: "Total of these", last: sumOf(up, (row) => row.last), current: sumOf(up, (row) => row.current), change: sumOf(up, (row) => row.change), pct: pctOf(sumOf(up, (row) => row.change), sumOf(up, (row) => row.last)) }],
      note: `${dmy(from)} to ${dmy(ctx.today)} against ${dmy(back(from))} to ${dmy(back(ctx.today))}. ${lastSchema ? "Last year is read from its own database." : "Last year's database was not found on this server, so every expense shows as new."} An expense that is new this year shows 100%. Expense book, with tax.`,
    };
  },
});

const EXPENSE_GROUPS: readonly { label: string; pattern: RegExp }[] = [
  { label: "Salaries and wages", pattern: /salar|wage|staff|bonus|payroll|labou?r|\bpf\b|\besi\b|provident|gratuity|incentive|commission|allowance/i },
  { label: "Rent", pattern: /\brent|lease/i },
  { label: "Administration", pattern: /admin|office|telephone|phone|mobile|internet|printing|stationer|postage|courier|electric|power|water|travel|conveyance|insurance|repair|maintenance|legal|audit|professional|consult|bank charge|misc|general|subscription|software|security|cleaning|canteen|tea|entertain|petrol|vehicle|fuel/i },
];

T.push({
  id: 134, question: "What percentage of turnover is spent on salaries, rent and administration?", defaultPeriod: "year",
  terms: [/percent|%|share|proportion|ratio|how much/, /turnover|sales|revenue/, /salar|rent|admin|overheads?|wages/, /spent|spend|expense|cost|spending/],
  run: async (ctx) => {
    const turnover = (await netSales(ctx, ctx.period.from, ctx.period.to, false))[0].net;
    const expenses = [...(await expensesByName(ctx, ctx.sch, ctx.period.from, ctx.period.to)).values()];
    const groups = [...EXPENSE_GROUPS.map((group) => ({ label: group.label, pattern: group.pattern as RegExp | null })), { label: "Other expenses", pattern: null }];
    const placed = new Map<string, typeof expenses>(groups.map((group) => [group.label, []]));
    for (const expense of expenses) placed.get((EXPENSE_GROUPS.find((group) => group.pattern.test(expense.name)) ?? { label: "Other expenses" }).label)!.push(expense);
    const out: Record<string, string | number>[] = [];
    for (const group of groups) {
      const list = (placed.get(group.label) ?? []).sort((a, b) => b.amount - a.amount);
      const total = sumOf(list, (row) => row.amount);
      out.push({ item: group.label, amount: total, share: pctOf(total, turnover) });
      for (const row of list.slice(0, 5)) out.push({ item: `  ${row.name}`, amount: row.amount, share: pctOf(row.amount, turnover), code: row.code });
    }
    const all = sumOf(expenses, (row) => row.amount);
    const named = EXPENSE_GROUPS.map((group) => sumOf(placed.get(group.label) ?? [], (row) => row.amount));
    return {
      id: 134, title: "Salaries, rent and administration against turnover", columns: [text("item", "Expense"), money("amount", "Amount"), money("share", "% of Turnover")],
      summary: `Salaries, rent and administration take ${pctOf(sumOf(named, (value) => value), turnover).toFixed(1)}% of turnover (salaries ${pctOf(named[0], turnover).toFixed(1)}%, rent ${pctOf(named[1], turnover).toFixed(1)}%, administration ${pctOf(named[2], turnover).toFixed(1)}%); all expenses ${pctOf(all, turnover).toFixed(1)}%.`,
      rows: [{ item: "Turnover (net sales before tax)", amount: turnover, share: 100 }, ...out, { item: "All expenses", amount: all, share: pctOf(all, turnover) }],
      note: `${ctx.period.label}. Expense accounts (Expense book, with tax) are put under a heading by words in their names (salary, wage ... rent, lease ... office, telephone, electricity, travel, insurance, repair ...); anything else is under Other expenses. The five largest accounts of each heading are shown. ${SALES_NOTE}`,
    };
  },
});

T.push({
  id: 135, question: "Where can we reduce costs without affecting sales?", defaultPeriod: "none",
  terms: [/reduc|cut|save|saving|lower|trim|control|curb/, /costs?|expenses?|spending|expenditure/, /without|where|affect|impact|can we/], not: [/material|raw|production|manufactur/],
  run: async (ctx) => {
    const { list, lastSchema } = await expenseYears(ctx);
    const essential = /salar|wage|\brent|lease|interest|tax|gst|tds|insurance|loan|depreciation|freight|carriage|packing|commission|discount|bank charge/i;
    const total = sumOf(list, (row) => row.current);
    const out = list.filter((row) => row.current > 0).map((row) => {
      const fixed = essential.test(row.name);
      const grew = lastSchema ? Math.max(0, row.change) : 0;
      const saving = fixed ? 0 : Math.max(grew, row.current * 0.1);
      return { name: row.name, code: row.code, kind: fixed ? "Needed to run or sell" : "Can be controlled", current: row.current, last: row.last, pct: row.pct, share: pctOf(row.current, total), saving };
    }).filter((row) => row.saving > 0).sort((a, b) => b.saving - a.saving);
    return {
      id: 135, title: "Where costs can be reduced", summary: `Expenses that can be controlled without touching the selling effort could save about ${grouping.format(sumOf(out.slice(0, 10), (row) => row.saving))} (the ten biggest below).`,
      columns: [int("no", "No."), text("name", "Expense"), text("kind", "Type"), money("last", "Last Year"), money("current", "This Year"), money("pct", "Change %"), money("share", "Share of Expenses %"), money("saving", "Possible Saving")],
      rows: out.slice(0, 40).map((row, at) => ({ no: at + 1, ...row })),
      note: `This year's expenses so far against the same days of last year. Salaries, rent, interest, taxes, insurance, loan costs, freight, packing, commission, discounts and bank charges are treated as needed to run or sell and are left out. For the others the possible saving is the larger of what they grew over last year and 10% of this year's amount. A guide to where to look, not a decision: check each head.${lastSchema ? "" : " Last year's database was not found, so only the 10% is used."}`,
    };
  },
});

T.push({
  id: 136, question: "Are overheads increasing faster than revenue?", defaultPeriod: "none",
  terms: [/overheads?|expenses?|costs?|expenditure/, /faster|more than|quicker|outpac|growing|rate|increasing|rising|compared/, /revenue|sales|turnover|income/],
  run: async (ctx) => {
    const { list, lastSchema, from, back } = await expenseYears(ctx);
    const current = (await netSales(ctx, from, ctx.today, false))[0].net;
    const last = lastSchema ? (await netSales({ ...ctx, sch: lastSchema }, back(from), back(ctx.today), false))[0].net : 0;
    const expensesNow = sumOf(list, (row) => row.current); const expensesLast = sumOf(list, (row) => row.last);
    const salesGrowth = pctOf(current - last, last); const expenseGrowth = pctOf(expensesNow - expensesLast, expensesLast);
    const line = (item: string, before: number, now: number) => ({ item, last: before, current: now, change: now - before, pct: pctOf(now - before, before) });
    return {
      id: 136, title: "Overheads and revenue against last year",
      ...(lastSchema && last > 0 && expensesLast > 0 ? { summary: expenseGrowth > salesGrowth ? `Yes: expenses grew ${expenseGrowth.toFixed(1)}% while net sales grew ${salesGrowth.toFixed(1)}%, so overheads now take ${pctOf(expensesNow, current).toFixed(1)}% of sales against ${pctOf(expensesLast, last).toFixed(1)}% last year.` : `No: expenses grew ${expenseGrowth.toFixed(1)}% against ${salesGrowth.toFixed(1)}% for net sales; overheads take ${pctOf(expensesNow, current).toFixed(1)}% of sales against ${pctOf(expensesLast, last).toFixed(1)}% last year.` } : {}),
      columns: [text("item", "Item"), money("last", "Last Year"), money("current", "This Year"), money("change", "Change"), money("pct", "Change %")],
      rows: [line("Net sales (before tax)", last, current), line("Expenses (with tax)", expensesLast, expensesNow), { item: "Expenses as % of net sales", last: pctOf(expensesLast, last), current: pctOf(expensesNow, current), change: pctOf(expensesNow, current) - pctOf(expensesLast, last), pct: "" }],
      note: `${dmy(from)} to ${dmy(ctx.today)} against ${dmy(back(from))} to ${dmy(back(ctx.today))}. ${lastSchema ? "Last year is read from its own database." : "Last year's database was not found on this server, so no comparison can be made."} ${SALES_NOTE}`,
    };
  },
});

T.push({
  id: 137, question: "Show the top 10 expense categories by amount.", defaultPeriod: "year",
  terms: [/expenses?|expenditure|spending|costs?/, /top|biggest|largest|highest|categories|category|major/, /amount|categories|category|heads?|accounts?|by/], not: [/increase|compar|last month|salary|current month/],
  run: async (ctx) => {
    const all = [...(await expensesByName(ctx, ctx.sch, ctx.period.from, ctx.period.to)).values()].sort((a, b) => b.amount - a.amount);
    const total = sumOf(all, (row) => row.amount);
    let running = 0;
    const top = all.slice(0, ctx.top).map((row, at) => { running += row.amount; return { no: at + 1, name: row.name, amount: row.amount, share: pctOf(row.amount, total), cumulative: pctOf(running, total), code: row.code }; });
    return {
      id: 137, title: `Top ${top.length} expense categories`, columns: [int("no", "No."), text("name", "Expense"), money("amount", "Amount"), money("share", "Share %"), money("cumulative", "Cumulative %")],
      rows: top.length === 0 ? [] : [...top, { no: "", name: "All expenses", amount: total, share: 100, cumulative: "" }],
      note: `${ctx.period.label}. Expense accounts of the Expense book, with tax; ${all.length} accounts had entries. Click or double-click a row to open its ledger.`,
    };
  },
});

// --- 138, 149: which products to push

T.push({
  id: 138, question: "Which products should we focus on to achieve our profit target?", defaultPeriod: "year",
  terms: [/products?|items?/, /focus|prioriti[sz]e|push|promote|concentrate|emphasi[sz]e/, /profit/, /target|goal|achieve|reach|meet/],
  run: async (ctx) => {
    const target = amountIn(ctx.question ?? "");
    const list = (await productProfits(ctx)).filter((row) => row.profit > 0).sort((a, b) => b.profit - a.profit);
    const profit = sumOf(list, (row) => row.profit);
    let running = 0; let needed = 0;
    const out = list.slice(0, 50).map((row, at) => { running += row.profit; if (target !== null && needed === 0 && running >= target) needed = at + 1; return { no: at + 1, name: row.name, qty: row.qty, value: row.value, profit: row.profit, margin: row.margin, share: pctOf(row.profit, profit), cumulative: running }; });
    return {
      id: 138, title: "Products that earn the profit", columns: [int("no", "No."), text("name", "Product"), qty("qty", "Quantity"), money("value", "Net Sales"), money("profit", "Profit"), money("margin", "Margin %"), money("share", "Share of Profit %"), money("cumulative", "Cumulative Profit")],
      summary: target === null ? `Profit so far is ${grouping.format(profit)}, ${pctOf(sumOf(list.slice(0, 10), (row) => row.profit), profit).toFixed(0)}% of it from the ten products below. Say a target in the question (for example: ... to achieve a profit target of 20 lakh) to see how many products reach it.` : needed > 0 ? `The top ${needed} products already earn ${grouping.format(out[needed - 1].cumulative)}, which meets the target of ${grouping.format(target)}; keep these in stock and push them.` : `All profitable products together earn ${grouping.format(profit)}, ${grouping.format(target - profit)} short of the target of ${grouping.format(target)}: sales of the high-margin products need to grow, not just be kept.`,
      rows: out, note: `${ctx.period.label}. Products with a profit, best first. ${PROFIT_NOTE}`,
    };
  },
});

T.push({
  id: 149, question: "Which products should we prioritize based on margin and demand?", defaultPeriod: "year",
  terms: [/products?|items?/, /prioriti[sz]e|focus|push|promote|concentrate|rank/, /margin|profit/, /demand|selling|volume|sales|movement/], not: [/target|achieve|goal/],
  run: async (ctx) => {
    const list = (await productProfits(ctx)).filter((row) => row.qty > 0 && row.value > 0);
    const rank = (key: "margin" | "qty") => { const sorted = [...list].sort((a, b) => a[key] - b[key]); return new Map(sorted.map((row, at) => [row.prod, sorted.length <= 1 ? 1 : at / (sorted.length - 1)] as const)); };
    const margins = rank("margin"); const demands = rank("qty");
    const out = list.map((row) => {
      const high = (margins.get(row.prod) ?? 0) >= 0.5; const busy = (demands.get(row.prod) ?? 0) >= 0.5;
      return { ...row, score: ((margins.get(row.prod) ?? 0) + (demands.get(row.prod) ?? 0)) * 50, action: high && busy ? "Push: high margin, high demand" : high ? "Grow demand: good margin, low sales" : busy ? "Raise price or cut cost: busy, thin margin" : "Review: low margin and low demand" };
    }).sort((a, b) => b.score - a.score).slice(0, 100);
    return {
      id: 149, title: "Products to prioritise by margin and demand", columns: [int("no", "No."), text("name", "Product"), qty("qty", "Quantity Sold"), money("value", "Net Sales"), money("margin", "Margin %"), money("profit", "Profit"), money("score", "Score"), text("action", "What to do")],
      rows: out.map((row, at) => ({ no: at + 1, name: row.name, qty: row.qty, value: row.value, margin: row.margin, profit: row.profit, score: round2(row.score), action: row.action })),
      note: `${ctx.period.label}. The score ranks each product by margin % and by quantity sold (each from 0 to 50, so 100 is the best of both); the half above the middle on a measure counts as high. ${PROFIT_NOTE}`,
    };
  },
});

// --- 139, 140: unusual entries

T.push({
  id: 139, question: "Which transactions are unusually large compared with normal activity?", defaultPeriod: "year",
  terms: [/transactions?|entries|vouchers?|invoices?|bills?|payments?/, /unusual|abnormal|large|big|huge|exceptional|outlier|odd|suspicious|spike/, /normal|usual|typical|compared|average|activity|regular/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `WITH e AS (SELECT l.led_key, l.code, l.book, l.doc_date, l.full_docno, l.amount::numeric AS amt, AVG(l.amount::numeric) OVER (PARTITION BY l.book) AS mean, STDDEV_POP(l.amount::numeric) OVER (PARTITION BY l.book) AS sd, COUNT(*) OVER (PARTITION BY l.book) AS n`
      + ` FROM ${ctx.sch}.ledger l WHERE l.doc_pos = 'A' AND l.doc_posting = 'P' AND l.book IN (${SALE}, ${PURCHASE}, 4, 6, 15, ${CREDIT_NOTE}, 11) AND l.amount::numeric > 0 AND l.doc_date >= $1::date AND l.doc_date <= $2::date)`
      + ` SELECT e.code, e.doc_date AS d, e.full_docno AS doc, btrim(COALESCE(bp.book_desc, 'Book ' || e.book::text)) AS book, btrim(COALESCE(ac.name, '')) AS party, e.amt, e.mean, e.amt / NULLIF(e.mean, 0) AS times`
      + ` FROM e LEFT JOIN ${ctx.sch}.book_properties bp ON bp.book_key = e.book LEFT JOIN ${ctx.sch}.account ac ON ac.code = e.code WHERE e.n >= 10 AND e.amt > e.mean + 3 * e.sd AND e.amt >= 3 * e.mean ORDER BY e.amt / NULLIF(e.mean, 0) DESC LIMIT 100`, [ctx.period.from, ctx.period.to]);
    return {
      id: 139, title: `Unusually large transactions (${found.length})`, columns: [date("d", "Date"), text("doc", "Voucher"), text("book", "Book"), text("party", "Party"), money("amt", "Amount"), money("mean", "Usual Amount in the Book"), money("times", "Times the Usual")],
      rows: found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), book: String(row.book), party: String(row.party), amt: num(row.amt), mean: num(row.mean), times: round2(num(row.times)), code: num(row.code) })),
      note: `${ctx.period.label}. Entries of the sale, purchase, cash, bank, expense, credit note and debit note books whose amount is more than 3 standard deviations above the average of their book and at least 3 times that average; books with fewer than 10 entries are not judged. The 100 most unusual are shown. An unusual entry is a reason to look, not a mistake.`,
    };
  },
});

T.push({
  id: 140, question: "Which customers have sudden increases in outstanding?", defaultPeriod: "none",
  terms: [/customers?|clients?|parties/, /sudden|sharp|jump|spike|surge|rapid|suddenly|big increase|increases?|rise|rose/, /outstanding|balance|receivable|owe|dues?/], not: [/top|overdue|credit limit|why|explain|supplier/],
  run: async (ctx) => {
    const days = numberAfter(ctx.question ?? "", /(\d+)\s*days?/) ?? 30;
    const now = (await balances(ctx, 2)).filter((row) => row.closing > 0);
    const before = new Map((await balances({ ...ctx, today: addDays(ctx.today, -days) }, 2, now.map((row) => row.code))).map((row) => [row.code, row.closing] as const));
    const list = now.map((row) => { const was = Math.max(0, before.get(row.code) ?? 0); return { code: row.code, name: row.name, was, now: row.closing, change: row.closing - was, pct: was === 0 ? 100 : ((row.closing - was) / was) * 100 }; })
      .filter((row) => row.change >= 10000 && (row.was === 0 || row.pct >= 50)).sort((a, b) => b.change - a.change);
    return {
      id: 140, title: `Customers whose outstanding jumped in ${days} days (${list.length})`, columns: [int("no", "No."), text("name", "Customer"), money("was", `${days} Days Ago`), money("now", "Now"), money("change", "Increase"), money("pct", "Increase %")],
      rows: list.slice(0, 200).map((row, at) => ({ no: at + 1, name: row.name, was: row.was, now: row.now, change: row.change, pct: row.pct, code: row.code, detail: `bills:${row.code}` })),
      note: `Balances as on ${dmy(addDays(ctx.today, -days))} and ${dmy(ctx.today)} (say another number of days in the question), as the Outstanding Agewise report takes them. A jump is an increase of at least 10,000 that is also at least 50% (a customer who owed nothing before counts as 100%). Click a customer to show its open bills.`,
    };
  },
});

// --- 141 to 149: manufacturing and finished-product costing
//
// A product made in the factory has a bill of material (MFG-BOM voucher); its standard cost is that bill's materials at the rates costed as the Finish Product
// Costing report does (see bomCosts). The production itself is not entered as separate vouchers, so the quantity made is taken as the quantity sold.

type BomModel = Readonly<{ latest: Map<number, { doc: string; qty: number }>; lines: Map<string, { prod: number; qty: number; rate: number }[]>; standard: (prod: number) => number }>;

/** The bills of material as bomCosts reads them, to cost again with other rates. */
async function bomModel(ctx: Ctx): Promise<BomModel | null> {
  const found = await rows(ctx, `SELECT full_docno AS doc, prod_id, stock_nat AS nature, quantity::numeric AS qty, rate::numeric AS rate, il_date FROM ${ctx.sch}.prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D'`);
  const latest = new Map<number, { doc: string; qty: number; date: number }>();
  const lines = new Map<string, { prod: number; qty: number; rate: number }[]>();
  for (const row of found) {
    if (String(row.nature) === "A") {
      const header = { doc: String(row.doc), qty: num(row.qty), date: row.il_date instanceof Date ? row.il_date.getTime() : 0 };
      const current = latest.get(num(row.prod_id));
      if (!current || header.date > current.date || (header.date === current.date && header.doc > current.doc)) latest.set(num(row.prod_id), header);
    } else if (String(row.nature) === "L") lines.set(String(row.doc), [...(lines.get(String(row.doc)) ?? []), { prod: num(row.prod_id), qty: num(row.qty), rate: num(row.rate) }]);
  }
  if (latest.size === 0) return null;
  const purchase = new Map((await rows(ctx, `SELECT DISTINCT ON (prod_id) prod_id, rate::numeric AS rate FROM ${ctx.sch}.prod_ledger WHERE il_pos = 'A' AND il_date BETWEEN $1::date AND $2::date AND book = ${PURCHASE} AND led_id IS NOT NULL ORDER BY prod_id, il_date DESC`, [iso(ctx.session.tarikh1), ctx.today])).map((row) => [num(row.prod_id), num(row.rate)] as const));
  const balance = new Map((await rows(ctx, `SELECT DISTINCT ON (prod_id) prod_id, open_rate::numeric AS open_rate, rep_rate::numeric AS rep_rate FROM ${ctx.sch}.prod_balance WHERE prec_flag = 'RP' ORDER BY prod_id`)).map((row) => [num(row.prod_id), row] as const));
  return { latest, lines, standard: (prod) => purchase.get(prod) || num(balance.get(prod)?.open_rate) || num(balance.get(prod)?.rep_rate) || 0 };
}

/**
 * The cost of one piece of a made product. A material that is made from its own bill (and has no rate on the line) is costed from that; any other takes the
 * rate `pick` gives for it, else the line's rate, else the standard rate. Without `pick` it is the cost bomCosts gives.
 */
function bomUnit(model: BomModel, prod: number, pick?: (material: number) => number | undefined, depth = 0, path: ReadonlySet<number> = new Set()): number {
  const header = model.latest.get(prod);
  if (!header || header.qty <= 0 || depth >= 10 || path.has(prod)) return model.standard(prod);
  const next = new Set(path).add(prod);
  let total = 0;
  for (const line of model.lines.get(header.doc) ?? []) {
    const own = model.latest.has(line.prod);
    const rate = own ? (line.rate !== 0 ? line.rate : bomUnit(model, line.prod, pick, depth + 1, next)) : pick?.(line.prod) ?? (line.rate !== 0 ? line.rate : model.standard(line.prod));
    total += line.qty * rate;
  }
  return total / header.qty;
}

/** What one piece of a made product uses of each raw material (a material made from its own bill is broken down into its materials), with the cost of it. */
function bomUsage(model: BomModel, prod: number, scale = 1, out = new Map<number, { qty: number; value: number }>(), depth = 0, path: ReadonlySet<number> = new Set()) {
  const header = model.latest.get(prod);
  if (!header || header.qty <= 0 || depth >= 10 || path.has(prod)) return out;
  const next = new Set(path).add(prod);
  for (const line of model.lines.get(header.doc) ?? []) {
    const each = (line.qty / header.qty) * scale;
    if (model.latest.has(line.prod) && line.rate === 0) { bomUsage(model, line.prod, each, out, depth + 1, next); continue; }
    const entry = out.get(line.prod) ?? out.set(line.prod, { qty: 0, value: 0 }).get(line.prod)!;
    entry.qty += each; entry.value += each * (line.rate !== 0 ? line.rate : model.standard(line.prod));
  }
  return out;
}

/** Each product's purchase rate in force at the date: its latest purchase up to then (value over quantity of that bill's line, before tax), with the date of the latest purchase of all. */
async function rateAsOf(ctx: Ctx, upto: string) {
  const found = await rows(ctx, `SELECT DISTINCT ON (pl.prod_id) pl.prod_id, pl.il_value::numeric / NULLIF(pl.quantity::numeric, 0) AS rate, l.doc_date AS d FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id WHERE pl.book = ${PURCHASE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND pl.quantity::numeric > 0 AND l.doc_date <= $1::date ORDER BY pl.prod_id, l.doc_date DESC, pl.il_key DESC`, [upto]);
  const latest = found.reduce((most, row) => (row.d instanceof Date && row.d.getTime() > most ? row.d.getTime() : most), 0);
  return { rates: new Map(found.filter((row) => num(row.rate) > 0).map((row) => [num(row.prod_id), num(row.rate)] as const)), latest: latest === 0 ? "" : dmy(new Date(latest)) };
}

async function productNames(ctx: Ctx, ids: readonly number[]) {
  if (ids.length === 0) return new Map<number, string>();
  return new Map((await rows(ctx, `SELECT prod_key, btrim(prod_desc) AS name FROM ${ctx.sch}.product_master WHERE prod_key = ANY($1::int[])`, [[...ids]])).map((row) => [num(row.prod_key), String(row.name)] as const));
}

const NO_BOM = "No product has a bill of material (MFG-BOM) in this company, so there is no manufacturing cost to work out.";
const noBom = (id: number, title: string): AskAnswer => ({ id, title, columns: [text("item", "Item")], rows: [], note: NO_BOM });
const BOM_NOTE = "A made product's cost is its latest bill of material at the rates the Finish Product Costing report takes (the BOM's rate, else the latest purchase rate of the year, else the opening rate).";

T.push({
  id: 141, question: "Which products have the highest material cost?", defaultPeriod: "year",
  terms: [/products?|items?|finished|goods/, /material|raw/, /cost/, /highest|most|top|biggest|largest|expensive/], not: [/increase|change|rose|percent|%|impact|consum|margin/],
  run: async (ctx) => {
    const model = await bomModel(ctx);
    if (!model) return noBom(141, "Products by material cost");
    const sold = new Map((await productProfits(ctx)).map((row) => [row.prod, row] as const));
    const made = [...model.latest.keys()].map((prod) => ({ prod, cost: bomUnit(model, prod) })).filter((row) => row.cost > 0);
    const names = await productNames(ctx, made.map((row) => row.prod));
    const list = made.map((row) => { const s = sold.get(row.prod); return { name: names.get(row.prod) ?? String(row.prod), unit: row.cost, rate: s?.rate ?? 0, pct: s && s.rate > 0 ? pctOf(row.cost, s.rate) : 0, qty: s?.qty ?? 0, total: row.cost * Math.max(0, s?.qty ?? 0) }; }).sort((a, b) => b.total - a.total || b.unit - a.unit);
    return {
      id: 141, title: `Made products by material cost (${list.length})`, columns: [int("no", "No."), text("name", "Product"), money("unit", "Material Cost a Piece"), money("rate", "Average Selling Rate"), money("pct", "Material % of Rate"), qty("qty", "Quantity Sold"), money("total", "Material Cost of Sales")],
      rows: list.slice(0, 100).map((row, at) => ({ no: at + 1, ...row })),
      note: `${ctx.period.label}. ${BOM_NOTE} Material Cost of Sales is the cost a piece times the net quantity sold, biggest first; a product not sold shows 0.`,
    };
  },
});

/** The made products costed with each month's own purchase rates, this month so far and the days of last month. */
async function monthlyBomCosts(ctx: Ctx) {
  const model = await bomModel(ctx);
  const pair = await monthPair(ctx);
  if (!model || !pair.lastCtx) return { model, pair, list: [] as { prod: number; last: number; current: number }[], latest: "" };
  const now = await rateAsOf(ctx, ctx.today);
  const thisRates = now.rates;
  const lastRates = (await rateAsOf(pair.lastCtx, iso(new Date(pair.lastFrom.getFullYear(), pair.lastFrom.getMonth() + 1, 0)))).rates;
  const list = [...model.latest.keys()].map((prod) => ({ prod, last: bomUnit(model, prod, (material) => lastRates.get(material)), current: bomUnit(model, prod, (material) => thisRates.get(material)) })).filter((row) => row.last > 0 || row.current > 0);
  return { model, pair, list, latest: now.latest };
}

T.push({
  id: 142, question: "How much has production cost changed compared with the previous month?", defaultPeriod: "none",
  terms: [/production|manufactur|making|factory/, /cost/, /chang|compar|differ|increase|decrease|vs|versus|previous|last/, /month/],
  run: async (ctx) => {
    const { model, pair, list, latest } = await monthlyBomCosts(ctx);
    if (!model) return noBom(142, "Production cost against the previous month");
    if (!pair.lastCtx) return { id: 142, title: "Production cost against the previous month", columns: [text("item", "Item")], rows: [], note: "Last month is in the previous year, whose database was not found on this server." };
    const names = await productNames(ctx, list.map((row) => row.prod));
    const out = list.map((row) => ({ name: names.get(row.prod) ?? String(row.prod), last: row.last, current: row.current, change: row.current - row.last, pct: pctOf(row.current - row.last, row.last) })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const costed = out.filter((row) => row.last > 0 && row.current > 0);
    const average = costed.length === 0 ? 0 : sumOf(costed, (row) => row.pct) / costed.length;
    return {
      id: 142, title: `Production cost of ${out.length} made products against last month`, columns: [int("no", "No."), text("name", "Product"), money("last", "Last Month"), money("current", "This Month"), money("change", "Change a Piece"), money("pct", "Change %")],
      summary: `Material cost a piece is ${average >= 0 ? "up" : "down"} ${Math.abs(average).toFixed(1)}% on average over last month; ${costed.filter((row) => row.change > 0).length} products cost more, ${costed.filter((row) => row.change < 0).length} cost less.`,
      rows: out.slice(0, 100).map((row, at) => ({ no: at + 1, ...row })),
      note: `Each made product's latest bill of material costed at the purchase rate in force at the end of ${MONTHS_SHORT[pair.lastFrom.getMonth()]}-${pair.lastFrom.getFullYear()} and today (the latest purchase of each material up to then; a material never bought keeps its bill's rate), so a change shows only where a material was bought at a new price in between${latest === "" ? "" : `; the latest purchase in the books is of ${latest}`}. Material cost only: labour and overheads are not entered against products.`,
    };
  },
});

T.push({
  id: 143, question: "Which products have actual costs above their standard costs?", defaultPeriod: "none",
  terms: [/products?|items?|finished|goods/, /actual/, /standard|budget|estimat|bom|planned/, /cost/, /above|more|higher|exceed|over/],
  run: async (ctx) => {
    const model = await bomModel(ctx);
    if (!model) return noBom(143, "Actual cost above standard cost");
    const { rates, latest } = await rateAsOf(ctx, ctx.today);
    const names = await productNames(ctx, [...model.latest.keys()]);
    const list = [...model.latest.keys()].map((prod) => { const standard = bomUnit(model, prod); const actual = bomUnit(model, prod, (material) => rates.get(material)); return { name: names.get(prod) ?? String(prod), standard, actual, change: actual - standard, pct: pctOf(actual - standard, standard) }; })
      .filter((row) => row.standard > 0 && row.change > 0.005).sort((a, b) => b.pct - a.pct);
    return {
      id: 143, title: `Products whose actual cost is above standard (${list.length})`, columns: [int("no", "No."), text("name", "Product"), money("standard", "Standard Cost a Piece"), money("actual", "Actual Cost a Piece"), money("change", "Above Standard"), money("pct", "Above Standard %")],
      rows: list.slice(0, 100).map((row, at) => ({ no: at + 1, ...row })),
      note: `Standard is the latest bill of material at its own rates; actual is the same bill at the latest purchase rate of each material (a material never bought keeps its standard rate)${latest === "" ? "" : `; the latest purchase in the books is of ${latest}`}. ${BOM_NOTE.split(" (")[0]}.`,
    };
  },
});

T.push({
  id: 144, question: "Which raw materials contribute most to cost increases?", defaultPeriod: "year",
  terms: [/raw materials?|materials?|ingredients?|components?/, /cost|price|rate/, /contribut|driv|cause|behind|responsible|biggest|most/, /increase|rise|rising|higher|up|jump/],
  run: async (ctx) => {
    const model = await bomModel(ctx);
    if (!model) return noBom(144, "Raw materials behind cost increases");
    const pair = await monthPair(ctx);
    if (!pair.lastCtx) return { id: 144, title: "Raw materials behind cost increases", columns: [text("item", "Item")], rows: [], note: "Last month is in the previous year, whose database was not found on this server." };
    const now = await rateAsOf(ctx, ctx.today);
    const thisRates = now.rates;
    const lastRates = (await rateAsOf(pair.lastCtx, iso(new Date(pair.lastFrom.getFullYear(), pair.lastFrom.getMonth() + 1, 0)))).rates;
    const made = new Map((await productProfits(ctx)).filter((row) => model.latest.has(row.prod) && row.qty > 0).map((row) => [row.prod, row.qty] as const));
    const used = new Map<number, number>();
    for (const [prod, sold] of made) for (const [material, use] of bomUsage(model, prod)) used.set(material, (used.get(material) ?? 0) + use.qty * sold);
    const names = await productNames(ctx, [...used.keys()]);
    const list = [...used].filter(([material]) => thisRates.has(material) && lastRates.has(material)).map(([material, quantity]) => { const last = lastRates.get(material) as number; const current = thisRates.get(material) as number; return { name: names.get(material) ?? String(material), last, current, pct: pctOf(current - last, last), qty: quantity, impact: (current - last) * quantity }; })
      .filter((row) => row.impact > 0).sort((a, b) => b.impact - a.impact);
    const total = sumOf(list, (row) => row.impact);
    return {
      id: 144, title: `Raw materials pushing the cost up (${list.length})`, columns: [int("no", "No."), text("name", "Raw Material"), money("last", "Rate Last Month End"), money("current", "Rate Now"), money("pct", "Rate Change %"), qty("qty", "Used in Sales (year)"), money("impact", "Cost Impact"), money("share", "Share of Increase %")],
      rows: list.slice(0, 100).map((row, at) => ({ no: at + 1, ...row, share: pctOf(row.impact, total) })),
      note: `Materials whose purchase rate now is above the rate in force at the end of last month${now.latest === "" ? "" : ` (the latest purchase in the books is of ${now.latest})`}. Cost Impact is the rate rise times the quantity of the material used for the made products sold in ${ctx.period.label.toLowerCase()} (each bill of material times the net quantity sold). ${BOM_NOTE.split(" (")[0]}.`,
    };
  },
});

T.push({
  id: 145, question: "Which finished products have the lowest profit margin?", defaultPeriod: "year",
  terms: [/finished|made|manufactured|factory|\bfg\b|production/, /products?|items?|goods/, /lowest|least|low|poor|weak|worst|thin/, /margin|profit/],
  run: async (ctx) => {
    const model = await bomModel(ctx);
    if (!model) return noBom(145, "Finished products by margin");
    const list = (await productProfits(ctx)).filter((row) => model.latest.has(row.prod) && row.value > 0).sort((a, b) => a.margin - b.margin).slice(0, Math.max(ctx.top, 20));
    return { id: 145, title: `Finished products with the lowest margin`, columns: [int("no", "No."), text("name", "Product"), ...profitColumns], rows: list.map(profitRow), note: `${ctx.period.label}. Only products made in the factory (with a bill of material). ${PROFIT_NOTE}` };
  },
});

T.push({
  id: 146, question: "How much material cost is consumed in production?", defaultPeriod: "year",
  terms: [/material/, /cost|value|amount/, /consum|used|use|spent|going/, /production|manufactur|factory|making/],
  run: async (ctx) => {
    const model = await bomModel(ctx);
    if (!model) return noBom(146, "Material cost consumed in production");
    const made = (await productProfits(ctx)).filter((row) => model.latest.has(row.prod) && row.qty > 0);
    const used = new Map<number, { qty: number; value: number }>();
    for (const row of made) for (const [material, use] of bomUsage(model, row.prod)) { const entry = used.get(material) ?? used.set(material, { qty: 0, value: 0 }).get(material)!; entry.qty += use.qty * row.qty; entry.value += use.value * row.qty; }
    const names = await productNames(ctx, [...used.keys()]);
    const list = [...used].map(([material, entry]) => ({ name: names.get(material) ?? String(material), qty: entry.qty, rate: entry.qty === 0 ? 0 : entry.value / entry.qty, value: entry.value })).sort((a, b) => b.value - a.value);
    const total = sumOf(list, (row) => row.value);
    const sales = sumOf(made, (row) => row.value);
    return {
      id: 146, title: "Material cost consumed in production", summary: `Material worth ${grouping.format(total)} went into the ${made.length} made products sold (${pctOf(total, sales).toFixed(1)}% of their net sales of ${grouping.format(sales)}).`,
      columns: [int("no", "No."), text("name", "Material"), qty("qty", "Quantity"), money("rate", "Average Rate"), money("value", "Cost"), money("share", "Share %")],
      rows: list.length === 0 ? [] : [...list.slice(0, 100).map((row, at) => ({ no: at + 1, ...row, share: pctOf(row.value, total) })), { no: "", name: "Total", qty: "", rate: "", value: total, share: 100 }],
      note: `${ctx.period.label}. Production is not entered as vouchers, so the consumption is worked out: each made product's latest bill of material times the net quantity of it sold (a semi-finished material is broken down into its own materials). ${BOM_NOTE}`,
    };
  },
});

T.push({
  id: 147, question: "Which production orders exceed their estimated cost?", defaultPeriod: "none",
  terms: [/production|manufactur|job|work/, /orders?|jobs?|batch|batches/, /exceed|over|above|more than|overrun|beyond/, /estimat|budget|planned|standard|cost/],
  run: async () => ({
    id: 147, title: "Production orders against estimated cost", columns: [text("item", "Item"), text("what", "What")],
    rows: [{ item: "Estimated cost", what: "Can be worked out: the product's bill of material (see \"Which products have actual costs above their standard costs?\")." }, { item: "Actual cost of an order", what: "Not kept: the books do not record the materials issued or the expenses charged against a production order, so an order's actual cost is unknown." }],
    note: "A production order cannot be compared with its estimate because its actual cost is not recorded. Ask \"Which products have actual costs above their standard costs?\" to see where current material rates exceed the bill of material.",
  }),
});

T.push({
  id: 148, question: "What is the cost impact of a 5% increase in raw material prices?", defaultPeriod: "year",
  terms: [/raw materials?|materials?|ingredients?|input/, /prices?|rates?|cost/, /increase|rise|hike|higher|up|inflation|impact|effect/, /impact|effect|what|%|percent|if/],
  run: async (ctx) => {
    const model = await bomModel(ctx);
    const percent = numberAfter(ctx.question ?? "", /(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/i) ?? 5;
    if (!model) return noBom(148, "Impact of a raw material price rise");
    const made = (await productProfits(ctx)).filter((row) => model.latest.has(row.prod) && row.qty > 0);
    const used = new Map<number, number>();
    const byProduct: { name: string; cost: number; impact: number; margin: number; after: number; sales: number }[] = [];
    for (const row of made) {
      let cost = 0;
      for (const [material, use] of bomUsage(model, row.prod)) { used.set(material, (used.get(material) ?? 0) + use.value * row.qty); cost += use.value * row.qty; }
      const impact = (cost * percent) / 100;
      byProduct.push({ name: row.name, cost, impact, margin: row.margin, after: pctOf(row.profit - impact, row.value), sales: row.value });
    }
    const total = sumOf(byProduct, (row) => row.cost); const impact = (total * percent) / 100;
    const profit = sumOf(made, (row) => row.profit); const sales = sumOf(made, (row) => row.value);
    byProduct.sort((a, b) => b.impact - a.impact);
    return {
      id: 148, title: `If raw material prices rise ${percent}%`,
      summary: `A ${percent}% rise adds about ${grouping.format(impact)} to the material cost of the made products sold this year (${pctOf(impact, sales).toFixed(2)}% of their sales), cutting their profit from ${grouping.format(profit)} to ${grouping.format(profit - impact)} and their margin from ${pctOf(profit, sales).toFixed(1)}% to ${pctOf(profit - impact, sales).toFixed(1)}% if prices cannot be passed on.`,
      columns: [text("item", "Product"), money("cost", "Material Cost"), money("impact", `Extra Cost at ${percent}%`), money("margin", "Margin Now %"), money("after", "Margin After %")],
      rows: [{ item: "All made products sold", cost: total, impact, margin: pctOf(profit, sales), after: pctOf(profit - impact, sales) }, ...byProduct.slice(0, 30).map((row) => ({ item: `  ${row.name}`, cost: row.cost, impact: row.impact, margin: row.margin, after: row.after }))],
      note: `${ctx.period.label}. The material cost is each made product's bill of material times the net quantity sold. Say another rise in the question (for example "a 10% increase"). Products without a bill of material (bought and sold as they are) are not affected here. ${PROFIT_NOTE}`,
    };
  },
});

// --- 53: the profit and loss account (the Profit / Loss report, with its closing stock from the Stock report)

T.push({
  id: 53, question: "Show the profit and loss account.", defaultPeriod: "year",
  terms: [/profit/, /loss/, /account|statement|p ?& ?l|and loss/], not: [/customer|party|product|each|net profit|gross|margin/],
  run: async (ctx) => {
    const columns = [text("PARTICULAR", "Particulars"), money("CURRENT_AMOUNT", "Amount"), money("PERC", "% of Sales"), text("PARTICULAR_1", "Particulars"), money("CURRENT_AMOUNT_1", "Amount"), money("PERC_1", "% of Sales")];
    const failed = (why: string): AskAnswer => ({ id: 53, title: "Profit and loss account", columns, rows: [], note: `The Profit / Loss report could not be run here: ${why}` });
    try {
      const found = (await rows(ctx, `SELECT btrim(report_name) AS name FROM ${SETUP_SCHEMA}.report_properties WHERE report_key = 22 LIMIT 1`))[0];
      if (!found) return failed("this installation has no Profit / Loss report.");
      const reportName = String(found.name);
      const menus: MenuNode[] = [];
      const walk = (list: readonly MenuNode[]) => { for (const node of list) { menus.push(node); walk(node.children); } };
      walk(await readMenuCatalog(ctx.session.companyGroup));
      const loader = new Loader(ctx.client, ctx.session);
      const definition = await loadReport(loader, reportName, menus.find((node) => node.actionMenu?.toUpperCase() === reportName.toUpperCase())?.menuShortName ?? "");
      // Up to date from the year's start, or between dates; the closing stock is worked out by the Stock report (Update Value In Master, Closing Amount), as the screen does when it is ticked.
      const between = ctx.period.from !== iso(ctx.session.tarikh1);
      const option = definition.firstCombo.options.find((candidate) => (between ? /between/i : /upto|up to/i).test(candidate.text));
      const control = definition.controls.find((candidate) => /^lbox_sorting$/i.test(candidate.name));
      const closing = control?.items.find((item) => /closing/i.test(item.text));
      if (!option || !control || !closing) return failed("its selection does not have the Upto Date and Closing Amount choices.");
      const checks = Object.fromEntries(definition.checkboxes.map((check) => [check.name, check.value]));
      const output = await runReport(loader, reportName, {
        firstCombo: option.value, from: reportDay(ctx.period.from), upto: reportDay(ctx.period.to), groups: [], ticks: {}, choices: { [control.name]: `${closing.controlValKey}|${closing.value}` }, columns: [],
        texts: {}, checks: { ...checks, CHK_UPD_MASTER: true, CHK_OPEN_VALUE: between, CHK_PROFIT_PERC: false, CHK_PREV_BAL: false },
      });
      const entries = output.rows.filter((row) => isEntryRow(row));
      const cell = (row: (typeof entries)[number], key: string) => row.values[key];
      const body = entries.map((row) => ({ PARTICULAR: String(cell(row, "PARTICULAR") ?? ""), CURRENT_AMOUNT: amountOfCell(cell(row, "CURRENT_AMOUNT")), PARTICULAR_1: String(cell(row, "PARTICULAR_1") ?? ""), CURRENT_AMOUNT_1: amountOfCell(cell(row, "CURRENT_AMOUNT_1")) }));
      // The summary as Tally's Profit & Loss A/c shows it: the accounts are added into the main groups (Purchase Accounts, Direct Expenses, Sales Accounts, Direct Incomes, Indirect Expenses, Indirect Incomes),
      // the stock and profit lines stand as they are, and each amount has its percentage of the sales accounts.
      const heads = new Map((await rows(ctx, `SELECT btrim(ac.name) AS name, btrim(bs.bs_code) AS code, btrim(bs.bs_desc) AS head, bs.bs_level AS level, ac.book AS book FROM ${ctx.sch}.account ac JOIN ${ctx.sch}.balsheet bs ON bs.bs_key = ac.bs_id WHERE ac.a_pos <> 'D' AND bs.bs_level IN (1, 2, 3)`)).map((row) => [String(row.name).toLowerCase(), { code: String(row.code), head: String(row.head), level: num(row.level), book: num(row.book) }] as const));
      const special = (name: string) => (/^(OPENING|CLOSING) STOCK$|^Gross (Profit|Loss) c\/f$/i.test(name) ? 1 : /^(NET (PROFIT|LOSS)|Gross (Profit|Loss) B\/d)$/i.test(name) ? 2 : /^(NET (PROFIT|LOSS) B\/d|APPROPRIATE (PROFIT|LOSS))$/i.test(name) ? 3 : /== >>/.test(name) ? 20 : 0);
      const groups = new Map<string, number>();
      const add = (key: string, amount: number) => groups.set(key, (groups.get(key) ?? 0) + amount);
      let netSeen = false;
      // The appropriation of the profit (level 3) and the net profit left after it, as the report shows them.
      const appropriation = { left: new Map<string, number>(), right: new Map<string, number>() };
      let afterAppropriation: { name: string; amount: number } | null = null;
      const picked = { net: "", gross: "" };
      for (const row of body) {
        for (const [name, amount, debit] of [[row.PARTICULAR.trim(), row.CURRENT_AMOUNT, true], [row.PARTICULAR_1.trim(), row.CURRENT_AMOUNT_1, false]] as const) {
          if (name === "" || amount === 0) continue;
          const kind = special(name);
          if (kind === 20) continue;
          if (kind === 3) {
            const label = /^NET PROFIT B\/d$/i.test(name) ? "Nett Profit b/d" : /^NET LOSS B\/d$/i.test(name) ? "Nett Loss b/d" : name;
            const target = debit ? appropriation.left : appropriation.right;
            target.set(label, (target.get(label) ?? 0) + amount);
            continue;
          }
          if (kind > 0) {
            if (/^NET (PROFIT|LOSS)$/i.test(name)) { if (netSeen) { afterAppropriation = { name: /LOSS/i.test(name) ? "Nett Loss (after appropriation)" : "Nett Profit (after appropriation)", amount }; continue; } netSeen = true; picked.net = /LOSS/i.test(name) ? "Nett Loss" : "Nett Profit"; add(picked.net, amount); }
            else if (/^Gross (Profit|Loss) c\/f$/i.test(name)) { picked.gross = name; add(/Profit/i.test(name) ? "Gross Profit c/o" : "Gross Loss c/o", amount); }
            else if (/^Gross (Profit|Loss) B\/d$/i.test(name)) add(/Profit/i.test(name) ? "Gross Profit b/f" : "Gross Loss b/f", amount);
            else add(name.replace(/^(\w)(\w*) STOCK$/i, (_all, first: string, rest: string) => `${first.toUpperCase()}${rest.toLowerCase()} Stock`), amount);
            continue;
          }
          const found = heads.get(name.toLowerCase());
          const level = found?.level ?? 0;
          // Sales Accounts are the sale (and sales return) accounts only, net; every other credit of the trading account (trade discounts, duty drawback ...) is a Direct Income.
          if (level === 1 && (found?.book === 8 || found?.book === 16)) add("Sales Accounts", debit ? -amount : amount);
          else if (level === 1) add(!debit ? "Direct Incomes" : found?.code.startsWith("0103") ? "Direct Expenses" : "Purchase Accounts", amount);
          else if (level === 2) add(debit ? "Indirect Expenses" : "Indirect Incomes", amount);
          else if (level === 3 && found) { const target = debit ? appropriation.left : appropriation.right; const label = "Appropriation Expenses"; target.set(label, (target.get(label) ?? 0) + amount); }
        }
      }
      const sales = groups.get("Sales Accounts") ?? 0;
      const line = (name: string) => (groups.has(name) ? { name, amount: round2(groups.get(name) as number) } : null);
      const side = (names: string[]) => names.map(line).filter((entry): entry is { name: string; amount: number } => entry !== null);
      const summaryRows: Record<string, string | number>[] = [];
      const percent = (amount: number) => (sales === 0 ? "" : round2((amount / sales) * 100));
      const block = (left: { name: string; amount: number }[], right: { name: string; amount: number }[]) => {
        for (let at = 0; at < Math.max(left.length, right.length); at += 1) summaryRows.push({ PARTICULAR: left[at]?.name ?? "", CURRENT_AMOUNT: left[at]?.amount ?? "", PERC: left[at] ? percent(left[at].amount) : "", PARTICULAR_1: right[at]?.name ?? "", CURRENT_AMOUNT_1: right[at]?.amount ?? "", PERC_1: right[at] ? percent(right[at].amount) : "" });
        summaryRows.push({ PARTICULAR: "Total", CURRENT_AMOUNT: round2(sumOf(left, (entry) => entry.amount)), PERC: "", PARTICULAR_1: "Total", CURRENT_AMOUNT_1: round2(sumOf(right, (entry) => entry.amount)), PERC_1: "" });
      };
      block(side(["Opening Stock", "Purchase Accounts", "Direct Expenses", "Gross Profit c/o"]), side(["Sales Accounts", "Direct Incomes", "Closing Stock", "Gross Loss c/o"]));
      block(side(["Gross Loss b/f", "Indirect Expenses", "Nett Profit"]), side(["Gross Profit b/f", "Indirect Incomes", "Nett Loss"]));
      if (appropriation.left.size > 0 || appropriation.right.size > 0) {
        summaryRows.push({ PARTICULAR: "Profit & Loss Appropriation", CURRENT_AMOUNT: "", PERC: "", PARTICULAR_1: "", CURRENT_AMOUNT_1: "", PERC_1: "" });
        const listOf = (map: Map<string, number>) => [...map].map(([name, amount]) => ({ name, amount: round2(amount) }));
        // The net profit left after the appropriation closes the left side, so both sides balance.
        const left = listOf(appropriation.left);
        if (afterAppropriation !== null) { const after: { name: string; amount: number } = afterAppropriation; left.push({ name: after.name, amount: round2(after.amount) }); }
        block(left, listOf(appropriation.right));
      }
      const amountOf = (name: RegExp) => { const hit = body.find((row) => name.test(row.PARTICULAR) || name.test(row.PARTICULAR_1)); return hit ? (name.test(hit.PARTICULAR) ? hit.CURRENT_AMOUNT : hit.CURRENT_AMOUNT_1) : null; };
      const closingStock = amountOf(/^CLOSING STOCK$/i);
      const net = body.find((row) => /^NET (PROFIT|LOSS)$/i.test(row.PARTICULAR) || /^NET (PROFIT|LOSS)$/i.test(row.PARTICULAR_1));
      const gross = amountOf(/^Gross (Profit|Loss) (C\/f|c\/f)$/i);
      const parts = [closingStock !== null ? `closing stock ${grouping.format(closingStock)}` : "", gross !== null ? `gross ${/Loss/i.test(body.find((row) => /^Gross (Profit|Loss) c\/f$/i.test(row.PARTICULAR) || /^Gross (Profit|Loss) c\/f$/i.test(row.PARTICULAR_1))?.PARTICULAR_1 ?? "") ? "loss" : "profit"} ${grouping.format(gross)}` : "",
        net ? `${/PROFIT/i.test(net.PARTICULAR || net.PARTICULAR_1) ? "net profit" : "net loss"} ${grouping.format(net.CURRENT_AMOUNT || net.CURRENT_AMOUNT_1)}` : ""].filter((part) => part !== "");
      return {
        id: 53, title: "Profit and loss account", columns, rows: summaryRows,
        choices: ["Today", "Yesterday", "This month", "Last month", "This quarter", "Last quarter", "This half year", "Last half year", "This year"].map((label) => ({ label, question: `Show the profit and loss account for ${label.toLowerCase()}.` })),
        ...(parts.length > 0 ? { summary: `${ctx.period.label}: ${parts.join(", ")}.` } : {}),
        note: `${ctx.period.label}. The Profit / Loss report of the REPORT menu with "Update Value In Master" ticked and Closing Amount chosen, so the closing stock is the value the Stock report works out (valuation Actual); figures as that report shows them. This is the summary as Tally's Profit & Loss A/c shows it, with each line's percentage of the sales accounts; open the report for the accounts and the appropriation. For another period pick a button above or type it after the question, for example: Show the profit and loss account for July to September.`,
        period: { from: ctx.period.from, to: ctx.period.to }, report: { name: reportName, label: "Open the Profit / Loss report", from: ctx.period.from, to: ctx.period.to, setup: { choices: { [control.name]: closing.text }, checks: ["CHK_UPD_MASTER", ...(between ? ["CHK_OPEN_VALUE"] : [])] } },
      };
    } catch (error) {
      return failed(error instanceof Error ? error.message.split("\n")[0] : "it could not be run.");
    }
  },
});

/** Finished (PROD-FG) or semi-finished (PROD-SFG) goods produced in the period, item wise: the added (stock_nat A) lines of the production vouchers, amount at the line's rate (cost rate where it has no rate). */
async function productionMade(ctx: Ctx, id: number, modules: readonly string[], title: string, saleRated: boolean): Promise<AskAnswer> {
  const inModules = `upper(btrim(pl.trn_module)) IN (${modules.map((module) => `'${module}'`).join(", ")}) AND pl.stock_nat = 'A' AND pl.il_pos = 'A' AND pl.il_date >= $1::date AND pl.il_date <= $2::date`;
  // Finished production: each line's gross is quantity x the price list sale rate of its day (rounded to 2), its net is the gross at Other Perc 75 % (68 % Export Perc for a product whose name starts with Export), rounded to 0, as the Production Summary report works it out.
  // Semi finished: quantity x the item's last purchase rate (value over quantity) up to the period's end, else its opening rate, else its report rate (prod_balance.rep_rate).
  const found = saleRated
    ? await rows(ctx,
      `SELECT btrim(COALESCE(pm.prod_desc, '')) AS product, COUNT(*) AS entries, SUM(x.quantity) AS qty, SUM(CASE WHEN left(btrim(COALESCE(pm.prod_desc, '')), 6) = 'Export' THEN round(round(x.quantity * COALESCE(x.sale_rate, 0), 2) * ${EXPORT_PERC} / 100, 0) ELSE round(round(x.quantity * COALESCE(x.sale_rate, 0), 2) * ${OTHER_PERC} / 100, 0) END) AS amount`
      + ` FROM (SELECT pl.prod_id, pl.quantity::numeric AS quantity, (SELECT round(pr.pl_srate::numeric, 2) FROM ${ctx.sch}.pricelist pr WHERE pr.prod_id = pl.prod_id AND pr.pl_wefrom <= pl.il_date AND (pr.pl_weupto >= pl.il_date OR pr.pl_weupto IS NULL) AND pr.pl_srate > 0 AND pr.pl_pos <> 'D' ORDER BY pr.pl_wefrom DESC LIMIT 1) AS sale_rate`
      + ` FROM ${ctx.sch}.prod_ledger pl WHERE ${inModules}) x JOIN ${ctx.sch}.product_master pm ON pm.prod_key = x.prod_id GROUP BY x.prod_id, pm.prod_desc ORDER BY 1 LIMIT 1000`, [ctx.period.from, ctx.period.to])
    : await rows(ctx,
      `WITH made AS (SELECT pl.prod_id, COUNT(*) AS entries, SUM(pl.quantity::numeric) AS qty FROM ${ctx.sch}.prod_ledger pl WHERE ${inModules} GROUP BY pl.prod_id),`
      + ` buy AS (SELECT DISTINCT ON (pl.prod_id) pl.prod_id, pl.il_value::numeric / NULLIF(pl.quantity::numeric, 0) AS rate FROM ${ctx.sch}.prod_ledger pl JOIN ${ctx.sch}.ledger l ON l.led_key = pl.led_id`
      + ` WHERE pl.book = ${PURCHASE} AND pl.il_pos = 'A' AND pl.inventory = 'Y' AND l.doc_pos = 'A' AND l.doc_date <= $2::date AND pl.quantity::numeric > 0 AND pl.prod_id IN (SELECT prod_id FROM made) ORDER BY pl.prod_id, l.doc_date DESC, pl.il_key DESC),`
      + ` bal AS (SELECT prod_id, MAX(open_rate::numeric) AS open_rate, MAX(rep_rate::numeric) AS rep_rate FROM ${ctx.sch}.prod_balance WHERE year_id = $3 GROUP BY prod_id)`
      + ` SELECT btrim(COALESCE(pm.prod_desc, '')) AS product, made.entries, made.qty, made.qty * COALESCE(NULLIF(buy.rate, 0), NULLIF(bal.open_rate, 0), NULLIF(bal.rep_rate, 0), 0) AS amount`
      + ` FROM made JOIN ${ctx.sch}.product_master pm ON pm.prod_key = made.prod_id LEFT JOIN buy ON buy.prod_id = made.prod_id LEFT JOIN bal ON bal.prod_id = made.prod_id ORDER BY 1 LIMIT 1000`, [ctx.period.from, ctx.period.to, ctx.session.yearId]);
  const out = found.map((row) => ({ product: String(row.product ?? ""), entries: num(row.entries), qty: num(row.qty), amount: num(row.amount) }));
  return {
    id, title, columns: [text("product", "Product"), int("entries", "Entries"), qty("qty", "Quantity"), money("amount", "Amount")],
    choices: ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This year", "All"].map((label) => ({ label, question: `${title} ${label === "All" ? "for all dates" : label.toLowerCase()}.` })),
    rows: out.length === 0 ? [] : [...out, { product: "Total", entries: out.reduce((sum, row) => sum + row.entries, 0), qty: out.reduce((sum, row) => sum + row.qty, 0), amount: out.reduce((sum, row) => sum + row.amount, 0) }],
    note: `${ctx.period.label}: the ${modules.join(" / ")} production entries (stock added), item wise. ${saleRated
      ? `Amount = net production: quantity x the price list sale rate of the day, then ${OTHER_PERC}% (${EXPORT_PERC}% for Export products), rounded to whole rupees per entry.`
      : "Amount = quantity x rate; the rate is the item's last purchase rate, else its opening rate, else its report rate."}`,
  };
}

const OTHER_PERC = 75;
const EXPORT_PERC = 68;

T.push({
  id: 150, question: "Show today's finished product production.", defaultPeriod: "today", terms: [/finished|\bfg\b/, /products?|goods|items?/, /production|produced|made|manufactur/], not: [/semi|\bsfg\b|margin|profit|cost/],
  run: (ctx) => productionMade(ctx, 150, ["PROD-FG"], "Finished product production", true),
});
T.push({
  id: 151, question: "Show today's semi finished product production.", defaultPeriod: "today", terms: [/semi|\bsfg\b/, /products?|goods|items?|finished/, /production|produced|made|manufactur/],
  run: (ctx) => productionMade(ctx, 151, ["PROD-SFG", "PROD-MULTI"], "Semi finished product production", false),
});

const PERIOD_BUTTONS = ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This quarter", "Last quarter", "This half year", "Last half year", "This year"];

T.push({
  id: 152, question: "What were our highest expenses this week?", defaultPeriod: "month",
  terms: [/expenses?|expenditure|spending/, /highest|largest|biggest|most|top|major/, /what|which|show|list|our|were|are/],
  not: [/compar|increase|increased|categories|category|salary|last year|same days/],
  run: async (ctx) => {
    const found = await rows(ctx,
      `SELECT ac.code, btrim(ac.name) AS name, COUNT(*) AS entries, SUM(l.amount::numeric) AS amount FROM ${ctx.sch}.ledger l JOIN ${ctx.sch}.account ac ON ac.code = l.code`
      + ` WHERE l.book = 15 AND l.doc_pos = 'A' AND l.doc_date >= $1::date AND l.doc_date <= $2::date GROUP BY ac.code, ac.name ORDER BY SUM(l.amount::numeric) DESC LIMIT 100`, [ctx.period.from, ctx.period.to]);
    const out = found.map((row, at) => ({ no: at + 1, name: String(row.name), entries: num(row.entries), amount: num(row.amount), detail: `expd:${num(row.code)}:${ctx.period.from}:${ctx.period.to}` }));
    const total = sumOf(out, (row) => row.amount);
    return {
      id: 152, title: "Highest expenses", columns: [int("no", "No."), text("name", "Expense"), int("entries", "Entries"), money("amount", "Amount"), money("share", "Share %")],
      choices: PERIOD_BUTTONS.map((label) => ({ label, question: `What were our highest expenses ${label.toLowerCase()}?` })),
      rows: out.length === 0 ? [] : [...out.map((row) => ({ ...row, share: pctOf(row.amount, total) })), { no: "", name: "Total", entries: sumOf(out, (row) => row.entries), amount: total, share: 100 }],
      note: `${ctx.period.label}: the Expense book, with tax, by expense account, highest first. Click a row to show its entries, click again to hide them.`,
    };
  },
});

T.push({
  id: 153, question: "How much sales did each salesman achieve this week?", defaultPeriod: "month",
  terms: [/salesm[ae]n|sales ?persons?|sales ?rep/, /sales?|sold|revenue|business/, /each|achiev|how much|wise|by|per/],
  not: [/profit|outstanding|overdue|product/],
  run: async (ctx) => {
    const groups = await dimensionGroups(ctx, DIMENSIONS[0]);
    const choices = PERIOD_BUTTONS.map((label) => ({ label, question: `How much sales did each salesman achieve ${label.toLowerCase()}?` }));
    if (!groups) return { id: 153, title: "Sales by salesman", columns: [text("item", "Item")], rows: [], choices, note: "The account master has no Sales Man field, so customers cannot be grouped by salesman." };
    const totals = new Map<string, { customers: number; entries: number; sales: number; returns: number }>();
    for (const row of await netSales(ctx, ctx.period.from, ctx.period.to, true)) {
      if (row.net === 0 && row.sales === 0) continue;
      const name = groups.of.get(row.code) ?? "(not set)";
      const entry = totals.get(name) ?? totals.set(name, { customers: 0, entries: 0, sales: 0, returns: 0 }).get(name)!;
      entry.customers += 1; entry.entries += row.entries; entry.sales += row.sales; entry.returns += row.returns;
    }
    const list = [...totals].map(([name, entry]) => ({ name, ...entry, net: entry.sales - entry.returns })).sort((a, b) => b.net - a.net);
    const total = sumOf(list, (row) => row.net);
    return {
      id: 153, title: `Sales by ${groups.label}`, choices, columns: [int("no", "No."), text("name", groups.label), int("customers", "Customers"), int("entries", "Entries"), ...salesColumns, money("share", "Share %")],
      rows: list.length === 0 ? [] : [...list.map((row, at) => ({ no: at + 1, name: row.name, customers: row.customers, entries: row.entries, sales: row.sales, returns: -row.returns, net: row.net, share: pctOf(row.net, total), detail: `grp:0:${encodeURIComponent(row.name)}:${ctx.period.from}:${ctx.period.to}` })),
        { no: "", name: "Total", customers: sumOf(list, (row) => row.customers), entries: sumOf(list, (row) => row.entries), sales: sumOf(list, (row) => row.sales), returns: -sumOf(list, (row) => row.returns), net: total, share: 100 }],
      note: `${ctx.period.label}. ${SALES_NOTE} Each customer's sales are credited to the ${groups.label} set in its account master.`,
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading the question

const STOP = new Set(["the", "of", "for", "from", "to", "a", "an", "and", "in", "on", "at", "my", "me", "show", "what", "is", "are", "was", "all", "this", "that", "party", "customer", "customers", "supplier", "suppliers", "particular", "find", "get", "give", "list", "ledger", "statement", "invoices", "invoice", "sales", "sale", "bills", "bill", "closing", "opening", "balance", "balances", "month", "year", "today", "yesterday", "last", "week", "financial", "with", "by", "please", "details", "detail", "report", "amount", "total", "outstanding", "purchase", "purchases", "returns", "return", "cancelled", "between", "stock", "current", "product", "products", "item", "items", "quantity", "qty", "available", "name", "which", "have", "has", "what"]);

function periodOf(question: string, fallback: Template["defaultPeriod"], session: MasterSession, today: Date): Period {
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const text = question.toLowerCase();
  const range = (from: Date, to: Date, label: string): Period => ({ from: iso(from), to: iso(to), label: `${label} (${dmy(from)} to ${dmy(to)})` });
  if (/all dates|all days|all time|whole period/.test(text)) return range(session.tarikh1, session.tarikh2, "All dates");
  if (/yesterday/.test(text)) { const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); return range(day, day, "Yesterday"); }
  // Weeks run Monday to Sunday: this week up to today, last week whole.
  const week = /(this|current|last|previous)\s+week|weekly/.exec(text);
  if (week) {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    if (week[1] === "last" || week[1] === "previous") return range(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7), new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1), "Last week");
    return range(monday, now, "This week");
  }
  // Quarters and half years of the financial year (it starts at the year's first day, April for most companies).
  const part = /(this|current|last|previous)?\s*(quarter|half[ -]?year)/.exec(text);
  if (part) {
    const months = part[2] === "quarter" ? 3 : 6;
    const start = session.tarikh1;
    const elapsed = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
    const index = Math.max(0, Math.floor(elapsed / months)) - (part[1] === "last" || part[1] === "previous" ? 1 : 0);
    if (index >= 0) {
      const from = new Date(start.getFullYear(), start.getMonth() + index * months, 1);
      const end = new Date(from.getFullYear(), from.getMonth() + months, 0);
      const label = `${part[1] === "last" || part[1] === "previous" ? "Last" : "This"} ${part[2] === "quarter" ? "quarter" : "half year"}`;
      return range(from, end > now ? now : end, label);
    }
  }
  // Months by name: "for July to September", "from April to June 2026", "in July" (the month of the financial year it falls in, or the year typed).
  const monthWord = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const named = new RegExp(`\\b(?:for|in|of|during|from|between)\\s+${monthWord}(?:\\s*(\\d{4}))?(?:\\s*(?:to|-|till|until|and|upto|up to)\\s*${monthWord}(?:\\s*(\\d{4}))?)?\\b`).exec(text);
  if (named) {
    const monthOf = (word: string) => MONTH_NAMES.indexOf(word.slice(0, 3));
    const start = session.tarikh1;
    const yearOf = (month: number, typed: string | undefined) => (typed ? Number(typed) : month >= start.getMonth() ? start.getFullYear() : start.getFullYear() + 1);
    const firstMonth = monthOf(named[1]);
    const fromYear = yearOf(firstMonth, named[2]);
    const lastMonth = named[3] ? monthOf(named[3]) : firstMonth;
    let toYear = named[3] ? yearOf(lastMonth, named[4]) : fromYear;
    if (named[3] && !named[4] && !named[2] && toYear < fromYear) toYear = fromYear;
    const from = new Date(fromYear, firstMonth, 1);
    const end = new Date(toYear, lastMonth + 1, 0);
    if (end >= from) return range(from, end > now ? now : end, `${MONTHS_SHORT[firstMonth]}-${fromYear}${named[3] ? ` to ${MONTHS_SHORT[lastMonth]}-${toYear}` : ""}`);
  }
  if (/last month|previous month/.test(text)) return range(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0), "Last month");
  if (/this month|current month|month to date|monthly/.test(text)) return range(new Date(now.getFullYear(), now.getMonth(), 1), now, "This month");
  if (/this year|financial year|fy\b|year to date|ytd|this fy|current year/.test(text)) return yearRange(session, now);
  if (/today|todays|today's|daily/.test(text)) return range(now, now, "Today");
  const days = /last\s+(\d+)\s*days?/.exec(text);
  if (days) return range(new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(days[1])), now, `Last ${days[1]} days`);
  if (fallback === "today") return range(now, now, "Today");
  if (fallback === "month") return range(new Date(now.getFullYear(), now.getMonth(), 1), now, "This month");
  return yearRange(session, now);
}

function yearRange(session: MasterSession, now: Date): Period {
  const from = session.tarikh1;
  const to = now < session.tarikh2 ? now : session.tarikh2;
  return { from: iso(from), to: iso(to), label: `This financial year (${dmy(from)} to ${dmy(to)})` };
}

/** The question's words that may be part of a name. */
function nameWords(question: string): string[] {
  return question.toLowerCase().replace(/[^a-z0-9\s.&-]/g, " ").split(/\s+/).filter((word) => word.length >= 2 && !STOP.has(word) && !/^\d+$/.test(word));
}

/** Words that say what is asked, never part of a party's name (so a name can be found inside a longer question). */
const NOT_NAME = new Set(["monthwise", "monthly", "month", "wise", "sale", "sales", "sold", "purchase", "purchases", "party", "parties", "customer", "customers", "supplier", "suppliers", "report", "statement", "ledger", "balance", "outstanding", "show", "give", "list", "total", "this", "year", "last", "week", "today", "details", "detail", "amount", "wise"]);

async function findParties(ctx: Omit<Ctx, "party">, question: string): Promise<Party[]> {
  const words = nameWords(question);
  if (words.length === 0) return [];
  const search = async (patterns: string[], joiner: "AND" | "OR") => {
    const likes = patterns.map((_, at) => `ac.name ILIKE $${at + 1}`).join(` ${joiner} `);
    const params = patterns.map((pattern) => `%${pattern.replace(/[%_]/g, "")}%`);
    return (await rows(ctx as Ctx, `SELECT ac.code, btrim(ac.name) AS name FROM ${ctx.sch}.account ac WHERE ac.a_pos <> 'D' AND (${likes}) ORDER BY (ac.book IN (2, 3)) DESC, ac.name LIMIT 8`, params)).map((row) => ({ code: num(row.code), name: String(row.name) }));
  };
  const all = await search(words, "AND");
  if (all.length > 0) return all;
  // The question carries other words too (monthwise sale of Mahavir Impex): the longest run of words that is part of a name is the party.
  const name = words.filter((word) => !NOT_NAME.has(word));
  for (let length = name.length; length >= 1; length -= 1) {
    for (let start = 0; start + length <= name.length; start += 1) {
      const run = name.slice(start, start + length);
      if (length === 1 && run[0].length < 4) continue;
      const hit = await search([run.join(" ")], "AND");
      if (hit.length > 0) return hit;
    }
  }
  return [];
}

/** The party help: accounts whose name has every word typed (customers and suppliers first); with nothing typed, the first customers and suppliers by name. */
/** What a party is being chosen for: the question's dates (this month, the quarter ...; none for a question that is not about a period) and the account book it is chosen from (customers or suppliers). */
export function partyScope(session: MasterSession, question: string, templateId: number): { period?: { from: string; to: string }; book?: number } {
  const template = T.find((candidate) => candidate.id === templateId);
  if (!template) return {};
  const real = new Date();
  const now = real > session.tarikh2 ? new Date(session.tarikh2) : real < session.tarikh1 ? new Date(session.tarikh1) : real;
  const period = template.defaultPeriod === "none" ? undefined : periodOf(question, template.defaultPeriod, session, now);
  return { ...(period ? { period: { from: period.from, to: period.to } } : {}), ...(template.partyBook ? { book: template.partyBook } : {}) };
}

/**
 * The party help: accounts whose name has every word typed (customers and suppliers first); with nothing typed, the first customers and suppliers by name. Only accounts with something to show:
 * with a period, one that has an entry in it or a balance (not nil) at its end; without one, a balance (opening or closing) in the open year or an entry in it.
 */
export async function searchParties(client: Client, session: MasterSession, term: string, period?: { from: string; to: string }, book?: number): Promise<Party[]> {
  const words = term.toLowerCase().split(/\s+/).map((word) => word.replace(/[%_]/g, "")).filter((word) => word !== "").slice(0, 6);
  const likes = words.map((_, at) => `ac.name ILIKE $${at + 1}`).join(" AND ");
  const sch = session.companySchema;
  const year = words.length + 1;
  const used = period
    ? ` AND (EXISTS (SELECT 1 FROM ${sch}.ledger l WHERE l.code = ac.code AND l.doc_pos <> 'D' AND l.doc_date >= $${year + 1}::date AND l.doc_date <= $${year + 2}::date)`
      + ` OR (COALESCE((SELECT ab.opening::numeric FROM ${sch}.ac_balance ab WHERE ab.code = ac.code AND ab.year_id = $${year} LIMIT 1), 0)`
      + ` + COALESCE((SELECT SUM(CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE -l.amount::numeric END) FROM ${sch}.ledger l WHERE l.code = ac.code AND l.doc_pos <> 'D' AND l.doc_posting = 'P' AND l.doc_date <= $${year + 2}::date), 0)) <> 0)`
    : ` AND (EXISTS (SELECT 1 FROM ${sch}.ledger l WHERE l.code = ac.code AND l.doc_pos <> 'D') OR EXISTS (SELECT 1 FROM ${sch}.ac_balance ab WHERE ab.code = ac.code AND ab.year_id = $${year} AND (ab.closing::numeric <> 0 OR ab.opening::numeric <> 0)))`;
  const found = (await client.query(
    `SELECT ac.code, btrim(ac.name) AS name, btrim(COALESCE(bp.book_desc, '')) AS hint FROM ${sch}.account ac LEFT JOIN ${sch}.book_properties bp ON bp.book_key = ac.book WHERE ac.a_pos <> 'D' AND ${likes === "" ? (book ? `ac.book = ${Number(book)}` : "ac.book IN (2, 3)") : `${likes}${book ? ` AND ac.book = ${Number(book)}` : ""}`}${used} ORDER BY (ac.book IN (2, 3)) DESC, ac.name, ac.code LIMIT 3000`,
    [...words.map((word) => `%${word}%`), session.yearId, ...(period ? [period.from, period.to] : [])])).rows as Record<string, unknown>[];
  return found.map((row) => ({ code: num(row.code), name: String(row.name), hint: String(row.hint ?? "") }));
}

/** The product help: products whose description has every word typed; with nothing typed, the first products by name. */
export async function searchProducts(client: Client, session: MasterSession, term: string): Promise<Party[]> {
  const words = term.toLowerCase().split(/\s+/).map((word) => word.replace(/[%_]/g, "")).filter((word) => word !== "").slice(0, 6);
  const likes = words.map((_, at) => `pm.prod_desc ILIKE $${at + 1}`).join(" AND ");
  const found = (await client.query(`SELECT pm.prod_key AS code, btrim(pm.prod_desc) AS name FROM ${session.companySchema}.product_master pm WHERE pm.prod_pos <> 'D'${likes === "" ? "" : ` AND ${likes}`} ORDER BY pm.prod_desc LIMIT 30`, words.map((word) => `%${word}%`))).rows as Record<string, unknown>[];
  return found.map((row) => ({ code: num(row.code), name: String(row.name) }));
}

async function findProducts(ctx: Omit<Ctx, "party">, question: string): Promise<Party[]> {
  const words = nameWords(question);
  if (words.length === 0) return [];
  return searchProducts(ctx.client, ctx.session, words.join(" ")).then((list) => list.slice(0, 8));
}

export function questionList(): { id: number; question: string }[] {
  return [...T].sort((a, b) => a.id - b.id).map((template) => ({ id: template.id, question: template.question }));
}

function matchTemplate(question: string): Template | null {
  const text = question.toLowerCase();
  let best: Template | null = null;
  let bestScore = 0;
  for (const template of T) {
    if (!template.terms.every((term) => term.test(text))) continue;
    if (template.not?.some((term) => term.test(text))) continue;
    const score = template.terms.length * 10 + (template.not?.length ?? 0);
    if (score > bestScore) { best = template; bestScore = score; }
  }
  return best;
}

function nearest(question: string): string[] {
  const words = new Set(nameWords(question).concat(question.toLowerCase().split(/\W+/).filter((word) => word.length > 3)));
  return [...T].map((template) => ({ template, hits: template.question.toLowerCase().split(/\W+/).filter((word) => word.length > 3 && words.has(word)).length }))
    .sort((a, b) => b.hits - a.hits || a.template.id - b.template.id).slice(0, 5).map((entry) => entry.template.question);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pivot of any report: "pivot register with month as column, amount as value and particulars as row"

const PIVOT_ID = 900;
const PIVOT_NOISE = new Set(["pivot", "report", "reports", "show", "display", "give", "make", "create", "open", "view", "a", "an", "the", "me", "my", "of", "in", "for", "with", "and", "as", "on", "to", "table", "please", "want", "i", "need", "get", "prepare", "using", "use", "take", "keep", "put", "where", "having", "into", "pivoted"]);
const AGGREGATE_WORDS: Readonly<Record<string, PivotAggregate>> = { sum: "sum", total: "sum", count: "count", number: "count", average: "average", avg: "average", mean: "average", max: "max", maximum: "max", highest: "max", min: "min", minimum: "min", lowest: "min" };
const singular = (word: string) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);

/** Reports that take one account only (their selection refuses more): none now, Multi Year Party Wise Stock takes any number. */
const SINGLE_ACCOUNT_REPORTS: ReadonlySet<number> = new Set<number>();

/**
 * The report (menu row of REPORT type) whose name is in the question: every word of its name in the question, or its name run together
 * ("partywise stock" for "Party Wise Stock"), the longest name winning. Where several reports have the same name the one that runs for all
 * parties is taken before the one that takes a single account.
 */
async function pivotReport(client: Client, session: MasterSession, question: string): Promise<{ node: MenuNode; words: Set<string>; single: boolean } | null> {
  const asked = new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== "").map(singular));
  const compact = question.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const reports: MenuNode[] = [];
  const walk = (list: readonly MenuNode[]) => { for (const node of list) { if (node.actionCode?.toUpperCase() === "REPORT" && node.actionMenu) reports.push(node); walk(node.children); } };
  walk(await readMenuCatalog(session.companyGroup));
  const found: { node: MenuNode; words: Set<string>; size: number }[] = [];
  for (const node of reports) {
    const parts = node.label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== "" && word !== "report" && word !== "reports");
    const words = new Set(parts.map(singular));
    const joined = parts.join("");
    if (words.size === 0) continue;
    const byWords = [...words].every((word) => asked.has(word));
    const byJoined = joined.length >= 4 && compact.includes(joined);
    if (!byWords && !byJoined) continue;
    // The words of the question that are only part of the name run together (party, wise, stock) are the report's, not fields.
    for (const word of asked) if (word.length >= 3 && joined.includes(word)) words.add(word);
    found.push({ node, words, size: joined.length });
  }
  if (found.length === 0) return null;
  const top = Math.max(...found.map((entry) => entry.size));
  const best = found.filter((entry) => entry.size === top);
  const keys = new Map<string, number>();
  const named = (await client.query(`SELECT BTRIM(report_name) AS name, report_key FROM ${SETUP_SCHEMA}.report_properties WHERE BTRIM(report_name) = ANY($1::text[])`, [best.map((entry) => entry.node.actionMenu)])).rows as { name: string; report_key: number }[];
  for (const row of named) keys.set(row.name, Number(row.report_key));
  const single = (entry: { node: MenuNode }) => SINGLE_ACCOUNT_REPORTS.has(keys.get(entry.node.actionMenu ?? "") ?? 0);
  const chosen = best.find((entry) => !single(entry)) ?? best[0];
  return { node: chosen.node, words: chosen.words, single: single(chosen) };
}

/** "for Aashka Agency": the party the question names, looked up among the accounts (one exact or only match), or the full names to pick from. */
async function pivotParty(client: Client, session: MasterSession, question: string): Promise<{ party?: { code: number; name: string }; ask?: string[] }> {
  const phrase = /\bfor\s+([a-z0-9][a-z0-9 .&'()-]*?)(?=\s+(?:with|and|as)\b|,|$)/i.exec(question)?.[1]?.trim() ?? "";
  if (phrase.length < 2) return {};
  const list = await searchParties(client, session, phrase);
  const exact = list.filter((candidate) => candidate.name.toLowerCase() === phrase.toLowerCase());
  const pick = exact.length === 1 ? exact[0] : list.length === 1 ? list[0] : null;
  if (pick) return { party: { code: pick.code, name: pick.name } };
  return list.length > 1 ? { ask: list.slice(0, 8).map((candidate) => question.replace(phrase, candidate.name)) } : {};
}

/** What goes in Rows, Columns and Values, read from "X as row", "Y as column(s)", "sum of Z as value" in any order. */
function pivotHintOf(question: string, reportWords: ReadonlySet<string>): PivotHint {
  const text = question.toLowerCase().replace(/[^a-z0-9\s,&/.-]/g, " ");
  const marker = /\b(?:as|in|on|into)\s+(?:an?\s+|the\s+)?(rows?|columns?|cols?|values?)\b/g;
  const rows: string[] = [];
  const columns: string[] = [];
  const values: { name: string; aggregate: PivotAggregate }[] = [];
  let from = 0;
  for (const match of text.matchAll(marker)) {
    const segment = text.slice(from, match.index);
    from = (match.index ?? 0) + match[0].length;
    const kind = match[1].startsWith("row") ? "rows" : match[1].startsWith("col") ? "columns" : "values";
    const afterWith = segment.split(/\bwith\b/).pop() ?? "";
    for (const piece of afterWith.split(/,|\band\b|&/)) {
      let aggregate = "sum" as PivotAggregate;
      const words = piece.split(/\s+/).filter((word) => {
        if (word === "" || PIVOT_NOISE.has(word) || reportWords.has(singular(word))) return false;
        if (kind === "values" && AGGREGATE_WORDS[word]) { aggregate = AGGREGATE_WORDS[word]; return false; }
        return true;
      });
      const name = words.join(" ");
      if (name === "" && !(kind === "values" && aggregate === "count")) continue;
      if (kind === "rows") rows.push(name); else if (kind === "columns") columns.push(name); else values.push({ name: name === "" ? "rows" : name, aggregate });
    }
  }
  return { rows, columns, values };
}

const SUMIF_ID = 901;
/** "sumif ...", "count of x where ...", "sum of amount in purchase register where ...". */
const SUMIF_ASK = /\b(?:sum|count|average)\s*ifs?\b|\b(?:sum|total|count|average|avg|max|min)\s+of\b.+?\b(?:where|if|when)\b/i;
const SUMIF_NOISE = new Set([...PIVOT_NOISE, "sumif", "sumifs", "countif", "countifs", "averageif", "sum", "if", "from", "sheet", "rows", "row"]);
const OPERATORS: readonly (readonly [RegExp, SumifOperator])[] = [
  [/^(?:>=|at least)$/i, "ge"], [/^(?:<=|at most)$/i, "le"], [/^(?:!=|<>|is not|isn't|not equal to|not)$/i, "ne"], [/^(?:>|greater than|more than|above)$/i, "gt"], [/^(?:<|less than|below)$/i, "lt"],
  [/^(?:contains?|like|starts with)$/i, "contains"], [/^(?:=|==|:|is|is equal to|equals?|equal to)$/i, "eq"],
];

/** What to total, how, and the conditions: "sum of amount in purchase register where particulars = Jain Sales and month is april". */
function sumifHintOf(question: string, reportWords: ReadonlySet<string>): SumifHint | null {
  const text = question.replace(/\s+/g, " ").trim();
  const split = /\b(where|if|when)\b/i.exec(text);
  if (!split) return null;
  const head = text.slice(0, split.index).toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tail = text.slice(split.index + split[0].length).trim();
  let aggregate = "sum" as PivotAggregate;
  if (/\bcountifs?\b/.test(head)) aggregate = "count";
  else if (/\baverageif/.test(head)) aggregate = "average";
  const words = head.split(/\s+/).filter((word) => {
    if (word === "" || SUMIF_NOISE.has(word) || reportWords.has(singular(word))) return false;
    if (AGGREGATE_WORDS[word]) { aggregate = AGGREGATE_WORDS[word]; return false; }
    return true;
  });
  const name = words.join(" ");
  const conditions: { field: string; op: SumifOperator; text: string }[] = [];
  // "and" and "," separate two conditions only where what follows is another "field = value".
  const pieces = tail.split(/(?:\s+and\s+|\s*[,;]\s*)(?=[a-z][a-z ]*?\s*(?:=|>|<|:|\b(?:is|contains?|like|equals?|equal to|greater|less|more|above|below|not)\b))/i);
  for (const raw of pieces) {
    const piece = raw.trim().replace(/[.\s]+$/, "");
    const symbol = /^(.+?)\s*(>=|<=|!=|<>|==|=|>|<|:)\s*(.+)$/.exec(piece);
    const word = symbol ?? /^(.+?)\s+(is not|isn't|not equal to|is equal to|equal to|equals?|is|contains?|like|starts with|greater than|more than|above|less than|below|at least|at most)\s+(.+)$/i.exec(piece);
    if (!word) continue;
    const op = OPERATORS.find(([pattern]) => pattern.test(word[2].trim()))?.[1];
    const field = word[1].toLowerCase().replace(/^(?:the|a|an)\s+/, "").trim();
    const value = word[3].trim().replace(/^["'“‘]|["'”’]$/g, "");
    if (op && field !== "" && value !== "") conditions.push({ field, op, text: value });
  }
  if (conditions.length === 0 || (name === "" && aggregate !== "count")) return null;
  return { value: { name: name === "" ? "rows" : name, aggregate }, conditions };
}

/** "pivot ..." : opens the named report with the pivot set up (null when the question is not a pivot request). */
async function pivotReply(client: Client, session: MasterSession, question: string): Promise<AskReply | null> {
  const wantsPivot = /\bpivot/i.test(question);
  if (!wantsPivot && !SUMIF_ASK.test(question)) return null;
  const found = await pivotReport(client, session, question);
  // A "total of ... where ..." that names no report is left to the questions Ask AI already knows.
  if (!found && !wantsPivot) return null;
  const how = "Name the report and what goes where, for example: pivot register report with month as column, amount as value and particulars as row.";
  if (!found) return { kind: "refuse", message: `I could not find which report to pivot. ${how}`, suggestions: [] };
  const named = await pivotParty(client, session, question);
  if (named.ask) return { kind: "refuse", message: "Which party? Pick one of these.", suggestions: named.ask };
  if (found.single && !named.party) return { kind: "refuse", message: `${found.node.label} takes one party at a time. Add the party, for example: ${question.replace(/[.\s]+$/, "")} for <party name>.`, suggestions: [] };
  if (!wantsPivot) {
    const sumif = sumifHintOf(question, found.words);
    const how = "Say what to total and the condition, for example: sum of amount in purchase register where particulars = Jain Sales Corporation and month is april.";
    if (!sumif) return { kind: "refuse", message: `I need what to total and at least one condition ("where field = value"). ${how}`, suggestions: [] };
    const label = { sum: "Sum", count: "Count", average: "Average", min: "Min", max: "Max" }[sumif.value.aggregate];
    const note = `Opens ${found.node.label} and works out: ${label} of ${sumif.value.name} where ${sumif.conditions.map((condition) => `${condition.field} ${condition.op === "eq" ? "=" : condition.op} ${condition.text}`).join(" and ")}.${named.party ? ` Party: ${named.party.name}.` : ""} The answer is worked out on the report's rows once it has run; the names are matched to the report's columns.`;
    return { kind: "answer", answer: { id: SUMIF_ID, title: `${label}If: ${found.node.label}`, columns: [text("item", "Item")], rows: [], note, report: { name: found.node.actionMenu as string, label: `Open ${found.node.label} and work it out`, sumif, pick: question, ...(named.party ? { party: named.party } : {}) } } };
  }
  const hint = pivotHintOf(question, found.words);
  if (hint.values.length === 0 || hint.rows.length + hint.columns.length === 0) return { kind: "refuse", message: `I need at least one field for Rows or Columns and one for Values. ${how}`, suggestions: [] };
  const names = (list: readonly string[]) => list.join(", ");
  const note = `Opens ${found.node.label} and sets up the pivot: ${hint.rows.length > 0 ? `Rows: ${names(hint.rows)}. ` : ""}${hint.columns.length > 0 ? `Columns: ${names(hint.columns)}. ` : ""}${named.party ? `Party: ${named.party.name}. ` : ""}Values: ${hint.values.map((value) => `${value.aggregate} of ${value.name}`).join(", ")}. The names are matched to the report's columns when it has run; the pivot panel can change them.`;
  return { kind: "answer", answer: { id: PIVOT_ID, title: `Pivot: ${found.node.label}`, columns: [text("item", "Item")], rows: [], note, report: { name: found.node.actionMenu as string, label: `Open ${found.node.label} as pivot`, pivot: hint, pick: question, ...(named.party ? { party: named.party } : {}) } } };
}

export async function ask(client: Client, session: MasterSession, input: { question?: string; detail?: string; templateId?: number; partyCode?: number; allParties?: boolean }): Promise<AskReply> {
  const question = String(input.question ?? "").trim().slice(0, 300);
  if (!input.templateId && !input.detail) {
    const pivot = await pivotReply(client, session, question);
    if (pivot) {
      if (pivot.kind !== "answer" || !pivot.answer.report) return pivot;
      // The dates the question named go to the report, as for any report that is opened.
      const real = new Date();
      const today = real > session.tarikh2 ? new Date(session.tarikh2) : real < session.tarikh1 ? new Date(session.tarikh1) : real;
      const named = reportDates(question, session, today);
      const answer = named ? { ...pivot.answer, report: { ...pivot.answer.report, from: named.from, to: named.to } } : pivot.answer;
      // Remembered like any answered question (recent and most asked); it is read again each time, so no template stands behind it.
      return { kind: "answer", answer, used: { templateId: answer.id } };
    }
  }
  const template = input.templateId ? T.find((candidate) => candidate.id === input.templateId) ?? null : matchTemplate(question);
  if (!template) return { kind: "refuse", message: "I do not have an answer for that question yet. Try one of these.", suggestions: nearest(question) };
  // "Today" is today, but never outside the open year: in a past year it is that year's last day (the year's database holds nothing later).
  const real = new Date();
  const now = real > session.tarikh2 ? new Date(session.tarikh2) : real < session.tarikh1 ? new Date(session.tarikh1) : real;
  const base: Omit<Ctx, "party"> = {
    client, sch: session.companySchema, session, question, today: iso(now), period: periodOf(question, template.defaultPeriod, session, now),
    top: Math.min(100, Math.max(1, Number(/top\s+(\d+)/i.exec(question)?.[1]) || 10)), days: Number(/(\d+)\s*days?/i.exec(question)?.[1]) || 90,
  };
  if (input.detail) {
    const answer = input.detail === "stock" ? await stockValue(base as Ctx, 34, "Products with stock", true) : (await summaryDetail(base as Ctx, input.detail)) ?? await outstandingParties(base as Ctx, input.detail);
    if (answer) return { kind: "answer", answer };
  }
  if (input.allParties && template.runAll) { const all = await template.runAll({ ...base, party: undefined }); return { kind: "answer", answer: template.defaultPeriod !== "none" && all.period === undefined ? { ...all, period: { from: base.period.from, to: base.period.to } } : all, used: { templateId: template.id } }; }
  let product: Party | undefined;
  if (template.needsProduct) {
    if (input.partyCode) {
      const row = (await rows(base as Ctx, `SELECT prod_key AS code, btrim(prod_desc) AS name FROM ${base.sch}.product_master WHERE prod_key = $1 AND prod_pos <> 'D'`, [input.partyCode]))[0];
      if (row) product = { code: num(row.code), name: String(row.name) };
    }
    if (!product) {
      const found = await findProducts(base, question);
      const exact = found.filter((candidate) => question.toLowerCase().includes(candidate.name.toLowerCase()));
      if (exact.length === 1) product = exact[0];
      else if (found.length === 1) product = found[0];
      else return { kind: "choose-party", what: "product", question, templateId: template.id, choices: found, allParties: false };
    }
  }
  let party: Party | undefined;
  if (template.needsParty) {
    if (input.partyCode) {
      const row = (await rows(base as Ctx, `SELECT code, btrim(name) AS name FROM ${base.sch}.account WHERE code = $1 AND a_pos <> 'D'`, [input.partyCode]))[0];
      if (row) party = { code: num(row.code), name: String(row.name) };
    }
    if (!party) {
      const found = await findParties(base, question);
      const exact = found.filter((candidate) => question.toLowerCase().includes(candidate.name.toLowerCase()));
      if (exact.length === 1) party = exact[0];
      else if (found.length === 1) party = found[0];
      else return { kind: "choose-party", what: "party", question, templateId: template.id, choices: found, allParties: template.runAll !== undefined };
    }
  }
  const result = await template.run({ ...base, party, product });
  const answered: AskAnswer = template.defaultPeriod !== "none" && result.period === undefined ? { ...result, period: { from: base.period.from, to: base.period.to } } : result;
  // A report that is opened takes the dates the question named.
  const named = answered.report ? reportDates(question, session, now) : null;
  const answer = answered.report && named ? { ...answered, report: { ...answered.report, from: named.from, to: named.to } } : answered;
  return { kind: "answer", answer, used: { templateId: template.id, ...(party || product ? { partyCode: (party ?? product)!.code } : {}) } };
}


const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthEnd = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/**
 * The dates a question names for a report that is opened (not worked out here): two dates ("01-apr/2025 and 30-apr/2025", "from 01/04/2025 to 30/04/2025"),
 * one date (the report up to it), a month and year ("april 2025"), or a period word (today, this week, last month, this quarter ...). A day past the end
 * of its month (31-apr) is taken as the month's last day. Null when the question names none (the report opens as it always does).
 */
function reportDates(question: string, session: MasterSession, now: Date): { from: string; to: string } | null {
  const text = question.toLowerCase();
  const day = (year: number, month: number, date: number) => iso(new Date(year, month, Math.min(date, monthEnd(year, month))));
  const found: string[] = [];
  const dates = /\b(\d{1,2})\s*[-\/.\s]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2})[a-z]*\s*[-\/.\s]\s*(\d{4})\b/g;
  for (let match = dates.exec(text); match; match = dates.exec(text)) {
    const month = /\d/.test(match[2]) ? Number(match[2]) - 1 : MONTH_NAMES.indexOf(match[2]);
    if (month >= 0 && month < 12) found.push(day(Number(match[3]), month, Number(match[1])));
  }
  if (found.length >= 2) { found.sort(); return { from: found[0], to: found[found.length - 1] }; }
  if (found.length === 1) return { from: iso(session.tarikh1), to: found[0] };
  const monthYear = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/,]*(\d{4})\b/.exec(text);
  if (monthYear) { const month = MONTH_NAMES.indexOf(monthYear[1]); const year = Number(monthYear[2]); return { from: iso(new Date(year, month, 1)), to: iso(new Date(year, month, monthEnd(year, month))) }; }
  if (/today|yesterday|(this|current|last|previous)\s+(week|month|quarter|half[ -]?year)|quarterly|half[ -]?yearly|monthly/.test(text)) {
    const period = periodOf(question, "none", session, now);
    return { from: period.from, to: period.to };
  }
  return null;
}

/** The id of the template this question matches now (0 when none). */
export const matchedId = (question: string): number => matchTemplate(question)?.id ?? 0;

/** Whether a template of this id is in the list (a remembered question may name one that has gone). */
export const hasTemplate = (id: number): boolean => T.some((template) => template.id === id);
