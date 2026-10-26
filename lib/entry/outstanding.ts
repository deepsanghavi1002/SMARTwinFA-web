import { Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toDecimal, toText } from "../master-program/legacy";
import type { PartyStock } from "./partyStock";

/**
 * The F7 window of the voucher's account help (F7-Outstanding): the pending bills of the highlighted account, one bill to a row, as the Outstanding
 * report shows them but without the ageing buckets - only the number of days the bill has been pending (from its date to the entry date). Bills
 * of both sides are listed with a Dr / Cr mark; the closing rows add up each side and give the net. Read-only, for that account only.
 */

const field = Loader.field;
const figure = (value: number) => (Math.abs(value) < 0.005 ? "" : value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

export async function accountOutstanding(loader: Loader, code: number, asOf = ""): Promise<PartyStock> {
  const { session } = loader;
  const account = (await loader.readTable(`SELECT name FROM |sys.db|account WHERE code = $1`, [code]))?.[0];
  if (!account) throw new Error("The account is not in the account master");
  const upto = parseDesktopDate(asOf) ?? new Date();
  const bills = (await loader.readTable(
    `SELECT l.doc_date, l.full_docno, l.doc_no1, o.out_dbcode, o.out_entryamt::numeric AS amount, (o.out_entryamt::numeric - o.out_setoff::numeric - o.out_ly_setoff::numeric) AS pending
     FROM |sys.db|outclear o JOIN |sys.db|ledger l ON l.led_key = o.out_ledid
     WHERE l.code = $1 AND l.doc_pos <> 'D' AND o.year_id = $2 AND COALESCE(o.out_ag_outid, 0) = 0 AND (o.out_entryamt::numeric - o.out_setoff::numeric - o.out_ly_setoff::numeric) <> 0
     ORDER BY l.doc_date, l.doc_no, o.out_key`, [code, session.yearId])) ?? [];
  let debit = 0;
  let credit = 0;
  const rows: Record<string, string>[] = bills.map((bill, index) => {
    const pending = toDecimal(field(bill, "pending"));
    const isDebit = Number(field(bill, "out_dbcode")) === 1;
    if (isDebit) debit += pending; else credit += pending;
    const date = field(bill, "doc_date");
    const when = date instanceof Date ? date : parseDesktopDate(toText(date));
    return {
      sr: String(index + 1), date: when ? formatDesktopDate(when) : "", docNo: toText(field(bill, "full_docno")).trim(), ref: toText(field(bill, "doc_no1")).trim(),
      amount: figure(toDecimal(field(bill, "amount"))), pending: figure(pending), drCr: isDebit ? "Dr" : "Cr",
      days: when ? String(Math.max(0, Math.round((day(upto) - day(when)) / 86400000))) : "",
    };
  });
  // The total lines are numbered on, so a sort on Sr. brings the original order back.
  const blank = { date: "", ref: "", amount: "", days: "" };
  if (rows.length > 0) {
    rows.push({ ...blank, sr: String(rows.length + 1), docNo: "Total Dr", pending: figure(debit), drCr: "Dr" });
    rows.push({ ...blank, sr: String(rows.length + 1), docNo: "Total Cr", pending: figure(credit), drCr: "Cr" });
    const net = debit - credit;
    rows.push({ ...blank, sr: String(rows.length + 1), docNo: "Net Outstanding", pending: figure(Math.abs(net)), drCr: Math.abs(net) < 0.005 ? "" : net > 0 ? "Dr" : "Cr" });
  }
  return {
    title: toText(field(account, "name")).trim(), caption: "OUTSTANDING",
    columns: [
      { key: "sr", caption: "Sr.", align: "R" }, { key: "date", caption: "Date", align: "L" }, { key: "docNo", caption: "Doc Number", align: "L" }, { key: "ref", caption: "Chq / Ref", align: "L" },
      { key: "amount", caption: "Amount", align: "R" }, { key: "pending", caption: "Pending", align: "R" }, { key: "drCr", caption: "Dr/Cr", align: "L" }, { key: "days", caption: "Days", align: "R" },
    ],
    rows,
  };
}
