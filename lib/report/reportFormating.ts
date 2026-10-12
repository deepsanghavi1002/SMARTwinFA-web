import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { dateStyle112, dateStyle6, desktopDate, sqlServerCompare } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { cashBookColumns, dayBefore, ddMmYyyy, dropColumn, tableFromFields, formatPeriod, maxOf, pushAll, groupOrderTail, insertFirst, MONTH_NAMES, requireWhere, sortRows, tableFromResult, textKey, unknownFormat, withEntryAddon } from "./library";
import { registerSlabBook, registerSlabs, challanFrom, orderPendingFrom, orderPendingWhere, pendingChallanFrom, stockVoucher, invalidGst, gstrTaxMismatch, documentUpload, gstFormSummary, gstr3b, gstr1, gstr2, bookwise, checklistDaybook, checklistInvoice, dailyTransaction, fundFlow, interestCalculation, target, taxSummary, tdsReport, topReports, dropAnalysis, partyBillPdf, physicalStock, cashBookFrom, cashBookOpening, monthlyClosingStock, partyStock, stockMovement, stockSummary } from "./reportStandard";
import { money, num, runReportSql, runReportSqlHashed } from "./run";

/**
 * SP_REPORT_FORMATING: a report's formats (Month, Daily, Weekly, 15 Days, Quarter, Half Year,
 * Summary ...), one branch per report key as in the SQL Server procedure, each finished by the
 * procedure's common tail (LBL_RESULT) that adds FROM, WHERE, GROUP BY and ORDER BY to the
 * format's select. The periods' SQL is shared (library.formatPeriod).
 *
 * Ported branches: 14 (form summary), 1 (day book), 3 (register), 4 (ledger), 21 (outstanding clearance), 29 (stock summary, in reportStandard.ts), 42 (budget), 93 (stock movement, in reportStandard.ts), 109 (fund flow), 119 (checklist invoice), 120 (checklist daybook), 258 (monthly closing stock, in reportStandard.ts).
 */
export async function formattedReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  switch (plan.call.reportKey) {
    case 1: return daybookFormats(loader, plan);
    case 3: return registerFormats(loader, plan);
    case 4: return ledgerFormats(loader, plan);
    case 14: return formSummaryFormats(loader, plan);
    case 16: return partyStock(loader, plan);
    case 211: return topReports(loader, plan);
    case 112: return physicalStock(loader, plan);
    case 232: return dropAnalysis(loader, plan);
    case 255: return partyBillPdf(loader, plan);
    case 284: return documentUpload(loader, plan);
    case 126: return invalidGst(loader, plan);
    case 127: return gstFormSummary(loader, plan);
    case 132: return gstrTaxMismatch(loader, plan);
    case 129: return gstr3b(loader, plan);
    case 130: return gstr1(loader, plan);
    case 131: return gstr2(loader, plan);
    case 162: return tdsReport(loader, plan);
    case 156: return dailyTransaction(loader, plan);
    case 152: return target(loader, plan);
    case 31: return stockVoucher(loader, plan);
    case 32: return interestCalculation(loader, plan);
    case 135: return bookwise(loader, plan);
    case 18: return taxSummary(loader, plan);
    case 21: return outstandingClearance(loader, plan);
    case 29: return stockSummary(loader, plan);
    case 42: return budget(loader, plan);
    case 93: return stockMovement(loader, plan);
    case 109: return fundFlow(loader, plan);
    case 119: return checklistInvoice(loader, plan);
    case 120: return checklistDaybook(loader, plan);
    case 258: return monthlyClosingStock(loader, plan);
    case 11: return challanSummary(loader, plan);
    case 19: return challanPendingSummary(loader, plan);
    case 20: return orderPendingSummary(loader, plan);
    case 12: return orderRegisterSummary(loader, plan);
    case 76: return orderSetoff(loader, plan);
    case 159: return jobSetoff(loader, plan);
    case 121: return checklistInventory(loader, plan);
    case 124: return stockClearance(loader, plan);
    case 297: case 298: return addonStockSummary(loader, plan);
    case 25: return marketingFormats(loader, plan);
    case 49: return challanSetoff(loader, plan);
    case 157: return partyAddonPriceList(loader, plan);
    case 282: return expensePartyRate(loader, plan);
    case 292: return partyProductAddonPriceList(loader, plan);
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
      group[0].balance_amount = maxOf(nonZero);
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
      pushAll(head, made);
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

// ======================================================================================
// FORM SUMMARY FORMATS (14)
// ======================================================================================

/**
 * SP_FRT_RPT_FORM_SUMM's SQL, apart from the database (so it can be tested on its own): the summed
 * amount columns, the select / group / order of its two formats, and the SGST / UTGST clean-up.
 * PostgreSQL; the procedure's SQL Server original is quoted where it differs.
 */
export type AmountColumns = { bnet: string; btax: string; cnnet: string; cntax: string; rnet: string; rtax: string; totnet: string; tottax: string; totfin: string };

const ALIASES: readonly (readonly [keyof AmountColumns, string])[] = [
  ["bnet", "B_NET"], ["btax", "B_TAX"], ["cnnet", "CN_NET"], ["cntax", "CN_TAX"], ["rnet", "R_NET"], ["rtax", "R_TAX"], ["totnet", "TOT_NET"], ["tottax", "TOT_TAX"], ["totfin", "TOT_FIN"],
];

/** @varFixCols: SUM(column) AS "B_NET" , ... for each amount column the book has (each followed by " ,"). */
export const sumColumns = (columns: AmountColumns): string => ALIASES.map(([key, alias]) => (columns[key] !== "" ? `SUM(${columns[key]}) AS "${alias}" ,` : "")).join("");

/** CHARINDEX('16',@var_select_key5) or CHARINDEX('11', ...): anywhere in the keys, as the desktop reads it (no comma). */
export const readsReturnAccounts = (keys: readonly string[]): boolean => { const joined = `,${keys.join(",")},`; return joined.includes("16") || joined.includes("11"); };

export type FormatParts = { select: string; groupBy: string; orderBy: string };

/**
 * SM_SUMMARY (Details, summarized taxes): a row for each voucher and tax line, with its date, voucher
 * and account. SUMMARY (Summary For Period Selected): a row for each tax line for the whole period.
 * `place` is the TAX_PLACE a slab line without a tax takes (the last place + 1, or 101).
 */
export function formatParts(format: string, slabKey: string, place: string, amounts: string): FormatParts | null {
  const inSlab = `LEDEXT.SLAB_ID in (${slabKey})`;
  const taxPlace = `CASE WHEN ${inSlab} THEN TAX.TAX_PLACE ELSE ${place} END AS "TAX_PLACE"`;
  const taxPlaceDesc = `CASE WHEN ${inSlab} THEN IDOPT.OPT_DESC ELSE 'SLABS' END AS "TAX_PLACE_DESC"`;
  const taxShort = `CASE WHEN ${inSlab} THEN TAX.TAX_SHORT ELSE 'USER' END AS "TAX_SHORT"`;
  const taxDesc = `CASE WHEN ${inSlab} THEN TAX.TAX_DESC ELSE SLAB.SLAB_REPOHD END AS "TAX_DESC"`;
  if (format === "SM_SUMMARY") {
    return {
      select: `to_char(LED.DOC_DATE,'YYYYMMDD') AS "SORTING_DATE",to_char(LED.DOC_DATE,'DD/MM/YYYY') AS "SELECTED_DATE",LED.FULL_DOCNO,AC.NAME,${amounts}${taxShort},${taxDesc},${taxPlaceDesc},${taxPlace},SLAB.SLAB_ORDER,SLAB.SLAB_KEY`,
      groupBy: "IDOPT.OPT_DESC,TAX.TAX_PLACE,SLAB.SLAB_ORDER,LEDEXT.SLAB_ID,TAX.TAX_SHORT,TAX.TAX_DESC,SLAB.SLAB_REPOHD,LED.DOC_DATE,LED.DOC_NO,LED.FULL_DOCNO,AC.NAME,SLAB.SLAB_KEY",
      orderBy: "SLAB.SLAB_ORDER,TAX_PLACE,LED.DOC_DATE,LED.DOC_NO,IDOPT.OPT_DESC,TAX_SHORT,TAX.TAX_DESC,AC.NAME",
    };
  }
  if (format === "SUMMARY") {
    return {
      select: `${taxPlace},${taxPlaceDesc},${taxShort},${taxDesc},${amounts.replace(/ ,$/, "")}`,
      groupBy: "SLAB.SLAB_ORDER,LEDEXT.SLAB_ID,TAX.TAX_PLACE,IDOPT.OPT_DESC,TAX.TAX_SHORT,SLAB.SLAB_REPOHD,TAX.TAX_DESC",
      orderBy: "SLAB.SLAB_ORDER,TAX.TAX_PLACE,IDOPT.OPT_DESC,TAX_SHORT,TAX.TAX_DESC",
    };
  }
  return null;
}

/**
 * The SGST / UTGST lines carry their tax only: TOT_NET 0 and TOT_FIN = TOT_TAX, and (unless cash and
 * credit memos are combined) the book, cash and return nets 0 too, for the columns the table has.
 * Book 9 (cash sale) has no cash-memo column, so only B_NET and R_NET.
 */
export function taxOnlyColumns(book: number, combined: boolean, has: (column: string) => boolean): string[] {
  if (combined) return [];
  if (book !== 9) return has("CN_NET") || has("R_NET") ? ["B_NET", "CN_NET", "R_NET"].filter(has) : [];
  return has("R_NET") ? ["B_NET", "R_NET"].filter(has) : [];
}

/**
 * SP_FRT_RPT_FORM_SUMM (REPORT > Register > Form Summary, report 14, with a format): the Form Summary's
 * tax lines summed. "Details (Summarized Taxes)" (SM_SUMMARY) gives a row a voucher and tax line,
 * "Summary For Period Selected" (SUMMARY) a row a tax line for the whole period. The amount columns are
 * the standard report's (SP_FOMSUMM_COLS); see formSummary in reportStandard.ts.
 *
 * Read as the desktop does: a return account is looked for as "16" or "11" anywhere in the ticked keys
 * (no comma, no CHK_CRCASCOM test), unlike the standard report. The opposite book of the amounts is read
 * as the standard report reads it, with ",10".
 */
export async function formSummaryFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const book = call.fcValue;
  const against = call.againstBook;
  const combined = call.showNarration;
  const groupKeys = call.firstHelpKeys.filter((key) => /^\d+$/.test(key));
  if (groupKeys.length === 0) throw new ReportRefusal("Minimum One Account Should Be Selected To Generate Report", "No Selections Done!");
  const key5 = `,${groupKeys.join(",")},`;
  const keys = groupKeys.join(",");

  const oppBook = key5.includes(",16") || key5.includes(",11") || key5.includes(",10")
    ? ([8, 9].includes(book) ? "16" : [13, 14].includes(book) ? "11" : book === 15 ? "10" : "") : "";
  const inBook = book === 8 ? "8,9" : book === 13 ? "13,14" : book === 15 ? "10,15" : [11, 16].includes(book) ? String(against) : `'${book}'`;

  // The tax slabs of the period for the book (TMP_SLAB).
  const slabBook = [11, 16].includes(book) ? String(against) : book === 10 ? "15" : String(book);
  const slabRows = (await runReportSql(loader, frag(`SELECT slab_key FROM ${db}SLAB_MASTER WHERE SLAB_ACTIVE = 'Y' AND SLAB_MASTER = 'Y' AND BOOK = ${slabBook} and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' and SLAB_UPTODT = '${desktopDate(call.tarikh2)}' ORDER BY SLAB_ORDER`))).rows;
  if (slabRows.length === 0) throw new ReportRefusal("No tax slab is set for this book and year (Internal program failure).", "Internal program failure");
  const slabKey = slabRows.map((row) => `'${num(row.slab_key)}'`).join(",");
  const lastPlace = num((await runReportSql(loader, `SELECT MAX(IDOPT_KEY) AS m FROM ${db}IDOPT_MASTER WHERE IDOPT_FLAG = 'TP'`)).rows[0]?.m);

  // SP_FOMSUMM_COLS: the amount columns (as formSummary builds them).
  const signed = (column: string) => (oppBook !== "" ? `(CASE WHEN LED.BOOK = ${oppBook} THEN (LEDEXT.${column} * -1) ELSE LEDEXT.${column} END)` : `LEDEXT.${column}`);
  const net = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN (${signed("S_LASTOT")} - ${signed("SLAB_AMT")}) ELSE ${signed("SLAB_AMT")} END)`;
  const tax = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN ${signed("SLAB_AMT")} ELSE 0.00 END)`;
  const fin = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN ${signed("S_LASTOT")} ELSE ${signed("SLAB_AMT")} END)`;
  const forBooks = (books: string) => (column: string) => `CASE WHEN LED.BOOK ${books} THEN ${column} ELSE 0.00 END`;
  const cashBooks = book === 8 ? "IN (9,11)" : book === 13 ? "IN (14,16)" : book === 15 ? "IN (10)" : "";
  const returnBook = [8, 9].includes(book) ? "16" : [13, 14].includes(book) ? "11" : book === 15 ? "10" : "";
  const columns: AmountColumns = {
    bnet: combined ? "" : forBooks(`= ${book}`)(net), btax: combined ? "" : forBooks(`= ${book}`)(tax),
    cnnet: combined || cashBooks === "" ? "" : forBooks(cashBooks)(net), cntax: combined || cashBooks === "" ? "" : forBooks(cashBooks)(tax),
    rnet: combined || oppBook === "" || returnBook === "" ? "" : forBooks(`= ${returnBook}`)(net), rtax: combined || oppBook === "" || returnBook === "" ? "" : forBooks(`= ${returnBook}`)(tax),
    totnet: net, tottax: tax, totfin: fin,
  };

  const parts = formatParts(call.formating, slabKey, lastPlace !== 0 ? String(lastPlace + 1) : "101", sumColumns(columns));
  if (!parts) throw new ReportRefusal("Internal program failure\nQuery Was Blank", "INTERNAL PROGRAM FAILURE");

  let where = call.where;
  if (readsReturnAccounts(groupKeys)) where += ` AND (LED.BOOK_CODE IN (${keys}) OR LED.AG_BKCODE IN (${keys})) AND (LED.BOOK IN (${inBook}) OR LED.AG_BOOK IN (${inBook}))`;
  else where += ` AND (LED.BOOK_CODE IN (${keys})) AND (LED.BOOK IN (${inBook}))`;
  where += ` AND ((CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) AND TAX.TAX_DESC IS NULL THEN 'sys.remove' ELSE TAX.TAX_DESC END) <> 'sys.remove' OR LEDEXT.SLAB_ID not in (${slabKey}))`;
  where += ` AND SLAB.SLAB_ORDER >= (SELECT SM.SLAB_ORDER FROM ${db}SLAB_MASTER SM WHERE SM.SLAB_KEY in (${slabKey}) LIMIT 1)`;
  where += ` AND LED.DOC_DATE BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}'`;

  // TAX_MASTER.TAX_TYPE is text in this schema: the join to IDOPT_MASTER needs it as a number.
  const from = call.from_.split("TAX.TAX_TYPE").join("nullif(TAX.TAX_TYPE,'')::int");
  const result = await runReportSql(loader, frag(`SELECT IDOP.OPT_DESC,${parts.select} ${from} ${where} GROUP BY IDOP.OPT_DESC,${parts.groupBy} ORDER BY ${parts.orderBy}`));
  const table = tableFromResult(result);
  for (const column of ["B_NET", "B_TAX", "CN_NET", "CN_TAX", "R_NET", "R_TAX", "TOT_NET", "TOT_TAX", "TOT_FIN"]) if (table.has(column)) table.setKind(column, "decimal");

  // SGST / UTGST lines carry their tax only.
  const zeroed = taxOnlyColumns(book, check("CHK_CRCASCOM"), (column) => table.has(column));
  for (const row of table.rows) {
    const place = toText(table.get(row, "OPT_DESC")).toUpperCase();
    if (place !== "SGST" && place !== "UTGST") continue;
    for (const column of zeroed) table.set(row, column, 0);
    table.set(row, "TOT_NET", 0);
    table.set(row, "TOT_FIN", table.get(row, "TOT_TAX"));
  }
  sortRows(table, [(row) => textKey(table.get(row, "TAX_PLACE_DESC"))]);
  return table;
}

