import { Loader } from "../master-program/load";
import { securityRead, securityWrite, toInt, toText } from "../master-program/legacy";
import { readRights, SETUP_SCHEMA, SYSTEM_SCHEMA } from "../master-program/session";
import type { MasterSession } from "../master-program/session";
import { blankCoalesceAsText } from "../master-program/sql";
import { desktopDate } from "./formula";
import { literal, setBooksValueInString, setupSelect } from "./sqlText";

export { setBooksValueInString, setupSelect };
import type { ControlItem, HelpColumn, HelpGrid, ReportCheckbox, ReportControl, ReportDefinition, RuntimeControl } from "./types";

/**
 * Report_Combine_Load: everything the selection tab shows, read from setup. The desktop reads the
 * same rows from the tables it cached at login (Z_LoginScreen: report_properties, report_control,
 * report_controlval, report_checkbox where chk_active, report_outputcol, fix_columns,
 * help_properties, runtime_controls), and fills its lists through SP_FILL_RPT_CONTROL and its help
 * grids through SP_SMART_HELP; both are ported here (fillControl, smartHelp) rather than called,
 * because their PostgreSQL copies write tables into smart_setup.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name));
const flag = (row: Row | undefined, name: string) => {
  const value = field(row, name);
  return value === true || ["1", "true", "y"].includes(toText(value).toLowerCase());
};

/** Reports whose output is ported (their SP_REPORT_STANDARD branch and Report_Combine's handling of it). */
export const PORTED_REPORTS: ReadonlySet<number> = new Set([4]);

/** The help grid each help id fills, when report_controlval does not name one (UNKNOWN_HELP_GRID). */
const KEY_COLUMN: Readonly<Record<string, string>> = {
  C1HelpAccount: "code",
  C1HelpBook: "book_key",
  C1HelpSchedule: "bs_key",
  C1HelpAddon: "sub_code",
  C1HelpProduct: "prod_key",
  C1HelpProductGroup: "idopt_key",
};




