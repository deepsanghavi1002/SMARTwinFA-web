import { formatDesktopDate, parseDesktopDate, toInt } from "../master-program/legacy";
import type { Loader } from "../master-program/load";
import { cellOf } from "./entrySave";
import type { EntryStatement } from "./entrySave";
import type { EditedRow, EntryState } from "./types";

/**
 * Small_Entry.Save_Click for Outstanding Allocation (19), Add: the receipt (or payment) chosen
 * in the top grid is set off against the bills below it (c1dg_SmallEntryDataGrid's setoff).
 *
 * The receipt's unallocated outclear row takes the first bill's set-off and points at it
 * (out_ag_outid); each further bill gets a new outclear row of the receipt pointing at it;
 * every bill's own out_setoff goes up. A row whose set-off reaches the receipt (or the bill)
 * is cleared ('C'). What is left of the receipt goes on as a new unallocated row. The set-offs
 * together may not be more than the receipt (the desktop's AfterEdit and Save_Click check).
 */

export const OUTSTANDING_ALLOCATION = 19;

export type AllocationResult = Readonly<{ statements: EntryStatement[]; savedRows: Set<number>; messages: string[] }>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const amountOf = (value: string | undefined) => Number((value ?? "").replace(/,/g, "").trim()) || 0;
const money = (value: number) => `${Number(value.toFixed(4))}::numeric::money`;

export async function allocationStatements(loader: Loader, entryId: number, rows: readonly EditedRow[], bills: readonly Readonly<Record<string, string>>[], state: EntryState): Promise<AllocationResult | null> {
  if (entryId !== OUTSTANDING_ALLOCATION) return null;
  const schema = loader.session.companySchema;
  const statements: EntryStatement[] = [];
  const messages: string[] = [];
  const receipt = rows.find((row) => !row.deleted)?.values;
  if (!receipt) return { statements, savedRows: new Set(), messages: ["Choose the receipt to allocate"] };
  if ((state.controls.cmb_smallentry2 ?? "").trim() !== "Add") return { statements, savedRows: new Set(), messages: ["Outstanding Allocation saves in Add only"] };

  const receiptAmount = amountOf(cellOf(receipt, "AMOUNT"));
  const setOff = bills.filter((bill) => amountOf(cellOf(bill, "setoff")) > 0);
  if (setOff.length === 0) return { statements, savedRows: new Set(), messages: ["Nothing has been changed"] };
  const total = setOff.reduce((sum, bill) => sum + amountOf(cellOf(bill, "setoff")), 0);
  if (Number(total.toFixed(4)) > Number(receiptAmount.toFixed(4))) return { statements, savedRows: new Set(), messages: [`Setoff Amount greater than equal ${receiptAmount} Not Allowed`] };

  const receiptLed = toInt(cellOf(receipt, "led_key"));
  const receiptOut = toInt((await loader.readTable(`select out_key from ${schema}.outclear where out_ledid=$1 and (out_ag_outid is null or out_ag_outid=0) order by out_key limit 1`, [receiptLed]))?.[0]?.out_key);
  if (receiptOut === 0) return { statements, savedRows: new Set(), messages: ["The receipt has nothing left to allocate"] };
  const date = quote(formatDesktopDate(parseDesktopDate(cellOf(receipt, "doc_date") ?? "") ?? new Date()));
  const fullDocNo = quote(cellOf(receipt, "full_docno") ?? "");
  const dbCode = String(toInt(cellOf(receipt, "ac_dbcode")));
  const book = String(toInt(cellOf(receipt, "book")));
  const code = String(toInt(state.firstCombo?.value));
  const year = quote(loader.session.yearId);
  const outclear = (entryAmount: number, setoffAmount: number, againstKey: string, setOffFlag: string, clear: string) => ({ sql: "", insert: {
    table: "outclear",
    fields: ["out_ledid", "out_fulldocno", "out_date", "out_entryamt", "out_setoff", "out_ly_setoff", "out_on_acamt", "out_dbcode", "out_ag_outid", "out_entrybook", "code", "ref_no", "set_off", "clear_pos", "year_id"],
    values: [String(receiptLed), fullDocNo, date, money(entryAmount), money(setoffAmount), money(0), money(0), dbCode, againstKey, book, code, "''", `'${setOffFlag}'`, `'${clear}'`, year],
  } });

  let done = 0;
  for (const [at, bill] of setOff.entries()) {
    const amount = amountOf(cellOf(bill, "setoff"));
    const billOut = toInt((await loader.readTable(`select out_key from ${schema}.outclear where out_ledid=$1 order by out_key limit 1`, [toInt(cellOf(bill, "led_key"))]))?.[0]?.out_key);
    if (billOut === 0) { messages.push(`Bill ${cellOf(bill, "Bill_No") ?? ""} has no outstanding row`); continue; }
    done = Number((done + amount).toFixed(4));
    if (at === 0) {
      statements.push({ sql: `Update outclear set out_setoff=${money(amount)},out_ag_outid=${billOut}${done === Number(receiptAmount.toFixed(4)) ? ",set_off='1',clear_pos='C'" : ""} where out_key=${receiptOut}` });
      statements.push({ sql: `Update outclear set out_setoff=out_setoff+${money(amount)}${done === Number(amountOf(cellOf(bill, "AMOUNT")).toFixed(4)) ? ",clear_pos='C'" : ""} where out_key=${billOut}` });
    } else {
      statements.push(outclear(receiptAmount, amount, String(billOut), "0", "C"));
      statements.push({ sql: `Update outclear set out_setoff=out_setoff+${money(amount)}${done === Number(receiptAmount.toFixed(4)) ? ",clear_pos='C'" : ""} where out_key=${billOut}` });
    }
  }
  if (done !== Number(receiptAmount.toFixed(4))) statements.push(outclear(Number((receiptAmount - done).toFixed(4)), 0, "null", "1", "P"));
  return { statements, savedRows: new Set([rows.findIndex((row) => !row.deleted)]), messages };
}
