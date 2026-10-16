import type { Loader } from "../master-program/load";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { tableFromResult } from "./library";
import { runReportSql } from "./run";
import type { ResultTable } from "./call";

/**
 * 51: BANK SLIP (REPORT > Bank / Cash > Bank Slip; the Bank Slip branch of the standard report). One row for each cheque voucher of the period (the report's From
 * and WHERE as the setup builds them, with the entry addon joined): date, voucher no, party, amount, cheque no and date, the bank and branch the entry addon holds
 * and the book's account code. Licence 14 reads the bank from the bank-name master (BANKNAME) and takes the ticked banks (or, with none ticked, every bank but
 * BANK OF BARODA). In the order of the voucher date and number.
 */
export async function bankSlip(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const licence14 = call.licence === 14;
  const bank = licence14 ? "aentry.txt_bankname" : "aentry.input_bank";
  const from = call.from_.split("|sys.sp.aentry|").join("").split("sys.aent.bstart").join("(").split("sys.aent.bend").join(`left join ${db}ADDON_AENTRY aentry on led.led_key = aentry.aona_ledid)`);
  let where = `${call.where.split("|sys.yearid|").join(call.yearId)} AND LED.DOC_DATE between '${desktopDate(call.from)}' and '${desktopDate(call.upto)}'`;
  if (licence14) where += call.selectKey[0] !== "" ? ` AND aentry.key_bankname in ${call.selectKey[0]}` : " AND aentry.txt_bankname <> 'BANK OF BARODA'";
  const result = await runReportSql(loader, frag(`SELECT to_char(LED.DOC_DATE, 'DD-Mon-YY') AS "DOC_DATE", btrim(LED.DOC_NO) AS "DOC_NO", ac.Name AS "Name", LED.AMOUNT AS "AMOUNT", btrim(LED.DOC_NO1) AS "CHEQUE_NO",`
    + ` to_char(LED.CHLN_DATE, 'DD-Mon-YY') AS "CHQ_DATE", ${bank} AS "BANK_NAME", aentry.input_branch AS "BRANCH", led.book_code AS "ac_code" ${from} ${where} ORDER BY led.doc_date, led.doc_no`));
  const table = tableFromResult(result);
  table.setKind("AMOUNT", "decimal");
  return table;
}
