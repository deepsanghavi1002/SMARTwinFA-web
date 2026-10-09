import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { type DropAddon, MONTH_NAMES, dropMeasure, dropQuery, dropWindow, pivotDrops } from "./dropAnalysisSql";
import { num, runReportSql } from "./run";

/**
 * SP_FRT_RPT_DROP_ANALYSIS (REPORT > Extra > Drop Analysis, report 232): how many drops (sale invoices, or sale lines in the Product format),
 * or what quantity or amount, each customer (or product) had on every day of the month the first combo names, with a TOTAL; the Month-wise
 * option (CHK_MONTH) shows April to March of the whole year instead. The master addon fields follow as columns. The desktop pivots a temp table
 * (TEMP_TABLE_DROP_ANALYSIS_<machine>); here the pivot is made in memory from a read-only query.
 */
export async function dropAnalysis(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const product = call.formating.toUpperCase() === "PRODUCT";
  const monthly = call.checkQuery.includes("CHK_MONTH,");
  const measure = dropMeasure(call.sortingText);
  const window = dropWindow(call.fcText, call.tarikh1.getFullYear(), call.tarikh2.getFullYear())
    ?? { from: toIso(call.from), upto: toIso(call.upto), days: Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")) };

  // The master addon fields: the product's, or the account's that belong to the sale book (' 2,' in FIEL_INBOOK).
  const columnsOf = new Set((await runReportSql(loader, `select lower(column_name) as c from information_schema.columns where table_schema = $1 and table_name = 'addon_data'`, [loader.session.companySchema.toLowerCase()])).rows.map((row) => String(row.c)));
  const addons: DropAddon[] = (await runReportSql(loader, `SELECT btrim(fiel_save) AS save, fiel_type AS kind FROM ${db}ADDON_FLD WHERE fiel_relate = $1 AND fiel_masterpos = 'Y' AND fiel_entrypos = 'N' AND fiel_pos <> 'D'${product ? "" : " AND position(' 2,' in fiel_inbook) > 0"} ORDER BY fiel_key`, [product ? "P" : "A"])).rows
    .map((row) => ({ save: toText(row.save), text: toText(row.kind) === "M" }))
    .filter((a) => /^[A-Za-z0-9_]+$/.test(a.save) && columnsOf.has(`${a.text ? "txt_" : "input_"}${a.save}`.toLowerCase()));

  const slab = !product && measure === "amount"
    ? num((await runReportSql(loader, `SELECT slab_key FROM ${db}SLAB_MASTER WHERE slab_master = 'Y' AND slab_link = 0 AND book = 8 ORDER BY slab_order LIMIT 1`)).rows[0]?.slab_key) : 0;
  const result = await runReportSql(loader, frag(dropQuery({ db, product, measure, monthly, window, slab, addons })));

  const nameColumn = product ? "Description" : "name";
  const buckets: string[] = monthly ? [...MONTH_NAMES] : window.days;
  const names = addons.map((a) => a.save);
  const lines = pivotDrops(result.rows, nameColumn, monthly ? "Month_Name" : "Day_Name", buckets, names);

  const table = new ResultTable();
  for (const column of [nameColumn, ...buckets, "TOTAL", ...names]) table.addColumn(column);
  for (const bucket of buckets) table.setKind(bucket, measure === "count" ? "int" : "decimal");
  table.setKind("TOTAL", "int");
  table.rows = lines;
  return table;
}

const toIso = (date: Date): string => desktopDate(date).replace(/^(\d+)\/(\w+)\/(\d+)$/, (_all, d, m, y) => `${y}-${String(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m) + 1).padStart(2, "0")}-${d}`);
