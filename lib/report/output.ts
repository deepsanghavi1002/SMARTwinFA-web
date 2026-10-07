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
function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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
  if (reportKey === 1 && table.has("closing_bal")) cashBookTotals(plan);
  const subtotalColumns = [...plan.subtotalColumns];
  const grouping = [...plan.grouping];
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
        else if (type === "N" || type === "C") { base.kind = "number"; base.decimals = toInt(field(settings, "outputcol_decimal")); }
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
      base.width = 100;
      base.caption = name.toUpperCase().includes("DR_CR") ? name.toUpperCase().replace("DR_CR", "##").replace(/_/g, " ") : name.toUpperCase().replace(/_/g, " ");
    } else {
      base.caption = name.toUpperCase().includes("DR_CR") ? name.toUpperCase().replace("DR_CR", "##").replace(/_/g, " ") : name.toUpperCase().replace(/_/g, " ");
      base.width = Math.min(260, Math.max(60, base.caption.length * 8, ...table.rows.slice(0, 200).map((row) => cellString(row[name]).length * 7)));
    }
    columns.push(base);
  }

  // Columns removed or hidden after the subtotals (the C# does this once the grid is built).
  const removed = new Set(["SORTING_FIELD", "SORTING_DATE", "SMART_NAME", "AC_CODE", "PROD_ID", "SMART_SORTING_NAME", "OUT_KEY", "SR_NO", "LVLHEAD", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "SMART_SELECTED_SCHDULE", "RECPSELE_DATE", "SMART_PROD_DESC", "SMAN_KEY", "COLLECTION_KEY"]);
  if (reportKey !== 7 && reportKey !== 42) removed.add("BUDGET");
  const alwaysHidden = new Set(["ROW_DATA_TYPE", "SMART_SELECTED_PRODUCT", "SMART_LED_KEY", "BOOK", "SMART_PROCESS_KEY", "LMASTER_ID", "LOG_CODE", "LSMALL_PKV"]);
  if (reportKey === 4 && (call.checkQuery.includes("CHK_ACC_CNFRM,") || call.checkQuery.includes("CHK_TFPRINT,"))) { removed.add("DR_CR"); removed.add("CLOSING_BAL"); }

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
      columns.splice(insertAt, 0, { key: "HEADING_COLUMN_BY_SYSTEM", name: "HEADING_COLUMN_BY_SYSTEM", caption: "PARTICULARS", width: 86, align: "L", kind: "text", decimals: 0, visible: ![23, 44, 64].includes(reportKey), summable: false, dateTyped: false });
      headingColumn = "HEADING_COLUMN_BY_SYSTEM";
    } else headingColumn = columns[at].name;
  }

  // Update_Subtotal: a subtotal row under each group of each level, then the final total.
  const groupColumns = grouping.filter((name) => !(reportKey === 21 && call.formating.toUpperCase() === "SUMMARY" && name.toUpperCase() === "NAME")).filter((name) => table.has(name)).map((name) => table.name(name)!);
  const sumColumns = subtotalColumns.filter((name) => !name.includes("%") && !name.includes("INTEREST") && table.has(name) && !hidden.includes(name)).map((name) => table.name(name)!);
  const formattedReport = false;
  const allowSubtotal = !((reportKey === 6 || reportKey === 7) && plan.tickedGroups.length === 1 && plan.tickedGroups[0].text.toUpperCase() === "ACCOUNT");
  const out: { kind: OutputRow["kind"]; level: number; rowType: string; values: Record<string, unknown>; caption?: string }[] = [];
  const subtotalsWanted = (flag(properties, "subtotal_req") || [193, 194, 195, 196, 197].includes(reportKey)) && allowSubtotal;
  // The ageing's Summary and Monthly, are a row a party already: no subtotal under each, only the final total.
  const oneRowAParty = (reportKey === 5 && ["SUMMARY", "MONTHLY"].includes(plan.call.filterText.toUpperCase()));
  if (subtotalsWanted && groupColumns.length > 0 && flag(properties, "subtotal_req") && !oneRowAParty) {
    const sums = groupColumns.map(() => new Map<string, number>());
    const reset = (level: number) => { for (const column of sumColumns) sums[level].set(column, 0); };
    groupColumns.forEach((_, level) => reset(level));
    const key = (row: ResultRow, level: number) => groupColumns.slice(0, level + 1).map((column) => cellString(row[column])).join("\u0001");
    const rows = table.rows;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      // The journal's SP builds no heading rows (the ledger's and day book's do): a heading for each group that starts here, outermost first.
      if ((reportKey === 2 || reportKey === 3) && table.name("NAME")) {
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
      for (let level = 0; level < groupColumns.length; level += 1) for (const column of sumColumns) sums[level].set(column, money((sums[level].get(column) ?? 0) + num(row[column])));
      const next = rows[index + 1];
      for (let level = groupColumns.length - 1; level >= 0; level -= 1) {
        if (next !== undefined && key(next, level) === key(row, level)) continue;
        // A group's heading row has no value for the groups inside it yet: nothing to subtotal there (it showed as "Subtotal For :" of nothing, 0.00).
        if (/^(ADDON_[0-9]|BOOK|SCHEDULE)$/.test(toText(table.get(row, "ROW_DATA_TYPE")).toUpperCase()) && cellString(row[groupColumns[level]]) === "") continue;
        const values: Record<string, unknown> = {};
        for (const column of sumColumns) values[column] = sums[level].get(column) ?? 0;
        out.push({ kind: "subtotal", level, rowType: "", values, caption: `${"*".repeat(level + 1)} Subtotal For : ${cellString(row[groupColumns[level]])} ` });
        reset(level);
      }
    }
  } else {
    for (const row of table.rows) out.push({ kind: "data", level: -2, rowType: toText(table.get(row, "ROW_DATA_TYPE")), values: row });
  }
  // A blank line between a group's subtotal and the next addon heading (web only), so one addon's block stands apart from the next.
  for (let at = out.length - 1; at > 0; at -= 1) if (/^ADDON_[0-9]$/.test(out[at].rowType) && out[at - 1].kind === "subtotal") out.splice(at, 0, { kind: "data", level: -2, rowType: "GAP", values: {} });
  const finalTotal = ![18, 22, 57, 136, 138, 156, 279, 280, 281].includes(reportKey) || reportKey === 80;
  if (finalTotal && subtotalsWanted && !(reportKey === 4 && call.formating === "MONTHLY")) {
    const values: Record<string, unknown> = {};
    for (const column of sumColumns) values[column] = money(table.rows.reduce((sum, row) => sum + num(row[column]), 0));
    out.push({ kind: "total", level: -1, rowType: "", values, caption: `${"*".repeat(groupColumns.length)}* Final Total : ` });
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
    const main = out[at].kind === "data" && (headingLevel[type] === 0 || (reportKey === 4 && type === "AC"));
    if (main && out[at - 1].rowType !== "GAP") out.splice(at, 0, { kind: "data", level: -2, rowType: "GAP", values: {} });
  }
  const rows: OutputRow[] = out.map((entry) => {
    const values: Record<string, string> = {};
    const node = entry.kind !== "data";
    const rowType = entry.rowType.toUpperCase();
    for (const column of shown) {
      const raw = column.name === "HEADING_COLUMN_BY_SYSTEM" ? null : entry.values[column.name];
      if (column.kind !== "number") { values[column.name] = column.kind === "date" || /date/i.test(column.name) ? dateCell(raw) : cellString(raw); continue; }
      if (raw === null || raw === undefined || raw === "") { values[column.name] = ""; continue; }
      const value = num(raw);
      let shownText = formatNumber(value, column.decimals);
      if (!node && value === 0) {
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
    return { kind: entry.kind, level: entry.level, rowType, values, ledKey: keyOf("SMART_LED_KEY"), processKey: keyOf("SMART_PROCESS_KEY") };
  });

  // Subtotal and heading colours (report_style, and Update_Subtotal's colour for a grouping column).
  const styles = await readStyles(loader);
  const levelColours: Record<string, string> = { ...styles.levels };
  groupColumns.forEach((column, level) => {
    const colour = { SMART_NAME: styles.named.str_color_account, SMART_SELECTED_BOOK: styles.named.str_color_book, SMART_SELECTED_ADDON1: styles.named.str_color_addon1, SMART_SELECTED_ADDON2: styles.named.str_color_addon2, SMART_SELECTED_ADDON3: styles.named.str_color_addon3, SMART_SELECTED_ADDON4: styles.named.str_color_addon4 }[column.toUpperCase()];
    if (colour) levelColours[String(level)] = colour;
  });
  const headingColours: Record<string, string> = { AC: styles.named.str_color_account, ST: styles.named.str_color_account, BOOK: styles.named.str_color_book, SCHEDULE: styles.named.str_color_schedule, FT: "Pink", ADDON_1: styles.named.str_color_addon1, ADDON_2: styles.named.str_color_addon2, ADDON_3: styles.named.str_color_addon3, ADDON_4: styles.named.str_color_addon4 };

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
