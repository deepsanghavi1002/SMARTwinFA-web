import { toInt } from "../master-program/legacy";
import { Loader } from "../master-program/load";

/**
 * Report_Combine C1_OUTPUT_KeyUp (Enter, ZOOM ENTRY) for a voucher row (SMART_LED_KEY): the book of the voucher says the program: the cash, bank,
 * card and journal books (4, 5, 6, 19) open the VOUCHER entry, every other book the INVOICE entry. The stock vouchers of a row with only a
 * SMART_PROCESS_KEY (challans, orders, production ...) are not ported. The Trial Balance (6), Sales with Expense (280) and Profit and Loss (22) rows open the
 * account's Ledger (REPORT_LEDGER) instead.
 */
export type ZoomReply = Readonly<{ entryName?: string; ledKey?: number; reportName?: string; acCode?: number; message?: string }>;

export async function zoomTarget(loader: Loader, ledKey: number, processKey: number, acCode = 0, name = ""): Promise<ZoomReply> {
  // The Trial Balance and Sales with Expense rows name the account; the Profit and Loss row's clicked cell names it as text (a name of an account that is not a party).
  if (ledKey <= 0 && acCode > 0) return { reportName: "REPORT_LEDGER", acCode };
  if (ledKey <= 0 && name.trim() !== "") {
    const found = (await loader.readTable("SELECT code FROM |sys.db|account WHERE btrim(name) = btrim($1) AND a_pos = 'A' AND book NOT IN (2, 3) ORDER BY code LIMIT 1", [name]))?.[0];
    return found ? { reportName: "REPORT_LEDGER", acCode: toInt(Loader.field(found, "code")) } : { message: "No Record Found......" };
  }
  if (ledKey <= 0) return { message: processKey > 0 ? "Opening a stock voucher (challan, order, production ...) from a report is not ported yet" : "This row is not a voucher" };
  const row = (await loader.readTable("SELECT book FROM |sys.db|ledger WHERE led_key = $1 AND doc_pos <> 'D'", [ledKey]))?.[0];
  if (!row) return { message: "The voucher is not found (deleted, or not posted)" };
  const book = toInt(Loader.field(row, "book"));
  return { entryName: [4, 5, 6, 19].includes(book) ? "VOUCHER" : "INVOICE", ledKey };
}
