import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { dateStyle112, dateStyle6, desktopDate, sqlServerCompare } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { cashBookColumns, dayBefore, ddMmYyyy, dropColumn, formatPeriod, groupOrderTail, insertFirst, MONTH_NAMES, requireWhere, sortRows, tableFromFields, tableFromResult, textKey, unknownFormat, withEntryAddon } from "./library";
import { cashBookFrom, cashBookOpening, registerSlabBook, registerSlabs, monthlyClosingStock, partyStock, stockMovement, stockSummary } from "./reportStandard";
import { checklistDaybook } from "./checklistDaybook";
import { checklistInvoice } from "./checklistInvoice";
import { formSummaryFormats } from "./formSummaryFormats";
import { fundFlow } from "./fundFlow";
import { money, num, runReportSql } from "./run";

/**
 * SP_REPORT_FORMATING: a report's formats (Month, Daily, Weekly, 15 Days, Quarter, Half Year,
 * Summary ...), one branch per report key as in the SQL Server procedure, each finished by the
 * procedure's common tail (LBL_RESULT) that adds FROM, WHERE, GROUP BY and ORDER BY to the
 * format's select. The periods' SQL is shared (library.formatPeriod).
 *
 * Ported branches: 14 (form summary, in formSummaryFormats.ts), 1 (day book), 3 (register), 4 (ledger), 21 (outstanding clearance), 29 (stock summary, in reportStandard.ts), 42 (budget), 93 (stock movement, in reportStandard.ts), 109 (fund flow, in fundFlow.ts), 119 (checklist invoice, in checklistInvoice.ts), 120 (checklist daybook, in checklistDaybook.ts), 258 (monthly closing stock, in reportStandard.ts).
 */
export async function formattedReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  switch (plan.call.reportKey) {
    case 1: return daybookFormats(loader, plan);
    case 3: return registerFormats(loader, plan);
    case 4: return ledgerFormats(loader, plan);
    case 14: return formSummaryFormats(loader, plan);
    case 16: return partyStock(loader, plan);
    case 21: return outstandingClearance(loader, plan);
    case 29: return stockSummary(loader, plan);
    case 42: return budget(loader, plan);
    case 93: return stockMovement(loader, plan);
    case 109: return fundFlow(loader, plan);
    case 119: return checklistInvoice(loader, plan);
    case 120: return checklistDaybook(loader, plan);
    case 258: return monthlyClosingStock(loader, plan);
    default: throw new ReportRefusal(`Report ${plan.call.reportKey}'s formats are not available in the web version yet.`, "Not ported yet");
  }
}

// ======================================================================================
// 1: DAYBOOK (lines 247-778)
// ======================================================================================
//
// A row per period with what came in and went out; with no group and an opening, an "Opening
// Balance B/d" row heads them. SUMMARY is one row for the whole period. MONTHLY is one row with a
// pair of columns per month and the year's totals (the opening in them).
//
// Where the desktop's figures come out wrong they are put right here, and only there:
//  - a credit (negative) opening went into PAYMENT / TOTAL_WITHDRAWAL as a negative amount, which
//    turned the running balance's sign; here it goes in as the amount paid out.
//  - Weekly and 15 Days took the opening up to the start of the first period, not up to From, so the
//    vouchers between the two were in neither; here the opening runs to the day before From.
//  - Month stepped from the From day (15/Apr to 10/Oct gave no October); here every month the
//    period touches has its columns.
//  - with a group, Daily / Weekly ... named ac.name without grouping on it (SQL Server refuses) and
//    Month added the opening to every group's row; here the group's name is grouped on and the
//    book's opening is left out, as Detail does with a group.

async function daybookFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const csFrom = cashBookFrom(plan);
  const where = call.where;
  const format = call.formating;
  const book = call.book;
  if (book !== 4 && book !== 5 && book !== 6) throw new ReportRefusal(`${format} is only for a cash, discount or bank account`, "INTERNAL PROGRAM FAILURE");
  const [inCol, outCol] = cashBookColumns(book);
  const opening = call.filterText.toUpperCase() === "NONE" ? await cashBookOpening(loader, plan, csFrom, dayBefore(call.from)) : 0;
  if (format === "MONTHLY") return daybookMonthly(loader, plan, csFrom, opening);

  const selectStart = call.queryStart.trim();
  const csGroup = call.groupBy.trim();
  const csOrder = call.orderBy.trim();
  const nameLead = csGroup !== "" ? `ac.name as "NAME",` : "";
  // With no group at all the opening heads the periods, in a NAME column of its own.
  const openingRow = selectStart === "" && csGroup === "" && opening !== 0 && format !== "SUMMARY";
  const blankName = openingRow ? `,CAST('' as VARCHAR) AS "NAME"` : "";
  const sums = (zero: string, cc: boolean) => `sum(case when led.bk_dbcode=1 then LED.AMOUNT else ${zero} end) as "${inCol}",sum(case when led.bk_dbcode=2 then LED.AMOUNT else ${zero} end) as "${outCol}",0.00 as "CLOSING_BAL",'' as "DR_CR"${cc ? `,0.00 AS "CC_AMT"` : ""}`;

  let body: string;
  let periodGroup = "";
  let periodOrder = "";
  const period = formatPeriod(format, call.dateField);
  if (period) {
    body = `${nameLead}${period.label} AS "${period.alias}"${blankName},${sums(format === "QUATER_YEAR" ? "0" : "0.00", format === "DAILY")}`;
    periodGroup = period.group;
    periodOrder = period.order;
  } else if (format === "SUMMARY") {
    body = `${csGroup.toUpperCase().includes("NAME") ? `ac.name as "NAME",` : ""}${sums("0.00", false)}`;
  } else {
    throw unknownFormat(format);
  }
  requireWhere(where);

  // With no group and an opening (not Summary): TEMP_TABLE_DAYBOOK1, the opening row then the periods.
  if (openingRow) {
    const table = tableFromResult(await runReportSql(loader, frag(`SELECT ${body} ${csFrom} ${where}${groupOrderTail([periodGroup], [periodOrder])}`)));
    insertFirst(table, { SELECTED_DATE: "", NAME: "Opening Balance B/d", [inCol]: opening > 0 ? opening : 0, [outCol]: opening < 0 ? Math.abs(opening) : 0, CLOSING_BAL: 0, DR_CR: "", CC_AMT: 0 });
    return table;
  }
  const select = selectStart !== "" ? `SELECT ${body},${selectStart}` : `SELECT ${body}`;
  return tableFromResult(await runReportSql(loader, frag(`${select} ${csFrom} ${where}${groupOrderTail([csGroup, periodGroup], [csOrder, periodOrder])}`)));
}

/**
 * MONTHLY: one row (or one per group) with each month's deposits and withdrawals, then the totals
 * with the opening in them. Payment Only / Receipt Only leave out the other side's columns; Show
 * Closing Balance (CHK_SOCBM) adds a closing and DR/CR column per month, left at 0.
 */
async function daybookMonthly(loader: Loader, plan: ReportPlan, csFrom: string, opening: number): Promise<ResultTable> {
  const { call } = plan;
  const date = call.dateField;
  const where = call.where;
  const withDeposit = !/led\.bk_dbcode=2/i.test(where);
  const withWithdrawal = !/led\.bk_dbcode=1/i.test(where);
  const selectStart = call.queryStart.trim();
  const csGroup = call.groupBy.trim();
  const csOrder = call.orderBy.trim();
  const totalOpening = selectStart === "" && csGroup === "" ? opening : 0;
  const columns: string[] = [];
  for (let month = new Date(call.from.getFullYear(), call.from.getMonth(), 1); month <= call.upto; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
    const name = MONTH_NAMES[month.getMonth()];
    const inMonth = `EXTRACT(MONTH FROM ${date}) = ${month.getMonth() + 1}`;
    if (withDeposit) columns.push(`coalesce(SUM(case when led.BK_DBCODE=1 and ${inMonth} then led.AMOUNT end),0.00) as "${name} DEPOSIT"`);
    if (withWithdrawal) columns.push(`coalesce(SUM(case when led.BK_DBCODE=2 and ${inMonth} then led.AMOUNT end),0.00) as "${name} WITHDRAWAL"`);
    if (call.closingNeeded) columns.push(`0.00 as "${name} CLOSING_BAL"`, `' ' as "${name} DR_CR"`);
  }
  if (withDeposit) columns.push(`coalesce(SUM(case when led.BK_DBCODE=1 then led.AMOUNT end),0.00)${totalOpening > 0 ? ` + ${totalOpening.toFixed(2)}` : ""} as "TOTAL_DEPOSIT"`);
  if (withWithdrawal) columns.push(`coalesce(SUM(case when led.BK_DBCODE=2 then led.AMOUNT end),0.00)${totalOpening < 0 ? ` + ${Math.abs(totalOpening).toFixed(2)}` : ""} as "TOTAL_WITHDRAWAL"`);
  if (call.closingNeeded) columns.push(`0.00 as "TOTAL_CLOSINGS"`, `CAST('' AS VARCHAR(2)) AS "TOT._DR_CR"`);
  const list = columns.join(",");
  const select = selectStart !== "" ? `SELECT ${list},${selectStart}`
    : opening !== 0 && csGroup === "" ? `SELECT ${opening.toFixed(2)} AS "OPENING_BAL",${list}`
    : csGroup !== "" ? `SELECT ac.name as "NAME",${list}`
    : `SELECT ${list}`;
  requireWhere(where);
  // The group's NAME (ac.name) is grouped on too when it heads the select.
  const groupBy = csGroup !== "" && selectStart === "" && !csGroup.toLowerCase().includes("ac.name") ? `${csGroup},ac.name` : csGroup;
  return tableFromResult(await runReportSql(loader, pgFragment(`${select} ${csFrom} ${where}${groupOrderTail([groupBy], [csOrder])}`, plan, loader.session.companySchema)));
}

// ======================================================================================
// 3: REGISTER (lines 932-2126)
// ======================================================================================
//
// The register's formats (the standard list is in reportStandard.ts):
//  - Month: a row for each month (and party, when grouped on the account) with the quantity, every slab
//    of the book (NET_AMOUNT before the first tax) and FINAL_TOTAL.
//  - Daily, Weekly, 15 Days, Quarter, Half Year, Summary: a row for each period with its amount and
//    every slab of the book. Daily with Quantity Col. Required adds the quantity.
//  - Item Detail: each voucher's line followed by a line for each of its items (HSN, quantity, factor,
//    rate, value, MRP, and each item slab's % and amount); Show Default Slabs puts the bill's slabs on
//    the voucher's line.
//  - Master Detail: a row for each voucher with the taxable value and tax of each tax master (GST 5%,
//    GST 12% ...) and the non-tax slabs.
// Include / Exclude Slab with a format and Include / Exclude Form are left out, as in the register.
//
// Where the desktop's figures come out wrong they are put right here: Daily with Quantity left the
// amount out of its result; here the amount stays.

type TaxMaster = { short: string; key: number; type: string; percent: number };

/** The register's from, as SP_REPORT_FORMATING readies it (the addon and product markers). */
function registerFormatFrom(plan: ReportPlan): { from: string; withProduct: boolean } {
  const { call } = plan;
  const db = call.database;
  let from = call.from_;
  const withProduct = call.prodAddonRelate === "P";
  if (withProduct) from = from.replace("sys.pdatas", "((").replace("sys.pdatae", `left join ${db}prod_ledger prodled on led.led_key = prodled.led_id)left join ${db}addon_data padata on prodled.prod_id = padata.prod_id)`);
  else from = from.replace("sys.pdatas", "").replace("sys.pdatae", "");
  if (call.orderBy.toLowerCase().includes("aentry")) from = from.replace("sys.aents", "(").replace("sys.aente", `left join ${db}ADDON_AENTRY aentry on led.led_key = aentry.aona_ledid)`);
  else from = from.replace("sys.aents", "").replace("sys.aente", "");
  return { from, withProduct };
}

async function registerFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const format = call.formating;
  const filter = call.filterId.toUpperCase();
  if (call.prodAddonRelate === "P" && format !== "ITEM_DETAIL") throw new ReportRefusal(`${format} PRODUCT ADDON NOT ALLOWED......`, "INTERNAL PROGRAM FAILURE");
  if ((filter === "IFORM" || filter === "EFORM") && format !== "MASTER_DETAIL") throw new ReportRefusal(`${filter === "IFORM" ? "Include Form" : "Exclude Form"} Only Possible For Master Details In Format Box`, "INTERNAL PROGRAM FAILURE");
  if (filter !== "NONE") throw new ReportRefusal(`${filter === "ISLAB" ? "Include Slab" : filter === "ESLAB" ? "Exclude Slab" : call.filterText} with ${format} is not available in the web version of the register yet.`, "Not ported yet");
  requireWhere(call.where);
  if (format === "MONTHLY") return registerMonthly(loader, plan);
  if (format === "ITEM_DETAIL") return registerItems(loader, plan);
  if (format === "MASTER_DETAIL") return registerMasters(loader, plan);
  return registerPeriods(loader, plan);
}