/** smart_setup.report_properties for one report_name. */
export async function readReportProperties(loader: Loader, reportName: string): Promise<Row> {
  const row = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.report_properties WHERE BTRIM(report_name) = $1`, [reportName]))?.[0];
  if (!row) throw new Error(`Report ${reportName} is not set up (smart_setup.report_properties)`);
  return row;
}

/**
 * SP_FILL_RPT_CONTROL: a control's items from report_controlval (display_order), and which help
 * grids its items fill. A fixed item (F) gets VALUE_COL -1, -2 ...; a query item (Q) runs its
 * query_table query, whose columns are taken by position (CON_VAL, DISPLAY_COL, VALUE_COL, EXTRA_1-5).
 */
export async function fillControl(loader: Loader, reportKey: number, controlKey: number): Promise<{ items: ControlItem[]; helps: { helpId: string; grid: string; frozen: number }[] }> {
  const { session } = loader;
  const values = await loader.readTable(
    `SELECT rep_controlval_key, display_type, display_fixvalue, display_query, display_help, display_help_query, visible_controls_lst
       FROM ${SETUP_SCHEMA}.report_controlval WHERE rep_properties_id = $1 AND rep_control_id = $2 ORDER BY display_order`,
    [reportKey, controlKey],
  ) ?? [];
  const items: ControlItem[] = [];
  const helps: { helpId: string; grid: string; frozen: number }[] = [];
  let counter = -1;
  for (const value of values) {
    const key = toInt(field(value, "rep_controlval_key"));
    const type = text(value, "display_type").toUpperCase();
    if (type === "F") {
      items.push({ controlValKey: key, text: text(value, "display_fixvalue"), value: String(counter), extra: ["", "", "", "", ""], showControls: text(value, "visible_controls_lst") });
      counter -= 1;
    } else if (type === "Q" && text(value, "display_query") !== "") {
      const query = toText(field((await loader.readTable(`SELECT query_string FROM ${SETUP_SCHEMA}.query_table WHERE query_prog_id = $1`, [text(value, "display_query")]))?.[0], "query_string"));
      if (query !== "") {
        const sql = literal(literal(query, "|sys.tarikh1|", desktopDate(session.tarikh1)), "|sys.tarikh2|", desktopDate(session.tarikh2))
          .split("|sys.control_val_key|").join(String(key))
          .split("|sys.afterctestmnts|").join("");
        for (const row of await loader.readTable(setupSelect(sql)) ?? []) {
          const cells = Object.values(row).map((cell) => toText(cell));
          items.push({ controlValKey: key, text: cells[1] ?? "", value: cells[2] ?? "", extra: [cells[3] ?? "", cells[4] ?? "", cells[5] ?? "", cells[6] ?? "", cells[7] ?? ""], showControls: text(value, "visible_controls_lst") });
        }
      }
    }
    const helpId = flag(value, "display_help") ? text(value, "display_help_query") : "";
    if (helpId !== "") {
      const frozen = field((await loader.readTable(`SELECT help_col_frozen FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = $1`, [helpId]))?.[0], "help_col_frozen");
      helps.push({ helpId, grid: text(value, "visible_controls_lst") || "UNKNOWN_HELP_GRID", frozen: frozen === null || frozen === undefined ? -1 : toInt(frozen) });
    }
  }
  return { items, helps };
}

/** smart_setup.fn_gethelpquery: "sys.fn|HELP_PRODUCT|" names another help_table row. */
async function helpQuery(loader: Loader, helpId: string): Promise<{ sql: string; frozen: number } | null> {
  const row = (await loader.readTable(`SELECT help_query, help_col_frozen FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = $1`, [helpId]))?.[0];
  if (!row) return null;
  let sql = text(row, "help_query");
  if (sql.toLowerCase().startsWith("sys.fn|")) {
    const target = sql.split("|")[1];
    sql = toText(field((await loader.readTable(`SELECT help_query FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = $1`, [target]))?.[0], "help_query")) || sql;
  }
  return { sql, frozen: toInt(field(row, "help_col_frozen")) };
}

/**
 * SP_SMART_HELP. |sys.replace_acaddon| becomes the account addons marked account_help (stored
 * 'TRUE' on SQL Server, '1' here), |sys.achelpbook| the book list Report_Combine.FillGrid passes
 * (books 1 to 19). The procedure puts |sys.yearid| and the dates in unquoted (SQL Server converts
 * them); here they are quoted literals.
 */
export async function smartHelp(loader: Loader, helpId: string, bookList = " 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19"): Promise<{ rows: Row[]; frozen: number } | null> {
  const { session } = loader;
  const found = await helpQuery(loader, helpId);
  if (!found) return null;
  let sql = found.sql;
  if (sql.includes("|sys.replace_acaddon|")) {
    const addons = await loader.readTable(
      `SELECT fiel_save FROM ${session.companySchema}.addon_fld WHERE UPPER(BTRIM(COALESCE(account_help::text, ''))) IN ('TRUE', '1', 'Y') AND fiel_relate = 'A' AND fiel_type = 'M' AND fiel_pos <> 'D'`,
    ) ?? [];
    const columns = addons.map((addon) => {
      const name = text(addon, "fiel_save");
      return `CASE WHEN ADATA.TXT_${name} IS NULL THEN '' ELSE LTRIM(RTRIM(ADATA.TXT_${name})) END AS "${name.replace(/_/g, " ")}"`;
    }).join(",");
    sql = columns !== "" ? sql.split("|sys.replace_acaddon|").join(columns) : sql.split(",|sys.replace_acaddon|").join("");
  }
  if (sql.includes("|sys.replace_prodaddon|")) sql = sql.split(",|sys.replace_prodaddon|").join("").split("|sys.replace_prodaddon|").join("");
  sql = bookList.trim() !== "" ? sql.split("|sys.achelpbook|").join(bookList) : sql.split("in (|sys.achelpbook|)").join(">0");
  sql = literal(literal(literal(sql, "|sys.yearid|", session.yearId), "|sys.tarikh1|", desktopDate(session.tarikh1)), "|sys.tarikh2|", desktopDate(session.tarikh2))
    .split("|sys.help_stock_3|,").join("");
  sql = setupSelect(blankCoalesceAsText(sql));
  const rows = await loader.readTable(sql);
  return { rows: rows ?? [], frozen: found.frozen };
}

/**
 * Report_Combine.SetHelpGridProperties: help_properties (help_for 'R') sets a column's caption,
 * width and visibility; a column the properties do not name keeps the grid's default (shown, named
 * as the query names it).
 */
async function helpColumns(loader: Loader, helpId: string, keys: readonly string[]): Promise<HelpColumn[]> {
  const properties = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.help_properties WHERE help_name = $1 AND help_for = 'R' ORDER BY col_serial`, [helpId]) ?? [];
  return keys.map((key) => {
    const property = properties.find((candidate) => text(candidate, "col_field").toLowerCase() === key.toLowerCase());
    if (!property) return { key, caption: key, width: 90, visible: true, type: "T", decimals: 0, align: "L" as const };
    const align = text(property, "col_alignment").toUpperCase();
    return {
      key,
      caption: text(property, "col_heading") || key,
      width: toInt(field(property, "col_width")) || 90,
      visible: flag(property, "col_visible"),
      type: text(property, "col_type").toUpperCase() || "T",
      decimals: toInt(field(property, "col_decimal")),
      align: align === "R" || align === "C" ? align : "L",
    };
  });
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return desktopDate(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value).trim();
}

