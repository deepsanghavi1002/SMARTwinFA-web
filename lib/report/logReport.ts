import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 50: LOGFILE (REPORT_LOG_REPORT, SP_FRT_RPT_LOG_REPORT; UTILITY > Logfile). The first combo says what the log is of: ACCOUNT (1), PRODUCT (2),
 * ENTRY (3), TRANSACTION (4), ADDON (5), REPORT (6), OTHER ENTRY (7); the format is All, Add, Edit or Delete; the users ticked in the help grid limit it.
 *
 * With the company's setup LOGFILE = 'S' (special log) the account, product, entry, addon and other entry logs are read from <company>_biglog (the
 * Add rows of the period, All shows the Add rows only, each with how many times the record was edited and deleted, counted over the whole log);
 * otherwise from the company's own log tables (LOG_MASTER, LOG_LEDGER, LOG_SMALL_ENTRY). The transaction and report logs have the one form.
 * The procedure builds a work table per machine (TEMP_TABLE_LOG_..._<machine>); the web reads the rows straight from the log tables.
 *
 * Where the procedure's own SQL names a column that its table does not have, the web uses the one that is meant (the addon log of the special log
 * filters LOG_ALLMASTER on lmst_logmode / lmst_loguser, which are LOG_MASTER's: here lmaster_mode / lmaster_user). Where this database's
 * <company>_biglog.log_smallentry lacks the columns the other entry log reads (lsmall_pkv, from, upto, filter, group, mode), they show blank.
 */
type Kind = "decimal" | "int";
type Spec = Readonly<{ columns: readonly string[]; kinds?: Readonly<Record<string, Kind>>; rows: readonly ResultRow[] }>;

/** A result table from rows whose keys are the columns' names in lower case. */
function tableOf(spec: Spec): ResultTable {
  const table = new ResultTable();
  for (const column of spec.columns) table.addColumn(column);
  for (const [column, kind] of Object.entries(spec.kinds ?? {})) table.setKind(column, kind);
  table.rows = spec.rows.map((row) => {
    const out: ResultRow = {};
    for (const column of spec.columns) out[column] = spec.kinds?.[column] !== undefined ? num(row[column.toLowerCase()]) : row[column.toLowerCase()];
    return out;
  });
  return table;
}

