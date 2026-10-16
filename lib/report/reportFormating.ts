import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { dateStyle112, dateStyle6, desktopDate, sqlServerCompare } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { cashBookColumns, dayBefore, ddMmYyyy, dropColumn, tableFromFields, formatPeriod, maxOf, pushAll, groupOrderTail, insertFirst, MONTH_NAMES, requireWhere, sortRows, tableFromResult, textKey, unknownFormat, withEntryAddon } from "./library";
import { registerSlabBook, registerSlabs, challanFrom, orderPendingFrom, orderPendingWhere, pendingChallanFrom, stockVoucher, invalidGst, gstrTaxMismatch, documentUpload, gstFormSummary, gstr3b, gstr1, gstr2, bookwise, checklistDaybook, checklistInvoice, dailyTransaction, fundFlow, interestCalculation, target, taxSummary, tdsReport, topReports, dropAnalysis, salesAnalysis, partySummary, nonFunction, partyBillPdf, physicalStock, cashBookFrom, cashBookOpening, monthlyClosingStock, partyStock, stockMovement, stockSummary } from "./reportStandard";
import { money, num, runReportSql, runReportSqlHashed } from "./run";
import { salesExpenseTable } from "./salesExpense";
import type { SalesExpenseAmount } from "./salesExpense";
import { multiYearAccounts } from "./multiYear";
import { multiYearStock as multiYearStockTable } from "./multiYearStock";
import type { StockYear } from "./multiYearStock";
import { multiYearExpense as multiYearExpenseTable } from "./multiYearExpense";
import type { ExpenseYear } from "./multiYearExpense";
import type { YearData } from "./multiYear";
import { multiCompanyAccountSummary, multiCompanyProfitLoss } from "./multiCompanyAccountSummary";
import { multiCompanyLedger } from "./multiCompanyLedger";
import { multiCompanyProduct } from "./multiCompanyProduct";
import { packingPlan } from "./packingPlan";
import { productionInquiry } from "./productionInquiry";
import { productionSummary } from "./productionSummary";
import { collectionSummary } from "./collectionSummary";
import { rateDiff } from "./rateDiff";
import { sfgDifference } from "./sfgDifference";
import { ssCircle } from "./ssCircle";
import { hvPurchase } from "./hvPurchase";
import { paymentTransfer } from "./paymentTransfer";
import { productionSetoff } from "./productionSetoff";
import { stockAgeing } from "./stockAgeing";
import { totalExpense } from "./totalExpense";
import { planVsProduction } from "./planVsProduction";
import { indentCompare, orderCompare } from "./orderCompare";
import { planningFgAnalysis } from "./planningFgAnalysis";
import { stockFlow } from "./stockFlow";
import { stockBalance } from "./stockBalance";
import { mfgFormulaSearch } from "./mfgFormulaSearch";
import { steelPlantChallan } from "./steelPlantChallan";
import { steelPlantStock } from "./steelPlantStock";
import { orderClearance } from "./orderClearance";
import { stockStatus } from "./stockStatus";
import { distributorsDispatch } from "./distributorsDispatch";
import { jobOutIndex } from "./jobOutIndex";
import { trpRegister } from "./trpRegister";
import { bankSlip } from "./bankSlip";
import { purchasePrice } from "./purchasePrice";
import { jobSetoffExpense } from "./jobSetoffExpense";
import { jobWorkMaster } from "./jobWorkMaster";
import { mouldingPlan } from "./mouldingPlan";
import { productionPlanDetail } from "./productionPlanDetail";
import { patiya } from "./patiya";
import { incomeTaxFormats } from "./incomeTax";
import { multiCompanyDayBook } from "./multiCompanyDayBook";
import { SYSTEM_SCHEMA } from "../master-program/session";

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
    case 2: return journalFormats(loader, plan);
    case 3: return registerFormats(loader, plan);
    case 4: return ledgerFormats(loader, plan);
    case 14: return formSummaryFormats(loader, plan);
    case 16: return partyStock(loader, plan);
    case 211: return topReports(loader, plan);
    case 112: return physicalStock(loader, plan);
    case 232: return dropAnalysis(loader, plan);
    case 143: return salesAnalysis(loader, plan);
    case 30: return partySummary(loader, plan);
    case 35: return nonFunction(loader, plan);
    case 280: return salesExpense(loader, plan);
    case 150: return patiya(loader, plan);
    case 153: return packingPlan(loader, plan);
    case 154: case 168: return productionInquiry(loader, plan);
    case 160: case 216: return productionSummary(loader, plan);
    case 161: return collectionSummary(loader, plan);
    case 122: return rateDiff(loader, plan);
    case 169: return sfgDifference(loader, plan);
    case 171: return ssCircle(loader, plan);
    case 172: return hvPurchase(loader, plan);
    case 174: return paymentTransfer(loader, plan);
    case 175: case 177: return productionSetoff(loader, plan);
    case 187: return stockAgeing(loader, plan);
    case 188: case 302: return totalExpense(loader, plan);
    case 148: return orderCompare(loader, plan);
    case 149: return indentCompare(loader, plan);
    case 210: return planningFgAnalysis(loader, plan);
    case 212: return stockFlow(loader, plan);
    case 221: case 222: return stockBalance(loader, plan);
    case 227: return mfgFormulaSearch(loader, plan);
    case 228: return steelPlantChallan(loader, plan);
    case 230: return steelPlantStock(loader, plan);
    case 231: return orderClearance(loader, plan);
    case 244: return stockStatus(loader, plan);
    case 248: return distributorsDispatch(loader, plan);
    case 254: return jobOutIndex(loader, plan);
    case 299: return trpRegister(loader, plan);
    case 51: return bankSlip(loader, plan);
    case 189: return planVsProduction(loader, plan);
    case 198: return purchasePrice(loader, plan);
    case 199: return jobSetoffExpense(loader, plan);
    case 200: return jobWorkMaster(loader, plan);
    case 203: return mouldingPlan(loader, plan);
    case 170: case 207: case 208: case 209: return productionPlanDetail(loader, plan);
    case 26: return incomeTaxFormats(loader, plan);
    case 115: return multiCompanyAccountSummary(loader, plan);
    case 178: return multiCompanyProfitLoss(loader, plan);
    case 116: return multiCompanyProduct(loader, plan);
    case 117: return multiCompanyDayBook(loader, plan);
    case 118: return multiCompanyLedger(loader, plan);
    case 103: return multiYearAccountBalance(loader, plan);
    case 104: return multiYearStock(loader, plan);
    case 105: return multiYearLedger(loader, plan);
    case 106: return multiYearExpense(loader, plan);
    case 125: return multiYearStockLedger(loader, plan);
    case 133: return multiYearPartyStock(loader, plan);
    case 176: return multiYearPartyProductAddonSale(loader, plan);
    case 267: return multiYearTopReports(loader, plan);
    case 279: return multiYearSalesReceipt(loader, plan);
    case 281: return multiYearSalesExpense(loader, plan);
    case 264: return addonDetails(loader, plan);
    case 151: return finishProductStock(loader, plan);
    case 163: return finishProductCosting(loader, plan);
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
    case 158: return dailyIncoming(loader, plan);
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
  if (filter !== "NONE" && filter !== "IFORM" && filter !== "EFORM") throw new ReportRefusal(`${filter === "ISLAB" ? "Include Slab" : filter === "ESLAB" ? "Exclude Slab" : call.filterText} with ${format} is not available in the web version of the register yet.`, "Not ported yet");
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
  // Each voucher's slab amounts, read in one grouped pass over LEDGER_EXT and joined (a sub-query a voucher and slab read the
  // whole table each time: LEDGER_EXT has no index on LED_ID). A voucher without the slab gets NULL, as before.
  const apply = slabs.length === 0 ? "" : ` LEFT JOIN (SELECT LED_ID AS slab_led,${slabs.map((slab) => `SUM(CASE WHEN SLAB_ID=${slab.key} THEN SLAB_AMT::numeric END) AS "${slab.short.toUpperCase()}_AMOUNT"`).join(",")}`
    + ` FROM ${db}LEDGER_EXT WHERE IL_ID IS NULL AND SLAB_ID IN (${slabs.map((slab) => slab.key).join(",")}) GROUP BY LED_ID) SLAB_SUMS ON SLAB_SUMS.slab_led=LED.LED_KEY`;
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
  const dailyQuantity = format === "DAILY" && call.checkQuery.includes("CHK_QUANTITY,");
  const quantity = dailyQuantity ? `,sum(coalesce(DAY_QTY.qty,0)) as "Quantity"` : "";
  const quantityJoin = dailyQuantity ? ` LEFT JOIN (SELECT led_id AS qty_led, sum(quantity) AS qty FROM ${db}PROD_LEDGER WHERE il_pos<>'D' AND inventory='Y' AND led_id IS NOT NULL GROUP BY led_id) DAY_QTY ON DAY_QTY.qty_led=LED.LED_KEY` : "";
  const body = `${lead}${label},sum(LED.AMOUNT) as "AMOUNT"${quantity}${slabColumns}`;
  const select = selectStart !== "" ? `SELECT ${body},${selectStart}` : `SELECT ${body}`;
  return tableFromResult(await runReportSqlHashed(loader, frag(`${select}${from}${apply}${quantityJoin}${call.where}${groupOrderTail([csGroup, periodGroup], [csOrder, periodOrder])}`)));
}

/** Month: a row a month (and party). */
async function registerMonthly(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const { from } = registerFormatFrom(plan);
  const slabs = await registerSlabs(loader, plan, false);
  const byParty = call.groupBy.trim() !== "" && call.groupBy.toLowerCase().includes("ac.name");
  // Each voucher's slab amounts (and the first tax slab's net) come from one grouped pass over LEDGER_EXT, joined: a sub-query a voucher and
  // slab read the whole table each time (LEDGER_EXT has no index on LED_ID) and timed out on a year's vouchers.
  const slabAmount = (key: number) => `coalesce(SUM(SLAB_SUMS."s${key}"),0.00)`;
  // NET_AMOUNT (the tax slab's total less its tax) stands before the first tax slab, then each slab.
  const columns: { name: string; sql: string }[] = [];
  let tax = false;
  let netSlab = 0;
  for (const slab of slabs) {
    if (slab.master) {
      if (!tax) { netSlab = slab.key; columns.push({ name: "NET_AMOUNT", sql: `coalesce(SUM(SLAB_SUMS."net"),0.00)` }); }
      tax = true;
    }
    columns.push({ name: slab.short, sql: slabAmount(slab.key) });
  }
  columns.push({ name: "FINAL_TOTAL", sql: "SUM(led.AMOUNT)" });
  const slabJoin = slabs.length === 0 ? "" : ` LEFT JOIN (SELECT LED_ID AS slab_led,${slabs.map((slab) => `SUM(CASE WHEN SLAB_ID=${slab.key} THEN SLAB_AMT::numeric END) AS "s${slab.key}"`).join(",")}`
    + `${netSlab ? `,SUM(CASE WHEN SLAB_ID=${netSlab} THEN S_LASTOT::numeric-SLAB_AMT::numeric END) AS "net"` : ""}`
    + ` FROM ${db}LEDGER_EXT WHERE IL_ID IS NULL AND SLAB_ID IN (${slabs.map((slab) => slab.key).join(",")}) GROUP BY LED_ID) SLAB_SUMS ON SLAB_SUMS.slab_led=LED.LED_KEY`;
  const withQuantity = call.checkQuery.includes("CHK_QUANTITY,");
  const quantity = withQuantity ? `coalesce(SUM(MONTH_QTY.qty),0)` : "0";
  const quantityJoin = withQuantity ? ` LEFT JOIN (SELECT led_id AS qty_led, sum(quantity) AS qty FROM ${db}PROD_LEDGER WHERE il_pos<>'D' AND inventory='Y' AND led_id IS NOT NULL GROUP BY led_id) MONTH_QTY ON MONTH_QTY.qty_led=LED.LED_KEY` : "";
  const select = `SELECT to_char(led.doc_date,'YYYYMM') AS "SORTING_COL",${byParty ? `ac.name AS "PARTY_NAME",` : ""}to_char(led.doc_date,'FMMonth') AS "PARTICULARS",${quantity} AS "QUANTITY",${columns.map((column) => `${column.sql} AS "${column.name}"`).join(",")}`;
  const groupBy = ` GROUP BY ${byParty ? "ac.name," : ""}LED.LED_KEY,led.doc_date`;
  const vouchers = await runReportSqlHashed(loader, frag(`${select}${from}${slabJoin}${quantityJoin}${call.where}${groupBy}`));
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
  // The procedure looks each slab up per item line (two subqueries a slab and line; LEDGER_EXT has no index on IL_ID, so a year's sale
  // ran past the time limit). Here the period's item lines' slab rows are grouped by line once and joined (lxi): the same values.
  const itemSlabIds = itemSlabs.map((slab) => Math.trunc(num(slab.id)));
  const itemSlabValues = itemSlabs.map((slab, index) => `lxi.p${itemSlabIds[index]} AS "${toText(slab.short)}_%",lxi.a${itemSlabIds[index]} AS "${toText(slab.short)}"`).join(",");
  const itemSlabJoin = itemSlabIds.length === 0 ? "" : ` left join (SELECT LEDEXT.il_id, ${itemSlabIds.map((id) => `min(case when LEDEXT.SLAB_ID = ${id} then LEDEXT.SLAB_PERC end) AS p${id}, min(case when LEDEXT.SLAB_ID = ${id} then LEDEXT.SLAB_AMT::numeric end) AS a${id}`).join(", ")}`
    + ` FROM ${db}LEDGER_EXT LEDEXT WHERE LEDEXT.SLAB_ID IN (${itemSlabIds.join(",")}) AND LEDEXT.il_id IN (SELECT il_key FROM ${db}PROD_LEDGER WHERE IL_DATE >= '${desktopDate(call.from)}' AND IL_DATE <= '${desktopDate(call.upto)}') GROUP BY LEDEXT.il_id) lxi on lxi.il_id = prod_ledger.IL_KEY`;

  // Show Default Slabs: the bill's slabs on the voucher's line (a % for a slab that asks for it, NET_AMOUNT and the tax's name at the first tax).
  let billValues = "";
  let billBlanks = "";
  let billJoin = "";
  if (printSlabs) {
    const bill = await slabRows(`SELECT ltrim(SLAB_REPOHD) AS short, SLAB_KEY AS id, SLAB_MASTER AS master, SLAB_PREQ AS perc FROM ${db}SLAB_MASTER WHERE ${slabWhere} AND SLAB_INREP='Y' AND SLAB_ACTIVE<>'N' ORDER BY SLAB_ORDER`);
    const values: string[] = [];
    const blanks: string[] = [];
    let tax = 0;
    // The bill's slab rows (no item line) grouped by voucher once and joined (lxb), as the item slabs: the procedure's subquery per
    // slab and voucher reads all of LEDGER_EXT each time (no index on LED_ID).
    const parts: string[] = [];
    const ids: number[] = [];
    const amountOf = (id: number) => { parts.push(`min(case when LEDEXT.SLAB_ID = ${id} then LEDEXT.SLAB_AMT::numeric end) AS a${id}`); return `lxb.a${id}`; };
    const taxName = (id: number) => { parts.push(`min(case when LEDEXT.SLAB_ID = ${id} then taxmst.tax_repohd end) AS t${id}`); return `lxb.t${id}`; };
    for (const slab of bill) {
      const short = toText(slab.short);
      const id = Math.trunc(num(slab.id));
      ids.push(id);
      if (toText(slab.perc) === "Y") {
        blanks.push(`0.0000::numeric AS "${short}1_%"`);
        parts.push(`min(case when LEDEXT.SLAB_ID = ${id} then LEDEXT.SLAB_PERC end) AS p${id}`);
        values.push(`lxb.p${id} AS "${short}1_%"`);
      }
      if (toText(slab.master) === "Y") {
        if (tax === 0) {
          blanks.push(`0.0000::numeric AS "NET_AMOUNT"`, `CAST('' AS TEXT) AS "TAX_DESCRIPTION"`);
          parts.push(`min(case when LEDEXT.SLAB_ID = ${id} then LEDEXT.S_LASTOT::numeric - LEDEXT.SLAB_AMT::numeric end) AS n${id}`);
          values.push(`lxb.n${id} AS "NET_AMOUNT"`, `${taxName(id)} AS "TAX_DESCRIPTION"`);
        } else {
          blanks.push(`CAST('' AS TEXT) AS "TAX_DESCRIPTION1"`);
          values.push(`${taxName(id)} AS "TAX_DESCRIPTION1"`);
        }
        tax = 1;
      }
      blanks.push(`0.0000::numeric AS "${short}1"`);
      values.push(`${amountOf(id)} AS "${short}1"`);
    }
    billValues = values.join(",");
    billBlanks = blanks.join(",");
    if (ids.length > 0) billJoin = ` left join (SELECT LEDEXT.LED_ID, ${[...new Set(parts)].join(", ")} FROM ${db}LEDGER_EXT LEDEXT left join ${db}TAX_MASTER taxmst on taxmst.tax_rec=LEDEXT.tax_id`
      + ` WHERE LEDEXT.IL_ID is null AND LEDEXT.SLAB_ID IN (${[...new Set(ids)].join(",")}) GROUP BY LEDEXT.LED_ID) lxb on lxb.LED_ID = LED.LED_KEY`;
  }

  const dateField = call.dateField;
  const datePart = `to_char(${dateField},'YYYYMMDD')`;
  const mrpHeader = mrp ? `,0.00::numeric AS "MRP_RATE",0.0000::numeric AS "MRP_VALUE"` : "";
  const join = (parts: string[]) => parts.filter((part) => part !== "").join(",");
  // The voucher's line.
  const header = `SELECT led.LED_KEY AS "SMART_LED_KEY",LED.BOOK AS "BOOK",LED.DOC_NO AS "DOC_NO",'' AS "DOC_NO1",LED.FULL_DOCNO AS "FULL_DOCNO",${mrp ? `AC.NAME || ' - ' || coalesce(AC.A_SHORT,'')` : "AC.NAME"} AS "NAME",addr.gst_no AS "GST_NO",to_char(${dateField},'DD-Mon-YY') AS "SELECTED_DATE",AC.CREDIT_DAYS AS "CRDAY",LED.AMOUNT AS "AMOUNT",'' AS "HSN_CODE",0.0000::numeric AS "QUANTITY",0.0000::numeric AS "FACTOR",0.00::numeric AS "RATE",0.0000::numeric AS "VALUE"${mrpHeader}`
    + `${join(["", billValues, blankItemSlabs]) !== "" ? `,${join([billValues, blankItemSlabs])}` : ""}`
    + `,${datePart}||led.DOC_NO::text||ac.code::text||LED.FULL_DOCNO||'  000' AS "SORTING_FIELD",AC.NAME AS "SMART_SORTING_NAME",${datePart} AS "SORTING_DATE"`;
  const headerSql = `${header}${from}${billJoin}${call.where}${withProduct ? " and prodled.il_pos='A'" : ""} ORDER BY led.doc_date`;
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
  itemFrom += itemSlabJoin;
  const itemSql = `${item}${itemFrom}${call.where} and PROD_LEDGER.BOOK =${call.book} and il_pos = 'A' and coalesce(prod_ledger.process_id,0)=0 and addr.address_id=1 and IL_DATE >= '${desktopDate(call.from)}' and IL_DATE <= '${desktopDate(call.upto)}' order by il_serial`;
  // Hash joins: the planner takes the year's item lines for a few hundred (the book, date and process conditions together) and loops over
  // the grouped slabs and ADDON_DATA once per line (past the 2 minute limit for a year's sale; hashed: 0.2 s).
  const items = await runReportSqlHashed(loader, frag(itemSql));

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

/**
 * Master Detail: a row for each voucher with every tax master's taxable value and tax. Include Form: only the vouchers that carry one of
 * the ticked taxes (TAX_MASTER, call.slabsKey), with those taxes' columns; Exclude Form: the vouchers that carry none of them, with the others'.
 */
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
  const formFilter = call.filterId.toUpperCase();
  const formKeys = formFilter === "IFORM" || formFilter === "EFORM" ? call.slabsKey.split(",").map((key) => Number(key.trim())).filter((key) => Number.isInteger(key) && key > 0) : [];
  const taxes: TaxMaster[] = (await runReportSql(loader, frag(taxSql))).rows.map((row) => ({ short: toText(row.short), key: Number(row.id), type: toText(row.type), percent: num(row.perc) }))
    .filter((tax) => formFilter === "IFORM" ? formKeys.includes(tax.key) : formFilter === "EFORM" ? !formKeys.includes(tax.key) : true);
  const formWhere = formKeys.length === 0 ? "" : ` and led.LED_KEY ${formFilter === "EFORM" ? "not in" : "in"} (select ledext.led_id from ${db}LEDGER_EXT ledext where ledext.tax_id in (${formKeys.join(",")}) and ledext.led_id is not null)`;
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
    + `${call.where}${formWhere}`;
  const csOrder = call.orderBy.trim();
  const tail = call.orderBy.toUpperCase().includes("AC.NAME")
    ? `EXTRACT(YEAR FROM ${dateField}),EXTRACT(MONTH FROM ${dateField}),to_char(${dateField},'DD/MM/YYYY')`
    : `EXTRACT(YEAR FROM ${dateField}),EXTRACT(MONTH FROM ${dateField}),to_char(${dateField},'DD/MM/YYYY'),LED.DOC_NO`;
  const table = tableFromResult(await runReportSql(loader, frag(`${sql}${groupOrderTail([], [csOrder, tail])}`)));
  return table;
}

