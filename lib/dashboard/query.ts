import type { Loader } from "../master-program/load";
import { toDecimal, toText } from "../master-program/legacy";
import { companyYears } from "../yearchart/query";

/**
 * The Dashboard's data (the desktop's Dashboard form, run for Report > Dashboard and for Analysis > Multi Year > Yearly Dashboard):
 * five charts (Sales, Purchase, Bank/Cash Receipt, Bank/Cash Payment, Expense) by month within the period, or, yearly, one bar for each
 * year of the company; today's figure for each; the five balances as on today (Outstanding Receivable / Payable, Expense Payable,
 * Cash and Bank Balance); and the lists behind a bar or a balance.
 */

export const DASH_KINDS = ["sale", "purchase", "receipt", "payment", "expense"] as const;
export type DashKind = (typeof DASH_KINDS)[number];
export const DASH_BALANCES = ["receivable", "payable", "expensepayable", "cash", "bank"] as const;
export type DashBalance = (typeof DASH_BALANCES)[number];

export type DashPoint = Readonly<{ label: string; month: number; value: number }>;
export type DashData = Readonly<{
  yearly: boolean;
  series: Record<DashKind, DashPoint[]>;
  today: Record<DashKind, number> | null;
  balances: Record<DashBalance, number> | null;
}>;
export type DashTable = Readonly<{ columns: { name: string; text: string; numeric: boolean }[]; rows: Record<string, string | number>[] }>;

/** What a chart adds up, in a year's schema: the rows (FROM / WHERE), the amount, the date it is cut by and the date its month is read from. */
function chartSource(kind: DashKind, schema: string, typed: boolean): { from: string; where: string; measure: string; dateColumn: string; monthColumn: string } {
  const posts = `${schema}.ledger_post lp LEFT JOIN ${schema}.ledger led ON lp.led_id=led.led_key LEFT JOIN ${schema}.account ac ON lp.post_code=ac.code LEFT JOIN ${schema}.balsheet bal ON bal.bs_key=ac.bs_id`;
  const posted = "led.doc_pos<>'D' AND led.doc_posting='P'";
  switch (kind) {
    case "sale": return { from: posts, where: `ac.a_pos<>'D' AND ac.book=8 AND left(bal.bs_code,2)='01' AND ${posted}`, measure: "CASE WHEN lp.post_dbcode=2 THEN lp.post_amt::numeric ELSE lp.post_amt::numeric * -1 END", dateColumn: "lp.post_date", monthColumn: "led.doc_date" };
    case "purchase": return { from: posts, where: `ac.a_pos<>'D' AND ac.book=13 AND left(bal.bs_code,2)='01' AND ${posted}`, measure: "CASE WHEN lp.post_dbcode=1 THEN lp.post_amt::numeric ELSE lp.post_amt::numeric * -1 END", dateColumn: "lp.post_date", monthColumn: "led.doc_date" };
    case "expense": return { from: posts, where: `ac.a_pos<>'D' AND lp.post_dbcode=1 AND ac.book=1 AND left(bal.bs_code,2)='02' AND ${posted}`, measure: "lp.post_amt::numeric", dateColumn: "lp.post_date", monthColumn: "led.doc_date" };
    case "receipt": return { from: `${schema}.ledger led`, where: `led.book IN (4,6) AND led.doc_pos<>'D' AND led.doc_posting='P' AND led.ac_dbcode=2${typed ? " AND led.type=0" : ""}`, measure: "led.amount::numeric", dateColumn: "led.doc_date", monthColumn: "led.doc_date" };
    case "payment": return { from: `${schema}.ledger led`, where: `led.book IN (4,6) AND led.doc_pos<>'D' AND led.doc_posting='P' AND led.ac_dbcode=1${typed ? " AND led.type=0" : ""}`, measure: "led.amount::numeric", dateColumn: "led.doc_date", monthColumn: "led.doc_date" };
  }
}