/** Daily ... Summary: the period's amount and every slab of the book. */
async function registerPeriods(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const format = call.formating;
  const { from } = registerFormatFrom(plan);
  const slabs = await registerSlabs(loader, plan, false);
  const apply = slabs.map((slab) => ` LEFT JOIN LATERAL (SELECT SUM(SLAB_AMT::numeric) AS "${slab.short.toUpperCase()}_AMOUNT" FROM ${db}LEDGER_EXT WHERE LED_ID=LED.LED_KEY AND SLAB_ID=${slab.key} AND (IL_ID IS NULL)) ALIAS${slab.key} ON TRUE`).join("");
  const slabColumns = slabs.map((slab) => `,coalesce(SUM("${slab.short.toUpperCase()}_AMOUNT"),0.00) AS "${slab.short}"`).join("");
  const csGroup = call.groupBy.trim();
  const csOrder = call.orderBy.trim();
  const lead = csGroup !== "" ? `AC.NAME as "NAME",` : "";
  const selectStart = call.queryStart.trim();
  let label: string;
  let periodGroup = "";
  let periodOrder = "";
  const period = formatPeriod(format, call.dateField);
  if (period) {
    label = `${period.label} AS "${period.alias}"`;
    periodGroup = period.group;
    periodOrder = period.order;
  } else if (format === "SUMMARY") {
    label = `'${ddMmYyyy(call.from)} TO ${ddMmYyyy(call.upto)}' AS "SELECTED_DATE"`;
  } else {
    throw unknownFormat(format);
  }
  const quantity = format === "DAILY" && call.checkQuery.includes("CHK_QUANTITY,")
    ? `,sum(coalesce((select sum(quantity) from ${db}PROD_LEDGER where led_id=LED.LED_KEY and il_pos<>'D' and inventory='Y'),0)) as "Quantity"`
    : "";
  const body = `${lead}${label},sum(LED.AMOUNT) as "AMOUNT"${quantity}${slabColumns}`;
  const select = selectStart !== "" ? `SELECT ${body},${selectStart}` : `SELECT ${body}`;
  return tableFromResult(await runReportSql(loader, frag(`${select}${from}${apply}${call.where}${groupOrderTail([csGroup, periodGroup], [csOrder, periodOrder])}`)));
}

/** Month: a row a month (and party). */
async function registerMonthly(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const { from } = registerFormatFrom(plan);
  const slabs = await registerSlabs(loader, plan, false);
  const byParty = call.groupBy.trim() !== "" && call.groupBy.toLowerCase().includes("ac.name");
  const slabAmount = (key: number) => `coalesce((select SUM(slab_amt::numeric) from ${db}LEDGER_EXT WHERE SLAB_ID = ${key} AND LED_ID = LED.LED_KEY AND (IL_ID IS NULL)),0.00)`;
  // NET_AMOUNT (the tax slab's total less its tax) stands before the first tax slab, then each slab.
  const columns: { name: string; sql: string }[] = [];
  let tax = false;
  for (const slab of slabs) {
    if (slab.master) {
      if (!tax) columns.push({ name: "NET_AMOUNT", sql: `coalesce((select SUM(S_LASTOT::numeric-slab_amt::numeric) from ${db}LEDGER_EXT WHERE SLAB_ID = ${slab.key} AND LED_ID = LED.LED_KEY AND (IL_ID IS NULL)),0.00)` });
      tax = true;
    }
    columns.push({ name: slab.short, sql: slabAmount(slab.key) });
  }
  columns.push({ name: "FINAL_TOTAL", sql: "SUM(led.AMOUNT)" });
  const quantity = call.checkQuery.includes("CHK_QUANTITY,")
    ? `coalesce((select sum(quantity) from ${db}PROD_LEDGER where led_id=LED.LED_KEY and il_pos<>'D' and inventory='Y'),0)`
    : "0";
  const select = `SELECT to_char(led.doc_date,'YYYYMM') AS "SORTING_COL",${byParty ? `ac.name AS "PARTY_NAME",` : ""}to_char(led.doc_date,'FMMonth') AS "PARTICULARS",${quantity} AS "QUANTITY",${columns.map((column) => `${column.sql} AS "${column.name}"`).join(",")}`;
  const groupBy = ` GROUP BY ${byParty ? "ac.name," : ""}LED.LED_KEY,led.doc_date`;
  const vouchers = await runReportSql(loader, frag(`${select}${from}${call.where}${groupBy}`));
  const names = ["SORTING_COL", ...(byParty ? ["PARTY_NAME"] : []), "PARTICULARS", "QUANTITY", ...columns.map((column) => column.name)];
  const table = new ResultTable();
  for (const name of names) table.addColumn(name);
  for (const name of names) if (!["SORTING_COL", "PARTY_NAME", "PARTICULARS"].includes(name)) table.setKind(name, "decimal");
  const rows = new Map<string, Record<string, unknown>>();
  for (const voucher of vouchers.rows) {
    const key = `${byParty ? toText(voucher.PARTY_NAME) : ""}\u0001${toText(voucher.SORTING_COL)}`;
    let row = rows.get(key);
    if (!row) {
      row = { SORTING_COL: voucher.SORTING_COL, ...(byParty ? { PARTY_NAME: voucher.PARTY_NAME } : {}), PARTICULARS: voucher.PARTICULARS };
      for (const name of names) if (!(name in row)) row[name] = 0;
      rows.set(key, row);
    }
    for (const name of names.filter((candidate) => !["SORTING_COL", "PARTY_NAME", "PARTICULARS"].includes(candidate))) row[name] = money(num(row[name]) + num(voucher[name]));
  }
  table.rows = [...rows.values()];
  sortRows(table, [...(byParty ? [(row: Record<string, unknown>) => textKey(row.PARTY_NAME)] : []), (row) => textKey(row.SORTING_COL)]);
  return table;
}

/** Item Detail: the voucher's line, then a line for each item. */
async function registerItems(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  if (call.headingAddon.some((heading) => heading.trim() !== "")) throw new ReportRefusal("Item Detail with an addon group is not available in the web version of the register yet.", "Not ported yet");
  const { from, withProduct } = registerFormatFrom(plan);
  const mrp = ((await runReportSql(loader, frag(`SELECT position('X_MRP,' in entry_para) AS at FROM ${db}SETUP`))).rows[0]?.at ?? 0) === 0;
  const book = registerSlabBook(call.book, call.againstBook);
  const printSlabs = call.printAllSlabs;
  const slabRows = async (sql: string) => (await runReportSql(loader, frag(sql))).rows;
  const slabWhere = `BOOK=${book} AND SLAB_FROMDT='${desktopDate(call.tarikh1)}' AND SLAB_UPTODT='${desktopDate(call.tarikh2)}'`;

  // The item slabs (slab_pos P): a % and an amount column each, blank on the voucher's line.
  const itemSlabs = await slabRows(`SELECT ltrim(SLAB_REPOHD) AS short, SLAB_KEY AS id FROM ${db}SLAB_MASTER WHERE ${slabWhere} AND slab_pos='P' AND SLAB_ACTIVE='Y' ORDER BY SLAB_ORDER`);
  const blankItemSlabs = itemSlabs.map((slab) => `CAST('' AS TEXT) AS "${toText(slab.short)}_%",0.0000::numeric AS "${toText(slab.short)}"`).join(",");
  const itemSlabValues = itemSlabs.map((slab) => `(select LEDEXT.SLAB_PERC from ${db}LEDGER_EXT LEDEXT left join ${db}TAX_MASTER taxmst on taxmst.tax_rec=ledext.tax_id where LEDEXT.il_id=prod_ledger.IL_KEY and LEDEXT.SLAB_ID = ${slab.id} limit 1) AS "${toText(slab.short)}_%",(select LEDEXT.SLAB_AMT::numeric from ${db}LEDGER_EXT LEDEXT where LEDEXT.il_id=prod_ledger.IL_KEY and LEDEXT.SLAB_ID = ${slab.id} limit 1) AS "${toText(slab.short)}"`).join(",");

  // Show Default Slabs: the bill's slabs on the voucher's line (a % for a slab that asks for it, NET_AMOUNT and the tax's name at the first tax).
  let billValues = "";
  let billBlanks = "";
  if (printSlabs) {
    const bill = await slabRows(`SELECT ltrim(SLAB_REPOHD) AS short, SLAB_KEY AS id, SLAB_MASTER AS master, SLAB_PREQ AS perc FROM ${db}SLAB_MASTER WHERE ${slabWhere} AND SLAB_INREP='Y' AND SLAB_ACTIVE<>'N' ORDER BY SLAB_ORDER`);
    const values: string[] = [];
    const blanks: string[] = [];
    let tax = 0;
    const amountOf = (id: unknown) => `(select LEDEXT.SLAB_AMT::numeric from ${db}LEDGER_EXT LEDEXT where LED.LED_KEY=LEDEXT.LED_ID and LEDEXT.IL_ID is null and LEDEXT.SLAB_ID = ${id} limit 1)`;
    const taxName = (id: unknown) => `(SELECT taxmst.tax_repohd FROM ${db}LEDGER_EXT ledext left join ${db}TAX_MASTER taxmst on taxmst.tax_rec=ledext.tax_id WHERE IL_ID IS NULL AND LED_ID=LED.LED_KEY AND SLAB_ID = ${id} limit 1)`;
    for (const slab of bill) {
      const short = toText(slab.short);
      if (toText(slab.perc) === "Y") {
        blanks.push(`0.0000::numeric AS "${short}1_%"`);
        values.push(`(select LEDEXT.SLAB_PERC from ${db}LEDGER_EXT LEDEXT where LED.LED_KEY=LEDEXT.LED_ID and LEDEXT.IL_ID is null and LEDEXT.SLAB_ID = ${slab.id} limit 1) AS "${short}1_%"`);
      }
      if (toText(slab.master) === "Y") {
        if (tax === 0) {
          blanks.push(`0.0000::numeric AS "NET_AMOUNT"`, `CAST('' AS TEXT) AS "TAX_DESCRIPTION"`);
          values.push(`(select LEDEXT.S_LASTOT::numeric - LEDEXT.SLAB_AMT::numeric from ${db}LEDGER_EXT LEDEXT where LED.LED_KEY=LEDEXT.LED_ID and LEDEXT.IL_ID is null and LEDEXT.SLAB_ID = ${slab.id} limit 1) AS "NET_AMOUNT"`, `${taxName(slab.id)} AS "TAX_DESCRIPTION"`);
        } else {
          blanks.push(`CAST('' AS TEXT) AS "TAX_DESCRIPTION1"`);
          values.push(`${taxName(slab.id)} AS "TAX_DESCRIPTION1"`);
        }
        tax = 1;
      }
      blanks.push(`0.0000::numeric AS "${short}1"`);
      values.push(`${amountOf(slab.id)} AS "${short}1"`);
    }
    billValues = values.join(",");
    billBlanks = blanks.join(",");
  }

  const dateField = call.dateField;
  const datePart = `to_char(${dateField},'YYYYMMDD')`;
  const mrpHeader = mrp ? `,0.00::numeric AS "MRP_RATE",0.0000::numeric AS "MRP_VALUE"` : "";
  const join = (parts: string[]) => parts.filter((part) => part !== "").join(",");
  // The voucher's line.
  const header = `SELECT led.LED_KEY AS "SMART_LED_KEY",LED.BOOK AS "BOOK",LED.DOC_NO AS "DOC_NO",'' AS "DOC_NO1",LED.FULL_DOCNO AS "FULL_DOCNO",${mrp ? `AC.NAME || ' - ' || coalesce(AC.A_SHORT,'')` : "AC.NAME"} AS "NAME",addr.gst_no AS "GST_NO",to_char(${dateField},'DD-Mon-YY') AS "SELECTED_DATE",AC.CREDIT_DAYS AS "CRDAY",LED.AMOUNT AS "AMOUNT",'' AS "HSN_CODE",0.0000::numeric AS "QUANTITY",0.0000::numeric AS "FACTOR",0.00::numeric AS "RATE",0.0000::numeric AS "VALUE"${mrpHeader}`
    + `${join(["", billValues, blankItemSlabs]) !== "" ? `,${join([billValues, blankItemSlabs])}` : ""}`
    + `,${datePart}||led.DOC_NO::text||ac.code::text||LED.FULL_DOCNO||'  000' AS "SORTING_FIELD",AC.NAME AS "SMART_SORTING_NAME",${datePart} AS "SORTING_DATE"`;
  const headerSql = `${header}${from}${call.where}${withProduct ? " and prodled.il_pos='A'" : ""} ORDER BY led.doc_date`;
  const headers = await runReportSql(loader, frag(headerSql));

  // A line for each item of the vouchers.
  const sign = (column: string) => `(case when PROD_LEDGER.STOCK_NAT='A' and PROD_LEDGER.BOOK=8 then ${column} *-1 else ${column} end)`;
  const mrpItem = mrp ? `,PROD_LEDGER.MASTER_RATE AS "MRP_RATE",${sign("round(PROD_LEDGER.MASTER_RATE*PROD_LEDGER.QUANTITY,2)")} AS "MRP_VALUE"` : "";
  const item = `SELECT LED.LED_KEY AS "SMART_LED_KEY",LED.BOOK AS "BOOK",LED.DOC_NO AS "DOC_NO",'' AS "DOC_NO1",'' AS "FULL_DOCNO",'**'||product.prod_desc||' '||il_prodcd AS "NAME",addr.gst_no AS "GST_NO",NULL AS "SELECTED_DATE",'0' AS "CRDAY",0.0000::numeric AS "AMOUNT",PRODUCT.HSN_CODE AS "HSN_CODE",${sign("PROD_LEDGER.QUANTITY")} AS "QUANTITY",${sign("PROD_LEDGER.FACTOR")} AS "FACTOR",PROD_LEDGER.RATE AS "RATE",${sign("PROD_LEDGER.IL_VALUE")} AS "VALUE"${mrpItem}`
    + `${join([billBlanks, itemSlabValues]) !== "" ? `,${join([billBlanks, itemSlabValues])}` : ""}`
    + `,${datePart}||led.DOC_NO::text||ac.code::text||LED.FULL_DOCNO||'  '||lpad(PROD_LEDGER.il_serial::text,3,'0') AS "SORTING_FIELD",AC.NAME AS "SMART_SORTING_NAME",${datePart} AS "SORTING_DATE"`;
  let itemFrom = ` FROM ${db}PROD_LEDGER prod_ledger left join ${db}LEDGER led on led.led_key=prod_ledger.led_id and led.code=prod_ledger.code left join ${db}ACCOUNT AC on AC.CODE=PROD_LEDGER.CODE left join ${db}ADDON_DATA adata on adata.CODE=PROD_LEDGER.CODE left join ${db}PRODUCT_MASTER PRODUCT on product.prod_key=PROD_LEDGER.prod_id left join ${db}ADDRESS ADDR on addr.code=ac.code`;
  if (withProduct) itemFrom += ` left join ${db}ADDON_DATA padata on padata.prod_id=PROD_LEDGER.prod_id`;
  if (call.orderBy.toLowerCase().includes("aentry")) itemFrom += ` left join ${db}ADDON_AENTRY aentry on aentry.aona_ledid=led.led_key`;
  const itemSql = `${item}${itemFrom}${call.where} and PROD_LEDGER.BOOK =${call.book} and il_pos = 'A' and coalesce(prod_ledger.process_id,0)=0 and addr.address_id=1 and IL_DATE >= '${desktopDate(call.from)}' and IL_DATE <= '${desktopDate(call.upto)}' order by il_serial`;
  const items = await runReportSql(loader, frag(itemSql));

  const table = tableFromFields(headers.fields);
  for (const name of ["QUANTITY", "FACTOR", "RATE", "VALUE", "MRP_RATE", "MRP_VALUE", "AMOUNT"]) if (table.has(name)) table.setKind(name, "decimal");
  table.rows = headers.rows.map((row) => ({ ...row }));
  if (items.rows.length > 0) {
    for (const row of items.rows) table.rows.push({ ...row });
    // The two lists' columns line up by position (UNION): an item's slab % / amount sit under the same names.
  } else {
    for (const name of ["RATE", "QUANTITY", "VALUE", ...(loader.session.licence === 1 || loader.session.licence === 15 ? ["MRP_RATE", "MRP_VALUE"] : [])]) if (table.has(name)) dropColumn(table, name);
  }
  const accounts = call.selectKey[4] !== "";
  sortRows(table, [...(accounts ? [(row: ResultRow) => textKey(table.get(row, "SMART_SORTING_NAME"))] : []), (row) => textKey(table.get(row, "SORTING_DATE")), (row) => textKey(table.get(row, "SORTING_FIELD"))]);
  return table;
}

