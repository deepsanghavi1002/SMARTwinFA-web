import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { phnDate, style6 } from "./productionSetoff";
import { num, runReportSql } from "./run";

/**
 * 210: PLANING FG ANALYSIS (REPORT_RPI_PLANING_FG_ANALYSIS, SP_FRT_RPT_RPI_PLANING_FG_ANALYSIS; SPECIAL > Extra Report (RP1) > Planning FG Analysis).
 * Summary format: a line for each PP plan with a job card, entry date From..Upto (the Product Code group's picks, if any): the job card, the FG product, the
 * planning date, the dates the procedure names Org_Plan_Pack_Date (the plan's REV_PACK_DATE) and Rev_Plan_Pack_Date (its PACKING_DATE), the PRODUCTION_DATE
 * (the date of the last finished good entry (PROD-FG) on that job card for the product; "Plan Closed" when the planned quantity is all done), the product's
 * addon PHN_DATE, and the days from the PHN date, the planning date, the packing date and the revised packing date to the last production date (+1) while the
 * plan is open (0 when closed). By job card, then entry date. The last production dates of all the job cards are one read.
 */
export async function planningFgAnalysis(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  if (call.fcText.trim().toUpperCase() !== "SUMMARY") throw new ReportRefusal("Internal program failure", "Query Was Blank");
  const keys = call.selectKey[4].trim();
  const products = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys) ? ` AND prodplan.prod_id IN ${keys}` : "";

  const plans = (await runReportSql(loader, `SELECT coalesce(prodplan.job_card_no, '') AS job, prodplan.prod_id, prodmas.prod_desc, prodplan.ent_date, prodplan.rev_pack_date, prodplan.packing_date, prodplan.plan_qty::numeric AS plan_qty,`
    + ` coalesce(prodplan.plan_sort, 0)::numeric AS plan_sort, adata.input_phn_date FROM ${db}production_planing prodplan LEFT JOIN ${db}product_master prodmas ON prodplan.prod_id = prodmas.prod_key`
    + ` LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodmas.prod_key WHERE prodplan.ent_date >= $1::date AND prodplan.ent_date <= $2::date AND prodplan.ent_type = 'PP' AND coalesce(prodplan.job_card_no, '') <> ''${products}`
    + ` ORDER BY prodplan.job_card_no, prodplan.ent_date`, [desktopDate(call.from), desktopDate(call.upto)])).rows;

  const last = new Map<string, Date>();
  if (plans.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT prodled.prod_id, aent.input_job_card AS job, max(prodled.il_date) AS last_date FROM ${db}prod_ledger prodled LEFT JOIN ${db}addon_aentry aent ON aent.aona_processid = prodled.process_id`
      + ` WHERE coalesce(aent.input_job_card, '') <> '' AND btrim(prodled.trn_module) = 'PROD-FG' AND prodled.stock_nat = 'A' AND prodled.il_pos = 'A' GROUP BY prodled.prod_id, aent.input_job_card`)).rows) {
      last.set(`${num(row.prod_id)}|${toText(row.job).toLowerCase()}`, row.last_date as Date);
    }
  }

  const table = new ResultTable();
  for (const column of ["Job_Card_No", "FG_Product", "Planning_Date", "Org_Plan_Pack_Date", "Rev_Plan_Pack_Date", "PRODUCTION_DATE", "PHN_DATE", "Diff_Days", "Plan_Date_Diff_Days", "Org_Pack_Date_Diff_Days", "Rev_Pack_Date_Diff_Days"]) table.addColumn(column);
  for (const column of ["Diff_Days", "Plan_Date_Diff_Days", "Org_Pack_Date_Diff_Days", "Rev_Pack_Date_Diff_Days"]) table.setKind(column, "int");
  const utc = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const rows: ResultRow[] = plans.map((row) => {
    const closed = num(row.plan_qty) === num(row.plan_sort);
    const finished = last.get(`${num(row.prod_id)}|${toText(row.job).toLowerCase()}`) ?? null;
    const phn = phnDate(toText(row.input_phn_date));
    const phnParts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(phn);
    const phnDay = phnParts ? Math.floor(Date.UTC(Number(phnParts[3]), Number(phnParts[2]) - 1, Number(phnParts[1])) / 86400000) : null;
    const since = (date: unknown) => (!closed && finished !== null && date ? utc(finished) - utc(date as Date) + 1 : 0);
    return { Job_Card_No: toText(row.job), FG_Product: row.prod_desc, Planning_Date: style6(row.ent_date as Date | null), Org_Plan_Pack_Date: style6(row.rev_pack_date as Date | null), Rev_Plan_Pack_Date: style6(row.packing_date as Date | null),
      PRODUCTION_DATE: closed ? "Plan Closed" : style6(finished), PHN_DATE: phnParts ? `${phnParts[1]}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(phnParts[2]) - 1]}-${phnParts[3].slice(-2)}` : null,
      Diff_Days: !closed && phnDay !== null && finished !== null ? utc(finished) - phnDay + 1 : 0, Plan_Date_Diff_Days: since(row.ent_date), Org_Pack_Date_Diff_Days: since(row.packing_date), Rev_Pack_Date_Diff_Days: since(row.rev_pack_date) };
  });
  table.rows = rows;
  return table;
}
