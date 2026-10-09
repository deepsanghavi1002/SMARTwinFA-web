import type { Loader } from "../master-program/load";
import type { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { sortRows, tableFromResult, textKey } from "./library";
import { codesOf, partyBillQuery } from "./partyBillPdfSql";
import { num, runReportSql } from "./run";

/**
 * SP_FRT_RPT_PARTY_BILL_PDF (REPORT > Extra > Party Wise Bill PDF, report 255): the bills of the first combo's book (sale, purchase, ...) in the
 * period, of the selected accounts, to be made into a PDF per party: LED_KEY (hidden, as SMART_LED_KEY), name, date, bill no, amount and Note_Nature (1 when the voucher has
 * inventory lines). The desktop builds it in TEMP_TABLE_PARTY_BILL_PDF_<machine>; here it comes straight from a read-only query.
 */
export async function partyBillPdf(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  // Licences 19 / 29 / 68 / 73 hide the CA_ENT books, unless there is no CA_ENT account at all (then nothing is hidden).
  let hideCaEnt = false;
  if ([19, 29, 68, 73].includes(call.licence)) {
    hideCaEnt = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${call.database}ACCOUNT WHERE A_POS <> 'D' AND position('CA_ENT' in A_SHORT) > 0`)).rows[0]?.n) === 0;
  }
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const table = tableFromResult(await runReportSql(loader, frag(partyBillQuery({ db: call.database, book: call.fcValue, codes: codesOf(call.selectKey[4]), from: day(call.from), upto: day(call.upto), hideCaEnt }))));
  table.setKind("AMOUNT", "decimal");
  table.setKind("Note_Nature", "int");
  // ORDER BY Name, the date (yyyymmdd), FULL_DOCNO.
  const sortDate = (row: Record<string, unknown>): string => String(row.SELECTED_DATE).split("/").reverse().join("");
  sortRows(table, [(row) => textKey(row.name), (row) => sortDate(row), (row) => textKey(row.FULL_DOCNO)]);
  return table;
}