// ======================================================================================
// 157: PARTY ADDON PRICE LIST (SP_FRT_RPT_PARTY_ADDON_PRICELST, format None)
// ======================================================================================
//
// INVENTORY > Master > Party Addon Price List: a party's rates by product addon value (PARTY_RATE lines with no product, PR_PARASELECT
// 'S'; the addon is pr_aonfiel1 / pr_aonsub1): party, addon value, W.E.F. from and upto (dd-Mon-yy) and the rate, by party, addon and
// newest date first. The first combo's W.E.F. range keeps the lines of exactly that range (ALL: every line); the ticked accounts, if any.

async function partyAddonPriceList(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  let where = call.where.split("|sys.yearid|").join(call.yearId);
  if (call.fcText.toUpperCase() !== "ALL") {
    const caption = `(CASE WHEN PR_WEFROM IS NOT NULL AND PR_WEUPTO IS NOT NULL THEN TO_CHAR(PR_WEFROM, 'DD/MM/YYYY') || ' TO ' || TO_CHAR(PR_WEUPTO, 'DD/MM/YYYY') WHEN PR_WEFROM IS NOT NULL THEN 'FROM ' || TO_CHAR(PR_WEFROM, 'DD/MM/YYYY') WHEN PR_WEUPTO IS NOT NULL THEN 'UPTO ' || TO_CHAR(PR_WEUPTO, 'DD/MM/YYYY') ELSE 'NONE' END)`;
    const range = (await runReportSql(loader, `SELECT DISTINCT to_char(PR_WEFROM, 'YYYY-MM-DD') AS wefrom, to_char(PR_WEUPTO, 'YYYY-MM-DD') AS weupto FROM ${db}PARTY_RATE WHERE PR_POS <> 'D' AND PR_PRODID IS NULL AND PR_PARASELECT = 'S' AND ${caption} = $1`, [call.fcText])).rows.at(-1);
    if (range?.wefrom) where += ` AND prate.PR_WEFROM = '${toText(range.wefrom)}'`;
    if (range?.weupto) where += ` AND prate.PR_WEUPTO = '${toText(range.weupto)}'`;
  }
  if (call.selectKey[4] !== "") where += ` AND prate.PR_ACCODE in ${call.selectKey[4]}`;
  const sql = `SELECT ac.name AS "NAME", asub.sub_name AS "ADDON_NAME", to_char(prate.pr_wefrom, 'DD-Mon-YY') AS "FROM_DATE", to_char(prate.pr_weupto, 'DD-Mon-YY') AS "UPTO_DATE",`
    + ` round(prate.pr_rate, 2)::numeric(18,2) AS "RATE" ${call.from_} ${where} ORDER BY ac.name, asub.sub_name, prate.PR_WEFROM desc`;
  return tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
}

// ======================================================================================
// 282: EXPENSE PARTY WISE RATE (SP_FRT_RPT_EXP_PARTYWISE_RATE_REP, format None)
// ======================================================================================
//
// INVENTORY > Master > Expense Party Wise Rate: the purchase side's (PR_ADDLESS 'A') special rates of products for parties (PARTY_RATE,
// PR_PARASELECT 'S', active, rate above zero): Name, Description, From Date, Upto Date (dd-Mon-yy), Rate and its unit, by party, product
// and newest date first; the ticked accounts only. The dates of the screen are not used by the procedure.

async function expensePartyRate(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  let sql = `SELECT ac.NAME AS "NAME", product.PROD_DESC AS "DESCRIPTION", to_char(partyrate.pr_wefrom, 'DD-Mon-YY') AS "FROM_DATE", to_char(partyrate.pr_weupto, 'DD-Mon-YY') AS "UPTO_DATE",`
    + ` round(partyrate.PR_RATE, 2)::numeric(20,2) AS "RATE", prduom.uom_desc AS "UOM"`
    + ` FROM ${db}PARTY_RATE partyrate left join ${db}ACCOUNT ac on ac.code=partyrate.pr_accode left join ${db}PRODUCT_MASTER product on product.prod_key=partyrate.pr_prodid left join ${db}PROD_UOM prduom on prduom.uom_key=partyrate.pr_ruom`
    + ` where ac.a_pos<>'D' and product.prod_pos<>'D' and partyrate.pr_addless='A' and partyrate.pr_paraselect='S' and partyrate.pr_pos='A' and coalesce(partyrate.PR_RATE,0) > 0`;
  if (call.selectKey[4] !== "") sql += ` and partyrate.pr_accode in ${call.selectKey[4]}`;
  sql += " order by ac.name, product.PROD_DESC, partyrate.pr_wefrom desc";
  return tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
}

// ======================================================================================
// 292: PARTY PRODUCT ADDON PRICE LIST (SP_FRT_RPT_PARTY_PRODUCT_ADDON_PRICELST, format None)
// ======================================================================================
//
// INVENTORY > Master > Party Product Addon Price List: the rates and discounts set for a party addon value (Grade, PR_AONSUB) and a
// product addon value (Product Group, PR_AONSUB1): Grade, Product Group, From Date, Upto Date (dd-Mon-yy), Rate, Discount, by grade,
// product group and newest date first. Lines with a rate or a discount; the first combo's W.E.F. range keeps exactly that range (ALL:
// every line); the ticked grades (the addon group), if any.

async function partyProductAddonPriceList(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  let sql = `SELECT asub.sub_name AS "GRADE", asub1.sub_name AS "PRODUCT_GROUP", to_char(prate.pr_wefrom, 'DD-Mon-YY') AS "FROM_DATE", to_char(prate.pr_weupto, 'DD-Mon-YY') AS "UPTO_DATE",`
    + ` round(coalesce(prate.pr_rate,0), 2)::numeric(18,2) AS "RATE", round(coalesce(prate.pr_slabperc,0), 2)::numeric(18,2) AS "DISCOUNT"`
    + ` from ${db}PARTY_RATE prate left join ${db}ADDON_SUB asub on asub.SUB_CODE=prate.PR_AONSUB left join ${db}ADDON_SUB asub1 on asub1.SUB_CODE=prate.PR_AONSUB1`
    + ` where prate.PR_POS <> 'D' and (coalesce(prate.pr_rate,0) > 0 or coalesce(prate.pr_slabperc,0) > 0) and asub.sub_pos<>'D' and asub1.sub_pos<>'D'`;
  if (call.fcText.toUpperCase() !== "ALL") {
    const caption = `(CASE WHEN PR_WEFROM IS NOT NULL AND PR_WEUPTO IS NOT NULL THEN TO_CHAR(PR_WEFROM, 'DD/MM/YYYY') || ' TO ' || TO_CHAR(PR_WEUPTO, 'DD/MM/YYYY') WHEN PR_WEFROM IS NOT NULL THEN 'FROM ' || TO_CHAR(PR_WEFROM, 'DD/MM/YYYY') WHEN PR_WEUPTO IS NOT NULL THEN 'UPTO ' || TO_CHAR(PR_WEUPTO, 'DD/MM/YYYY') ELSE 'NONE' END)`;
    const range = (await runReportSql(loader, `SELECT DISTINCT to_char(PR_WEFROM, 'YYYY-MM-DD') AS wefrom, to_char(PR_WEUPTO, 'YYYY-MM-DD') AS weupto FROM ${db}PARTY_RATE`
      + ` WHERE PR_POS <> 'D' AND PR_AONSUB > 0 AND PR_AONSUB1 > 0 AND pr_paraselect = 'S' AND PR_WEFROM IS NOT NULL AND (PR_SLABPERC > 0 OR PR_RATE > 0) AND ${caption} = $1`, [call.fcText])).rows.at(-1);
    if (range?.wefrom) sql += ` AND prate.PR_WEFROM = '${toText(range.wefrom)}'`;
    if (range?.weupto) sql += ` AND prate.PR_WEUPTO = '${toText(range.weupto)}'`;
  }
  if (call.selectKey[0] !== "") sql += ` and prate.PR_AONSUB in ${call.selectKey[0]}`;
  sql += " ORDER BY asub.sub_name, asub1.sub_name, prate.PR_WEFROM desc";
  return tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
}

// ======================================================================================
// 11: CHALLAN REGISTER, Summary For Period Selected (SP_FRT_RPT_CHALLAN_REG)
// ======================================================================================
//
// A line per challan of the period (the challans and their lines as in the Detail, challanFrom in reportStandard.ts): date (dd-Mon-yy),
// challan no., party, and its lines added up: quantity, bundles (when the setup's entry_para has COL_BUNDLE), factor, value, the balance
// (quantity less what was set against it) and the closed quantity. By the ticked addons, then the challan number and date.

async function challanSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  if (call.formating.toUpperCase() !== "SUMMARY") throw new ReportRefusal("UNKNOWN FORMATING FILTER\nError No : 507.1\nInternal Program Failure", "Report Generation Failed");
  const entryPara = toText((await runReportSql(loader, `SELECT entry_para FROM ${db}SETUP LIMIT 1`)).rows[0]?.entry_para);
  const bundle = entryPara.toUpperCase().includes("COL_BUNDLE,");
  const ticked = call.selectKey.slice(0, 4).map((keys, index) => (keys !== "" && call.addon[index].trim() !== "" ? call.addon[index].trim() : "")).filter(Boolean);
  const addonSelect = ticked.flatMap((column, index) => [`${column} AS "${column.replace(/^\w+\.txt_/i, "").toUpperCase()}"`, `${column} AS "SMART_SELECTED_ADDON${index + 1}"`]);
  const fromSql = await challanFrom(loader, plan, true, []);
  const select = [`to_char(TCR1.P_DATE, 'DD-Mon-YY') AS "SELECTED_DATE"`, `TCR1.FULL_DOCNO`, `AC.NAME`, `COALESCE(SUM(TCR2.QUANTITY),0.00) AS "QUANTITY"`,
    ...(bundle ? [`COALESCE(SUM(TCR2.BUNDLE),0.00) AS "BUNDLE"`] : []), `COALESCE(SUM(TCR2.FACTOR),0.00) AS "FACTOR"`, `coalesce(SUM(TCR2.IL_VALUE),0.00) AS "IL_VALUE"`,
    `coalesce(SUM(TCR2.QUANTITY - TCR2.AG_QTY),0.00) AS "EBALQTY"`, `COALESCE(SUM(TCR2.SETOF_QTY),0.00) AS "CLOSED_QTY"`, `TCR1.DOC_NO2`, ...addonSelect];
  const where = call.where.trim().toLowerCase() === "where" ? "" : call.where;
  const sql = `SELECT ${select.join(", ")} ${fromSql} ${where} GROUP BY ${[...ticked, "TCR1.P_DATE", "TCR1.FULL_DOCNO", "TCR1.DOC_NO2", "AC.NAME"].join(", ")}`
    + ` ORDER BY ${[...ticked, "TCR1.DOC_NO2", "TCR1.P_DATE"].join(", ")}`;
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  if (!plan.hidden.includes("DOC_NO2")) plan.hidden.push("DOC_NO2");
  return table;
}

// ======================================================================================
// 19: CHALLAN PENDING, Summary For Period Selected (SP_FRT_RPT_CHALLAN_PENDING_REG)
// ======================================================================================
//
// A line per challan with pending lines (pendingChallanFrom in reportStandard.ts): date, challan no., party, and its pending lines added
// up (quantity, bundles when entry_para has COL_BUNDLE, factor, value, balance). By the ticked addons, then date and challan no.

