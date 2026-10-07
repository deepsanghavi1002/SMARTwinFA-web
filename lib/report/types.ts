import type { BudgetUse, CashPlanning } from "./planning";
/**
 * The generic report screen (the desktop's Report_Combine form), as the browser and the server
 * exchange it. One screen serves every REPORT menu; which report is named by menumaster.actionmenu,
 * the smart_setup.report_properties.report_name.
 *
 * The selection tab is built entirely from setup (report_properties, report_control,
 * report_controlval, report_checkbox, runtime_controls, help_table / help_properties), so every
 * report opens. Generating the output needs that report's SP_REPORT_STANDARD / SP_REPORT_FORMATING
 * branch ported (lib/report/<report>.ts); the ones that are, are listed in PORTED_REPORTS.
 */

/** One item of a list control, as SP_FILL_RPT_CONTROL returns it (TBL_CONTROL_VAL_<machine>). */
export type ControlItem = Readonly<{
  /** report_controlval.rep_controlval_key the item came from. */
  controlValKey: number;
  /** DISPLAY_COL. */
  text: string;
  /** VALUE_COL: -1, -2 ... for a fixed (F) item, the query's value (an addon's fiel_key) for a Q item. */
  value: string;
  /** EXTRA_1 .. EXTRA_5 (an addon's fiel_repdefa, fiel_save, fiel_relate, fiel_entrypos, fiel_masterpos). */
  extra: readonly [string, string, string, string, string];
  /** visible_controls_lst: the help grid a group fills (C1HelpAccount ...), or the runtime boxes a sort or filter shows. */
  showControls: string;
}>;

/** A report_control row: lbchk_Group, lbox_Filter, lBox_Sorting, lBox_Formating, cmb_BookSeries, cmb_AgainstBook, lbchk_Col_Select ... */
export type ReportControl = Readonly<{
  key: number;
  /** control_name as the desktop names the control. */
  name: string;
  caption: string;
  /** K a checked list, L a list, C a combo, D a date. */
  type: "K" | "L" | "C" | "D";
  multiSelect: boolean;
  items: readonly ControlItem[];
  /** Items ticked when the screen opens (lbchk_Col_Select's EXTRA_1 "?Y"). */
  initiallyTicked: readonly string[];
}>;

/** A runtime_controls text box or label (txt_Aboveamt ...), shown when a list item names it in visible_controls_lst. */
export type RuntimeControl = Readonly<{
  name: string;
  /** T a text box, A a label. */
  type: "T" | "A";
  text: string;
  /** W whole number, N number, T text ... (runtime_control_datatype). */
  dataType: string;
  decimals: number;
  maxChars: number;
  visible: boolean;
  /** Where the control sits next to (left, top) on the desktop form, for ordering. */
  left: number;
  top: number;
}>;

/** A report_checkbox row of the options grid (C1_CHECKBOX). */
export type ReportCheckbox = Readonly<{
  name: string;
  caption: string;
  /** chk_default_value: ticked when the screen opens. */
  value: boolean;
  enabled: boolean;
  visible: boolean;
  /** chk_sysvalue: SYS.COL, SYS.CHK, MONTH, ONMONTH, ZERO_CLOSE ... */
  sysValue: string;
  tickColVisible: string;
  tickedForId: string;
  untickedForId: string;
  tickedForControl: string;
  hideAgainstControl: string;
  hideAgainst: string;
  hideFor: string;
}>;

export type HelpColumn = Readonly<{
  key: string;
  caption: string;
  width: number;
  visible: boolean;
  /** help_properties.col_type: B tick, T text, N number, C currency, D date, I integer. */
  type: string;
  decimals: number;
  align: "L" | "R" | "C";
}>;

/** One help grid (C1HelpAccount, C1HelpBook, C1HelpSchedule, C1HelpAddon, C1HelpProduct ...), as SP_SMART_HELP fills it. */
export type HelpGrid = Readonly<{
  /** The desktop grid's name, which report_controlval.visible_controls_lst names. */
  grid: string;
  helpId: string;
  /** The column a ticked row gives its key from (code, book_key, bs_key, sub_code, prod_key ...). */
  keyColumn: string;
  columns: readonly HelpColumn[];
  rows: readonly Record<string, string>[];
  frozen: number;
}>;