/** LEDGER.TYPE (0: an ordinary voucher) exists only in some installations' databases. */
async function hasType(client: Loader["client"], schema: string): Promise<boolean> {
  return ((await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'ledger' AND column_name = 'type'", [schema])).rowCount ?? 0) > 0;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FISCAL = (column: string) => `CASE WHEN ${column} >= 4 THEN ${column} - 3 ELSE ${column} + 9 END`;

/** The balance of the accounts of these books (opening + debits - credits), as on today. */
function balanceSql(schema: string, books: string, posting: boolean, extra = "") {
  return `SELECT ac.code, ac.name, (coalesce(acb.opening,0) + coalesce(dc.debit,0) - coalesce(dc.credit,0))::numeric(20,2) AS closing FROM ${schema}.account ac`
    + ` LEFT JOIN (SELECT code, sum(opening::numeric) AS opening FROM ${schema}.ac_balance GROUP BY code) acb ON acb.code=ac.code`
    + ` LEFT JOIN (SELECT lp.post_code, sum(CASE WHEN lp.post_dbcode=1 THEN lp.post_amt::numeric ELSE 0 END) AS debit, sum(CASE WHEN lp.post_dbcode=2 THEN lp.post_amt::numeric ELSE 0 END) AS credit`
    + ` FROM ${schema}.ledger led LEFT JOIN ${schema}.ledger_post lp ON lp.led_id=led.led_key WHERE led.doc_pos<>'D' AND led.doc_posting='P' GROUP BY lp.post_code) dc ON dc.post_code=ac.code`
    + ` WHERE ac.a_pos<>'D'${posting ? " AND ac.a_posting<>'N'" : ""} AND ${books}${extra}`;
}
const BALANCE_WHERE: Record<DashBalance, { books: string; posting: boolean; extra?: string; title: string }> = {
  receivable: { books: "ac.book=2", posting: true, title: "Outstanding Receivable" },
  payable: { books: "ac.book=3", posting: true, title: "Outstanding Payable" },
  expensepayable: { books: "ac.book=1", posting: false, extra: " AND ac.bs_id=30", title: "Expense Payable" },
  cash: { books: "ac.book IN (4)", posting: true, title: "Cash Balance" },
  bank: { books: "ac.book IN (6)", posting: true, title: "Bank Balance" },
};

export async function dashboardData(loader: Loader, yearly: boolean, from: string, upto: string, today: string): Promise<DashData> {
  const { client, session } = loader;
  const series = {} as Record<DashKind, DashPoint[]>;

  if (yearly) {
    // One bar for each year (its own dates), labelled 25-26.
    const years = await companyYears(loader, from, upto, session.licence !== 7 && session.licence !== 8);
    for (const kind of DASH_KINDS) {
      series[kind] = [];
      for (const year of years) {
        const source = chartSource(kind, year.schema, await hasType(client, year.schema));
        const row = (await client.query(`SELECT coalesce(sum(${source.measure}),0) AS value FROM ${source.from} WHERE ${source.where} AND ${source.dateColumn} BETWEEN $1 AND $2`, [year.y1, year.y2])).rows[0];
        const two = (date: Date) => String(new Date(date).getFullYear()).slice(-2);
        series[kind].push({ label: `${two(year.y1)}-${two(year.y2)}`, month: 0, value: toDecimal(row?.value) });
      }
    }
    return { yearly, series, today: null, balances: null };
  }

  const schema = session.companySchema;
  const typed = await hasType(client, schema);
  for (const kind of DASH_KINDS) {
    const source = chartSource(kind, schema, typed);
    const rows = (await client.query(
      `SELECT extract(month from ${source.monthColumn})::int AS m, coalesce(sum(${source.measure}),0) AS value FROM ${source.from} WHERE ${source.where} AND ${source.dateColumn} BETWEEN $1 AND $2`
      + ` GROUP BY 1 ORDER BY ${FISCAL("extract(month from " + source.monthColumn + ")::int")}`, [from, upto])).rows;
    series[kind] = rows.map((row) => ({ label: MONTHS[Number(row.m) - 1], month: Number(row.m), value: toDecimal(row.value) }));
  }
  const todayTotals = {} as Record<DashKind, number>;
  for (const kind of DASH_KINDS) {
    const source = chartSource(kind, schema, typed);
    const row = (await client.query(`SELECT coalesce(sum(${source.measure}),0) AS value FROM ${source.from} WHERE ${source.where} AND ${source.dateColumn}::date = $1::date`, [today])).rows[0];
    todayTotals[kind] = toDecimal(row?.value);
  }
  const balances = {} as Record<DashBalance, number>;
  for (const key of DASH_BALANCES) {
    const spec = BALANCE_WHERE[key];
    const row = (await client.query(`SELECT coalesce(sum(closing),0) AS total FROM (${balanceSql(schema, spec.books, spec.posting, spec.extra)}) b`)).rows[0];
    balances[key] = toDecimal(row?.total);
  }
  return { yearly, series, today: todayTotals, balances };
}

const MONEY = { name: "amount", text: "Amount", numeric: true };

/**
 * The vouchers of a month behind a bar (the chart's click): the very rows the bar adds up (the same source, filters, amount, month and period), so the list's total
 * is the bar's value. A sale or purchase voucher shows what the chart takes of it (the sale / purchase accounts' postings, a credit note or return as a minus), not
 * its gross amount with the taxes.
 */
export async function monthVouchers(loader: Loader, kind: DashKind, month: number, from: string, upto: string): Promise<DashTable> {
  const schema = loader.session.companySchema;
  const typed = await hasType(loader.client, schema);
  const m = Math.trunc(month);
  if (!(m >= 1 && m <= 12)) throw new Error("Choose a month from the chart");
  const source = chartSource(kind, schema, typed);
  const where = `${source.where} AND extract(month from ${source.monthColumn})=${m} AND ${source.dateColumn} BETWEEN $1 AND $2`;
  const head = "led.led_key, led.book, to_char(led.doc_date,'DD/MM/YYYY') AS doc_date, led.full_docno AS doc_no";
  let sql: string;
  if (kind === "expense") {
    // Each posting to an expense account is a row, named by that account.
    sql = `SELECT ${head}, ac.name, (${source.measure})::numeric(20,2) AS amount FROM ${source.from} WHERE ${where} ORDER BY led.doc_date, led.doc_no`;
  } else {
    // A row for each voucher: its party, its register and what the chart adds up of it.
    const posts = source.from.includes("ledger_post");
    sql = `SELECT ${head}, pac.name, ac1.name AS book_name, sum(${source.measure})::numeric(20,2) AS amount FROM ${source.from}`
      + ` LEFT JOIN ${schema}.account pac ON pac.code=led.code LEFT JOIN ${schema}.account ac1 ON ac1.code=led.book_code WHERE ${where}`
      + ` GROUP BY led.led_key, led.book, led.doc_date, led.full_docno, led.doc_no, pac.name, ac1.name ORDER BY led.doc_date, led.doc_no`;
    void posts;
  }
  const rows = (await loader.client.query(sql, [from, upto])).rows;
  const columns = [{ name: "doc_date", text: "Doc Date", numeric: false }, { name: "doc_no", text: "Doc No", numeric: false }, { name: "name", text: "Name", numeric: false }, ...(kind === "expense" ? [] : [{ name: "book_name", text: "Book Name", numeric: false }]), MONEY];
  return { columns, rows: rows.map((row) => ({ doc_date: toText(row.doc_date), doc_no: toText(row.doc_no), name: toText(row.name), book_name: toText(row.book_name), amount: toDecimal(row.amount), _led: Number(row.led_key) || 0, _book: Number(row.book) || 0 })) };
}

/** The accounts behind a balance (the tile's click), those with a closing balance. */
export async function balanceAccounts(loader: Loader, key: DashBalance): Promise<{ title: string; table: DashTable }> {
  const spec = BALANCE_WHERE[key];
  const rows = (await loader.client.query(`SELECT * FROM (${balanceSql(loader.session.companySchema, spec.books, spec.posting, spec.extra)}) b WHERE closing<>0 ORDER BY name`)).rows;
  return {
    title: spec.title,
    table: { columns: [{ name: "name", text: "Name", numeric: false }, { name: "closing", text: "Closing", numeric: true }], rows: rows.map((row) => ({ name: toText(row.name), closing: toDecimal(row.closing), _code: Number(row.code) || 0 })) },
  };
}
