import { Loader } from "../master-program/load";
import { parseDesktopDate, toInt } from "../master-program/legacy";
import { LOCKED_BOOK } from "./approval";

/**
 * Entry Approved (Small_Entry id 32): the steps of Small_Entry.cs that belong to this entry only.
 *
 * On the SALE - ORDER book, a party whose outstanding is overdue beyond its credit days, or whose
 * balance or order is over its credit limit, is locked: its orders show Lock_Status "Lock" with
 * Allowed "N", and none of them may be approved (ValidateEdit's "Party Stop Message"). The money
 * columns are read as numbers here (they are money in PostgreSQL).
 */

export { ENTRY_APPROVED, isLocked, LOCKED_BOOK, PARTY_STOP_MESSAGE } from "./approval";

type GridRow = Record<string, string>;

/** A grid value by column name, whatever case the query gave it. */
function keyOf(row: GridRow, name: string): string {
  const lower = name.toLowerCase();
  return Object.keys(row).find((key) => key.toLowerCase() === lower) ?? name;
}
const valueOf = (row: GridRow, name: string) => row[keyOf(row, name)] ?? "";

/** The party's balance on the order date: the year's opening plus every posted entry to that day. */
async function balanceOn(loader: Loader, code: number, date: Date): Promise<number> {
  const s = loader.session.companySchema;
  const row = (await loader.readTable(
    `SELECT COALESCE(b.opening::numeric, 0) + COALESCE((SELECT SUM(CASE WHEN a.ac_dbcode = 1 THEN a.amount::numeric ELSE -a.amount::numeric END) FROM ${s}.ledger a WHERE a.code = b.code AND a.doc_pos <> 'D' AND a.amount::numeric > 1 AND a.doc_date <= $3 AND a.doc_posting = 'P'), 0) AS balance FROM ${s}.ac_balance b WHERE b.code = $1 AND b.year_id = $2 LIMIT 1`,
    [code, loader.session.yearId, date],
  ))?.[0];
  return Number(Loader.field(row, "balance") ?? 0) || 0;
}

/** Whether a bill still open on the balance falls due before the order's credit days allow. */
async function overdue(loader: Loader, code: number, balance: number, orderDate: Date, creditDays: number): Promise<boolean> {
  const s = loader.session.companySchema;
  const bills = (await loader.readTable(
    `SELECT a.out_date, a.out_entryamt::numeric - a.out_setoff::numeric - a.out_ly_setoff::numeric AS open_amount FROM ${s}.outclear a LEFT JOIN ${s}.ledger b ON a.out_ledid = b.led_key WHERE a.code = $1 AND a.out_entryamt::numeric - a.out_setoff::numeric - a.out_ly_setoff::numeric > 0 AND a.year_id = $2 AND a.out_dbcode = 1 AND b.amount::numeric > 1 ORDER BY b.doc_date DESC`,
    [code, loader.session.yearId],
  )) ?? [];
  const latest = new Date(orderDate);
  latest.setDate(latest.getDate() - creditDays);
  let remaining = balance;
  for (const bill of bills) {
    if (remaining <= 0) break;
    remaining -= Number(Loader.field(bill, "open_amount") ?? 0) || 0;
    const due = Loader.field(bill, "out_date");
    if (due instanceof Date ? due <= latest : (parseDesktopDate(String(due ?? "")) ?? new Date(8.64e15)) <= latest) return true;
  }
  return false;
}

/**
 * Cmb_FirstCombo_Leave for entry 32 on the SALE - ORDER book: each order not already marked whose
 * party has credit days is checked, and a locked party's orders are all marked Allowed "N",
 * Lock_Status "Lock".
 */
export async function lockStoppedParties(loader: Loader, rows: GridRow[], firstComboText: string): Promise<void> {
  if (firstComboText.trim() !== LOCKED_BOOK || rows.length === 0) return;
  const s = loader.session.companySchema;
  const limits = new Map<number, number>();
  const limitOf = async (code: number) => {
    if (!limits.has(code)) {
      const row = (await loader.readTable(`SELECT COALESCE("LIMIT"::numeric, 0) AS credit_limit FROM ${s}.account WHERE code = $1`, [code]))?.[0];
      limits.set(code, Number(Loader.field(row, "credit_limit") ?? 0) || 0);
    }
    return limits.get(code) ?? 0;
  };
  for (const row of rows) {
    if (valueOf(row, "allowed").trim() !== "") continue;
    const creditDays = toInt(valueOf(row, "credit_days"));
    if (creditDays <= 0) continue;
    const orderDate = parseDesktopDate(valueOf(row, "p_date"));
    const code = toInt(valueOf(row, "code"));
    if (!orderDate || code <= 0) continue;
    const balance = await balanceOn(loader, code, orderDate);
    let locked = balance > 0 && await overdue(loader, code, balance, orderDate, creditDays);
    const limit = await limitOf(code);
    if (!locked && limit > 0) {
      const order = (await loader.readTable(`SELECT COALESCE(p_amount::numeric, 0) AS amount FROM ${s}.process WHERE process_key = $1`, [toInt(valueOf(row, "process_key"))]))?.[0];
      const amount = Number(Loader.field(order, "amount") ?? 0) || 0;
      locked = balance > limit || amount > limit;
    }
    if (!locked) continue;
    const party = valueOf(row, "name");
    for (const other of rows) {
      if (valueOf(other, "name") !== party) continue;
      other[keyOf(other, "allowed")] = "N";
      other[keyOf(other, "lock_status")] = "Lock";
    }
  }
}