// ======================================================================================
// 2: JOURNAL formats (SP_REPORT_FORMATING)
// ======================================================================================
//
// The journal's formats work on the ledger vouchers themselves (LED.AC_DBCODE 1 debit, 2 credit, LED.AMOUNT) for the date field's period: DAILY, WEEKLY, HALF_MONTH
// (SYSTEM_BLANK1 year and SYSTEM_BLANK2 month before the period), QUATER_YEAR (year) and HALF_YEAR give a row per period (and per account, with a group ticked) with
// DEBIT and CREDIT; SUMMARY a row per account for the whole period; MONTHLY a row per account with a DEBIT and CREDIT column for each month of the period and the
// final totals. MONTHLY and SUMMARY do not take a group (the procedure's "NOT ALLOWED PLEASE SELECT DETAIL OPTION").

async function journalFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const format = call.formating;
  const date = call.dateField;
  if (date === "") throw new ReportRefusal("DATE FIELD FOUND BLANK\nPLEASE CHECK DATABASE","INTERNAL PROGRAM FAILURE");
  const csFrom = cashBookFrom(plan);
  const baseWhere = call.where.split("|sys.db|").join(call.database).split("|sys.yearid|").join(call.yearId);
  const where = `${baseWhere} AND ${date} BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}'`;
  requireWhere(where);
  const amounts = (debit: string, credit: string) => `sum(case when led.AC_DBCODE=1 then LED.AMOUNT else 0.00 end) as "${debit}",sum(case when led.AC_DBCODE=2 then LED.AMOUNT else 0.00 end) as "${credit}"`;
  const decimals = (table: ResultTable) => { for (const column of table.columns) if (/(DEBIT|CREDIT)$/i.test(column)) table.setKind(column, "decimal"); return table; };

  if (format === "MONTHLY" || format === "SUMMARY") {
    if (call.queryStart.trim() !== "") throw new ReportRefusal(` ${format} NOT ALLOWED PLEASE SELECT DETAIL OPTION `, "INTERNAL PROGRAM FAILURE");
    if (format === "SUMMARY") return decimals(tableFromResult(await runReportSql(loader, frag(`SELECT AC.NAME AS "NAME",${amounts("DEBIT", "CREDIT")}${csFrom}${where} GROUP BY AC.NAME ORDER BY AC.NAME`))));
    const months: string[] = [];
    for (let month = new Date(call.from.getFullYear(), call.from.getMonth(), 1); month <= call.upto; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
      const name = MONTH_NAMES[month.getMonth()].slice(0, 3).toUpperCase();
      const inMonth = `EXTRACT(MONTH FROM ${date})=${month.getMonth() + 1}`;
      months.push(`coalesce(SUM(case when led.AC_DBCODE=1 and ${inMonth} then led.AMOUNT end),0.00) as "${name} DEBIT"`, `coalesce(SUM(case when led.AC_DBCODE=2 and ${inMonth} then led.AMOUNT end),0.00) as "${name} CREDIT"`);
    }
    months.push(`coalesce(SUM(case when led.AC_DBCODE=1 then led.AMOUNT end),0.00) as "FINAL_DEBIT"`, `coalesce(SUM(case when led.AC_DBCODE=2 then led.AMOUNT end),0.00) as "FINAL_CREDIT"`);
    return decimals(tableFromResult(await runReportSql(loader, frag(`SELECT AC.NAME AS "NAME",${months.join(",")}${csFrom}${where} GROUP BY AC.NAME ORDER BY AC.NAME`))));
  }

  const period = formatPeriod(format, date);
  if (!period) throw unknownFormat(format);
  const blanks = format === "DAILY" || format === "WEEKLY" || format === "HALF_MONTH" ? `EXTRACT(YEAR FROM ${date}) as "SYSTEM_BLANK1",EXTRACT(MONTH FROM ${date}) as "SYSTEM_BLANK2",`
    : format === "QUATER_YEAR" ? `EXTRACT(YEAR FROM ${date}) as "SYSTEM_BLANK1",` : "";
  let groupBy = call.groupBy;
  let orderBy = call.orderBy;
  let select = `${blanks}${period.label} AS "${period.alias}",${amounts("DEBIT", "Credit")}`;
  const own = call.queryStart.trim();
  if (own !== "") select += own.toUpperCase().includes("NAME") ? `,${own}` : `,${own},AC.NAME`;
  if (groupBy.trim() !== "") {
    select = `AC.NAME as "NAME",${select}`;
    if (!groupBy.toUpperCase().includes("NAME")) groupBy = `${groupBy},AC.NAME`;
    if (orderBy.trim() !== "" && !orderBy.toUpperCase().includes("NAME")) orderBy = `${orderBy},AC.NAME`;
  }
  return decimals(tableFromResult(await runReportSql(loader, frag(`SELECT ${select}${csFrom}${where}${groupOrderTail([groupBy, period.group], [orderBy, period.order])}`))));
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
  // A credit / debit note register (book 16 / 11) reads its notes by the book they are against (AG_BOOK): the procedure tests the typed account codes for 11 and 16, which are the book numbers only in its own database.
  if (readsReturnAccounts(groupKeys) || [11, 16].includes(book)) where += ` AND (LED.BOOK_CODE IN (${keys}) OR LED.AG_BKCODE IN (${keys})) AND (LED.BOOK IN (${inBook}) OR LED.AG_BOOK IN (${inBook}))`;
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


// ======================================================================================
// 280: SALES V/S EXPENSE (SP_FRT_RPT_SALES_EXPENSE_REP; ANALYSIS REP. > Sales V/S Expense)
// ======================================================================================
//
// The month's sales against the month's expenses, a column a month (April ... in the year's order, only the months with
// something), then Total and AVG_PER_MONTH (the total over the months shown):
//  - SALES: one line, the sale book (8), its debit (11) and credit (16) notes against the sale; with a GST master slab of the
//    sale book its taxable value (S_LASTOT less the slab's amount), without one the voucher amount (leaving out the
//    vouchers of the parties named like a company of the system).
//  - EXPENSE: a line an expense account (balance sheet code 02 to 04, posting accounts), what was posted to it; the lines with a
//    total of 0 or less are left out. Ordered by the balance sheet head, then the name.
//  - TOTAL EXP %: the expenses as a percentage of the sales, each month, the total and the average.
// Percentage Column Require (CHK_MONTHLYPERC): no % line; instead each month has its percentage of the month's sales beside it
// (<Month>_Perc), and the sales line shows 100.
//
// The desktop pivots TEMP_TABLE_SALES_EXPENSE_<machine>; here the pivot is made in memory from two read-only queries. Without a
// slab the desktop's select names ac.code without grouping on it, which SQL Server refuses; here the line is the one SALES line.
// With more than one GST master slab of the sale book the desktop takes the last it reads; here the last in slab order.

async function salesExpense(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const period = `'${desktopDate(call.from)}' and '${desktopDate(call.upto)}'`;
  const slabs = (await runReportSql(loader, `SELECT slab_key FROM ${db}SLAB_MASTER WHERE slab_active = 'Y' AND slab_master = 'Y' AND slab_link = 0 AND book = 8 ORDER BY slab_order, slab_key`)).rows;
  const slab = Math.trunc(num(slabs.at(-1)?.slab_key));
  const saleBooks = `led.DOC_POS='A' and led.DOC_POSTING='P' and led.BOOK in (8,11,16) and (led.ag_book=8 or coalesce(led.ag_book,0)=0) and led.doc_date between ${period}`;
  const saleSql = slab !== 0
    ? `select extract(month from led.doc_date)::int as "MONTH",sum(case when led.ac_dbcode=1 then coalesce(ledext.s_lastot::numeric-ledext.slab_amt::numeric,0) else coalesce(ledext.s_lastot::numeric-ledext.slab_amt::numeric,0)*-1 end) as "AMOUNT"`
      + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}LEDGER_EXT ledext on ledext.led_id=led.led_key and ledext.il_id is null and ledext.slab_id=${slab}`
      + ` where ${saleBooks} group by extract(month from led.doc_date)`
    : `select extract(month from led.doc_date)::int as "MONTH",sum(case when led.ac_dbcode=1 then led.amount::numeric else led.amount::numeric*-1 end) as "AMOUNT"`
      + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code`
      + ` where ${saleBooks} and ac.name not in (select name from ${SYSTEM_SCHEMA}.company where name is not null) group by extract(month from led.doc_date)`;
  const expenseSql = `select ac.code as "CODE",ac.name as "NAME",bs.bs_desc as "HEAD",extract(month from led.doc_date)::int as "MONTH",sum(case when ledpost.post_dbcode=1 then ledpost.post_amt::numeric else ledpost.post_amt::numeric*-1 end) as "AMOUNT"`
    + ` from ${db}LEDGER_POST ledpost left join ${db}ACCOUNT ac on ac.code=ledpost.post_code left join ${db}BALSHEET bs on bs.bs_key=ac.bs_id left join ${db}LEDGER led on ledpost.led_id=led.led_key`
    + ` where led.DOC_POS='A' and led.DOC_POSTING='P' and ac.a_pos<>'D' and coalesce(left(led.doc_no1,3),'')<>'END' and ac.a_posting<>'N'`
    + ` and ac.bs_id in (select bs1.bs_key from ${db}BALSHEET bs1 where left(bs1.bs_code,2) ~ '^[0-9]+$' and left(bs1.bs_code,2)::int between 2 and 4) and led.doc_date between ${period}`
    + ` group by extract(month from led.doc_date),ac.name,bs.bs_desc,ac.code`;
  const amounts: SalesExpenseAmount[] = [
    ...(await runReportSql(loader, saleSql)).rows.map((row) => ({ code: 0, particular: "SALES", side: "SALES" as const, head: "SALES", month: num(row.MONTH) - 1, amount: num(row.AMOUNT) })),
    ...(await runReportSql(loader, expenseSql)).rows.map((row) => ({ code: num(row.CODE), particular: toText(row.NAME), side: "EXPENSE" as const, head: toText(row.HEAD), month: num(row.MONTH) - 1, amount: num(row.AMOUNT) })),
  ];
  if (amounts.length === 0) return new ResultTable();
  return salesExpenseTable(amounts, call.checkQuery.includes("CHK_MONTHLYPERC"));
}

// ======================================================================================
// 103: MULTI YEAR ACCOUNT BALANCE (SP_FRT_RPT_MULTI_YEAR_ACCOUNT_SUMMARY_REP; ANALYSIS REP. > Multi Year > Account Balance)
// ======================================================================================
//
// The company's years whose dates meet From .. Upto (SMART_SYSTEM.CNAME, the companies of the same billing name, or name, and group;
// licences 7 and 8 by the name), oldest first, at most ten, each read from its own database. The rows and columns are made in
// multiYear.ts. A year whose database is not on this server is left out (the desktop's query fails on it).

async function companyYears(loader: Loader, plan: ReportPlan): Promise<ResultRow[]> {
  const { call } = plan;
  const company = (await runReportSql(loader, `SELECT btrim(coalesce(name,'')) AS name, btrim(coalesce(bill_name,'')) AS bill_name, btrim(coalesce(co_group,'')) AS co_group FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $1`, [call.companyKey])).rows[0];
  if (!company) return [];
  const billName = call.licence !== 7 && call.licence !== 8 ? toText(company.bill_name) : "";
  const byBill = billName !== "";
  return (await runReportSql(loader, `SELECT n.c_tarikh1::date AS y1, n.c_tarikh2::date AS y2, lower(btrim(c.co_dataname)) AS schema_name`
    + ` FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id`
    + ` WHERE n.c_tarikh2::date >= $1::date AND n.c_tarikh1::date <= $2::date AND btrim(${byBill ? "c.bill_name" : "c.name"}) = $3 AND btrim(c.co_group) = $4 ORDER BY n.c_tarikh1`,
  [desktopDate(call.from), desktopDate(call.upto), byBill ? billName : toText(company.name), toText(company.co_group)])).rows.slice(0, 10);
}

