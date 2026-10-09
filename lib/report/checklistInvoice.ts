import type { Loader } from "../master-program/load";
import type { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./generate";
import { tableFromResult } from "./library";
import { entryAddonColumn, masterAddonColumn } from "./checklistDaybookSql";
import type { AddonField } from "./checklistDaybookSql";
import { entryNeedle, invoiceFrom, invoiceSelect, masterNeedle, slabBook, slabParts } from "./checklistInvoiceSql";
import { runReportSql } from "./run";

/**
 * SP_FRT_RPT_CHECKLIST_INVOICE (REPORT > Register > Checklist Invoice, report 119): every voucher of
 * the register's book in the period, for checking: date, voucher, challan, account, quantity (or
 * bundle, quantity and kgs for licence 2), a column a tax slab of the book, the amount, the entry
 * addon fields of the book, the account master's addon fields and the narration. Nothing is summed.
 *
 * As in the checklist daybook, an addon field whose column is not on ADDON_AENTRY / ADDON_DATA is left
 * out (SQL Server would stop), and an empty number addon field of the account master is 0.
 * Statements run one at a time: runReportSql keeps a savepoint per statement on the one connection.
 */
export async function checklistInvoice(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const schema = loader.session.companySchema;
  if (!(call.fcValue > 0)) throw new ReportRefusal("Select the book (Register).", "No Selections Done!");

  // The tax slabs of the book for the year (SLAB_FROMDT is the year's start).
  const slabRows = (await runReportSql(loader, `select slab_key, btrim(slab_short) as short, slab_master from ${db}SLAB_MASTER where slab_fromdt = '${desktopDate(call.tarikh1)}' and slab_active <> 'N' and book = $1 order by slab_order`, [slabBook(call.book)])).rows;
  const slabs = slabRows.map((row) => ({ key: Number(row.slab_key), short: String(row.short ?? ""), master: String(row.slab_master ?? "") === "Y" })).filter((slab) => slab.short !== "");
  const { columns: slabColumns, joins: slabJoins } = slabParts(slabs);

  const columns = (await runReportSql(loader, `select lower(table_name) as t, lower(column_name) as c, data_type as d from information_schema.columns where table_schema = $1 and table_name in ('addon_aentry', 'addon_data')`, [schema.toLowerCase()])).rows;
  const entryColumns = new Set(columns.filter((row) => row.t === "addon_aentry").map((row) => String(row.c)));
  const masterColumns = new Set(columns.filter((row) => row.t === "addon_data").map((row) => String(row.c)));
  const masterTypes = new Map(columns.filter((row) => row.t === "addon_data").map((row) => [String(row.c), String(row.d)]));

  const fields = async (where: string, params: unknown[]): Promise<AddonField[]> => (await runReportSql(loader, `select btrim(fiel_save) as save, btrim(fiel_type) as type from ${db}ADDON_FLD where fiel_relate = 'A' and fiel_pos <> 'D' and ${where} order by fiel_key`, params)).rows
    .map((row) => ({ save: String(row.save ?? ""), type: String(row.type ?? "") })).filter((field) => field.save !== "");
  const column = (field: AddonField) => `${field.type === "M" ? "txt_" : "input_"}${field.save}`.toLowerCase();
  const entryFields = (await fields(`fiel_entrypos = 'L' and position($1 in fiel_inbook) > 0`, [entryNeedle(call.book)])).filter((field) => entryColumns.has(column(field)));
  const masterFields = (await fields(`fiel_masterpos = 'Y' and fiel_entrypos = 'N' and position($1 in fiel_inbook) > 0`, [masterNeedle(call.book)])).filter((field) => masterColumns.has(column(field)));
  const numeric = (field: AddonField) => ["numeric", "integer", "smallint", "bigint", "real", "double precision", "money"].includes(masterTypes.get(`input_${field.save}`.toLowerCase()) ?? "");

  const select = invoiceSelect(db, call.licence, slabColumns, entryFields.map(entryAddonColumn), masterFields.map((field) => masterAddonColumn(field, numeric(field))));
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const table = tableFromResult(await runReportSql(loader, `select ${select} ${invoiceFrom(db, call.licence, call.fcValue, entryFields.length > 0, slabJoins, day(call.from), day(call.upto))}`));
  table.setKind("AMOUNT", "decimal");
  return table;
}