async function challanPendingSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  if (call.formating.toUpperCase() !== "SUMMARY") throw new ReportRefusal("UNKNOWN FORMATING FILTER\nError No : 507.1\nInternal Program Failure", "Report Generation Failed");
  const entryPara = toText((await runReportSql(loader, `SELECT entry_para FROM ${db}SETUP LIMIT 1`)).rows[0]?.entry_para);
  const bundle = entryPara.toUpperCase().includes("COL_BUNDLE,");
  const ticked = call.selectKey.slice(0, 4).map((keys, index) => (keys !== "" && call.addon[index].trim() !== "" ? call.addon[index].trim() : "")).filter(Boolean);
  const addonSelect = ticked.flatMap((column, index) => [`${column} AS "${column.replace(/^\w+\.txt_/i, "").toUpperCase()}"`, `${column} AS "SMART_SELECTED_ADDON${index + 1}"`]);
  const fromSql = await pendingChallanFrom(loader, plan, true);
  const select = [`to_char(TCR1.P_DATE, 'DD-Mon-YY') AS "SELECTED_DATE"`, `TCR1.FULL_DOCNO`, `AC.NAME AS "NAME"`, `coalesce(SUM(TCR2.QUANTITY),0.00) AS "QUANTITY"`,
    ...(bundle ? [`coalesce(SUM(TCR2.BUNDLE),0.00) AS "BUNDLE"`] : []), `coalesce(SUM(TCR2.FACTOR),0.00) AS "FACTOR"`, `coalesce(SUM(TCR2.IL_VALUE),0.00) AS "IL_VALUE"`,
    `coalesce(SUM(TCR2.QUANTITY - TCR2.AG_QTY),0.00) AS "EBALQTY"`, ...addonSelect];
  const where = call.where.trim().toLowerCase() === "where" ? "" : call.where;
  const sql = `SELECT ${select.join(", ")} ${fromSql} ${where} GROUP BY ${[...ticked, "TCR1.P_DATE", "TCR1.FULL_DOCNO", "AC.NAME"].join(", ")}`
    + ` ORDER BY ${[...ticked, "TCR1.P_DATE", "TCR1.FULL_DOCNO"].join(", ")}`;
  return tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
}

// ======================================================================================
// 49: CHALLAN SETOFF (SP_REPORT_FORMATING, "CHALLAN SETOFF REPORT", format Detail)
// ======================================================================================
//
// INVENTORY > Challan > Setoff: each challan's product lines of the period (a line per challan and product, Sr_No by challan) with the
// invoice they were billed in. The procedure fills a challan table and an invoice table (the book's lines with no challan) and walks
// PROD_LINK (challan led_rec1, invoice led_rec2) with two cursors: for each link, every invoice line of the same product writes its
// date, number and party on the challan line and adds its quantity (as a whole number, the procedure's INT) to BILL_QTY. Here the
// same in memory. With "LINK_PARTY_CHG," in the setup's entry_para the invoices and links are not narrowed to the ticked accounts.
// Licence 21 keeps the challans with no party (as the Challan Register and Pending).

async function challanSetoff(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const run = async (sql: string) => (await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema))).rows;
  const linkPartyChange = toText((await runReportSql(loader, `SELECT entry_para FROM ${db}SETUP LIMIT 1`)).rows[0]?.entry_para).toUpperCase().includes("LINK_PARTY_CHG,");
  const from = `'${desktopDate(call.from)}'`;
  const upto = `'${desktopDate(call.upto)}'`;
  const book = call.book === 8 ? 8 : 13;
  const accounts = call.selectKey[4];
  const anyParty = call.licence === 21;

  // The challans' lines, by challan and product.
  const challans = await run(`SELECT ROW_NUMBER() over (order by a.process_id) AS "Sr_No", a.process_id AS "PROCESS_ID", to_char(a.il_date, 'DD-Mon-YY') AS "CHLN_DATE", a.full_docno AS "CHLN_NO",`
    + ` b.name AS "CHLN_NAME", c.prod_desc AS "CHLN_DESC", SUM(a.quantity) AS "CHLN_QTY", to_char(a.il_date, 'YYYYMMDD') AS "SORTING_DATE"`
    + ` FROM ${db}PROD_LEDGER a ${anyParty ? "left" : "inner"} join ${db}ACCOUNT b on a.CODE=b.Code join ${db}PRODUCT_MASTER c on a.PROD_ID=c.PROD_KEY`
    + ` WHERE a.il_date BETWEEN ${from} AND ${upto} and a.il_pos='A' AND a.YEAR_ID = '${call.yearId}' and btrim(a.trn_stkmid)='CH'${accounts !== "" ? ` and a.code in ${accounts}` : ""} AND a.book=${book}`
    + ` GROUP BY a.process_id, a.il_date, a.full_docno, b.name, a.doc_no1, c.prod_desc ORDER BY a.doc_no1, "Sr_No"`);
  // The invoices' lines (the book's lines with no challan), by invoice and product.
  const narrow = accounts !== "" && !linkPartyChange;
  const bills = await run(`SELECT a.led_id AS "LED_ID", to_char(a.il_date, 'DD-Mon-YY') AS "BILL_DATE", a.full_docno AS "BILL_NO", b.name AS "NAME", c.prod_desc AS "BILL_DESC", SUM(a.quantity) AS "BILL_QTY"`
    + ` FROM ${db}PROD_LEDGER a join ${db}ACCOUNT b on a.CODE=b.Code join ${db}PRODUCT_MASTER c on a.PROD_ID=c.PROD_KEY`
    + ` WHERE a.il_date BETWEEN ${from} AND ${upto} and a.il_pos='A' AND a.YEAR_ID = '${call.yearId}' and a.process_id is null${narrow ? ` and a.code in ${accounts}` : ""} AND a.book=${book}`
    + ` GROUP BY a.led_id, a.il_date, a.full_docno, b.name, a.doc_no1, c.prod_desc ORDER BY a.doc_no1`);
  // The links of the period's lines: the procedure joins PROD_LEDGER on "challan or invoice" (an OR join, 12 s over the year's
  // ledger); its two halves joined apart and put together give the same (challan, invoice, product) set in well under a second.
  const linkHalf = (match: string) => `SELECT prodlink.led_rec1 AS "REC1", prodlink.led_rec2 AS "REC2", prodmas.prod_desc AS "DESC" FROM ${db}PROD_LINK prodlink`
    + ` join ${db}PROD_LEDGER prodled on ${match} join ${db}PRODUCT_MASTER prodmas on prodled.prod_id = prodmas.prod_key`
    + ` WHERE prodled.il_date BETWEEN ${from} AND ${upto}${narrow ? ` and prodled.code in ${accounts}` : ""}`;
  const links = await run(`${linkHalf("prodled.PROCESS_ID = prodlink.led_rec1")} UNION ${linkHalf("prodled.LED_ID = prodlink.led_rec2")} ORDER BY 1, 2, 3`);

  const table = new ResultTable();
  for (const column of ["Sr_No", "PROCESS_ID", "CHLN_DATE", "CHLN_NO", "CHLN_NAME", "CHLN_DESC", "CHLN_QTY", "BILL_DATE", "INV_NO", "BILL_NAME", "BILL_QTY", "SORTING_DATE"]) table.addColumn(column);
  table.setKind("CHLN_QTY", "decimal");
  table.setKind("BILL_QTY", "decimal");
  const rowsOf = new Map<string, ResultRow[]>();
  for (const challan of challans) {
    const row = table.insert({ ...challan, BILL_DATE: "", INV_NO: "", BILL_NAME: "", BILL_QTY: 0 });
    const key = `${toText(challan.PROCESS_ID)}|${toText(challan.CHLN_DESC)}`;
    rowsOf.set(key, [...(rowsOf.get(key) ?? []), row]);
  }
  const billsOf = new Map<string, ResultRow[]>();
  for (const bill of bills) {
    const key = `${toText(bill.LED_ID)}|${toText(bill.BILL_DESC)}`;
    billsOf.set(key, [...(billsOf.get(key) ?? []), bill]);
  }
  for (const link of links) {
    const rec1 = num(link.REC1);
    const rec2 = num(link.REC2);
    if (rec1 === 0 || rec2 === 0) continue;
    const desc = toText(link.DESC);
    for (const bill of billsOf.get(`${rec2}|${desc}`) ?? []) {
      for (const row of rowsOf.get(`${rec1}|${desc}`) ?? []) {
        table.set(row, "BILL_DATE", toText(bill.BILL_DATE));
        table.set(row, "INV_NO", toText(bill.BILL_NO));
        table.set(row, "BILL_NAME", toText(bill.NAME));
        table.set(row, "BILL_QTY", num(table.get(row, "BILL_QTY")) + Math.trunc(num(bill.BILL_QTY)));
      }
    }
  }
  return table;
}

// ======================================================================================
// 20: ORDER PENDING, Summary For Period Selected (SP_FRT_RPT_PEND_ORDER_REG)
// ======================================================================================
//
// The pending order lines (orderPendingWhere in reportStandard.ts) added up by what the groups ticked: Account alone a line per order
// (order no., party), Product alone a line per product, both a line per party and product, none a line per order with its date; quantity,
// billed, balance, rate and value added up (licence 21 PURCHASE: boxes, packing, loose and the boxes pending instead of the billed).
// Ticked addons come first, with their columns.

async function orderPendingSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  if (call.formating.toUpperCase() !== "SUMMARY") throw new ReportRefusal("UNKNOWN FORMATING FILTER\nError No : 507.1\nInternal Program Failure", "Report Generation Failed");
  const db = call.database;
  const groupBy = call.groupBy.trim().toUpperCase();
  const grouping = groupBy === "" ? "N" : groupBy === "AC.NAME" ? "A" : groupBy === "PRODUCT.PROD_SHORT" ? "P" : "B";
  const boxes = call.licence === 21 && call.fcValue === 1;
  const ticked = call.selectKey.slice(0, 4).map((keys, index) => (keys !== "" && call.addon[index].trim() !== "" ? call.addon[index].trim() : "")).filter(Boolean);
  const addonSelect = ticked.flatMap((column, index) => [`${column} AS "${column.replace(/^\w+\.txt_/i, "").toUpperCase()}"`, `${column} AS "SMART_SELECTED_ADDON${index + 1}"`]);
  const godown = call.addon.some((text) => text.toUpperCase().includes("GODOWN"));
  const from = orderPendingFrom(plan, godown ? ` left join ${db}ADDON_IENTRY aentry on aentry.AONI_IL_ID=prodled.IL_KEY` : "");
  const where = await orderPendingWhere(loader, plan, false, false);
  const quantities = boxes
    ? [`SUM(prodled.BUNDLE) AS "BOX"`, `prodled.PACK_QTY AS "PACKING"`, `SUM(prodled.LOOSE_QTY) AS "LOOSE"`, `SUM(prodled.QUANTITY) AS "QUANTITY"`, `SUM(prodled.BUNDLE) - SUM(prodled.AG_PACK) as "BAL_BOX"`, `SUM(prodled.QUANTITY) - SUM(prodled.AG_QTY) as "BAL_QTY"`]
    : [`SUM(prodled.QUANTITY) AS "QUANTITY"`, `SUM(prodled.AG_QTY) AS "AG_QTY"`, `SUM(prodled.QUANTITY) - SUM(prodled.AG_QTY) as "BAL_QTY"`];
  const values = [`SUM(prodled.RATE) AS "RATE"`, `SUM(prodled.IL_VALUE) AS "IL_VALUE"`];
  const pack = boxes ? ["prodled.PACK_QTY"] : [];
  let head: string[];
  let group: string[];
  let order: string[];
  if (grouping === "A") {
    head = ["prodled.DOC_NO1", "prodled.FULL_DOCNO", "AC.NAME", ...quantities, ...values];
    group = [...ticked, "AC.NAME", "prodled.DOC_NO1", "prodled.FULL_DOCNO", ...pack];
    order = [...ticked, "AC.NAME", "prodled.DOC_NO1", "prodled.FULL_DOCNO"];
  } else if (grouping === "P") {
    head = ["product.PROD_SHORT", `product.PROD_DESC AS "SELECTED_PRODUCT"`, ...quantities];
    group = [...ticked, "product.PROD_SHORT", "product.PROD_DESC", ...pack];
    order = [...ticked, "product.PROD_SHORT", "product.PROD_DESC"];
  } else if (grouping === "B") {
    head = ["AC.NAME", `product.PROD_DESC AS "SELECTED_PRODUCT"`, ...quantities, ...values];
    if (ticked.length > 0) {
      group = ["AC.NAME", ...ticked, "product.PROD_SHORT", "product.PROD_DESC", ...pack];
      order = [...ticked, "product.PROD_SHORT", "product.PROD_DESC"];
    } else {
      group = ["AC.NAME", call.groupBy.replace(/product\.PROD_SHORT/gi, "product.PROD_DESC"), ...pack];
      order = [call.orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").replace(/product\.PROD_SHORT/gi, "product.PROD_DESC")];
    }
  } else {
    head = ["prodled.DOC_NO1", "prodled.FULL_DOCNO", `to_char(prodled.IL_DATE::date, 'DD-Mon-YY') as "SELECTED_DATE"`, "AC.NAME", ...quantities, ...values];
    group = [...ticked, "prodled.DOC_NO1", "prodled.FULL_DOCNO", "prodled.IL_DATE::date", "AC.NAME", ...pack];
    order = [...ticked, "prodled.DOC_NO1", "prodled.FULL_DOCNO", "prodled.IL_DATE::date", "AC.NAME"];
  }
  const sql = `SELECT ${[...head, ...addonSelect].join(", ")} ${from} ${where} GROUP BY ${group.join(", ")} ORDER BY ${order.filter((part) => part.trim() !== "").join(", ")}`;
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  const docNo = table.name("DOC_NO1");
  if (docNo !== undefined) table.numberKinds.delete(docNo);
  return table;
}

// ======================================================================================
// 12: ORDER REGISTER, Summary For Period Selected (SP_FRT_RPT_ORDER_REG)
// ======================================================================================
//
// Every order line of the period (billed or not) added up by the groups ticked, as the Order Pending's summary: Account alone a line per
// order, Product alone a line per product, both a line per party and product, none a line per order with its date; quantity, billed,
// balance, closed, rate and value (licence 2 also the bundles). Not ported: licence 14's layout (per order, with its addresses).

