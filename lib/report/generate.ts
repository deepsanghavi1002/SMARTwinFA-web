import { Loader } from "../master-program/load";
import { toInt, toText } from "../master-program/legacy";
import { SETUP_SCHEMA } from "../master-program/session";
import type { ReportCall } from "./call";
import { convertForOperation, desktopDate, formulaValidation, isNumeric, parseSelectionDate, quotedList } from "./formula";
import { againstBookItems, fillControl, lostFocusItems, PORTED_REPORTS, readReportProperties } from "./setup";
import { pgFragment, setBooksValueInString, setupSelect } from "./sqlText";

export { pgFragment };
import type { ControlItem, ReportSelection } from "./types";

/**
 * Report_Combine.GenerateReport up to the procedure call: the checks it makes on the selection,
 * and the select, from, where and keys it builds from setup for SP_REPORT_STANDARD /
 * SP_REPORT_FORMATING. Report-specific branches of the C# are kept where they are, keyed on the
 * report key as the C# keys them. SQL the setup or the C# wrote in SQL Server's dialect is written
 * here in PostgreSQL's (+' '+ is ||' '||, CONVERT(varchar(11),d,112) is to_char(d,'YYYYMMDD')).
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined | null, name: string) => toText(field(row ?? undefined, name));
const flag = (row: Row | undefined | null, name: string) => {
  const value = field(row ?? undefined, name);
  return value === true || ["1", "true", "y"].includes(toText(value).toLowerCase());
};

/** A selection the C# refuses: Generate shows the message (and caption) and stops. */
export class ReportRefusal extends Error {
  readonly caption: string;

  constructor(message: string, caption = "Report generation failed") {
    super(message);
    this.caption = caption;
  }
}

/** Everything GenerateReport works out besides the procedure's parameters, which Report_Combine reads again after the call. */
export type ReportPlan = {
  call: ReportCall;
  properties: Row;
  /** report_outputcol rows of the report, by outputcol_serial. */
  outputColumns: Row[];
  /** dic_FixColumnsId: fix column name -> value, in fix_column_order. */
  fixColumns: Map<string, string>;
  /** GroupingColumnsList. */
  grouping: string[];
  /** SubtotalColumnsList. */
  subtotalColumns: string[];
  /** lst_OPHCols: output columns hidden, upper case. */
  hidden: string[];
  /** lst_TickedGroups as their items. */
  tickedGroups: ControlItem[];
  /** report_controlval rows of the chosen filter, sort and format (C1RowFilter, C1RowSorting, C1RowFormating). */
  filterRow: Row | null;
  sortingRow: Row | null;
  formatingRow: Row | null;
  /** bl_Check_Negatives: the filter is "negative only". */
  negativesOnly: boolean;
  /** CHK_CRYFCB (carry forward closings), CHK_PRN_FOR (format for printing). */
  carryForward: boolean;
  printFormat: boolean;
  /** Group's grid_frozen_cols of the first ticked group (the output's frozen columns). */
  frozen: number;
  /** tbx_repdateselection / tbx_repselection. */
  dateLine: string;
  selectionLine: string;
  /** Money columns of the company schema (cast to numeric wherever the setup's SQL names them). */
  moneyColumns: readonly string[];
  /** The options grid as ticked (name -> value) and each option's row. */
  checks: ReadonlyMap<string, boolean>;
  checkRows: readonly Row[];
};

/** Columns of type money in the company schema; PostgreSQL will not mix them with numeric in a CASE. */
async function moneyColumnNames(loader: Loader): Promise<string[]> {
  const rows = await loader.readTable(
    "SELECT DISTINCT column_name FROM information_schema.columns WHERE table_schema = $1 AND data_type = 'money'",
    [loader.session.companySchema],
  ) ?? [];
  return rows.map((row) => text(row, "column_name").toLowerCase()).filter((name) => /^[a-z_][a-z0-9_]*$/.test(name));
}


/** Report_Combine.AddHiddenCol: one name or a comma list, upper case. */
function addHidden(hidden: string[], columns: string) {
  for (const column of columns.toUpperCase().trim().split(",")) if (column !== "" && !hidden.includes(column)) hidden.push(column);
}

/** Report_Combine.RemoveHiddenCol. */
function removeHidden(hidden: string[], columns: string) {
  for (const column of columns.split(",")) {
    const index = hidden.indexOf(column);
    if (index >= 0) hidden.splice(index, 1);
  }
}