/** Master Detail: a row for each voucher with every tax master's taxable value and tax. */
async function registerMasters(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const book = registerSlabBook(call.book, call.againstBook);
  const slabWhere = `BOOK =${book} and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' and SLAB_UPTODT = '${desktopDate(call.tarikh2)}'`;
  const productWise = Number((await runReportSql(loader, frag(`Select count(*) AS n FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' AND SLAB_MASTER='Y' AND SLAB_ACTIVE = 'Y' and BOOK =${book}`))).rows[0]?.n) > 0;
  const idOf = async (description: string, flag: string) => Number((await runReportSql(loader, frag(`SELECT coalesce(idopt_key,0) AS id FROM ${db}IDOPT_MASTER WHERE OPT_DESC = '${description}' and IDOPT_FLAG='${flag}'`))).rows[0]?.id ?? 0);
  const gst = await idOf("GOODS-SERVICE-TAX", "TX");
  const vat = await idOf("SALES-TAX", "TX");
  const before2017 = call.upto.getTime() < new Date(2017, 5, 30).getTime();
  const taxSql = before2017
    ? `SELECT TAX_REPOHD AS short, TAX_REC AS id, OPT_DESC AS type, TAX_PERC AS perc FROM ${db}TAX_MASTER taxmst left join ${db}IDOPT_MASTER idopt on CAST(idopt.IDOPT_KEY AS TEXT)=taxmst.TAX_TYPE where TAX_POS <> 'D' and TAX_DIV=${vat}`
    : `SELECT DISTINCT TAX_REPOHD AS short, TAX_REC AS id, OPT_DESC AS type, TAX_PERC AS perc FROM ${db}LEDGER_EXT ledext left join ${db}TAX_MASTER taxmst on ledext.TAX_ID=taxmst.TAX_REC left join ${db}IDOPT_MASTER idopt on CAST(idopt.IDOPT_KEY AS TEXT)=taxmst.TAX_TYPE left join ${db}LEDGER led on led.LED_KEY=ledext.LED_ID where TAX_POS <> 'D' and TAX_DIV=${gst} and led.DOC_POS='A' and led.doc_posting='P' and led.doc_date between '${desktopDate(call.from)}' and '${desktopDate(call.upto)}' and led.book_code=${Number(call.fcValue)} order by TAX_PERC`;
  const taxes: TaxMaster[] = (await runReportSql(loader, frag(taxSql))).rows.map((row) => ({ short: toText(row.short), key: Number(row.id), type: toText(row.type), percent: num(row.perc) }));
  const slabs = (await runReportSql(loader, frag(`SELECT ltrim(rtrim(SLAB_REPOHD)) AS short, SLAB_KEY AS id, SLAB_MASTER AS master FROM ${db}SLAB_MASTER WHERE ${slabWhere} and SLAB_ACTIVE <> 'N' and SLAB_KEY in (SELECT SLAB_ID from ${db}LEDGER_EXT ledext left join ${db}LEDGER led on led.led_key=ledext.led_id where led.doc_pos='A' and led.doc_date between '${desktopDate(call.from)}' and '${desktopDate(call.upto)}' and led.book_code=${Number(call.fcValue)} and ledext.il_id is null) ORDER BY SLAB_ORDER`))).rows;
  const aggregates: string[] = [];
  const columns: string[] = [];
  for (const slab of slabs) {
    if (toText(slab.master) === "Y") continue;
    aggregates.push(`SUM(CASE WHEN le.SLAB_ID = ${slab.id} AND le.IL_ID IS NULL THEN le.SLAB_AMT::numeric ELSE 0 END) AS "${toText(slab.short)}"`);
    columns.push(`COALESCE(la."${toText(slab.short)}",0) AS "${toText(slab.short)}"`);
  }
  for (const tax of taxes) {
    if (tax.type !== "SGST") {
      aggregates.push(`SUM(CASE WHEN le.TAX_ID = ${tax.key} THEN le.S_LASTOT::numeric - le.SLAB_AMT::numeric ELSE 0 END) AS "NET_${tax.short}"`);
      columns.push(`COALESCE(la."NET_${tax.short}",0) AS "NET_${tax.short}"`);
    }
    aggregates.push(`SUM(CASE WHEN le.TAX_ID = ${tax.key} THEN le.SLAB_AMT::numeric ELSE 0 END) AS "${tax.short}"`);
    columns.push(`COALESCE(la."${tax.short}",0) AS "${tax.short}"`);
  }
  const ledgerExt = productWise
    ? `FROM ${db}LEDGER_EXT le LEFT JOIN ${db}PROD_LEDGER pl ON pl.il_key = le.il_id AND pl.il_pos = 'A' AND le.IL_ID IS NOT NULL GROUP BY le.LED_ID`
    : `FROM ${db}LEDGER_EXT le where le.IL_ID IS NULL GROUP BY le.LED_ID`;
  const dateField = call.dateField;
  const sql = `WITH LedgerAgg AS (SELECT le.LED_ID${aggregates.length > 0 ? `,${aggregates.join(",")}` : ""} ${ledgerExt})`
    + ` SELECT LED.LED_KEY,to_char(${dateField},'DD-Mon-YY') AS selected_date,led.full_docno AS full_docno,AC.NAME AS name,COALESCE(accExp.name,'') AS "EXP_NAME",COALESCE(addr1.LST_NO,'') AS "VAT_NO",COALESCE(addr1.GST_NO,'') AS "GST_NO",LED.AMOUNT,case when led.rev_charge='N' then 'No' else 'Yes' end AS "REV_CHARGE"${columns.length > 0 ? `,${columns.join(",")}` : ""}`
    + ` FROM ${db}LEDGER led LEFT JOIN ${db}ACCOUNT ac ON led.code = ac.code LEFT JOIN ${db}ADDON_DATA adata ON led.code = adata.code LEFT JOIN ${db}ADDRESS addr1 ON addr1.code = ac.code AND addr1.address_id = 1`
    + ` LEFT JOIN ${db}IDOPT_MASTER idopt ON CAST(idopt.idopt_key AS TEXT) = CAST(addr1.p_reg AS TEXT) LEFT JOIN LedgerAgg la ON la.LED_ID = led.LED_KEY LEFT JOIN ${db}ACCOUNT accExp ON accExp.Code = led.post_bkcode`
    + `${call.where}`;
  const csOrder = call.orderBy.trim();
  const tail = call.orderBy.toUpperCase().includes("AC.NAME")
    ? `EXTRACT(YEAR FROM ${dateField}),EXTRACT(MONTH FROM ${dateField}),to_char(${dateField},'DD/MM/YYYY')`
    : `EXTRACT(YEAR FROM ${dateField}),EXTRACT(MONTH FROM ${dateField}),to_char(${dateField},'DD/MM/YYYY'),LED.DOC_NO`;
  const table = tableFromResult(await runReportSql(loader, frag(`${sql}${groupOrderTail([], [csOrder, tail])}`)));
  return table;
}

// ======================================================================================
// 4: LEDGER (lines 2127-2336)
// ======================================================================================
//
// DAILY ... SUMMARY are one grouped query each: a row per account and period with its debits and
// credits. MONTHLY builds its own table (an account heading, the opening, and a row per month with
// the closing up to that month's end). SPC_SUMMARY is SP_LEDGER_SPCL_SUMMARY_REPORT: the selected
// postings by the voucher's party, book and schedule.

/** The ledger formats' result: the amounts are decimals whatever the query typed them as. */
function ledgerTable(result: Awaited<ReturnType<typeof runReportSql>>): ResultTable {
  const table = tableFromResult(result);
  for (const column of ["DEBIT", "CREDIT", "CLOSING_BAL"]) if (table.has(column)) table.setKind(column, "decimal");
  return table;
}

async function ledgerFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const format = call.formating;
  const csFrom = withEntryAddon(call.from_, `left join ${db}addon_aentry aentry on led.led_key=aentry.aona_ledid`);
  const where = call.where.split("|sys.yearid|").join(call.yearId);
  if (format === "MONTHLY") return ledgerMonthly(loader, plan, where);
  if (format === "SPC_SUMMARY") return ledgerSpecialSummary(loader, plan, where);

  let groupBy = call.groupBy;
  let orderBy = call.orderBy;
  const sums = "sum(case when ledpost.post_dbcode = 1 then ledpost.post_amt else 0.00 end) as \"DEBIT\",sum(case when ledpost.post_dbcode = 2 then ledpost.post_amt else 0.00 end) as \"CREDIT\",0.00 as \"CLOSING_BAL\",'' as \"DR_CR\"";
  let sql: string;
  let periodGroup = "";
  let periodOrder = "";
  const period = formatPeriod(format, call.dateField);
  if (period) {
    sql = `${period.label} AS "${period.alias}",${sums}`;
    periodGroup = period.group;
    periodOrder = period.order;
  } else if (format === "SUMMARY") {
    sql = `'${ddMmYyyy(call.from)}' || ' TO ' || '${ddMmYyyy(call.upto)}' as "SELECTED_DATE",${sums}`;
  } else {
    throw unknownFormat(format);
  }
  let select = call.queryStart.trim();
  if (select !== "") {
    if (!select.toUpperCase().includes("AC.NAME")) select = `AC.NAME,${select}`;
    sql = ` SELECT ${sql},${select}`;
  } else {
    sql = ` SELECT AC.NAME,${sql}`;
  }
  if (!groupBy.toUpperCase().includes("AC.NAME")) groupBy = groupBy.trim() !== "" ? `${groupBy},AC.NAME` : "AC.NAME";
  if (!orderBy.toUpperCase().includes("AC.NAME")) orderBy = orderBy.trim() !== "" ? `${orderBy},AC.NAME` : "AC.NAME";
  requireWhere(where);
  return ledgerTable(await runReportSql(loader, frag(`${sql}${csFrom}${where}${groupOrderTail([groupBy, periodGroup], [orderBy, periodOrder])}`)));
}

/**
 * MONTHLY: TEMP_TABLE_LEDGER1 with an account heading (H), its opening (O) and a row per month that
 * has postings (P), each month's closing being the opening plus everything posted before the next
 * month. The From date must be the year's start. Accounts with nothing but the heading go.
 */
