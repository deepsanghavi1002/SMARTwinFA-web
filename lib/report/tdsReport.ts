import type { Loader } from "../master-program/load";
import { SETUP_SCHEMA } from "../master-program/session";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { num, runReportSql } from "./run";
import { finishRows, journalLookup, returnLookup, tdsQuery, TDS_COLUMNS } from "./tdsReportSql";

type Row = Record<string, unknown>;

/**
 * SP_FRT_RPT_TDS_REPORT (REPORT > Extra > TDS Report, report 162): the purchase, expense and expense-return vouchers of the period with the
 * party's PAN, address and deductee type, the TDS chart's nature of payment, section and rate, the net amount, the tax deducted (the TDS journal set
 * against the voucher), what the rate gives (ACT_TDS_AMT) and the difference. Only vouchers with a rate and tax deducted show. The desktop builds it in
 * TEMP_TABLE_TDS_REP_<machine>; here the rows are built in memory from read-only queries.
 */
export async function tdsReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const slabOf = async (book: number) => num((await runReportSql(loader, `SELECT coalesce(slab_key,0) AS k FROM ${db}SLAB_MASTER WHERE SLAB_MASTER = 'Y' AND slab_link = 0 AND SLAB_ACTIVE = 'Y' AND BOOK = ${book} ORDER BY slab_order LIMIT 1`)).rows[0]?.k);
  const purchaseSlab = await slabOf(13);
  const expenseSlab = await slabOf(15);
  const rows: Row[] = (await runReportSql(loader, frag(tdsQuery(db, SETUP_SCHEMA, purchaseSlab, expenseSlab, day(call.from), day(call.upto))))).rows.map((row) => ({ ...row }));

  // An expense return set against a bill: the TDS journal of the bill's clearing, for the other account.
  const returns = rows.filter((row) => num(row.BOOK) === 10 && num(row.OUT_AG_OUTID) > 0);
  if (returns.length > 0) {
    const found = (await runReportSql(loader, returnLookup(db), [returns.map((row) => num(row.CODE)), returns.map((row) => num(row.OUT_AG_OUTID))])).rows;
    const byPair = new Map(found.map((row) => [`${num(row.code)}|${num(row.ag)}`, row]));
    for (const row of returns) {
      const hit = byPair.get(`${num(row.CODE)}|${num(row.OUT_AG_OUTID)}`);
      row.TDS_AMOUNT = hit && hit.amount !== null && hit.amount !== undefined ? num(hit.amount) : 0;
      row.OUT_KEY = hit && hit.out_key !== null && hit.out_key !== undefined ? num(hit.out_key) : 0;
    }
  }
  const journals = rows.filter((row) => num(row.BOOK) === 10 && num(row.OUT_KEY) > 0);
  if (journals.length > 0) {
    const keys = [...new Set(journals.map((row) => num(row.OUT_KEY)))];
    const found = new Map((await runReportSql(loader, journalLookup(db), [keys])).rows.map((row) => [num(row.k), row.number]));
    for (const row of journals) row.TDS_JV_No = found.get(num(row.OUT_KEY)) ?? "";
  }

  const table = new ResultTable();
  for (const column of TDS_COLUMNS) table.addColumn(column);
  for (const column of ["Net_Amount", "TDS_Rate", "TDS_AMOUNT", "ACT_TDS_AMT", "DIFF_TDS_AMT"]) table.setKind(column, "decimal");
  table.rows = finishRows(rows);
  return table;
}
