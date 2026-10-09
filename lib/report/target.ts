import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { sortRows, textKey } from "./library";
import { customerSummary, finishRows, groupSummary, MONTH_NAMES, monthStarts, quarterTarget, salesExpenseRows, yyyymmdd } from "./targetSql";
import { num, runReportSql } from "./run";

type Row = Record<string, unknown>;

/**
 * SP_FRT_RPT_TARGET (REPORT > Extra > Target, report 152): the targets of the customers of the ticked sales persons (an addon group) month by
 * month against the net sale (the sale and its debit / credit notes before tax, from the first tax slab of the sale book): the yearly target,
 * its four quarters, the month's % and target, the net sale, the shortfall, the running shortfall and the % achieved. Options: Summary
 * (a row a customer), Sales With Expense (a row a sales person and month with the salary and expense) and Group Wise (a row a customer
 * type). The desktop builds it in TEMP_TABLE_TARGET_<machine>; here the rows are built in memory from read-only queries.
 */
export async function target(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const addon = call.addon[0].trim();
  const selected = call.selectedAddon[0].trim();
  if (addon === "" || selected === "" || call.selectKey[0] === "") throw new ReportRefusal("Minimum One Sales Man Should Be Selected To Generate Report", "No Selections Done!");
  const keyAddon = ` ${addon}`.replace(" adata.txt_", " adata.key_").trim();

  // The sale book's first tax slab (the net sale is the tax slab's S_LASTOT less its amount).
  const slab = num((await runReportSql(loader, frag(`SELECT coalesce(slab_key,0) AS k FROM ${db}SLAB_MASTER WHERE SLAB_FROMDT = '${desktopDate(call.tarikh1)}' AND SLAB_MASTER = 'Y' AND slab_link = 0 AND SLAB_ACTIVE = 'Y' AND BOOK = 8 LIMIT 1`))).rows[0]?.k);

  const rows: Row[] = [];
  for (const date of monthStarts(call.from, call.upto)) {
    const month = date.getMonth() + 1;
    const sql = `SELECT '${yyyymmdd(date)}' AS "SORTING_COL",${selected},ac.name AS "SMART_NAME",asub.sub_code AS "Sales_Person_Code",asub.sub_name AS "Sales_Person",adata.txt_custtype AS "Cust_Type",adata.key_custtype AS "Cust_Type_Id",ac.name AS "Customer_Name",`
      + `coalesce(ac.budget::numeric,0) AS "Yearly_Trg",${quarterTarget(db, 4, 6)} AS "Trg_Qtr1",${quarterTarget(db, 7, 9)} AS "Trg_Qtr2",${quarterTarget(db, 10, 12)} AS "Trg_Qtr3",${quarterTarget(db, 1, 3)} AS "Trg_Qtr4",`
      + `'${MONTH_NAMES[month - 1]}' AS "Month",targ.trg_perc::numeric AS "Month_perc",(case when targ.trg_perc::numeric > 0 then round(ac.budget::numeric*(targ.trg_perc::numeric/100),0) else 0 end) AS "Month_Target",`
      + `coalesce(SUM(case when EXTRACT(MONTH FROM led.doc_date)=${month} then case when led.book=8 or led.book=11 then ledext.s_lastot::numeric-ledext.slab_amt::numeric else (ledext.s_lastot::numeric-ledext.slab_amt::numeric)*-1 end else 0 end),0) AS "Net_Sale"`
      + ` FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}ADDON_DATA adata on adata.code=ac.code left join ${db}LEDGER_EXT ledext on ledext.led_id=led.led_key`
      + ` left join ${db}TARGET targ on targ.trg_aaocode=${keyAddon} left join ${db}ADDON_SUB asub on asub.sub_code=${keyAddon}`
      + ` where ledext.il_id is null and led.doc_pos<>'D' and ac.a_pos<>'D' AND EXTRACT(MONTH FROM targ.trg_from)=${month}`
      + ` AND (led.book = 8 or (led.book = 16 and led.ag_book = 8 and led.type=42) or (led.book = 11 and led.ag_book = 8 and led.type=42)) and ledext.slab_id=${slab} and targ.trg_aaocode in ${call.selectKey[0]}`
      + ` group by ${addon},asub.sub_code,asub.sub_name,ac.name,ac.budget,targ.trg_aaocode,targ.trg_perc,adata.txt_custtype,adata.key_custtype order by asub.sub_name,ac.name`;
    rows.push(...(await runReportSql(loader, frag(sql))).rows);
  }
  const finished = finishRows(rows);
  const decimal = (table: ResultTable, columns: readonly string[]) => { for (const column of columns) if (table.has(column)) table.setKind(column, "decimal"); };
  const build = (names: readonly string[], list: readonly Row[], decimals: readonly string[]): ResultTable => {
    const table = new ResultTable();
    for (const name of names) table.addColumn(name);
    decimal(table, decimals);
    table.rows = list.map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? null])));
    return table;
  };

  if (check("CHK_SUMMARY")) {
    const table = build(["SMART_SELECTED_ADDON1", "Sales_Person", "Cust_Type", "Customer_Name", "Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4", "Month_Target", "Net_Sale", "Short_fall", "Archive"], customerSummary(finished), ["Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4", "Month_Target", "Net_Sale", "Short_fall", "Archive"]);
    sortRows(table, [(row) => textKey(row.Sales_Person), (row) => textKey(row.Cust_Type), (row) => textKey(row.Customer_Name)]);
    return table;
  }
  if (check("CHK_SMSALEXP")) {
    const costs = (await runReportSql(loader, `SELECT adon_code, month_name, coalesce(salary_amount::numeric,0) AS salary, coalesce(exp_amount::numeric,0) AS expense FROM ${db}SMAN_SALE_EXP`)).rows
      .map((row) => ({ code: toText(row.adon_code), month: toText(row.month_name), salary: num(row.salary), expense: num(row.expense) }));
    const table = build(["SORTING_COL", "SMART_SELECTED_ADDON1", "Sales_Person", "Month", "Month_Target", "Net_Sale", "Expense", "Target_Vs_Sale_%", "Sale_Vs_Exp_%"], salesExpenseRows(finished, costs), ["Month_Target", "Net_Sale", "Expense", "Target_Vs_Sale_%", "Sale_Vs_Exp_%"]);
    sortRows(table, [(row) => textKey(row.Sales_Person), (row) => textKey(row.SORTING_COL)]);
    return table;
  }
  if (check("CHK_GRPSUM")) {
    // The sales persons' target over the months of the period (month numbers, as the desktop compares them).
    const targets = new Map((await runReportSql(loader, `SELECT sub_name, coalesce(sum(trg_value::numeric),0) AS target FROM ${db}TARGET targ, ${db}ADDON_SUB asub WHERE asub.sub_code=targ.trg_aaocode AND EXTRACT(MONTH FROM trg_from) >= ${call.from.getMonth() + 1} AND EXTRACT(MONTH FROM trg_upto) <= ${call.upto.getMonth() + 1} AND trg_value::numeric > 0 GROUP BY sub_name`)).rows.map((row) => [toText(row.sub_name), num(row.target)]));
    return build(["Sales_Person", "Target", "Net_Sale", "Shortfall", "Achieved_%"], groupSummary(finished, targets), ["Target", "Net_Sale", "Shortfall", "Achieved_%"]);
  }
  const names = ["SORTING_COL", "SMART_SELECTED_ADDON1", "SMART_NAME", "Sales_Person", "Cust_Type", "Customer_Name", "Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4", "Month", "Month_perc", "Month_Target", "Net_Sale", "Short_fall", "Tot_Short", "Archive"];
  const table = build(names, finished.filter((row) => num(row.Yearly_Trg) > 0), ["Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4", "Month_perc", "Month_Target", "Net_Sale", "Short_fall", "Tot_Short", "Archive"]);
  sortRows(table, [(row) => textKey(row.Sales_Person), (row) => textKey(row.Customer_Name), (row) => textKey(row.SORTING_COL)]);
  return table;
}

