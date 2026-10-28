import { Loader } from "../master-program/load";
import { toInt, toText } from "../master-program/legacy";
import { SETUP_SCHEMA } from "../master-program/session";
import type { ResultRow, ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./generate";
import { cashBookColumns, FIX_COLUMN_NAMES, parseRowDate, readBudgetUse, readCashPlanning } from "./library";
import { money, num } from "./run";
import type { OutputColumn, OutputRow, ReportOutput } from "./types";

/**
 * Report_Combine after the procedure: Update_ClosingBalance (the running balance and the closing
 * row's balancing figure), OutputGridSettings (captions, widths, formats, hidden columns),
 * Update_Subtotal (C1FlexGrid.Subtotal: a subtotal row under each group, the final total last),
 * the columns it then hides or removes, and C1_OUTPUT_OwnerDrawCell's blanking of zeros. The grid
 * is sent ready to draw: visible columns, rows with their kind and level, values as text.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | null | undefined, name: string) => toText(field(row ?? undefined, name));
const flag = (row: Row | null | undefined, name: string) => {
  const value = field(row ?? undefined, name);
  return value === true || ["1", "true", "y"].includes(toText(value).toLowerCase());
};

/** Report_Combine.Update_ClosingBalance(DataTable, GroupsList). */
export function updateClosingBalance(plan: ReportPlan, table: ResultTable): void {
  const reportKey = plan.call.reportKey;
  const subtotal = plan.subtotalColumns;
  if (subtotal.length < 2) return;
  const [debitCol, creditCol] = subtotal;
  const moveClosings = ![77, 105, 117, 118, 270].includes(reportKey) && text(plan.filterRow, "formating_sp_id").toUpperCase() === "CLOSING";
  const openingCol = table.has("OPENING_BAL");
  const rows = table.rows;
  const get = (row: ResultRow, column: string) => table.get(row, column);
  const set = (row: ResultRow, column: string, value: unknown) => table.set(row, column, value);
  const type = (row: ResultRow) => toText(get(row, "ROW_DATA_TYPE")).toUpperCase();
  const hasType = table.has("ROW_DATA_TYPE");
  const setDrCr = (row: ResultRow, value: string) => { if (table.has("DR_CR")) set(row, "DR_CR", value); };
  const move = (row: ResultRow) => {
    if (!moveClosings) return;
    const drCr = toText(get(row, "DR_CR"));
    if (drCr === "DR") { set(row, debitCol, get(row, "CLOSING_BAL")); set(row, creditCol, 0); }
    else if (drCr === "CR") { set(row, creditCol, get(row, "CLOSING_BAL")); set(row, debitCol, 0); }
    else { set(row, debitCol, 0); set(row, creditCol, 0); }
  };
  const grouping = plan.grouping;
  if (grouping.length > 0 && rows.length > 0) {
    const ledgerStyle = text(plan.properties, "report_style").toUpperCase() === "ACCOUNT";
    const groupColumn = ledgerStyle ? grouping[grouping.length - 1] : grouping[0];
    const groupValue = (row: ResultRow) => toText(get(row, groupColumn));
    let compare = groupValue(rows[0]);
    let balance = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (hasType) {
        const kind = type(row);
        if (kind !== "LED" && kind !== "CLOSING" && kind !== "OPENINGS") continue;
        if (kind === "CLOSING") {
          if (index > 0) for (const column of grouping) set(row, column, get(rows[index - 1], column));
          if (balance < 0) { set(row, debitCol, Math.abs(balance)); set(row, creditCol, 0); if (reportKey !== 117) setDrCr(row, "CR"); }
          else if (balance > 0) { set(row, debitCol, 0); set(row, creditCol, balance); if (reportKey !== 117 && reportKey !== 118) setDrCr(row, "DR"); }
          else { set(row, debitCol, 0); set(row, creditCol, 0); if (reportKey !== 118) setDrCr(row, "DR"); }
          balance = 0;
          continue;
        }
      }
      if (groupValue(row) !== compare) { compare = groupValue(row); balance = 0; }
      if (hasType && type(row) === "OPENINGS" && balance === 0) {
        if (num(get(row, debitCol)) !== 0) balance = num(get(row, debitCol));
        else if (num(get(row, creditCol)) !== 0) balance = -num(get(row, creditCol));
        continue;
      }
      if (openingCol) {
        balance = money(num(get(row, "OPENING_BAL")) + num(get(row, debitCol)) - num(get(row, creditCol)));
        set(row, "OPENING_BAL", num(get(row, "OPENING_BAL")));
      } else {
        balance = money(balance + num(get(row, debitCol)) - num(get(row, creditCol)));
      }
      set(row, "CLOSING_BAL", balance);
      if (![77, 117, 118].includes(reportKey)) {
        setDrCr(row, [4, 38, 62].includes(reportKey) ? (balance >= 0 ? "DR" : "CR") : balance === 0 ? "" : balance > 0 ? "DR" : "CR");
        move(row);
      }
    }
  } else {
    let balance = 0;
    for (const row of rows) {
      if (hasType) {
        if (type(row) === "NARRATION") continue;
        if (type(row) === "CLOSING") {
          if (balance > 0) { set(row, debitCol, Math.abs(balance)); set(row, creditCol, 0); setDrCr(row, "DR"); }
          else if (balance < 0) { set(row, debitCol, 0); set(row, creditCol, Math.abs(balance)); setDrCr(row, "CR"); }
          else { set(row, debitCol, 0); set(row, creditCol, 0); setDrCr(row, ""); }
        }
      }
      if (openingCol) {
        const opening = num(get(row, "OPENING_BAL"));
        balance = opening > 0 ? money(opening + num(get(row, debitCol)) - num(get(row, creditCol))) : money(num(get(row, debitCol)) - num(get(row, creditCol)) - Math.abs(opening));
        set(row, "OPENING_BAL", opening);
      } else {
        balance = money(balance + num(get(row, debitCol)) - num(get(row, creditCol)));
      }
      set(row, "CLOSING_BAL", balance);
      // The day book's bank CC interest: the rate for the days from the voucher to the Upto date.
      if (reportKey === 1 && plan.call.text[0] !== "" && table.has("DEPOSIT") && table.has("CC_AMT") && toText(get(row, "NAME")).toUpperCase() !== "CLOSING BALANCE") {
        const date = parseRowDate(toText(get(row, "selected_date")));
        if (date) {
          const upto = plan.call.upto;
          const days = Math.round((Date.UTC(upto.getFullYear(), upto.getMonth(), upto.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000) + 1;
          const rate = num(plan.call.text[0]) / 100 / 365;
          const deposit = num(get(row, "DEPOSIT"));
          const withdrawal = num(get(row, "WITHDRAWAL"));
          if (deposit > 0) set(row, "CC_AMT", Math.round(Math.abs(deposit) * rate * days * 100) / 100);
          else if (withdrawal > 0) set(row, "CC_AMT", -Math.round(Math.abs(withdrawal) * rate * days * 100) / 100);
        }
      }
      if (reportKey !== 117 && reportKey !== 118) setDrCr(row, balance === 0 ? "" : balance > 0 ? "DR" : "CR");
      move(row);
    }
  }
}

/**
 * GenerateReport before Update_ClosingBalance, the day book (key 1): the closing balance runs on the
 * book's two amount columns (cash 4, discount 5, bank 6, and the bank's CC interest when its rate
 * was given); any other book has no running balance and no totals.
 */
function cashBookTotals(plan: ReportPlan): void {
  const list = plan.subtotalColumns;
  list.splice(0, list.length);
  const book = plan.call.book;
  if (book === 4 || book === 5 || book === 6) list.push(...cashBookColumns(book));
  if (book === 6 && plan.call.text[0] !== "") list.push("CC_AMT");
}

/** report_style: each subtotal level's colour, and the named colours Report_Combine_Load reads from it. */
async function readStyles(loader: Loader) {
  const levels: Record<string, string> = {};
  const named: Record<string, string> = { str_color_account: "MistyRose", str_color_book: "LightGoldenrodYellow", str_color_schedule: "Thistle", str_color_addon1: "Lavender", str_color_addon2: "CornSilk", str_color_addon3: "PapayaWhip", str_color_addon4: "LavenderBlush" };
  for (const row of await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.report_style`) ?? []) {
    const levelFor = text(row, "level_for").toLowerCase().trim();
    const back = text(row, "font_backcolor");
    if (levelFor !== "" && back !== "" && levelFor in named) named[levelFor] = back;
    if (back !== "") levels[String(toInt(field(row, "level_number")))] = back;
  }
  return { levels, named };
}

/** How a number cell reads with the column's N format (en-IN digit grouping). */
const NUMBER_FORMATS = new Map<number, Intl.NumberFormat>();
function formatNumber(value: number, decimals: number): string {
  // One formatter for each number of decimals (making one for every cell took most of a large report's time).
  let format = NUMBER_FORMATS.get(decimals);
  if (!format) { format = new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); NUMBER_FORMATS.set(decimals, format); }
  return format.format(value);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return `${String(value.getDate()).padStart(2, "0")}-${MONTHS[value.getMonth()]}-${value.getFullYear()}`;
  return String(value);
}

/**
 * A date column's text as the voucher rows show it (dd-Mon-yyyy): the opening and closing rows
 * carry convert(varchar, date, 6) text, "05 Oct 26", which the desktop grid shows as a date.
 */
function dateCell(value: unknown): string {
  const text = cellString(value);
  const short = /^(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{2}|\d{4})$/.exec(text.trim());
  if (!short) return text;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === short[2].toLowerCase());
  if (month < 0) return text;
  const year = short[3].length === 2 ? 2000 + Number(short[3]) : Number(short[3]);
  return `${short[1].padStart(2, "0")}-${MONTHS[month]}-${year}`;
}

export async function buildOutput(loader: Loader, plan: ReportPlan, table: ResultTable, started: number): Promise<ReportOutput> {
  const { call, properties } = plan;
  const reportKey = call.reportKey;
  const hidden = [...plan.hidden];
  // Stock report's Summary: a row a product (product, opening, added, less, closing, unit); the entry columns of the ledger format stay out.
  const stockSummaryFormat = reportKey === 29 || (reportKey === 17 && (call.fcText.toUpperCase() === "SUMMARY" || call.fcValue === 2));
  if (reportKey === 17 && stockSummaryFormat) hidden.push("SELECTED_DATE", "FULL_DOCNO", "NAME", "TRN2", "BAL_FACT", "ADD_FACT", "LESS_FACT", "UOM2", "DAYS", "PROD_KEY", "FORM_CODE", "DOC_NO1", "BUNDLE", "PACKING");
  if (reportKey === 17 && stockSummaryFormat === false) hidden.push("PROD_KEY");
  // The Ledger drops the factor columns (second unit) unless Factor is ticked.
  if (reportKey === 17 && stockSummaryFormat === false && !call.checkQuery.includes("CHK_FACTOR,")) hidden.push("TRN2", "BAL_FACT", "ADD_FACT", "LESS_FACT", "UOM2");
  if (reportKey === 1 && table.has("closing_bal")) cashBookTotals(plan);
  // The multi company bank / cash book: the running balance runs on Receipt and Payment even where the setup names no subtotal columns.
  if (reportKey === 117 && plan.subtotalColumns.length < 2 && table.has("RECEIPT") && table.has("PAYMENT")) plan.subtotalColumns.splice(0, plan.subtotalColumns.length, "RECEIPT", "PAYMENT");
  // The multi company ledger: the running balance and each company's closing line run on Debit and Credit.
  if (reportKey === 118 && plan.subtotalColumns.length < 2 && table.has("DEBIT") && table.has("CREDIT")) plan.subtotalColumns.splice(0, plan.subtotalColumns.length, "DEBIT", "CREDIT");
  const subtotalColumns = [...plan.subtotalColumns];
  const grouping = [...plan.grouping];
  // Query (111): a subtotal of the amounts (or the quantity) under each book name.
  if (reportKey === 111 && table.has("BOOK_NAME")) {
    if (!grouping.includes("BOOK_NAME")) grouping.push("BOOK_NAME");
    if (subtotalColumns.length === 0) for (const column of ["DR_AMOUNT", "CR_AMOUNT", "QUANTITY"]) if (table.has(column)) subtotalColumns.push(column);
  }
  // Sales V/S Expense subtotals on the side (SALES / EXPENSE / EXP %), then the balance sheet head inside it (the desktop's grid).
  if (reportKey === 280 || reportKey === 281) for (const column of ["SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2"]) if (!grouping.includes(column)) grouping.push(column);
  // The multi year balance sheet subtotals on its side (LIABILITY / ASSET), the Difference row apart.
  if ((reportKey === 136 || reportKey === 138) && !grouping.includes("BAL_SIDE")) grouping.push("BAL_SIDE");
  // The multi company account summary, with schedules ticked: a subtotal under each schedule.
  const scheduleSubtotals = (reportKey === 115 || reportKey === 178) && table.has("SMART_SELECTED_SCHDULE");
  if (scheduleSubtotals && !grouping.includes("SMART_SELECTED_SCHDULE")) grouping.push("SMART_SELECTED_SCHDULE");
  // The multi year party product addon sale subtotals on the party (NAME), a row for each of its addon combinations under it.
  if (reportKey === 176 && !grouping.includes("NAME")) grouping.push("NAME");
  // The multi year top reports, a row a party / item of each year (Year As a Column not ticked): a subtotal for each YEAR_NAME.
  // The multi year sales v/s receipt subtotals on the side (SALE / RECEIPT), the percentages added up as the desktop's grid does.
  if (reportKey === 279 && !grouping.includes("SMART_SELECTED_ADDON1")) grouping.push("SMART_SELECTED_ADDON1");
  // Addon Details subtotals on the account (SMART_NAME) inside any addon groups.
  if (reportKey === 264 && !grouping.includes("SMART_NAME")) grouping.push("SMART_NAME");
  const multiYearTop = reportKey === 267 && !call.checkQuery.includes("CHK_YEARCOL,");
  if (multiYearTop && !grouping.includes("YEAR_NAME")) grouping.push("YEAR_NAME");
  const formatted = call.formating !== "";

  // After SP_REPORT_FORMATING the particulars (NAME) go just after the date, or first when there is no date.
  if (formatted && ![105, 133, 165, 166, 167, 3].includes(reportKey) && table.has("name")) {
    const name = table.name("name")!;
    const columnsNow = table.columns.filter((column) => column !== name);
    const dateAt = columnsNow.findIndex((column) => column.toLowerCase() === "selected_date");
    columnsNow.splice(dateAt >= 0 ? dateAt + 1 : 0, 0, name);
    table.columns.splice(0, table.columns.length, ...columnsNow);
  }
  // The ledger's Month format subtotals on the account's SMART_NAME.
  if (reportKey === 4 && call.formating === "MONTHLY" && grouping.includes("NAME")) grouping.splice(grouping.indexOf("NAME"), 1, "SMART_NAME");

  // Remove-int-blank: a number column that is zero all through is hidden.
  if (flag(properties, "remove_int_blank")) {
    for (const column of table.columns) {
      if (table.kind(column) !== "decimal") continue;
      if (table.rows.every((row) => num(row[column]) === 0)) hidden.push(column);
    }
  }

  // Closing balance (any report whose table has closing_bal), then the ledger drops openings that came to nothing.
  if (table.has("closing_bal")) {
    updateClosingBalance(plan, table);
    if (reportKey === 4 || reportKey === 38) {
      table.rows = table.rows.filter((row) => !(toText(table.get(row, "ROW_DATA_TYPE")).includes("OPENINGS") && num(table.get(row, "Debit")) === 0 && num(table.get(row, "Credit")) === 0));
    }
  }
  if (table.rows.length === 0) throw new ReportRefusal("No Records Found For Your Selection!!", "No Records For Current Selection");

  // The count in the grid's corner.
  const records = table.has("ROW_DATA_TYPE") ? table.rows.filter((row) => table.get(row, "ROW_DATA_TYPE") === "LED").length
    : table.has("led_key") ? table.rows.filter((row) => num(table.get(row, "led_key")) > 0).length
      : table.rows.length;

  // Negative only: rows with a CR balance, and every row that is not a ledger line.
  if (plan.negativesOnly) {
    table.rows = table.rows.filter((row) => toText(table.get(row, "DR_CR")) === "CR" || (table.has("ROW_DATA_TYPE") && table.get(row, "ROW_DATA_TYPE") !== "LED"));
    if (table.rows.length === 0) throw new ReportRefusal("No Negative Records Found", "Negative Selection Null");
  }

  // OutputGridSettings.
  const outputByField = (name: string) => plan.outputColumns.find((column) => text(column, "outputcol_fieldname").toLowerCase() === name.toLowerCase());
  type Column = { -readonly [K in keyof OutputColumn]: OutputColumn[K] } & { name: string; summable: boolean; dateTyped: boolean };
  const columns: Column[] = [];
  for (const name of table.columns) {
    const kind = table.kind(name);
    const base: Column = { key: name, name, caption: name, width: 90, align: "L", kind: kind === "text" ? "text" : "number", decimals: kind === "decimal" ? 2 : 0, visible: true, summable: false, dateTyped: false };
    const settings = outputByField(name);
    if (hidden.includes(name.toUpperCase().trim())) base.visible = false;
    else if (name.toUpperCase() === "SELECTED_NAME") base.visible = false;
    else if (settings) {
      if (flag(settings, "outputcol_visible")) {
        base.caption = text(settings, "outputcol_caption").toUpperCase();
        const type = text(settings, "outputcol_type").toUpperCase();
        if (type === "D") { base.kind = "date"; base.dateTyped = true; }
        else if (type === "N" || type === "C") {
          // A text column the setup calls numeric (Form Summary's CODE: the tax master's TAX_SHORT, "I18", "C9", "NONEI") stays text when it holds any value that is not a number.
          const words = kind === "text" && table.rows.some((row) => { const cell = cellString(row[name]).trim(); return cell !== "" && !Number.isFinite(Number(cell.replace(/,/g, ""))); });
          if (!words) { base.kind = "number"; base.decimals = toInt(field(settings, "outputcol_decimal")); }
        }
        // With a format the date column sizes to its text (a week reads "dd/mm/yyyy To dd/mm/yyyy").
        base.width = formatted && name.toLowerCase() === "selected_date"
          ? Math.max(60, ...table.rows.slice(0, 500).map((row) => cellString(row[name]).length * 7))
          : toInt(field(settings, "outputcol_width")) || 90;
        const align = text(settings, "outputcol_alignment").toUpperCase();
        base.align = align === "R" ? (reportKey === 286 ? "C" : "R") : align === "C" ? "C" : "L";
      } else base.visible = false;
    } else if (plan.fixColumns.has(name) || FIX_COLUMN_NAMES.has(name.toUpperCase())) {
      base.visible = false;
    } else if (kind === "decimal") {
      // A run-time number column joins the subtotals (not a closing or a rate).
      if (!subtotalColumns.includes(name) && !name.toUpperCase().includes("CLOSING") && !name.toUpperCase().includes("RATE")) subtotalColumns.push(name);
      base.decimals = 2;
      base.align = "R";
      // Wide enough for the column's subtotal (its largest possible figure is the sum of the figures), as bold as it is drawn.
      const widest = formatNumber(table.rows.reduce((sum, row) => sum + Math.abs(num(row[name])), 0), 2).length;
      base.width = Math.max(100, widest * 9 + 14, name.length * 8 + 14);
      base.caption = name.toUpperCase().includes("DR_CR") ? name.toUpperCase().replace("DR_CR", "##").replace(/_/g, " ") : name.toUpperCase().replace(/_/g, " ");
    } else {
      base.caption = name.toUpperCase().includes("DR_CR") ? name.toUpperCase().replace("DR_CR", "##").replace(/_/g, " ") : name.toUpperCase().replace(/_/g, " ");
      base.width = Math.min(260, Math.max(60, base.caption.length * 8, ...table.rows.slice(0, 200).map((row) => cellString(row[name]).length * 7)));
    }
    if (reportKey === 17 && name.toUpperCase() === "AGE_OPENING") base.caption = "OPENING";
    // Stock (17), licence 21: the quantity columns (opening, add, less, closing, the factor columns, Min Qty and Max Qty) show 4 decimals.
    if (reportKey === 17 && call.licence === 21 && ["OPENING", "ADD_QTY", "LESS_QTY", "CLSG_QTY", "ADD_FACT", "LESS_FACT", "BAL_FACT", "MIN_QTY", "MAX_QTY"].includes(name.toUpperCase())) base.decimals = 4;
    if (reportKey === 29 && call.licence === 21 && ["OPEN_QTY", "PURCH_QTY", "CR_QTY", "CHLNIN_QTY", "PRODUCTION", "STOCK_ADD", "STOCK_JV_ADD", "SALE_QTY", "DR_QTY", "CHLNOUT_QTY", "CONSUMPTION", "STOCK_LESS", "STOCK_JV_LESS", "DAMAGEIN_QTY", "DAMAGEOUT_QTY", "CLSG_QTY"].includes(name.toUpperCase())) base.decimals = 4;
    // MFG Formula Search: the component quantity shows 4 decimals.
    if (reportKey === 227 && name.toUpperCase() === "RM_QTY") { base.decimals = 4; base.align = "R"; }
    // Order Clearance: the serial no and delay days read right-justified.
    if (reportKey === 231 && ["SERIAL_NO", "DELAY_DAYS"].includes(name.toUpperCase())) base.align = "R";
    // Stock Status: the standard pack reads right-justified.
    if (reportKey === 244 && name.toUpperCase() === "STD_PACK") base.align = "R";
    // Moulding Production Plan: the figures read right-justified whatever the setup says.
    if (reportKey === 203 && ["STD_WT", "PCS_HOUR", "PLANING_QTY", "PRODUCTION", "PENDING_PLAN_QTY"].includes(name.toUpperCase())) base.align = "R";
    if (reportKey === 163 && ["STD_PACK", "PRODUCTION", "SALE"].includes(name.toUpperCase())) base.align = "R";
    columns.push(base);
  }

  // A column named |IGST|_TOTAL_TAX is an up-heading and a heading on the desktop; here one caption without the bars (Yearly Tax Summary).
  for (const column of columns) column.caption = column.caption.replace(/\|/g, "").replace(/\s+/g, " ").trim();

  // Columns removed or hidden after the subtotals (the C# does this once the grid is built).
  const removed = new Set(["SORTING_FIELD", "SORTING_DATE", "SMART_NAME", "AC_CODE", "PROD_ID", "SMART_SORTING_NAME", "OUT_KEY", "SR_NO", "LVLHEAD", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "SMART_SELECTED_SCHDULE", "RECPSELE_DATE", "SMART_PROD_DESC", "SMAN_KEY", "COLLECTION_KEY"]);
  if (reportKey !== 7 && reportKey !== 42) removed.add("BUDGET");
  if (reportKey === 5 && ["DETAIL"].includes(plan.call.filterText.toUpperCase()) && call.sortingText === "Party Wise") removed.add("NAME");
  const alwaysHidden = new Set(["ROW_DATA_TYPE", "SMART_SELECTED_PRODUCT", "SMART_LED_KEY", "BOOK", "SMART_PROCESS_KEY", "SMART_IMAGE_ENT_KEY", "LMASTER_ID", "LOG_CODE", "LOG_FIRST", "LSMALL_PKV"]);
  if (reportKey === 4 && (call.checkQuery.includes("CHK_ACC_CNFRM,") || call.checkQuery.includes("CHK_TFPRINT,"))) { removed.add("DR_CR"); removed.add("CLOSING_BAL"); }
  if (reportKey === 5 && call.checkQuery.includes("CHK_MULTICO,") === false) removed.add("CO_SHORT");

  // SetSubtotalCaptionColumn: the first shown text column, or a PARTICULARS column put in for the captions.
  const intColumns = columns.filter((column) => column.kind === "number").map((column) => column.name);
  let headingColumn = "";
  if (subtotalColumns.length > 0 || intColumns.length > 0) {
    const calculation = subtotalColumns.find((name) => table.has(name)) ?? intColumns[0];
    const calculationAt = columns.findIndex((column) => column.name.toLowerCase() === (calculation ?? "").toLowerCase());
    let at = 0;
    while (at < columns.length && (!columns[at].visible || columns[at].kind !== "text" || removed.has(columns[at].name.toUpperCase()) || alwaysHidden.has(columns[at].name.toUpperCase()))) {
      if (at === calculationAt) break;
      at += 1;
    }
    if (at >= columns.length || at === calculationAt) {
      const insertAt = at > 0 && columns[at - 1]?.name.toUpperCase() === "OPENING_BAL" ? at - 1 : Math.max(0, at);
      columns.splice(insertAt, 0, { key: "HEADING_COLUMN_BY_SYSTEM", name: "HEADING_COLUMN_BY_SYSTEM", caption: "PARTICULARS", width: reportKey === 17 && stockSummaryFormat ? 380 : 86, align: "L", kind: "text", decimals: 0, visible: ![15, 23, 44, 64].includes(reportKey), summable: false, dateTyped: false });
      headingColumn = "HEADING_COLUMN_BY_SYSTEM";
    } else headingColumn = columns[at].name;
  }
  // Ageing (5): the document column is wide enough that a party's "* Subtotal For : name" line (it runs over the date cell too, but stops at the first figure) reads whole.
  if (reportKey === 5) {
    const documents = columns.find((column) => column.name.toUpperCase() === "FULL_DOCNO");
    const nameColumn = table.name("SMART_NAME");
    if (documents && nameColumn) documents.width = Math.max(documents.width, Math.min(240, (Math.max(0, ...table.rows.slice(0, 3000).map((row) => cellString(row[nameColumn]).length)) + 18) * 7 - 90));
  }
  // Stock (17) Summary: a wide Particulars column, for the product descriptions.
  if (reportKey === 17 && stockSummaryFormat) for (const column of columns) if (column.name === "HEADING_COLUMN_BY_SYSTEM") column.width = Math.max(column.width, 380);
  // Stock (17): the Opening column stands right after Particulars (it is not in the setup's output columns, so it would come last).
  if (reportKey === 17) {
    const opening = columns.findIndex((column) => column.name.toUpperCase() === "OPENING");
    const heading = columns.findIndex((column) => column.name === "HEADING_COLUMN_BY_SYSTEM" && column.visible);
    const after = heading >= 0 ? heading : columns.findIndex((column) => column.name.toUpperCase() === "NAME" && column.visible);
    if (opening >= 0 && after >= 0 && opening !== after + 1) {
      const [moved] = columns.splice(opening, 1);
      columns.splice(opening < after ? after : after + 1, 0, moved);
    }
  }

  // Update_Subtotal: a subtotal row under each group of each level, then the final total.
  // The production planning setoff (175) and PMP assemble (177): no subtotal under a product or addon; the setoff's Summary has one under each packing date.
  const plainGroupColumns = grouping.filter((name) => !(reportKey === 21 && call.formating.toUpperCase() === "SUMMARY" && name.toUpperCase() === "NAME")).filter((name) => !(stockSummaryFormat && name.toUpperCase() === "SMART_SELECTED_PRODUCT")).filter(() => reportKey !== 175 && reportKey !== 177).filter((name) => table.has(name)).map((name) => table.name(name)!)
    // Form Summary subtotals the tax level only, not each tax inside it, in all three formats (the desktop's grid).
    // Marketing's Month and Summary are a row a group already: subtotals only for the groups outside the last one (one group: the final total only).
    .slice(0, reportKey === 14 ? 1 : reportKey === 25 && formatted ? -1 : undefined);
  const groupColumns = reportKey === 175 && call.formating.toUpperCase() === "SUMMARY" && table.has("Plan_Pack_Date") ? [table.name("Plan_Pack_Date")!] : plainGroupColumns;
  const sumColumns = subtotalColumns.filter((name) => !name.includes("%") && !name.includes("INTEREST") && table.has(name) && !hidden.includes(name)).map((name) => table.name(name)!);
  const formattedReport = false;
  // Planning FG Analysis (210): dates and day counts, no final total.
  // Outstanding Age Wise, Date Wise Detail: one list by date, with a running balance, and no party subtotals.
  const dateWiseList = reportKey === 5 && call.sortingText === "Date Wise" && call.filterText === "Detail";
  const accountOnly = (reportKey === 6 || reportKey === 7) && plan.tickedGroups.length === 1 && plan.tickedGroups[0].text.toUpperCase() === "ACCOUNT";
  const allowSubtotal = reportKey !== 210 && !dateWiseList && !accountOnly;
  const out: { kind: OutputRow["kind"]; level: number; rowType: string; values: Record<string, unknown>; caption?: string; treeOnly?: string[] }[] = [];
  const subtotalsWanted = (flag(properties, "subtotal_req") || scheduleSubtotals || [193, 194, 195, 196, 197].includes(reportKey)) && allowSubtotal;
  // The ageing's Summary and Monthly, are a row a party already: no subtotal under each, only the final total.
  const oneRowAParty = (reportKey === 5 && ["SUMMARY", "MONTHLY"].includes(plan.call.filterText.toUpperCase()));
  if (subtotalsWanted && groupColumns.length > 0 && (flag(properties, "subtotal_req") || scheduleSubtotals) && !oneRowAParty) {
    const sums = groupColumns.map(() => new Map<string, number>());
    // Ageing (5): a party's line shows its oldest Days and its longest CDays (a figure that is not added).
    const oldest = reportKey === 5 ? ["Days", "CDays"].map((name) => table.name(name)).filter((name): name is string => name !== undefined) : [];
    // Partywise Stock (16): a subtotal line's RATE is its average, SALE_VALUE over LESS (shown with the tree or F6, like the ageing's days).
    const averageRate = (values: Record<string, unknown>): string[] => {
      const rate = table.name("RATE"), sale = table.name("SALE_VALUE"), less = table.name("LESS_QTY") ?? table.name("LESS");
      if (reportKey !== 16 || !rate || !sale || !less || num(values[less]) === 0) return [];
      values[rate] = Math.round(num(values[sale]) / num(values[less]) * 100) / 100;
      return [rate];
    };
    const reset = (level: number) => { for (const column of [...sumColumns, ...oldest]) sums[level].set(column, 0); };
    groupColumns.forEach((_, level) => reset(level));
    const key = (row: ResultRow, level: number) => groupColumns.slice(0, level + 1).map((column) => cellString(row[column])).join("\u0001");
    const rows = table.rows;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      // The journal's SP builds no heading rows (the ledger's and day book's do): a heading for each group that starts here, outermost first.
      if ((reportKey === 2 || (reportKey === 3 && plan.call.checkQuery.includes("CHK_GRPASHD,"))) && table.name("NAME")) {
        const headingTypes: Record<string, string> = { SMART_NAME: "AC", SMART_SELECTED_BOOK: "BOOK", SMART_SELECTED_SCHDULE: "SCHEDULE", SMART_SELECTED_ADDON1: "ADDON_1", SMART_SELECTED_ADDON2: "ADDON_2", SMART_SELECTED_ADDON3: "ADDON_3", SMART_SELECTED_ADDON4: "ADDON_4" };
        const previous = rows[index - 1];
        const changed = groupColumns.findIndex((_, level) => previous === undefined || key(previous, level) !== key(row, level));
        if (changed >= 0) {
          for (let level = changed; level < groupColumns.length; level += 1) {
            const type = headingTypes[groupColumns[level].toUpperCase()];
            const value = cellString(row[groupColumns[level]]);
            if (type && value !== "") out.push({ kind: "data", level: -2, rowType: type, values: { [table.name("NAME")!]: value } });
          }
        }
      }
      out.push({ kind: "data", level: -2, rowType: toText(table.get(row, "ROW_DATA_TYPE")), values: row });
      for (let level = 0; level < groupColumns.length; level += 1) {
        for (const column of sumColumns) sums[level].set(column, money((sums[level].get(column) ?? 0) + num(row[column])));
        for (const column of oldest) sums[level].set(column, Math.max(sums[level].get(column) ?? 0, num(row[column])));
      }
      const next = rows[index + 1];
      for (let level = groupColumns.length - 1; level >= 0; level -= 1) {
        if (next !== undefined && key(next, level) === key(row, level)) continue;
        // A group's heading row has no value for the groups inside it yet: nothing to subtotal there (it showed as "Subtotal For :" of nothing, 0.00).
        if (/^(ADDON_[0-9]|BOOK|SCHEDULE)$/.test(toText(table.get(row, "ROW_DATA_TYPE")).toUpperCase()) && cellString(row[groupColumns[level]]) === "") continue;
        const values: Record<string, unknown> = {};
        for (const column of [...sumColumns, ...oldest]) values[column] = sums[level].get(column) ?? 0;
        const treeOnly = [...oldest, ...averageRate(values)];
        out.push({ kind: "subtotal", level, rowType: "", values, caption: `${"*".repeat(level + 1)} Subtotal For : ${cellString(row[groupColumns[level]])} `, ...(treeOnly.length > 0 ? { treeOnly } : {}) });
        reset(level);
      }
    }
  } else {
    for (const row of table.rows) out.push({ kind: "data", level: -2, rowType: toText(table.get(row, "ROW_DATA_TYPE")), values: row });
  }
  // Stock Summary and the Stock report's Summary format: with an addon ticked the products stay under their addon, each addon block ending in its subtotal (as the Stock report's own list does).
  // A blank line between a group's subtotal and the next addon heading (web only), so one addon's block stands apart from the next.
  for (let at = out.length - 1; at > 0; at -= 1) if ((/^ADDON_[0-9]$/.test(out[at].rowType) || (reportKey === 17 && out[at].rowType === "PRODUCT")) && out[at - 1].kind === "subtotal") out.splice(at, 0, { kind: "data", level: -2, rowType: "GAP", values: {} });
  const finalTotal = ![18, 22, 57, 136, 138, 156, 279, 280, 281].includes(reportKey) || reportKey === 80;
  // Trial Balance / Schedule with the account as the only group: one row an account, no subtotals, but the final total is still required.
  const totalWanted = subtotalsWanted || (accountOnly && (flag(properties, "subtotal_req") || scheduleSubtotals));
  if (finalTotal && totalWanted && !(reportKey === 4 && call.formating === "MONTHLY")) {
    const values: Record<string, unknown> = {};
    for (const column of sumColumns) values[column] = money(table.rows.reduce((sum, row) => sum + num(row[column]), 0));
    // Partywise Stock (16): the final line's RATE is the average too, shown with the tree or F6.
    const rateName = reportKey === 16 ? table.name("RATE") : undefined, saleName = table.name("SALE_VALUE"), lessName = table.name("LESS_QTY") ?? table.name("LESS");
    const averaged = rateName && saleName && lessName && num(values[lessName]) !== 0;
    if (averaged) values[rateName] = Math.round(num(values[saleName]) / num(values[lessName]) * 100) / 100;
    out.push({ kind: "total", level: -1, rowType: "", values, caption: `${"*".repeat(groupColumns.length)}* Final Total : `, ...(averaged ? { treeOnly: [rateName] } : {}) });
  }
  void formattedReport;
  // Day book and register (no format): a last line "Total Entries : n" in the date column.
  if ((reportKey === 1 || reportKey === 3) && !formatted && table.has("selected_date")) {
    const count = table.has("ROW_DATA_TYPE") ? table.rows.filter((row) => table.get(row, "ROW_DATA_TYPE") === "LED").length
      : table.has("led_key") ? table.rows.filter((row) => num(table.get(row, "led_key")) > 0).length
        : table.rows.length;
    out.push({ kind: "data", level: -2, rowType: "COUNT", values: { [table.name("selected_date")!]: `Total Entries : ${count}` } });
  }

  // The visible columns and the rows as the grid draws them.
  const shown = columns.filter((column) => column.visible && !removed.has(column.name.toUpperCase()) && !alwaysHidden.has(column.name.toUpperCase()));
  const ledgerDrawing = (reportKey === 4 && call.formating !== "MONTHLY") || reportKey === 38 || reportKey === 62;
  const drCrName = table.name("DR_CR");
  const nameColumn = shown.find((column) => column.name.toUpperCase() === "NAME")?.name;
  // A group's heading carries as many stars as its subtotal does (the outermost group one, the next two ...), so the two can be matched by eye.
  const headingLevel: Record<string, number> = {};
  if (subtotalsWanted && flag(properties, "subtotal_req")) {
    const typeOf: Record<string, string> = { SMART_NAME: "AC", SMART_SELECTED_BOOK: "BOOK", SMART_SELECTED_SCHDULE: "SCHEDULE", SMART_SELECTED_ADDON1: "ADDON_1", SMART_SELECTED_ADDON2: "ADDON_2", SMART_SELECTED_ADDON3: "ADDON_3", SMART_SELECTED_ADDON4: "ADDON_4" };
    groupColumns.forEach((column, level) => { const type = typeOf[column.toUpperCase()]; if (type) headingLevel[type] = level; });
  }
  // A blank line before each main group's heading (the first group, level 0; the ledger's account), so where one group ends stands out. The grid draws it white.
  for (let at = out.length - 1; at > 0; at -= 1) {
    const type = out[at].rowType.toUpperCase();
    const main = out[at].kind === "data" && (headingLevel[type] === 0 || ([4, 105, 125].includes(reportKey) && type === "AC"));
    // The ageing's contact line is a second AC heading under the party's own: no gap between the two.
    if (main && out[at - 1].rowType !== "GAP" && !(reportKey === 5 && type === "AC" && out[at - 1].rowType.toUpperCase() === "AC")) out.splice(at, 0, { kind: "data", level: -2, rowType: "GAP", values: {} });
  }
  // Bank Reconciliation (15): its heading and total lines (H0 .. H2, T0 .. T2) are drawn as the desktop's coloured level lines: the bank book's balance and the pass book's
  // balance (level 0), the cheques issued and their total (1), the cheques deposited and their total (2).
  if (reportKey === 15) {
    for (const entry of out) {
      const match = /^[HT]([0-2])$/.exec(entry.rowType.toUpperCase());
      if (match) { entry.kind = "subtotal"; entry.level = [1, 3, 0][Number(match[1])]; }
    }
  }
  const rows: OutputRow[] = out.map((entry) => {
    const values: Record<string, string> = {};
    const node = entry.kind !== "data";
    const rowType = entry.rowType.toUpperCase();
    for (const column of shown) {
      // The stock summary has no name column: the product's description heads its line in the system's PARTICULARS column.
      const raw = column.name === "HEADING_COLUMN_BY_SYSTEM" ? (reportKey === 17 && stockSummaryFormat && !node ? entry.values[table.name("SELECTED_PRODUCT") ?? "SELECTED_PRODUCT"] : null) : entry.values[column.name];
      if (column.kind !== "number") { values[column.name] = column.kind === "date" || /date/i.test(column.name) ? dateCell(raw) : cellString(raw); continue; }
      if (raw === null || raw === undefined || raw === "") { values[column.name] = ""; continue; }
      const value = num(raw);
      let shownText = formatNumber(value, column.decimals);
      if ((!node || reportKey === 15) && value === 0) {
        if (ledgerDrawing) {
          const caption = column.caption.toUpperCase();
          if (rowType !== "CLOSING" || caption.startsWith("DEBIT")) {
            const debitException = rowType === "LED" && num(entry.values[table.name("Credit") ?? "Credit"]) === 0 && toText(entry.values[table.name("NAME") ?? "NAME"]) !== "" && caption.startsWith("DEBIT");
            if (!debitException) {
              if (!caption.startsWith("CLOSING")) shownText = "";
              else if (toText(drCrName ? entry.values[drCrName] : "").toUpperCase() !== "DR") shownText = "";
            }
          }
          if (rowType === "CLOSING") {
            const debit = num(entry.values[table.name("DEBIT") ?? "DEBIT"]);
            const credit = num(entry.values[table.name("CREDIT") ?? "CREDIT"]);
            if (!(debit === 0 && credit === 0)) shownText = "";
          }
        } else if (!(call.licence === 3 && reportKey === 22) && !(call.licence !== 3 && reportKey === 80)) {
          shownText = "";
        }
      }
      values[column.name] = shownText;
    }
    if (entry.caption !== undefined && headingColumn !== "") values[headingColumn] = entry.caption;
    // A ledger's heading row reads "* Name".
    if (nameColumn && (values[nameColumn] ?? "").trim() !== "" && (headingLevel[rowType] !== undefined || (reportKey === 4 && rowType === "AC"))) values[nameColumn] = `${"*".repeat((headingLevel[rowType] ?? 0) + 1)} ${values[nameColumn].trim()}`;
    // The ageing's detail heading already reads in the first (document) column: the name column keeps nothing on it, and the marker moves to that text.
    if (reportKey === 5 && rowType === "AC" && !node) {
      const docColumn = shown.find((column) => column.name.toUpperCase() === "FULL_DOCNO")?.name;
      if (docColumn && nameColumn && (values[docColumn] ?? "").trim() !== "") {
        values[docColumn] = `${"*".repeat((headingLevel[rowType] ?? 0) + 1)} ${values[docColumn].trim()}`;
        values[nameColumn] = "";
      }
    }
    const keyOf = (name: string) => { const column = table.name(name); return column && !node ? Math.max(0, Math.trunc(num(entry.values[column]))) : 0; };
    // Stock Status (244): the standard pack cell is coloured by the status (Available green, Low Stock red, Under Process blue).
    const statusName = reportKey === 244 && !node ? table.name("PROD_STATUS") : undefined;
    const packName = statusName ? table.name("STD_PACK") : undefined;
    const status = statusName ? toText(entry.values[statusName]) : "";
    const statusColour = status.startsWith("Available") ? "MediumSeaGreen" : status.startsWith("Low Stock") ? "Red" : status === "Under Process" ? "DodgerBlue" : undefined;
    const colours: Record<string, string> = packName && statusColour ? { [packName]: statusColour } : {};
    // Stock (17) with Print Min - Max Qty. Column: the Min Qty cell is red when the closing is under it, the Max Qty cell green when the closing is over it.
    if (reportKey === 17 && !node) {
      const closingName = table.name("CLSG_QTY");
      const minName = table.name("MIN_QTY");
      const maxName = table.name("MAX_QTY");
      const closingRaw = closingName ? entry.values[closingName] : null;
      if (closingRaw !== null && closingRaw !== undefined && closingRaw !== "") {
        const closing = num(closingRaw);
        const min = minName ? entry.values[minName] : null;
        const max = maxName ? entry.values[maxName] : null;
        if (minName && min !== null && min !== undefined && min !== "" && num(min) > 0 && closing < num(min)) colours[minName] = "Red";
        if (maxName && max !== null && max !== undefined && max !== "" && num(max) > 0 && closing > num(max)) colours[maxName] = "LimeGreen";
      }
    }
    const cellColours = Object.keys(colours).length > 0 ? colours : undefined;
    // Trial Balance (an account above the schedule codes) and Sales with Expense: Enter zooms into the account's Ledger.
    const zoomCode = (reportKey === 6 || reportKey === 280) && !node ? keyOf("SMART_AC_CODE") : 0;
    const acCode = zoomCode > (reportKey === 6 ? 27 : 0) ? zoomCode : 0;
    // The Logfile's master rows (account, product, addon): the master's id and code, and its first-combo text, for the edit log.
    const masterId = keyOf("LMASTER_ID");
    const firstColumn = table.name("LOG_FIRST");
    const pkvColumn = table.name("LSMALL_PKV");
    // The Logfile's OTHER ENTRY rows (LMASTER_ID is the entry's id there, LSMALL_PKV the key of the row it saved) are read from LOG_SMALLENTRY.
    const masterLog = masterId > 0
      ? (pkvColumn !== undefined || reportKey === 50 && table.name("ENTRY_NAME") !== undefined
        ? { id: masterId, code: 0, first: pkvColumn ? String(entry.values[pkvColumn] ?? "") : "", small: true }
        : { id: masterId, code: keyOf("LOG_CODE"), first: firstColumn ? String(entry.values[firstColumn] ?? "") : "" })
      : undefined;
    return { kind: entry.kind, level: entry.level, rowType, values, ledKey: keyOf("SMART_LED_KEY"), processKey: keyOf("SMART_PROCESS_KEY"), ...(masterLog ? { masterLog } : {}), ...(cellColours ? { cellColours } : {}), ...(acCode ? { acCode } : {}), ...(entry.treeOnly ? { treeOnly: entry.treeOnly } : {}) };
  });

  // Subtotal and heading colours (report_style, and Update_Subtotal's colour for a grouping column).
  const styles = await readStyles(loader);
  const levelColours: Record<string, string> = { ...styles.levels };
  groupColumns.forEach((column, level) => {
    const colour = { SMART_NAME: styles.named.str_color_account, SMART_SELECTED_BOOK: styles.named.str_color_book, SMART_SELECTED_ADDON1: styles.named.str_color_addon1, SMART_SELECTED_ADDON2: styles.named.str_color_addon2, SMART_SELECTED_ADDON3: styles.named.str_color_addon3, SMART_SELECTED_ADDON4: styles.named.str_color_addon4 }[column.toUpperCase()];
    if (colour) levelColours[String(level)] = colour;
  });
  const headingColours: Record<string, string> = { AC: styles.named.str_color_account, ST: styles.named.str_color_account, BOOK: styles.named.str_color_book, SCHEDULE: styles.named.str_color_schedule, FT: "Pink", ...(reportKey === 17 ? { PRODUCT: levelColours["0"] ?? styles.named.str_color_account } : {}), ADDON_1: styles.named.str_color_addon1, ADDON_2: styles.named.str_color_addon2, ADDON_3: styles.named.str_color_addon3, ADDON_4: styles.named.str_color_addon4 };

  // The group each heading row type stands for (an addon group is ADDON_1, ADDON_2 ... in tick order).
  const headingCaptions: Record<string, string> = {};
  let addons = 0;
  for (const group of plan.tickedGroups) {
    const name = group.text.trim();
    if (Number(group.value) > 0) { addons += 1; headingCaptions[`ADDON_${addons}`] = name; }
    else headingCaptions[({ ACCOUNT: "AC", BOOK: "BOOK", SCHEDULE: "SCHEDULE" } as Record<string, string>)[name.toUpperCase()] ?? name.toUpperCase()] = name;
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  return {
    title: text(properties, "report_head"),
    dateLine: plan.dateLine,
    selectionLine: plan.selectionLine,
    columns: shown.map(({ key, caption, width, align, kind, decimals, visible }) => ({ key, caption, width, align, kind, decimals, visible })),
    rows,
    groups: groupColumns,
    records,
    frozen: 0,
    subtotals: flag(properties, "subtotal_req"),
    reportKey,
    levelColours,
    headingColours,
    headingLevels: headingLevel,
    headingCaptions,
    formating: call.formating,
    planning: reportKey === 1 ? await readCashPlanning(loader, plan) : null,
    budgets: reportKey === 42 ? null : await readBudgetUse(loader, plan),
    elapsed: `${String(Math.floor(elapsed / 60)).padStart(2, "0")} Minutes ${String(elapsed % 60).padStart(2, "0")} Seconds`,
    warnings: [...loader.warnings],
  };
}