export type ReportDefinition = Readonly<{
  key: number;
  name: string;
  /** report_head, the output's title. */
  head: string;
  firstCombo: Readonly<{ visible: boolean; label: string; options: readonly Readonly<{ text: string; value: string }>[] }>;
  dates: Readonly<{
    fromVisible: boolean;
    uptoVisible: boolean;
    uptoLabel: string;
    /** dd/MMM/yyyy as the screen opens (date_range_min / date_range_max). */
    from: string;
    upto: string;
    /** date_range_min "L" / date_range_max "L": the dates last used in this session win. */
    fromLast: boolean;
    uptoLast: boolean;
    /** The accounting year (Const_Start_Date / Const_End_Date). */
    yearStart: string;
    yearEnd: string;
    checkYear: boolean;
  }>;
  controls: readonly ReportControl[];
  /** Controls the setup names but that are not shown (control_visible false) still carry items for Generate. */
  runtime: readonly RuntimeControl[];
  checkboxes: readonly ReportCheckbox[];
  helps: readonly HelpGrid[];
  /** visible_helptabs_list: Tab_Account, Tab_Book ... */
  helpTabs: readonly string[];
  /** report_properties flags the screen needs. */
  oneGroupRequired: boolean;
  subtotals: boolean;
  rights: Readonly<{ print: boolean; preview: boolean; export: boolean; modulePassword: boolean }>;
  /** False when the report's output is not ported yet: the selection opens, Generate says so. */
  ported: boolean;
  licence: number;
  /** Setup the web cannot run yet, named so the screen can say so. */
  unsupported: readonly string[];
  /** lostfocus_qry_control: the combo Cmb_FirstCombo_Leave refills for the chosen first combo entry (cmb_BookSeries); "" when none. */
  lostFocusControl: string;
}>;

/** The selection as the operator made it, sent with Generate. */
export type ReportSelection = Readonly<{
  firstCombo: string;
  /** dd/MMM/yyyy. */
  from: string;
  upto: string;
  /** Ticked group items (lbchk_Group), as controlValKey|value, in the order they were ticked (lst_TickedGroups). */
  groups: readonly string[];
  /** Per help grid, the keys of the ticked rows. */
  ticks: Readonly<Record<string, readonly string[]>>;
  /** Chosen item of each single-choice control (lbox_Filter, lBox_Sorting, lBox_Formating, cmb_BookSeries, cmb_AgainstBook): controlValKey|value. */
  choices: Readonly<Record<string, string>>;
  /** Ticked items of lbchk_Col_Select (values). */
  columns: readonly string[];
  /** Runtime text boxes (txt_Aboveamt ...). */
  texts: Readonly<Record<string, string>>;
  /** Options grid: chk_name -> ticked. */
  checks: Readonly<Record<string, boolean>>;
}>;

export type OutputColumn = Readonly<{
  key: string;
  caption: string;
  width: number;
  align: "L" | "R" | "C";
  /** N2, D, T ... */
  kind: "text" | "number" | "date";
  decimals: number;
  visible: boolean;
}>;

/**
 * One output row. `kind` says how the grid draws it: data, a subtotal of `level` (0 the first
 * grouping column), or the final total. rowType is ROW_DATA_TYPE (LED, OPENINGS, CLOSING, AC,
 * NARRATION, BOOK ...), which colours headings and blanks zeros the way the desktop draws them.
 */
export type OutputRow = Readonly<{
  kind: "data" | "subtotal" | "total";
  level: number;
  rowType: string;
  values: Readonly<Record<string, string>>;
  /** The voucher the row is from (SMART_LED_KEY / SMART_PROCESS_KEY), for its log; 0 when none. */
  ledKey: number;
  processKey: number;
}>;

export type ReportOutput = Readonly<{
  title: string;
  /** tbx_repdateselection and tbx_repselection: what the report was run for. */
  dateLine: string;
  selectionLine: string;
  columns: readonly OutputColumn[];
  rows: readonly OutputRow[];
  /** Grouping columns the subtotals break on (GroupingColumnsList), for F6 summarise. */
  groups: readonly string[];
  /** The count the desktop puts in the corner: LED rows. */
  records: number;
  /** How many columns from the left stay put (grid_frozen_cols of the first ticked group). */
  frozen: number;
  /** Colour of each subtotal level and the final total (report_style), by level (-1 = final total). */
  levelColours: Readonly<Record<string, string>>;
  /** Heading row colours by ROW_DATA_TYPE (AC, BOOK, SCHEDULE ...). */
  headingColours: Readonly<Record<string, string>>;
  /** The level (0 the first grouping column) each heading row type opens, matching its subtotals (AC, BOOK, ADDON_1 ...). */
  headingLevels?: Readonly<Record<string, number>>;
  /** What each heading row type stands for, from the ticked groups (AC: Account, BOOK: Book, ADDON_1: Area ...). */
  headingCaptions: Readonly<Record<string, string>>;
  /** The format that ran (MONTHLY, DAILY, WEEKLY, HALF_MONTH, QUATER_YEAR, HALF_YEAR, SUMMARY ...); "" for the standard report. */
  formating: string;
  /** The account's own cash position (day book of a cash, discount or bank account); null for other reports. */
  planning: CashPlanning | null;
  /** The budgets (account master) of the accounts the report was run for, against the period's actuals; null when no account was ticked. */
  budgets: readonly BudgetUse[] | null;
  elapsed: string;
  warnings: readonly string[];
  /** report_properties.subtotal_req: the output can be shown as a tree (Create Tree). */
  subtotals: boolean;
  reportKey: number;
}>;