async function multiYearAccountBalance(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const years = await companyYears(loader, plan);

  const data: YearData[] = [];
  for (const year of years) {
    const schema = toText(year.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','ac_balance','ledger','ledger_post')", [schema])).rows[0];
    if (num(exists?.n) < 4) continue;
    const from = year.y1 as Date;
    const upto = year.y2 as Date;
    const period = [desktopDate(from), desktopDate(upto)];
    const accounts = (await runReportSql(loader, `SELECT ac.code, btrim(coalesce(ac.name,'')) AS name, coalesce(ac.book,0) AS book, ac.a_pos, coalesce(ac.ac_opensty,'') AS opensty,`
      + ` bal.opening FROM ${schema}.account ac LEFT JOIN (SELECT acbal.code, sum(acbal.opening::numeric) AS opening FROM ${schema}.ac_balance acbal GROUP BY acbal.code) bal ON bal.code = ac.code`
      + ` ORDER BY ac.code`)).rows;
    const posted = `FROM ${schema}.ledger led JOIN ${schema}.ledger_post ledpost ON ledpost.led_id = led.led_key WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND ledpost.post_date BETWEEN $1 AND $2`;
    const sums = "sum(CASE WHEN ledpost.post_dbcode = 1 THEN ledpost.post_amt::numeric ELSE 0 END) AS dr, sum(CASE WHEN ledpost.post_dbcode = 2 THEN ledpost.post_amt::numeric ELSE 0 END) AS cr";
    const posts = (await runReportSql(loader, `SELECT ledpost.post_code AS code, ${sums} ${posted} GROUP BY ledpost.post_code`, period)).rows;
    // Sundry Debtors / Creditors: what each live debtor / creditor had posted on its own vouchers (the voucher's party is the account).
    const sides = (await runReportSql(loader, `SELECT ac1.book, ${sums} ${posted.replace("WHERE", `JOIN ${schema}.account ac1 ON ac1.code = led.code WHERE ac1.a_pos = 'A' AND ac1.book IN (2,3) AND ledpost.post_code = ac1.code AND`)} GROUP BY ac1.book`, period)).rows;
    const side = (book: number) => { const row = sides.find((candidate) => num(candidate.book) === book); return { dr: num(row?.dr), cr: num(row?.cr) }; };
    data.push({
      label: `${from.getFullYear()}_${upto.getFullYear()}`,
      accounts: accounts.map((row) => ({ code: num(row.code), name: toText(row.name), book: num(row.book), live: toText(row.a_pos) === "A", openSty: toText(row.opensty).trim(), opening: row.opening === null ? null : num(row.opening) })),
      posts: new Map(posts.map((row) => [num(row.code), { dr: num(row.dr), cr: num(row.cr) }])),
      debtors: side(2),
      creditors: side(3),
    });
  }
  return multiYearAccounts(data, call.fcValue, call.formating.toUpperCase() === "DRCR");
}

// ======================================================================================
// 104: MULTI YEAR STOCK SUMMARY (SP_FRT_RPT_MULTI_YEAR_STOCK_SUMMARY_REP; ANALYSIS REP. > Multi Year > Inventory)
// ======================================================================================
//
// The same years as 103, each read from its own database. The desktop's procedure asks every product's opening and movement with a
// sub-query of its own (and PROD_BALANCE / PROD_LEDGER have no index on PROD_ID); here a year is four grouped reads (products, opening,
// movement) matched in memory, the rows and columns made in multiYearStock.ts.

async function multiYearStock(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const combo = call.fcValue;
  const monthWise = call.checkQuery.includes("CHK_MONTHWISE,");
  const years = await companyYears(loader, plan);
  const quantity = call.licence === 2 ? "trn_qty3" : "(quantity - ag_qty)";
  const month = (date: Date) => date.getMonth() + 1;

  const data: StockYear[] = [];
  for (const year of years) {
    const schema = toText(year.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('product_master','prod_balance','prod_ledger')", [schema])).rows[0];
    if (num(exists?.n) < 3) continue;
    const y1 = year.y1 as Date;
    const y2 = year.y2 as Date;
    // Only STOCK (and Month Wise) works on the year's own dates; the others on From / Upto's day and month, in the year they fall in.
    let from = y1;
    let upto = y2;
    if (combo !== 1 && !monthWise) {
      const inYear = (date: Date) => new Date(month(date) <= 3 ? y2.getFullYear() : y1.getFullYear(), date.getMonth(), date.getDate());
      from = inYear(call.from);
      upto = inYear(call.upto);
    }
    const period = [desktopDate(from), desktopDate(upto)];
    const products = (await runReportSql(loader, `SELECT prod_key, prod_short, prod_desc, prod_pos, inventory FROM ${schema}.product_master`)).rows
      .map((row) => ({ key: num(row.prod_key), code: toText(row.prod_short), desc: toText(row.prod_desc), pos: toText(row.prod_pos), inventory: toText(row.inventory) }));
    const opening = new Map<number, number>();
    const movement = new Map<number, { add: number; less: number; net: number }>();
    const byProduct = new Map<number, Map<number, number>>();
    if (combo === 1) {
      for (const row of (await runReportSql(loader, `SELECT prod_id, sum(open_pcs) AS v FROM ${schema}.prod_balance WHERE prec_flag = 'RP' GROUP BY prod_id`)).rows) opening.set(num(row.prod_id), num(row.v));
      const moved = await runReportSql(loader, `SELECT prod_id, sum(CASE WHEN stock_nat = 'A' THEN ${quantity} ELSE 0 END) AS add_q, sum(CASE WHEN stock_nat = 'L' THEN ${quantity} ELSE 0 END) AS less_q,`
        + ` sum(CASE WHEN stock_nat = 'A' THEN quantity - ag_qty ELSE -(quantity - ag_qty) END) AS net_q FROM ${schema}.prod_ledger`
        + ` WHERE il_pos = 'A' AND inventory = 'Y' AND il_date BETWEEN $1 AND $2 GROUP BY prod_id`, period);
      for (const row of moved.rows) movement.set(num(row.prod_id), { add: num(row.add_q), less: num(row.less_q), net: num(row.net_q) });
    } else {
      const natured: Record<number, string> = { 2: "CASE WHEN stock_nat = 'L' THEN QTY ELSE 0 END", 3: "CASE WHEN stock_nat = 'A' THEN QTY ELSE 0 END" };
      const wheres: Record<number, string> = { 2: "book = 8 AND process_id IS NULL", 3: "book = 13 AND process_id IS NULL", 4: "book = 16 AND process_id IS NULL", 5: "book = 11 AND process_id IS NULL", 6: "trn_stkmid = 'SA' AND led_id IS NULL", 7: "trn_stkmid = 'SL' AND led_id IS NULL" };
      if (!wheres[combo]) throw new ReportRefusal(`Multi Year Stock Summary does not know the choice ${combo}.`, "INTERNAL PROGRAM FAILURE");
      const value = (natured[combo] ?? "QTY").replace(/QTY/g, quantity);
      const rows = (await runReportSql(loader, `SELECT prod_id, ${monthWise ? "m, sum(v) AS v, grouping(m) AS g" : "sum(v) AS v, 1 AS g"}`
        + ` FROM (SELECT prod_id, extract(month FROM il_date)::int AS m, ${value} AS v FROM ${schema}.prod_ledger WHERE il_pos = 'A' AND ${wheres[combo]} AND il_date BETWEEN $1 AND $2) q`
        + ` GROUP BY ${monthWise ? "GROUPING SETS ((prod_id, m), (prod_id))" : "prod_id"}`, period)).rows;
      for (const row of rows) {
        const id = num(row.prod_id);
        const months = byProduct.get(id) ?? new Map<number, number>();
        months.set(num(row.g) === 1 ? 0 : num(row.m), num(row.v));
        byProduct.set(id, months);
      }
    }
    data.push({ from, upto, products, opening, movement, quantity: byProduct });
  }
  return multiYearStockTable(data, combo, monthWise);
}

// ======================================================================================
// 105: MULTI YEAR LEDGER (SP_FRT_RPT_MULTI_YEAR_ACCOUNT_LEDGER_REP; ANALYSIS REP. > Multi Year > Ledger)
// ======================================================================================
//
// One account (the Account group's single pick) through the company's years that meet From .. Upto: in each year's database the account of
// the same name and book, its postings between From and Upto (not the year's dates), one ledger line each; then the account's heading, the
// opening (the first year's) and the closing row, in the SORTING_COL order. The running balance is the output layer's (closing_bal).
//  - UNION in the procedure drops identical rows: the same here, over the lines of all the years.
//  - The opening is the first year's AC_BALANCE opening plus its postings before From. The procedure shows only abs(opening) in Credit
//    when the total is negative; here the credit is the total itself.

async function multiYearLedger(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const key = call.selectKey[4];
  if (key.includes(",")) throw new ReportRefusal("Multiple Account Selection Not Allowed", "INTERNAL PROGRAM FAILURE");
  if (key === "") throw new ReportRefusal("Select an account (Account group)", "INTERNAL PROGRAM FAILURE");
  const db = call.database;
  const picked = (await runReportSql(loader, `SELECT btrim(name) AS name, coalesce(book,0) AS book FROM ${db}ACCOUNT WHERE a_pos <> 'D' AND code IN ${key} ORDER BY (a_pos = 'A') DESC, code`)).rows[0];
  if (!picked) return new ResultTable();
  const name = toText(picked.name);
  const book = num(picked.book);
  const narration = call.checkQuery.includes("CHK_NARRATION,");
  const columns = ["SORTING_COL", "ROW_DATA_TYPE", "SMART_NAME", "selected_date", "FULL_DOCNO", "NAME", "Debit", "Credit", "closing_bal", "DR_CR", "doc_no1", ...(narration ? ["NARRATION"] : [])];
  const table = new ResultTable();
  for (const column of columns) table.addColumn(column);
  for (const column of ["Debit", "Credit", "closing_bal"]) table.setKind(column, "decimal");

  const found: { schema: string; code: number }[] = [];
  for (const year of await companyYears(loader, plan)) {
    const schema = toText(year.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','ac_balance','ledger','ledger_post')", [schema])).rows[0];
    if (num(exists?.n) < 4) continue;
    const account = (await runReportSql(loader, `SELECT code FROM ${schema}.account WHERE btrim(name) = $1 AND a_pos <> 'D' AND coalesce(book,0) = $2 ORDER BY code DESC LIMIT 1`, [name, book])).rows[0];
    found.push({ schema, code: num(account?.code) });
  }
  if (found.length === 0) return table;

  // Licences 19, 29, 68 and 73 leave out the vouchers of the CA_ENT books when the first year has none of them.
  const hideBooks = [19, 29, 68, 73].includes(call.licence)
    && num((await runReportSql(loader, `SELECT count(*)::int AS n FROM ${found[0].schema}.account WHERE a_pos <> 'D' AND strpos(a_short, 'CA_ENT') > 0`)).rows[0]?.n) === 0;
  const rows: ResultRow[] = [];
  for (const { schema, code } of found) {
    if (code === 0) continue;
    const lines = await runReportSql(loader, `SELECT btrim(ac.name) || '   P' || to_char(led.doc_date, 'YYYYMMDD') || led.doc_no || led.led_key::text || 'LED' AS "SORTING_COL", 'LED' AS "ROW_DATA_TYPE", btrim(ac.name) AS "SMART_NAME",`
      + ` to_char(led.doc_date, 'DD/MM/YYYY') AS "selected_date", led.full_docno AS "FULL_DOCNO",`
      + ` CASE WHEN led.book <> 19 THEN (SELECT acn.name FROM ${schema}.account acn WHERE acn.code = led.book_code AND acn.a_pos = 'A' LIMIT 1) ELSE 'JOURNAL' END AS "NAME",`
      + ` CASE WHEN ledpost.post_dbcode = 1 THEN ledpost.post_amt::numeric ELSE 0.00 END AS "Debit", CASE WHEN ledpost.post_dbcode = 2 THEN ledpost.post_amt::numeric ELSE 0.00 END AS "Credit",`
      + ` 0.00 AS "closing_bal", '' AS "DR_CR", btrim(led.doc_no1) AS "doc_no1"${narration ? ", btrim(led.narration) AS \"NARRATION\"" : ""}`
      + ` FROM ${schema}.ledger_post ledpost LEFT JOIN ${schema}.ledger led ON ledpost.led_id = led.led_key JOIN ${schema}.account ac ON ac.code = ledpost.post_code AND ac.a_pos = 'A'`
      + ` WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND ledpost.post_date BETWEEN $1 AND $2 AND ledpost.post_code = $3`
      + (hideBooks ? "" : ` AND led.book_code IN (SELECT code FROM ${schema}.account WHERE a_short <> 'CA_ENT')`), [desktopDate(call.from), desktopDate(call.upto), code]);
    rows.push(...lines.rows);
  }

  // The first year's account: heading, opening and closing.
  const first = found[0];
  const open = (await runReportSql(loader, `SELECT btrim(ac.name) AS name, acbal.opening::numeric AS opening, coalesce((SELECT sum(CASE WHEN post_dbcode = 1 THEN post_amt::numeric ELSE 0.00 END) - sum(CASE WHEN post_dbcode = 2 THEN post_amt::numeric ELSE 0.00 END)`
    + ` FROM ${first.schema}.ledger_post WHERE post_date < $1 AND post_code = ac.code), 0) AS before FROM ${first.schema}.account ac LEFT JOIN ${first.schema}.ac_balance acbal ON acbal.code = ac.code WHERE ac.a_pos <> 'D' AND ac.code = $2`, [desktopDate(call.from), first.code])).rows;
  const blank = (values: ResultRow): ResultRow => { const row: ResultRow = {}; for (const column of columns) row[column] = ""; return Object.assign(row, { Debit: 0, Credit: 0, closing_bal: 0 }, values); };
  const seen = new Set<string>();
  const unique = (row: ResultRow) => { const text = JSON.stringify(columns.map((column) => row[column])); if (seen.has(text)) return false; seen.add(text); return true; };
  const all: ResultRow[] = rows.filter(unique);
  for (const row of open) {
    const total = row.opening === null ? null : num(row.opening) + num(row.before);
    const label = toText(row.name);
    for (const candidate of [
      blank({ SORTING_COL: `${label}   O`, ROW_DATA_TYPE: "OPENINGS", SMART_NAME: label, selected_date: ddMmYyyy(call.from), NAME: " Opening Balance B/d", Debit: total !== null && total > 0 ? total : 0, Credit: total !== null && total < 0 ? Math.abs(total) : 0, closing_bal: total ?? 0, DR_CR: total !== null && total < 0 ? "Cr" : "Dr" }),
      blank({ SORTING_COL: `${label}   H`, ROW_DATA_TYPE: "AC", SMART_NAME: label, NAME: label }),
      blank({ SORTING_COL: `${label}zzz`, ROW_DATA_TYPE: "CLOSING", SMART_NAME: label, selected_date: ddMmYyyy(call.upto), NAME: "Closing Balance B/d" }),
    ]) if (unique(candidate)) all.push(candidate);
  }
  // ORDER BY sorting_col: a voucher without a number (a null) last.
  table.rows = all
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = a.row.SORTING_COL as string | null;
      const y = b.row.SORTING_COL as string | null;
      if (x === y) return a.index - b.index;
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -1 : 1;
    })
    .map(({ row }) => row);
  return table;
}

// ======================================================================================
// 106: MULTI YEAR EXPENSE SUMMARY (SP_FRT_RPT_MULTI_YEAR_EXPENSE_SUMMARY_REP; ANALYSIS REP. > Multi Year > Expense)
// ======================================================================================
//
// The same years as 103, each read from its own database, always on From / Upto's day and month in the year. The procedure asks every
// account's debits with a sub-query of its own per column; here a year is two reads (the book 1 accounts with their balance sheet head, the
// postings grouped by account and month) matched in memory, the rows made in multiYearExpense.ts. With three or more years the procedure also
// asks each earlier account's balance sheet head to be the same one; here the name and book are enough.

async function multiYearExpense(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const monthWise = call.checkQuery.includes("CHK_MONTHWISE,");
  const data: ExpenseYear[] = [];
  for (const year of await companyYears(loader, plan)) {
    const schema = toText(year.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','balsheet','ledger','ledger_post')", [schema])).rows[0];
    if (num(exists?.n) < 4) continue;
    const y1 = year.y1 as Date;
    const y2 = year.y2 as Date;
    const inYear = (date: Date) => new Date(date.getMonth() <= 2 ? y2.getFullYear() : y1.getFullYear(), date.getMonth(), date.getDate());
    const from = inYear(call.from);
    const upto = inYear(call.upto);
    const period = [desktopDate(from), desktopDate(upto)];
    const accounts = (await runReportSql(loader, `SELECT ac.code, btrim(ac.name) AS name, ac.a_pos, bal.bs_desc, left(bal.bs_code::text, 2) = '02' AS expense FROM ${schema}.account ac LEFT JOIN ${schema}.balsheet bal ON bal.bs_key = ac.bs_id WHERE ac.book = 1 ORDER BY ac.code`)).rows
      .map((row) => ({ code: num(row.code), name: toText(row.name), live: toText(row.a_pos) === "A", head: toText(row.bs_desc), expense: row.expense === true }));
    const sums = "sum(CASE WHEN ledpost.post_dbcode = 1 THEN ledpost.post_amt::numeric ELSE 0 END) AS dr, sum(CASE WHEN ledpost.post_dbcode = 2 THEN ledpost.post_amt::numeric ELSE 0 END) AS cr";
    const posted = (await runReportSql(loader, `SELECT ledpost.post_code AS code, ${monthWise ? "extract(month FROM ledpost.post_date)::int AS m, grouping(extract(month FROM ledpost.post_date)::int) AS g," : "1 AS g,"} ${sums}`
      + ` FROM ${schema}.ledger led JOIN ${schema}.ledger_post ledpost ON ledpost.led_id = led.led_key JOIN ${schema}.account ac ON ac.code = ledpost.post_code AND ac.book = 1`
      + ` WHERE led.doc_pos <> 'D' AND led.doc_posting = 'P' AND ledpost.post_date BETWEEN $1 AND $2`
      + ` GROUP BY ${monthWise ? "GROUPING SETS ((ledpost.post_code, extract(month FROM ledpost.post_date)::int), (ledpost.post_code))" : "ledpost.post_code"}`, period)).rows;
    const debit = new Map<number, Map<number, number>>();
    const credit = new Map<number, number>();
    for (const row of posted) {
      const code = num(row.code);
      const months = debit.get(code) ?? new Map<number, number>();
      months.set(num(row.g) === 1 ? 0 : num(row.m), num(row.dr));
      debit.set(code, months);
      if (num(row.g) === 1) credit.set(code, num(row.cr));
    }
    data.push({ from, upto, accounts, debit, credit });
  }
  return multiYearExpenseTable(data, monthWise);
}

// ======================================================================================
// 125: MULTI YEAR STOCK LEDGER (SP_FRT_RPT_MULTI_YEAR_STOCK_LEDGER_REP; ANALYSIS REP. > Multi Year > Stock Ledger)
// ======================================================================================
//
// One product (the Product group's single pick) through the company's years meeting From .. Upto: in each year's database the product of the
// same short code, its stock lines between From and Upto (not the year's dates) in the product's first report unit, then the product's heading
// and the first year's opening, the lines in date order with the running CLSG_QTY (what the procedure's UPDATE sums over OCOL1). As the
// single-year stock ledger (reportStandard.ts) takes its lines. The procedure looks up each line's tax name with a sub-query that reads all of
// LEDGER_EXT; here the tax names of the lines' vouchers are read once.
//  - the opening is the first year's, as the procedure (a From after the year's start leaves out what moved before it).

async function multiYearStockLedger(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const key = call.selectKey[4];
  if (key.includes(",")) throw new ReportRefusal("Multiple Product Selection Not Allowed", "INTERNAL PROGRAM FAILURE");
  if (key === "") throw new ReportRefusal("Select a product (Product group)", "INTERNAL PROGRAM FAILURE");
  const db = call.database;
  const factor = call.checkQuery.includes("CHK_FACTCOL,");
  const bundles = call.licence === 2;
  const short = toText((await runReportSql(loader, `SELECT prod_short FROM ${db}PRODUCT_MASTER WHERE prod_pos = 'A' AND prod_key IN ${key} ORDER BY prod_key DESC LIMIT 1`)).rows[0]?.prod_short);
  const columns = ["SORTING_COL", "ROW_DATA_TYPE", "SELECTED_DATE", "FULL_DOCNO", "NAME", "PROD_SHORT", "SELECTED_PRODUCT", "ADD_QTY", "LESS_QTY", "CLSG_QTY", "UOM1", "STOCK_NAT",
    ...(factor ? ["ADD_FACT", "LESS_FACT", "BAL_FACT"] : []), "Rate", ...(factor ? ["UOM2"] : []), "TAX", "DOC_NO1", ...(bundles ? ["ADD_BUNDLE", "LESS_BUNDLE", "BAL_BUNDLE", "PACKING"] : [])];
  const table = new ResultTable();
  for (const column of columns) table.addColumn(column);
  for (const column of ["ADD_QTY", "LESS_QTY", "CLSG_QTY", "Rate", ...(factor ? ["ADD_FACT", "LESS_FACT", "BAL_FACT"] : []), ...(bundles ? ["ADD_BUNDLE", "LESS_BUNDLE", "BAL_BUNDLE", "PACKING"] : [])]) table.setKind(column, "decimal");
  if (short === "") return table;

  const years: { schema: string; code: number }[] = [];
  for (const year of await companyYears(loader, plan)) {
    const schema = toText(year.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('product_master','prod_ledger','prod_balance','prod_uom','level_master','account')", [schema])).rows[0];
    if (num(exists?.n) < 6) continue;
    const product = (await runReportSql(loader, `SELECT prod_key FROM ${schema}.product_master WHERE prod_short = $1 AND prod_pos <> 'D' ORDER BY prod_key DESC LIMIT 1`, [short])).rows[0];
    years.push({ schema, code: num(product?.prod_key) });
  }
  if (years.length === 0) return table;
  const first = years[0];
  const typeKey = num((await runReportSql(loader, `SELECT book_key FROM ${first.schema}.book_properties WHERE stkm_pos = 'A' AND stkm_id = 'NR' ORDER BY stkmodule LIMIT 1`)).rows[0]?.book_key);
  const hideBooks = [19, 29, 68, 73].includes(call.licence)
    && num((await runReportSql(loader, `SELECT count(*)::int AS n FROM ${first.schema}.account WHERE a_pos <> 'D' AND strpos(a_short, 'CA_ENT') > 0`)).rows[0]?.n) === 0;

  const description = (p: string) => `case when level.div_maxlvl = level.stock_level then ${p}.prod_desc when level.stock_level = 1 then ${p}.desc_1 when level.stock_level = 2 then ${p}.desc_1 || ' ' || ${p}.desc_2`
    + ` when level.stock_level = 3 then ${p}.desc_1 || ' ' || ${p}.desc_2 || ' ' || ${p}.desc_3 when level.stock_level = 4 then ${p}.desc_1 || ' ' || ${p}.desc_2 || ' ' || ${p}.desc_3 || ' ' || ${p}.desc_4 else ' ' end`;
  const unit = (side: "rep1_uom" | "rep2_uom", pick: (column: string) => string, other: string) => `case ${["pcs", "qty1", "qty2", "qty3", "pack", "weight"].map((name) => `when p.${side} = p.${name}_uom then ${pick(name === "pcs" ? "trn_pcs" : name === "pack" ? "trn_pack" : name === "weight" ? "trn_weight" : `trn_${name}`)}`).join(" ")} else ${other} end`;
  const moved = (nature: "A" | "L", whole: string) => `case pl.stock_nat when '${nature}' then ${unit("rep1_uom", (column) => `case when pl.trn_module = '${whole}' then pl.${column} else pl.${column} - pl.ag_qty end`, "case when pl.trn_module = '" + whole + "' then pl.trn_pcs else pl.trn_pcs - pl.ag_qty end")} else 0.00 end`;
  const openingUnit = (side: "rep1_uom" | "rep2_uom") => `case ${[["pcs", "open_pcs"], ["qty1", "open_qty1"], ["qty2", "open_qty2"], ["qty3", "open_qty3"], ["pack", "open_pack"], ["weight", "open_weight"]].map(([name, column]) => `when p.${side} = p.${name}_uom then pb.${column}`).join(" ")} else pb.open_pcs end`;

  type Line = { date: Date; year: number; nature: string; key: number; row: ResultRow };
  const lines: Line[] = [];
  for (const [index, { schema, code }] of years.entries()) {
    if (code === 0) continue;
    const fetched = await runReportSql(loader, `SELECT pl.il_key, pl.il_date, to_char(pl.il_date, 'DD/MM/YYYY') AS d, pl.full_docno, ac.name AS ac_name, p.prod_short, ${description("p")} AS selected_product,`
      + ` ${moved("A", "JOB-IN")} AS add_qty, ${moved("L", "JOB-OUT")} AS less_qty, (SELECT u.uom_short FROM ${schema}.prod_uom u WHERE u.uom_key = p.rep1_uom) AS uom1, pl.stock_nat,`
      + ` case pl.stock_nat when 'A' then pl.factor - round((pl.ag_qty / pl.quantity * pl.trn_qty1)::numeric, 4) else 0.00 end AS add_fact, case pl.stock_nat when 'L' then pl.factor - round((pl.ag_qty / pl.quantity * pl.trn_qty1)::numeric, 4) else 0.00 end AS less_fact,`
      + ` coalesce(pl.rate, 0) AS rate, (SELECT u.uom_short FROM ${schema}.prod_uom u WHERE u.uom_key = p.rep2_uom) AS uom2, pl.doc_no1, pl.led_id,`
      + ` case pl.stock_nat when 'A' then pl.bundle - coalesce(pl.ag_pack, 0) else 0.00 end AS add_bundle, case pl.stock_nat when 'L' then pl.bundle - coalesce(pl.ag_pack, 0) else 0.00 end AS less_bundle, pl.pack_qty`
      + ` FROM ${schema}.prod_ledger pl JOIN ${schema}.product_master p ON pl.prod_id = p.prod_key LEFT JOIN ${schema}.account ac ON pl.code = ac.code LEFT JOIN ${schema}.level_master level ON p.prod_group = level.prod_group`
      + ` WHERE p.inventory = 'Y' AND p.prod_pos <> 'D' AND pl.inventory = 'Y' AND pl.il_pos = 'A' AND (pl.quantity - pl.ag_qty > 0 OR pl.trn_module = 'JOB-OUT' OR pl.trn_module = 'JOB-IN')`
      + ` AND pl.il_date BETWEEN $1 AND $2 AND p.prod_key = $3 AND pl."TYPE" <> $4`
      + (hideBooks ? "" : ` AND pl.book_code IN (SELECT code FROM ${schema}.account WHERE a_pos = 'A')`), [desktopDate(call.from), desktopDate(call.upto), code, typeKey]);
    for (const row of fetched.rows) {
      lines.push({ date: row.il_date as Date, year: index, nature: toText(row.stock_nat), key: num(row.il_key), row: { ...row, schema } });
    }
  }
  // The tax name of a line's voucher: the lowest tax of its LEDGER_EXT lines (the procedure's TOP 1).
  const taxOf = new Map<string, string>();
  for (const { schema } of years) {
    const ids = [...new Set(lines.filter((line) => line.row.schema === schema && line.row.led_id !== null).map((line) => num(line.row.led_id)))];
    if (ids.length === 0) continue;
    const taxes = new Map((await runReportSql(loader, `SELECT tax_rec, tax_repohd FROM ${schema}.tax_master`)).rows.map((row) => [num(row.tax_rec), toText(row.tax_repohd)] as const));
    const best = new Map<number, number>();
    for (const row of (await runReportSql(loader, `SELECT led_id, tax_id FROM ${schema}.ledger_ext WHERE led_id = ANY($1::int[]) AND tax_id IS NOT NULL`, [ids])).rows) {
      const led = num(row.led_id);
      const tax = num(row.tax_id);
      if (taxes.has(tax) && (!best.has(led) || tax < best.get(led)!)) best.set(led, tax);
    }
    for (const [led, tax] of best) taxOf.set(`${schema}:${led}`, taxes.get(tax)!);
  }

  const money2 = (value: number) => Math.round(value * 10000) / 10000;
  const blank = (values: ResultRow): ResultRow => {
    const row: ResultRow = {};
    for (const column of columns) row[column] = ["ADD_QTY", "LESS_QTY", "CLSG_QTY", "Rate", "ADD_FACT", "LESS_FACT", "BAL_FACT", "ADD_BUNDLE", "LESS_BUNDLE", "BAL_BUNDLE", "PACKING"].includes(column) ? 0 : "";
    return Object.assign(row, values);
  };
  const out: ResultRow[] = [];
  // The first year's heading and opening (only a product with an opening gets one).
  if (first.code !== 0) {
    const head = (await runReportSql(loader, `SELECT p.prod_short, ${description("p")} AS selected_product, ${openingUnit("rep1_uom")} AS add_qty, ${openingUnit("rep2_uom")} AS add_fact,`
      + ` (SELECT u.uom_short FROM ${first.schema}.prod_uom u WHERE u.uom_key = p.rep1_uom) AS uom1, (SELECT u.uom_short FROM ${first.schema}.prod_uom u WHERE u.uom_key = p.rep2_uom) AS uom2, pb.open_pcs,`
      + ` coalesce((SELECT sum(open_pack) FROM ${first.schema}.prod_balance WHERE prec_flag = 'PK' AND prod_id = p.prod_key), 0.00) AS bundles`
      + ` FROM ${first.schema}.product_master p LEFT JOIN ${first.schema}.prod_balance pb ON pb.prod_id = p.prod_key LEFT JOIN ${first.schema}.level_master level ON p.prod_group = level.prod_group`
      + ` WHERE p.prod_pos <> 'D' AND p.inventory = 'Y' AND pb.prec_flag = 'RP' AND p.prod_key = $1`, [first.code])).rows;
    for (const row of head) {
      const name = toText(row.prod_short);
      const common = { PROD_SHORT: name, SELECTED_PRODUCT: toText(row.selected_product) };
      out.push(blank({ ...common, SORTING_COL: `${name}   H`, ROW_DATA_TYPE: "AC", NAME: name }));
      if (num(row.open_pcs) !== 0) out.push(blank({ ...common, SORTING_COL: `${name}   O`, ROW_DATA_TYPE: "OPENINGS", SELECTED_DATE: ddMmYyyy(call.from), NAME: "Opening", ADD_QTY: num(row.add_qty), UOM1: toText(row.uom1), ADD_FACT: num(row.add_fact), UOM2: toText(row.uom2), ADD_BUNDLE: num(row.bundles) }));
    }
  }
  lines.sort((a, b) => a.date.getTime() - b.date.getTime() || a.year - b.year || (a.nature < b.nature ? -1 : a.nature > b.nature ? 1 : 0) || a.key - b.key);
  lines.forEach((line, index) => {
    const { row } = line;
    const name = toText(row.prod_short);
    out.push(blank({
      SORTING_COL: `${name}   P${toText(row.d).split("/").reverse().join("")}LED ${String(index + 1).padStart(10, "0")}`, ROW_DATA_TYPE: "LED", SELECTED_DATE: toText(row.d), FULL_DOCNO: row.full_docno, NAME: row.ac_name, PROD_SHORT: name,
      SELECTED_PRODUCT: toText(row.selected_product), ADD_QTY: num(row.add_qty), LESS_QTY: num(row.less_qty), UOM1: toText(row.uom1), STOCK_NAT: row.stock_nat, ADD_FACT: num(row.add_fact), LESS_FACT: num(row.less_fact),
      Rate: num(row.rate), UOM2: toText(row.uom2), TAX: taxOf.get(`${toText(row.schema)}:${num(row.led_id)}`) ?? null, DOC_NO1: row.doc_no1, ADD_BUNDLE: num(row.add_bundle), LESS_BUNDLE: num(row.less_bundle), PACKING: num(row.pack_qty),
    }));
  });
  // The running CLSG_QTY (and the factor / bundle balances): the sum of the product's rows up to the row (the heading excepted).
  let balance = 0;
  let balanceFact = 0;
  let balanceBundle = 0;
  for (const row of out) {
    if (row.ROW_DATA_TYPE === "AC") continue;
    balance = money2(balance + num(row.ADD_QTY) - num(row.LESS_QTY));
    balanceFact = money2(balanceFact + num(row.ADD_FACT) - num(row.LESS_FACT));
    balanceBundle = money2(balanceBundle + num(row.ADD_BUNDLE) - num(row.LESS_BUNDLE));
    row.CLSG_QTY = balance;
    if (factor) row.BAL_FACT = balanceFact;
    if (bundles) row.BAL_BUNDLE = balanceBundle;
  }
  table.rows = out;
  return table;
}

// ======================================================================================
// 133: MULTI YEAR PARTY STOCK (SP_FRT_RPT_MULTI_YEAR_PARTY_STOCK_REP; ANALYSIS REP. > Multi Year > Party Wise Stock)
// ======================================================================================
//
// One party (the Account group's single pick) through the company's years meeting From .. Upto: in each year's database the account of the
// same name, its stock lines between From and Upto (not the year's dates), one row each (quantity in or out, rate, unit, purchase / sale value),
// in SORTING_COL order. The first combo is SALE (8: a debtor, its sale, purchase and credit note lines) or PURCHASE (13: a creditor, its
// purchase, debit note and sale lines). As the procedure there is no heading, opening or total row; identical rows are dropped as its UNION does.
// MRP_RATE shows when the setup's entry_para does not have X_MRP.

async function multiYearPartyStock(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const key = call.selectKey[4];
  if (key.includes(",")) throw new ReportRefusal("Multiple Account Selection Not Allowed", "INTERNAL PROGRAM FAILURE");
  if (key === "") throw new ReportRefusal("Select an account (Account group)", "INTERNAL PROGRAM FAILURE");
  const db = call.database;
  const name = toText((await runReportSql(loader, `SELECT btrim(name) AS name FROM ${db}ACCOUNT WHERE a_pos = 'A' AND code IN ${key} ORDER BY code DESC LIMIT 1`)).rows[0]?.name);
  const sale = call.fcValue === 8;
  const columns = ["SORTING_COL", "ROW_DATA_TYPE", "SMART_NAME", "selected_date", "FULL_DOCNO", "DOC_NO1", "NAME", "PROD_DESC", "ADD_QTY", "LESS_QTY"];
  const table = new ResultTable();
  const years: { schema: string; code: number }[] = [];
  for (const year of await companyYears(loader, plan)) {
    const schema = toText(year.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','prod_ledger','product_master','prod_uom','setup')", [schema])).rows[0];
    if (num(exists?.n) < 5) continue;
    const account = name === "" ? undefined : (await runReportSql(loader, `SELECT code FROM ${schema}.account WHERE btrim(name) = $1 AND a_pos <> 'D' ORDER BY code DESC LIMIT 1`, [name])).rows[0];
    years.push({ schema, code: num(account?.code) });
  }
  const mrp = years.length > 0 && ((await runReportSql(loader, `SELECT position('X_MRP,' in entry_para) AS at FROM ${years[0].schema}.setup`)).rows[0]?.at ?? 0) === 0;
  columns.push(...(mrp ? ["MRP_RATE"] : []), "RATE", "UOM_SHORT", "PURCH_VALUE", "SALE_VALUE");
  for (const column of columns) table.addColumn(column);
  for (const column of ["ADD_QTY", "LESS_QTY", "MRP_RATE", "RATE", "PURCH_VALUE", "SALE_VALUE"]) if (columns.includes(column)) table.setKind(column, "decimal");
  if (years.length === 0) return table;

  const hideBooks = [19, 29, 68, 73].includes(call.licence)
    && num((await runReportSql(loader, `SELECT count(*)::int AS n FROM ${years[0].schema}.account WHERE a_pos <> 'D' AND strpos(a_short, 'CA_ENT') > 0`)).rows[0]?.n) === 0;
  const seen = new Set<string>();
  const rows: ResultRow[] = [];
  for (const { schema, code } of years) {
    if (code === 0) continue;
    const lines = await runReportSql(loader, `SELECT ac.name || '   P' || to_char(prodled.il_date, 'YYYYMMDD') || prodled.full_docno || prodled.il_key::text || 'LED' AS "SORTING_COL", 'LED' AS "ROW_DATA_TYPE", ac.name AS "SMART_NAME",`
      + ` to_char(prodled.il_date, 'DD/MM/YYYY') AS "selected_date", prodled.full_docno AS "FULL_DOCNO", prodled.doc_no1 AS "DOC_NO1", ac.name AS "NAME", prodmas.prod_desc AS "PROD_DESC",`
      + ` CASE WHEN prodled.stock_nat = 'A' THEN prodled.quantity ELSE 0.00 END AS "ADD_QTY", CASE WHEN prodled.stock_nat = 'L' THEN prodled.quantity ELSE 0.00 END AS "LESS_QTY",`
      + (mrp ? ` prodled.master_rate::numeric AS "MRP_RATE",` : "") + ` prodled.rate::numeric AS "RATE", prduom.uom_short AS "UOM_SHORT",`
      + ` CASE WHEN prodled.stock_nat = 'A' THEN prodled.il_value::numeric ELSE 0.00 END AS "PURCH_VALUE", CASE WHEN prodled.stock_nat = 'L' THEN prodled.il_value::numeric ELSE 0.00 END AS "SALE_VALUE"`
      + ` FROM ${schema}.prod_ledger prodled LEFT JOIN ${schema}.account ac ON ac.code = prodled.code LEFT JOIN ${schema}.product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${schema}.prod_uom prduom ON prduom.uom_key = prodled.rateuom_id`
      + ` WHERE prodled.il_pos <> 'D' AND ac.a_pos = 'A' AND prodled.quantity - prodled.ag_qty > 0 AND prodled.inventory = 'Y' AND prodled.il_date BETWEEN $1 AND $2 AND prodled.code = $3`
      + (sale ? " AND ac.book = 2 AND prodled.book IN (8, 13, 16)" : " AND ac.book = 3 AND prodled.book IN (13, 11, 8)")
      + (hideBooks ? "" : ` AND prodled.book_code IN (SELECT code FROM ${schema}.account WHERE a_pos = 'A')`), [desktopDate(call.from), desktopDate(call.upto), code]);
    for (const row of lines.rows) {
      const text = JSON.stringify(columns.map((column) => row[column]));
      if (!seen.has(text)) { seen.add(text); rows.push(row); }
    }
  }
  table.rows = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = a.row.SORTING_COL as string | null;
      const y = b.row.SORTING_COL as string | null;
      if (x === y) return a.index - b.index;
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -1 : 1;
    })
    .map(({ row }) => row);
  return table;
}

// ======================================================================================
// 176: MULTI YEAR PARTY PRODUCT ADDON SALE (SP_FRT_RPT_MULTI_YEAR_PARTY_PRODADDON_SALE; ANALYSIS REP. > Multi Year > Party Product Addon Sale)
// ======================================================================================
//
// What each party bought, by the product addon groups (the master addon fields of the products: PRODGROUP, PRODTYPE ...), year by year: the
// sale book's stock lines (with a voucher) of each of the company's years (as report 103, the year's own dates), the quantity added up by party
// and addon values. A column a year (Sale_25_26), or with Month Wise Require a column a month, April first (Apr_25_26 ...), and TOTAL; rows
// by party name. Licence 2 counts TRN_QTY3.
//  - The procedure's addon fields are read with FIEL_ENTRYPOS = '' (nothing is found); here the products' master fields (FIEL_ENTRYPOS = 'N') as
//    the other reports take them.
//  - Month Wise: the procedure names the groups by the day (IL_DATE) and so none of its month columns is filled; here a month's column holds
//    the quantity of its month.

async function multiYearPartyProductAddonSale(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const monthWise = call.checkQuery.includes("CHK_MONTHWISE,");
  const quantity = call.licence === 2 ? "sum(prodled.trn_qty3)" : "sum(prodled.quantity - prodled.ag_qty)";
  const fields = (await runReportSql(loader, `SELECT btrim(fiel_save) AS save FROM ${db}ADDON_FLD WHERE fiel_pos = 'A' AND fiel_type = 'M' AND fiel_relate = 'P' AND fiel_masterpos = 'Y' AND fiel_entrypos = 'N' ORDER BY fiel_serial`)).rows
    .map((row) => toText(row.save)).filter((name) => /^[A-Za-z0-9_]+$/.test(name));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fiscal = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  const yy = (date: Date) => String(date.getFullYear()).slice(-2);

  const table = new ResultTable();
  table.addColumn("SMART_NAME");
  table.addColumn("NAME");
  type Group = { name: string; addons: string[]; values: Map<string, number> };
  const groups = new Map<string, Group>();
  const usable: string[] = [];
  const valueColumns: string[] = [];
  let first = true;
  for (const year of await companyYears(loader, plan)) {
    const schema = toText(year.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('prod_ledger','addon_data','account')", [schema])).rows[0];
    if (num(exists?.n) < 3) continue;
    if (first) {
      // The addon fields this database has a text column for.
      const have = new Set((await runReportSql(loader, "SELECT lower(column_name) AS name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'addon_data'", [schema])).rows.map((row) => toText(row.name)));
      usable.push(...fields.filter((name) => have.has(`txt_${name.toLowerCase()}`)));
      first = false;
    }
    const y1 = year.y1 as Date;
    const y2 = year.y2 as Date;
    const label = `${yy(y1)}_${yy(y2)}`;
    const columns = monthWise ? fiscal.map((month) => ({ month, name: `${MONTHS[month - 1]}_${label}` })) : [{ month: 0, name: `Sale_${label}` }];
    for (const column of columns) valueColumns.push(column.name);
    const addonSelect = usable.map((name) => `padata.txt_${name} AS "${name}"`).join(", ");
    const addonGroup = usable.map((name) => `padata.txt_${name}`).join(", ");
    const rows = (await runReportSql(loader, `SELECT ac.name AS name${addonSelect === "" ? "" : `, ${addonSelect}`}, ${monthWise ? "extract(month FROM prodled.il_date)::int" : "0"} AS m, ${quantity} AS qty`
      + ` FROM ${schema}.prod_ledger prodled LEFT JOIN ${schema}.addon_data padata ON padata.prod_id = prodled.prod_id LEFT JOIN ${schema}.account ac ON ac.code = prodled.code`
      + ` WHERE prodled.il_pos = 'A' AND prodled.inventory = 'Y' AND prodled.book = 8 AND prodled.led_id IS NOT NULL AND prodled.il_date BETWEEN $1 AND $2`
      + ` GROUP BY ac.name${addonGroup === "" ? "" : `, ${addonGroup}`}${monthWise ? ", extract(month FROM prodled.il_date)::int" : ""}`, [desktopDate(y1), desktopDate(y2)])).rows;
    for (const row of rows) {
      const addons = usable.map((name) => toText(row[name]));
      const key = JSON.stringify([row.name === null ? null : toText(row.name), addons]);
      const group = groups.get(key) ?? { name: row.name === null ? "" : toText(row.name), addons, values: new Map<string, number>() };
      const column = columns.find((candidate) => candidate.month === num(row.m));
      if (column) group.values.set(column.name, (group.values.get(column.name) ?? 0) + num(row.qty));
      groups.set(key, group);
    }
  }
  for (const name of usable) table.addColumn(name);
  for (const name of valueColumns) table.setKind(name, "decimal");
  table.setKind("TOTAL", "decimal");
  table.rows = [...groups.values()]
    .map((group, index) => ({ group, index }))
    .sort((a, b) => (a.group.name.toUpperCase() === b.group.name.toUpperCase() ? a.index - b.index : a.group.name.toUpperCase() < b.group.name.toUpperCase() ? -1 : 1))
    .map(({ group }) => {
      const row: ResultRow = { SMART_NAME: group.name, NAME: group.name };
      usable.forEach((name, at) => { row[name] = group.addons[at]; });
      let total = 0;
      for (const name of valueColumns) { const value = group.values.get(name); row[name] = value === undefined ? null : value; total += value ?? 0; }
      row.TOTAL = Math.round(total * 100) / 100;
      return row;
    });
  return table;
}

// ======================================================================================
// 267: MULTI YEAR TOP REPORTS (SP_FRT_RPT_MULTY_YEAR_TOP_REPORTS; ANALYSIS REP. > Multi Year > Top Report)
// ======================================================================================
//
// The first combo's Customers / Suppliers (by amount), Item Sold / Purchase by Value, Item Sold / Purchase by Quantity, for each of the company's
// years (as report 103, at most ten) on its own database between From and Upto (the dates chosen, not the year's). Without Year As a Column: a
// row a party / item of each year (YEAR_NAME, Row_No, name, amount ...) ordered by year, then amount (quantity) high first, and with Top Record
// the first N of each year. With Year As a Column Require: a row a party / item, a column a year (2025_2026) and TOTAL, those with something
// in a year only, ordered by TOTAL high first, and with Top Record the first N.
// The amounts as the procedure takes them (the sale / purchase vouchers with the credit / debit notes against them; the stock lines' value or
// quantity less the returns), not as the single year Top Reports (211) does. The procedure looks up each customer's quantity with a sub-query
// that reads the stock lines once a customer; here it is one grouped read.

async function multiYearTopReports(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const text = call.fcText.trim().toLowerCase();
  const book = ["customers", "item sold by value", "item sold by quantity"].includes(text) ? 8 : 13;
  const returns = book === 8 ? 16 : 11;
  const mode = text === "customers" || text === "suppliers" ? "party" : text.endsWith("by value") ? "value" : "quantity";
  const yearColumn = call.checkQuery.includes("CHK_YEARCOL,");
  const limitText = call.text.find((value) => value.trim() !== "")?.trim() ?? "";
  const limit = limitText !== "" && Number.isFinite(Number(limitText)) ? Math.trunc(Number(limitText)) : 0;
  const period = [desktopDate(call.from), desktopDate(call.upto)];
  const licenceHides = [19, 29, 68, 73].includes(call.licence);

  type Entry = { name: string; amount: number; closing: number | null; invoices: number; quantity: number; stock: number | null };
  const perYear: { label: string; entries: Entry[] }[] = [];
  let hideBooks = true;
  let checkedHide = false;
  for (const year of await companyYears(loader, plan)) {
    const schema = toText(year.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('ledger','account','ac_balance','prod_ledger','product_master','prod_balance','addon_data')", [schema])).rows[0];
    if (num(exists?.n) < 7) continue;
    if (licenceHides && !checkedHide) {
      hideBooks = num((await runReportSql(loader, `SELECT count(*)::int AS n FROM ${schema}.account WHERE a_pos <> 'D' AND strpos(a_short, 'CA_ENT') > 0`)).rows[0]?.n) > 0;
      checkedHide = true;
    }
    const hide = !hideBooks && licenceHides;
    const label = `${(year.y1 as Date).getFullYear()}_${(year.y2 as Date).getFullYear()}`;
    const finishGoods = call.licence === 21 && book === 8 ? " AND adata.txt_prodtype = 'Finish Goods'" : "";
    let rows: ResultRow[];
    if (mode === "party") {
      const amount = book === 8
        ? "sum(CASE WHEN led.ag_book = 8 AND led.ac_dbcode = 2 THEN led.amount::numeric * -1 WHEN led.ag_book = 8 AND led.ac_dbcode = 1 THEN led.amount::numeric WHEN led.ag_book = 0 THEN led.amount::numeric END)"
        : "sum(CASE WHEN led.ag_book = 13 AND led.ac_dbcode = 1 THEN led.amount::numeric * -1 WHEN led.ag_book = 13 AND led.ac_dbcode = 2 THEN led.amount::numeric WHEN led.ag_book = 0 THEN led.amount::numeric END)";
      rows = (await runReportSql(loader, `SELECT ac.name AS name, ${amount} AS amount, acbal.closing::numeric AS clsg_bal, count(*)::int AS invoices, coalesce(q.qty, 0) AS qty`
        + ` FROM ${schema}.ledger led LEFT JOIN ${schema}.account ac ON ac.code = led.code LEFT JOIN ${schema}.ac_balance acbal ON acbal.code = ac.code`
        + ` LEFT JOIN (SELECT code, sum(CASE WHEN book = ${book} THEN quantity - ag_qty ELSE quantity * -1 END) AS qty FROM ${schema}.prod_ledger WHERE il_pos = 'A' AND book IN (${book}, ${returns}) AND il_date BETWEEN $1 AND $2 AND inventory = 'Y' AND led_id > 0 GROUP BY code) q ON q.code = led.code`
        + ` WHERE led.doc_pos <> 'D' AND ac.a_pos <> 'D' AND led.doc_posting = 'P' AND led.doc_date BETWEEN $1 AND $2 AND led.book IN (${book}, 11, 16) AND (led.ag_book = ${book} OR coalesce(led.ag_book, 0) = 0)`
        + (hide ? ` AND led.book_code IN (SELECT code FROM ${schema}.account WHERE a_short <> 'CA_ENT')` : "")
        + ` GROUP BY led.code, ac.name, acbal.closing, q.qty`, period)).rows;
    } else if (mode === "value") {
      rows = (await runReportSql(loader, `SELECT prodmas.prod_desc AS name, sum(CASE WHEN prodled.book = ${book} THEN prodled.il_value::numeric ELSE prodled.il_value::numeric * -1 END) AS amount`
        + ` FROM ${schema}.prod_ledger prodled LEFT JOIN ${schema}.product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${schema}.account ac ON ac.code = prodled.code LEFT JOIN ${schema}.addon_data adata ON adata.prod_id = prodled.prod_id`
        + ` WHERE prodled.il_pos <> 'D' AND prodled.inventory = 'Y' AND prodmas.prod_pos <> 'D' AND ac.a_pos <> 'D' AND prodled.quantity - prodled.ag_qty > 0 AND prodled.il_value > 0 AND prodled.il_date BETWEEN $1 AND $2${finishGoods}`
        + ` AND prodled.book IN (${book === 8 ? "8, 16" : "13, 11"})` + (hide ? ` AND prodled.book_code IN (SELECT code FROM ${schema}.account WHERE a_short <> 'CA_ENT')` : "")
        + ` GROUP BY prodled.prod_id, prodmas.prod_desc`, period)).rows;
    } else {
      const quantity = call.licence === 2 ? "prodled.trn_qty1" : "(prodled.quantity - prodled.ag_qty)";
      const negative = call.licence === 2 ? "prodled.trn_qty1" : "prodled.quantity";
      const stock = "case when prodmas.rep1_uom = prodmas.pcs_uom then prodbal.clsg_pcs when prodmas.rep1_uom = prodmas.qty1_uom then prodbal.clsg_qty1 when prodmas.rep1_uom = prodmas.qty2_uom then prodbal.clsg_qty2"
        + " when prodmas.rep1_uom = prodmas.qty3_uom then prodbal.clsg_qty3 when prodmas.rep1_uom = prodmas.pack_uom then prodbal.clsg_pack when prodmas.rep1_uom = prodmas.weight_uom then prodbal.clsg_weight else prodbal.clsg_pcs end";
      rows = (await runReportSql(loader, `SELECT prodmas.prod_desc AS name, sum(CASE WHEN prodled.book = ${book} THEN ${quantity} ELSE ${negative} * -1 END) AS qty, ${stock} AS stock`
        + ` FROM ${schema}.prod_ledger prodled LEFT JOIN ${schema}.product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${schema}.account ac ON ac.code = prodled.code`
        + ` LEFT JOIN ${schema}.prod_balance prodbal ON prodbal.prod_id = prodmas.prod_key LEFT JOIN ${schema}.addon_data adata ON adata.prod_id = prodled.prod_id`
        + ` WHERE prodled.il_pos <> 'D' AND prodled.inventory = 'Y' AND prodbal.prec_flag = 'RP' AND prodmas.prod_pos <> 'D' AND ac.a_pos <> 'D' AND prodled.quantity - prodled.ag_qty > 0 AND prodled.il_date BETWEEN $1 AND $2${finishGoods}`
        + ` AND prodled.book IN (${book === 8 ? "8, 16" : "13, 11"})` + (hide ? ` AND prodled.book_code IN (SELECT code FROM ${schema}.account WHERE a_short <> 'CA_ENT')` : "")
        + ` GROUP BY prodled.prod_id, prodmas.prod_desc, prodmas.rep1_uom, prodmas.pcs_uom, prodmas.qty1_uom, prodmas.qty2_uom, prodmas.qty3_uom, prodmas.pack_uom, prodmas.weight_uom, prodbal.clsg_pcs, prodbal.clsg_qty1, prodbal.clsg_qty2, prodbal.clsg_qty3, prodbal.clsg_pack, prodbal.clsg_weight`, period)).rows;
    }
    perYear.push({
      label,
      entries: rows.map((row) => ({
        name: toText(row.name), amount: num(row.amount), closing: row.clsg_bal === undefined || row.clsg_bal === null ? null : num(row.clsg_bal), invoices: num(row.invoices),
        quantity: mode === "party" || mode === "quantity" ? num(row.qty) : 0, stock: row.stock === undefined || row.stock === null ? null : num(row.stock),
      })),
    });
  }

  const figure = (entry: Entry) => (mode === "quantity" ? entry.quantity : entry.amount);
  const byName = (a: string, b: string) => (a.toUpperCase() === b.toUpperCase() ? 0 : a.toUpperCase() < b.toUpperCase() ? -1 : 1);
  const table = new ResultTable();
  if (!yearColumn) {
    for (const column of ["YEAR_NAME", "SMART_NAME", "Row_No", "name", ...(mode === "quantity" ? ["Quantity", "Clsg_Stock"] : ["amount", ...(mode === "party" ? ["clsg_bal", "No_Of_invoice", "Quantity"] : [])])]) table.addColumn(column);
    for (const column of ["amount", "clsg_bal", "Quantity", "Clsg_Stock"]) if (table.has(column)) table.setKind(column, "decimal");
    for (const column of ["Row_No", "No_Of_invoice"]) if (table.has(column)) table.setKind(column, "int");
    for (const { label, entries } of perYear) {
      const ranked = [...entries].sort((a, b) => figure(b) - figure(a) || byName(a.name, b.name));
      ranked.forEach((entry, index) => {
        if (limit > 0 && index + 1 > limit) return;
        const row: ResultRow = { YEAR_NAME: label, SMART_NAME: label, Row_No: index + 1, name: entry.name };
        if (mode === "quantity") { row.Quantity = entry.quantity; row.Clsg_Stock = entry.stock; } else {
          row.amount = entry.amount;
          if (mode === "party") { row.clsg_bal = entry.closing; row.No_Of_invoice = entry.invoices; row.Quantity = entry.quantity; }
        }
        table.rows.push(row);
      });
    }
    return table;
  }
  table.addColumn("name");
  for (const { label } of perYear) table.setKind(label, "decimal");
  table.setKind("TOTAL", "decimal");
  const names = new Map<string, Map<string, number>>();
  for (const { label, entries } of perYear) {
    for (const entry of entries) {
      if (!(figure(entry) > 0)) continue;
      const values = names.get(entry.name) ?? new Map<string, number>();
      values.set(label, (values.get(label) ?? 0) + figure(entry));
      names.set(entry.name, values);
    }
  }
  const rows = [...names.entries()].map(([name, values]) => {
    const row: ResultRow = { name };
    let total = 0;
    for (const { label } of perYear) { const value = values.get(label); row[label] = value === undefined ? null : Math.round(value * 100) / 100; total += value ?? 0; }
    row.TOTAL = Math.round(total * 100) / 100;
    return row;
  }).sort((a, b) => num(b.TOTAL) - num(a.TOTAL) || byName(toText(a.name), toText(b.name)));
  table.rows = limit > 0 ? rows.slice(0, limit) : rows;
  return table;
}

// ======================================================================================
// 279: MULTI YEAR SALES V/S RECEIPT SUMMARY (SP_FRT_RPT_MULTI_YEAR_SALES_RECEIPT_REP; ANALYSIS REP. > Multi Year > Sales V/S Receipt)
// ======================================================================================
//
// A row a month for the SALE (the sale and credit note vouchers of book 8 / 16, debit less credit) and a row a month for the RECEIPT (the cash
// and bank vouchers of books 4 / 6 against the debtors, credit less debit), a column a year (2025_2026) with its share of the side's total
// (2025_2026_PERC) and TOTAL (the years' amounts). The years are those meeting From .. Upto (as report 103, at most ten), each read whole, from
// its own database. With Multi Company Require each year has a pair of columns for every company of the group that has a short name and the
// same year (CO_SHORT_2025_2026). The subtotals under SALE and RECEIPT are the output layer's (SMART_SELECTED_ADDON1).
// The procedure asks each month's amount of the whole ledger once a year, as here (one grouped read each for the sale and the receipt).

async function multiYearSalesReceipt(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const multi = call.checkQuery.includes("CHK_MULTICO,");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const fiscal = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  const cell = (side: "SALE" | "RECEIPT") => ({ side, tag: side === "SALE" ? " S" : "R" });

  type Unit = { schema: string; label: string };
  const units: Unit[] = [];
  for (const year of await companyYears(loader, plan)) {
    const y1 = year.y1 as Date;
    const y2 = year.y2 as Date;
    const suffix = `${y1.getFullYear()}_${y2.getFullYear()}`;
    if (!multi) { units.push({ schema: toText(year.schema_name), label: suffix }); continue; }
    const companies = (await runReportSql(loader, `SELECT lower(btrim(c.co_dataname)) AS schema_name, btrim(c.co_short) AS short FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id`
      + ` WHERE n.c_tarikh1::date = $1::date AND n.c_tarikh2::date = $2::date AND coalesce(btrim(c.co_short), '') <> '' AND c.co_group_name = (SELECT co_group_name FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $3) ORDER BY c.co_short`,
    [desktopDate(y1), desktopDate(y2), call.companyKey])).rows;
    for (const company of companies) units.push({ schema: toText(company.schema_name), label: `${toText(company.short)}_${suffix}` });
  }

  const table = new ResultTable();
  table.addColumn("Particular");
  table.addColumn("SMART_SELECTED_ADDON1");
  table.addColumn("SORTING_COL");
  const present: Unit[] = [];
  const amounts = new Map<string, Map<string, number>>();
  for (const unit of units) {
    if (!/^[a-z0-9_]+$/.test(unit.schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('ledger','account')", [unit.schema])).rows[0];
    if (num(exists?.n) < 2) continue;
    present.push(unit);
    const sale = await runReportSql(loader, `SELECT extract(month FROM doc_date)::int AS m, sum(CASE WHEN ac_dbcode = 1 THEN amount::numeric ELSE amount::numeric * -1 END) AS amount FROM ${unit.schema}.ledger WHERE doc_pos = 'A' AND doc_posting = 'P' AND book IN (8, 16) GROUP BY 1`);
    const receipt = await runReportSql(loader, `SELECT extract(month FROM led.doc_date)::int AS m, sum(CASE WHEN led.ac_dbcode = 2 THEN led.amount::numeric ELSE led.amount::numeric * -1 END) AS amount`
      + ` FROM ${unit.schema}.ledger led LEFT JOIN ${unit.schema}.account ac ON ac.code = led.code WHERE led.doc_pos = 'A' AND led.doc_posting = 'P' AND led.book IN (4, 6) AND ac.book IN (2) GROUP BY 1`);
    for (const [side, rows] of [["SALE", sale.rows], ["RECEIPT", receipt.rows]] as const) {
      const byMonth = new Map<string, number>();
      for (const row of rows) byMonth.set(String(num(row.m)), (byMonth.get(String(num(row.m))) ?? 0) + num(row.amount));
      amounts.set(`${unit.label}\u0000${side}`, byMonth);
    }
  }
  for (const unit of present) { table.setKind(unit.label, "decimal"); table.setKind(`${unit.label}_PERC`, "decimal"); }
  table.setKind("TOTAL", "decimal");

  const sums = (label: string, side: string) => [...(amounts.get(`${label}\u0000${side}`)?.values() ?? [])].reduce((sum, value) => sum + value, 0);
  const rows: ResultRow[] = [];
  for (const { side, tag } of [cell("SALE"), cell("RECEIPT")]) {
    fiscal.forEach((month, index) => {
      if (!present.some((unit) => amounts.get(`${unit.label}\u0000${side}`)?.has(String(month)))) return;
      const row: ResultRow = { Particular: MONTHS[month - 1], SMART_SELECTED_ADDON1: side, SORTING_COL: `${tag}${String(index + 1).padStart(2, "0")}` };
      let total = 0;
      for (const unit of present) {
        const amount = Math.round((amounts.get(`${unit.label}\u0000${side}`)?.get(String(month)) ?? 0) * 100) / 100;
        const whole = sums(unit.label, side);
        row[unit.label] = amount;
        row[`${unit.label}_PERC`] = whole === 0 ? 0 : Math.round(amount / whole * 100 * 100) / 100;
        total += amount;
      }
      row.TOTAL = Math.round(total * 100) / 100;
      rows.push(row);
    });
  }
  table.rows = rows;
  return table;
}

// ======================================================================================
// 281: MULTI YEAR SALES V/S EXPENSE SUMMARY (SP_FRT_RPT_MULTI_YEAR_SALES_EXP_REP; ANALYSIS REP. > Multi Year > Sales V/S Expense)
// ======================================================================================
//
// The SALES line (the sale, credit note and debit note vouchers of book 8: the taxable value when the book has a GST master slab, else the
// voucher amount; parties named like a system company left out) and a line for each expense account (balance sheet code 02-04, debits less
// credits) under its balance sheet head, for each of the company's years meeting From .. Upto (as report 103, at most ten), each read whole from
// its own database: a column a year (2026_2027) with the expense's share of that year's sales (2026_2027_PERC), TOTAL and TOTAL_PERC. With Multi
// Company Require a pair of columns for every company of the group with a short name and the same year (SHORT_2026_2027), and no TOTAL_PERC.
// The expense lines with a TOTAL of 0 or less are left out. The subtotals (the head, then SALES / EXPENSE) are the output layer's.

async function multiYearSalesExpense(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const multi = call.checkQuery.includes("CHK_MULTICO,");
  type Unit = { schema: string; label: string };
  const units: Unit[] = [];
  for (const year of await companyYears(loader, plan)) {
    const y1 = year.y1 as Date;
    const y2 = year.y2 as Date;
    const suffix = `${y1.getFullYear()}_${y2.getFullYear()}`;
    if (!multi) { units.push({ schema: toText(year.schema_name), label: suffix }); continue; }
    const companies = (await runReportSql(loader, `SELECT lower(btrim(c.co_dataname)) AS schema_name, btrim(c.co_short) AS short FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id`
      + ` WHERE n.c_tarikh1::date = $1::date AND n.c_tarikh2::date = $2::date AND coalesce(btrim(c.co_short), '') <> '' AND c.co_group_name = (SELECT co_group_name FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $3) ORDER BY c.co_short`,
    [desktopDate(y1), desktopDate(y2), call.companyKey])).rows;
    for (const company of companies) units.push({ schema: toText(company.schema_name), label: `${toText(company.short)}_${suffix}` });
  }

  type Line = { particular: string; side: string; head: string; sorting: string; amounts: Map<string, number> };
  const lines = new Map<string, Line>();
  const present: Unit[] = [];
  const put = (particular: string, side: string, head: string, sorting: string, label: string, amount: number) => {
    const key = JSON.stringify([particular, side, head, sorting]);
    const line = lines.get(key) ?? { particular, side, head, sorting, amounts: new Map<string, number>() };
    line.amounts.set(label, (line.amounts.get(label) ?? 0) + amount);
    lines.set(key, line);
  };
  for (const unit of units) {
    if (!/^[a-z0-9_]+$/.test(unit.schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('ledger','ledger_post','ledger_ext','account','balsheet','slab_master')", [unit.schema])).rows[0];
    if (num(exists?.n) < 6) continue;
    present.push(unit);
    const s = unit.schema;
    const slab = Math.trunc(num((await runReportSql(loader, `SELECT slab_key FROM ${s}.slab_master WHERE slab_active = 'Y' AND slab_master = 'Y' AND slab_link = 0 AND book = 8 ORDER BY slab_order, slab_key`)).rows.at(-1)?.slab_key));
    const where = `led.doc_pos = 'A' AND led.doc_posting = 'P' AND led.book IN (8, 11, 16) AND (led.ag_book = 8 OR coalesce(led.ag_book, 0) = 0) AND ac.name NOT IN (SELECT name FROM ${SYSTEM_SCHEMA}.company WHERE name IS NOT NULL)`;
    const sale = slab !== 0
      ? `SELECT sum(CASE WHEN led.ac_dbcode = 1 THEN coalesce(ledext.s_lastot::numeric - ledext.slab_amt::numeric, 0) ELSE coalesce(ledext.s_lastot::numeric - ledext.slab_amt::numeric, 0) * -1 END) AS amount`
        + ` FROM ${s}.ledger led LEFT JOIN ${s}.account ac ON ac.code = led.code LEFT JOIN ${s}.ledger_ext ledext ON ledext.led_id = led.led_key AND ledext.il_id IS NULL AND ledext.slab_id = ${slab} WHERE ${where}`
      : `SELECT sum(CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE led.amount::numeric * -1 END) AS amount FROM ${s}.ledger led LEFT JOIN ${s}.account ac ON ac.code = led.code WHERE ${where}`;
    const sales = (await runReportSql(loader, sale)).rows[0];
    if (sales?.amount !== null && sales?.amount !== undefined) put("SALES", "SALES", "SALES", "  SALES", unit.label, num(sales.amount));
    else put("SALES", "SALES", "SALES", "  SALES", unit.label, 0);
    const expense = await runReportSql(loader, `SELECT ac.name AS particular, bs.bs_desc AS head, sum(CASE WHEN ledpost.post_dbcode = 1 THEN ledpost.post_amt::numeric ELSE ledpost.post_amt::numeric * -1 END) AS amount`
      + ` FROM ${s}.ledger_post ledpost LEFT JOIN ${s}.account ac ON ac.code = ledpost.post_code LEFT JOIN ${s}.balsheet bs ON bs.bs_key = ac.bs_id LEFT JOIN ${s}.ledger led ON ledpost.led_id = led.led_key`
      + ` WHERE led.doc_pos = 'A' AND led.doc_posting = 'P' AND ac.a_pos <> 'D' AND coalesce(left(led.doc_no1, 3), '') <> 'END' AND ac.a_posting <> 'N'`
      + ` AND ac.bs_id IN (SELECT bs1.bs_key FROM ${s}.balsheet bs1 WHERE left(bs1.bs_code::text, 2) ~ '^[0-9]+$' AND left(bs1.bs_code::text, 2)::int BETWEEN 2 AND 4) GROUP BY ac.name, bs.bs_desc`);
    for (const row of expense.rows) put(toText(row.particular), "EXPENSE", toText(row.head), "EXPENSE", unit.label, num(row.amount));
  }

  const table = new ResultTable();
  for (const column of ["Particular", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SORTING_COL"]) table.addColumn(column);
  for (const unit of present) { table.setKind(unit.label, "decimal"); table.setKind(`${unit.label}_PERC`, "decimal"); }
  table.setKind("TOTAL", "decimal");
  if (!multi) table.setKind("TOTAL_PERC", "decimal");
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  const salesOf = (label: string) => [...lines.values()].filter((line) => line.side === "SALES").reduce((sum, line) => sum + (line.amounts.get(label) ?? 0), 0);
  const result: ResultRow[] = [];
  for (const line of lines.values()) {
    const row: ResultRow = { Particular: line.particular, SMART_SELECTED_ADDON1: line.side, SMART_SELECTED_ADDON2: line.head, SORTING_COL: line.sorting };
    let total = 0;
    for (const unit of present) {
      const amount = r2(line.amounts.get(unit.label) ?? 0);
      const sales = salesOf(unit.label);
      row[unit.label] = amount;
      row[`${unit.label}_PERC`] = line.side === "EXPENSE" && sales !== 0 ? r2(amount / sales * 100) : 0;
      total += amount;
    }
    row.TOTAL = r2(total);
    if (!multi) row.TOTAL_PERC = null;
    if (line.side === "EXPENSE" && num(row.TOTAL) <= 0) continue;
    result.push(row);
  }
  if (!multi) {
    const sales = result.find((row) => row.SMART_SELECTED_ADDON1 === "SALES");
    const whole = num(sales?.TOTAL);
    for (const row of result) if (row.SMART_SELECTED_ADDON1 === "EXPENSE" && whole !== 0) row.TOTAL_PERC = r2(num(row.TOTAL) / whole * 100);
  }
  // The raw text: SORTING_COL "  SALES" starts with spaces (toText would trim them and put EXPENSE first).
  const key = (value: unknown) => String(value ?? "").toUpperCase();
  table.rows = result
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const column of ["SORTING_COL", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "Particular"]) {
        const x = key(a.row[column]);
        const y = key(b.row[column]);
        if (x !== y) return x < y ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
  return table;
}

// ======================================================================================
// 264: ADDON DETAILS (SP_FRT_RPT_ADDON_DETAILS; ANALYSIS REP. > Addon Detail)
// ======================================================================================
//
// The vouchers of the ticked accounts between From and Upto (not deleted, not Auto/999999), each as a line (date, voucher, party column,
// debit, credit). With addon groups ticked the party column is the account's name and the lines go under a heading for each addon value
// (ADDON_1 .. ADDON_4) and each account (AC); without them the party column is the addon field picked in Input Columns (the account's, or the
// voucher's own) and a voucher it has no text for is left out, as is an account left with none. Summary adds each account's lines up
// (DEBIT, CREDIT, CLOSING = debit - credit). The rows are in SORTING_COL order: addon values, account, date, the headings before their lines.
// The accounts' subtotals and the final total are the output layer's.
//  - The procedure's inserts of the account headings name SMART_SELECTED_ADDON12 with two or more addon groups (its own typo); here ADDON2.
//  - An addon text that is null no longer makes the whole SORTING_COL null (so the line is not lost): it counts as blank.

async function addonDetails(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const summary = call.formating.toUpperCase() === "SUMMARY";
  const levels = [0, 1, 2, 3].filter((at) => call.selectKey[at] !== "");
  const count = levels.length;
  const accountKeys = call.selectKey[4];
  if (accountKeys === "") throw new ReportRefusal("Select the accounts (Account group)", "INTERNAL PROGRAM FAILURE");
  const keyOf = (at: number) => call.addon[at].replace(/ adata\.txt_/i, " adata.key_").replace(/ aentry\.txt_/i, " aentry.key_").trim();
  const textOf = (at: number) => call.addon[at].trim();

  let partyColumn = "ac.name";
  if (count === 0) {
    const field = (await runReportSql(loader, `SELECT btrim(fiel_save) AS save, btrim(fiel_entrypos) AS entrypos FROM ${db}ADDON_FLD WHERE fiel_pos = 'A' AND fiel_desc = $1 LIMIT 1`, [call.slabText])).rows[0];
    const save = toText(field?.save);
    if (!/^[A-Za-z0-9_]+$/.test(save)) throw new ReportRefusal("Select the Input Column (an addon field)", "INTERNAL PROGRAM FAILURE");
    partyColumn = `${toText(field.entrypos) === "N" ? "adata" : "aentry"}.txt_${save}`;
  }

  const select = [`${partyColumn} AS party_name`, "ac.name AS smart_name", "to_char(led.doc_date, 'YYYYMMDD') AS d", "to_char(led.doc_date, 'DD/MM/YYYY') AS selected_date", "led.full_docno AS doc_no",
    "CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE 0.00 END AS debit", "CASE WHEN led.ac_dbcode = 2 THEN led.amount::numeric ELSE 0.00 END AS credit",
    ...levels.map((at, index) => `${textOf(at)} AS a${index}`)];
  const where = [`led.doc_date BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}'`, "led.doc_pos <> 'D'", "led.full_docno <> 'Auto/999999'", `led.code IN ${accountKeys}`,
    ...levels.map((at) => `${keyOf(at)} IN ${call.selectKey[at]}`)];
  const result = await runReportSql(loader, `SELECT ${select.join(", ")} FROM ${db}LEDGER led LEFT JOIN ${db}ADDON_AENTRY aentry ON aentry.aona_ledid = led.led_key LEFT JOIN ${db}ACCOUNT ac ON ac.code = led.code`
    + ` LEFT JOIN ${db}ADDON_DATA adata ON adata.code = led.code WHERE ${where.join(" AND ")}`);

  type Line = { party: string | null; name: string; date: string; shown: string; docNo: string; debit: number; credit: number; addons: string[] };
  let lines: Line[] = result.rows.map((row) => ({
    party: row.party_name === null ? null : toText(row.party_name), name: toText(row.smart_name), date: toText(row.d), shown: toText(row.selected_date), docNo: toText(row.doc_no),
    debit: num(row.debit), credit: num(row.credit), addons: levels.map((_, index) => (row[`a${index}`] === null ? "" : toText(row[`a${index}`]))),
  }));
  // Without addon groups a voucher with no text in the party column is dropped, and so is the account left with no voucher.
  if (count === 0) lines = lines.filter((line) => (line.party ?? "") !== "");

  const addonColumns = levels.map((_, index) => `SMART_SELECTED_ADDON${index + 1}`);
  const columns = summary
    ? ["SORTING_COL", "PARTY_NAME", "SMART_NAME", "DEBIT", "CREDIT", "CLOSING", "ROW_DATA_TYPE", ...addonColumns]
    : ["SORTING_COL", "ROW_DATA_TYPE", "Seelcted_Date", "Doc_No", "Party_Name", "SMART_NAME", "Debit", "Credit", ...addonColumns];
  const table = new ResultTable();
  for (const column of columns) table.addColumn(column);
  for (const column of summary ? ["DEBIT", "CREDIT", "CLOSING"] : ["Debit", "Credit"]) table.setKind(column, "decimal");
  const names = summary ? { party: "PARTY_NAME", debit: "DEBIT", credit: "CREDIT", type: "ROW_DATA_TYPE" } : { party: "Party_Name", debit: "Debit", credit: "Credit", type: "ROW_DATA_TYPE" };
  const prefix = (addons: string[], name: string) => [...addons, name].join(" ");
  const rows: ResultRow[] = [];
  const base = (values: ResultRow): ResultRow => {
    const row: ResultRow = {};
    for (const column of columns) row[column] = null;
    return Object.assign(row, values);
  };
  const addonValues = (addons: string[]) => Object.fromEntries(addonColumns.map((column, index) => [column, addons[index]]));

  if (summary) {
    const groups = new Map<string, { line: Line; debit: number; credit: number }>();
    for (const line of lines) {
      const key = JSON.stringify([line.party, line.name, line.addons]);
      const group = groups.get(key) ?? { line, debit: 0, credit: 0 };
      group.debit += line.debit;
      group.credit += line.credit;
      groups.set(key, group);
    }
    for (const { line, debit, credit } of groups.values()) {
      rows.push(base({ SORTING_COL: `${prefix(line.addons, line.name)}   P`, PARTY_NAME: line.party, SMART_NAME: line.name, DEBIT: debit, CREDIT: credit, CLOSING: Math.round((debit - credit) * 100) / 100, ROW_DATA_TYPE: "LED", ...addonValues(line.addons) }));
    }
  } else {
    for (const line of lines) {
      rows.push(base({ SORTING_COL: `${prefix(line.addons, line.name)} ${line.date}   P`, ROW_DATA_TYPE: "LED", Seelcted_Date: line.shown, Doc_No: line.docNo, Party_Name: line.party, SMART_NAME: line.name, Debit: line.debit, Credit: line.credit, ...addonValues(line.addons) }));
    }
  }
  // The headings: an addon value (ADDON_n) and, in Detail or without addon groups, the account (AC).
  const tails = ["   A", "   A1", "   A2", "   A3"];
  levels.forEach((_, index) => {
    for (const value of new Set(lines.map((line) => line.addons[index]))) {
      if (value === "") continue;
      rows.push(base({ SORTING_COL: `${value}${tails[index]}`, [names.party]: value, [names.type]: `ADDON_${index + 1}`, [addonColumns[index]]: value, ...(summary ? { CLOSING: 0 } : {}) }));
    }
  });
  if (!summary || count === 0) {
    const seen = new Set<string>();
    for (const line of lines) {
      const key = JSON.stringify([line.name, line.addons]);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(base({ SORTING_COL: `${prefix(line.addons, line.name)}   H`, [names.party]: line.name, SMART_NAME: line.name, [names.type]: "AC", ...addonValues(line.addons), ...(summary ? { CLOSING: 0 } : {}) }));
    }
  }
  table.rows = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = a.row.SORTING_COL === null ? null : String(a.row.SORTING_COL).toUpperCase();
      const y = b.row.SORTING_COL === null ? null : String(b.row.SORTING_COL).toUpperCase();
      if (x === y) return a.index - b.index;
      if (x === null) return -1;
      if (y === null) return 1;
      return x < y ? -1 : 1;
    })
    .map(({ row }) => row);
  return table;
}

// ======================================================================================
// 151: FINISH PRODUCT STOCK (SP_FRT_RPT_RPI_FINISH_STOCK; SPECIAL > Extra Report (RP) > Finish Product Stock (Sales Dept.))
// ======================================================================================
//
// The finish goods (the addon PRODTYPE FINISH GOODS) of the ticked products / addon groups, a row each: ITEM, the addon columns, PROD_PACK,
// OPEN_QTY / OPEN_AMT, then what the period (From .. Upto) brought in and took out - PACKING (production), CR_QTY (sale returns), PURCH_QTY,
// STOCK_ADD, DR_QTY (purchase returns), SALE_QTY, STOCK_LESS -, CLSG_QTY (whole pieces), CLSG_BOX_QTY / CLSG_LOOSE_QTY (cartons of PROD_PACK and
// the rest), Rate (the latest sale rate up to Upto), Amount, Plan_Qty (the job cards' planned quantity not yet made), Pend_Order (sale orders
// pending), Transit (purchase orders pending), Hold_Ctn / Hold_Qty / After_Hold_Stock / Hold_Remark. A From after the year's start carries what
// moved before it into OPEN_QTY. Rows with nothing in any of the quantity columns are left out. Ordered by the first addon, ITEM, the other addons.
// Only Production Require: the production of the period instead (PRODUCTION, Rate, Amount), for the products with a approved production line.
// The procedure builds seven temp tables joined by ITEM (the product's description); here each is one grouped read matched by product.
//  - The Hold columns (PRODUCT_MASTER.BUNDLE, HOLD_QTY) are read where the database has them, else 0 (this server's copy has neither).
//  - The procedure joins PROD_BALANCE without its RP flag in the period read, so a product with two balance rows counts its lines twice; here once.

async function finishProductStock(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const production = call.checkQuery.includes("CHK_PRODUCTION,");
  const upto = desktopDate(call.upto);
  const levels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "");
  const aliasOf = (at: number) => /as\s+"([^"]+)"/i.exec(call.headingAddon[at])?.[1] ?? `ADDON${at + 1}`;
  const productKeys = call.selectKey[4] !== "" ? ` AND product.prod_key IN ${call.selectKey[4]}` : "";
  const addonKeys = levels.filter((at) => call.selectKey[at] !== "").map((at) => ` AND ${call.addon[at].trim().replace(/^(adata|aentry)\.txt_/i, "$1.key_")} IN ${call.selectKey[at]}`).join("");
  const schema = db.replace(/\.$/, "");
  const have = new Set((await runReportSql(loader, "SELECT lower(column_name) AS name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'product_master'", [schema.toLowerCase()])).rows.map((row) => toText(row.name)));
  const bundle = have.has("bundle") ? "coalesce(product.bundle, 0)" : "0";
  const holdQty = have.has("hold_qty") ? "coalesce(product.hold_qty, 0)" : "0";
  const addonSelect = levels.map((at, index) => `${call.addon[at].trim()} AS a${index}`).join(", ");
  const trn = "btrim(prodled.trn_module)";
  const producedLine = `prodled.stock_nat = 'A' AND ((${trn} = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD') OR ${trn} = 'PROD-FG' OR ${trn} = 'PROD-SFG' OR (${trn} = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> ''))`;
  const approvedLine = `prodled.stock_nat = 'A' AND ((${trn} = 'PROD-FG' AND proce.ent_approve = 'Yes') OR ${trn} = 'PROD-SFG' OR (${trn} = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> ''))`;
  const rates = new Map((await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, pl_srate::numeric AS rate FROM ${db}PRICELIST WHERE pl_srate::numeric > 0 AND pl_pos <> 'D' AND pl_wefrom <= $1 ORDER BY prod_id, pl_wefrom DESC`, [upto])).rows.map((row) => [num(row.prod_id), num(row.rate)] as const));
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  const names = levels.map((at) => aliasOf(at));
  const addonSelected = levels.map((_, index) => `SMART_SELECTED_ADDON${index + 1}`);

  type Product = { key: number; item: string; pack: number; open: number; holdCtn: number; hold: number; remark: string; addons: string[] };
  const baseWhere = `product.prod_pos <> 'D' AND product.inventory = 'Y'${productKeys}${addonKeys}`;
  const fromProducts = `${db}product_master product LEFT JOIN ${db}prod_balance prodbal ON product.prod_key = prodbal.prod_id AND prodbal.prec_flag = 'RP' INNER JOIN ${db}IDOPT_MASTER idopt ON product.prod_group = idopt.idopt_key LEFT JOIN ${db}ADDON_DATA adata ON adata.prod_id = product.prod_key`;
  const sortRows = (rows: ResultRow[]) => {
    const key = (row: ResultRow, column: string) => toText(row[column]).toUpperCase();
    const order = [addonSelected[0], "ITEM", ...addonSelected.slice(1)].filter((column) => column !== undefined);
    return rows.map((row, index) => ({ row, index })).sort((a, b) => {
      for (const column of order) { const x = key(a.row, column); const y = key(b.row, column); if (x !== y) return x < y ? -1 : 1; }
      return a.index - b.index;
    }).map(({ row }) => row);
  };
  const withAddons = (row: ResultRow, product: Product): ResultRow => {
    levels.forEach((_, index) => { row[names[index]] = product.addons[index]; });
    levels.forEach((_, index) => { row[addonSelected[index]] = product.addons[index]; });
    return row;
  };
  const table = new ResultTable();

  if (production) {
    const fromLines = `${db}product_master product LEFT JOIN ${db}IDOPT_MASTER idopt ON product.prod_group = idopt.idopt_key LEFT JOIN ${db}ADDON_DATA adata ON adata.prod_id = product.prod_key`
      + ` LEFT JOIN ${db}PROD_LEDGER prodled ON prodled.prod_id = product.prod_key LEFT JOIN ${db}PROD_BALANCE prodbal ON prodbal.prod_id = product.prod_key LEFT JOIN ${db}PROCESS proce ON proce.process_key = prodled.process_id`;
    const rows = (await runReportSql(loader, `SELECT product.prod_key, product.prod_desc AS item, product.base_pack AS pack${addonSelect === "" ? "" : `, ${addonSelect}`}, sum(CASE WHEN prodled.stock_nat = 'A' THEN prodled.quantity - prodled.ag_qty ELSE 0.00 END) AS production`
      + ` FROM ${fromLines} WHERE ${baseWhere} AND prodbal.prec_flag = 'RP' AND (${approvedLine}) AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL AND prodled.il_pos = 'A' AND prodled.il_date BETWEEN $1 AND $2`
      + ` GROUP BY product.prod_key, product.prod_desc, product.base_pack${levels.length > 0 ? `, ${levels.map((at) => call.addon[at].trim()).join(", ")}` : ""}`, [desktopDate(call.from), upto])).rows;
    for (const column of ["ITEM", ...names, ...addonSelected]) table.addColumn(column);
    table.setKind("PROD_PACK", "decimal"); table.setKind("PRODUCTION", "decimal"); table.setKind("Rate", "decimal"); table.setKind("Amount", "decimal");
    const out = rows.map((row) => {
      const rate = rates.get(num(row.prod_key)) ?? 0;
      const base: ResultRow = { ITEM: toText(row.item) };
      levels.forEach((_, index) => { base[names[index]] = row[`a${index}`] === null ? null : toText(row[`a${index}`]); base[addonSelected[index]] = base[names[index]]; });
      return Object.assign(base, { PROD_PACK: num(row.pack), PRODUCTION: num(row.production), Rate: rate, Amount: r2(rate * num(row.production)) });
    });
    table.rows = sortRows(out);
    return table;
  }

  const products: Product[] = [];
  const seen = new Set<string>();
  for (const row of (await runReportSql(loader, `SELECT product.prod_key, product.prod_desc AS item, product.base_pack AS pack, coalesce(prodbal.open_pcs::numeric, 0) AS open, ${bundle} AS hold_ctn, ${holdQty} AS hold_qty, coalesce(product.prod_info, '') AS remark${addonSelect === "" ? "" : `, ${addonSelect}`}`
    + ` FROM ${fromProducts} WHERE ${baseWhere} AND upper(btrim(adata.txt_prodtype)) = 'FINISH GOODS'`)).rows) {
    const addons = levels.map((_, index) => (row[`a${index}`] === null ? "" : toText(row[`a${index}`])));
    const key = JSON.stringify([num(row.prod_key), addons]);
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({ key: num(row.prod_key), item: toText(row.item), pack: Math.trunc(num(row.pack)), open: num(row.open), holdCtn: num(row.hold_ctn), hold: num(row.hold_qty), remark: toText(row.remark), addons });
  }
  const keys = [...new Set(products.map((product) => product.key))];

  const sum = (condition: string, quantity: string) => `sum(CASE WHEN ${condition} THEN ${quantity} ELSE 0.00 END)`;
  const net = "prodled.quantity - prodled.ag_qty";
  const movements = async (from: string, to: string, before: boolean) => new Map((await runReportSql(loader, `SELECT prodled.prod_id,`
    + ` ${sum(`(${producedLine}) AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL`, before ? "prodled.quantity" : net)} AS packing,`
    + ` ${sum(`(prodled.book = 16 OR prodled.book = 8) AND prodled.stock_nat = 'A' AND prodled.inventory = 'Y' AND prodled.led_id IS NOT NULL${before ? " AND prodled.rate > 0" : ""}`, net)} AS cr_qty,`
    + ` ${sum(`(prodled.book = 13 OR prodled.book = 14) AND prodled.stock_nat = 'A' AND prodled.inventory = 'Y' AND prodled.led_id IS NOT NULL${before ? " AND prodled.rate > 0" : ""}`, net)} AS purch_qty,`
    + ` ${sum(`(prodled.book = 11 OR prodled.book = 13) AND prodled.stock_nat = 'L' AND prodled.inventory = 'Y' AND prodled.led_id IS NOT NULL${before ? " AND prodled.rate > 0" : ""}`, net)} AS dr_qty,`
    + ` ${sum(`prodled.stock_nat = 'A' AND ${trn} IN ('SVOU-ADD', 'STK-JV', 'JOB-IN') AND upper(left(prodled.full_docno, 4)) <> 'PROD' AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL`, "prodled.quantity")} AS stock_add,`
    + ` ${sum(`(prodled.book = 8 OR prodled.book = 9) AND ${before ? "" : "prodled.stock_nat = 'L' AND "}prodled.inventory = 'Y' AND prodled.led_id IS NOT NULL`, net)} AS sale_qty,`
    + ` ${sum(`prodled.stock_nat = 'L' AND ${trn} IN ('SVOU-LESS', 'STK-JV', 'JOB-OUT', 'PROD-FG') AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL`, before ? "prodled.quantity" : net)} AS stock_less`
    + ` FROM ${db}PROD_LEDGER prodled WHERE prodled.il_pos = 'A' AND prodled.il_date BETWEEN $1 AND $2 AND prodled.prod_id = ANY($3::int[]) GROUP BY prodled.prod_id`, [from, to, keys])).rows.map((row) => [num(row.prod_id), row] as const));
  const period = await movements(desktopDate(call.from), upto, false);
  const between = call.from.getTime() !== call.tarikh1.getTime();
  const before = between ? await movements(desktopDate(call.tarikh1), desktopDate(dayBefore(call.from)), true) : new Map<number, ResultRow>();

  // The job cards' planned quantity not yet made, the sale orders and the purchase orders pending.
  const planned = new Map<number, number>();
  for (const row of (await runReportSql(loader, `SELECT prodplan.prod_id, coalesce(sum(prodplan.plan_qty - coalesce(prodplan.plan_sort, 0)), 0) - coalesce(ep.ent_pend_qty, 0) AS plan_pend`
    + ` FROM ${db}PRODUCTION_PLANING prodplan LEFT JOIN (SELECT prodled.prod_id, aent.input_job_card, sum(CASE WHEN (${producedLine.replace("OR " + trn + " = 'PROD-FG'", `OR (${trn} = 'PROD-FG' AND proce.ent_approve = 'Yes')`)}) AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN prodled.quantity - prodled.ag_qty ELSE 0.00 END) AS ent_pend_qty`
    + ` FROM ${db}PROD_LEDGER prodled LEFT JOIN ${db}ADDON_AENTRY aent ON aent.aona_processid = prodled.process_id LEFT JOIN ${db}PROCESS proce ON proce.process_key = prodled.process_id WHERE prodled.il_pos = 'A' AND coalesce(aent.input_job_card, '') <> '' GROUP BY prodled.prod_id, aent.input_job_card) ep`
    + ` ON ep.prod_id = prodplan.prod_id AND ep.input_job_card = prodplan.job_card_no WHERE coalesce(prodplan.job_card_no, '') <> '' GROUP BY prodplan.job_card_no, prodplan.prod_id, ep.ent_pend_qty`)).rows) {
    if (num(row.plan_pend) > 0) planned.set(num(row.prod_id), (planned.get(num(row.prod_id)) ?? 0) + num(row.plan_pend));
  }
  const orders = async (extra: string, join: string) => new Map((await runReportSql(loader, `SELECT prodled.prod_id, coalesce(sum(prodled.quantity - prodled.ag_qty), 0) AS pending FROM ${db}PROD_LEDGER prodled ${join}`
    + ` WHERE prodled.il_pos = 'A' AND prodled.il_date <= $1 AND ${extra} AND prodled.quantity - (prodled.ag_qty + coalesce(prodled.setof_qty, 0)) > 0 AND prodled.prod_id = ANY($2::int[]) GROUP BY prodled.prod_id`, [upto, keys])).rows.map((row) => [num(row.prod_id), num(row.pending)] as const));
  const pendingOrders = await orders(`${trn} = 'ORD-OUT'`, "");
  const transit = await orders(`ac.book = 3 AND ${trn} IN ('ORD-IN', 'ORD-PURCH')`, `LEFT JOIN ${db}ACCOUNT ac ON ac.code = prodled.code`);

  const quantityColumns = ["OPEN_QTY", "OPEN_AMT", "PACKING", "CR_QTY", "PURCH_QTY", "STOCK_ADD", "DR_QTY", "SALE_QTY", "STOCK_LESS"];
  const columns = ["ITEM", ...names, ...addonSelected, "PROD_PACK", ...quantityColumns, "CLSG_QTY", "CLSG_BOX_QTY", "CLSG_LOOSE_QTY", "Rate", "Amount", "Plan_Qty", "Pend_Order", "Transit", "Hold_Ctn", "Hold_Qty", "After_Hold_Stock", "Hold_Remark"];
  for (const column of columns) table.addColumn(column);
  for (const column of columns.filter((name) => !["ITEM", ...names, ...addonSelected, "Hold_Remark"].includes(name))) table.setKind(column, ["PROD_PACK", "CLSG_QTY", "CLSG_BOX_QTY", "CLSG_LOOSE_QTY"].includes(column) ? "int" : "decimal");
  const rows: ResultRow[] = [];
  for (const product of products) {
    const moved = period.get(product.key);
    const earlier = before.get(product.key);
    const got = (row: ResultRow | undefined, column: string) => num(row?.[column]);
    const opening = product.open + (earlier === undefined ? 0 : got(earlier, "packing") + got(earlier, "cr_qty") + got(earlier, "purch_qty") + got(earlier, "stock_add") - got(earlier, "dr_qty") - got(earlier, "sale_qty") - got(earlier, "stock_less"));
    const values = { packing: got(moved, "packing"), cr: got(moved, "cr_qty"), purch: got(moved, "purch_qty"), add: got(moved, "stock_add"), dr: got(moved, "dr_qty"), sale: got(moved, "sale_qty"), less: got(moved, "stock_less") };
    const rate = rates.get(product.key) ?? 0;
    const closing = Math.round(opening + values.packing + values.cr + values.purch + values.add - values.dr - values.sale - values.less);
    const plannedQty = planned.get(product.key) ?? 0;
    const pend = pendingOrders.get(product.key) ?? 0;
    const inTransit = transit.get(product.key) ?? 0;
    if ([opening, values.packing, values.cr, values.purch, values.add, values.dr, values.sale, values.less, pend, plannedQty, inTransit, product.hold].every((value) => value === 0)) continue;
    const box = product.pack > 1 ? Math.trunc(closing / product.pack) : 0;
    const row: ResultRow = { ITEM: product.item };
    withAddons(row, product);
    Object.assign(row, {
      PROD_PACK: product.pack, OPEN_QTY: r2(opening), OPEN_AMT: r2(opening * rate), PACKING: r2(values.packing), CR_QTY: r2(values.cr), PURCH_QTY: r2(values.purch), STOCK_ADD: r2(values.add), DR_QTY: r2(values.dr), SALE_QTY: r2(values.sale), STOCK_LESS: r2(values.less),
      CLSG_QTY: closing, CLSG_BOX_QTY: box, CLSG_LOOSE_QTY: product.pack > 1 ? closing - Math.round(product.pack * box) : 0, Rate: rate, Amount: r2(closing * rate), Plan_Qty: r2(plannedQty), Pend_Order: r2(pend), Transit: r2(inTransit),
      Hold_Ctn: r2(product.holdCtn), Hold_Qty: r2(product.hold), After_Hold_Stock: r2(closing - product.hold), Hold_Remark: product.remark,
    });
    rows.push(row);
  }
  table.rows = sortRows(rows);
  return table;
}

// ======================================================================================
// 163: FINISH PRODUCT COSTING (SP_FRT_RPT_RPI_FINISH_PROD_COSTING; SPECIAL > Extra Report (RP) > Finish Product Costing (Sales Dept.))
// ======================================================================================
//
// The finish goods' bills of material (MFG-BOM vouchers) costed. A row for each BOM voucher of a finish good (its production and sales for the
// year up to Upto, its DP rate and the NP rate 68% of it, the cost of the whole voucher, the difference and the profit / consumption ratios), and
// under it a row for each material (its quantity, rate and cost): a semi finished material is replaced by the raw materials its own latest
// BOM explodes to (quantities scaled, at most ten levels, leaves only), each costed at the BOM's rate, else the latest purchase rate of the year,
// else the opening rate, else the report rate. Summary Require: the finish goods' rows only. Consumption Require: the finish goods' production
// and what the same vouchers consumed. PMP Detail Require: the semi finished materials' BOM vouchers with the materials of each.
// The procedure builds temp tables and updates them; here it is a few grouped reads and the same steps in memory (the BOM explosion is its
// recursive query, done on the vouchers read once). Ordered by SORTING_FIELD (voucher, then its materials).

async function finishProductCosting(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const from = desktopDate(call.from);
  const upto = desktopDate(call.upto);
  const yearStart = desktopDate(call.tarikh1);
  const keyOf = (at: number) => call.addon[at].trim().replace(/^(adata|aentry)\.txt_/i, "$1.key_");
  const filters = (call.selectKey[4] !== "" ? ` AND prodmas.prod_key IN ${call.selectKey[4]}` : "")
    + [0, 1, 2, 3].filter((at) => call.selectKey[at] !== "" && call.addon[at].trim() !== "").map((at) => ` AND ${keyOf(at)} IN ${call.selectKey[at]}`).join("");
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  const r4 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 10000) / 10000;
  const text = (value: unknown) => (value === null || value === undefined ? null : toText(value));
  const upper = (value: string | null) => (value ?? "").trim().toUpperCase();
  const raw = (value: unknown) => String(value ?? "").toUpperCase();
  const byText = (a: string, b: string) => (raw(a) === raw(b) ? 0 : raw(a) < raw(b) ? -1 : 1);
  const trn = "btrim(prodled.trn_module)";
  const attributes = `adata.txt_prodcat AS prodcat, adata.txt_prodtype AS prodtype, adata.txt_prodgroup AS prodgroup`;
  const base = `${db}PRODUCT_MASTER prodmas LEFT JOIN ${db}ADDON_DATA adata ON adata.prod_id = prodmas.prod_key LEFT JOIN ${db}PROD_LEDGER prodled ON prodled.prod_id = prodmas.prod_key`;
  const produced = `prodled.stock_nat = 'A' AND ((${trn} = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD') OR ${trn} = 'PROD-FG' OR ${trn} = 'PROD-SFG' OR (${trn} = 'PROD-MULTI' AND coalesce(prodled.close_remark, '') <> '')) AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL`;
  const table = new ResultTable();

  // ---- Consumption Require: the finish goods' production and what the same vouchers consumed ----
  if (check("CHK_CONSUMPTION")) {
    const made = await runReportSql(loader, `SELECT prodled.full_docno AS doc, prodmas.prod_desc AS item, produom.uom_desc AS uom,`
      + ` sum(CASE WHEN prodled.stock_nat = 'A' AND ((${trn} = 'SVOU-ADD' AND upper(left(prodled.full_docno, 4)) = 'PROD') OR ${trn} = 'PROD-FG') AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN prodled.quantity - prodled.ag_qty ELSE 0.00 END) AS production`
      + ` FROM ${base} LEFT JOIN ${db}PROD_UOM produom ON produom.uom_key = prodled.uomentry_id WHERE prodmas.prod_pos <> 'D' AND prodled.il_pos = 'A' AND prodled.stock_nat = 'A' AND ${trn} = 'PROD-FG' AND upper(btrim(adata.txt_prodtype)) = 'FINISH GOODS'`
      + ` AND prodled.il_date BETWEEN $1 AND $2${filters} GROUP BY prodled.full_docno, prodmas.prod_desc, produom.uom_desc`, [from, upto]);
    const docs = [...new Set(made.rows.map((row) => toText(row.doc)))];
    const used = await runReportSql(loader, `SELECT prodled.full_docno AS doc, prodmas.prod_desc AS item, produom.uom_desc AS uom,`
      + ` sum(CASE WHEN prodled.stock_nat = 'L' AND ${trn} = 'PROD-FG' AND prodled.inventory = 'Y' AND prodled.process_id IS NOT NULL THEN prodled.quantity - prodled.ag_qty ELSE 0.00 END) AS consumption`
      + ` FROM ${base} LEFT JOIN ${db}PROD_UOM produom ON produom.uom_key = prodled.uomentry_id WHERE prodmas.prod_pos <> 'D' AND prodled.il_pos = 'A' AND prodled.stock_nat = 'L' AND ${trn} = 'PROD-FG'`
      + ` AND prodled.il_date BETWEEN $1 AND $2 AND prodled.full_docno = ANY($3::text[]) GROUP BY prodled.full_docno, prodmas.prod_desc, produom.uom_desc`, [from, upto, docs]);
    for (const column of ["SORTING_FIELD", "Description", "PRODUCTION", "CONSUMPTION", "UOM"]) table.addColumn(column);
    table.setKind("PRODUCTION", "int"); table.setKind("CONSUMPTION", "decimal");
    const merged = new Map<string, ResultRow>();
    const put = (sorting: string, item: string, uom: unknown, production: number, consumption: number) => {
      const key = JSON.stringify([sorting, item, text(uom)]);
      const row = merged.get(key) ?? { SORTING_FIELD: sorting, Description: item, PRODUCTION: 0, CONSUMPTION: 0, UOM: text(uom) };
      row.PRODUCTION = num(row.PRODUCTION) + production;
      row.CONSUMPTION = r4(num(row.CONSUMPTION) + consumption);
      merged.set(key, row);
    };
    for (const row of made.rows) put(`${toText(row.doc)}z${toText(row.item)}`, toText(row.item), row.uom, Math.trunc(num(row.production)), 0);
    for (const row of used.rows) put(`${toText(row.doc)}zz${toText(row.item)}   L`, toText(row.item), row.uom, 0, num(row.consumption));
    table.rows = [...merged.values()].sort((a, b) => byText(toText(a.SORTING_FIELD), toText(b.SORTING_FIELD)));
    return table;
  }

  // ---- PMP Detail Require: the semi finished materials' BOM vouchers and their materials ----
  if (check("CHK_PMPDETAIL")) {
    const headers = (await runReportSql(loader, `SELECT DISTINCT prodled.full_docno AS doc, prodmas.prod_desc AS item, ${attributes}, prodled.quantity::numeric AS qty FROM ${base}`
      + ` WHERE prodmas.prod_pos <> 'D' AND prodled.il_pos = 'A' AND prodled.stock_nat = 'A' AND ${trn} = 'MFG-BOM' AND upper(btrim(adata.txt_prodtype)) = 'SEMI FINISHED MATERIAL'${filters}`)).rows;
    const docs = [...new Set(headers.map((row) => toText(row.doc)))];
    const lines = (await runReportSql(loader, `SELECT prodled.full_docno AS doc, product.prod_desc AS material, ${attributes}, prodled.quantity::numeric AS qty FROM ${db}PROD_LEDGER prodled JOIN ${db}PRODUCT_MASTER product ON product.prod_key = prodled.prod_id`
      + ` JOIN ${db}ADDON_DATA adata ON adata.prod_id = product.prod_key WHERE prodled.il_pos <> 'D' AND prodled.stock_nat = 'L' AND prodled.full_docno = ANY($1::text[])`, [docs])).rows;
    for (const column of ["SORTING_FIELD", "Prodcat", "Category", "prod_Group", "Description", "Material_Used", "QUANTITY", "SINGLE_PC_WEIGHT"]) table.addColumn(column);
    table.setKind("QUANTITY", "decimal"); table.setKind("SINGLE_PC_WEIGHT", "decimal");
    const out: ResultRow[] = [];
    const keep = (type: unknown) => upper(text(type)) !== "SEMI FINISHED MATERIAL";
    // The header rows carry the semi finished type as their category, so they are the ones deleted; the lines stay unless they are semi finished too.
    const seen = new Set<string>();
    for (const header of headers) {
      for (const line of lines.filter((candidate) => toText(candidate.doc) === toText(header.doc))) {
        if (!keep(line.prodtype)) continue;
        const key = JSON.stringify([toText(header.doc), toText(header.item), toText(line.material), num(header.qty), num(line.qty)]);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ SORTING_FIELD: `${toText(header.doc)}z${toText(header.item)}`, Prodcat: text(line.prodcat), Category: text(line.prodtype), prod_Group: text(line.prodgroup), Description: toText(header.item), Material_Used: toText(line.material), QUANTITY: num(header.qty), SINGLE_PC_WEIGHT: r4(num(header.qty) * num(line.qty)) });
      }
    }
    table.rows = out.map((row, index) => ({ row, index })).sort((a, b) => byText(toText(a.row.SORTING_FIELD), toText(b.row.SORTING_FIELD)) || a.index - b.index).map(({ row }) => row);
    return table;
  }

  // ---- The costing ----
  type Cost = {
    doc: string; sorting: string; main: string; prodKey: number; type: string | null; category: string | null; group: string | null; desc: string; material: string;
    dp: number | null; np: number | null; pack: number | null; qty: number | null; single: number | null; total: number | null; rate: number | null; cost: number | null; diff: number | null;
    production: number | null; prodVal: number | null; sale: number | null; diffVal: number | null; ratio: number | null; net: number | null; onCost: number | null;
  };
  const blank = (values: Partial<Cost>): Cost => ({ doc: "", sorting: "", main: "Finish Goods", prodKey: 0, type: null, category: null, group: null, desc: "", material: "", dp: 0, np: 0, pack: 0, qty: null, single: null, total: null, rate: 0, cost: 0, diff: 0,
    production: 0, prodVal: 0, sale: 0, diffVal: 0, ratio: 0, net: 0, onCost: 0, ...values });
  const dpRates = new Map((await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, round(pl_srate::numeric, 2) AS rate FROM ${db}PRICELIST WHERE pl_wefrom <= $1 AND pl_srate::numeric > 0 AND pl_pos <> 'D' ORDER BY prod_id, pl_wefrom DESC`, [upto])).rows.map((row) => [num(row.prod_id), num(row.rate)] as const));
  const yearly = new Map((await runReportSql(loader, `SELECT prod_id, sum(CASE WHEN stock_nat = 'A' AND ((btrim(trn_module) = 'SVOU-ADD' AND upper(left(full_docno, 4)) = 'PROD') OR btrim(trn_module) = 'PROD-FG' OR btrim(trn_module) = 'PROD-SFG' OR (btrim(trn_module) = 'PROD-MULTI' AND coalesce(close_remark, '') <> '')) AND inventory = 'Y' AND process_id IS NOT NULL THEN quantity - ag_qty ELSE 0.00 END) AS production,`
    + ` sum(CASE WHEN (book = 8 OR book = 9) AND stock_nat = 'L' AND inventory = 'Y' AND led_id IS NOT NULL THEN quantity - ag_qty ELSE 0.00 END) AS sale FROM ${db}PROD_LEDGER WHERE il_pos = 'A' AND il_date BETWEEN $1 AND $2 GROUP BY prod_id`, [yearStart, upto])).rows.map((row) => [num(row.prod_id), row] as const));
  const purchase = new Map((await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, rate::numeric AS rate FROM ${db}PROD_LEDGER WHERE il_pos = 'A' AND il_date BETWEEN $1 AND $2 AND book = 13 AND led_id IS NOT NULL ORDER BY prod_id, il_date DESC`, [yearStart, upto])).rows.map((row) => [num(row.prod_id), num(row.rate)] as const));
  const balances = new Map((await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, open_rate::numeric AS open_rate, rep_rate::numeric AS rep_rate FROM ${db}PROD_BALANCE WHERE prec_flag = 'RP' ORDER BY prod_id`)).rows.map((row) => [num(row.prod_id), row] as const));

  const headers = (await runReportSql(loader, `SELECT DISTINCT prodled.full_docno AS doc, prodmas.prod_key, prodmas.prod_desc AS item, prodmas.base_pack AS pack, ${attributes}, prodled.quantity::numeric AS qty FROM ${base}`
    + ` WHERE prodmas.prod_pos <> 'D' AND prodled.il_pos = 'A' AND prodled.stock_nat = 'A' AND ${trn} = 'MFG-BOM' AND upper(btrim(adata.txt_prodtype)) = 'FINISH GOODS'${filters}`)).rows;
  const docs = [...new Set(headers.map((row) => toText(row.doc)))];
  const lineRows = (await runReportSql(loader, `SELECT DISTINCT prodled.full_docno AS doc, prodmas.prod_key, prodmas.prod_desc AS item, ${attributes}, prodled.quantity::numeric AS qty, prodled.rate::numeric AS rate FROM ${base}`
    + ` WHERE prodmas.prod_pos <> 'D' AND prodled.il_pos = 'A' AND prodled.stock_nat = 'L' AND ${trn} = 'MFG-BOM' AND prodled.full_docno = ANY($1::text[])`, [docs])).rows;

  let rows: Cost[] = [];
  for (const header of headers) {
    const key = num(header.prod_key);
    const dp = dpRates.get(key) ?? 0;
    const qty = r4(num(header.qty));
    const year = yearly.get(key);
    rows.push(blank({ doc: toText(header.doc), sorting: `${toText(header.doc)}z${toText(header.item)}`, prodKey: key, type: text(header.prodtype), category: text(header.prodcat), group: text(header.prodgroup), desc: toText(header.item), dp, np: dp > 0 ? r2(dp * 68 / 100) : 0,
      pack: Math.trunc(num(header.pack)), qty, single: qty, total: qty, production: Math.trunc(num(year?.production)), sale: Math.trunc(num(year?.sale)) }));
  }
  for (const line of lineRows) {
    const qty = r4(num(line.qty));
    rows.push(blank({ doc: toText(line.doc), sorting: `${toText(line.doc)}zz${toText(line.item)}   L`, prodKey: num(line.prod_key), type: text(line.prodtype), category: text(line.prodcat), group: text(line.prodgroup), desc: toText(line.item), pack: 0, qty, single: qty, total: 0, cost: r2(num(line.rate)), production: 0, sale: 0 }));
  }
  // Every row's single piece weight is 1 (no Material_Used yet), so the total weight is the quantity.
  for (const row of rows) { row.single = 1; row.total = r4((row.qty ?? 0) * 1); }
  // A material's cost rate: the voucher's, else the year's latest purchase rate, else the opening rate, else the report rate.
  const notFinish = (row: { type: string | null }) => upper(row.type) !== "FINISH GOODS";
  for (const row of rows) {
    if (!notFinish(row) || (row.cost ?? 0) !== 0) continue;
    row.cost = purchase.get(row.prodKey) ?? row.cost;
    if ((row.cost ?? 0) === 0) row.cost = num(balances.get(row.prodKey)?.open_rate) || row.cost;
    if ((row.cost ?? 0) === 0) row.cost = num(balances.get(row.prodKey)?.rep_rate) || row.cost;
  }
  for (const row of rows) if (notFinish(row) && (row.cost ?? 0) > 0) row.rate = row.cost;
  for (const row of rows) if (notFinish(row) && (row.cost ?? 0) > 0 && (row.qty ?? 0) > 0) row.cost = r2((row.qty ?? 0) * (row.cost ?? 0));

  // ---- The BOM explosion of the semi finished materials (the procedure's recursive EXPLODE) ----
  const products = new Map((await runReportSql(loader, `SELECT prod_key, prod_pos, btrim(prod_desc) AS item FROM ${db}PRODUCT_MASTER`)).rows.map((row) => [num(row.prod_key), row] as const));
  const attribute = new Map((await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, txt_prodgroup AS prodgroup, txt_prodtype AS prodtype, txt_prodcat AS prodcat FROM ${db}ADDON_DATA ORDER BY prod_id`)).rows.map((row) => [num(row.prod_id), row] as const));
  const bom = (await runReportSql(loader, `SELECT full_docno AS doc, prod_id, stock_nat AS nature, quantity::numeric AS qty, rate::numeric AS rate, il_date FROM ${db}PROD_LEDGER WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D'`)).rows;
  type Header = { doc: string; prodId: number; desc: string; qty: number; date: number };
  const latest = new Map<string, Header>();
  const everyHeader = new Set<string>();
  const linesOf = new Map<string, { prodId: number; desc: string; qty: number; rate: number }[]>();
  for (const row of bom) {
    const desc = toText(products.get(num(row.prod_id))?.item).trim();
    if (toText(row.nature) === "A") {
      everyHeader.add(desc);
      const header: Header = { doc: toText(row.doc), prodId: num(row.prod_id), desc, qty: num(row.qty), date: row.il_date instanceof Date ? row.il_date.getTime() : 0 };
      const current = latest.get(desc);
      if (!current || header.date > current.date || (header.date === current.date && byText(header.doc, current.doc) > 0)) latest.set(desc, header);
    } else if (toText(row.nature) === "L") {
      const list = linesOf.get(toText(row.doc)) ?? [];
      list.push({ prodId: num(row.prod_id), desc, qty: num(row.qty), rate: num(row.rate) });
      linesOf.set(toText(row.doc), list);
    }
  }
  const semiDescriptions = new Set(rows.filter((row) => upper(row.type) === "SEMI FINISHED MATERIAL").map((row) => row.desc.trim()));
  type Exploded = { root: Header; lastDoc: string; prodId: number; desc: string; qty: number; rate: number; level: number; path: string };
  const exploded: Exploded[] = [];
  let frontier: Exploded[] = [];
  for (const desc of semiDescriptions) {
    const header = latest.get(desc);
    if (!header || toText(products.get(header.prodId)?.prod_pos) !== "A" || upper(text(attribute.get(header.prodId)?.prodtype)) !== "SEMI FINISHED MATERIAL") continue;
    for (const line of linesOf.get(header.doc) ?? []) frontier.push({ root: header, lastDoc: header.doc, prodId: line.prodId, desc: line.desc, qty: line.qty, rate: line.rate, level: 1, path: `|${header.desc}|${line.desc}|` });
  }
  while (frontier.length > 0) {
    exploded.push(...frontier);
    const next: Exploded[] = [];
    for (const row of frontier) {
      const header = latest.get(row.desc);
      if (!header || row.level >= 10) continue;
      for (const line of linesOf.get(header.doc) ?? []) {
        if (row.path.toUpperCase().includes(`|${line.desc.toUpperCase()}|`)) continue;
        next.push({ root: row.root, lastDoc: header.doc, prodId: line.prodId, desc: line.desc, qty: header.qty === 0 ? NaN : row.qty * line.qty / header.qty, rate: line.rate, level: row.level + 1, path: `${row.path}${line.desc}|` });
      }
    }
    frontier = next;
  }
  type Leaf = { finished: string; qty: number; group: string | null; type: string | null; category: string | null; cost: number; material: string };
  const leaves: Leaf[] = [];
  for (const row of exploded) {
    if (toText(products.get(row.prodId)?.prod_pos) !== "A" || everyHeader.has(row.desc)) continue;
    const purchased = purchase.get(row.prodId) === undefined ? null : r2(purchase.get(row.prodId)!);
    const opening = balances.get(row.prodId) === undefined ? null : r2(num(balances.get(row.prodId)!.open_rate));
    const rate = (row.rate ?? 0) === 0 && (purchased ?? 0) === 0 ? opening ?? 0 : (row.rate ?? 0) === 0 ? purchased ?? 0 : row.rate;
    const attributes = attribute.get(row.prodId);
    leaves.push({ finished: toText(products.get(row.root.prodId)?.item).trim(), qty: Number.isNaN(row.qty) ? NaN : r4(row.qty), group: text(attributes?.prodgroup), type: text(attributes?.prodtype), category: text(attributes?.prodcat), cost: rate, material: row.desc });
  }
  const snapshot = [...rows];
  for (const row of snapshot) {
    if (upper(row.type) !== "SEMI FINISHED MATERIAL") continue;
    for (const leaf of leaves) {
      if (leaf.finished !== row.desc.trim()) continue;
      const qty = row.qty ?? 0;
      rows.push(blank({ doc: row.doc, sorting: row.sorting, main: row.main, prodKey: row.prodKey, group: leaf.group, type: leaf.type, category: leaf.category, desc: leaf.finished, material: leaf.material, dp: null, np: null, pack: null, qty, single: leaf.qty,
        total: r4(leaf.qty * qty), rate: leaf.cost, cost: Number.isNaN(leaf.qty) ? null : r2(leaf.qty * qty * leaf.cost), diff: null, production: null, prodVal: null, sale: null, diffVal: null, ratio: null, net: null, onCost: null }));
    }
  }
  rows = rows.filter((row) => !(upper(row.type) === "SEMI FINISHED MATERIAL" && row.material === ""));

  // The finish good's cost is the sum of its voucher's rows; then the differences, values and ratios.
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.doc, (sums.get(row.doc) ?? 0) + (row.cost ?? 0));
  for (const row of rows) if (upper(row.type) === "FINISH GOODS") row.cost = sums.get(row.doc) ?? 0;
  for (const row of rows) if (upper(row.type) === "FINISH GOODS") row.diff = r2((row.np ?? 0) - (row.cost ?? 0));
  for (const row of rows) {
    if (upper(row.main) !== "FINISH GOODS") continue;
    row.prodVal = row.production === null || row.cost === null ? null : r2(row.cost * row.production);
    row.diffVal = row.diff === null || row.sale === null ? null : r2(row.diff * row.sale);
    if ((row.diff ?? 0) > 0 && (row.cost ?? 0) > 0) {
      row.onCost = r2((row.diff ?? 0) / (row.cost ?? 1) * 100);
      row.ratio = r2((row.cost ?? 0) / (row.np ?? 1) * 100);
      row.net = r2((row.diff ?? 0) / (row.np ?? 1) * 100);
    }
  }
  if (check("CHK_SUMMARY")) rows = rows.filter((row) => upper(row.type) === "FINISH GOODS");

  const columns = ["SORTING_FIELD", "Prod_type", "Category", "prod_Group", "Description", "Material_Used", "DP_RATE", "NP_RATE", "STD_PACK", "QUANTITY", "SINGLE_PC_WEIGHT", "TOTAL_WEIGHT", "Rate", "COST_RATE", "DIFF_RATE", "PRODUCTION", "PROD_VAL", "SALE", "DIFF_VAL", "CONSUMPTION_RATIO_%", "PROFIT_ON_NET_%", "PROFIT_ON_COST_%"];
  for (const column of columns) table.addColumn(column);
  for (const column of columns.slice(6)) table.setKind(column, ["STD_PACK", "PRODUCTION", "SALE"].includes(column) ? "int" : "decimal");
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => byText(a.row.sorting, b.row.sorting) || a.index - b.index).map(({ row }) => ({
    SORTING_FIELD: row.sorting, Prod_type: row.type, Category: row.category, prod_Group: row.group, Description: row.desc, Material_Used: row.material, DP_RATE: row.dp, NP_RATE: row.np, STD_PACK: row.pack, QUANTITY: row.qty, SINGLE_PC_WEIGHT: row.single, TOTAL_WEIGHT: row.total,
    Rate: row.rate, COST_RATE: row.cost, DIFF_RATE: row.diff, PRODUCTION: row.production, PROD_VAL: row.prodVal, SALE: row.sale, DIFF_VAL: row.diffVal, "CONSUMPTION_RATIO_%": row.ratio, "PROFIT_ON_NET_%": row.net, "PROFIT_ON_COST_%": row.onCost,
  }));
  return table;
}

// ======================================================================================
// DAILY INCOMING (158)
// ======================================================================================

/**
 * SP_FRT_RPT_RPI_DAILY_INCOMING (SPECIAL > Extra Report (RP) > Daily Incoming (Purchase Dept.), report 158): a row for each product line of
 * the purchase vouchers (book 13) of the period, with the purchase order line it was received against (PROD_LINK: the order's date,
 * number, quantity, rate, unit and delivery date), the days from the party's invoice to the delivery date, the rate difference
 * (order rate less received rate), the line's GST % and amount, and the transport details of the entry. The voucher's total is on its
 * first line only (Sr_No is the line's place within the entry and party).
 *
 * The procedure joins the GST slab rows twice (once for the % and once for the amount) and numbers its rows before DISTINCT; here the
 * GST rows are read once, and the rows are numbered in the one statement, which is what makes it quick on a year's purchases.
 */
async function dailyIncoming(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const shown = (column: string) => `to_char(${column}, 'DD-Mon-YY')`;
  const sql = `WITH GST AS (
      SELECT ledext.il_id, max(CASE WHEN idoptmst.opt_desc = 'IGST' THEN ledext.slab_perc ELSE ledext.slab_perc * 2 END) AS gst_perc,
             max(CASE WHEN idoptmst.opt_desc = 'IGST' THEN ledext.slab_amt::numeric ELSE ledext.slab_amt::numeric * 2 END) AS gst_amt
        FROM ${db}LEDGER_EXT ledext
        JOIN ${db}SLAB_MASTER slabmst ON ledext.slab_id = slabmst.slab_key
        JOIN ${db}TAX_MASTER taxmst ON ledext.tax_id = taxmst.tax_rec
        JOIN ${db}IDOPT_MASTER idoptmst ON idoptmst.idopt_key = nullif(taxmst.tax_type,'')::int
       WHERE ledext.tax_id > 0 AND slabmst.slab_link = 0 AND ledext.il_id IS NOT NULL GROUP BY ledext.il_id),
    RECEIVED AS (
      SELECT led.led_key, prodled.il_key, prodled.prod_id, led.doc_date, led.chln_date,
             btrim(led.doc_no1) AS invoice_no, btrim(led.doc_no) AS entry_no, aient.input_pjobcard AS job_card_no,
             ac.name AS party_name, addr.city AS place, prodmas.prod_desc AS item, aient.input_pcweight AS weight,
             prodled.quantity AS recd_qty, prodled.rate::numeric AS recd_rate, prduom.uom_short AS recd_uom, led.amount::numeric AS inv_total_value,
             GST.gst_perc, GST.gst_amt, aent.input_despatch AS transport_name, aent.input_vehno AS vehicle_no, aent.input_lrno AS lr_no,
             aent.input_lrdate AS lr_date, aent.input_gatekiper AS gate_keeper_no
        FROM ${db}LEDGER led
        LEFT JOIN ${db}PROD_LEDGER prodled ON prodled.led_id = led.led_key
        LEFT JOIN ${db}PRODUCT_MASTER prodmas ON prodmas.prod_key = prodled.prod_id
        LEFT JOIN ${db}ADDON_AENTRY aent ON aent.aona_ledid = led.led_key
        LEFT JOIN ${db}ACCOUNT ac ON ac.code = led.code
        LEFT JOIN ${db}ADDRESS addr ON addr.code = ac.code
        LEFT JOIN ${db}PROD_UOM prduom ON prduom.uom_key = prodled.rateuom_id
        LEFT JOIN ${db}ADDON_IENTRY aient ON aient.aoni_il_id = prodled.il_key
        LEFT JOIN GST ON GST.il_id = prodled.il_key
       WHERE led.doc_date BETWEEN $1 AND $2 AND addr.address_id = 1 AND led.doc_pos <> 'D' AND prodled.il_pos <> 'D' AND led.book = 13),
    ORDERED AS (
      SELECT prdlink.led_rec2, prdlink.iled_rec2, a.il_date AS po_date, btrim(a.full_docno) AS po_no, a.quantity AS po_qty, a.rate::numeric AS po_rate,
             prduom.uom_short AS po_uom, aent.input_sch_date AS delivery_date, a.prod_id
        FROM ${db}PROCESS b
        LEFT JOIN ${db}PROD_LEDGER a ON a.process_id = b.process_key
        LEFT JOIN ${db}PROD_UOM prduom ON prduom.uom_key = a.rateuom_id
        LEFT JOIN ${db}ADDON_IENTRY aent ON aent.aoni_il_id = a.il_key
        LEFT JOIN ${db}ACCOUNT ac ON ac.code = b.code
        LEFT JOIN ${db}PROD_LINK prdlink ON prdlink.led_rec1 = b.process_key AND prdlink.iled_rec1 = a.il_key
       WHERE b.il_pos = 'A' AND b.stk_module = 'ORD-IN' AND ac.book = 3 AND prdlink.led_rec2 IN (SELECT led_key FROM RECEIVED)),
    JOINED AS (
      SELECT sc.*, tc.po_date, tc.po_no, tc.po_qty, tc.po_rate, tc.po_uom, tc.delivery_date,
             row_number() OVER (PARTITION BY sc.entry_no, sc.party_name ORDER BY sc.led_key, sc.il_key, tc.po_no) AS line_no
        FROM RECEIVED sc LEFT JOIN ORDERED tc ON sc.prod_id = tc.prod_id AND sc.led_key = tc.led_rec2 AND sc.il_key = tc.iled_rec2)
    SELECT line_no AS "Sr_No", ${shown("chln_date")} AS "Invoice_Date", invoice_no AS "Invoice_No", ${shown("doc_date")} AS "Entry_Date", entry_no AS "Entry_No",
           job_card_no AS "Job_Card_No", ${shown("po_date")} AS "PO_DATE", po_no AS "PO_NO", ${shown("delivery_date")} AS "DELIVERY_DATE",
           (delivery_date::date - chln_date::date) AS "DIFF_DAYS", party_name AS "Party_Name", place AS "Place", item AS "Item", weight AS "Weight",
           po_qty AS "PO_Qty", recd_qty AS "Recd_Qty", po_rate AS "PO_RATE", po_uom AS "PO_UOM", recd_rate AS "Recd_Rate",
           (po_rate - recd_rate) AS "Diff_Rate", recd_uom AS "Recd_Uom", CASE WHEN line_no = 1 THEN inv_total_value ELSE 0 END AS "Inv_Total_Value",
           gst_perc AS "Gst_%", gst_amt AS "Gst_Amt", transport_name AS "Transport_Name", vehicle_no AS "VEHICLE_NO", lr_no AS "LR_NO",
           lr_date AS "LR_DATE", gate_keeper_no AS "Gate_Keeper_No"
      FROM JOINED ORDER BY doc_date, entry_no, po_no`;
  const result = await runReportSqlHashed(loader, sql, [iso(call.from), iso(call.upto)]);
  const table = tableFromResult(result);
  if (table.has("Sr_No")) table.setKind("Sr_No", "int");
  for (const column of ["PO_Qty", "Recd_Qty", "PO_RATE", "Recd_Rate", "Diff_Rate", "Inv_Total_Value", "Gst_%", "Gst_Amt"]) if (table.has(column)) table.setKind(column, "decimal");
  return table;
}
