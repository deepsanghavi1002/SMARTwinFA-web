import type { Loader } from "../master-program/load";
import { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 67: REMINDER (REPORT_REMINDER, SP_FRT_RPT_REMINDER; REPORT > Extra Report > Reminder). The reminders of the company system database
 * (smart_system.reminder): what it is for, the description, the days before, the date and the operator it belongs to, by date and then by
 * what it is for.
 *
 * The procedure builds a period and a "not an administrator: only your own reminders" condition (@var_CS_Where) but never puts it in the
 * query it runs, so on the desktop every reminder of every operator is listed whatever the period. The web does the same.
 */
export async function reminderReport(loader: Loader, _plan: ReportPlan): Promise<ResultTable> {
  const rows = (await runReportSql(loader,
    `SELECT remi.reminder_for AS "REMINDER_FOR", remi.reminder_desc AS "REMINDER_DESC", remi.reminder_day_befor AS "REMINDER_DAY_BEFORE", to_char(remi.reminder_date, 'DD/MM/YYYY') AS "REMINDER_DATE", umst.user_name AS "USER"`
    + ` FROM smart_system.reminder remi LEFT JOIN smart_system.user_master umst ON umst.user_no = remi.reminder_user ORDER BY to_char(remi.reminder_date, 'YYYYMMDD'), remi.reminder_for`)).rows;
  const table = new ResultTable();
  for (const column of ["REMINDER_FOR", "REMINDER_DESC", "REMINDER_DAY_BEFORE", "REMINDER_DATE", "USER"]) table.addColumn(column);
  table.setKind("REMINDER_DAY_BEFORE", "decimal");
  table.rows = rows.map((row) => ({ ...row, REMINDER_DAY_BEFORE: num(row.REMINDER_DAY_BEFORE) }));
  return table;
}