async function loadHelp(loader: Loader, helpId: string, grid: string, frozen: number): Promise<HelpGrid | null> {
  const help = await smartHelp(loader, helpId);
  if (!help) return null;
  const keys = help.rows[0] ? Object.keys(help.rows[0]) : [];
  const columns = await helpColumns(loader, helpId, keys);
  const keyColumn = KEY_COLUMN[grid] ?? keys.find((key) => key.toLowerCase() !== "tick" && key.toLowerCase() !== "ticked") ?? "";
  return {
    grid,
    helpId,
    keyColumn: keys.find((key) => key.toLowerCase() === keyColumn.toLowerCase()) ?? keyColumn,
    columns,
    rows: help.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cellText(value)]))),
    frozen: frozen >= 0 ? frozen : help.frozen,
  };
}

/** Report_Combine's print / preview / export rights: u_roll_id characters 10, 8 and 12 through Security_read_pw. */
async function reportRights(loader: Loader, menuShortName: string) {
  const { session } = loader;
  const rights = await readRights(loader.client, session, `Menu-${menuShortName}`);
  const encoded = securityWrite(`Menu-${menuShortName}`, 0);
  const row = (await loader.readTable(`SELECT u_roll_id FROM ${SYSTEM_SCHEMA}.security WHERE u_id = $1 AND u_module = $2 LIMIT 1`, [session.userNo, encoded]))?.[0];
  const at = (position: number) => {
    if (!row) return true;
    const roll = text(row, "u_roll_id");
    return roll.length > position ? securityRead(roll.charAt(position), position + 1) === "1" : true;
  };
  return { print: at(10), preview: at(8), export: at(12), modulePassword: rights.modulePassword !== "" };
}

/** The date a date_range_min / date_range_max code opens with. "L" (last used) is decided in the browser. */
function rangeDate(code: string, session: MasterSession, now: Date): Date {
  switch (code) {
    case "T": return now;
    case "2": return session.tarikh2;
    case "1": return session.tarikh1;
    default: return code === "L" ? now : session.tarikh1;
  }
}