async function orderRegisterSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  if (call.formating.toUpperCase() !== "SUMMARY") throw new ReportRefusal("UNKNOWN FORMATING FILTER\nError No : 507.1\nInternal Program Failure", "Report Generation Failed");
  if (call.licence === 14) throw new ReportRefusal("Licence 14's summary of the Order Register is not available in the web version yet.", "Not ported yet");
  const db = call.database;
  const groupBy = call.groupBy.trim().toUpperCase();
  const grouping = groupBy === "" ? "N" : groupBy === "AC.NAME" ? "A" : groupBy === "PRODUCT.PROD_SHORT" ? "P" : "B";
  const bundle = call.licence === 2 ? [`SUM(prodled.BUNDLE) AS "Bundle"`] : [];
  const ticked = call.selectKey.slice(0, 4).map((keys, index) => (keys !== "" && call.addon[index].trim() !== "" ? call.addon[index].trim() : "")).filter(Boolean);
  const addonSelect = ticked.flatMap((column, index) => [`${column} AS "${column.replace(/^\w+\.txt_/i, "").toUpperCase()}"`, `${column} AS "SMART_SELECTED_ADDON${index + 1}"`]);
  const godown = call.addon.some((text) => text.toUpperCase().includes("GODOWN"));
  const acEntry = call.acAddonRepdefa.includes("E");
  const prodEntry = call.prodAddonRepdefa.includes("E");
  const itemEntry = (alias: string) => ` left join ${db}ADDON_IENTRY ${alias} on ${alias}.AONI_IL_ID=prodled.IL_KEY`;
  const voucherEntry = (alias: string) => ` left join ${db}ADDON_AENTRY ${alias} on ${alias}.AONA_PROCESSID=prodled.PROCESS_ID`;
  const joins = godown ? (acEntry && prodEntry ? itemEntry("aientry") + voucherEntry("aentry") : acEntry ? voucherEntry("aentry") : itemEntry("aientry"))
    : acEntry ? voucherEntry("aentry") + voucherEntry("aentry1") : prodEntry ? itemEntry("aientry") : "";
  const from = orderPendingFrom(plan, joins);
  const where = await orderPendingWhere(loader, plan, call.checkQuery.includes("CHK_JOBORD,"), false, false);
  const quantities = [`SUM(prodled.QUANTITY) AS "QUANTITY"`, `SUM(prodled.AG_QTY) AS "AG_QTY"`, `SUM(prodled.QUANTITY) - SUM(prodled.AG_QTY) as "BAL_QTY"`, `SUM(prodled.SETOF_QTY) AS "CLOSED_QTY"`];
  const values = [`SUM(prodled.RATE) AS "RATE"`, `SUM(prodled.IL_VALUE) AS "IL_VALUE"`];
  let head: string[];
  let group: string[];
  let order: string[];
  if (grouping === "A") {
    head = ["prodled.DOC_NO1", "prodled.FULL_DOCNO", "AC.NAME", `SUM(prodled.QUANTITY) AS "QUANTITY"`, ...bundle, ...values];
    group = [...ticked, "AC.NAME", "prodled.DOC_NO1", "prodled.FULL_DOCNO"];
    order = [...ticked, "AC.NAME", "prodled.DOC_NO1", "prodled.FULL_DOCNO"];
  } else if (grouping === "P") {
    head = ["product.PROD_SHORT", `product.PROD_DESC AS "SELECTED_PRODUCT"`, ...bundle, ...quantities];
    group = [...ticked, "product.PROD_SHORT", "product.PROD_DESC"];
    order = [...ticked, "product.PROD_SHORT", "product.PROD_DESC"];
  } else if (grouping === "B") {
    head = ["AC.NAME", `product.PROD_DESC AS "SELECTED_PRODUCT"`, ...bundle, ...quantities, ...values];
    if (ticked.length > 0) {
      group = ["AC.NAME", ...ticked, "product.PROD_SHORT", "product.PROD_DESC"];
      order = [...ticked, "product.PROD_SHORT", "product.PROD_DESC"];
    } else {
      group = ["AC.NAME", call.groupBy.replace(/product\.PROD_SHORT/gi, "product.PROD_DESC")];
      order = [call.orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").replace(/product\.PROD_SHORT/gi, "product.PROD_DESC")];
    }
  } else {
    head = ["prodled.DOC_NO1", "prodled.FULL_DOCNO", `to_char(prodled.IL_DATE::date, 'DD-Mon-YY') as "SELECTED_DATE"`, "AC.NAME", ...quantities, ...values];
    group = [...ticked, "prodled.DOC_NO1", "prodled.FULL_DOCNO", "prodled.IL_DATE::date", "AC.NAME"];
    order = [...ticked, "prodled.DOC_NO1", "prodled.FULL_DOCNO", "prodled.IL_DATE::date", "AC.NAME"];
  }
  const sql = `SELECT ${[...head, ...addonSelect].join(", ")} ${from} ${where} GROUP BY ${group.join(", ")} ORDER BY ${order.filter((part) => part.trim() !== "").join(", ")}`;
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  const docNo = table.name("DOC_NO1");
  if (docNo !== undefined) table.numberKinds.delete(docNo);
  return table;
}

// ======================================================================================
// 76: ORDER SETOFF (SP_REPORT_FORMATING, "ORDER SETOFF REPORT", format Detail)
// ======================================================================================
//
// INVENTORY > Order > Order Setoff: each order line of the period with the invoices billed against it (PROD_LINK: order line iled_rec1,
// invoice line iled_rec2), one row per invoice line (an order line not billed: one row, no invoice). The order's quantity and value are
// running totals of its product on the order up to the line's date; the balance is that less all the quantity billed against the order
// and product (RunningTotalIssues) and the closed quantity. Delay days: from the delivery date (licence 21; others the order date) to the
// bill date, or to the Upto date while not billed. An order and product's second and later rows show no order quantity, value or
// balance (licence 21 also no packing), so they add up once. Licence 21 adds delivery date, product group, packing and closed value; its
// SALE side also the party's order number (ADDON_AENTRY input_ORDNO, the orders without one are left out, as the procedure's join).
// With LINK_PARTY_CHG, in entry_para the invoices are not narrowed to the ticked accounts.

async function orderSetoff(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const lic21 = call.licence === 21;
  const sale = call.book === 8;
  const linkPartyChange = toText((await runReportSql(loader, `SELECT entry_para FROM ${db}SETUP LIMIT 1`)).rows[0]?.entry_para).toUpperCase().includes("LINK_PARTY_CHG,");
  const accounts = call.selectKey[4];
  const from = desktopDate(call.from);
  const upto = desktopDate(call.upto);
  const orders = `SELECT ROW_NUMBER() over (order by a.process_id) AS "Sr_No", a.process_id, a.il_date AS ord_day, d.post_date AS delivery_day, to_char(a.il_date, 'DD-Mon-YY') AS "ORD_DATE",`
    + (lic21 ? ` to_char(d.post_date, 'DD-Mon-YY') AS "DELIVERY_DATE",` : "")
    + ` a.full_docno AS "ORD_NO",${lic21 && sale ? ` aent.input_ORDNO AS "PARTY_ORD_NO",` : ""} b.name AS "ORD_NAME", c.prod_desc AS "ORD_DESC",`
    + (lic21 ? ` e.txt_PRODGROUP AS "Product_Group", c.base_pack AS "PACKING",` : "")
    + ` a.rate AS "Order_Rate", a.SETOF_QTY AS "CLOSED_QTY",${lic21 ? ` (a.rate*a.SETOF_QTY) AS "CLOSED_AMT",` : ""} a.CLOSE_REMARK AS "CLOSE_REMARK",`
    + ` to_char(a.il_date, 'YYYYMMDD') || ' ' || a.FULL_DOCNO AS "SORTING_DATE",`
    + ` SUM(a.QUANTITY) OVER (PARTITION BY a.full_docno, b.name, c.prod_key ORDER BY a.il_date) AS "ORD_QTY", SUM(a.IL_VALUE) OVER (PARTITION BY a.full_docno, b.name, c.prod_key ORDER BY a.il_date) AS "Amount", a.il_key`
    + ` FROM ${db}PROD_LEDGER a join ${db}ACCOUNT b on a.CODE=b.Code join ${db}PRODUCT_MASTER c on a.PROD_ID=c.PROD_KEY join ${db}PROCESS d on a.process_id=d.process_key join ${db}ADDON_DATA e on e.prod_id=a.prod_id`
    + (lic21 && sale ? ` join ${db}ADDON_AENTRY aent on d.process_key=aent.aona_processid` : "")
    + ` WHERE a.il_date BETWEEN '${from}' AND '${upto}' and a.il_pos='A' and c.prod_pos='A'${accounts !== "" ? ` and a.code in ${accounts}` : ""}`
    + (sale ? ` and btrim(a.trn_module)='ORD-OUT'` : ` and btrim(a.trn_module) in ('ORD-PURCH','ORD-IN')`);
  const bills = `SELECT a.il_date AS bill_day, to_char(a.il_date, 'DD-Mon-YY') AS "BILL_DATE", a.full_docno AS "BILL_NO", b.name AS "NAME", a.quantity AS "BILL_QTY", a.rate AS "BILL_RATE", a.il_value AS "BILL_AMT",`
    + ` SUM(a.Quantity) OVER (PARTITION BY a.order_no, c.prod_key) AS "RunningTotalIssues", d.iled_rec1`
    + ` FROM ${db}PROD_LEDGER a join ${db}ACCOUNT b on a.CODE=b.Code join ${db}PRODUCT_MASTER c on a.PROD_ID=c.PROD_KEY join ${db}prod_link d on a.il_key=d.iled_rec2`
    + ` WHERE a.il_date <= '${upto}' and a.il_pos='A' and c.prod_pos='A' and a.process_id is null AND a.book=${sale ? 8 : 13}${accounts !== "" && !linkPartyChange ? ` and a.code in ${accounts}` : ""}`;
  const rows = (await runReportSql(loader, pgFragment(`WITH sc AS (${orders}), tc AS (${bills}) SELECT sc.*, tc.bill_day, tc."BILL_DATE", tc."BILL_NO", tc."NAME" AS "BILL_NAME", tc."BILL_QTY", tc."BILL_RATE", tc."BILL_AMT", tc."RunningTotalIssues"`
    + ` FROM sc left join tc on coalesce(sc.il_key,0) = coalesce(tc.iled_rec1,0) ORDER BY sc."SORTING_DATE", sc.il_key`, plan, loader.session.companySchema))).rows;

  const columns = ["ORD_DATE", ...(lic21 ? ["DELIVERY_DATE"] : []), "ORD_NO", ...(lic21 && sale ? ["PARTY_ORD_NO"] : []), "ORD_NAME", "ORD_DESC", ...(lic21 ? ["Product_Group", "PACKING"] : []), "Order_Rate", "ORD_QTY", "Amount",
    "BILL_DATE", "Delay_Days", "BILL_NO", "BILL_NAME", "BILL_QTY", "BILL_RATE", "BILL_AMT", "CLOSED_QTY", ...(lic21 ? ["CLOSED_AMT"] : []), "CLOSE_REMARK", "SORTING_DATE", "BAL_QTY", "BAL_AMT"];
  const table = new ResultTable();
  for (const column of columns) table.addColumn(column);
  for (const column of ["PACKING", "Order_Rate", "ORD_QTY", "Amount", "BILL_QTY", "BILL_RATE", "BILL_AMT", "CLOSED_QTY", "CLOSED_AMT", "BAL_QTY", "BAL_AMT"]) if (columns.includes(column)) table.setKind(column, "decimal");
  const day = 86400000;
  const dayOf = (value: unknown) => { const date = value instanceof Date ? value : value ? new Date(String(value)) : null; return date && !Number.isNaN(date.getTime()) ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) : null; };
  const uptoDay = Date.UTC(call.upto.getFullYear(), call.upto.getMonth(), call.upto.getDate());
  const seen = new Set<string>();
  for (const row of rows) {
    const values: Record<string, unknown> = {};
    for (const column of columns) values[column] = row[column] ?? row[column.toLowerCase()];
    values.BILL_DATE = toText(row.BILL_DATE);
    values.BILL_NO = toText(row.BILL_NO);
    values.BILL_NAME = toText(row.BILL_NAME);
    values.BILL_QTY = num(row.BILL_QTY);
    values.BILL_RATE = num(row.BILL_RATE);
    values.BILL_AMT = num(row.BILL_AMT);
    const balance = num(row.ORD_QTY) - (num(row.RunningTotalIssues) + num(row.CLOSED_QTY));
    values.BAL_QTY = balance;
    values.BAL_AMT = Math.round(balance * num(row.Order_Rate) * 10000) / 10000;
    // Delay days: from the delivery date (licence 21) or the order date to the bill date, or to the Upto date while not billed.
    const start = dayOf(lic21 ? row.delivery_day : row.ord_day);
    const end = values.BILL_DATE !== "" ? dayOf(row.bill_day) : uptoDay;
    values.Delay_Days = start !== null && end !== null ? String(Math.round((end - start) / day)) : null;
    const key = `${toText(row.ORD_NO)}|${toText(row.ORD_DESC)}`;
    if (seen.has(key)) {
      values.ORD_QTY = 0;
      values.BAL_QTY = 0;
      values.BAL_AMT = 0;
      if (lic21) { values.PACKING = 0; values.Amount = 0; }
    }
    seen.add(key);
    table.insert(values);
  }
  return table;
}

// ======================================================================================
// 159: JOB SETOFF (SP_FRT_RPT_RPI_JOB_SETOFF, format None)
// ======================================================================================
//
// INVENTORY > Order > Job Setoff, by the first combo:
//  - ANNEXTURE: the job work issued (JOB-OUT lines, stock out) with what came back against them (JOB-IN lines of the year, matched on the
//    order number and the product): issue date, no., job card, party, product, issued quantity (running, per issue and product), rate,
//    unit, receipt date, no. and challan, received quantity, balance, set-off (closed) quantity and remark;
//  - JOB WORK ORDER: the job work orders (JO, stock in) with their receipts the same way (entry date / no., the receipt's bill date / no.);
//  - EXPENSE BILL: the expense bills (IB lines) with the job receipts (JOB-IN) their order number names, one row per bill and receipt.
// The procedure's temp table, cursor and updates are done in memory: rows numbered per issue (sr_no), the balance on each issue and
// product's last row (its quantity less all received and set off against it; ANNEXTURE's very last row also less its own set-off, as the
// cursor), the issue's quantity, set-off, unit and remark on its first row only, and no balance where it was all received or set off.
// The procedure's last ANNEXTURE update (balance from the opening issue lines) compares a dd-Mon-yy text with a dd/MMM/yyyy one and so
// never changes a row; it is left out.

