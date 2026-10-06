import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import type { ResultTable } from "./call";
import { sqlServerCompare } from "./formula";
import { planReport } from "./generate";
import type { ReportPlan } from "./generate";
import { buildOutput } from "./output";
import { formattedReport } from "./reportFormating";
import { standardReport } from "./reportStandard";
import type { ReportOutput, ReportSelection } from "./types";

/**
 * Report_Combine: the one program behind every REPORT menu. GenerateReport end to end: the
 * selection's checks and SQL (planReport, generate.ts), the procedure (SP_REPORT_STANDARD in
 * reportStandard.ts, or SP_REPORT_FORMATING in reportFormating.ts when a format is chosen; each
 * keeps a branch per report key, as the desktop procedures do), and the grid (buildOutput,
 * output.ts). Routines they share are in library.ts. Everything runs in one read-only transaction.
 *
 * Not ported: the report log (log_report via SP_REPORT_XMLWRITE when setup.logfile is Y or S),
 * because the screen's transaction is read-only.
 */
export async function runReport(loader: Loader, reportName: string, selection: ReportSelection): Promise<ReportOutput> {
  const started = Date.now();
  const plan = await planReport(loader, reportName, selection);
  return buildOutput(loader, plan, await reportTable(loader, plan), started);
}

/** The procedure GenerateReport calls: SP_REPORT_FORMATING for a format other than the first, else SP_STD_REPORT. */
function reportTable(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  return plan.call.formating !== "" ? formattedReport(loader, plan) : standardReport(loader, plan);
}

/**
 * Create Group (ResetGroupReport, then Btn_Generate_Click): the same report as entries only
 * (ROW_DATA_TYPE LED), with SELECTED_NAME in place of NAME, grouped afresh on the fields the
 * operator chose (SetNameOnLabel: a field's SMART_ column when there is one, SELECTED_DATE as
 * SORTING_DATE). The rows are sorted on the groups, the closing balance runs within them, and a
 * subtotal goes under each; with no group only the final total is added.
 */
export async function runGroupedReport(loader: Loader, reportName: string, selection: ReportSelection, fields: readonly string[]): Promise<ReportOutput> {
  const started = Date.now();
  const plan = await planReport(loader, reportName, selection);
  const table = await reportTable(loader, plan);

  const selectedName = table.name("SELECTED_NAME");
  const name = table.name("NAME");
  if (selectedName) {
    if (name) { for (const row of table.rows) row[name] = row[selectedName]; }
    else { table.addColumn("NAME"); for (const row of table.rows) row.NAME = row[selectedName]; }
  }
  if (table.has("ROW_DATA_TYPE")) table.rows = table.rows.filter((row) => toText(table.get(row, "ROW_DATA_TYPE")).toUpperCase() === "LED");

  const grouping = fields.map((field) => (table.has(`SMART_${field}`) ? table.name(`SMART_${field}`)! : field.toUpperCase() === "SELECTED_DATE" ? "SORTING_DATE" : field))
    .filter((field, index, list) => table.has(field) && list.indexOf(field) === index);
  if (grouping.length > 0) {
    const columns = grouping.map((field) => table.name(field)!);
    const indexed = table.rows.map((row, index) => ({ row, index }));
    indexed.sort((a, b) => {
      for (const column of columns) {
        const x = a.row[column];
        const y = b.row[column];
        const order = table.kind(column) !== "text" && typeof x !== "string" && typeof y !== "string"
          ? Number(x ?? 0) - Number(y ?? 0)
          : sqlServerCompare(x === null || x === undefined ? null : toText(x instanceof Date ? x.toISOString() : x), y === null || y === undefined ? null : toText(y instanceof Date ? y.toISOString() : y));
        if (order !== 0) return order;
      }
      return a.index - b.index;
    });
    table.rows = indexed.map((entry) => entry.row);
  }
  plan.grouping.splice(0, plan.grouping.length, ...grouping);
  return buildOutput(loader, plan, table, started);
}
