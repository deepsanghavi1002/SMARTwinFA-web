import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 174: BANK PAYMENT TRANSFER (REPORT_PAYMENT_TRANSFER, SP_FRT_RPT_RPI_PAYMENT_TRANSFER; SPECIAL > Extra Report (RP) > Bank Payment Transfer): the payments
 * of the bank account of the first combo From .. Upto (the party's debit lines of its vouchers, not the 999999 vouchers) as the rows of the bank's upload
 * sheet: client and product code, NEFT below 2,00,000 and RTGS from it, date, the debit account (the bank account's long narration, else the
 * client's own number), the amount, the party's name, IFSC code, account number and e-mail, the mobile, and the party's name as the debit narration.
 * The bank takes no punctuation: in the name and the narration . ( ) [ ] - become a space and & becomes And. By date, then voucher number. One read.
 */
const CLEAN = (text: string) => text.replace(/\./g, " ").replace(/\(/g, " ").replace(/\)/g, " ").replace(/\[/g, " ").replace(/\]/g, " ").replace(/-/g, " ").replace(/&/g, "And");

export async function paymentTransfer(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const bank = Math.trunc(call.fcValue);
  const account = (await runReportSql(loader, `SELECT coalesce(narr_long, '') AS narr FROM ${db}account WHERE code = $1`, [bank])).rows[0];
  const debitAccount = toText(account?.narr).trim() === "" ? "9712170100" : toText(account?.narr);
  const rows = (await runReportSql(loader, `SELECT led.doc_date, led.doc_no, led.amount::numeric AS amount, ac.name, adata.input_ifsccode AS ifsc, adata.input_acc_no AS acc_no, addr.e_mail`
    + ` FROM ${db}ledger led LEFT JOIN ${db}account ac ON ac.code = led.code LEFT JOIN ${db}addon_data adata ON adata.code = led.code LEFT JOIN ${db}address addr ON addr.code = led.code AND addr.address_id = 1`
    + ` WHERE led.doc_date BETWEEN $1::date AND $2::date AND led.doc_pos <> 'D' AND led.ac_dbcode = 1 AND ltrim(rtrim(led.doc_no)) <> '999999' AND led.book_code = $3 ORDER BY led.doc_date, led.ac_dbcode, led.doc_no`,
  [desktopDate(call.from), desktopDate(call.upto), bank])).rows;

  const table = new ResultTable();
  for (const column of ["Client_Code", "Product_Code", "Payment_Type", "Payment_Ref_No.", "Payment_Date", "Dr_Ac_No", "Amount", "Beneficiary_Code.", "Beneficiary_Name", "IFSC Code", "Beneficiary_Acc_No", "Beneficiary_Email", "Beneficiary_Mobile", "Debit_Narration", "Credit_Narration", "Enrichment_1"]) table.addColumn(column);
  table.setKind("Amount", "decimal");
  table.rows = rows.map((row): ResultRow => {
    const date = row.doc_date as Date;
    const amount = num(row.amount);
    const name = CLEAN(toText(row.name));
    return { Client_Code: "RISHABHP", Product_Code: "RPAY", Payment_Type: amount < 200000 ? "NEFT" : "RTGS", "Payment_Ref_No.": "", Payment_Date: `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`,
      Dr_Ac_No: debitAccount, Amount: amount, "Beneficiary_Code.": "", Beneficiary_Name: name, "IFSC Code": toText(row.ifsc), Beneficiary_Acc_No: toText(row.acc_no), Beneficiary_Email: toText(row.e_mail), Beneficiary_Mobile: "8369255726",
      Debit_Narration: name, Credit_Narration: "", Enrichment_1: "" };
  });
  return table;
}