async function jobSetoff(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const mode = call.fcText.trim().toUpperCase();
  const accounts = call.selectKey[4];
  const from = desktopDate(call.from);
  const upto = desktopDate(call.upto);
  const yearStart = desktopDate(call.tarikh1);
  const codeIn = (alias: string) => (accounts !== "" ? ` and ${alias}.code in ${accounts}` : "");
  const run = async (sql: string) => (await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema))).rows;
  const table = new ResultTable();

  if (mode === "EXPENSE BILL") {
    const rows = await run(`WITH sc AS (SELECT ROW_NUMBER() over (order by e.led_key) AS sr, to_char(e.doc_date, 'DD-Mon-YY') AS "EXP_BILL_DATE", e.full_docno AS "EXP_BILL_NO", b.name AS "NAME", e.amount::numeric AS "EXP_AMT",`
      + ` to_char(e.doc_date, 'YYYYMMDD') || ' ' || e.full_docno AS "SORTING_DATE", a.order_no`
      + ` FROM ${db}PROD_LEDGER a join ${db}ACCOUNT b on a.CODE=b.Code join ${db}PRODUCT_MASTER c on a.PROD_ID=c.PROD_KEY join ${db}PROD_UOM d on d.UOM_KEY=a.UOMENTRY_ID join ${db}LEDGER e on a.led_id=e.led_key`
      + ` WHERE e.doc_date BETWEEN '${from}' AND '${upto}' and e.doc_pos<>'D' and a.il_pos='A' and c.prod_pos='A' and a.stock_nat='A' AND e.YEAR_ID = '${call.yearId}' and btrim(a.trn_stkmid)='IB' and a.quantity>0${codeIn("a")}),`
      + ` tc AS (SELECT to_char(a.p_date, 'DD-Mon-YY') AS "BILL_DATE", a.full_docno AS "BILL_NO" FROM ${db}PROCESS a join ${db}ACCOUNT b on a.CODE=b.Code`
      + ` WHERE a.p_date BETWEEN '${from}' AND '${upto}' and a.il_pos='A' AND a.YEAR_ID = '${call.yearId}' and btrim(a.stk_module)='JOB-IN'${codeIn("a")})`
      + ` SELECT sc.*, tc."BILL_DATE" AS "JOB_IN_DATE", tc."BILL_NO" AS "JOB_IN_NO" FROM sc left join tc on coalesce(sc.order_no,'') = coalesce(tc."BILL_NO",'') ORDER BY sc.sr, tc."BILL_NO"`);
    for (const column of ["Sr_No", "EXP_BILL_DATE", "EXP_BILL_NO", "NAME", "EXP_AMT", "JOB_IN_DATE", "JOB_IN_NO", "SORTING_DATE"]) table.addColumn(column);
    table.setKind("EXP_AMT", "decimal");
    // One row per bill and receipt, numbered within the bill; the bill's own columns on its first row only.
    const pairs = new Set<string>();
    const perBill = new Map<string, number>();
    const kept = rows.filter((row) => { const key = `${toText(row.EXP_BILL_NO)}|${toText(row.JOB_IN_NO)}`; if (pairs.has(key)) return false; pairs.add(key); return true; });
    for (const row of kept) {
      const bill = toText(row.EXP_BILL_NO);
      const serial = (perBill.get(bill) ?? 0) + 1;
      perBill.set(bill, serial);
      table.insert({ Sr_No: serial, EXP_BILL_DATE: serial === 1 ? row.EXP_BILL_DATE : null, EXP_BILL_NO: serial === 1 ? row.EXP_BILL_NO : "", NAME: serial === 1 ? row.NAME : "", EXP_AMT: serial === 1 ? num(row.EXP_AMT) : 0,
        JOB_IN_DATE: toText(row.JOB_IN_DATE), JOB_IN_NO: toText(row.JOB_IN_NO), SORTING_DATE: row.SORTING_DATE });
    }
    sortRows(table, [(row) => textKey(table.get(row, "SORTING_DATE"))]);
    return table;
  }

  const order = mode === "JOB WORK ORDER";
  const desc = order ? "JIN_DESC" : "JOUT_DESC";
  const qty = order ? "JIN_QTY" : "JOUT_QTY";
  const issues = order
    ? `SELECT ROW_NUMBER() over (order by a.il_date, a.full_docno) AS sr, to_char(a.il_date, 'DD-Mon-YY') AS "JOUT_DATE", a.full_docno AS "JOUT_NO", e.input_PJOBCARD AS "Job_Card_No", b.name AS "NAME", c.prod_desc AS "${desc}", d.UOM_SHORT AS "UOM",`
      + ` to_char(a.il_date, 'YYYYMMDD') || ' ' || a.full_docno || ' ' || c.prod_desc AS "SORTING_DATE", coalesce(a.setof_qty,0) AS close_qty, a.Close_remark AS "CLOSE_REMARK", 0 AS cost_setof, NULL::numeric AS "RATE",`
      + ` SUM(a.QUANTITY) OVER (PARTITION BY a.full_docno, b.name, c.prod_key ORDER BY a.il_date) AS "${qty}"`
      + ` FROM ${db}PROD_LEDGER a join ${db}ACCOUNT b on a.CODE=b.Code join ${db}PRODUCT_MASTER c on a.PROD_ID=c.PROD_KEY join ${db}PROD_UOM d on d.UOM_KEY=a.UOMENTRY_ID join ${db}ADDON_IENTRY e on e.aoni_il_id=a.il_key`
      + ` WHERE a.il_date BETWEEN '${from}' AND '${upto}' and a.il_pos='A' and c.prod_pos='A' and a.stock_nat='A' and btrim(a.trn_stkmid)='JO' and a.quantity>0${codeIn("a")}`
    : `SELECT ROW_NUMBER() over (order by a.process_id) AS sr, to_char(a.il_date, 'DD-Mon-YY') AS "JOUT_DATE", a.full_docno AS "JOUT_NO", e.input_PJOBCARD AS "Job_Card_No", b.name AS "NAME", c.prod_desc AS "${desc}", round(a.Rate::numeric, 2) AS "RATE", d.UOM_SHORT AS "UOM",`
      + ` to_char(a.il_date, 'YYYYMMDD') || ' ' || a.full_docno || ' ' || c.prod_desc AS "SORTING_DATE", coalesce(a.cost_rate,0) AS cost_setof, coalesce(a.setof_qty,0) AS close_qty, a.Close_remark AS "CLOSE_REMARK",`
      + ` SUM(a.QUANTITY) OVER (PARTITION BY a.full_docno, b.name, c.prod_key ORDER BY a.il_date) AS "${qty}"`
      + ` FROM ${db}PROD_LEDGER a join ${db}ACCOUNT b on a.CODE=b.Code join ${db}PRODUCT_MASTER c on a.PROD_ID=c.PROD_KEY join ${db}PROD_UOM d on d.UOM_KEY=a.UOMENTRY_ID join ${db}ADDON_IENTRY e on e.aoni_il_id=a.il_key`
      + ` WHERE a.il_date BETWEEN '${from}' AND '${upto}' and a.il_pos='A' and c.prod_pos='A' and a.stock_nat='L' AND a.YEAR_ID = '${call.yearId}' and btrim(a.trn_stkmid)='JO' and a.quantity>0${codeIn("a")}`;
  const receipts = `SELECT a.il_key AS bill_key, ${order ? `to_char(a.il_date, 'DD-Mon-YY') AS "ENTRY_DATE", d.full_docno AS "ENTRY_NO", to_char(d.post_date, 'DD-Mon-YY') AS "BILL_DATE", btrim(d.entry_no) AS "BILL_NO",`
      : `to_char(a.il_date, 'DD-Mon-YY') AS "BILL_DATE", d.full_docno AS "BILL_NO", btrim(d.entry_no) AS "CHALLAN_NO",`}`
    + ` c.prod_desc AS "BILL_DESC", a.quantity AS "BILL_QTY", a.order_no, coalesce(a.COST_RATE,0) AS bill_setof, SUM(a.Quantity + a.COST_RATE) OVER (PARTITION BY a.order_no, c.prod_key) AS issued`
    + ` FROM ${db}PROD_LEDGER a join ${db}ACCOUNT b on a.CODE=b.Code join ${db}PRODUCT_MASTER c on a.PROD_ID=c.PROD_KEY join ${db}PROCESS d on a.process_id=d.process_key join ${db}ADDON_IENTRY e on e.aoni_il_id=a.il_key`
    + ` WHERE a.il_date BETWEEN '${yearStart}' AND '${upto}' and a.il_pos='A' and c.prod_pos='A' and a.stock_nat='${order ? "A" : "L"}'${order ? "" : ` AND d.YEAR_ID = '${call.yearId}'`} and btrim(a.trn_module)='JOB-IN' and a.quantity>0${codeIn("a")}`;
  const rows = await run(`WITH sc AS (${issues}), tc AS (${receipts}) SELECT sc.*, tc.* FROM sc left join tc on coalesce(sc."JOUT_NO",'') = coalesce(tc.order_no,'') and coalesce(sc."${desc}",'') = coalesce(tc."BILL_DESC",'') ORDER BY sc.sr, tc.bill_key`);

  type Line = { values: Record<string, unknown>; sr: number; consumed: number; first: number };
  const lines: Line[] = rows.map((row, index) => {
    const setoffOfLine = order
      ? (num(row.bill_setof) > 0 ? num(row.bill_setof) : num(row.close_qty) > 0 ? num(row.close_qty) : 0)
      : (num(row.cost_setof) > 0 && num(row.close_qty) === 0 ? num(row.cost_setof) : num(row.close_qty) > 0 && num(row.cost_setof) > 0 ? num(row.close_qty) + num(row.cost_setof) : num(row.cost_setof) === 0 && num(row.close_qty) > 0 ? num(row.close_qty) : 0);
    const consumed = order
      ? (num(row.bill_setof) === 0 ? num(row.issued) + num(row.close_qty) : num(row.issued))
      : (num(row.close_qty) > 0 ? num(row.issued) + num(row.close_qty) : num(row.issued));
    const values: Record<string, unknown> = {
      JOUT_DATE: row.JOUT_DATE, JOUT_NO: row.JOUT_NO, Job_Card_No: row.Job_Card_No, NAME: row.NAME, [desc]: row[desc], [qty]: num(row[qty]), ...(order ? {} : { RATE: num(row.RATE) }), UOM: row.UOM,
      ...(order ? { ENTRY_DATE: toText(row.ENTRY_DATE), ENTRY_NO: toText(row.ENTRY_NO), BILL_DATE: toText(row.BILL_DATE), INV_NO: toText(row.BILL_NO) }
        : { BILL_DATE: toText(row.BILL_DATE), JOB_IN_NO: toText(row.BILL_NO), CHALLAN_NO: toText(row.CHALLAN_NO) }),
      BILL_QTY: num(row.BILL_QTY), BAL_QTY: 0, SETOF_QTY: setoffOfLine, CLOSE_REMARK: toText(row.CLOSE_REMARK), SORTING_DATE: row.SORTING_DATE,
    };
    return { values, sr: num(row.sr) * 100000 + index, consumed, first: 0 };
  });
  // sr_no within the issue (JOUT_NO), in the issue lines' order.
  const serialIn = (key: (line: Line) => string, sorted: Line[]) => { const count = new Map<string, number>(); for (const line of sorted) { const k = key(line); count.set(k, (count.get(k) ?? 0) + 1); line.first = count.get(k)!; } };
  const bySr = [...lines].sort((a, b) => a.sr - b.sr);
  serialIn((line) => toText(line.values.JOUT_NO), bySr);
  // The balance on the last row of each issue and product (the cursor, in SORTING_DATE then sr_no order).
  const walk = [...lines].sort((a, b) => sqlServerCompare(toText(a.values.SORTING_DATE), toText(b.values.SORTING_DATE)) || a.first - b.first);
  let previous: Line | null = null;
  let issuedQty = 0;
  let consumed = 0;
  let lastLess = 0;
  for (const line of walk) {
    if (previous && toText(previous.values.SORTING_DATE) !== toText(line.values.SORTING_DATE)) {
      const balance = issuedQty - consumed;
      if (balance !== 0) previous.values.BAL_QTY = Math.round(balance * 10000) / 10000;
      consumed = 0;
    }
    consumed = line.consumed;
    issuedQty = num(line.values[qty]);
    lastLess = issuedQty - num(line.values.SETOF_QTY);
    previous = line;
  }
  if (previous) {
    const balance = (order ? issuedQty : lastLess) - consumed;
    if (balance !== 0) previous.values.BAL_QTY = Math.round(balance * 10000) / 10000;
  }
  // sr_no within the issue, date and product (the row number shown); a later row shows no issued quantity, unit or remark (ANNEXTURE:
  // no set-off either); JOB WORK ORDER's sorting carries the number.
  serialIn((line) => `${toText(line.values.JOUT_NO)}|${toText(line.values.JOUT_DATE)}|${toText(line.values[desc])}`, [...lines].sort((a, b) => a.first - b.first || num(a.values[qty]) - num(b.values[qty]) || a.sr - b.sr));
  for (const line of lines) {
    const v = line.values;
    if (order) v.SORTING_DATE = `${toText(v.SORTING_DATE)} ${line.first}`;
    if (line.first !== 1) { v[qty] = 0; v.UOM = ""; v.CLOSE_REMARK = ""; if (!order) v.SETOF_QTY = 0; }
    if ((order ? toText(v.ENTRY_NO) : toText(v.JOB_IN_NO)) === "") v.BILL_QTY = 0;
    const setoff = num(v.SETOF_QTY);
    if (order) {
      if (num(v[qty]) === setoff && setoff > 0) v.BAL_QTY = 0;
      if (num(v[qty]) - (num(v.BILL_QTY) + setoff) === 0) v.BAL_QTY = 0;
    } else if ((num(v[qty]) === setoff || num(v[qty]) - (num(v.BILL_QTY) + setoff) === 0) && setoff > 0) v.BAL_QTY = 0;
  }
  const columns = ["sr_no", "JOUT_DATE", "JOUT_NO", "Job_Card_No", "NAME", desc, qty, ...(order ? [] : ["RATE"]), "UOM", ...(order ? ["ENTRY_DATE", "ENTRY_NO", "BILL_DATE", "INV_NO"] : ["BILL_DATE", "JOB_IN_NO", "CHALLAN_NO"]),
    "BILL_QTY", "BAL_QTY", "SETOF_QTY", "CLOSE_REMARK", "SORTING_DATE"];
  for (const column of columns) table.addColumn(column);
  for (const column of [qty, "RATE", "BILL_QTY", "BAL_QTY", "SETOF_QTY"]) if (columns.includes(column)) table.setKind(column, "decimal");
  for (const line of [...lines].sort((a, b) => sqlServerCompare(toText(a.values.SORTING_DATE), toText(b.values.SORTING_DATE)) || a.first - b.first || a.sr - b.sr)) table.insert({ sr_no: line.first, ...line.values });
  return table;
}