/** A key from a help grid's tick, safe in an IN list: a number, or quoted text. */
function keyLiteral(value: string, numeric: boolean): string {
  if (numeric) {
    if (!/^-?\d+$/.test(value.trim())) throw new ReportRefusal(`Invalid selection key ${value}`);
    return value.trim();
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** The SQL a list item's key goes into: an integer; anything else is refused. */
function itemValue(item: ControlItem): number {
  const value = Number(item.value);
  if (!Number.isInteger(value)) throw new ReportRefusal(`Invalid item ${item.text}`);
  return value;
}

/** Text from a runtime box, as the setup's |run_txt_*| puts it into SQL: refused unless it suits the box. */
function runtimeText(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== "" && !/^-?\d+(\.\d+)?$/.test(trimmed)) throw new ReportRefusal(`"${value}" is not a number`);
  return trimmed;
}

export async function planReport(loader: Loader, reportName: string, selection: ReportSelection): Promise<ReportPlan> {
  const { session } = loader;
  const schema = session.companySchema;
  const properties = await readReportProperties(loader, reportName);
  const reportKey = toInt(field(properties, "report_key"));
  if (!PORTED_REPORTS.has(reportKey)) throw new ReportRefusal(`${text(properties, "report_head") || reportName} is not available in the web version yet.\nIts output (SP_REPORT_STANDARD / SP_REPORT_FORMATING branch ${reportKey}) has not been ported.`, "Not ported yet");

  const moneyColumns = await moneyColumnNames(loader);
  const controlVals = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.report_controlval WHERE rep_properties_id = $1 ORDER BY rep_control_id, control_serial`, [reportKey]) ?? [];
  const controlValRow = (key: number) => controlVals.find((row) => toInt(field(row, "rep_controlval_key")) === key) ?? null;
  const controlRows = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.report_control WHERE rep_properties_id = $1 ORDER BY control_disporder`, [reportKey]) ?? [];
  const controlRow = (name: string) => controlRows.find((row) => text(row, "control_name") === name && !flag(row, "control_runtime") && flag(row, "control_visible"));
  const outputColumns = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.report_outputcol WHERE rep_properties_id = $1 ORDER BY outputcol_serial`, [reportKey]) ?? [];
  const fixRows = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.fix_columns WHERE rem_properties_id = $1 AND fix_column_blongs_to = 'R' AND fix_column_active ORDER BY fix_column_order`, [reportKey]) ?? [];
  const checkRows = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.report_checkbox WHERE rep_properties_id = $1 AND chk_active ORDER BY chk_order`, [reportKey]) ?? [];

  // The items of a shown list control, as the screen offers them (re-read so the browser can only pick listed ones).
  const items = new Map<string, ControlItem[]>();
  const listItems = async (name: string): Promise<ControlItem[]> => {
    if (!items.has(name)) {
      const row = controlRow(name);
      // The combo Cmb_FirstCombo_Leave fills (the day book's series) holds what the first combo's entry gives.
      if (row && text(properties, "fc_lostfocus_qry") !== "" && text(properties, "lostfocus_qry_control") === name) items.set(name, (await lostFocusItems(loader, reportName, selection.firstCombo)).items);
      else {
        const filled = row ? (await fillControl(loader, reportKey, toInt(field(row, "rep_control_key")))).items : [];
        // The Against Book of a credit / debit note register: the sale / purchase books of the first combo.
        items.set(name, filled.length === 0 && name === "cmb_AgainstBook" ? (await againstBookItems(loader, reportName, selection.firstCombo)).items : filled);
      }
    }
    return items.get(name)!;
  };
  const chosen = async (name: string): Promise<ControlItem | null> => {
    const list = await listItems(name);
    if (list.length === 0) return null;
    const pick = selection.choices[name];
    if (pick === undefined || pick === "") return list[0];
    const item = list.find((candidate) => `${candidate.controlValKey}|${candidate.value}` === pick);
    if (!item) throw new ReportRefusal(`Choose a ${name.replace(/^\w+?_/, "")} entry from its list`);
    return item;
  };

  // First combo: its full row (Rows.Find(SelectedValue)), for |sys.firstcombocol~n| and BOOK.
  let firstRow: Row | null = null;
  let firstText = "";
  const firstValue = selection.firstCombo;
  if (flag(properties, "first_combo_visible")) {
    const sql = setBooksValueInString(text(properties, "first_combo_query"))
      .split("|sys.tarikh1|").join(desktopDate(session.tarikh1))
      .split("|sys.tarikh2|").join(desktopDate(session.tarikh2))
      .split("|sys.smart_lic|").join(String(session.licence));
    const rows = sql === "" ? [] : await loader.readTable(setupSelect(sql)) ?? [];
    if (flag(properties, "first_combo_all")) rows.unshift({ [text(properties, "display_cols_list")]: "ALL", [text(properties, "key_col_name")]: -1 });
    firstRow = rows.find((row) => toText(field(row, text(properties, "key_col_name"))) === firstValue) ?? null;
    if (!firstRow) throw new ReportRefusal(`Choose a ${text(properties, "first_label_caption") || "first combo"} entry from its list`);
    firstText = toText(field(firstRow, text(properties, "display_cols_list")));
  }
  const firstBook = firstRow && field(firstRow, "book") !== undefined && toText(field(firstRow, "book")) !== "" ? toInt(field(firstRow, "book")) : -1;

  // Dates (DateTimePicker values; a hidden picker is the year's start / end).
  const fromVisible = flag(properties, "date_from");
  const uptoVisible = flag(properties, "date_upto");
  const from = fromVisible ? parseSelectionDate(selection.from) : session.tarikh1;
  let upto = uptoVisible ? parseSelectionDate(selection.upto) : session.tarikh2;
  if (!from || !upto) throw new ReportRefusal("Enter the report dates as dd/MMM/yyyy");

  // Ticked groups, in the order they were ticked.
  const groupItems = await listItems("lbchk_Group");
  const tickedGroups: ControlItem[] = selection.groups.map((pick) => {
    const item = groupItems.find((candidate) => `${candidate.controlValKey}|${candidate.value}` === pick);
    if (!item) throw new ReportRefusal("A ticked group is not in the list");
    return item;
  });

  const filterItem = await chosen("lbox_Filter");
  const sortItem = await chosen("lBox_Sorting");
  const formatItem = await chosen("lBox_Formating");
  const filterRow = filterItem ? controlValRow(filterItem.controlValKey) : null;
  const sortingRow = sortItem ? controlValRow(sortItem.controlValKey) : null;
  const formatingRow = formatItem ? controlValRow(formatItem.controlValKey) : null;

  // tbx_repdateselection / tbx_repselection.
  const dateLine = `${text(properties, "first_label_caption")} : ${firstText} - ${fromVisible ? ` From ${desktopDate(from)}` : ""}${uptoVisible ? ` Upto ${desktopDate(upto)}` : ""}`;
  const groupCaption = text(controlRow("lbchk_Group"), "control_caption");
  const filterCaption = text(controlRow("lbox_Filter"), "control_caption");
  const sortCaption = text(controlRow("lBox_Sorting"), "control_caption");
  const formatCaption = text(controlRow("lBox_Formating"), "control_caption");
  const listPart = `${filterItem ? ` / ${filterCaption} - ${filterItem.text}` : ""}${sortItem ? ` / ${sortCaption} - ${sortItem.text}` : ""}${formatItem ? ` / ${formatCaption} - ${formatItem.text}` : ""}`;
  const selectionLine = controlRow("lbchk_Group")
    ? `Selection :  ${groupCaption} - ${tickedGroups.map((item) => item.text.toUpperCase()).join(",")}${listPart}`
    : filterItem || sortItem || formatItem ? `Selection :  ${listPart}` : "";

  // "Cancel Event If None Group Selected For A particullar Report".
  if (flag(properties, "one_grp_sud_selected") && tickedGroups.length === 0) throw new ReportRefusal("Minimum one group should be selected,\nTo generate this report");
  const compulsory = field(properties, "compulsory_group_index");
  if (compulsory !== null && compulsory !== undefined && toText(compulsory) !== "") {
    const needed = groupItems[toInt(compulsory)];
    if (needed && !tickedGroups.includes(needed)) throw new ReportRefusal(`Must select group : ${needed.text} for this report`);
  }
  if (tickedGroups.length > 5) throw new ReportRefusal("Report generation failed..\nBecause maximum 5 groups are allowed");

  // Date validation (CheckDate) when the report checks the accounting year.
  if (flag(properties, "date_chk_ac_year")) {
    const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const longDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).replace(/(\w{3}) (\d{2}), (\d{4})/, "$1 , $2 $3");
    let message = "";
    if (day(from) > day(upto)) message = "Upto date should be smaller then from date";
    else if (uptoVisible && day(upto) > day(session.tarikh2)) message = `Upto date should be less then or equal to : ${longDate(session.tarikh2)}`;
    else if (uptoVisible && day(upto) < day(session.tarikh1)) message = `Upto date should be more then or equal to : ${longDate(session.tarikh1)}`;
    else if (fromVisible && day(from) > day(session.tarikh2)) message = `From date should be less then or equal to : ${longDate(session.tarikh2)}`;
    else if (fromVisible && day(from) < day(session.tarikh1)) message = `From date should be more then or equal to : ${longDate(session.tarikh1)}`;
    if (message !== "") throw new ReportRefusal(message);
  }

  // dic_FixColumnsId, and the lists GenerateReport fills.
  // A fix column with no value ('' in fix_columns) is no column at all: the procedures only kept it
  // as a placeholder for their UNIONs and INSERTs, which the web builds by name. Such a column comes
  // in only when the selection fills it (a ticked group's SMART_AC_CODE, ADDON_1_CODE ...).
  const blankFix = (value: string | undefined) => value === undefined || ["", "''"].includes(value.trim());
  const fixColumns = new Map<string, string>(fixRows.map((row) => [text(row, "fix_column_name"), toText(field(row, "fix_column_value"))] as [string, string]).filter(([, value]) => !blankFix(value)));
  /** A report with fix columns takes a group's own one when it has none of that name (dic_FixColumnsId's empty slot). */
  const fixFillable = (name: string) => fixColumns.size > 0 && blankFix(fixColumns.get(name));
  const subtotalColumns: string[] = [];
  const grouping: string[] = [];
  const hidden: string[] = [];

  const call: ReportCall = {
    reportKey, formating: "", closingNeeded: false, from, upto, dateField: "", queryStart: "", queryEnd: "", from_: "", where: "", groupBy: "", orderBy: "",
    checkQuery: "", filterText: "", sortingText: "", seriesText: "", acAddonRelate: "", prodAddonRelate: "", acAddonRepdefa: "", prodAddonRepdefa: "", addonEntryPos: "", addonMasterPos: "",
    selectKey: ["", "", "", "", ""], selectBookKey: "", selectScheduleKey: "", selectIdoptKey: "",
    headingAddon: ["", "", "", ""], selectedAddon: ["", "", "", ""], addon: ["", "", "", ""], text: ["", "", "", "", "", "", "", "", "", ""],
    filterId: "", book: -1, againstBook: -1, fcValue: Number(firstValue) || 0, fcText: firstText, database: `${schema}.`, prvDatabase: "", openingFrom: "",
    slabKey: 0, slabsKey: "", slabsCount: 0, slabText: "", tarikh1: session.tarikh1, tarikh2: session.tarikh2, yearId: session.yearId,
    userMachineNo: String(session.userNo), userNo: String(session.userNo), licence: session.licence, companyKey: session.companyKey,
    unionQuery: "", unionGroups: "", fixCols: "", sorting: "", showNarration: false, useUnion: false, groupsAsHeadings: false, printAllSlabs: false, jvDetailsRequired: false, fromDateEnabled: false, firstHelpKeys: [],
  };

  // Filter's own control (a slab combo or a ticked list), when the filter names one.
  let selectedSlabs = "";
  if (filterRow) {
    call.filterId = text(filterRow, "formating_sp_id");
    const controls = text(filterRow, "visible_controls_lst");
    if (controls !== "") {
      // The filter's own control (a slab combo or list) is a control of the report; one the setup lacks stops the desktop too.
      if (!controlRows.some((row) => text(row, "control_name") === controls)) throw new ReportRefusal("Control Missing To Process\nCheck Database", "Internal Program Error");
      const value = selection.choices[controls] ?? "";
      if (value === "") throw new ReportRefusal(`No selection done for : ${text(filterRow, "display_fixvalue")}`, "Report Generation Failed");
      call.slabKey = Number(value.split("|").pop()) || 0;
      selectedSlabs = value;
    } else {
      call.slabsKey = "-1";
      call.slabText = "";
    }
  }

  let from_ = "";
  let where = " where ";
  const isWhereBlank = () => where.trim().toLowerCase() === "where";
  if (selectedSlabs !== "" && reportName === "REPORT_REGISTER_REGISTER" && (filterItem?.text.trim().toLowerCase() ?? "") !== "none") {
    from_ += `((${text(properties, "output_database")}) left join |sys.db|LEDGER_EXT LEDEXT on led.led_key = ledext.led_id)`;
  } else if (reportKey === 5 || reportKey === 20) {
    from_ += text(properties, "output_database");
  } else {
    from_ += `(${text(properties, "output_database")})`;
  }
  if (text(properties, "output_condition") !== "") {
    where += text(properties, "output_condition");
    where = where.split("|sys.firstcombovalue|").join(firstValue).split("|sys.firstcombotext|").join(firstText);
    const column = /\|sys\.firstcombocol~(\d)\|/.exec(where);
    if (column && firstRow) where = where.split(column[0]).join(String(toInt(Object.values(firstRow)[Number(column[1])])));
    where = setBooksValueInString(where);
  }

  if (formatItem && groupItems.length > 0 && text(formatingRow, "formating_sp_id").toUpperCase() === "SPC_SUMMARY" && tickedGroups.length === 1 && tickedGroups[0].text.toUpperCase() === "ACCOUNT") {
    throw new ReportRefusal(`${formatItem.text}\nonly possible when other then or with account selected in group`, "Invalid selection");
  }
  const formatted = formatItem !== null && (await listItems("lBox_Formating")).indexOf(formatItem) > 0;

  // The sort's date column.
  let useDefaultDate = false;
  let dateField: string;
  if (sortingRow) {
    useDefaultDate = flag(sortingRow, "output_takedefadate");
    dateField = useDefaultDate ? text(properties, "output_defa_datecol") : text(sortingRow, "output_orderby");
  } else {
    dateField = text(properties, "output_defa_datecol");
    useDefaultDate = true;
  }

  // REPORT_OUTPUTCOL: the select, the narration rows' select, subtotal and hidden columns.
  let select = " ";
  let unionSelect = "";
  const bundleActive = toText(session.setup.entry_para).toUpperCase().includes("COL_BUNDLE,");
  for (const column of outputColumns) {
    let restoreAs = "";
    if (flag(column, "outputcol_active")) {
      const narration = text(column, "outputcol_narration") === "" ? "''" : toText(field(column, "outputcol_narration"));
      if (text(column, "outputcol_restoreas") !== "") {
        restoreAs = toText(field(column, "outputcol_restoreas")).trim();
        restoreAs = restoreAs.split("|sys.date|").join(reportKey === 1 && dateField.includes("reco_date") ? dateField.replace("led.reco_date", "led.doc_date") : dateField);
        restoreAs = restoreAs.split("|SYS.USER_NO|").join(String(session.userNo)).split("|sys.smart_lic|").join(String(session.licence));
        if (restoreAs.includes("BUNDLE") || restoreAs.includes("DELIVERY") || restoreAs.includes("TOT_AMT")) {
          if (session.licence === 2 || bundleActive) { select += `${restoreAs},`; unionSelect += `${narration},`; }
        } else if (session.licence === 1 && (restoreAs.includes("GRN_NO") || restoreAs.includes("PO_NO"))) {
          select += `${restoreAs},`; unionSelect += `${narration},`;
        } else if (!restoreAs.includes("GRN_NO") && !restoreAs.includes("PO_NO")) {
          select += `${restoreAs},`; unionSelect += `${narration},`;
        }
      } else if (text(column, "outputcol_fieldname") !== "") {
        select += `${text(column, "outputcol_fieldname")},`;
        unionSelect += `${narration},`;
      }
    }
    const fieldName = text(column, "outputcol_fieldname");
    if (flag(column, "outputcol_subtotal")) {
      if (restoreAs.includes("BUNDLE") || restoreAs.includes("DELIVERY")) { if (bundleActive) subtotalColumns.push(fieldName); }
      else subtotalColumns.push(fieldName);
    } else if (restoreAs !== "" && (restoreAs.toUpperCase().includes("CLSG_QTY") || restoreAs.toUpperCase().includes("BAL_FACT")) && reportKey === 17 && firstText === "SUMMARY") {
      subtotalColumns.push(fieldName);
    }
    const against = text(column, "outputcol_hide_agnst");
    const hideFor = text(column, "outputcol_hide_for");
    if (against !== "" && hideFor !== "" && hideFor.includes(".") && !isNumeric(hideFor, true)) {
      const { op, rest } = convertForOperation(against);
      const kind = hideFor.slice(hideFor.indexOf(".") + 1).toUpperCase().trim();
      const control = hideFor.slice(0, hideFor.indexOf("."));
      if (control === "cmb_FirstCombo" && (kind === "SV" || kind === "BV")) {
        const actual = kind === "SV" ? firstValue : String(firstBook);
        if (formulaValidation(op, actual, rest, false)) addHidden(hidden, fieldName);
      }
    }
  }
  // Final-total columns go last among the subtotal columns.
  const lastAt = subtotalColumns.length;
  for (const column of outputColumns.filter((row) => flag(row, "outputcol_finaltotal"))) {
    const name = text(column, "outputcol_fieldname");
    const index = subtotalColumns.indexOf(name);
    if (index >= 0) { subtotalColumns.splice(index, 1); subtotalColumns.splice(lastAt - 1, 0, name); }
  }
  if (select.trim() === "") {
    if (text(properties, "output_fieldlist") !== "") { select += text(properties, "output_fieldlist"); unionSelect += "'',"; }
    else { select = ""; unionSelect = ""; }
  }

  // Book series and against book.
  const seriesRow = controlRow("cmb_BookSeries");
  if (seriesRow) {
    const seriesItem = await chosen("cmb_BookSeries");
    const seriesVal = controlVals.find((row) => text(row, "display_fixvalue") === "Sys.RuntimeFill(bnseries)");
    if (!seriesVal) throw new ReportRefusal("Error No : 105\nCan't process series..Report generation failed", "Internal program failure");
    call.seriesText = seriesItem?.text.trim() ?? "";
    if (call.seriesText.toLowerCase() !== "all" && seriesItem) {
      const condition = text(seriesVal, "output_where");
      if (condition === "") throw new ReportRefusal("Error No : 106\nCan't process series..Report generation failed", "Internal program failure");
      if (!isWhereBlank()) where += " and ";
      if (condition.includes("|sys.series|")) where += condition.trim().split("|sys.series|").join(call.seriesText.replace(/'/g, "''"));
      if (condition.includes("|sys.optid|")) where += condition.trim().split("|sys.optid|").join(String(itemValue(seriesItem)));
    }
  }
  if (controlRow("cmb_AgainstBook")) {
    const against = await chosen("cmb_AgainstBook");
    if (against) {
      if (!isWhereBlank()) where += " and ";
      where += ` led.ag_book = ${itemValue(against)}`;
      call.againstBook = itemValue(against);
    }
  }

  // Options grid: str_chklist_query, and the columns an unticked option hides.
  const checks = new Map<string, boolean>();
  let checkQuery = "";
  let sameLine = true;
  let groupsAsHeadings = false;
  let carryForward = false;
  let printFormat = false;
  for (const row of checkRows) {
    const name = text(row, "chk_name");
    let value = name in selection.checks ? selection.checks[name] === true : flag(row, "chk_default_value");
    if (reportKey === 38 && name.toUpperCase() === "CHK_CASH") value = true;
    checks.set(name.toUpperCase(), value);
    const visible = flag(row, "chk_visible") || toText(session.setup.prn_para).toUpperCase().includes(name.toUpperCase());
    if (value && visible) checkQuery += `${name.toUpperCase()},`;
    switch (name.toUpperCase()) {
      case "CHK_NARRATION_NEW": sameLine = value; break;
      case "CHK_GRPASHD": groupsAsHeadings = value; break;
      case "CHK_CRYFCB": carryForward = value; break;
      case "CHK_PRN_FOR": printFormat = value; break;
    }
    const tickCol = text(row, "chk_tickcolvisible").toUpperCase();
    if (!value && tickCol !== "") addHidden(hidden, tickCol);
  }
  const fixRowsByName = (name: string) => fixColumns.has(name);
  if (fixRowsByName("SORTING_DATE")) {
    fixColumns.set("SORTING_DATE", fixColumns.get("SORTING_DATE")!.split("|sys.date|").join(reportKey === 1 && dateField.includes("reco_date") ? dateField.replace("led.reco_date", "led.doc_date") : dateField));
  }

  // The date filter.
  if (!useDefaultDate) {
    const formatId = text(formatingRow, "formating_sp_id").toUpperCase();
    if ((formatId === "QUATER_YEAR" || formatId === "HALF_YEAR") && tickedGroups.length === 0 && from.getTime() !== session.tarikh1.getTime()) {
      throw new ReportRefusal(`Between Period From ${desktopDate(from)} Not Allowed For ${formatItem?.text ?? ""}\nSet the From date to ${desktopDate(session.tarikh1)}`, "Invalid From Date");
    }
    if (reportKey !== 22 && reportKey !== 32 && reportKey !== 63) {
      const between = `${dateField} between '${desktopDate(from)}' and '${desktopDate(upto)}'`;
      if (reportKey === 5 || reportKey === 21) {
        if (!isWhereBlank()) where += checkQuery.includes("CHK_PDC,") ? " and (" : " and ";
        if (formatId !== "" && reportKey !== 21) where += between;
        else if (checkQuery.includes("CHK_PDC,")) where += `${dateField}<='${desktopDate(upto)}' or (${dateField}>='${desktopDate(upto)}' and led.ac_dbcode=${firstText === "SALE" ? 2 : 1}))`;
        else where += `${dateField}<='${desktopDate(upto)}'`;
      } else if (dateField !== "" && reportKey !== 17) {
        where += `${isWhereBlank() ? "" : " and "}${between}`;
      }
    }
  }

  // Show-columns list and input columns.
  if (controlRow("lbchk_Col_Select")) {
    for (const item of await listItems("lbchk_Col_Select")) {
      const ticked = item.extra[1] === "Y" || selection.columns.includes(item.value);
      if (!ticked) addHidden(hidden, item.value);
      else if (hidden.includes(item.value)) removeHidden(hidden, item.value);
    }
  }

  // The filter's where and hidden columns; the sort's text.
  let negativesOnly = false;
  if (filterRow) {
    if (text(filterRow, "output_where") !== "") { if (!isWhereBlank()) where += " and "; where += text(filterRow, "output_where"); }
    call.filterText = text(filterRow, "display_fixvalue");
    const colHidden = text(filterRow, "output_colhidden");
    if (colHidden !== "") addHidden(hidden, colHidden);
    if (text(filterRow, "formating_sp_id").toLowerCase() === "negative only") negativesOnly = true;
  }
  call.sortingText = sortingRow ? text(sortingRow, "display_fixvalue") : "";

  // Selected groups: where, from, select, order and group by for each ticked group.
  let openingsFrom = "(SYS.FIXDB)";
  let group1Keys = "";
  let productKeys = "";
  let chkGroupSelect = "";
  let chkGroupOrderBy = "";
  let chkGroupGroupBy = "";
  let unionRankingGroups = "";
  let orderBy = "";
  const frozen = 0;
  if (tickedGroups.length > 0) {
    let addonCount = 1;
    let otherAddon = false;
    let otherGroup = false;
    let otherAddonEntry = false;
    let addonMasterFound = false;
    let addonEntryFound = false;
    let addBracket = false;
    let failures = "";
    const tickedOf = (grid: string) => selection.ticks[grid] ?? [];
    for (const group of tickedGroups) {
      const caption = group.text !== "" ? group.extra[1] : group.text;
      const row = controlValRow(group.controlValKey);
      if (!row) throw new ReportRefusal("Internal Program Setup Failed,\nCan't Find Help Selection Source", "SMART_SETUP.CONTROL_VALUE ERROR");
      if (Number(group.value) < 0) {
        // A fixed group (account, book, schedule, product ...): the ticked rows of its help grid.
        const grid = text(row, "visible_controls_lst");
        const ticked = tickedOf(grid);
        if (ticked.length === 0) { failures += ` - Minimum One ${caption} Should Be Selected To Generate Report\n`; continue; }
        if (text(row, "output_where") !== "") {
          if (!isWhereBlank()) {
            if (otherGroup) where += call.selectKey[0] !== "" && (reportKey === 6 || reportKey === 21) ? " " : " and ";
            else if (!checkQuery.includes("CHK_MULTICO,") && reportKey !== 136 && reportKey !== 138 && reportKey !== 178) { where += " and ("; addBracket = true; }
          }
          if (!(call.selectKey[0] !== "" && (reportKey === 6 || reportKey === 21)) && !checkQuery.includes("CHK_MULTICO,") && reportKey !== 136 && reportKey !== 138 && reportKey !== 178) where += String(field(row, "output_where"));
          if (group1Keys !== "") group1Keys += call.selectKey[0] !== "" && (reportKey === 6 || reportKey === 21) ? " " : " AND ";
          if (!(call.selectKey[0] !== "" && (reportKey === 6 || reportKey === 21)) && reportKey !== 136 && reportKey !== 138 && reportKey !== 178) group1Keys += String(field(row, "output_where"));
          if (grid === "C1HelpProduct") productKeys = String(field(row, "output_where"));
        } else {
          throw new ReportRefusal("Internal Program Setup Failed,\nCan't Find Help Selection Source", "SMART_SETUP.CONTROL_VALUE ERROR");
        }
        if (text(row, "display_helptextid") === "") throw new ReportRefusal("Internal Program Setup Failed,\nCan't Find Help Selection Field", "SMART_SETUP.CONTROL_VALUE ERROR");
        const numeric = !(grid === "C1HelpBook" && reportKey === 17);
        const keys = `(${ticked.map((key) => keyLiteral(key, numeric)).join(",")})`;
        if (grid === "C1HelpBook" && call.selectBookKey === "") call.selectBookKey = keys;
        if (grid === "C1HelpSchedule" && call.selectScheduleKey === "") call.selectScheduleKey = keys;
        if (grid === "C1HelpProductGroup" && call.selectIdoptKey === "") call.selectIdoptKey = keys;
        if (grid === "C1HelpAccount" && call.selectKey[4] === "") call.selectKey[4] = keys;
        if (!(call.selectKey[0] !== "" && (reportKey === 6 || reportKey === 21)) && !checkQuery.includes("CHK_MULTICO,") && reportKey !== 136 && reportKey !== 138 && reportKey !== 143 && reportKey !== 178) where += keys;
        if (grid === "C1HelpProduct") { productKeys += keys; if (call.selectKey[4] === "") call.selectKey[4] = keys; }
        group1Keys += keys;
        const formatId = text(row, "formating_sp_id");
        if (formatId !== "" && fixFillable(`SMART_${formatId}`)) {
          fixColumns.set(`SMART_${formatId}`, String(field(row, "output_where")).split("in").join("").trim());
        }
        const subtotalGroup = text(row, "output_subtotal_grp");
        if (subtotalGroup !== "" && fixFillable(`SMART_${subtotalGroup.toUpperCase()}`)) {
          fixColumns.set(`SMART_${subtotalGroup.toUpperCase()}`, text(row, "output_run_select"));
        }
        if (text(row, "output_fieldlist") !== "") chkGroupSelect = `${text(row, "output_fieldlist")},`;
        if (text(row, "output_from") !== "") {
          from_ = `(${from_}${String(field(row, "output_from"))})`;
          openingsFrom = `(${openingsFrom}${String(field(row, "output_from"))})`;
        }
        if (text(row, "output_orderby") !== "") {
          if (!orderBy.trim().endsWith(",") && orderBy.trim().toLowerCase() !== "order by") orderBy += ",";
          orderBy += text(row, "output_orderby");
          chkGroupOrderBy += chkGroupOrderBy.trim().endsWith(",") || chkGroupOrderBy === "" ? `${text(row, "output_orderby")},` : `,${text(row, "output_orderby")},`;
        }
        if (subtotalGroup !== "") grouping.push(`${formatted ? "" : "SMART_"}${subtotalGroup.toUpperCase()}`);
        if ((groupsAsHeadings || text(properties, "report_style").toUpperCase() === "ACCOUNT") && subtotalGroup.toUpperCase() !== "NAME") addHidden(hidden, subtotalGroup.toUpperCase());
        unionRankingGroups += text(row, "output_run_select") !== "" ? `${text(row, "output_run_select")},` : "";
        if (text(row, "output_groupby") !== "") chkGroupGroupBy += chkGroupGroupBy.trim().endsWith(",") || chkGroupGroupBy === "" ? `${text(row, "output_groupby")},` : `,${text(row, "output_groupby")},`;
        otherGroup = true;
      } else {
        // An addon group: the ticked addon subs of that addon field.
        const fieldSave = group.extra[1].trim().replace(/ /g, "_");
        if (!/^[A-Za-z0-9_]+$/.test(fieldSave)) throw new ReportRefusal(`Addon ${group.text} has an invalid field name`);
        const ticked = tickedOf("C1HelpAddon").filter((key) => key.split("|")[0] === group.value).map((key) => key.split("|")[1] ?? "");
        if (ticked.length === 0) { failures += ` - Minimum One ${caption} Should Be Selected To Generate Report\n`; continue; }
        if (!isWhereBlank()) {
          if (otherGroup || otherAddon) where += " and ";
          else { where += " and ("; addBracket = true; }
        }
        const type = group.extra[0].toUpperCase();
        const relate = group.extra[2].toUpperCase();
        const entryPos = group.extra[3].toUpperCase();
        const masterPos = group.extra[4].toUpperCase();
        if (group1Keys !== "") group1Keys += " AND ";
        const partyReports = [25, 16, 56, 190, 234, 245].includes(reportKey);
        const fromHasPadata = from_.includes("padata") || from_.includes("pdata");
        const registerReports = [3, 12, 194, 195, 196, 197].includes(reportKey);
        // aentry for an entry addon, aientry for a product entry addon in the registers (3 and 12 only, where the C# says so).
        const entryAlias = (keys: readonly number[]) => (keys.includes(reportKey) && relate === "P" ? "aientry" : "aentry");
        if (relate === "A") {
          call.acAddonRelate = relate;
          if (call.acAddonRepdefa !== type) { call.acAddonRepdefa += type; call.addonMasterPos += masterPos; call.addonEntryPos += entryPos; }
        }
        if (relate === "P") {
          call.prodAddonRelate = relate;
          if (call.prodAddonRepdefa === "") { call.prodAddonRepdefa = type; call.addonMasterPos = masterPos; call.addonEntryPos = entryPos; }
          else if (call.prodAddonRepdefa !== type) { call.prodAddonRepdefa += type; call.addonMasterPos += masterPos; call.addonEntryPos += entryPos; }
        }
        // The where's and the headings' alias.
        let alias: string;
        if (type === "E") { alias = registerReports ? entryAlias([3, 12, 194, 195, 196, 197]) : "aentry"; addonEntryFound = true; }
        else {
          alias = relate === "P" && (partyReports || fromHasPadata) ? "padata" : "adata";
          if (type === "M") addonMasterFound = true;
        }
        // The select's, order's and group's alias (the C# tests reports 3 and 12 only there).
        const runAlias = relate === "P" && partyReports ? (type === "E" ? "aentry" : "padata")
          : relate === "P" && fromHasPadata ? (type === "E" ? entryAlias([3, 12]) : "padata")
          : type === "E" ? entryAlias([3, 12]) : "";
        group1Keys += ` ${alias}.key_${fieldSave} in `;
        where += ` ${alias}.key_${fieldSave} in `;
        const slot = call.headingAddon.findIndex((heading) => heading === "");
        if (slot >= 0) {
          call.addon[slot] = ` ${alias}.txt_${fieldSave}`;
          call.headingAddon[slot] = ` ${alias}.txt_${fieldSave} as "${fieldSave}"`;
          call.selectedAddon[slot] = ` ${alias}.txt_${fieldSave} as "SMART_SELECTED_ADDON${slot + 1}"`;
        }
        const keys = `(${ticked.map((key) => keyLiteral(key, true)).join(",")})`;
        const keySlot = call.selectKey.findIndex((key) => key === "");
        if (keySlot >= 0) call.selectKey[keySlot] = keys;
        where += keys;
        group1Keys += keys;
        const hasRunSelect = text(row, "output_run_select") !== "";
        let selectAfter = runAlias !== "" ? `${runAlias}.txt_|run.addon| as "SELECTED_|run.addoncaption|(S)"`
          : type === "M" ? text(row, "output_fieldlist") : hasRunSelect ? `aentry.txt_|run.addon| as "SELECTED_|run.addoncaption|(S)"` : "";
        selectAfter = selectAfter.split("|run.addon|").join(fieldSave).split("|run.addoncaption|").join(caption);
        if (!otherAddon && addonMasterFound && text(row, "output_from") !== "") {
          from_ = `(${from_}${String(field(row, "output_from"))})`;
          openingsFrom = `(${openingsFrom}${String(field(row, "output_from"))})`;
        }
        if (!otherAddonEntry && addonEntryFound && text(row, "output_from") !== "") {
          from_ = `(${from_}|sys.sp.aentry|)`;
          openingsFrom = `(${openingsFrom}|sys.sp.aentry|)`;
        }
        const orderString = runAlias !== "" ? `${runAlias}.txt_${fieldSave}`
          : type === "M" ? text(row, "output_orderby").split("|run.addon|").join(fieldSave) : text(row, "output_orderby") !== "" ? `aentry.txt_${fieldSave}` : "";
        if (orderString !== "") {
          if (!orderBy.trim().endsWith(",") && orderBy.trim().toLowerCase() !== "order by") orderBy += ",";
          orderBy += orderString;
        }
        const codeColumn = text(row, "formating_sp_id").split("|C|").join(String(addonCount));
        if (fixColumns.size > 0) {
          fixColumns.set(codeColumn, `${runAlias !== "" ? runAlias : type === "M" ? "adata" : "aentry"}.key_${fieldSave}`);
          fixColumns.set(`SMART_SELECTED_ADDON${addonCount}`, orderString);
        }
        unionRankingGroups += `${orderString},`;
        if (!formatted || [11, 12, 19, 20].includes(reportKey) || (reportKey === 21 && text(formatingRow, "formating_sp_id").toUpperCase() === "SUMMARY")) {
          if (text(row, "output_subtotal_grp") !== "") grouping.push(`SMART_SELECTED_ADDON${addonCount}`);
        } else {
          grouping.push(text(row, "output_subtotal_grp").split("|run.addoncaption|").join(caption));
        }
        if (groupsAsHeadings || text(properties, "report_style").toUpperCase() === "ACCOUNT") addHidden(hidden, text(row, "output_subtotal_grp").split("|run.addoncaption|").join(caption));
        if (selectAfter !== "") {
          chkGroupSelect += selectAfter.endsWith(",") ? selectAfter : `${selectAfter},`;
          if (!chkGroupOrderBy.endsWith(",") && chkGroupOrderBy.trim() !== "") chkGroupOrderBy += ",";
          chkGroupOrderBy += orderString;
          if (!chkGroupGroupBy.endsWith(",") && chkGroupGroupBy.trim() !== "") chkGroupGroupBy += ",";
          chkGroupGroupBy += runAlias !== "" ? ` ${runAlias}.txt_${fieldSave}` : type === "E" ? ` aentry.txt_${fieldSave}` : text(row, "output_groupby").split("|run.addon|").join(fieldSave);
        }
        otherGroup = true;
        if (type === "M") otherAddon = true; else if (type === "E") otherAddonEntry = true;
        addonCount += 1;
      }
    }
    if (failures !== "") throw new ReportRefusal(`Report Generation Failed As ... \n${failures}`, "No Selections Done!");
    if (addBracket) where += ")";
    // The ledger's sorting column: the groups, the account, the posting date and key.
    if (text(properties, "report_style").toUpperCase() === "ACCOUNT" && [4, 38, 62].includes(reportKey)) {
      const groups = unionRankingGroups.replace(/ac\.name,/gi, "").replace(/,$/, "").split(",").filter((part) => part !== "").map((part) => (part.toLowerCase() === "bs.bs_desc" ? "bs.bs_code || ' ' || bs.bs_desc" : part));
      const lead = [...groups, "ac.name"].join(" || ' ' || ");
      const head = groups.length > 0 ? lead : `' ' || ac.name`;
      fixColumns.set("SORTING_COL", call.acAddonRepdefa !== "E"
        ? `${head} || CAST(ac.code AS varchar(10)) || '   P' || to_char(led.doc_date, 'YYYYMMDD') || CAST(ledpost.post_dbcode AS varchar(20)) || led.doc_no || CAST(led.led_key AS varchar(20)) || 'LED'`
        : `${groups.length > 0 ? groups.join(" || ' ' || ") : "''"} || '   P' || to_char(led.doc_date, 'YYYYMMDD') || CAST(ledpost.post_dbcode AS varchar(20))${unionRankingGroups.includes("SUBLED") ? " || CAST(led.led_key AS varchar(20))" : ""} || 'LED'`);
    } else {
      // Any other report: the groups, then (with a default date column) the date, and for the day
      // book the voucher number and key; the schedule sorts by its code first. (The stock report's
      // LEDGER with a book ticked has its own, not ported with it yet.)
      const groups = unionRankingGroups.replace(/,$/, "").split(",").join(" || ' ' || ");
      const dateColumn = text(properties, "output_defa_datecol");
      let sorting: string;
      if (dateColumn === "") sorting = `${groups} || '   P'`;
      else if (reportKey === 5 || reportKey === 25 || (reportKey === 3 && unionRankingGroups !== "")) sorting = `${groups} || CAST(ac.code AS varchar(10)) || to_char(${dateColumn}, 'YYYYMMDD') || '   P'`;
      else if (reportKey === 1) sorting = `${groups} || to_char(${dateColumn}, 'YYYYMMDD') || led.full_docno || CAST(led.led_key AS varchar(20)) || '   P'`;
      else sorting = `${groups} || to_char(${dateColumn}, 'YYYYMMDD') || '   P'`;
      fixColumns.set("SORTING_COL", sorting.replace(/bs\.bs_desc/gi, "bs.bs_code || ' ' || bs.bs_desc"));
    }
  }

  // The sort's order by, hidden columns and where (with its runtime boxes' text).
  if (sortingRow) {
    if (text(sortingRow, "output_orderby") !== "") { if (!orderBy.trim().endsWith(",")) orderBy += ","; orderBy += text(sortingRow, "output_orderby"); }
    if (text(sortingRow, "output_colhidden") !== "") addHidden(hidden, text(sortingRow, "output_colhidden"));
    let condition = text(sortingRow, "output_where");
    if (condition !== "") {
      if (reportKey === 22 && !condition.includes("|run_txt_OpenAmt|")) condition += "~|run_txt_OpenAmt|";
      if (reportKey === 74) condition = "|run_txt_PurchaseBill|~|run_txt_MRP|~|run_txt_CopyStart|";
      if (reportKey === 160 || reportKey === 216 || reportKey === 228) condition = "|run_txt_OthPerc|~|run_txt_ExpPerc|";
      if (reportKey === 173) condition = "|run_txt_Graceday|~|run_txt_IntPerc|~|run_txt_Abovedays|~|run_txt_Belowdays|";
      const parts = condition.split("~");
      let match: RegExpExecArray | null;
      while ((match = /\|run_([A-Za-z0-9_]+)\|/.exec(condition)) !== null) {
        const value = runtimeText(selection.texts[match[1]] ?? "");
        condition = condition.split(match[0]).join(value);
        if (value !== "") {
          const slot = call.text.findIndex((entry) => entry === "");
          // TEXT1-2 take the value; TEXT3 too for reports 74 and 173, TEXT4 for 173; later ones take the condition so far.
          if (slot >= 0) call.text[slot] = slot < 2 || (slot === 2 && (reportKey === 74 || reportKey === 173)) || (slot === 3 && reportKey === 173) ? value : condition;
        }
      }
      if (parts.includes("")) for (let index = 1; index < parts.length && index % 2 !== 0; index += 1) condition = condition.split(parts[index]).join("");
      condition = condition.split("~").join(" ").trim();
      if (condition !== "" && ![1, 4, 5, 17, 21, 22, 32, 63, 93, 160, 228].includes(reportKey)) {
        if (!isWhereBlank()) where += " and ";
        where += `(${condition})`;
      }
    }
  }

  if (select === "" && ![44, 64, 252].includes(reportKey)) throw new ReportRefusal("COMMAND WAS BLANK\nREPORT GENERATION FAILED", "INTERNAL PROGRAM ERROR");
  from_ = ` from ${from_}`;
  if (session.licence === 46 && (reportKey === 242 || reportKey === 243)) from_ = from_.split("|sys.db|PRODUCT_MASTER").join(`${session.fromSchema}.PRODUCT_MASTER`);
  for (const column of text(properties, "subtotal_groups").split(",").filter(Boolean)) if (!grouping.includes(column)) grouping.push(column);

  // A format other than the first (Month, Daily ...) runs SP_REPORT_FORMATING instead of SP_STD_REPORT.
  const formatId = formatingRow ? text(formatingRow, "formating_sp_id").toUpperCase() : "";

  // The standard report's parameters (SP_STD_REPORT).
  const monthlyColumn = text(properties, "subtotal_monthly_col");
  if (formatId === "" && monthlyColumn !== "" && (tickedGroups.length === 0 || !orderBy.includes("name"))) {
    grouping.push(monthlyColumn);
    fixColumns.set(monthlyColumn, `to_char(${dateField}, 'FMMonth')`);
  }
  const joinFixColumns = () => [...fixColumns].filter(([, value]) => !blankFix(value)).map(([name, value]) => `${value} as "${name}",`).join("");
  const selectList = select.endsWith(",") ? select.slice(0, -1) : select;
  call.queryStart = (reportKey !== 17 ? joinFixColumns() : "") + selectList;
  call.queryStart = call.queryStart.split("|SYS.USER_NO|").join(String(session.userNo));
  if (!flag(properties, "addon_read_from_sp")) {
    if (!call.queryStart.endsWith(",") && !chkGroupSelect.startsWith(",")) call.queryStart += ",";
    call.queryStart += chkGroupSelect;
    if (call.queryStart.endsWith(",")) call.queryStart = call.queryStart.slice(0, -1);
  }
  call.queryEnd = chkGroupSelect.replace(/,$/, "");
  call.formating = "";
  call.dateField = dateField;
  call.from_ = from_;
  call.where = where;
  call.groupBy = selectedSlabs !== "" && reportName === "REPORT_REGISTER_REGISTER" && (filterItem?.text.trim().toLowerCase() ?? "") !== "none"
    ? "led.LED_KEY,led.CODE,led.doc_date,led.FULL_DOCNO,led.DOC_NO1,led.DOC_NO,ac.NAME,led.AMOUNT,LED.DOC_REMARK,LED.NARRATION"
    : chkGroupGroupBy.replace(/,$/, "");
  call.orderBy = orderBy.trim().replace(/^,/, "").replace(/,$/, "");
  call.checkQuery = checkQuery;
  call.book = firstBook;
  if (controlRow("lbchk_Col_Select")) {
    const picked = (await listItems("lbchk_Col_Select")).filter((item) => selection.columns.includes(item.value) || item.extra[1] === "Y");
    call.slabsKey = picked.map((item) => item.value).join(",");
    call.slabText = picked.map((item) => item.text).join(",");
  }
  call.unionQuery = unionSelect.replace(/,$/, "");
  call.unionGroups = unionRankingGroups !== "" ? (unionRankingGroups.endsWith(",") ? unionRankingGroups : `${unionRankingGroups},`) : "";
  call.fixCols = joinFixColumns();
  call.openingFrom = openingsFrom;
  call.showNarration = checks.get("CHK_NARRATION") ?? checks.get("CHK_CRCASCOM") ?? false;
  // Without a Show Narration option the union list carries the ticked keys (the stock report: its products).
  if (!checks.has("CHK_NARRATION")) call.unionQuery = reportKey === 17 ? productKeys : group1Keys;
  call.useUnion = !sameLine;
  call.groupsAsHeadings = groupsAsHeadings;
  const allSlabs = checkRows.find((row) => text(row, "chk_sysvalue") === "ALL_SLABS");
  call.printAllSlabs = allSlabs ? checks.get(text(allSlabs, "chk_name").toUpperCase()) ?? false : false;
  call.jvDetailsRequired = checks.get("CHK_JV_DTLS") ?? checks.get("CHK_LCKED") ?? false;
  call.sorting = sortingRow ? text(sortingRow, "output_orderby") : "";
  call.fromDateEnabled = false;
  {
    const firstHelp = (await loader.readTable(`SELECT visible_controls_lst FROM smart_setup.report_controlval WHERE rep_properties_id = $1 AND rep_control_id = -1 ORDER BY display_order LIMIT 1`, [reportKey]))?.[0];
    call.firstHelpKeys = firstHelp ? (selection.ticks[text(firstHelp, "visible_controls_lst")] ?? []).map(String) : [];
  }
  if (!uptoVisible) upto = new Date();
  call.upto = upto;

  // SP_REPORT_FORMATING's parameters: the groups' own select, group by and order by; MONTHLY's
  // closing needs the options grid's MONTH row (CHK_SOCBM).
  if (formatId !== "") {
    call.formating = formatId;
    const monthRow = checkRows.find((row) => text(row, "chk_sysvalue").toLowerCase() === "month");
    call.closingNeeded = formatId === "MONTHLY" && monthRow !== undefined && (checks.get(text(monthRow, "chk_name").toUpperCase()) ?? false);
    call.queryStart = chkGroupSelect.replace(/,$/, "");
    call.groupBy = chkGroupGroupBy.replace(/,$/, "");
    call.orderBy = chkGroupOrderBy.replace(/,$/, "");
  }

  // Manage accounts to be the last group (REPORT_BASE), and the ledger's account grouping.
  const reportBase = text(properties, "report_base").toUpperCase();
  if (reportBase !== "") {
    for (const group of tickedGroups) {
      if (group.text.toUpperCase() === reportBase) {
        if (group.text.toUpperCase() === "ACCOUNT") {
          if (grouping.includes("SMART_NAME")) grouping.splice(grouping.indexOf("SMART_NAME"), 1);
          else if (grouping.includes("NAME")) grouping.splice(grouping.indexOf("NAME"), 1);
        }
      } else {
        if (group.text.toUpperCase() !== "ACCOUNT" && reportKey === 6 && grouping.includes("SMART_NAME")) grouping.splice(grouping.indexOf("SMART_NAME"), 1);
        if (grouping.includes("NAME")) grouping.splice(grouping.indexOf("NAME"), 1);
      }
    }
  }
  if (reportKey === 4 && !formatted) {
    if (grouping.includes("SMART_NAME")) { grouping.splice(grouping.indexOf("SMART_NAME"), 1); grouping.push("SMART_NAME"); }
    else if (call.acAddonRepdefa !== "E") grouping.push("SMART_NAME");
  } else if (reportKey === 4) {
    // AddAccountInGrouping with a format: the account (NAME) is the last group. The C# tests the
    // filter's formating_sp_id for SPC_SUMMARY here (not the format's), so that is kept.
    if (text(filterRow, "formating_sp_id").toUpperCase() === "SPC_SUMMARY") grouping.splice(0, grouping.length, "NAME");
    else {
      if (grouping.includes("NAME")) grouping.splice(grouping.indexOf("NAME"), 1);
      grouping.push("NAME");
    }
  }
  if (text(properties, "report_style").toUpperCase() === "ACCOUNT") for (const column of grouping) removeHidden(hidden, column);

  return {
    call, properties, outputColumns, fixColumns, grouping, subtotalColumns, hidden, tickedGroups,
    filterRow, sortingRow, formatingRow, negativesOnly, carryForward, printFormat, frozen,
    dateLine, selectionLine, moneyColumns, checks, checkRows,
  };
}

export { quotedList };
