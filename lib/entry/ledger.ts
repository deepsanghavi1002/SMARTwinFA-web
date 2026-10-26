import { Loader } from "../master-program/load";
import { formatDesktopDate, toDecimal, toText } from "../master-program/legacy";

/**
 * The F8 window of the account help: the Ledger of the highlighted account for the open year, a voucher to a row (date, doc no,
 * particular, debit, credit, closing, Dr/Cr, chln, chln date, narration). The closing runs from the account's opening in ac_balance (a minus opening is a credit).
 * Read-only.
 */

const field = Loader.field;

export type LedgerRow = Readonly<{
  /** The row's place in the ledger as it is read (a sort on Sr. brings the original order back). */
  sr?: string;
  date: string; docNo: string; particular: string; debit: string; credit: string; closing: string; drCr: string;
  chln: string; chlnDate: string; narration: string;
}>;
export type AccountLedger = Readonly<{ title: string; rows: readonly LedgerRow[] }>;

const money = (value: number) => (Math.abs(value) < 0.005 ? "" : Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const drCr = (balance: number) => (Math.abs(balance) < 0.005 ? "" : balance > 0 ? "Dr" : "Cr");
const dateOf = (value: unknown) => (value instanceof Date ? formatDesktopDate(value) : toText(value).trim());

export async function accountLedger(loader: Loader, code: number): Promise<AccountLedger> {
  const { session } = loader;
  const account = (await loader.readTable(`SELECT name FROM |sys.db|account WHERE code = $1`, [code]))?.[0];
  if (!account) throw new Error("The account is not in the account master");
  const opening = toDecimal((await loader.readTable(`SELECT opening::numeric AS v FROM |sys.db|ac_balance WHERE code = $1 AND year_id = $2 AND a_recflag = 'AC' LIMIT 1`, [code, session.yearId]))?.[0]?.v);
  const posts = (await loader.readTable(
    `SELECT p.led_id, p.post_date, p.post_dbcode, p.post_amt::numeric AS amt, l.full_docno, l.doc_no1, l.chln_date, l.narration,
       (SELECT a.name FROM |sys.db|ledger_post o JOIN |sys.db|account a ON a.code = o.post_code
         WHERE o.led_id = p.led_id AND o.post_code <> p.post_code AND o.post_dbcode <> p.post_dbcode ORDER BY o.post_amt DESC LIMIT 1) AS contra
     FROM |sys.db|ledger_post p JOIN |sys.db|ledger l ON l.led_key = p.led_id
     WHERE p.post_code = $1 AND p.year_id = $2 AND coalesce(l.doc_pos, '') <> 'D'
     ORDER BY p.post_date, p.led_id, p.post_key`, [code, session.yearId])) ?? [];
  const blank = { date: "", docNo: "", particular: "", debit: "", credit: "", closing: "", drCr: "", chln: "", chlnDate: "", narration: "" };
  const rows: LedgerRow[] = [{ ...blank, particular: "Opening Balance", closing: money(opening), drCr: drCr(opening) }];
  let balance = opening;
  let debits = 0;
  let credits = 0;
  for (const post of posts) {
    const amount = toDecimal(field(post, "amt"));
    const debit = Number(field(post, "post_dbcode")) === 1;
    balance += debit ? amount : -amount;
    if (debit) debits += amount; else credits += amount;
    rows.push({
      ...blank, date: dateOf(field(post, "post_date")), docNo: toText(field(post, "full_docno")).trim(),
      particular: toText(field(post, "contra")).trim(), debit: debit ? money(amount) : "", credit: debit ? "" : money(amount),
      closing: money(balance), drCr: drCr(balance), chln: toText(field(post, "doc_no1")).trim(), chlnDate: dateOf(field(post, "chln_date")), narration: toText(field(post, "narration")).trim(),
    });
  }
  rows.push({ ...blank, particular: "Closing Balance", debit: money(debits), credit: money(credits), closing: money(balance), drCr: drCr(balance) });
  return { title: toText(field(account, "name")).trim(), rows };
}