// ======================================================================================
// 121: CHECKLIST INVENTORY (SP_FRT_RPT_CHECKLIST_INVENTORY, format None)
// ======================================================================================
//
// INVENTORY > Checklist Inventory: the product lines of the period of the book account chosen in the first combo (its lines, or the
// lines of its book with no book account), or of every book (ALL: also a BOOK column, the voucher book or the book account). Per line:
// product code, description, HSN, date, voucher no., challan no., party, the quantities (licence 2: bundle, packing, kg; licence 21:
// packing, box, loose, MRP; others: factor, master rate), unit, rate and its unit, amount; for one book also its product slabs of the
// year (each slab's amount on the line and the tax slabs' tax), the book's item entry addons, and the product master addons. Ordered by
// date, challan no., voucher no. Not ported: licence 71's layouts (store and mill companies).

async function checklistInventory(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const lic = call.licence;
  if (lic === 71) throw new ReportRefusal("Licence 71's layouts of the Checklist Inventory are not available in the web version yet.", "Not ported yet");
  const book = call.book;
  const slabBook = book === 16 ? 8 : book === 11 ? 13 : book;
  const run = async (sql: string, params: unknown[] = []) => (await runReportSql(loader, sql, params)).rows;
  const columnsOf = async (table: string) => new Set((await run(`SELECT lower(column_name) AS name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [db.replace(/\.$/, "").toLowerCase(), table])).map((row) => toText(row.name)));

  // The book's product slabs of the year: each one's amount on the line, a tax slab also its tax (SGST / UTGST: TAX_DESC1). The procedure
  // looks each one up per line (a subquery per slab and line: 45 s for a year's sale); here the period's LEDGER_EXT rows of those slabs
  // are grouped by line once and joined (lx), the same values.
  const slabColumns: string[] = [];
  const slabParts: string[] = [];
  const slabKeys: number[] = [];
  if (book > 0) {
    const slabs = await run(`SELECT SLAB_KEY AS key, btrim(SLAB_SHORT) AS short, btrim(coalesce(SLAB_MASTER,'')) AS master FROM ${db}SLAB_MASTER WHERE SLAB_FROMDT = $1 AND coalesce(SLAB_ACTIVE,'')<>'N' AND SLAB_POS='P' and BOOK = $2 ORDER BY SLAB_ORDER`, [call.tarikh1, slabBook]);
    const taken = new Set<string>();
    for (const slab of slabs) {
      const key = num(slab.key);
      const short = toText(slab.short).replace(/"/g, "");
      slabKeys.push(key);
      if (toText(slab.master) === "Y") {
        const taxColumn = short === "SGST" || short === "UTGST" ? "TAX_DESC1" : "TAX_DESC";
        if (!taken.has(taxColumn)) { slabParts.push(`min(case when LEDEXT.SLAB_ID = ${key} then TAXMST.TAX_DESC end) AS t${key}`); slabColumns.push(`lx.t${key} AS "${taxColumn}"`); }
        taken.add(taxColumn);
      }
      if (!taken.has(short.toUpperCase())) { slabParts.push(`min(case when LEDEXT.SLAB_ID = ${key} then LEDEXT.SLAB_AMT::numeric end) AS a${key}`); slabColumns.push(`lx.a${key} AS "${short}"`); }
      taken.add(short.toUpperCase());
    }
  }
  // The item entry addons (of the book, for one book) and the product master addons; a field with no column is left out.
  const entryFields = await run(`SELECT btrim(FIEL_SAVE) AS save, btrim(FIEL_TYPE) AS type FROM ${db}ADDON_FLD WHERE fiel_relate='P' and fiel_entrypos='P' and fiel_pos<>'D'${book > 0 ? ` and position($1 in coalesce(fiel_inbook,'')) > 0` : ""} ORDER BY fiel_key`, book > 0 ? [`${slabBook},`] : []);
  const masterFields = await run(`SELECT btrim(FIEL_SAVE) AS save, btrim(FIEL_TYPE) AS type FROM ${db}ADDON_FLD WHERE fiel_relate='P' and fiel_masterpos='Y' and fiel_entrypos='N' and fiel_pos<>'D' ORDER BY fiel_key`);
  const ientry = await columnsOf("addon_ientry");
  const adata = await columnsOf("addon_data");
  const addonColumn = (alias: string, have: Set<string>, field: ResultRow) => {
    const save = toText(field.save);
    const column = `${toText(field.type) === "M" ? "txt" : "input"}_${save}`.toLowerCase();
    return /^\w+$/.test(save) && have.has(column) ? `${alias}.${column} AS "${save}"` : "";
  };
  const entryColumns = entryFields.map((field) => addonColumn("AENT", ientry, field)).filter(Boolean);
  const masterColumns = masterFields.map((field) => addonColumn("adata", adata, field)).filter(Boolean);

  const head = `prodmas.prod_short as "PROD_CODE", prodmas.prod_desc as "DESCRIPTION", prodmas.HSN_CODE as "HSN_CODE", to_char(prodled.il_date, 'DD-Mon-YY') as "DATE", prodled.full_docno, prodled.doc_no1 as "CHALLAN_NO", ac.name,`;
  const quantities = lic === 2
    ? `prodled.bundle as "BUNDLE", prodled.pack_qty as "PACKING", prodled.quantity as "QTY", produom.uom_short as "Qty_Uom", prodled.factor as "KG", prodled.rate as "RATE",`
    : lic === 21
      ? `prodled.pack_qty as "PACKING", prodled.bundle as "BOX", prodled.loose_qty as "LOOSE_QTY", prodled.quantity as "QTY", produom.uom_short as "Qty_Uom", prodled.master_rate as "MRP_RATE", prodled.rate as "RATE",`
      : `prodled.quantity as "QTY", produom.uom_short as "Qty_Uom", prodled.factor as "FACTOR", prodled.master_rate as "MASTER_RATE", prodled.rate as "RATE",`;
  const select = [`${head} ${quantities} rateuom.uom_short as "Rate_Uom", prodled.il_value as "AMOUNT"`, ...slabColumns, ...entryColumns, ...masterColumns,
    ...(book < 0 ? [`case when coalesce(prodled."TYPE",0) > 0 then bk.BOOK_DESC else ac1.name end as "BOOK"`] : [])].join(", ");
  const from = `${db}PROD_LEDGER prodled left join ${db}ACCOUNT ac on ac.code=prodled.code left join ${db}ADDON_DATA adata on adata.prod_id=prodled.prod_id left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key=prodled.prod_id`
    + ` left join ${db}PROD_UOM produom on produom.uom_key=prodled.uomentry_id left join ${db}PROD_UOM rateuom on rateuom.uom_key=prodled.rateuom_id`
    + (book < 0 ? ` left join ${db}BOOK_PROPERTIES bk on bk.book_key=prodled."TYPE" left join ${db}ACCOUNT ac1 on ac1.code=prodled.book_code` : "")
    + (entryColumns.length > 0 ? ` left join ${db}ADDON_IENTRY AENT on AENT.aoni_il_id=prodled.il_key` : "")
    + (slabParts.length > 0 ? ` left join (SELECT LEDEXT.il_id, ${slabParts.join(", ")} FROM ${db}LEDGER_EXT LEDEXT left join ${db}TAX_MASTER TAXMST on TAXMST.TAX_REC=LEDEXT.TAX_ID`
      + ` WHERE LEDEXT.SLAB_ID IN (${slabKeys.join(",")}) AND LEDEXT.il_id IN (SELECT il_key FROM ${db}PROD_LEDGER WHERE il_date BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}') GROUP BY LEDEXT.il_id) lx on lx.il_id = prodled.il_key` : "");
  const where = `prodled.il_date BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}' and prodmas.prod_pos='A' and prodled.il_pos='A'`
    + (book < 0 ? ` and prodled.inventory='Y'` : ` and ((prodled.book_code is null and prodled."TYPE"=${book}) or (prodled.book_code is not null and prodled.book_code=${Math.trunc(call.fcValue)}))`);
  const table = tableFromResult(await runReportSql(loader, pgFragment(`SELECT ${select} FROM ${from} WHERE ${where} ORDER BY prodled.il_date, prodled.doc_no1, prodled.full_docno`, plan, loader.session.companySchema)));
  const challan = table.name("CHALLAN_NO");
  if (challan !== undefined) table.numberKinds.delete(challan);
  return table;
}

// ======================================================================================
// 124: STOCK CLEARANCE (SP_FRT_RPT_STOCK_CLEARANCE, format None)
// ======================================================================================
//
// INVENTORY > Stock Clearance: for each ticked product, the stock still held from each purchase (stock in, not yet set against) up to the
// Upto date, cleared first in first out by its sales (stock out, not yet set against). The product's opening stock is a purchase of
// its own: with a previous year's company, last year's purchases (latest first) as far as the opening reaches, the rest one OPENING row
// at the year's start (a year earlier when last year had purchases). Each purchase row then shows the first sale against it, a further
// sale against the same purchase a row of its own under it (no purchase no.); CLSG_QTY is what is left of the purchase, PDays its age at
// Upto, SDays the days it waited for the sale. Quantities pass the procedure's cursors as whole numbers (factors to 2 decimals), so they
// are rounded the same way. Only Pending Purchase Bills keeps the rows with stock left; Print Ageing Column spreads it by age; Factor
// Column Require keeps the factor columns. The procedure's temp tables and cursors are done in memory.

async function stockClearance(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const products = call.selectKey[4];
  if (products === "") throw new ReportRefusal("Report Generation Failed As ...\n - Minimum One Product Should Be Selected To Generate Report", "No Selections Done!");
  const run = async (sql: string, params: unknown[] = []) => (await runReportSql(loader, pgFragment(sql, plan, session.companySchema), params)).rows;
  const whole = (value: number) => Math.sign(value) * Math.round(Math.abs(value));
  const two = (value: number) => Math.sign(value) * Math.round(Math.abs(value) * 100) / 100;
  const upto = desktopDate(call.upto);
  const uptoDay = Date.UTC(call.upto.getFullYear(), call.upto.getMonth(), call.upto.getDate());
  const dayOf = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const ddmmyyyy = (date: Date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const yyyymmdd = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const typeKey = num((await run(`SELECT BOOK_KEY AS key FROM ${db}BOOK_PROPERTIES WHERE STKM_POS = 'A' AND btrim(STKM_ID) = 'NR' ORDER BY STKMODULE`)).at(-1)?.key) || 25;
  let hideBook = true;
  if ([19, 29, 73].includes(call.licence)) hideBook = (await run(`SELECT 1 FROM ${db}ACCOUNT WHERE A_POS <> 'D' and position('CA_ENT' in A_SHORT) > 0 LIMIT 1`)).length > 0;
  const bookFilter = !hideBook ? ` and (prodled.book_code in (select code from ${db}ACCOUNT where a_pos='A') or prodled.book_code is null)` : "";
  // The addon groups ticked (product addons): their key filter, heading and group columns, and their part of the sorting.
  const addons = call.addon.map((text, index) => ({ text: text.trim(), keys: call.selectKey[index] })).filter((addon) => addon.text !== "" && addon.keys !== "");
  const addonFilter = addons.map((addon) => ` and ${addon.text.replace(/\btxt_/i, "key_")} in ${addon.keys}`).join("");
  const addonNames = addons.map((addon) => addon.text.replace(/^\w+\.txt_/i, "").toUpperCase());
  const addonCols = addons.length > 0 ? `, ${addons.map((addon, index) => `${addon.text} AS "a${index}"`).join(", ")}` : "";
  const lineSql = (nature: "A" | "L") => `SELECT btrim(prodmas.prod_short) AS prod_short, prodmas.prod_desc, prodled.il_date, prodled.full_docno, coalesce(prodled.QUANTITY-prodled.AG_QTY,0) AS qty, coalesce(prodled.TRN_QTY3,0) AS fact${addonCols}`
    + ` FROM ${db}PROD_LEDGER prodled left join ${db}PRODUCT_MASTER prodmas on prodmas.PROD_KEY=prodled.PROD_ID left join ${db}ADDON_DATA adata on prodmas.PROD_KEY=adata.PROD_ID`
    + ` WHERE prodled.IL_POS='A' and prodmas.PROD_POS='A' and prodled.INVENTORY='Y' and prodmas.INVENTORY='Y' and prodled.il_date <= '${upto}' and prodled.stock_nat='${nature}'`
    + ` and prodled.QUANTITY-prodled.AG_QTY>0 and btrim(coalesce(prodled.trn_stkmid,''))<>'GT' AND prodled."TYPE" <> ${typeKey}${bookFilter} and prodled.prod_id in ${products}${addonFilter}`
    + ` ORDER BY ${[...addons.map((addon) => addon.text), "prodmas.PROD_SHORT"].join(", ")}`;
  const purchases = await run(lineSql("A"));
  const sales = await run(lineSql("L"));
  const openings = await run(`SELECT btrim(prodmas.prod_short) AS prod_short, prodmas.prod_desc, prodbal.OPEN_PCS AS open_pcs, prodbal.OPEN_QTY1 AS open_qty1${addonCols}`
    + ` FROM ${db}PROD_BALANCE prodbal left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key=prodbal.prod_id left join ${db}ADDON_DATA adata on prodmas.PROD_KEY=adata.PROD_ID`
    + ` WHERE prodbal.prec_flag='RP' and prodbal.YEAR_ID = '${call.yearId}' and prodbal.open_pcs>0 and prodmas.prod_pos<>'D' and prodmas.inventory='Y' and prodmas.prod_key in ${products}${addonFilter} ORDER BY prodmas.PROD_SHORT`);

  type Row = { prod: string; desc: unknown; purchDay: number | null; purchDate: string; purchNo: string; purchQty: number | null; purchFact: number | null; pDays: number | null;
    saleDate: string; saleDay: number | null; saleNo: string; saleQty: number | null; saleFact: number | null; clsg: number | null; clsgFact: number | null; sorting: string; addons: unknown[]; order: number };
  const rows: Row[] = [];
  let order = 0;
  const addonValues = (row: ResultRow) => addons.map((_addon, index) => row[`a${index}`]);
  const addonSort = (values: unknown[]) => values.map((value) => `${toText(value)} `).join("");
  const purchaseRow = (prod: string, desc: unknown, date: Date, no: string, qty: number, fact: number, values: unknown[], sortingStart?: string): Row => ({
    prod, desc, purchDay: dayOf(date), purchDate: ddmmyyyy(date), purchNo: no, purchQty: qty, purchFact: fact, pDays: Math.round((uptoDay - dayOf(date)) / 86400000) + 1,
    saleDate: "", saleDay: null, saleNo: "", saleQty: 0, saleFact: 0, clsg: qty, clsgFact: fact, sorting: `${sortingStart ?? `${addonSort(values)}${prod} ${yyyymmdd(date)} ${no}`} 1`, addons: values, order: order++,
  });
  for (const line of purchases) rows.push(purchaseRow(toText(line.prod_short), line.prod_desc, line.il_date as Date, toText(line.full_docno), num(line.qty), num(line.fact), addonValues(line)));

  // The opening stock: last year's purchases first (a previous year's company), the rest one OPENING row.
  const previous = session.fromSchema && session.fromSchema !== session.companySchema ? `${session.fromSchema}.` : "";
  for (const opening of openings) {
    const prod = toText(opening.prod_short);
    const values = addonValues(opening);
    let openPcs = whole(num(opening.open_pcs));
    let openQty1 = two(num(opening.open_qty1));
    let lastYear = 0;
    if (previous !== "") {
      const earlier = await run(`SELECT prodled.il_date, coalesce(prodled.QUANTITY-prodled.AG_QTY,0) AS qty, coalesce(prodled.TRN_QTY3,0) AS fact, prodled.full_docno FROM ${previous}PRODUCT_MASTER prodmas`
        + ` left join ${previous}PROD_LEDGER prodled on prodled.prod_id=prodmas.prod_key WHERE prodled.il_pos='A' and prodled.stock_nat='A' and prodled.quantity-prodled.ag_qty>0`
        + ` and btrim(coalesce(prodled.trn_stkmid,''))<>'GT' and prodmas.inventory='Y' and prodled.inventory='Y'${!hideBook ? ` and (prodled.book_code in (select code from ${db}ACCOUNT where a_pos='A') or prodled.book_code is null)` : ""}`
        + ` AND prodled."TYPE" <> ${typeKey} and btrim(prodmas.prod_short) = $1 ORDER BY prodled.il_date desc`, [prod]);
      for (const line of earlier) {
        const lineQty = whole(num(line.qty));
        lastYear = lineQty;
        const date = line.il_date as Date;
        const sortingStart = `${addonSort(values)}${prod} ${yyyymmdd(date)} ${toText(line.full_docno)}`;
        if (openPcs > lineQty) {
          rows.push(purchaseRow(prod, opening.prod_desc, date, toText(line.full_docno), lineQty, two(num(line.fact)), values, sortingStart));
          openPcs -= lineQty;
          openQty1 = two(openQty1 - two(num(line.fact)));
        } else {
          rows.push(purchaseRow(prod, opening.prod_desc, date, toText(line.full_docno), openPcs, openQty1, values, sortingStart));
          openPcs = 0;
          openQty1 = 0;
        }
        if (openPcs <= 0) break;
      }
    }
    if (openPcs > 0) {
      const start = new Date(call.tarikh1);
      if (lastYear > 0) start.setDate(start.getDate() - 365);
      rows.push(purchaseRow(prod, opening.prod_desc, start, "OPENING", openPcs, openQty1, values, `${prod} ${yyyymmdd(start)} OPENING`));
    }
  }

  // First in, first out: each purchase (by product, date) takes the product's sales still to clear (by date).
  const salesOf = new Map<string, { day: number; date: string; no: string; qty: number; fact: number }[]>();
  for (const line of sales) {
    const prod = toText(line.prod_short);
    const date = line.il_date as Date;
    salesOf.set(prod, [...(salesOf.get(prod) ?? []), { day: dayOf(date), date: ddmmyyyy(date), no: toText(line.full_docno), qty: whole(num(line.qty)), fact: two(num(line.fact)) }]);
  }
  for (const list of salesOf.values()) list.sort((a, b) => a.day - b.day);
  const byProduct = [...rows].sort((a, b) => sqlServerCompare(a.prod, b.prod) || sqlServerCompare(toText(a.desc), toText(b.desc)) || (a.purchDay ?? 0) - (b.purchDay ?? 0) || a.order - b.order);
  for (const purchase of byProduct) {
    let pcs = whole(purchase.purchQty ?? 0);
    let fact = two(purchase.purchFact ?? 0);
    const first = pcs;
    for (const sale of salesOf.get(purchase.prod) ?? []) {
      if (sale.qty <= 0) continue;
      const takeAll = pcs >= sale.qty;
      const qty = takeAll ? sale.qty : pcs;
      const saleFact = takeAll ? sale.fact : fact;
      if (pcs === first) Object.assign(purchase, { saleDate: sale.date, saleDay: sale.day, saleNo: sale.no, saleQty: qty, saleFact });
      else rows.push({ prod: purchase.prod, desc: purchase.desc, purchDay: purchase.purchDay, purchDate: purchase.purchDate, purchNo: "", purchQty: null, purchFact: null, pDays: null,
        saleDate: sale.date, saleDay: sale.day, saleNo: sale.no, saleQty: qty, saleFact, clsg: null, clsgFact: null,
        sorting: `${purchase.prod} ${purchase.purchDay !== null ? yyyymmdd(new Date(purchase.purchDay)) : ""} ${purchase.purchNo} 2`, addons: purchase.addons, order: order++ });
      sale.qty -= Math.abs(qty);
      sale.fact = two(sale.fact - Math.abs(saleFact));
      purchase.clsg = (purchase.clsg ?? 0) - Math.abs(qty);
      purchase.clsgFact = two((purchase.clsgFact ?? 0) - Math.abs(saleFact));
      if (takeAll) { pcs -= qty; fact = two(fact - saleFact); }
      else { pcs = 0; fact = 0; }
      if (pcs <= 0) break;
    }
  }

  const factors = check("CHK_FACTCOL");
  const ageing = check("CHK_AGECOL");
  const kept = check("CHK_OS_PENDBILL") ? rows.filter((row) => (row.clsg ?? 0) !== 0) : rows;
  kept.sort((a, b) => sqlServerCompare(a.sorting, b.sorting) || a.order - b.order);
  const table = new ResultTable();
  const columns = ["PROD_SHORT", "PROD_DESC", "PURCH_DATE", "PURCH_NO", "PURCH_QTY", ...(factors ? ["PURCH_FACT"] : []), "PDays", "SALE_DATE", "SALE_NO", "SALE_QTY", ...(factors ? ["SALE_FACT"] : []), "SDays", "CLSG_QTY", ...(factors ? ["CLSG_FACT"] : []), "SORTING_COL",
    ...(ageing ? ["days_0_To_30", "days_31_To_60", "days_61_To_90", "days_91_To_180", "days_181_To_365", "days_366_And_Above"] : []), ...addonNames, ...addons.map((_addon, index) => `SMART_SELECTED_ADDON${index + 1}`)];
  for (const column of columns) table.addColumn(column);
  for (const column of ["PURCH_QTY", "PURCH_FACT", "SALE_QTY", "SALE_FACT", "CLSG_QTY", "CLSG_FACT", "days_0_To_30", "days_31_To_60", "days_61_To_90", "days_91_To_180", "days_181_To_365", "days_366_And_Above"]) if (columns.includes(column)) table.setKind(column, "decimal");
  for (const column of ["PDays", "SDays"]) table.setKind(column, "int");
  const buckets: [string, number, number][] = [["days_0_To_30", -99999, 30], ["days_31_To_60", 31, 60], ["days_61_To_90", 61, 90], ["days_91_To_180", 91, 180], ["days_181_To_365", 181, 365], ["days_366_And_Above", 366, 99999]];
  for (const row of kept) {
    const values: Record<string, unknown> = {
      PROD_SHORT: row.prod, PROD_DESC: row.desc, PURCH_DATE: row.purchNo === "" ? "" : row.purchDate, PURCH_NO: row.purchNo, PURCH_QTY: row.purchQty, PDays: row.pDays,
      SALE_DATE: row.saleDate, SALE_NO: row.saleNo, SALE_QTY: row.saleQty, SDays: row.saleDay !== null && row.purchDay !== null ? Math.round((row.saleDay - row.purchDay) / 86400000) + 1 : null,
      CLSG_QTY: row.clsg, SORTING_COL: row.sorting,
    };
    if (factors) Object.assign(values, { PURCH_FACT: row.purchFact, SALE_FACT: row.saleFact, CLSG_FACT: row.clsgFact });
    if (ageing) for (const [name, low, high] of buckets) { const age = row.pDays ?? 0; values[name] = row.clsg === null ? null : age >= low && age <= high ? row.clsg : 0; }
    addons.forEach((_addon, index) => { values[addonNames[index]] = row.addons[index]; values[`SMART_SELECTED_ADDON${index + 1}`] = row.addons[index]; });
    table.insert(values);
  }
  return table;
}

// ======================================================================================
// 297, 298: ADDON STOCK SUMMARY / ADDON SALE SUMMARY (SP_FRT_RPT_ADDON_STOCK_SUMMARY, format None)
// ======================================================================================
//
// INVENTORY > Addon Stock Summary (297) and Addon Sale Summary (298), by the product master addon chosen in the first combo (Prod Group,
// Prod Category ...): a line per addon value (SMART_LED_KEY its key, Particular its name).
//  - 297: the year's opening (PROD_BALANCE in the product's first report unit), what came in and went out from the year's start to Upto
//    (each line in that unit, less what was set against another entry; a job work receipt / issue in full) and the closing; only the
//    products whose addon value is a live addon sub; values with nothing in any column left out.
//  - 298: what was sold in the period (sale lines with a voucher, less what was set against; licence 51: the challans out, in full), each
//    product's quantity rounded to a whole number as the procedure's DECIMAL(20,0); values with no sale left out.

async function addonStockSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const field = toText((await runReportSql(loader, `SELECT btrim(FIEL_SAVE) AS save FROM ${db}ADDON_FLD WHERE FIEL_KEY = $1`, [Math.trunc(call.fcValue)])).rows.at(-1)?.save);
  if (!/^\w+$/.test(field)) throw new ReportRefusal("Choose an addon from its list", "Report Generation Failed");
  const key = `adata.key_${field.toLowerCase()}`;
  const name = `adata.txt_${field.toLowerCase()}`;
  const live = `EXISTS (SELECT 1 FROM ${db}ADDON_SUB sub WHERE sub.sub_pos <> 'D' AND sub.sub_code = ${key})`;
  const upto = desktopDate(call.upto);
  const run = async (sql: string) => (await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema))).rows;
  const table = new ResultTable();
  table.addColumn("SMART_LED_KEY");
  table.addColumn("Particular");

  if (call.reportKey === 297) {
    const typeKey = num((await run(`SELECT BOOK_KEY AS key FROM ${db}BOOK_PROPERTIES WHERE STKM_POS = 'A' AND btrim(STKM_ID) = 'NR' ORDER BY STKMODULE`)).at(-1)?.key) || 25;
    // A line in the product's first report unit, less what was set against it (in proportion), a job work line (`whole`) in full.
    const unit = (whole: string) => {
      const part = (column: string) => `case when btrim(coalesce(prodled.TRN_MODULE,''))='${whole}' then prodled.${column} else prodled.${column}-round((prodled.AG_QTY/nullif(prodled.QUANTITY,0)*prodled.${column}),4) end`;
      return `case when product.rep1_uom=product.pcs_uom then case when btrim(coalesce(prodled.TRN_MODULE,''))='${whole}' then prodled.trn_pcs else prodled.trn_pcs-prodled.ag_qty end`
        + ` when product.rep1_uom=product.qty1_uom then ${part("trn_qty1")} when product.rep1_uom=product.qty2_uom then ${part("trn_qty2")} when product.rep1_uom=product.qty3_uom then ${part("trn_qty3")}`
        + ` when product.rep1_uom=product.pack_uom then ${part("trn_pack")} when product.rep1_uom=product.weight_uom then ${part("trn_weight")}`
        + ` else case when btrim(coalesce(prodled.TRN_MODULE,''))='${whole}' then prodled.quantity else prodled.QUANTITY-prodled.ag_qty end end`;
    };
    const moved = (nature: "A" | "L", whole: string, alias: string) => `(SELECT PRODLED.prod_id, sum(case when prodled.STOCK_NAT='${nature}' then ${unit(whole)} else 0.00 end) AS qty`
      + ` FROM ${db}PRODUCT_MASTER product join ${db}PROD_LEDGER PRODLED on product.Prod_key = prodled.PROD_ID WHERE prodled."TYPE" <> ${typeKey} AND prodled.IL_DATE BETWEEN '${desktopDate(call.tarikh1)}' and '${upto}'`
      + ` AND prodled.INVENTORY='Y' and prodled.IL_POS='A' and (prodled.quantity-prodled.ag_qty>0 or btrim(coalesce(prodled.TRN_MODULE,''))='${whole}') group by PRODLED.prod_id) ${alias}`;
    const opening = `case when prodmas.rep1_uom=prodmas.pcs_uom then prodbal.OPEN_PCS when prodmas.rep1_uom=prodmas.qty1_uom then prodbal.open_qty1 when prodmas.rep1_uom=prodmas.qty2_uom then prodbal.open_qty2`
      + ` when prodmas.rep1_uom=prodmas.qty3_uom then prodbal.open_qty3 when prodmas.rep1_uom=prodmas.pack_uom then prodbal.open_pack when prodmas.rep1_uom=prodmas.weight_uom then prodbal.open_weight else prodbal.OPEN_PCS end`;
    const rows = await run(`WITH lines AS (SELECT ${key}::text AS key, ${name} AS particular, round(coalesce(sum(${opening}),0)::numeric,4) AS open_qty,`
      + ` round(coalesce(sum(addqty.qty),0)::numeric,4) AS add_qty, round(coalesce(sum(lessqty.qty),0)::numeric,4) AS less_qty`
      + ` FROM ${db}PRODUCT_MASTER prodmas left join ${db}PROD_BALANCE prodbal on prodbal.prod_id=prodmas.prod_key and prodbal.YEAR_ID='${call.yearId}' left join ${db}ADDON_DATA adata on adata.prod_id=prodmas.prod_key`
      + ` left join ${moved("A", "JOB-IN", "addqty")} on addqty.PROD_ID = prodmas.PROD_KEY left join ${moved("L", "JOB-OUT", "lessqty")} on lessqty.PROD_ID = prodmas.PROD_KEY`
      + ` WHERE prodbal.prec_flag='RP' and prodmas.PROD_POS='A' and prodmas.INVENTORY='Y' AND ${live} GROUP BY ${key}, ${name}, prodmas.prod_desc, prodmas.prod_key)`
      + ` SELECT key, particular, sum(open_qty) AS open_qty, sum(add_qty) AS add_qty, sum(less_qty) AS less_qty, sum(open_qty + add_qty - less_qty) AS clsg_qty FROM lines`
      + ` WHERE NOT (open_qty = 0 AND add_qty = 0 AND less_qty = 0 AND open_qty + add_qty - less_qty = 0) GROUP BY key, particular ORDER BY particular`);
    for (const column of ["OPEN_QTY", "ADD_QTY", "LESS_QTY", "Clsg_Qty"]) table.setKind(column, "decimal");
    for (const row of rows) table.insert({ SMART_LED_KEY: toText(row.key), Particular: row.particular, OPEN_QTY: num(row.open_qty), ADD_QTY: num(row.add_qty), LESS_QTY: num(row.less_qty), Clsg_Qty: num(row.clsg_qty) });
    return table;
  }

  const challans = call.licence === 51;
  const rows = await run(`WITH lines AS (SELECT ${key}::text AS key, ${name} AS particular, round(coalesce(sum(${challans ? "prodled.quantity" : "prodled.quantity - prodled.ag_qty"}),0)::numeric, 0) AS sale_qty`
    + ` FROM ${db}PROD_LEDGER prodled left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key = prodled.prod_id left join ${db}ADDON_DATA adata on adata.prod_id = prodled.prod_id AND ${live}`
    + ` WHERE prodled.INVENTORY = 'Y' AND prodled.IL_POS = 'A'${challans ? ` AND btrim(prodled.trn_module)='CHLN-OUT'` : ` AND prodled.quantity - prodled.ag_qty > 0 AND prodled.book IN (8) AND prodled.led_id IS NOT NULL`}`
    + ` AND prodled.il_date BETWEEN '${desktopDate(call.from)}' AND '${upto}' AND prodmas.inventory = 'Y' GROUP BY ${key}, ${name}, prodmas.prod_desc)`
    + ` SELECT key, particular, sum(sale_qty) AS sale_qty FROM lines WHERE sale_qty <> 0 GROUP BY key, particular ORDER BY particular NULLS FIRST`);
  table.setKind("SALE_QTY", "decimal");
  for (const row of rows) table.insert({ SMART_LED_KEY: toText(row.key), Particular: row.particular, SALE_QTY: num(row.sale_qty) });
  return table;
}

// ======================================================================================
// 25: MARKETING ANALYSIS, formats Month and Summary (SP_REPORT_FORMATING branch 25)
// ======================================================================================
//
// ANALYSIS REP. > Marketing: the book's sale (or purchase) product lines of the period by the ticked groups (party, product, addons).
//  - Month: a quantity column per month of the period (and factor / value with Factor Column / Value Column), then the totals; whole
//    quantities as the procedure's convert(int ...). With Slab Add-Less and the book's product slabs, the value takes each non-tax slab
//    (added or less, as the slab says).
//  - Summary: quantity, factor (less what was set against), value per group, the non-tax slabs as columns (Slab Add-Less) and taken into
//    the value; Avg_Rate (value by factor, or by quantity) with Value Column; groups with no quantity left out.
// Free Include keeps the lines with no rate; Return Include takes the credit / debit notes (books 16 / 11) as negative. "No Formating"
// is the standard branch (SP_STD_RPT_MKTANALYS, reportStandard.ts). Subtotals only for the groups outside the last (output.ts).

async function marketingFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const lic = call.licence;
  const book = call.book;
  const format = call.formating.toUpperCase();
  if (format !== "MONTHLY" && format !== "SUMMARY") throw new ReportRefusal("UNKNOWN FORMATING FILTER\nError No : 507.1\nInternal Program Failure", "Report Generation Failed");
  const returns = check("CHK_RETURN_INCLUDE");
  const slabAddLess = check("CHK_SLABADDLESS") && lic !== 7;
  const productWise = (await runReportSql(loader, `SELECT 1 FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = $1 AND SLAB_ACTIVE = 'Y' and BOOK = $2 LIMIT 1`, [call.tarikh1, book])).rows.length > 0;

  // The non-tax product slabs: a column each (Summary), their part of the value, and a LEDGER_EXT join each.
  const slabColumns: string[] = [];
  const slabNames: { short: string; add: boolean }[] = [];
  let slabValue = "";
  let slabJoins = "";
  if (slabAddLess && productWise) {
    const slabs = (await runReportSql(loader, `SELECT SLAB_KEY AS key, btrim(SLAB_SHORT) AS short, btrim(coalesce(SLAB_MATHOP,'')) AS mathop FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and coalesce(SLAB_MASTER,'')<>'Y' and SLAB_FROMDT = $1 AND SLAB_ACTIVE = 'Y' and BOOK = $2 ORDER BY SLAB_ORDER`, [call.tarikh1, book])).rows;
    for (const slab of slabs) {
      const key = num(slab.key);
      const short = toText(slab.short).replace(/"/g, "");
      const amount = `LEDEXT${key}.SLAB_AMT::numeric`;
      slabColumns.push(`COALESCE(SUM(CASE WHEN LEDEXT${key}.SLAB_ID = ${key} THEN ${returns ? `case when prodled.book in (16,11) then ${amount} * -1 else ${amount} end` : amount} ELSE 0.00 END),0.00) AS "${short}"`);
      slabNames.push({ short, add: toText(slab.mathop) === "A" });
      slabValue += `${toText(slab.mathop) === "A" ? "+" : "-"}COALESCE(CASE WHEN LEDEXT${key}.SLAB_ID = ${key} THEN ${amount} ELSE 0.00 END,0.00)`;
      slabJoins += ` LEFT JOIN ${db}LEDGER_EXT LEDEXT${key} ON LEDEXT${key}.IL_ID = PRODLED.IL_KEY AND LEDEXT${key}.SLAB_ID = ${key}`;
    }
  }
  const entryJoin = call.acAddonRepdefa.includes("E") ? ` left join ${db}ADDON_AENTRY aentry on aentry.AONA_LEDID = PRODLED.LED_ID`
    : call.prodAddonRepdefa.includes("E") ? ` left join ${db}ADDON_IENTRY aentry on aentry.AONI_IL_ID = PRODLED.IL_KEY` : "";
  const from = call.from_.replace("sys.aent.bstart", "").replace("sys.ledext.bstart", "").replace("|sys.sp.aentry|", entryJoin).replace(/sys\.ledext\.join\s*sys\.ledext\.bend/, "") + slabJoins;

  // The where: the period, the book (and its notes with Return Include), the lines with a rate (Free Include: all).
  const dateField = call.dateField || "prodled.il_date";
  let where = `${call.where} AND ${dateField} BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}' AND PRODLED."TYPE" <> -1${check("CHK_FREE_INCLUDE") ? "" : " AND PRODLED.RATE > 0"} AND PRODLED."TYPE" <> 25`
    + (check("CHK_FREE_INCLUDE") ? "" : format === "MONTHLY" ? " and PRODLED.PROCESS_ID is null" : " and PRODLED.LED_ID is not null")
    + (returns ? ` AND (PRODLED.BOOK = 11 or PRODLED.BOOK = 16 or PRODLED.BOOK=${book})` : ` AND PRODLED.BOOK <> 11 and PRODLED.BOOK <> 16 AND PRODLED.BOOK=${book}`);
  if ([19, 29, 68, 73].includes(lic)) {
    const hideBook = (await runReportSql(loader, `SELECT 1 FROM ${db}ACCOUNT WHERE A_POS <> 'D' and position('CA_ENT' in A_SHORT) > 0 LIMIT 1`)).rows.length > 0;
    if (!hideBook && format === "MONTHLY") where += ` and (prodled.book_code in (select code from ${db}ACCOUNT where a_pos='A') or prodled.book_code is null)`;
  }

  // The groups' columns in front: the party, the product (licence 1 / 14: its description), the addons.
  let groupBy = call.groupBy;
  let orderBy = call.orderBy;
  const productGroup = /product\.prod_short/i.test(groupBy);
  const product = `PRODUCT.${lic === 1 || lic === 14 ? "PROD_DESC" : "PROD_SHORT"} as "SELECTED_PRODUCT"`;
  const ticked = call.addon.map((text, index) => (text.trim() !== "" && call.selectKey[index] !== "" ? text.trim() : "")).filter(Boolean);
  let head: string[];
  if (call.queryStart.trim() !== "") {
    head = /ac\.name/i.test(call.queryStart) ? [call.queryStart] : productGroup ? [...(format === "SUMMARY" || /name/i.test(groupBy) ? ["AC.NAME"] : []), product, call.queryStart] : ["AC.NAME", call.queryStart];
  } else if (format === "MONTHLY") {
    const headings = ticked.map((text) => `${text} AS "${text.replace(/^\w+\.txt_/i, "").toUpperCase()}"`);
    head = productGroup ? [...(/name/i.test(groupBy) ? ["AC.NAME"] : []), product, ...headings] : ["AC.NAME", ...headings];
  } else {
    const selected = ticked.map((text) => `${text} AS "SELECTED_${text.replace(/^\w+\.txt_/i, "")}(S)"`);
    head = productGroup ? ["AC.NAME", product, ...selected, ...(selected.length > 0 ? [`AC.NAME AS "SMART_NAME"`] : [])] : ["AC.NAME", ...selected, ...(selected.length > 0 ? [`AC.NAME AS "SMART_NAME"`] : [])];
  }
  // A column in front must be grouped (the procedure's SQL Server refuses it otherwise): the party is added to the groups when not in them.
  if (head.some((part) => /^AC\.NAME$/i.test(part)) && !/ac\.name/i.test(groupBy)) groupBy = groupBy.trim() === "" ? "ac.name" : `${groupBy},ac.name`;

  const qty = (expr: string) => (returns ? `(case when prodled.book in (16,11) then (${expr}) * -1 else (${expr}) end)` : `(${expr})`);
  const ordIn = (expr: string, negative: boolean) => `(case when btrim(coalesce(trn_module,''))='ORD-IN' then ${negative ? `(${expr}) * -1` : "0"} else (${expr}) end)`;
  const quantity = "trunc(prodled.QUANTITY-prodled.AG_QTY)";
  let body: string[];
  if (format === "MONTHLY") {
    body = [];
    for (let at = new Date(call.from.getFullYear(), call.from.getMonth(), call.from.getDate()); at.getTime() <= call.upto.getTime(); at = new Date(at.getFullYear(), at.getMonth() + 1, at.getDate())) {
      const m = at.getMonth() + 1;
      const label = MONTH_NAMES[at.getMonth()];
      const inMonth = (expr: string) => `coalesce(SUM(case when extract(month from ${dateField})=${m} then ${expr} end),0)`;
      body.push(`${inMonth(lic === 7 ? ordIn(quantity, returns) : qty(quantity))} AS "${label} QTY"`);
      if (check("CHK_FACTOR")) body.push(`${inMonth(qty("round(prodled.FACTOR::numeric,2)"))} AS "${label} FACT"`);
      if (check("CHK_VALUE")) body.push(`${inMonth(productWise ? qty(`PRODLED.IL_VALUE::numeric${slabValue}`) : lic === 7 && returns ? ordIn("PRODLED.IL_VALUE::numeric", true) : qty("PRODLED.IL_VALUE::numeric"))} AS "${label} VAL"`);
    }
    body.push(`coalesce(SUM(${lic === 7 ? ordIn(quantity, returns) : qty(quantity)}),0) AS "TOT_QTY"`);
    if (check("CHK_FACTOR")) body.push(`coalesce(SUM(${qty("round(prodled.FACTOR::numeric,2)")}),0) AS "TOT_FACT"`);
    if (check("CHK_VALUE")) body.push(`coalesce(SUM(${productWise ? qty(`PRODLED.IL_VALUE::numeric${slabValue}`) : qty("PRODLED.IL_VALUE::numeric")}),0) AS "TOT_VAL"`);
    if (lic === 1 || lic === 14) groupBy += ",product.PROD_SHORT,product.PROD_DESC";
    else if (/^ac/i.test(groupBy.trim()) && productGroup) { groupBy = "PRODUCT.PROD_SHORT,ac.name"; orderBy = "PRODUCT.PROD_SHORT,ac.name"; }
    else if (/^pr/i.test(groupBy.trim()) && /ac\.name/i.test(groupBy)) { groupBy = "ac.name,PRODUCT.PROD_SHORT"; orderBy = "ac.name,PRODUCT.PROD_SHORT"; }
  } else {
    if (!/ac\.name/i.test(groupBy)) groupBy = groupBy.trim() === "" ? "ac.name" : `${groupBy},ac.name`;
    body = [`coalesce(SUM(${qty("PRODLED.QUANTITY - PRODLED.AG_QTY")}),0) AS "QUANTITY"`,
      `coalesce(SUM(${qty("prodled.FACTOR-round((prodled.AG_QTY/nullif(prodled.QUANTITY,0)*prodled.TRN_QTY1),4)")}),0) AS "FACTOR"`,
      `coalesce(SUM(${qty("PRODLED.IL_VALUE::numeric")}),0) AS "VALUE"`, ...slabColumns];
    if (lic === 1 || lic === 14) groupBy = groupBy.replace(/product\.PROD_SHORT/gi, "product.PROD_SHORT,product.PROD_DESC");
  }
  const sql = `SELECT ${[...head, ...body].join(", ")} ${from} ${where}${groupOrderTail([groupBy], [orderBy])}`;
  const table = tableFromResult(await runReportSqlHashed(loader, pgFragment(sql, plan, loader.session.companySchema)));
  if (format === "SUMMARY") {
    // The value takes the slabs (added or less); the average rate; groups with no quantity left out.
    for (const row of table.rows) {
      let value = num(table.get(row, "VALUE"));
      for (const slab of slabNames) value += (slab.add ? 1 : -1) * num(table.get(row, slab.short));
      table.set(row, "VALUE", Math.round(value * 100) / 100);
    }
    if (check("CHK_VALUE")) {
      table.setKind("Avg_Rate", "decimal");
      for (const row of table.rows) {
        const by = check("CHK_FACTOR") ? num(table.get(row, "FACTOR")) : num(table.get(row, "QUANTITY"));
        table.set(row, "Avg_Rate", by > 0 ? Math.round((num(table.get(row, "VALUE")) / by) * 100) / 100 : null);
      }
    }
    table.rows = table.rows.filter((row) => num(table.get(row, "QUANTITY")) !== 0);
  }
  return table;
}

