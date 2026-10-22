import type { Client } from "pg";
import { SYSTEM_SCHEMA, type MasterSession } from "../master-program/session";

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
  ledger?: Readonly<{ code: number; name: string }>;
  /** The answer is a report of the program: this button opens it (name is the report's menu action). */
  report?: Readonly<{ name: string; label: string }>;
}>;
export type AskReply =
  | Readonly<{ kind: "answer"; answer: AskAnswer }>
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
}>;

type Template = Readonly<{
  id: number;
  question: string;
  /** All of these must be found in the question. */
  terms: readonly RegExp[];
  /** None of these may be. */
  not?: readonly RegExp[];
  needsParty?: boolean;
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
type Bill = Readonly<{ code: number; name: string; doc: string; billDate: string; due: string; pending: number; overdueDays: number }>;

async function agewiseBills(ctx: Ctx): Promise<Bill[]> {
  const open = await rows(ctx,
    `SELECT ac.code, btrim(ac.name) AS name, COALESCE(ac.credit_days, 0)::int AS credit_days, o.out_key, o.out_fulldocno AS doc, led.doc_date AS bill_date, led.doc_no, to_char(led.doc_date, 'YYYYMMDD') AS sortdate,`
    + ` (o.out_entryamt::numeric - COALESCE(s.setoff, 0) - o.out_ly_setoff::numeric) AS pending`
    + ` FROM ${ctx.sch}.outclear o JOIN ${ctx.sch}.account ac ON ac.code = o.code JOIN ${ctx.sch}.ledger led ON led.led_key = o.out_ledid`
    + ` LEFT JOIN (SELECT out_ag_outid, SUM(out_setoff::numeric) AS setoff FROM ${ctx.sch}.outclear WHERE out_date <= $1::date GROUP BY out_ag_outid) s ON s.out_ag_outid = o.out_key`
    + ` WHERE o.out_dbcode = 1 AND ac.book = 2 AND ac.os_flag <> 'N' AND ac.a_pos <> 'D' AND led.doc_pos <> 'D' AND led.doc_date <= $1::date`
    + ` AND ((led.doc_posting = 'L' AND o.out_entryamt::numeric - o.out_ly_setoff::numeric <> 0) OR led.doc_posting <> 'L')`
    + ` AND (o.out_entryamt::numeric - COALESCE(s.setoff, 0) - o.out_ly_setoff::numeric) > 0`, [ctx.today]);
  const byParty = new Map<number, Record<string, unknown>[]>();
  for (const row of open) { const code = num(row.code); (byParty.get(code) ?? byParty.set(code, []).get(code)!).push(row); }
  const bal = new Map((await balances(ctx, 2, [...byParty.keys()])).map((row) => [row.code, row]));
  const today = new Date(`${ctx.today}T00:00:00`).getTime();
  const yearStart = new Date(ctx.session.tarikh1.getFullYear(), ctx.session.tarikh1.getMonth(), ctx.session.tarikh1.getDate());
  const out: Bill[] = [];
  for (const [code, list] of byParty) {
    const party = bal.get(code);
    if (!party) continue;
    let left = party.closing;
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
      out.push({ code, name: party.name, doc: String(bill.doc ?? ""), billDate: dmy(when), due: dmy(due), pending: Math.round(take * 100) / 100, overdueDays: days });
      left = Math.round((left - take) * 100) / 100;
    }
    if (left > 0) { const { due, days } = dueOf(yearStart); out.push({ code, name: party.name, doc: "Opening", billDate: dmy(yearStart), due: dmy(due), pending: left, overdueDays: days }); }
  }
  return out;
}

const dueColumns = [text("name", "Customer"), text("doc", "Bill"), date("billDate", "Bill Date"), date("due", "Due Date"), money("pending", "Pending"), int("overdueDays", "Days Overdue")];
const grouping = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grandTotal = (list: readonly Bill[]) => grouping.format(list.reduce((sum, bill) => sum + bill.pending, 0));

