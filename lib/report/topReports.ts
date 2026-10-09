import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import type { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { dropColumn, sortRows, tableFromFields, textKey } from "./library";
import { absentQuery, partyQuery, quantityQuery, topPlan, valueQuery } from "./topReportsSql";
import { num, runReportSql } from "./run";

/**
 * SP_FRT_RPT_TOP_REPORTS (REPORT > Extra > Top Reports, report 211): the best customers or suppliers by amount (the net amount before the first
 * tax slab of the sale or purchase book, credit / debit notes taken off, with their closing balance, number of invoices and quantity), or the best
 * products by value or by quantity (with the closing stock), each ranked (Row_No). The first combo names which: Customers, Item Sold by Value,
 * Item Sold by Quantity, Suppliers, Item Purchase by Value, Item Purchase by Quantity. Licence 51 adds those with nothing sold or bought, last.
 * The desktop builds it in TEMP_TABLE_TOP_REPORTS_<machine>; here the rows come from read-only queries.
 */
export async function topReports(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const top = topPlan(call.fcText);
  const dates = { from: `'${desktopDate(call.from)}'::date`, upto: `'${desktopDate(call.upto)}'::date` };

  // The master addon fields shown as columns: the account's for the customers (those of the sale book's register), the product's for the items.
  const addonRelate = top.mode === "party" ? "A" : "P";
  const wantAddons = top.mode !== "party" || top.book === 8;
  const columnsOf = new Set((await runReportSql(loader, `select lower(column_name) as c from information_schema.columns where table_schema = $1 and table_name = 'addon_data'`, [loader.session.companySchema.toLowerCase()])).rows.map((row) => String(row.c)));
  const addons = !wantAddons ? [] : (await runReportSql(loader, `SELECT btrim(fiel_save) AS save FROM ${db}ADDON_FLD WHERE fiel_relate = $1 AND fiel_masterpos = 'Y' AND fiel_entrypos = 'N' AND fiel_pos <> 'D' AND fiel_type = 'M'${top.mode === "party" ? " AND position(' 2,' in fiel_inbook) > 0" : ""} ORDER BY fiel_key`, [addonRelate])).rows
    .map((row) => toText(row.save)).filter((name) => /^[A-Za-z0-9_]+$/.test(name) && columnsOf.has(`txt_${name}`.toLowerCase()));

  let sql: string;
  if (top.mode === "party") {
    const slab = num((await runReportSql(loader, `SELECT slab_key FROM ${db}SLAB_MASTER WHERE slab_master = 'Y' AND slab_active = 'Y' AND book = ${top.book} AND slab_link = 0 ORDER BY slab_order LIMIT 1`)).rows[0]?.slab_key);
    sql = partyQuery(db, top, slab, addons, dates, call.yearId);
  } else sql = top.mode === "value" ? valueQuery(db, top, addons, dates) : quantityQuery(db, top, call.licence, addons, dates);
  const result = await runReportSql(loader, frag(sql));
  const table = tableFromFields(result.fields);
  table.rows = result.rows.map((row) => ({ ...row }));

  // Licence 51: those with no sale or purchase, added after.
  if (call.licence === 51) {
    const key = top.mode === "quantity" ? "prod_id" : "code";
    const have = new Set(table.rows.map((row) => String(row[key])));
    for (const row of (await runReportSql(loader, frag(absentQuery(db, top, addons)))).rows) if (!have.has(String(row[key]))) table.rows.push({ ...row });
  }

  dropColumn(table, top.mode === "quantity" ? "prod_id" : "code");
  for (const column of ["amount", "clsg_bal", "Quantity", "Clsg_Stock"]) if (table.has(column)) table.setKind(column, "decimal");
  for (const column of ["Row_No", "No_Of_invoice"]) if (table.has(column)) table.setKind(column, "int");
  // ORDER BY Amount desc, name (the parties and the products by value) or Quantity desc, name.
  const figure = top.mode === "quantity" ? "Quantity" : "amount";
  sortRows(table, [(row) => -num(row[figure]), (row) => textKey(row.name)]);
  return table;
}