export async function loadReport(loader: Loader, reportName: string, menuShortName: string, now = new Date()): Promise<ReportDefinition> {
  const { session } = loader;
  const properties = await readReportProperties(loader, reportName);
  const reportKey = toInt(field(properties, "report_key"));
  const unsupported: string[] = [];

  // First combo (first_combo_query; |sys.tarikh1| etc. in dd/MMM/yyyy; FIRST_COMBO_ALL adds ALL / -1).
  const firstCombo: { visible: boolean; label: string; options: { text: string; value: string }[] } = { visible: flag(properties, "first_combo_visible"), label: text(properties, "first_label_caption"), options: [] };
  if (firstCombo.visible) {
    let sql = setBooksValueInString(text(properties, "first_combo_query"));
    sql = sql
      .split("|sys.tarikh1|").join(desktopDate(session.tarikh1))
      .split("|sys.tarikh2|").join(desktopDate(session.tarikh2))
      .split("|sys.smart_lic|").join(String(session.licence));
    const displayColumn = text(properties, "display_cols_list");
    const keyColumn = text(properties, "key_col_name");
    if (sql !== "") {
      for (const row of await loader.readTable(setupSelect(sql)) ?? []) {
        firstCombo.options.push({ text: toText(field(row, displayColumn)), value: toText(field(row, keyColumn)) });
      }
    }
    if (flag(properties, "first_combo_all") && !(reportKey === 121 && session.licence === 71)) firstCombo.options.unshift({ text: "ALL", value: "-1" });
  }

  // Report controls: shown ones are filled through SP_FILL_RPT_CONTROL; runtime ones come from runtime_controls.
  const controlRows = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.report_control WHERE rep_properties_id = $1 ORDER BY control_disporder`, [reportKey]) ?? [];
  const controls: ReportControl[] = [];
  const runtimeKeys: number[] = [];
  const helpRequests: { helpId: string; grid: string; frozen: number }[] = [];
  for (const row of controlRows) {
    const name = text(row, "control_name");
    if (name === "") continue;
    if (flag(row, "control_runtime")) {
      for (const key of name.split(",")) if (/^\d+$/.test(key.trim())) runtimeKeys.push(Number(key.trim()));
      continue;
    }
    if (!flag(row, "control_visible")) continue;
    const type = text(row, "control_type").toUpperCase();
    if (!["K", "L", "C", "D"].includes(type)) continue;
    const filled = type === "D" ? { items: [], helps: [] } : await fillControl(loader, reportKey, toInt(field(row, "rep_control_key")));
    let items = filled.items;
    // SetupControl: no "Batch" group unless an addon field is a batch (fiel_err BATCH,); no AREA in report 47 for licence 15.
    if (name === "lbchk_Group") {
      const batch = await loader.readTable(`SELECT 1 FROM ${session.companySchema}.addon_fld WHERE fiel_err LIKE '%BATCH,%' LIMIT 1`);
      if (!batch) items = items.filter((item) => item.text !== "Batch");
    }
    if (reportKey === 47 && session.licence === 15) items = items.filter((item) => item.text !== "AREA");
    helpRequests.push(...filled.helps);
    const initiallyTicked = name === "lbchk_Col_Select" && items.length > 0 && !/^-?\d+(\.\d+)?$/.test(items[0].extra[0])
      ? items.filter((item) => item.extra[0].slice(1, 2).toUpperCase() === "Y").map((item) => item.value)
      : [];
    controls.push({ key: toInt(field(row, "rep_control_key")), name, caption: text(row, "control_caption"), type: type as ReportControl["type"], multiSelect: flag(row, "control_multiselect"), items, initiallyTicked });
  }
  if (reportKey === 51 && session.licence !== 14) {
    const index = controls.findIndex((control) => control.name === "lbchk_Group");
    if (index >= 0) controls.splice(index, 1);
  }

  // Help grids the controls fill (SetupControl's "Fill Help"), and the first combo's own (REP_CONTROL_ID -1).
  const firstComboHelp = (await loader.readTable(
    `SELECT visible_controls_lst, display_help_query FROM ${SETUP_SCHEMA}.report_controlval WHERE rep_properties_id = $1 AND rep_control_id = -1 ORDER BY display_order LIMIT 1`,
    [reportKey],
  ))?.[0];
  if (firstComboHelp && text(firstComboHelp, "display_help_query") !== "") helpRequests.push({ helpId: text(firstComboHelp, "display_help_query"), grid: text(firstComboHelp, "visible_controls_lst"), frozen: -1 });
  const helps: HelpGrid[] = [];
  for (const request of helpRequests) {
    if (helps.some((help) => help.grid === request.grid)) continue;
    const help = await loadHelp(loader, request.helpId, request.grid, request.frozen);
    if (help) helps.push(help);
  }

  const runtime: RuntimeControl[] = [];
  if (runtimeKeys.length > 0) {
    for (const row of await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.runtime_controls WHERE runtime_control_key = ANY($1::int[]) ORDER BY runtime_control_key`, [runtimeKeys]) ?? []) {
      const type = text(row, "runtime_control_type").toUpperCase();
      if (type !== "T" && type !== "A") { unsupported.push(`runtime control ${text(row, "runtime_control_name")} (type ${type})`); continue; }
      runtime.push({
        name: text(row, "runtime_control_name"),
        type: type as "T" | "A",
        text: text(row, "runtime_control_text_type").toUpperCase() === "F" ? text(row, "runtime_control_text") : "",
        dataType: text(row, "runtime_control_datatype").toUpperCase(),
        decimals: toInt(field(row, "runtime_control_decimals")),
        maxChars: toInt(field(row, "runtime_control_maxchar")),
        visible: flag(row, "runtime_control_visible"),
        left: toInt(field(row, "runtime_control_loc_x")),
        top: toInt(field(row, "runtime_control_loc_y")),
      });
    }
  }

  // Options grid (report_checkbox where chk_active): visible when chk_visible, or when the setup's prn_para names it.
  const prnPara = toText(session.setup.prn_para).toUpperCase();
  const checkboxes: ReportCheckbox[] = (await loader.readTable(
    `SELECT * FROM ${SETUP_SCHEMA}.report_checkbox WHERE rep_properties_id = $1 AND chk_active ORDER BY chk_order`,
    [reportKey],
  ) ?? []).map((row) => {
    const name = text(row, "chk_name");
    let value = flag(row, "chk_default_value");
    let visible = flag(row, "chk_visible");
    if (prnPara.includes(name.toUpperCase())) {
      visible = true;
      if (name.includes("CHK_CASH") && session.licence === 11) value = false;
    }
    if ((name.includes("CHK_AGECOL") || name.includes("CHK_ENTCDAY")) && session.licence === 20) value = false;
    return {
      name,
      caption: text(row, "chk_caption"),
      value,
      enabled: field(row, "chk_enable") === null || field(row, "chk_enable") === undefined ? true : flag(row, "chk_enable"),
      visible,
      sysValue: text(row, "chk_sysvalue"),
      tickColVisible: text(row, "chk_tickcolvisible"),
      tickedForId: text(row, "ticked_for_id"),
      untickedForId: text(row, "unticked_for_id"),
      tickedForControl: text(row, "ticked_for_control"),
      hideAgainstControl: text(row, "chk_hide_against_contol"),
      hideAgainst: text(row, "chk_hide_against"),
      hideFor: text(row, "chk_hide_for"),
    };
  });

  let helpTabs = text(properties, "visible_helptabs_list").split(",").map((tab) => tab.trim()).filter(Boolean);
  if (session.licence !== 14 && reportKey === 51) helpTabs = helpTabs.filter((tab) => tab !== "Tab_Addon");

  const fromVisible = flag(properties, "date_from");
  const uptoVisible = flag(properties, "date_upto");
  const minCode = text(properties, "date_range_min");
  const maxCode = text(properties, "date_range_max");
  const from = fromVisible ? rangeDate(minCode, session, now) : session.tarikh1;
  const upto = uptoVisible ? rangeDate(maxCode, session, now) : session.tarikh2;

  return {
    key: reportKey,
    name: reportName,
    head: text(properties, "report_head"),
    firstCombo,
    dates: {
      fromVisible,
      uptoVisible,
      uptoLabel: fromVisible ? "Report Upto" : reportKey === 33 || reportKey === 34 ? "Report For Date" : "Report Upto Date",
      from: desktopDate(from),
      upto: desktopDate(upto),
      fromLast: minCode === "L",
      uptoLast: maxCode === "L",
      yearStart: desktopDate(session.tarikh1),
      yearEnd: desktopDate(session.tarikh2),
      checkYear: flag(properties, "date_chk_ac_year"),
    },
    controls,
    runtime,
    checkboxes,
    helps,
    helpTabs,
    oneGroupRequired: flag(properties, "one_grp_sud_selected"),
    subtotals: flag(properties, "subtotal_req"),
    rights: await reportRights(loader, menuShortName),
    ported: PORTED_REPORTS.has(reportKey),
    licence: session.licence,
    unsupported,
  };
}