T.push({
  id: 7, question: "Which bills are overdue by more than 90 days?", defaultPeriod: "none",
  terms: [/overdue|over due|past due/, /\d+\s*days?|more than/],
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
  id: 5, question: "Show customer ledger for this month.", defaultPeriod: "month", needsParty: true, terms: [/ledger|statement/],
  run: async (ctx) => {
    const party = ctx.party as Party;
    const found = await rows(ctx,
      `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(bk.name) AS book, btrim(COALESCE(l.narration, '')) AS narration, CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE 0 END AS debit,`
      + ` CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric ELSE 0 END AS credit FROM ${ctx.sch}.ledger l LEFT JOIN ${ctx.sch}.account bk ON bk.code = l.book_code`
      + ` WHERE l.code = $1 AND l.doc_pos = 'A' AND l.doc_date >= $2::date AND l.doc_date <= $3::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [party.code, ctx.period.from, ctx.period.to]);
    return {
      id: 5, title: `Ledger of ${party.name}`, columns: [date("d", "Date"), text("doc", "Document"), text("book", "Book"), text("narration", "Narration"), money("debit", "Debit"), money("credit", "Credit")],
      rows: found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), book: String(row.book ?? ""), narration: String(row.narration ?? ""), debit: num(row.debit), credit: num(row.credit) })),
      note: `${ctx.period.label}. The ledger report shows the opening balance and the running balance.`, ledger: party,
    };
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

const SALES_NOTE = "Sales before tax, as the company counts them: Sale book entries and debit notes against it, less credit notes (returns) against it.";
const salesColumns = [money("sales", "Sales"), money("returns", "Less: Returns"), money("net", "Net Sales")];

async function bookTotal(ctx: Ctx, book: number, from: string, to: string) {
  const r = (await rows(ctx, `SELECT COUNT(*) AS n, COALESCE(SUM(amount::numeric), 0) AS total FROM ${ctx.sch}.ledger WHERE book = $1 AND doc_pos = 'A' AND doc_date >= $2::date AND doc_date <= $3::date`, [book, from, to]))[0];
  return { n: num(r.n), total: num(r.total) };
}

T.push({
  id: 11, question: "What are today's total sales?", defaultPeriod: "today", terms: [/sales?|sold|selling/, /total|how much|what/], not: [/compar|versus|\bvs\b|invoice|party|customer|product|return|cancel|profit|highest|most/],
  run: async (ctx) => {
    const t = (await netSales(ctx, ctx.period.from, ctx.period.to, false))[0];
    return { id: 11, title: "Total sales", columns: [text("item", "Item"), money("value", "Value")], rows: [{ item: "Entries", value: t.entries }, { item: "Sales (before tax)", value: t.sales }, { item: "Less: returns", value: -t.returns }, { item: "Net sales", value: t.net }], note: `${ctx.period.label}. ${SALES_NOTE}` };
  },
});

T.push({
  id: 15, question: "What are my total purchases this month?", defaultPeriod: "month", terms: [/purchase|purchases|bought|buying/], not: [/return|product|supplier|party/],
  run: async (ctx) => { const t = await bookTotal(ctx, PURCHASE, ctx.period.from, ctx.period.to); return { id: 15, title: "Total purchases", columns: [text("item", "Item"), money("value", "Value")], rows: [{ item: "Bills", value: t.n }, { item: "Total purchases", value: t.total }], note: `${ctx.period.label}, bill totals (tax included).` }; },
});

T.push({
  id: 12, question: "Show monthly sales compared with last month.", defaultPeriod: "none", terms: [/sales?/, /compar|versus|\bvs\b|last month|previous month/], not: [/year|last year/],
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
  id: 17, question: "Find sales invoices for a particular party.", defaultPeriod: "year", needsParty: true, terms: [/invoices?|bills?|sales?/], not: [/cancel/],
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
  id: 13, question: "Which customer purchased the most this year?", defaultPeriod: "year", terms: [/customers?|party|parties/, /most|top|highest|biggest|largest|best/, /purchas|bought|sale|sales|buy|revenue/], not: [/revenue|contribut|share|profit|outstanding|overdue/],
  run: async (ctx) => {
    const list = (await netSales(ctx, ctx.period.from, ctx.period.to, true)).sort((x, y) => y.net - x.net).slice(0, Math.max(ctx.top, 10));
    return { id: 13, title: "Customers by purchases", columns: [int("no", "No."), text("name", "Customer"), int("entries", "Entries"), ...salesColumns], rows: list.map((row, at) => ({ no: at + 1, name: row.name, entries: row.entries, sales: row.sales, returns: -row.returns, net: row.net, code: row.code })), note: `${ctx.period.label}. ${SALES_NOTE}` };
  },
});

T.push({
  id: 19, question: "Which products have the highest sales?", defaultPeriod: "year", terms: [/products?|items?/, /sales?|sold|selling|highest|top|best/], not: [/stock|negative|minimum|zero|slow|fast|godown|purchase|no sales?|not sold|unsold|without sales?|moving/],
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
    `WITH ${STOCK_CTE(ctx.sch, "$3")}, ${COST_CTES(ctx.sch, "$2", "$1", "$3")} SELECT btrim(pm.prod_desc) AS name, stk.cq, avgc.cost, stk.cq * avgc.cost AS value`
    + ` FROM stk JOIN ${ctx.sch}.product_master pm ON pm.prod_key = stk.prod_id LEFT JOIN avgc ON avgc.prod_id = stk.prod_id WHERE pm.prod_pos <> 'D' AND stk.cq > 0`,
    [ctx.today, iso(ctx.session.tarikh1), ctx.session.yearId]);
  const valued = found.filter((row) => row.value !== null);
  const total = valued.reduce((sum, row) => sum + num(row.value), 0);
  const without = found.length - valued.length;
  const top = valued.sort((a, b) => num(b.value) - num(a.value)).slice(0, 200).map((row) => ({ name: String(row.name), cq: num(row.cq), cost: num(row.cost), value: num(row.value) }));
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

T.push({
  id: 36, question: "Show product-wise sales and purchase quantities.", defaultPeriod: "year", terms: [/product|item/, /sales?|sold/, /purchas|bought/],
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

async function cashEntries(ctx: Ctx, id: number, title: string, side: 1 | 2, books: string): Promise<AskAnswer> {
  const found = await rows(ctx,
    `SELECT l.doc_date AS d, l.full_docno AS doc, btrim(COALESCE(ac.name, '')) AS party, btrim(COALESCE(bk.name, '')) AS book, l.amount::numeric AS amount FROM ${ctx.sch}.ledger l`
    + ` LEFT JOIN ${ctx.sch}.account ac ON ac.code = l.code LEFT JOIN ${ctx.sch}.account bk ON bk.code = l.book_code WHERE l.book IN (${books}) AND l.doc_pos = 'A' AND l.ac_dbcode = $3`
    + ` AND l.doc_date >= $1::date AND l.doc_date <= $2::date ORDER BY l.doc_date, l.led_key LIMIT 1000`, [ctx.period.from, ctx.period.to, side]);
  const out = found.map((row) => ({ d: dmy(row.d), doc: String(row.doc ?? ""), party: String(row.party), book: String(row.book), amount: num(row.amount) }));
  return {
    id, title, columns: [date("d", "Date"), text("doc", "Document"), text("party", "Party"), text("book", "Book"), money("amount", "Amount")],
    rows: out.length === 0 ? [] : [...out, { d: "", doc: "", party: `Total (${out.length})`, book: "", amount: out.reduce((sum, row) => sum + row.amount, 0) }], note: `${ctx.period.label}: cash and bank book entries.`,
  };
}

T.push({ id: 43, question: "How much money did we receive today?", defaultPeriod: "today", terms: [/receive|received|receipts?|collection|collected/], not: [/payment|paid|overdue|outstanding|customers?|invoice|cheque|bill/], run: (ctx) => cashEntries(ctx, 43, "Money received", 2, "4, 6") });
T.push({ id: 44, question: "Show today's payments.", defaultPeriod: "today", terms: [/payments?|paid|pay out|paid out/], not: [/receipt|received|overdue|outstanding|cheque|salary|supplier|customers?|due|pending/], run: (ctx) => cashEntries(ctx, 44, "Payments made", 1, "4, 6") });

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
    return { id: 46, title: "Expenses that increased compared with last month", columns: [text("name", "Party"), money("last", "Last Month"), money("current", "This Month"), money("increase", "Increase")], rows: found.map((row) => ({ name: String(row.name), last: num(row.last_month), current: num(row.this_month), increase: num(row.this_month) - num(row.last_month) })), note: `${dmy(thisFrom)} to ${dmy(ctx.today)} against ${dmy(lastFrom)} to ${dmy(lastTo)}: the Expense book's entries by party.` };
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
T.push({ id: 53, question: "Show the profit and loss account.", defaultPeriod: "none", terms: [/profit/, /loss/, /account|statement|p ?& ?l|and loss/], not: [/customer|party|product|each|net profit/], run: async () => openReport(53, "Profit and loss account", "REPORT_PROFIT_LOSS", "Open Profit / Loss", "Open the Profit / Loss report and press Show.") });
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
      id: 60, title: "Business summary", choices: ["This month", "Last month", "This quarter", "Last quarter", "This half year", "Last half year", "This year"].map((label) => ({ label, question: `Summarize my business performance ${label.toLowerCase()}.` })), columns: [text("item", "Item"), money("value", "Value")],
      rows: [{ item: "Net sales (before tax)", value: sales.net, detail: "sales" }, { item: "Sales entries", value: sales.entries, detail: "sales" }, { item: "Purchases (with tax)", value: purchases.total, detail: "purchase" }, { item: "Money received (cash and bank)", value: num(flows.received), detail: "received" }, { item: "Money paid (cash and bank)", value: num(flows.paid), detail: "paid" },
        { item: "Expenses (with tax)", value: num(flows.expenses), detail: "expenses" }, { item: "Customers owe (as on today)", value: receivable, detail: "owe:2" }, { item: "Owed to suppliers (as on today)", value: payable, detail: "owe:3" }],
      note: `${ctx.period.label}. ${SALES_NOTE} Click a line to show what it is made of, click again to hide it.`,
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
  if (/yesterday/.test(text)) { const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); return range(day, day, "Yesterday"); }
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

async function findParties(ctx: Omit<Ctx, "party">, question: string): Promise<Party[]> {
  const words = nameWords(question);
  if (words.length === 0) return [];
  const likes = words.map((_, at) => `ac.name ILIKE $${at + 1}`).join(" AND ");
  const params = words.map((word) => `%${word.replace(/[%_]/g, "")}%`);
  const best = (await rows(ctx as Ctx, `SELECT ac.code, btrim(ac.name) AS name FROM ${ctx.sch}.account ac WHERE ac.a_pos <> 'D' AND ${likes} ORDER BY (ac.book IN (2, 3)) DESC, ac.name LIMIT 8`, params));
  return best.map((row) => ({ code: num(row.code), name: String(row.name) }));
}

/** The party help: accounts whose name has every word typed (customers and suppliers first); with nothing typed, the first customers and suppliers by name. */
export async function searchParties(client: Client, session: MasterSession, term: string): Promise<Party[]> {
  const words = term.toLowerCase().split(/\s+/).map((word) => word.replace(/[%_]/g, "")).filter((word) => word !== "").slice(0, 6);
  const likes = words.map((_, at) => `ac.name ILIKE $${at + 1}`).join(" AND ");
  const found = (await client.query(
    `SELECT ac.code, btrim(ac.name) AS name, btrim(COALESCE(bp.book_desc, '')) AS hint FROM ${session.companySchema}.account ac LEFT JOIN ${session.companySchema}.book_properties bp ON bp.book_key = ac.book WHERE ac.a_pos <> 'D' AND ${likes === "" ? "ac.book IN (2, 3)" : likes} ORDER BY (ac.book IN (2, 3)) DESC, ac.name, ac.code LIMIT 30`,
    words.map((word) => `%${word}%`))).rows as Record<string, unknown>[];
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

export async function ask(client: Client, session: MasterSession, input: { question?: string; detail?: string; templateId?: number; partyCode?: number; allParties?: boolean }): Promise<AskReply> {
  const question = String(input.question ?? "").trim().slice(0, 300);
  const template = input.templateId ? T.find((candidate) => candidate.id === input.templateId) ?? null : matchTemplate(question);
  if (!template) return { kind: "refuse", message: "I do not have an answer for that question yet. Try one of these.", suggestions: nearest(question) };
  const now = new Date();
  const base: Omit<Ctx, "party"> = {
    client, sch: session.companySchema, session, today: iso(now), period: periodOf(question, template.defaultPeriod, session, now),
    top: Math.min(100, Math.max(1, Number(/top\s+(\d+)/i.exec(question)?.[1]) || 10)), days: Number(/(\d+)\s*days?/i.exec(question)?.[1]) || 90,
  };
  if (input.detail) {
    const answer = input.detail === "stock" ? await stockValue(base as Ctx, 34, "Products with stock", true) : (await summaryDetail(base as Ctx, input.detail)) ?? await outstandingParties(base as Ctx, input.detail);
    if (answer) return { kind: "answer", answer };
  }
  if (input.allParties && template.runAll) return { kind: "answer", answer: await template.runAll({ ...base, party: undefined }) };
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
  return { kind: "answer", answer: await template.run({ ...base, party, product }) };
}