async function ledgerMonthly(loader: Loader, plan: ReportPlan, where: string): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  if (desktopDate(call.from) !== desktopDate(call.tarikh1)) throw new ReportRefusal("MONTHLY REPORT BETWEEN DATE NOT ALLOWED PLEASE SELECT FROM DATE LIKE YEAR START DATE ", "INTERNAL PROGRAM FAILURE");
  const keys = call.selectKey[4];
  if (keys === "") throw new ReportRefusal("Month format needs the accounts ticked (Account group)", "INTERNAL PROGRAM FAILURE");
  // Credit Only / Debit Only: the procedure leaves the other column out and its INSERT fails
  // ("Column name or number of supplied values does not match"). Here that column shows 0.00
  // and the closing stays the account's balance.
  const onlySide = /ledpost\.POST_DBCODE = 1/i.test(where) ? 1 : /ledpost\.POST_DBCODE = 2/i.test(where) ? 2 : 0;

  const table = new ResultTable();
  for (const column of ["SORTING_COL", "ROW_DATA_TYPE", "SMART_NAME", "PARTICULARS", "DEBIT", "CREDIT", "CLOSINGS", "DR_CR"]) table.addColumn(column);
  for (const column of ["DEBIT", "CREDIT", "CLOSINGS"]) table.setKind(column, "decimal");

  for (const row of (await runReportSql(loader, `SELECT DISTINCT ac.name FROM ${db}ACCOUNT AC WHERE ac.a_pos <> 'D' AND ac.code IN ${keys}`)).rows) {
    table.insert({ SORTING_COL: row.name === null ? null : `${row.name}  H`, ROW_DATA_TYPE: "AC", SMART_NAME: row.name, PARTICULARS: row.name, DR_CR: "" });
  }
  for (const row of (await runReportSql(loader, `SELECT ac.name, coalesce(acbal.opening::numeric, 0.00) AS opening FROM ${db}AC_BALANCE ACBAL LEFT JOIN ${db}ACCOUNT AC ON ac.Code = ACBAL.CODE WHERE ac.a_pos <> 'D' AND ac.code IN ${keys} AND acbal.opening::numeric <> 0`)).rows) {
    const opening = num(row.opening);
    // The procedure puts a credit opening in CREDIT as it is: a negative amount.
    table.insert({ SORTING_COL: row.name === null ? null : `${row.name}  O`, ROW_DATA_TYPE: "OPENINGS", SMART_NAME: row.name, PARTICULARS: "Opening", DEBIT: opening > 0 ? opening : 0, CREDIT: opening < 0 ? opening : 0, CLOSINGS: opening, DR_CR: "" });
  }

  const tarikh1 = desktopDate(call.tarikh1);
  const tarikh2 = desktopDate(call.tarikh2);
  for (let month = new Date(call.from.getFullYear(), call.from.getMonth(), 1); month <= call.upto; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
    const monthNo = month.getMonth() + 1;
    const next = desktopDate(new Date(month.getFullYear(), month.getMonth() + 1, 1));
    const inMonth = `EXTRACT(MONTH FROM ${call.dateField}) = ${monthNo}`;
    const closing = month.getTime() === new Date(call.tarikh1.getFullYear(), call.tarikh1.getMonth(), 1).getTime() && call.tarikh1.getDate() === 1
      ? `coalesce(acbal.opening::numeric,0.00) + coalesce(SUM(case when ledpost.POST_DBCODE = 1 and ${inMonth} then ledpost.post_amt end),0.00) - coalesce(SUM(case when ledpost.POST_DBCODE = 2 and ${inMonth} then ledpost.post_amt end),0.00)`
      : `coalesce(acbal.opening::numeric,0.00) + coalesce((select SUM(case when ledpost1.POST_DBCODE = 1 then ledpost1.post_amt::numeric else 0.00 end) from ${db}LEDGER_POST ledpost1 where ledpost1.post_code = ledpost.post_code and ledpost1.post_date < '${next}'),0.00) - coalesce((select SUM(case when ledpost1.POST_DBCODE = 2 then ledpost1.post_amt::numeric else 0.00 end) from ${db}LEDGER_POST ledpost1 where ledpost1.post_code = ledpost.post_code and ledpost1.post_date < '${next}'),0.00)`;
    const sql = `SELECT ac.name || '  P' || to_char(led.doc_date, 'YYYYMM') || ' ' || CAST(ledpost.post_code AS varchar(18)) AS "SORTING_COL", ac.name AS "SMART_NAME", to_char(led.doc_date, 'FMMonth') AS "PARTICULARS"`
      + (onlySide === 2 ? `, 0.00 AS "DEBIT"` : `, coalesce(SUM(case when ledpost.POST_DBCODE = 1 and ${inMonth} then ledpost.post_amt end),0.00) AS "DEBIT"`)
      + (onlySide === 1 ? `, 0.00 AS "CREDIT"` : `, coalesce(SUM(case when ledpost.POST_DBCODE = 2 and ${inMonth} then ledpost.post_amt end),0.00) AS "CREDIT"`)
      + `, ${closing} AS "CLOSINGS"`
      + ` FROM ${db}LEDGER_POST ledpost LEFT JOIN ${db}LEDGER LED ON ledpost.LED_ID = LED.LED_KEY LEFT JOIN ${db}ACCOUNT AC ON ac.Code = ledpost.POST_CODE AND AC.A_POS <> 'D' LEFT JOIN ${db}AC_BALANCE ACBAL ON ACBAL.CODE = AC.CODE`
      + ` WHERE led.doc_pos <> 'D' AND ac.a_pos <> 'D' AND led.DOC_POSTING = 'P' AND led.doc_date BETWEEN '${tarikh1}' AND '${tarikh2}' AND ${inMonth} AND ledpost.post_code IN ${keys}`
      + ` GROUP BY ac.name, to_char(led.doc_date, 'FMMonth'), to_char(led.doc_date, 'YYYYMM'), acbal.opening, ledpost.post_code`;
    for (const row of (await runReportSql(loader, frag(sql))).rows) {
      table.insert({ SORTING_COL: row.SORTING_COL, ROW_DATA_TYPE: "LED", SMART_NAME: row.SMART_NAME, PARTICULARS: row.PARTICULARS, DEBIT: num(row.DEBIT), CREDIT: num(row.CREDIT), CLOSINGS: money(num(row.CLOSINGS)), DR_CR: "" });
    }
  }
  // An account with only its heading goes; every other row says DR or CR from its closing.
  const counts = new Map<string, number>();
  for (const row of table.rows) counts.set(toText(row.SMART_NAME), (counts.get(toText(row.SMART_NAME)) ?? 0) + 1);
  table.rows = table.rows.filter((row) => counts.get(toText(row.SMART_NAME)) !== 1);
  for (const row of table.rows) if (row.ROW_DATA_TYPE !== "AC") row.DR_CR = num(row.CLOSINGS) < 0 ? "CR" : "DR";
  sortRows(table, [(row) => textKey(row.SORTING_COL)]);
  return table;
}

/**
 * SP_LEDGER_SPCL_SUMMARY_REPORT: by the voucher's party with its book (Book group ticked), its
 * schedule (Schedule group), or both. Without either the procedure returns its error row.
 */
async function ledgerSpecialSummary(loader: Loader, plan: ReportPlan, where: string): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const groups = call.groupBy.toUpperCase();
  const type = groups.includes("BOOK_DESC") && groups.includes("BS_DESC") ? 3 : groups.includes("BS_DESC") ? 2 : groups.includes("BOOK_DESC") ? 1 : 0;
  if (type === 0) throw new ReportRefusal("Error No :  \nInternal program failure", "INTERNAL PROGRAM FAILURE");
  const from = ` from ((${db}LEDGER_POST ledpost left join ${db}LEDGER LED on ledpost.LED_ID = LED.LED_KEY) left join ${db}ACCOUNT AC on led.CODE = Ac.Code AND AC.A_POS <> 'D')`;
  const sums = `sum(case when ledpost.post_dbcode = 1 then ledpost.post_amt else 0.00 end) as "DEBIT",sum(case when ledpost.post_dbcode = 2 then ledpost.post_amt else 0.00 end) as "CREDIT"`;
  const bookName = `(SELECT T1.NAME FROM ${db}ACCOUNT T1 WHERE T1.Code = LED.BOOK_CODE)`;
  const schedule = (column: string) => `(SELECT BS.${column} FROM ${db}BALSHEET BS WHERE BS.BS_KEY IN (SELECT AC1.BS_ID FROM ${db}ACCOUNT AC1 WHERE AC1.Code = LED.BOOK_CODE) LIMIT 1)`;
  let sql: string;
  if (type === 1) {
    sql = `SELECT LED.BOOK_CODE AS "LED_BOOK_CODE",AC.NAME,${bookName} AS "SELECTED_BOOK",${sums},CAST(0.00 AS NUMERIC(18,2)) AS "CLOSING_BAL",CAST('' AS VARCHAR(3)) AS "DR_CR"${from} ${where} GROUP BY AC.NAME,LED.BOOK_CODE ORDER BY AC.NAME,"SELECTED_BOOK"`;
  } else if (type === 2) {
    sql = `WITH REC_CTE AS (SELECT (SELECT AC1.BS_ID FROM ${db}ACCOUNT AC1 WHERE AC1.Code = LED.BOOK_CODE) AS "BS_ID",${schedule("BS_DESC")} AS "SCHD",${schedule("BS_CODE")} AS "SCHD_CODE",AC.NAME,${sums}${from} ${where} GROUP BY AC.NAME,LED.BOOK_CODE,AC.Code)`
      + ` SELECT RC.NAME,COALESCE(RC."SCHD",'N/A') AS "SELECTED_SCHEDULE",SUM(RC."DEBIT") AS "DEBIT",SUM(RC."CREDIT") AS "CREDIT",CAST(0.00 AS NUMERIC(18,2)) AS "CLOSING_BAL",CAST('' AS VARCHAR(3)) AS "DR_CR" FROM REC_CTE RC GROUP BY RC."BS_ID",RC."SCHD",RC."SCHD_CODE",RC.NAME ORDER BY RC.NAME,RC."SCHD_CODE"`;
  } else {
    sql = `SELECT AC.NAME,${bookName} AS "SELECTED_BOOK",COALESCE(${schedule("BS_DESC")},'N/A') AS "SELECTED_SCHEDULE",${schedule("BS_CODE")} AS "SCHD_CODE",${sums},CAST(0.00 AS NUMERIC(18,2)) AS "CLOSING_BAL",CAST('' AS VARCHAR(3)) AS "DR_CR"${from} ${where} GROUP BY AC.NAME,LED.BOOK_CODE,AC.Code ORDER BY AC.NAME,"SELECTED_BOOK","SCHD_CODE"`;
  }
  return ledgerTable(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
}

// ======================================================================================
// 42: BUDGET (SP_FRT_RPT_BUDGET)
// ======================================================================================
//
// Each account of the chosen book (debtors: the sales books 8 and 16; creditors: purchases 13 and
// 11) with what it did in the period (quantity, and the amount the way its side counts it),
// the budget kept on the account master and the variance (actual less budget). Accounts with a
// budget and nothing in the period come in too, so their budget shows unused. "Print Greater Than
// Budget Only" keeps the accounts with something done and over budget.
//
// Where the desktop's SQL fails the web does what it meant: with no account ticked the procedure
// had no list of accounts for the unused budgets (its SQL reads "code in "), so here every account
// of the book with a budget is used.