export async function logReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const schema = loader.session.companySchema;
  const log = `${schema}_biglog`;
  const first = call.fcValue;
  if (first < 1 || first > 7) throw new ReportRefusal("Select what the log is of first.", "Logfile");

  const format = call.formating.toUpperCase();
  const mode = format === "" || format === "ALL" ? "ALL" : format.slice(0, 1);
  const users = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4]) ? call.selectKey[4] : "";
  const period = [desktopDate(call.from), desktopDate(call.upto)];
  const special = num(((await runReportSql(loader, `SELECT count(*) AS n FROM ${schema}.setup WHERE logfile = 'S'`)).rows[0]?.n) ?? 0) > 0;
  const rows = async (sql: string) => (await runReportSql(loader, sql, period)).rows;
  /** The mode and user conditions; with All and `allMeans` (the special log), the Add rows only. */
  const filters = (modeColumn: string | null, userColumn: string, allMeans: string | null = null) => {
    let text = "";
    if (modeColumn !== null && mode !== "ALL") text += ` AND ${modeColumn} = '${mode}'`;
    else if (allMeans !== null) text += ` AND ${allMeans}`;
    if (users !== "") text += ` AND ${userColumn} IN ${users}`;
    return text;
  };
  const modeName = (column: string) => `CASE WHEN ${column} = 'A' THEN 'Add' WHEN ${column} = 'E' THEN 'Edit' ELSE 'Delete' END`;
  const day = (column: string) => `to_char(${column}, 'DD/MM/YYYY')`;
  /** The edit and delete counts of a record over the whole special log of a master (program) id. */
  const masterCounts = (where: string) => `cnt AS (SELECT lmaster_id, lmaster_code, sum(CASE WHEN coalesce(lmaster_mode, '') = 'E' THEN 1 ELSE 0 END) AS edit_count, sum(CASE WHEN coalesce(lmaster_mode, '') = 'D' THEN 1 ELSE 0 END) AS delete_count FROM ${log}.log_allmaster WHERE ${where} GROUP BY lmaster_id, lmaster_code)`;

  // 1: ACCOUNT, 2: PRODUCT (the same log, of master 14 / 8)
  if (first === 1 || first === 2) {
    const account = first === 1;
    const topId = account ? 14 : 8;
    if (!special) {
      const columns = account ? ["LOG_DATE", "LOG_TIME", "SHORT", "NAME", "BOOK", "OPENING", "ENTRY_MODE", "USER_NAME", "COMPUTER_NAME"] : ["LOG_DATE", "LOG_TIME", "SHORT", "DESCRIPTION", "OPENING", "ENTRY_MODE", "USER_NAME", "COMPUTER_NAME"];
      const body = account
        ? "lled.lmst_short AS short, CASE WHEN lled.lmst_name IS NULL THEN ac.name ELSE lled.lmst_name END AS name, bkpro.book_desc AS book,"
        : "CASE WHEN lled.lmst_short IS NULL THEN product.prod_short ELSE lled.lmst_short END AS short, CASE WHEN lled.lmst_name IS NULL THEN product.prod_desc ELSE lled.lmst_name END AS description,";
      const joins = account
        ? `LEFT JOIN ${schema}.account ac ON ac.code = lled.lmst_pk LEFT JOIN smart_system.user_master us ON us.user_no = lled.lmst_loguser LEFT JOIN ${schema}.book_properties bkpro ON bkpro.book_key = ac.book`
        : `LEFT JOIN ${schema}.product_master product ON product.prod_key = lled.lmst_pk LEFT JOIN smart_system.user_master us ON us.user_no = lled.lmst_loguser`;
      return tableOf({ columns, kinds: { OPENING: "decimal" }, rows: await rows(`SELECT ${day("lled.lmst_logdate")} AS log_date, lled.lmst_logtime AS log_time, ${body} lled.lmst_opening::numeric AS opening, (${modeName("lled.lmst_logmode")}) AS entry_mode,`
        + ` us.user_name, coalesce(lled.lmst_machine_name, '') AS computer_name FROM ${schema}.log_master lled ${joins} WHERE lled.lmst_logdate >= $1::date AND lled.lmst_logdate <= $2::date AND lmst_top_id = ${topId}${filters("lled.lmst_logmode", "lled.lmst_loguser")}`
        + ` ORDER BY ${account ? "bkpro.book_desc, lmst_logdate, lled.lmst_name" : "lmst_logdate, lled.lmst_name"}`) });
    }
    const columns = ["LMASTER_ID", "LOG_CODE", "LOG_DATE", "LOG_TIME", "SHORT", account ? "NAME" : "DESCRIPTION", "OPENING", ...(account ? ["BOOK_NAME"] : []), "ENTRY_MODE", "USER_NAME", "COMPUTER_NAME", "EDIT_COUNT", "DELETE_COUNT"];
    return tableOf({ columns, kinds: { LMASTER_ID: "int", OPENING: "decimal", EDIT_COUNT: "int", DELETE_COUNT: "int" }, rows: await rows(`WITH base AS (SELECT * FROM ${log}.log_allmaster WHERE lmaster_id = ${topId} AND lmaster_savedate >= $1::date AND lmaster_savedate < $2::date + 1), ${masterCounts(`lmaster_id = ${topId}`)}`
      + ` SELECT lled.lmaster_id, lled.lmaster_code AS log_code, ${day("lled.lmaster_savedate")} AS log_date, lled.lmaster_savetime AS log_time, lled.lmaster_short AS short, lled.lmaster_name AS ${account ? "name" : "description"}, lled.lmaster_opening AS opening,`
      + `${account ? " lled.lmaster_firstname AS book_name," : ""} ${modeName("lled.lmaster_mode")} AS entry_mode, us.user_name, coalesce(lled.lmaster_machine_name, '') AS computer_name, coalesce(c.edit_count, 0) AS edit_count, coalesce(c.delete_count, 0) AS delete_count`
      + ` FROM base lled LEFT JOIN smart_system.user_master us ON us.user_no = lled.lmaster_user LEFT JOIN cnt c ON c.lmaster_id = lled.lmaster_id AND c.lmaster_code = lled.lmaster_code WHERE 1 = 1${filters("lled.lmaster_mode", "lled.lmaster_user", "lled.lmaster_mode = 'A'")}`
      + " ORDER BY lled.lmaster_firstname, lled.lmaster_savedate, lled.lmaster_name") });
  }

  // 3: ENTRY
  if (first === 3) {
    if (!special) {
      return tableOf({ columns: ["LOG_DATE", "LOG_TIME", "DOC_DATE", "DOC_NO", "NAME", "AMOUNT", "ENTRY_MODE", "USER_NAME", "COMPUTER_NAME"], kinds: { AMOUNT: "decimal" }, rows: await rows(
        `SELECT ${day("lled.lled_logdate")} AS log_date, lled.lled_logtime AS log_time, ${day("lled.lled_docdate")} AS doc_date, lled.lled_fulldocno AS doc_no, ac.name, lled.lled_amount::numeric AS amount, (${modeName("lled.lled_logmode")}) AS entry_mode,`
        + ` us.login_name AS user_name, coalesce(lled.lled_machine_name, '') AS computer_name FROM ${schema}.log_ledger lled LEFT JOIN ${schema}.account ac ON ac.code = lled.lled_code LEFT JOIN smart_system.user_master us ON us.user_no = lled.lled_loguser`
        + ` LEFT JOIN ${schema}.ledger led ON led.led_key = lled.lled_id WHERE lled.lled_logdate >= $1::date AND lled.lled_logdate <= $2::date${filters("lled.lled_logmode", "lled.lled_loguser")} ORDER BY lled_docdate, led.doc_no, lled_logdate`) });
    }
    return tableOf({ columns: ["SMART_LED_KEY", "SMART_PROCESS_KEY", "LOG_DATE", "LOG_TIME", "DOC_DATE", "DOC_NO", "NAME", "AMOUNT", "ENTRY_MODE", "USER_NAME", "COMPUTER_NAME", "EDIT_COUNT", "DELETE_COUNT"],
      kinds: { SMART_LED_KEY: "int", SMART_PROCESS_KEY: "int", AMOUNT: "decimal", EDIT_COUNT: "int", DELETE_COUNT: "int" }, rows: await rows(
        `WITH base AS (SELECT * FROM ${log}.log_entry WHERE lentry_savedate >= $1::date AND lentry_savedate < $2::date + 1),`
        + ` cnt AS (SELECT lentry_code, CASE WHEN coalesce(lentry_ledid, 0) > 0 THEN lentry_ledid ELSE 0 END AS ledid, CASE WHEN coalesce(lentry_processid, 0) > 0 THEN lentry_processid ELSE 0 END AS processid,`
        + ` sum(CASE WHEN coalesce(lentry_mode, '') = 'E' THEN 1 ELSE 0 END) AS edit_count, sum(CASE WHEN coalesce(lentry_mode, '') = 'D' THEN 1 ELSE 0 END) AS delete_count FROM ${log}.log_entry`
        + ` GROUP BY lentry_code, CASE WHEN coalesce(lentry_ledid, 0) > 0 THEN lentry_ledid ELSE 0 END, CASE WHEN coalesce(lentry_processid, 0) > 0 THEN lentry_processid ELSE 0 END)`
        + ` SELECT CASE WHEN coalesce(led.led_key, 0) > 0 THEN led.led_key ELSE 0 END AS smart_led_key, CASE WHEN coalesce(led.led_key, 0) > 0 THEN 0 ELSE proce.process_key END AS smart_process_key, ${day("lled.lentry_savedate")} AS log_date, lled.lentry_savetime AS log_time,`
        + ` CASE WHEN coalesce(led.led_key, 0) > 0 THEN ${day("led.doc_date")} ELSE ${day("proce.p_date")} END AS doc_date, CASE WHEN coalesce(led.led_key, 0) > 0 THEN led.full_docno ELSE proce.full_docno END AS doc_no, ac.name,`
        + ` CASE WHEN coalesce(led.led_key, 0) > 0 THEN led.amount::numeric ELSE proce.p_amount::numeric END AS amount, ${modeName("lled.lentry_mode")} AS entry_mode, us.login_name AS user_name, coalesce(lled.lentry_machine_name, '') AS computer_name,`
        + ` coalesce(c.edit_count, 0) AS edit_count, coalesce(c.delete_count, 0) AS delete_count FROM base lled LEFT JOIN ${schema}.account ac ON ac.code = lled.lentry_code LEFT JOIN smart_system.user_master us ON us.user_no = lled.lentry_user`
        + ` LEFT JOIN ${schema}.ledger led ON led.led_key = lled.lentry_ledid LEFT JOIN ${schema}.process proce ON proce.process_key = lled.lentry_processid LEFT JOIN cnt c ON c.lentry_code = lled.lentry_code`
        + ` AND c.ledid = CASE WHEN coalesce(lled.lentry_ledid, 0) > 0 THEN lled.lentry_ledid ELSE 0 END AND c.processid = CASE WHEN coalesce(lled.lentry_processid, 0) > 0 THEN lled.lentry_processid ELSE 0 END`
        + ` WHERE 1 = 1${filters("lled.lentry_mode", "lled.lentry_user", "lled.lentry_mode = 'A'")} ORDER BY lled.lentry_savedate, lled.lentry_savetime, led.doc_date, led.doc_no`) });
  }

  // 4: TRANSACTION
  if (first === 4) {
    return tableOf({ columns: ["LOG_DATE", "LOG_TIME", "DOC_DATE", "DOC_NO", "PARTY_NAME", "PROD_DESC", "QUANTITY", "RATE", "AMOUNT", "ADD_LESS", "UOM", "ENTRY_MODE", "USER_NAME"], kinds: { QUANTITY: "decimal", RATE: "decimal", AMOUNT: "decimal" }, rows: await rows(
      `SELECT ${day("lreg.lreg_logdate")} AS log_date, lreg.lreg_logtime AS log_time, ${day("lreg.lreg_date")} AS doc_date, pled.full_docno AS doc_no, ac.name AS party_name, product.prod_desc, lreg.lreg_quantity::numeric AS quantity, lreg.lreg_rate::numeric AS rate,`
      + ` lreg.lreg_value::numeric AS amount, (CASE WHEN lreg.lreg_stocknat = 'A' THEN 'Add' ELSE 'Less' END) AS add_less, puom.uom_short AS uom, (${modeName("lreg.lreg_logmode")}) AS entry_mode, us.login_name AS user_name`
      + ` FROM ${schema}.log_regtrn lreg LEFT JOIN ${schema}.prod_ledger pled ON pled.il_key = lreg.lreg_id LEFT JOIN smart_system.user_master us ON us.user_no = lreg.lreg_loguser LEFT JOIN ${schema}.prod_uom puom ON puom.uom_key = lreg.lreg_rateuom`
      + ` LEFT JOIN ${schema}.account ac ON ac.code = lreg.lreg_code LEFT JOIN ${schema}.product_master product ON product.prod_key = lreg.lreg_prodid WHERE lreg.lreg_logdate >= $1::date AND lreg.lreg_logdate <= $2::date${filters("lreg.lreg_logmode", "lreg.lreg_loguser")}`
      + " ORDER BY lreg.lreg_date, pled.full_docno, lreg_logdate") });
  }

  // 5: ADDON
  if (first === 5) {
    if (!special) {
      return tableOf({ columns: ["LOG_DATE", "LOG_TIME", "SHORT", "NAME", "ADDON_TYPE", "ENTRY_MODE", "USER_NAME", "COMPUTER_NAME"], rows: (await rows(
        `SELECT ${day("lled.lmst_logdate")} AS log_date, lled.lmst_logtime AS log_time, lled.lmst_short AS short, lled.lmst_name AS name, afld.fiel_desc AS addon_type, (${modeName("lled.lmst_logmode")}) AS entry_mode, us.user_name, coalesce(lled.lmst_machine_name, '') AS computer_name`
        + ` FROM ${schema}.log_master lled LEFT JOIN ${schema}.addon_sub asub ON asub.sub_code = lled.lmst_pk LEFT JOIN smart_system.user_master us ON us.user_no = lled.lmst_loguser LEFT JOIN ${schema}.addon_fld afld ON afld.fiel_key = asub.para_id`
        + ` WHERE lled.lmst_logdate >= $1::date AND lled.lmst_logdate <= $2::date AND lmst_top_id <> 8 AND lmst_top_id <> 14 AND lmst_pk > 0${filters("lled.lmst_logmode", "lled.lmst_loguser")} ORDER BY afld.fiel_desc, lmst_logdate, lled.lmst_name`))
        .filter((row) => toText(row.addon_type) !== "") });
    }
    return tableOf({ columns: ["LMASTER_ID", "LOG_CODE", "LOG_DATE", "LOG_TIME", "MASTER_NAME", "SHORT", "NAME", "MASTER_TYPE", "ENTRY_MODE", "USER_NAME", "COMPUTER_NAME", "EDIT_COUNT", "DELETE_COUNT"], kinds: { LMASTER_ID: "int", EDIT_COUNT: "int", DELETE_COUNT: "int" }, rows: await rows(
      `WITH ${masterCounts("true")} SELECT lled.lmaster_id, lled.lmaster_code AS log_code, ${day("lled.lmaster_savedate")} AS log_date, lled.lmaster_savetime AS log_time, mastmenu.screen_heading AS master_name, lled.lmaster_short AS short, lled.lmaster_name AS name,`
      + ` lled.lmaster_firstname AS master_type, ${modeName("lled.lmaster_mode")} AS entry_mode, us.user_name, coalesce(lled.lmaster_machine_name, '') AS computer_name, coalesce(c.edit_count, 0) AS edit_count, coalesce(c.delete_count, 0) AS delete_count`
      + ` FROM ${log}.log_allmaster lled LEFT JOIN smart_system.user_master us ON us.user_no = lled.lmaster_user LEFT JOIN smart_setup.program_top mastmenu ON mastmenu.program_top_key = lled.lmaster_id LEFT JOIN cnt c ON c.lmaster_id = lled.lmaster_id AND c.lmaster_code = lled.lmaster_code`
      + ` WHERE lled.lmaster_savedate >= $1::date AND lled.lmaster_savedate < $2::date + 1 AND lled.lmaster_id <> 8 AND lled.lmaster_id <> 14 AND lled.lmaster_code > 0${filters("lled.lmaster_mode", "lled.lmaster_user", "lled.lmaster_mode = 'A'")} ORDER BY lmaster_savedate, lled.lmaster_name`) });
  }

  // 6: REPORT
  if (first === 6) {
    return tableOf({ columns: ["REPORT NAME", "LOG_DATE", "LOG_TIME", "DATE_FROM", "DATE_UPTO", "FIRST_COMBO", "GROUP", "FILTER", "SORTING", "FORMAT", "REPORT_MODE", "USER_NAME", "COMPUTER_NAME"], rows: await rows(
      `SELECT rep.report_head AS "report name", ${day("lrep.lrep_logdate")} AS log_date, lrep.lrep_logtime AS log_time, ${day("lrep.lrep_repfrom")} AS date_from, ${day("lrep.lrep_repupto")} AS date_upto, lrep.lrep_fc_selection AS first_combo, lrep.lrep_group AS "group",`
      + ` lrep.lrep_filter AS filter, lrep.lrep_sorting AS sorting, lrep.lrep_format AS format, (CASE WHEN lrep.lrep_logmode = 'S' THEN 'Screen' WHEN lrep.lrep_logmode = 'P' THEN 'Print' WHEN lrep.lrep_logmode = 'D' THEN 'Pdf' WHEN lrep.lrep_logmode = 'R' THEN 'Preview' ELSE 'Export' END) AS report_mode,`
      + ` us.user_name, coalesce(lrep.lrep_machine_name, '') AS computer_name FROM ${schema}.log_report lrep LEFT JOIN smart_setup.report_properties rep ON rep.report_key = lrep.lrep_id LEFT JOIN smart_system.user_master us ON us.user_no = lrep.lrep_loguser`
      + ` WHERE lrep.lrep_logdate >= $1::date AND lrep.lrep_logdate <= $2::date${users !== "" ? ` AND lrep.lrep_loguser IN ${users}` : ""} ORDER BY lrep_logdate`) });
  }

  // 7: OTHER ENTRY
  if (!special) {
    // An entry saved grid row by grid row writes a log row for every row (4.1 million of them in a year of one company), all alike in the columns shown:
    // alike lines are listed once, with how many rows they saved (ROWS_SAVED), which is what makes the list fast.
    return tableOf({ columns: ["ENTRY NAME", "LOG_DATE", "LOG_TIME", "DATE_FROM", "DATE_UPTO", "FIRST_COMBO", "ENTRY_MODE", "USER_NAME", "COMPUTER_NAME", "ROWS_SAVED"], kinds: { ROWS_SAVED: "int" }, rows: await rows(
      `SELECT rep.entry_status_head AS "entry name", ${day("lrep.lsent_logdate")} AS log_date, lrep.lsent_logtime AS log_time, ${day("lrep.lsent_from")} AS date_from, ${day("lrep.lsent_upto")} AS date_upto, lrep.lsent_fc_selection AS first_combo, lrep.lsent_filter AS entry_mode,`
      + ` us.user_name, coalesce(lrep.lsent_machine_name, '') AS computer_name, count(*) AS rows_saved FROM ${schema}.log_small_entry lrep LEFT JOIN smart_setup.entry_properties rep ON rep.entry_key = lrep.lsent_id LEFT JOIN smart_system.user_master us ON us.user_no = lrep.lsent_loguser`
      + ` WHERE lrep.lsent_logdate >= $1::date AND lrep.lsent_logdate <= $2::date${users !== "" ? ` AND lrep.lsent_loguser IN ${users}` : ""}`
      + ` GROUP BY rep.entry_status_head, lrep.lsent_logdate, lrep.lsent_logtime, lrep.lsent_from, lrep.lsent_upto, lrep.lsent_fc_selection, lrep.lsent_filter, us.user_name, lrep.lsent_machine_name ORDER BY lrep.lsent_logdate, lrep.lsent_logtime`) });
  }
  const have = new Set((await runReportSql(loader, "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'log_smallentry'", [log])).rows.map((row) => toText(row.column_name).toLowerCase()));
  const col = (name: string, alias: string) => `${have.has(name) ? `lrep.${name}` : "NULL"} AS ${alias}`;
  const dayOf = (name: string, alias: string) => `${have.has(name) ? day(`lrep.${name}`) : "NULL"} AS ${alias}`;
  const modeCondition = have.has("lsmall_mode") ? (mode !== "ALL" ? ` AND lrep.lsmall_mode = '${mode}'` : " AND lrep.lsmall_mode IN ('A', 'D')") : "";
  const edits = have.has("lsmall_pkv")
    ? `cnt AS (SELECT lsmall_smallid, lsmall_pkv, count(*) AS edit_count FROM ${log}.log_smallentry WHERE coalesce(lsmall_mode, '') = 'E' GROUP BY lsmall_smallid, lsmall_pkv)`
    : "cnt AS (SELECT NULL::int AS lsmall_smallid, NULL::text AS lsmall_pkv, 0 AS edit_count WHERE false)";
  const join = have.has("lsmall_pkv") ? "LEFT JOIN cnt c ON c.lsmall_smallid = lrep.lsmall_smallid AND c.lsmall_pkv = lrep.lsmall_pkv" : "LEFT JOIN cnt c ON false";
  return tableOf({ columns: ["LSMALL_PKV", "LMASTER_ID", "ENTRY_NAME", "LOG_DATE", "LOG_TIME", "DATE_FROM", "DATE_UPTO", "FIRST_COMBO", "ENTRY_MODE", "ENTRY_GROUP", "USER_NAME", "COMPUTER_NAME", "EDIT_COUNT"], kinds: { LMASTER_ID: "int", EDIT_COUNT: "int" }, rows: await rows(
    `WITH base AS (SELECT * FROM ${log}.log_smallentry WHERE lsmall_savedate >= $1::date AND lsmall_savedate < $2::date + 1), ${edits}`
    + ` SELECT ${col("lsmall_pkv", "lsmall_pkv")}, lrep.lsmall_smallid AS lmaster_id, rep.entry_status_head AS entry_name, ${day("lrep.lsmall_savedate")} AS log_date, lrep.lsmall_savetime AS log_time, ${dayOf("lsmall_from", "date_from")}, ${dayOf("lsmall_upto", "date_upto")},`
    + ` ${have.has("lsmall_fc_selection") ? "lrep.lsmall_fc_selection" : "lrep.lsmall_firstname"} AS first_combo, ${col("lsmall_filter", "entry_mode")}, ${col("lsmall_group", "entry_group")}, us.user_name, coalesce(lrep.lsmall_machine_name, '') AS computer_name, coalesce(c.edit_count, 0) AS edit_count`
    + ` FROM base lrep LEFT JOIN smart_setup.entry_properties rep ON rep.entry_key = lrep.lsmall_smallid LEFT JOIN smart_system.user_master us ON us.user_no = lrep.lsmall_user ${join} WHERE 1 = 1${users !== "" ? ` AND lrep.lsmall_user IN ${users}` : ""}${modeCondition} ORDER BY lrep.lsmall_savedate`) });
}
