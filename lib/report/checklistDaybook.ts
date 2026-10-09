import type { Loader } from "../master-program/load";
import type { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./generate";
import { tableFromResult } from "./library";
import { entryAddonColumn, inBookNeedle, MASTER_NEEDLE, masterAddonColumn, checklistFrom, checklistSelect } from "./checklistDaybookSql";
import type { AddonField } from "./checklistDaybookSql";
import { runReportSql } from "./run";

/**
 * SP_FRT_RPT_CHECKLIST_DAYBOOK: every voucher of a cash, discount or bank book (or of all three) in
 * the period, for checking: date, voucher, (cheque, cheque date, reconciled date), account, schedule,
 * receipt, payment, the entry addon fields of the book, the account's master addon fields, narration.
 * It is the cash book's lines with nothing summed, no opening and no balance.
 *
 * Where the desktop's SQL cannot run on this database the web does what it meant: an addon field
 * whose column is not on ADDON_AENTRY / ADDON_DATA is left out (SQL Server would stop with an
 * invalid column), and a number addon column of the account master is 0 when empty, as '' becomes 0.
 */
export async function checklistDaybook(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const schema = loader.session.companySchema;
  if (call.book >= 0 && ![4, 5, 6].includes(call.book)) throw new ReportRefusal("Checklist Daybook is only for a cash, discount or bank book", "INTERNAL PROGRAM FAILURE");
  if (call.book >= 0 && !(call.fcValue > 0)) throw new ReportRefusal("Select the book (Daybook).", "No Selections Done!");

  // One query at a time: runReportSql keeps a savepoint per statement on the one connection, so overlapping statements release each other's.
  const columns = (await runReportSql(loader, `select lower(table_name) as t, lower(column_name) as c, data_type as d from information_schema.columns where table_schema = $1 and table_name in ('addon_aentry', 'addon_data')`, [schema.toLowerCase()])).rows;
  const entryColumns = new Set(columns.filter((row) => row.t === "addon_aentry").map((row) => String(row.c)));
  const masterColumns = new Set(columns.filter((row) => row.t === "addon_data").map((row) => String(row.c)));
  const masterTypes = new Map(columns.filter((row) => row.t === "addon_data").map((row) => [String(row.c), String(row.d)]));

  const fields = async (where: string, params: unknown[]): Promise<AddonField[]> => (await runReportSql(loader, `select btrim(fiel_save) as save, btrim(fiel_type) as type from ${db}ADDON_FLD where fiel_pos <> 'D' and ${where} order by fiel_key`, params)).rows
    .map((row) => ({ save: String(row.save ?? ""), type: String(row.type ?? "") })).filter((field) => field.save !== "");
  const entryFields = (await fields(`(position($1 in fiel_inbook) > 0 or position('AUTONAR,' in fiel_err) > 0)`, [inBookNeedle(call.book)]))
    .filter((field) => entryColumns.has(`${field.type === "M" ? "txt_" : "input_"}${field.save}`.toLowerCase()));
  const masterFields = (await fields(`fiel_relate = 'A' and fiel_masterpos = 'Y' and fiel_entrypos = 'N' and position($1 in fiel_inbook) > 0`, [MASTER_NEEDLE]))
    .filter((field) => masterColumns.has(`${field.type === "M" ? "txt_" : "input_"}${field.save}`.toLowerCase()));

  const numeric = (field: AddonField) => ["numeric", "integer", "smallint", "bigint", "real", "double precision", "money"].includes(masterTypes.get(`input_${field.save}`.toLowerCase()) ?? "");
  const select = checklistSelect(call.book, entryFields.map(entryAddonColumn), masterFields.map((field) => masterAddonColumn(field, numeric(field))));
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const sql = `select ${select} ${checklistFrom(db, call.book, call.fcValue, entryFields.length > 0, day(call.from), day(call.upto))}`;

  const table = tableFromResult(await runReportSql(loader, sql));
  for (const column of ["RECEIPT", "PAYMENT"]) table.setKind(column, "decimal");
  return table;
}