async function budget(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const debtors = call.fcValue === 2;
  const day = (date: Date) => `'${desktopDate(date)}'`;
  const period = `${day(call.from)} AND ${day(call.upto)}`;
  const where = call.where.split("|sys.yearid|").join(call.yearId);
  const sign = debtors ? "1" : "2";
  const quantity = `(select CAST(SUM(case when stock_nat='A' then quantity${debtors ? "*-1" : ""} else quantity${debtors ? "" : "*-1"} end) AS NUMERIC(20,0)) from ${db}prod_ledger where code=led.code and il_pos='A' and il_date between ${period}) as "Quantity"`;
  const sql = `select ac.name as "name",ac.code as "AC_CODE",${quantity},coalesce(sum(case when led.ac_dbcode = ${sign} then led.amount::numeric else led.amount::numeric*-1 end),0) as "ACT_AMOUNT",coalesce(ac.budget::numeric,0) as "budget",CAST(0.00 AS NUMERIC(20,2)) AS "VARIANCE"`
    + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code ${where} and (led.doc_date between ${period}) and ${debtors ? "(led.book=8 or led.book=16)" : "(led.book=13 or led.book=11)"} group by ac.name,ac.code,led.code,ac.budget order by ac.name`;
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  for (const column of ["ACT_AMOUNT", "budget", "VARIANCE"]) table.setKind(column, "decimal");

  // Budgeted accounts with nothing in the period.
  const known = call.selectKey[4] !== "" ? `ac.code in ${call.selectKey[4]}` : `ac.book = ${Number(call.fcValue)}`;
  const unused = await runReportSql(loader, `select ac.name, ac.code, ac.budget::numeric as budget from ${db}ACCOUNT ac where ${known} and ac.budget::numeric <> 0 and ac.a_pos <> 'D'`);
  const have = new Set(table.rows.map((row) => String(row.AC_CODE)));
  for (const account of unused.rows) {
    if (have.has(String(account.code))) continue;
    table.insert({ name: account.name, AC_CODE: account.code, ACT_AMOUNT: 0, budget: num(account.budget), VARIANCE: 0 });
  }
  for (const row of table.rows) row.VARIANCE = money(num(row.ACT_AMOUNT) - num(row.budget));
  if (call.checkQuery.includes("CHK_ODBUDGET,")) table.rows = table.rows.filter((row) => !(num(row.ACT_AMOUNT) === 0 || num(row.VARIANCE) < 0));
  sortRows(table, [(row) => textKey(row.name)]);
  return table;
}

// ======================================================================================
// 21: OUTSTANDING CLEARANCE (SP_FRT_RPT_OUTSTANDING_CLEAR, 2,171 lines)
// ======================================================================================
//
// Every bill of the selected parties with the receipts set off against it (one line a receipt),
// then the receipts that are against no bill. The procedure works in two temp tables, here two
// lists a party:
//  - TEMP_TABLE_OUTCLEAR: the bills (OUTCLEAR rows of the book's debit side) each left-joined to
//    the OUTCLEAR rows that name it (OUT_AG_OUTID), with the bill's pending balance;
//  - TEMP_TABLE_RECEIPT_OUTCLEAR: the other side's rows that are against no bill shown.
// On Account To Settle (ticked by default) then settles them: the year's opening difference is taken
// off the old bills first (their receipts go back to the receipt list), and every receipt with
// something left is set against the oldest pending bill (a bill with a receipt already gets a line
// more), what no bill can take becomes a line of its own with a negative balance. Without it the
// remaining receipts are listed under the bills as they are.
// What follows is the same either way: a heading row a party (ROW_DATA_TYPE AC, with the party's
// details), the ranking that blanks a bill's repeated invoice figures, the pending-bill and
// zero-line deletes, the ageing columns, and the order SMART_SORTING_NAME, SORTING_DATE,
// RECPSELE_DATE. Summary is one row a party instead.
//
// Addon groups (Area, Zone ...): each party's addon texts head its lines (ADDON_1.. heading rows, a heading only where something
// is under it); Ageing Column Selection takes the age ranges from DAYS_GAP (keys 1 to 5).
//
// Not ported (the web says so): Combine Setoff, an entry-level addon group, the
// the desktop's cursor errors that the procedure swallows (it prints and goes on).

type ClearRow = {
  smart_name: string | null; smart_sorting_name: string | null; sorting_date: string | null; full_docno: string | null; selected_date: string | null;
  book: number | null; invoice_amount: number | null; ac_code: number | null; cr_days: number | null; days: number | null; pb: string | null;
  receipt_docno: string | null; receipt_date: string | null; rdays: number | null; receipt_amount: number | null; balance_amount: number | null;
  out_key: number | null; po: string | null; cheque_no: string | null; reco_date: string | null; row_data_type: string | null;
  recp_dbcode: number | null; recp_outkey: number | null; recpsele_date: string | null; out_ag_id: number | null; out_ledid: number | null;
  crdays?: number | null; int_amount?: number | null; a: (string | null)[];
};

type ClearReceipt = {
  sorting_date: string; smart_name: string; smart_sorting_name: string; ac_code: number; receipt_docno: string | null; receipt_date: string | null;
  receipt_amount: number; balance_amount: number; recpsele_date: string | null; recp_outkey: number | null; recp_dbcode: number | null;
  rdays: number | null; cheque_no: string | null; reco_date: string | null;
};

const CLEAR_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** CONVERT(DATETIME, text, 103) of "dd-Mon-yy", "dd/Mon/yyyy" or "dd/mm/yyyy"; blank gives 1900-01-01 as SQL Server does, anything else null. */
function clearDate(text: string | null | undefined): Date | null {
  const value = (text ?? "").trim();
  if (value === "") return new Date(1900, 0, 1);
  let match = /^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2}|\d{4})$/.exec(value);
  if (match) {
    const month = CLEAR_MONTHS.indexOf(match[2].toLowerCase());
    if (month < 0) return null;
    let year = Number(match[3]);
    if (match[3].length === 2) year += year <= 49 ? 2000 : 1900;
    return new Date(year, month, Number(match[1]));
  }
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

const clearDay = (date: Date): number => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
/** DATEDIFF(d, from, to). */
const clearDaysBetween = (from: Date, to: Date): number => clearDay(to) - clearDay(from);
/** NUMERIC(18,2) variables round to two decimals. */
const clearRound = (value: number): number => Math.round((value + (value < 0 ? -1e-9 : 1e-9)) * 100) / 100;
const clearSame = (a: number | null | undefined, b: number): boolean => Math.abs(num(a) - b) < 0.00001;

function blankClearRow(): ClearRow {
  return {
    smart_name: null, smart_sorting_name: null, sorting_date: null, full_docno: null, selected_date: null, book: null, invoice_amount: null, ac_code: null,
    cr_days: null, days: null, pb: null, receipt_docno: null, receipt_date: null, rdays: null, receipt_amount: null, balance_amount: null, out_key: null,
    po: null, cheque_no: null, reco_date: null, row_data_type: null, recp_dbcode: null, recp_outkey: null, recpsele_date: null, out_ag_id: null, out_ledid: null, a: [null, null, null, null],
  };
}

/** The first of the rows in ORDER BY order of `key` (ties keep the earlier row, as a heap's TOP 1 does). */
function firstOf<T>(rows: readonly T[], key: (row: T) => string | null): T | undefined {
  let best: T | undefined;
  for (const row of rows) if (best === undefined || compareNullFirst(key(row), key(best)) < 0) best = row;
  return best;
}

function compareNullFirst(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return sqlServerCompare(a, b);
}

async function outstandingClearance(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const db = call.database;
  const checks = (name: string) => call.checkQuery.includes(`${name},`);
  const unsupported = (what: string) => new ReportRefusal(`${what} is not available in the web version of the outstanding clearance yet.`, "Not ported yet");
  const format = call.formating.toUpperCase();
  if (format !== "NONE" && format !== "SUMMARY") throw unsupported(`The ${call.formating} format`);
  if (checks("CHK_COMBINE")) throw unsupported("Combine Setoff");
  let levels = 0;
  while (levels < 4 && call.selectKey[levels] !== "") levels += 1;
  if (call.addon.slice(0, levels).some((entry) => /aentry/i.test(entry))) throw unsupported("An entry addon group");

  const book = Number(call.fcValue);
  const sale = book === 8;
  const partyBook = sale ? 2 : book === 13 ? 3 : 1;
  const billSide = sale ? 1 : 2;
  const receiptSide = sale ? 2 : 1;
  const settle = checks("CHK_ACCSTL");
  const pendingOnly = checks("CHK_OS_PENDBILL");
  const upto = call.upto;
  const start = call.tarikh1;
  const uptoText = desktopDate(upto);
  const startText = desktopDate(start);
  const start112 = dateStyle112(start);
  const upto112 = dateStyle112(upto);
  let codes = call.selectKey[4].replace(/[()]/g, "").split(",").map((code) => Number(code.trim())).filter((code) => Number.isFinite(code) && code > 0);
  const live = `select code from ${db}ACCOUNT where a_pos<>'D'`;
  const addonIds = [0, 1, 2, 3].map((at) => new Set(call.selectKey[at].replace(/[()]/g, "").split(",").map((id) => id.trim()).filter((id) => id !== "")));
  const addonOf = new Map<number, (string | null)[]>();
  if (levels > 0) {
    // The parties whose addon values are among those ticked, with the texts that head their lines.
    const columns = Array.from({ length: levels }, (_, at) => `${call.addon[at]} AS a${at}, ${call.addon[at].replace(/adata\.txt_/i, "adata.key_")} AS k${at}`).join(", ");
    const found = await runReportSql(loader, frag(`SELECT ac.code AS code, ${columns} FROM ${db}ACCOUNT ac LEFT JOIN ${db}ADDON_DATA adata ON adata.code=ac.code WHERE ac.a_pos<>'D' AND ac.book=${partyBook}${codes.length > 0 ? ` AND ac.code IN (${codes.join(",")})` : ""}`));
    const matching: number[] = [];
    for (const row of found.rows) {
      if (!Array.from({ length: levels }, (_, at) => addonIds[at].has(toText(row[`k${at}`]).trim())).every(Boolean)) continue;
      matching.push(Number(row.code));
      addonOf.set(Number(row.code), [0, 1, 2, 3].map((at) => (at < levels && row[`a${at}`] !== null && row[`a${at}`] !== undefined ? toText(row[`a${at}`]) : null)));
    }
    codes = matching;
  }
  if (codes.length === 0) throw new ReportRefusal("No Records Found", "No Data");
  const list = codes.join(",");
  /** The addon texts, a space between, then the name and the row's tail (null when a text is null, as SQL's + is). */
  const sortName = (values: readonly (string | null)[], count: number, name: string | null, tail: string): string | null => {
    const parts = [...values.slice(0, count), name];
    return parts.some((part) => part === null) ? null : parts.join(" ") + tail;
  };
  const text1 = call.text.find((value) => value.trim() !== "")?.trim() ?? "";
  // Ageing Column Selection: up to five ranges from DAYS_GAP (keys 1 to 5) in place of the fixed ones.
  let ageing: { name: string; from: number; upto: number }[] | null = null;
  if (checks("CHK_AGCOLSEL") && checks("CHK_AGECOL")) {
    const gaps = await runReportSql(loader, frag(`SELECT days_gap_key AS k, days_from AS f, days_upto AS u FROM ${db}DAYS_GAP WHERE days_from<>'' AND days_upto<>'' ORDER BY days_gap_key`));
    const byKey = new Map(gaps.rows.map((row) => [Number(row.k), row]));
    const picked: { name: string; from: number; upto: number }[] = [];
    for (let key = 1; key <= 5; key += 1) { const gap = byKey.get(key); if (!gap) break; picked.push({ name: `Days_${toText(gap.f)}_${toText(gap.u)}`, from: num(gap.f), upto: num(gap.u) }); }
    if (picked.length > 0) ageing = picked;
  }
  const bucketNames = ageing ? ageing.map((range) => range.name) : ["days_0_To_30", "days_31_To_60", "days_61_To_90", "days_91_To_180", "days_181_And_Above"];
  const ascii = (value: unknown) => toText(value).replace(/'/g, "''");

  // The parties: name, the flags the procedure's own inserts test, and what their heading row shows.
  const account = await runReportSql(loader, frag(`SELECT ac.code AS code, ac.name AS name, ac.book AS book, ac.a_pos AS a_pos, ac.os_flag AS os_flag, ac.a_posting AS a_posting, ac.a_short AS a_short, ac.credit_days AS credit_days, ac.grace_days AS grace_days, ac."LIMIT"::numeric AS lim, ac.budget::numeric AS budget, ad.contact AS contact, ad.tel_no AS tel_no, ad.mobile_no AS mobile_no, (ad.code is not null) AS has_address`
    + ` FROM ${db}ACCOUNT ac LEFT JOIN ${db}ADDRESS ad ON ad.code=ac.code AND ad.address_id=1 WHERE ac.code IN (${list})`));
  type Party = { code: number; name: string; book: number; usable: boolean; head: boolean; shortName: string; creditDays: number; graceDays: number; limit: number; budget: number; contact: string; tel: string; mobile: string; hasAddress: boolean; posA: boolean };
  const party = new Map<number, Party>();
  for (const row of account.rows) {
    party.set(Number(row.code), {
      code: Number(row.code), name: toText(row.name), book: Number(row.book), posA: toText(row.a_pos) === "A", head: toText(row.a_pos) !== "D",
      usable: toText(row.a_pos) !== "D" && toText(row.os_flag) !== "N" && toText(row.a_posting) !== "N",
      shortName: toText(row.a_short), creditDays: num(row.credit_days), graceDays: num(row.grace_days), limit: num(row.lim), budget: num(row.budget),
      contact: toText(row.contact), tel: toText(row.tel_no), mobile: toText(row.mobile_no), hasAddress: row.has_address === true,
    });
  }

  // ---- The bills, each with the receipts set off against it (CTE_TEMP left join CTE_TEMP1) ----
  const bills = await runReportSql(loader, frag(`SELECT ac.name AS name, ac.code AS ac_code, ac.book AS book, o.out_key AS out_key, o.out_fulldocno AS docno, o.out_entryamt::numeric AS entry, coalesce(o.out_ly_setoff::numeric,0) AS ly, coalesce(o.out_setoff::numeric,0) AS setoff, o.out_dbcode AS dbcode, o.out_date AS out_date, o.out_ledid AS ledid`
    + ` FROM ${db}OUTCLEAR o LEFT JOIN ${db}ACCOUNT ac ON ac.code=o.code LEFT JOIN ${db}AC_BALANCE acbal ON acbal.code=ac.code`
    + ` LEFT JOIN ${db}LEDGER led ON led.led_key=o.out_ledid AND (led.led_key=led.unique_key OR led.unique_key>1) AND led.book_code IN (${live})`
    + ` WHERE ac.a_pos<>'D' AND ac.os_flag<>'N' AND ac.a_posting<>'N' AND o.out_date<='${uptoText}' AND o.out_entryamt::numeric<>0 AND o.out_dbcode=${billSide} AND ac.book=${partyBook}`
    + ` AND ((acbal.opening::numeric<>0 AND led.doc_date<'${startText}') OR led.doc_date>='${startText}') AND o.code IN (${list}) ORDER BY ac.name, o.out_date, o.out_key`));
  const against = await runReportSql(loader, frag(`SELECT o1.out_ag_outid AS ag, o1.out_key AS out_key, o1.out_fulldocno AS docno, o1.out_dbcode AS dbcode, o1.out_date AS out_date, coalesce(o1.out_setoff::numeric,0) AS setoff, led1.doc_no1 AS doc_no1, led1.reco_date AS reco_date`
    + ` FROM ${db}OUTCLEAR o1 LEFT JOIN ${db}ACCOUNT ac1 ON ac1.code=o1.code LEFT JOIN ${db}LEDGER led1 ON led1.led_key=o1.out_ledid AND (led1.led_key=led1.unique_key OR led1.unique_key>1)`
    + ` WHERE led1.doc_pos<>'D' AND ac1.os_flag<>'N' AND ac1.code IN (${list}) AND ac1.book=${partyBook} AND led1.book_code IN (${live}) AND coalesce(o1.out_ag_outid,0)<>0${checks("CHK_PRNRIGHT") ? "" : ` AND o1.out_date<='${uptoText}'`}`));
  const againstBill = new Map<number, ResultRow[]>();
  for (const row of against.rows) { const key = Number(row.ag); (againstBill.get(key) ?? againstBill.set(key, []).get(key)!).push(row); }
  for (const rows of againstBill.values()) rows.sort((a, b) => (a.out_date as Date).getTime() - (b.out_date as Date).getTime() || Number(a.out_key) - Number(b.out_key));

  const mainOf = new Map<number, ClearRow[]>();
  const rowsOf = (code: number): ClearRow[] => mainOf.get(code) ?? mainOf.set(code, []).get(code)!;
  for (const bill of bills.rows) {
    const code = Number(bill.ac_code);
    const billDate = bill.out_date as Date;
    const docno = toText(bill.docno);
    const net = money(num(bill.entry) - num(bill.ly));
    if (net === 0) continue;
    for (const tc of againstBill.get(Number(bill.out_key)) ?? [null]) {
      const row = blankClearRow();
      row.smart_name = toText(bill.name); row.smart_sorting_name = `${toText(bill.name)}   P`; row.sorting_date = dateStyle112(billDate) + docno;
      row.full_docno = docno; row.selected_date = dateStyle6(billDate); row.book = Number(bill.book); row.invoice_amount = net; row.ac_code = code;
      row.cr_days = 0; row.days = clearDaysBetween(billDate, upto) + 1; row.pb = "";
      row.receipt_docno = tc ? toText(tc.docno) : ""; row.receipt_date = tc ? dateStyle6(tc.out_date as Date) : "";
      row.rdays = tc ? clearDaysBetween(billDate, tc.out_date as Date) + 1 : 0; row.receipt_amount = tc ? num(tc.setoff) : 0;
      row.balance_amount = clearRound(net - num(bill.setoff)); row.out_key = Number(bill.out_key); row.po = "";
      row.cheque_no = tc ? toText(tc.doc_no1) : ""; row.reco_date = tc && tc.reco_date ? ddMmYyyy(tc.reco_date as Date) : "";
      row.row_data_type = "LED"; row.recp_dbcode = tc ? Number(tc.dbcode) : 0; row.recp_outkey = tc ? Number(tc.out_key) : 0;
      row.recpsele_date = `${dateStyle112(billDate)}${docno}B`; row.out_ag_id = tc ? Number(tc.ag) : 0; row.out_ledid = bill.ledid === null || bill.ledid === undefined ? null : Number(bill.ledid);
      rowsOf(code).push(row);
    }
  }

  // ---- The deletes after the insert ("opening record with bill amt 0") ----
  const everyRow = () => [...mainOf.values()].flat();
  const removeWhere = (test: (row: ClearRow) => boolean) => { for (const [code, rows] of mainOf) mainOf.set(code, rows.filter((row) => !test(row))); };
  const beforeStart = (row: ClearRow): boolean => { if (row.selected_date === null) return false; const date = clearDate(row.selected_date); return date !== null && date < start; };
  const ledgerIds = [...new Set(everyRow().map((row) => row.out_ledid).filter((id): id is number => id !== null))];
  if (ledgerIds.length > 0) {
    const openingEntries = new Set((await runReportSql(loader, frag(`SELECT led_key FROM ${db}LEDGER WHERE unique_key=1 AND led_key<>1 AND led_key IN (${ledgerIds.join(",")})`))).rows.map((row) => Number(row.led_key)));
    removeWhere((row) => row.out_ledid !== null && openingEntries.has(row.out_ledid));
  }
  const noOpening = new Set((await runReportSql(loader, frag(`SELECT code FROM ${db}AC_BALANCE WHERE year_id='${ascii(call.yearId)}' AND opening::numeric=0`))).rows.map((row) => Number(row.code)));
  removeWhere((row) => beforeStart(row) && row.ac_code !== null && noOpening.has(row.ac_code));
  removeWhere((row) => row.full_docno === "OPENING" && num(row.invoice_amount) === 0);
  const documents = [...new Set(everyRow().map((row) => row.full_docno).filter((docno): docno is string => docno !== null && docno !== ""))];
  if (documents.length > 0) {
    const earlier = new Set((await runReportSql(loader, frag(`SELECT DISTINCT full_docno FROM ${db}LEDGER WHERE doc_pos='A' AND doc_date<'${startText}' AND book<8 AND full_docno IN (${documents.map((docno) => `'${ascii(docno)}'`).join(",")})`))).rows.map((row) => toText(row.full_docno)));
    removeWhere((row) => beforeStart(row) && row.full_docno !== null && earlier.has(row.full_docno));
  }

  // ---- The receipts that are against no bill (TEMP_TABLE_RECEIPT_OUTCLEAR) ----
  const shownAgainst = new Set(everyRow().map((row) => row.out_ag_id).filter((id): id is number => id !== null && id !== 0));
  const received = await runReportSql(loader, frag(`SELECT ac.name AS name, ac.code AS ac_code, o.out_key AS out_key, o.out_fulldocno AS docno, o.out_date AS out_date, o.out_dbcode AS dbcode, o.out_entryamt::numeric AS entry, coalesce(o.out_setoff::numeric,0) AS setoff, coalesce(o.out_ag_outid,0) AS ag, led.doc_no1 AS doc_no1, led.reco_date AS reco_date,`
    + ` (${settle ? `o.out_date>='${startText}' AND ` : ""}o.out_entryamt::numeric<>0 AND ac.book=${partyBook}) AS first_part,`
    + ` (o.out_entryamt::numeric-coalesce(o.out_ly_setoff::numeric,0)<coalesce(o.out_setoff::numeric,0) AND o.out_fulldocno<>'OPENING' AND coalesce(o.out_ly_setoff::numeric,0)>0 AND o.out_dbcode=${receiptSide} AND ac.book=${partyBook} AND o.out_date<'${startText}') AS second_part`
    + ` FROM ${db}OUTCLEAR o LEFT JOIN ${db}ACCOUNT ac ON ac.code=o.code LEFT JOIN ${db}AC_BALANCE acbal ON acbal.code=ac.code LEFT JOIN ${db}LEDGER led ON led.led_key=o.out_ledid`
    + ` WHERE ac.a_pos<>'D' AND ac.os_flag<>'N' AND ac.a_posting<>'N' AND o.out_date<='${uptoText}' AND o.out_dbcode=${receiptSide} AND o.code IN (${list}) AND led.book_code IN (${live})`
    + ` ORDER BY o.code, o.out_date, o.out_fulldocno, o.out_key`));
  const receiptsOf = new Map<number, ClearReceipt[]>();
  const receiptList = (code: number): ClearReceipt[] => receiptsOf.get(code) ?? receiptsOf.set(code, []).get(code)!;
  for (const row of received.rows) {
    const ag = Number(row.ag);
    if (!((row.first_part === true && (ag === 0 || !shownAgainst.has(ag))) || row.second_part === true)) continue;
    const date = row.out_date as Date;
    const setoff = num(row.setoff);
    const entry = num(row.entry);
    receiptList(Number(row.ac_code)).push({
      sorting_date: ddMmYyyy(date) + toText(row.docno), smart_name: toText(row.name), smart_sorting_name: `${toText(row.name)}   P`, ac_code: Number(row.ac_code),
      receipt_docno: toText(row.docno), receipt_date: dateStyle6(date),
      receipt_amount: ag === 0 && setoff === 0 ? Math.abs(entry) : Math.abs(setoff),
      balance_amount: ag === 0 ? (entry < 0 ? entry : -entry) : (setoff < 0 ? setoff : -setoff),
      recpsele_date: dateStyle112(date) + toText(row.docno), recp_outkey: Number(row.out_key), recp_dbcode: Number(row.dbcode),
      rdays: clearDaysBetween(start, date) + 1, cheque_no: row.doc_no1 === null || row.doc_no1 === undefined ? null : toText(row.doc_no1), reco_date: row.reco_date ? ddMmYyyy(row.reco_date as Date) : null,
    });
  }

  const openingRow = (info: Party, amount: number): ClearRow => {
    const row = blankClearRow();
    row.smart_name = info.name; row.smart_sorting_name = `${info.name}   P`; row.sorting_date = `${start112}OPENING`; row.full_docno = "OPENING"; row.selected_date = startText;
    row.book = info.book; row.invoice_amount = Math.abs(amount); row.ac_code = info.code; row.cr_days = 0; row.days = clearDaysBetween(start, upto) + 1; row.pb = "*";
    row.receipt_docno = ""; row.receipt_date = ""; row.receipt_amount = 0; row.balance_amount = Math.abs(amount); row.row_data_type = "LED";
    row.recpsele_date = `${start112}OPENINGB`; row.recp_outkey = 0; row.recp_dbcode = sale ? 1 : 2; row.po = "Y"; row.rdays = 0; row.cheque_no = ""; row.reco_date = ""; row.out_key = 0;
    return row;
  };
  const openingReceipt = (info: Party, amount: number, balance: number): ClearReceipt => ({
    sorting_date: "zz", smart_name: info.name, smart_sorting_name: `${info.name} P`, ac_code: info.code, receipt_docno: "OPENING", receipt_date: ddMmYyyy(start),
    receipt_amount: amount, balance_amount: balance, recpsele_date: `${start112}OPENINGB`, recp_outkey: 0, recp_dbcode: receiptSide, rdays: clearDaysBetween(start, upto) + 1, cheque_no: "", reco_date: "",
  });

  // ---- On Account To Settle ----
  if (settle) {
    const sums = await runReportSql(loader, frag(`SELECT ac.code AS code, acbal.opening::numeric AS opening,`
      + ` coalesce((SELECT o.out_entryamt::numeric FROM ${db}OUTCLEAR o WHERE o.code=ac.code AND o.out_date='${startText}' AND o.out_entryamt::numeric<>0 AND o.out_ledid IS NULL LIMIT 1),0) AS out_open`
      + ` FROM ${db}ACCOUNT ac LEFT JOIN ${db}AC_BALANCE acbal ON acbal.code=ac.code WHERE ac.os_flag<>'N' AND acbal.year_id='${ascii(call.yearId)}' AND ac.book=${partyBook} AND ac.code IN (${list}) AND acbal.opening::numeric<>0`));
    const sumOf = new Map(sums.rows.map((row) => [Number(row.code), { opening: clearRound(num(row.opening)), outOpen: clearRound(num(row.out_open)) }]));

    for (const info of [...party.values()].filter((entry) => entry.posA && entry.book === partyBook).sort((a, b) => a.code - b.code)) {
      const code = info.code;
      const mine = rowsOf(code);
      const pending = receiptList(code);
      const receiptRow = (m: ClearRow, amount: number, balance: number, key: string): ClearReceipt => ({
        sorting_date: key, smart_name: info.name, smart_sorting_name: `${info.name} P`, ac_code: code, receipt_docno: m.receipt_docno, receipt_date: m.receipt_date,
        receipt_amount: amount, balance_amount: balance, recpsele_date: m.recpsele_date, recp_outkey: m.recp_outkey, recp_dbcode: m.recp_dbcode, rdays: m.rdays, cheque_no: m.cheque_no, reco_date: m.reco_date,
      });

      // A receipt bigger than its bill: the rest goes to the receipt list.
      for (const m of mine) if (num(m.receipt_amount) > num(m.invoice_amount)) pending.push(receiptRow(m, num(m.receipt_amount) - num(m.invoice_amount), num(m.receipt_amount) + num(m.invoice_amount), "z"));
      for (const m of mine) if (num(m.receipt_amount) > num(m.invoice_amount)) { m.receipt_amount = m.invoice_amount; m.balance_amount = 0; }

      const sum = sumOf.get(code);
      let diffOpen = sum ? sum.outOpen : 0;
      let openBal = sum ? sum.opening : 0;
      openBal = sale ? openBal : -openBal;

      if (diffOpen < 0) {
        // The opening difference is taken off the old bills, oldest first; their receipts go back to the receipt list.
        diffOpen = Math.abs(diffOpen);
        for (let guard = 0; diffOpen > 0 && mine.some(beforeStart) && guard < 100000; guard += 1) {
          const candidates = mine.filter(beforeStart);
          const first = firstOf(candidates, (row) => row.sorting_date)!;
          const group = candidates.filter((row) => row.out_key === first.out_key && row.sorting_date === first.sorting_date && row.invoice_amount === first.invoice_amount && row.balance_amount === first.balance_amount);
          const invoiceId = first.out_key;
          let receiptBal = clearRound(group.reduce((total, row) => total + num(row.receipt_amount), 0));
          const allocate = clearRound(num(first.invoice_amount));
          const billRows = () => mine.filter((row) => row.out_key === invoiceId);
          if (billRows().length > 1) {
            let balanceSoFar = 0;
            let newInvoice = 0;
            const cursor = billRows().slice().sort((a, b) => compareNullFirst(a.sorting_date, b.sorting_date)).map((row) => ({ out: row.recp_outkey, invoice: clearRound(num(row.invoice_amount)), receipt: clearRound(num(row.receipt_amount)) }));
            for (const current of cursor) {
              if (diffOpen >= current.invoice || (balanceSoFar >= newInvoice && newInvoice > 0)) {
                for (const m of mine.filter((row) => row.out_key === invoiceId && row.recp_outkey === current.out && clearSame(row.receipt_amount, current.receipt))) pending.push(receiptRow(m, current.receipt, current.receipt * -1, "zz"));
                for (let at = mine.length - 1; at >= 0; at -= 1) if (mine[at].out_key === invoiceId && mine[at].recp_outkey === current.out && clearSame(mine[at].receipt_amount, current.receipt)) mine.splice(at, 1);
                balanceSoFar = clearRound(balanceSoFar + current.receipt);
                newInvoice = allocate;
              } else {
                newInvoice = clearRound(allocate - diffOpen);
                if (current.receipt + balanceSoFar >= diffOpen) {
                  const newReceipt = current.receipt + balanceSoFar > newInvoice ? clearRound(newInvoice - balanceSoFar) : current.receipt;
                  for (const m of mine) if (m.recp_outkey === current.out) { m.invoice_amount = newInvoice; m.receipt_amount = newReceipt; }
                  for (const m of mine) if (m.out_key === invoiceId) m.balance_amount = clearRound(newInvoice - (newReceipt + balanceSoFar));
                  if (current.receipt > newReceipt) for (const m of mine.filter((row) => row.out_key === invoiceId && row.recp_outkey === current.out && clearSame(row.receipt_amount, newReceipt))) pending.push(receiptRow(m, current.receipt - newReceipt, (current.receipt - newReceipt) * -1, "zz"));
                  balanceSoFar = clearRound(balanceSoFar + newReceipt);
                } else if (current.receipt > 0) {
                  for (const m of mine) if (m.out_key === invoiceId) { m.invoice_amount = newInvoice; m.balance_amount = clearRound(newInvoice - (current.receipt + balanceSoFar)); }
                  balanceSoFar = clearRound(balanceSoFar + current.receipt);
                } else {
                  for (const m of mine) if (m.out_key === invoiceId) { m.invoice_amount = num(m.invoice_amount) - diffOpen; m.balance_amount = clearRound(num(m.balance_amount) - diffOpen); }
                }
              }
            }
            diffOpen = clearRound(diffOpen - allocate);
          } else if (diffOpen >= allocate && diffOpen > 0) {
            for (const m of billRows()) pending.push(receiptRow(m, num(m.receipt_amount), num(m.receipt_amount) * -1, "zz"));
            for (let at = mine.length - 1; at >= 0; at -= 1) if (mine[at].out_key === invoiceId) mine.splice(at, 1);
            diffOpen = clearRound(diffOpen - allocate);
            if (diffOpen < 0) diffOpen = 0;
          } else {
            if (receiptBal >= diffOpen && diffOpen > 0) {
              for (const m of billRows()) { m.invoice_amount = num(m.invoice_amount) - diffOpen; m.receipt_amount = num(m.receipt_amount) - diffOpen; }
            } else if (receiptBal > 0) {
              for (const m of billRows()) { m.invoice_amount = num(m.invoice_amount) - diffOpen; m.balance_amount = clearRound(allocate - diffOpen - receiptBal); }
              receiptBal = clearRound(receiptBal - (allocate - diffOpen));
            } else {
              for (const m of billRows()) { m.invoice_amount = num(m.invoice_amount) - diffOpen; m.balance_amount = clearRound(num(m.balance_amount) - diffOpen); }
            }
            if (receiptBal > diffOpen && diffOpen > 0) {
              const top = billRows()[0];
              const receiptDate = clearDate(top?.receipt_date ?? "");
              pending.push({
                sorting_date: "zz", smart_name: info.name, smart_sorting_name: `${info.name} P`, ac_code: code, receipt_docno: top?.receipt_docno ?? null,
                receipt_date: receiptDate ? ddMmYyyy(receiptDate) : null, receipt_amount: diffOpen, balance_amount: diffOpen * -1, recpsele_date: receiptDate ? dateStyle112(receiptDate) : null,
                recp_outkey: 0, recp_dbcode: receiptSide, rdays: receiptDate ? clearDaysBetween(start, receiptDate) + 1 : null, cheque_no: "", reco_date: "",
              });
            }
            diffOpen = 0;
          }
        }
      } else if (diffOpen > 0) {
        if (sale) { if (info.usable) mine.push(openingRow(info, diffOpen)); }
        else if (info.usable) pending.push(openingReceipt(info, Math.abs(openBal), openBal));
        diffOpen = 0;
      } else if (openBal < 0) {
        if (info.usable) mine.push(openingRow(info, diffOpen));
      }
      if (diffOpen > 0 && info.usable) pending.push(openingReceipt(info, Math.abs(diffOpen), diffOpen));

      // Every receipt with something left goes against the oldest pending bill.
      const datedText = (value: string | null | undefined) => clearDate(value ?? "") ?? new Date(1900, 0, 1);
      for (let outer = 0; pending.some((row) => row.receipt_amount > 0 && row.balance_amount !== 0) && outer < 200000; outer += 1) {
        const receipt = firstOf(pending.filter((row) => row.receipt_amount > 0 && row.balance_amount !== 0), (row) => row.recpsele_date)!;
        const receiptId = receipt.recp_outkey ?? 0;
        const receiptNo = receipt.receipt_docno ?? "";
        const receiptDateText = receipt.receipt_date ?? "";
        let receiptBal = clearRound(receipt.receipt_amount);
        let invoiceFound = false;
        while (receiptBal > 0 && mine.some((row) => num(row.balance_amount) > 0)) {
          const bill = firstOf(mine.filter((row) => num(row.balance_amount) > 0), (row) => row.sorting_date)!;
          const invoiceId = bill.out_key ?? 0;
          const invoiceNo = bill.full_docno ?? "";
          const invoiceDateText = bill.selected_date ?? "";
          const billReceiptBal = clearRound(num(bill.receipt_amount));
          const allocate = clearRound(num(bill.invoice_amount));
          const invoiceBal = clearRound(num(bill.balance_amount));
          invoiceFound = true;
          const invoiceDate = datedText(invoiceDateText);
          const receiptDate = datedText(receiptDateText);
          const withReceipt = (amount: number, balance: number): ClearRow => {
            const row = blankClearRow();
            row.smart_name = info.name; row.smart_sorting_name = `${info.name}   P`; row.sorting_date = dateStyle112(invoiceDate) + invoiceNo; row.full_docno = invoiceNo;
            row.selected_date = invoiceDateText; row.book = info.book; row.invoice_amount = allocate; row.ac_code = code; row.cr_days = 0; row.days = clearDaysBetween(invoiceDate, upto) + 1; row.pb = "";
            row.receipt_docno = receiptNo; row.receipt_date = receiptDateText; row.receipt_amount = amount; row.balance_amount = clearRound(balance); row.row_data_type = "LED";
            row.recpsele_date = `${dateStyle112(invoiceDate)}${invoiceNo}Y`; row.recp_outkey = 0; row.recp_dbcode = receiptSide; row.po = "Y"; row.rdays = clearDaysBetween(invoiceDate, receiptDate) + 1;
            row.cheque_no = ""; row.reco_date = ""; row.out_key = invoiceId;
            return row;
          };
          const setReceipt = (row: ClearRow, amount: number, balance: number) => {
            row.receipt_docno = receiptNo; row.receipt_date = receiptDateText; row.receipt_amount = amount; row.balance_amount = clearRound(balance); row.po = "Y";
            row.recpsele_date = `${dateStyle112(invoiceDate)}${invoiceNo}Y`; row.rdays = clearDaysBetween(invoiceDate, receiptDate) + 1;
          };
          if (invoiceBal >= receiptBal) {
            if (billReceiptBal > 0) {
              mine.push(withReceipt(receiptBal, invoiceBal - receiptBal));
              for (const row of mine) if (row.out_key === invoiceId && clearSame(row.balance_amount, invoiceBal)) row.balance_amount = 0;
            } else {
              for (const row of mine) if (row.out_key === invoiceId) setReceipt(row, receiptBal, invoiceBal - receiptBal);
            }
            for (const row of pending) if (row.recp_outkey === receiptId) row.receipt_amount = 0;
            receiptBal = 0;
          } else {
            if (billReceiptBal > 0) {
              mine.push(withReceipt(invoiceBal, 0));
              for (const row of mine) if (row.out_key === invoiceId && clearSame(row.balance_amount, invoiceBal)) row.balance_amount = 0;
            } else {
              for (const row of mine) if (row.out_key === invoiceId && clearSame(row.balance_amount, invoiceBal)) setReceipt(row, invoiceBal, 0);
            }
            for (const row of pending) if (row.recp_outkey === receiptId) row.receipt_amount = money(row.receipt_amount - invoiceBal);
            receiptBal = clearRound(receiptBal - invoiceBal);
          }
        }
        if (!invoiceFound) {
          // No pending bill to take it: a line of its own, with the balance below zero.
          const receiptDate = datedText(receiptDateText);
          const row = blankClearRow();
          row.smart_name = info.name; row.smart_sorting_name = `${info.name}   P`; row.sorting_date = dateStyle112(receiptDate) + receiptNo; row.full_docno = "";
          row.book = info.book; row.invoice_amount = 0; row.ac_code = code; row.cr_days = 0; row.days = 0; row.pb = ""; row.receipt_docno = receiptNo; row.receipt_date = receiptDateText;
          row.receipt_amount = receiptBal; row.balance_amount = receiptBal * -1; row.row_data_type = "LED"; row.recpsele_date = `${dateStyle112(receiptDate)}${receiptNo}Y`;
          row.recp_outkey = receiptId; row.recp_dbcode = receiptSide; row.po = "Y"; row.rdays = clearDaysBetween(receiptDate, upto) + 1; row.cheque_no = ""; row.reco_date = ""; row.out_key = 0;
          mine.push(row);
          for (const other of pending) if (other.recp_outkey === receiptId) other.receipt_amount = other.receipt_amount * -1;
          receiptBal = 0;
        }
      }
    }
  } else {
    // The receipts under the bills as they are (the ELSE of On Account To Settle).
    for (const [code, rows] of receiptsOf) {
      for (const receipt of rows) {
        const date = clearDate(receipt.receipt_date) ?? new Date(1900, 0, 1);
        const row = blankClearRow();
        row.smart_name = receipt.smart_name; row.smart_sorting_name = `${receipt.smart_name}   P`; row.sorting_date = receipt.sorting_date; row.ac_code = code; row.cr_days = 0; row.days = 0; row.pb = "";
        row.receipt_docno = receipt.receipt_docno; row.receipt_date = receipt.receipt_date; row.receipt_amount = Math.abs(receipt.receipt_amount); row.balance_amount = receipt.balance_amount;
        row.row_data_type = "LED"; row.recpsele_date = `${dateStyle112(date)}${receipt.receipt_docno ?? ""}Y`; row.recp_outkey = receipt.recp_outkey; row.recp_dbcode = receiptSide; row.po = "Y";
        row.rdays = clearDaysBetween(date, upto) + 1; row.cheque_no = receipt.cheque_no; row.reco_date = receipt.reco_date; row.out_key = 0;
        rowsOf(code).push(row);
      }
    }
  }

  // ---- The ranking: a bill's first line keeps its balance, its other lines lose the invoice figures ----
  const sortKey = (row: ClearRow) => [row.sorting_date, row.full_docno, row.recpsele_date];
  const partitions = (rows: readonly ClearRow[], only: (row: ClearRow) => boolean) => {
    const groups = new Map<string, ClearRow[]>();
    for (const row of rows) if (only(row)) { const key = `${row.full_docno === null ? "\u0000" : row.full_docno}\u0001${row.invoice_amount === null ? "\u0000" : row.invoice_amount}`; (groups.get(key) ?? groups.set(key, []).get(key)!).push(row); }
    for (const group of groups.values()) group.sort((a, b) => { const x = sortKey(a); const y = sortKey(b); for (let at = 0; at < x.length; at += 1) { const order = compareNullFirst(x[at], y[at]); if (order !== 0) return order; } return 0; });
    return groups;
  };
  for (const rows of mainOf.values()) {
    for (const group of partitions(rows, (row) => (row.full_docno ?? "") !== "").values()) {
      const nonZero = group.map((row) => num(row.balance_amount)).filter((balance) => balance !== 0);
      group[0].balance_amount = nonZero.length > 0 ? Math.max(...nonZero) : null;
    }
    for (const group of partitions(rows, () => true).values()) {
      for (const row of group.slice(1)) {
        const balance = row.balance_amount;
        if (balance !== null && (balance >= 0 || (num(row.invoice_amount) > 0 && balance < 0))) { row.full_docno = ""; row.selected_date = ""; row.invoice_amount = 0; row.balance_amount = 0; row.days = 0; }
      }
    }
  }

  // ---- The addon groups' heading rows ----
  if (levels > 0) {
    for (const rows of mainOf.values()) for (const row of rows) if (row.ac_code !== null && addonOf.has(row.ac_code)) row.a = [...addonOf.get(row.ac_code)!];
    const head = rowsOf(0);
    for (let level = 1; level <= levels; level += 1) {
      const subs = await runReportSql(loader, frag(`SELECT ltrim(sub_name) AS name FROM ${db}ADDON_SUB WHERE sub_pos<>'D' AND sub_code IN (${[...addonIds[level - 1]].join(",")})`));
      const made = subs.rows.map((entry) => {
        const row = blankClearRow();
        row.row_data_type = `ADDON_${level}`; row.smart_sorting_name = `${toText(entry.name)}   A`; row.a[level - 1] = toText(entry.name); row.full_docno = toText(entry.name);
        return row;
      });
      head.push(...made);
      if (level >= 2) {
        // The procedure updates each heading from every (outer, this) pair found, so the last pair wins.
        const pairs = new Map<string, (string | null)[]>();
        for (const row of everyRow()) {
          const values = row.a.slice(0, level);
          if (values.some((value) => value === null)) continue;
          pairs.set(values.join("|"), values);
        }
        const ordered = [...pairs.values()].sort((x, y) => { for (let at = 0; at < level; at += 1) { const order = compareNullFirst(x[at], y[at]); if (order !== 0) return order; } return 0; });
        for (const values of ordered) for (const row of made) if (row.a[level - 1] === values[level - 1]) { row.smart_sorting_name = `${values.join(" ")}   A1`; for (let at = 0; at < level - 1; at += 1) row.a[at] = values[at]; }
      }
    }
  }

  // ---- A heading row a party ----
  for (const [code, rows] of mainOf) {
    if (rows.length === 0) continue;
    const info = party.get(code);
    if (!info || !info.head) continue;
    const row = blankClearRow();
    row.a = addonOf.get(code) ? [...addonOf.get(code)!] : [null, null, null, null];
    row.smart_name = info.name; row.smart_sorting_name = levels > 0 ? sortName(row.a, levels, info.name.trimStart(), "   H") : `${info.name.trimStart()}   H`; row.ac_code = code; row.row_data_type = "AC";
    rows.push(row);
  }
  removeWhere((row) => row.recp_dbcode === receiptSide && row.receipt_docno === "OPENING" && num(row.receipt_amount) === 0);
  for (const rows of mainOf.values()) for (const row of rows) if (row.row_data_type === "AC") row.full_docno = row.smart_name;

  // ---- Credit days ----
  if (checks("CHK_ENTCDAY")) {
    const ids = [...new Set(everyRow().filter((row) => row.row_data_type === "LED" && row.out_ledid !== null).map((row) => row.out_ledid as number))];
    const days = new Map<number, number>();
    if (ids.length > 0) for (const row of (await runReportSql(loader, frag(`SELECT led_key, credit_days::numeric AS credit_days FROM ${db}LEDGER WHERE led_key IN (${ids.join(",")})`))).rows) days.set(Number(row.led_key), num(row.credit_days));
    for (const row of everyRow()) if (row.row_data_type === "LED" && row.out_ledid !== null && days.has(row.out_ledid)) row.cr_days = Math.trunc(days.get(row.out_ledid)!);
  } else {
    for (const row of everyRow()) if (row.row_data_type === "LED" && row.ac_code !== null && party.has(row.ac_code)) row.cr_days = party.get(row.ac_code)!.creditDays;
  }

  // ---- Only Pending Bills (and the Grace Days sorting) ----
  if (pendingOnly) {
    const heading = (row: ClearRow) => row.row_data_type === "AC" || (row.row_data_type ?? "").startsWith("ADDON");
    removeWhere((row) => !heading(row) && (settle ? num(row.balance_amount) <= 0 : num(row.balance_amount) === 0));
    if (call.sortingText.toUpperCase() === "GRACE DAYS") {
      const ids = [...new Set(everyRow().filter((row) => row.row_data_type === "LED" && row.out_ledid !== null).map((row) => row.out_ledid as number))];
      const days = new Map<number, number>();
      if (ids.length > 0) for (const row of (await runReportSql(loader, frag(`SELECT led_key, credit_days::numeric AS credit_days FROM ${db}LEDGER WHERE led_key IN (${ids.join(",")})`))).rows) days.set(Number(row.led_key), num(row.credit_days));
      const extra = text1 === "" ? 0 : num(text1);
      for (const row of everyRow()) {
        if (row.row_data_type !== "LED" || row.out_ledid === null || !days.has(row.out_ledid) || row.ac_code === null || !party.has(row.ac_code)) continue;
        const entry = days.get(row.out_ledid)!;
        row.crdays = (entry === 0 ? party.get(row.ac_code)!.creditDays : entry) + extra;
      }
      removeWhere((row) => row.row_data_type === "LED" && row.crdays !== undefined && row.crdays !== null && num(row.days) <= row.crdays);
    }
  }

  // ---- The party's details after its name ----
  for (const row of everyRow()) {
    if (row.row_data_type !== "AC" || row.ac_code === null) continue;
    const info = party.get(row.ac_code);
    if (!info || !info.hasAddress) continue;
    const showsBudget = [5, 7, 8].includes(call.licence);
    row.full_docno = (row.full_docno ?? "") + (info.shortName !== "" ? ` ${info.shortName}` : "") + (info.contact !== "" ? ` Contact ${info.contact}` : "") + (info.tel !== "" ? ` Tel No. ${info.tel}` : "")
      + (info.mobile !== "" ? ` Mobil No. ${info.mobile}` : "") + (info.creditDays !== 0 ? ` Cr.Days ${info.creditDays}` : "") + (info.graceDays !== 0 ? ` Gr.Days ${text1 === "" ? info.graceDays : text1}` : "")
      + (showsBudget ? (info.budget !== 0 ? ` Budget ${info.budget.toFixed(2)}` : "") : (info.limit !== 0 ? ` Limit : ${info.limit.toFixed(2)}` : ""));
  }

  // ---- Lines with nothing in them, and parties left with only their heading ----
  removeWhere((row) => row.row_data_type !== "AC" && !(row.row_data_type ?? "").startsWith("ADDON") && num(row.receipt_amount) === 0 && num(row.invoice_amount) === 0);
  const counts = new Map<number, number>();
  for (const row of everyRow()) if (row.ac_code !== null && !(row.row_data_type ?? "").startsWith("ADDON")) counts.set(row.ac_code, (counts.get(row.ac_code) ?? 0) + 1);
  removeWhere((row) => row.ac_code !== null && counts.get(row.ac_code) === 1);
  // An addon value with nothing under its heading goes (the first two levels, as the procedure does).
  for (let level = 0; level < Math.min(levels, 2); level += 1) {
    const per = new Map<string, number>();
    for (const row of everyRow()) if (row.a[level] !== null) per.set(row.a[level]!, (per.get(row.a[level]!) ?? 0) + 1);
    removeWhere((row) => row.a[level] !== null && per.get(row.a[level]!) === 1);
  }
  if (levels > 0) for (const row of everyRow()) if (row.row_data_type === "LED") row.smart_sorting_name = sortName(row.a, levels, row.smart_name, "   P");

  // ---- The ageing columns, the pending mark ----
  const bucketsOf = (days: number, amount: number | null): (number | null)[] => {
    if (!ageing) return [days <= 30 ? amount : 0, days >= 31 && days <= 60 ? amount : 0, days >= 61 && days <= 90 ? amount : 0, days >= 91 && days <= 180 ? amount : 0, days >= 181 ? amount : 0];
    const count = ageing.length;
    return ageing.map((range, at) => {
      const low = at === 0 ? (count === 1 && !pendingOnly ? range.from : -99999) : range.from;
      const high = at === count - 1 && (count === 1 || at > 0) ? 99999 : range.upto;
      return days >= low && days <= high ? amount : 0;
    });
  };
  const buckets = new Map<ClearRow, (number | null)[]>();
  for (const row of everyRow()) {
    if (row.row_data_type !== "LED") continue;
    buckets.set(row, pendingOnly ? bucketsOf(num(row.days), row.balance_amount) : bucketsOf(num(row.rdays), row.receipt_amount));
  }
  for (const row of everyRow()) if (num(row.balance_amount) > 0) row.pb = "*";

  // ---- Last year's opening lines when On Account To Settle is not ticked ----
  if (!settle) {
    const before = new Set((await runReportSql(loader, frag(`SELECT DISTINCT code FROM ${db}OUTCLEAR WHERE out_date<'${startText}'`))).rows.map((row) => Number(row.code)));
    removeWhere((row) => row.receipt_docno === "OPENING" && row.ac_code !== null && before.has(row.ac_code));
    removeWhere((row) => row.full_docno === "OPENING" && num(row.invoice_amount) < 0 && row.ac_code !== null && before.has(row.ac_code));
  }

  const result = new ResultTable();
  if (format === "SUMMARY") {
    const rows = everyRow().filter((row) => row.row_data_type === "LED");
    const names = ["SORTING_COL", "NAME", "INVOICE_AMOUNT", "RECEIPT_AMOUNT", "BALANCE_AMOUNT", ...(checks("CHK_AVGDAY") ? ["AVG_DAYS"] : []), "ROW_DATA_TYPE", ...Array.from({ length: levels }, (_, at) => `SMART_SELECTED_ADDON${at + 1}`)];
    for (const name of names) result.addColumn(name);
    for (const name of ["INVOICE_AMOUNT", "RECEIPT_AMOUNT", "BALANCE_AMOUNT"]) result.setKind(name, "decimal");
    if (checks("CHK_AVGDAY")) result.setKind("AVG_DAYS", "int");
    const grouped = new Map<string, { a: (string | null)[]; name: string; invoice: number | null; receipt: number | null; balance: number | null; days: number; counted: number }>();
    for (const row of rows) {
      const key = `${row.smart_name ?? ""}|${row.a.slice(0, levels).join("|")}`;
      const sum = grouped.get(key) ?? grouped.set(key, { a: row.a, name: row.smart_name ?? "", invoice: null, receipt: null, balance: null, days: 0, counted: 0 }).get(key)!;
      if (row.invoice_amount !== null) sum.invoice = money((sum.invoice ?? 0) + row.invoice_amount);
      if (row.receipt_amount !== null) sum.receipt = money((sum.receipt ?? 0) + row.receipt_amount);
      if (row.balance_amount !== null) sum.balance = money((sum.balance ?? 0) + row.balance_amount);
      sum.days += num(row.rdays);
      if (num(row.rdays) !== 0) sum.counted += 1;
    }
    for (const sum of grouped.values()) {
      const addons: Record<string, string | null> = {};
      for (let at = 0; at < levels; at += 1) addons[`SMART_SELECTED_ADDON${at + 1}`] = sum.a[at];
      result.rows.push({ ...addons, SORTING_COL: levels > 0 ? sortName(sum.a, levels, sum.name, "   P") : sum.name, NAME: sum.name, INVOICE_AMOUNT: sum.invoice, RECEIPT_AMOUNT: sum.receipt, BALANCE_AMOUNT: sum.balance, AVG_DAYS: sum.counted > 0 && sum.days > 0 ? Math.trunc(sum.days / sum.counted) : sum.days, ROW_DATA_TYPE: "LED" });
    }
    // A heading row for each addon value (and each outer-and-inner pair) that has parties under it.
    for (let level = 1; level <= levels; level += 1) {
      const seen = new Map<string, (string | null)[]>();
      for (const row of [...result.rows]) {
        const values = [0, 1, 2, 3].map((at) => (row[`SMART_SELECTED_ADDON${at + 1}`] as string | null | undefined) ?? null);
        if (values.slice(0, level).some((value) => value === null) || toText(row.ROW_DATA_TYPE) !== "LED") continue;
        seen.set(values.slice(0, level).join("|"), values.slice(0, level));
      }
      for (const values of seen.values()) {
        const row: ResultRow = { SORTING_COL: `${values.join(" ")}   A`, NAME: values[level - 1], ROW_DATA_TYPE: `ADDON_${level}` };
        for (let at = 0; at < level; at += 1) row[`SMART_SELECTED_ADDON${at + 1}`] = values[at];
        result.rows.push(row);
      }
    }
    sortRows(result, [(row) => textKey(row.SORTING_COL)]);
    return result;
  }

  // Interest Perc sorting: the typed rate (24 when blank) a year on what was paid late (or, with Interest Calculate With
  // Balance Amount, on what is still pending), and a bill's later lines lose its invoice figures.
  const interest = /interest/i.test(call.sortingText);
  if (interest) {
    const perc = (text1 === "" ? 24 : num(text1)) / 100;
    const r = (value: number) => Math.round(value * 100) / 100;
    const lines = everyRow().filter((row) => row.row_data_type === "LED");
    for (const row of lines) {
      const credit = num(row.cr_days);
      if (checks("CHK_INTEREST")) {
        if (call.licence === 12) { if (num(row.rdays) > credit) row.int_amount = r((num(row.invoice_amount) * perc / 365) * num(row.rdays)); }
        else if (num(row.balance_amount) === 0 && num(row.rdays) > credit) row.int_amount = r((num(row.receipt_amount) * perc / 365) * (num(row.rdays) - credit));
        if (num(row.days) > credit) {
          if (call.licence === 12) row.int_amount = r((num(row.invoice_amount) * perc / 365) * num(row.days));
          else if (num(row.balance_amount) > 0) row.int_amount = r((num(row.balance_amount) * perc / 365) * (num(row.days) - credit));
        }
      } else if (num(row.balance_amount) === 0 && num(row.rdays) > credit) row.int_amount = r((num(row.receipt_amount) * perc / 365) * (num(row.rdays) - credit));
    }
    for (const rows of mainOf.values()) {
      const seen = new Map<string, number>();
      for (const row of rows.filter((entry) => entry.row_data_type !== "AC").sort((a, b) => -compareNullFirst(a.full_docno, b.full_docno))) {
        const key = `${row.sorting_date ?? "\u0000"}\u0001${row.full_docno ?? "\u0000"}`;
        const rank = (seen.get(key) ?? 0) + 1;
        seen.set(key, rank);
        if (rank !== 1) { row.full_docno = ""; row.selected_date = null; row.invoice_amount = null; row.days = null; }
      }
    }
    for (const row of lines) if (row.invoice_amount === null && num(row.balance_amount) > 0) row.balance_amount = 0;
    for (const row of everyRow()) if (row.full_docno === null) row.full_docno = "";
  }

  // The tail of the detail: lines without a receipt and with a negative figure go, a bill with no receipt shows its invoice as its balance.
  removeWhere((row) => (num(row.rdays) < 0 || num(row.receipt_amount) < 0) && (row.receipt_docno ?? "") === "");
  for (const row of everyRow()) if (num(row.receipt_amount) === 0 && (row.receipt_docno ?? "") === "") row.balance_amount = row.invoice_amount;
  for (const row of everyRow()) if (row.row_data_type === "LED" && (row.sorting_date ?? "") === "") row.sorting_date = "zz";

  const names = ["SMART_NAME", "SMART_SORTING_NAME", "SORTING_DATE", "full_docno", "selected_date", "book", "INVOICE_AMOUNT", "AC_CODE", "CR_DAYS", "Days", "pb", "receipt_docno", "receipt_date", "Rdays", "receipt_amount", "BALANCE_AMOUNT", "out_key", "PO", "cheque_no", "reco_date", "ROW_DATA_TYPE", "RECPSELE_DATE", ...bucketNames, "out_ledid", ...Array.from({ length: levels }, (_, at) => `SMART_SELECTED_ADDON${at + 1}`), ...(interest ? ["Int_Amount"] : [])];
  for (const name of names) result.addColumn(name);
  for (const name of ["INVOICE_AMOUNT", "receipt_amount", "BALANCE_AMOUNT", ...(interest ? ["Int_Amount"] : []), ...bucketNames]) result.setKind(name, "decimal");
  for (const name of ["book", "AC_CODE", "CR_DAYS", "Days", "Rdays", "out_key", "out_ledid"]) result.setKind(name, "int");
  for (const row of everyRow()) {
    const age = buckets.get(row);
    result.rows.push({
      SMART_NAME: row.smart_name, SMART_SORTING_NAME: row.smart_sorting_name, SORTING_DATE: row.sorting_date, full_docno: row.full_docno, selected_date: row.selected_date, book: row.book,
      INVOICE_AMOUNT: row.invoice_amount, AC_CODE: row.ac_code, CR_DAYS: row.cr_days, Days: row.days, pb: row.pb, receipt_docno: row.receipt_docno, receipt_date: row.receipt_date,
      Rdays: row.rdays, receipt_amount: row.receipt_amount, BALANCE_AMOUNT: row.balance_amount, out_key: row.out_key, PO: row.po, cheque_no: row.cheque_no, reco_date: row.reco_date,
      ROW_DATA_TYPE: row.row_data_type, RECPSELE_DATE: row.recpsele_date,
      ...Object.fromEntries(bucketNames.map((name, at) => [name, age ? age[at] : 0])),
      ...Object.fromEntries(Array.from({ length: levels }, (_, at) => [`SMART_SELECTED_ADDON${at + 1}`, row.a[at]])),
      out_ledid: row.out_ledid, ...(interest ? { Int_Amount: row.int_amount ?? null } : {}),
    });
  }
  sortRows(result, [(row) => textKey(row.SMART_SORTING_NAME), (row) => textKey(row.SORTING_DATE), (row) => textKey(row.RECPSELE_DATE)]);
  if (result.rows.length === 0) throw new ReportRefusal("No Records Found", "No Data");
  return result;
}
