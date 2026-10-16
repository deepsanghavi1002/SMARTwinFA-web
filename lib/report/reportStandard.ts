import type { Loader } from "../master-program/load";
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
import { productionPlanDetail } from "./productionPlanDetail";
import { patiya } from "./patiya";
import { incomeTaxSummary } from "./incomeTax";
import { stockLots, STOCK_AGE_BUCKETS } from "./stockAgeing";
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
import { multiCompanyDayBook } from "./multiCompanyDayBook";
import { toText } from "../master-program/legacy";
import type { ResultRow } from "./call";
import { ResultTable } from "./call";
import { dateStyle112, dateStyle6, desktopDate, sqlServerCompare } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import {
  cashBookColumns, dayBefore, dropColumn, groupFailed, groupHeadingColumns, groupList, groupSmartColumn, insertFirst, narrationPieces, numberKey,
  parseRowDate, renameColumn, replaceCI, rightAlignedKey, sortRows, tableFromFields, tableFromResult, textKey, withEntryAddon,
} from "./library";
import { decimalRound, money, num, runReportSql, runReportSqlHashed } from "./run";
import { registerSlabBook } from "./registerBooks";
import { matchGp, gpOpeningValue, summariseGp } from "./gp";
import type { GpProduct, GpSale, GpStock } from "./gp";
export { registerSlabBook };
import { MONTH_NAMES, ddMmYyyy, pushAll } from "./library";
import { SETUP_SCHEMA, SYSTEM_SCHEMA } from "../master-program/session";

/**
 * SP_REPORT_STANDARD: the standard (unformatted) output of every report, one branch per report
 * key as in the SQL Server procedure. The procedure builds its result in TEMP_TABLE_* / RESULT_TABLE
 * tables; here the same table is built in memory from read-only queries, so a report never writes
 * to the database. What branches share is in library.ts; Report_Combine's own work before and
 * after is in generate.ts and output.ts.
 *
 * Ported branches: 109 (fund flow), 119 (checklist invoice), 120 (checklist daybook), 1 (day book), 2 (journal), 3 (register), 4 (ledger), 5 (outstanding ageing), 6 (trial balance), 22 (profit and loss), 23 (balance sheet), 24 (annexure).
 */
export async function standardReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  switch (plan.call.reportKey) {
    case 1: return daybook(loader, plan);
    case 2: return journal(loader, plan);
    case 3: return register(loader, plan);
    case 5: return ageing(loader, plan);
    case 4: return ledger(loader, plan);
    case 6: return trialBalance(loader, plan);
    case 16: return partyStock(loader, plan);
    case 17: return stockReport(loader, plan);
    case 22: return profitLoss(loader, plan);
    case 7: return accountMaster(loader, plan);
    case 9: return partyRate(loader, plan);
    case 11: return challanRegister(loader, plan);
    case 19: return challanPending(loader, plan);
    case 20: return orderPending(loader, plan);
    case 12: return orderRegister(loader, plan);
    case 25: return marketingAnalysis(loader, plan);
    case 27: return gpReport(loader, plan);
    case 35: return nonFunction(loader, plan);
    case 10: return productMaster(loader, plan);
    case 13: return priceList(loader, plan);
    case 14: return formSummary(loader, plan);
    case 15: return bankReconciliation(loader, plan);
    case 211: return topReports(loader, plan);
    case 112: return physicalStock(loader, plan);
    case 232: return dropAnalysis(loader, plan);
    case 143: return salesAnalysis(loader, plan);
    case 30: return partySummary(loader, plan);
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
    case 109: return fundFlow(loader, plan);
    case 119: return checklistInvoice(loader, plan);
    case 120: return checklistDaybook(loader, plan);
    case 23: return balanceSheet(loader, plan);
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
    case 26: return incomeTaxSummary(loader, plan);
    case 115: return multiCompanyAccountSummary(loader, plan);
    case 178: return multiCompanyProfitLoss(loader, plan);
    case 116: return multiCompanyProduct(loader, plan);
    case 117: return multiCompanyDayBook(loader, plan);
    case 118: return multiCompanyLedger(loader, plan);
    case 136: return multiCompanyBalanceSheet(loader, plan);
    case 138: return multiYearBalanceSheet(loader, plan);
    case 24: return annexure(loader, plan);
    default: throw new ReportRefusal(`Report ${plan.call.reportKey} is not available in the web version yet.`, "Not ported yet");
  }
}

/** The day book's opening (@NUM_OPENING): the account's opening for the year, plus what it took in less paid out from the year's start to `uptoBefore` (numeric(18,2)). */
export async function cashBookOpening(loader: Loader, plan: ReportPlan, csFrom: string, uptoBefore: Date): Promise<number> {
  const { call } = plan;
  const db = call.database;
  const row = (await runReportSql(loader, `SELECT opening::numeric AS opening FROM ${db}AC_BALANCE WHERE code = $1 AND year_id = $2 AND a_recflag = 'AC' LIMIT 1`, [call.fcValue, call.yearId])).rows[0];
  let opening = money(num(row?.opening));
  if (call.from.getTime() !== call.tarikh1.getTime()) {
    const sql = `SELECT coalesce(SUM(CASE WHEN BK_DBCODE = 1 THEN led.AMOUNT ELSE 0.00 END),0.00) - coalesce(SUM(CASE WHEN BK_DBCODE = 2 THEN led.AMOUNT ELSE 0.00 END),0.00) AS moved ${csFrom}`
      + ` WHERE LED.BOOK_CODE = ${Number(call.fcValue)} AND LED.DOC_POS <> 'D' AND ${call.dateField} BETWEEN '${desktopDate(call.tarikh1)}' AND '${desktopDate(uptoBefore)}'`;
    const moved = (await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema))).rows[0];
    opening = money(opening + num(moved?.moved));
  }
  return Math.round(opening * 100) / 100;
}

/** The day book's FROM with the entry addon join the procedure puts in. */
export const cashBookFrom = (plan: ReportPlan): string => withEntryAddon(plan.call.from_, `left join ${plan.call.database}addon_aentry aentry on led.led_key=aentry.aona_ledid`);


// ======================================================================================
// 3: REGISTER (lines 1012-2268, "ACTIONS FOR REGISTER")
// ======================================================================================
//
// The vouchers of a sale / purchase book (books 8 to 18), one row each: date, number, party, GST
// numbers, amount, credit days, e-invoice details ... in the order the sort says (date and voucher
// number by default). With groups ticked the group columns follow and the output adds subtotals.
//
// Options and formats, as the procedure takes them:
//  - Quantity, Factor, MRP Value, Credit Days: the columns are 0 / blank unless ticked.
//  - Show Narration (in rows): each voucher's narration under it, 40 characters a row (N01 .. N13).
//  - Print All Slabs (option ALL_SLABS): a column for each slab of the book (gross, discounts, GST ...),
//    the amount net of the discounts and the tax's name (TAX_DESCRIPTION / TAX_DESCRIPTION1).
//  - Format Include Slab / Exclude Slab: only the vouchers that have (do not have) the ticked slabs,
//    with the ticked (the unticked non-tax) slabs as columns. The tax slabs' own columns are not
//    drawn in Exclude Slab, as in the procedure.
//  - Include Form / Exclude Form: the procedure refuses them for this report; so does the web.

export type RegisterSlab = { short: string; key: number; master: boolean; mathop: string; order: number };

/** The slabs the period's vouchers carry (cursor TMP_SLAB), in slab order. */
export async function registerSlabs(loader: Loader, plan: ReportPlan, inReport = true): Promise<RegisterSlab[]> {
  const { call } = plan;
  const db = call.database;
  const sql = `SELECT ltrim(rtrim(SLAB_REPOHD)) AS slab_short, SLAB_KEY AS slab_id, SLAB_MASTER AS slab_master, SLAB_MATHOP AS slab_mathop, SLAB_ORDER AS slab_ord FROM ${db}SLAB_MASTER`
    + ` WHERE BOOK=${registerSlabBook(call.book, call.againstBook)} AND SLAB_FROMDT='${desktopDate(call.tarikh1)}' AND SLAB_UPTODT='${desktopDate(call.tarikh2)}' ${inReport ? " AND SLAB_INREP='Y'" : ""} AND SLAB_ACTIVE<>'N'`
    + ` AND SLAB_KEY IN (SELECT SLAB_ID FROM ${db}LEDGER_EXT ledext LEFT JOIN ${db}LEDGER led ON led.led_key=ledext.led_id WHERE led.doc_pos='A' AND led.doc_date BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}' AND led.book_code=${Number(call.fcValue)} AND ledext.il_id IS NULL)`
    + ` ORDER BY SLAB_ORDER`;
  const result = await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema));
  return result.rows.map((row) => ({ short: toText(row.slab_short), key: Number(row.slab_id), master: toText(row.slab_master) === "Y", mathop: toText(row.slab_mathop), order: Number(row.slab_ord) }));
}

async function register(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const format = call.filterId.toUpperCase();
  if (call.dateField === "") throw new ReportRefusal("DATE FIELD FOUND BLANKS\nPLEASE CHECK DATABASE", "INTERNAL PROGRAM FAILURE");
  if (format === "IFORM") throw new ReportRefusal("Include Form Only Possible For Master Details In Format Box", "INTERNAL PROGRAM FAILURE");
  if (format === "EFORM") throw new ReportRefusal("Exclude Form Only Possible For Master Details In Format Box", "INTERNAL PROGRAM FAILURE");
  if (format !== "NONE" && format !== "ISLAB" && format !== "ESLAB") throw new ReportRefusal(call.filterId.trim() === "" ? "Blank Filter Condition\nPlease Check Database." : "Unknown Filter Condition\nPlease Check Database.", "INTERNAL PROGRAM FAILURE");

  const printSlabs = call.printAllSlabs && format === "NONE";
  const useUnion = call.showNarration && call.useUnion;
  const entryAddon = call.addonEntryPos.includes("P");
  const orderText = call.orderBy.toLowerCase();

  // The slabs: every slab of the period (Print All Slabs, Exclude Slab) or the ticked ones (Include Slab).
  const slabs = printSlabs || format === "ESLAB" ? await registerSlabs(loader, plan) : [];
  const tickedKeys = call.slabsKey.split(",").map((key) => key.trim()).filter((key) => key !== "" && key !== "-1");
  const tickedShorts = call.slabText.split(",").map((text) => text.trim()).filter((text) => text !== "");

  // The from: the addon joins the procedure puts in place of the setup's markers; Print All Slabs joins the slab amounts.
  let from = call.from_;
  if (orderText.includes("aentry") || orderText.includes("aientry")) {
    if (entryAddon && orderText.includes("aentry")) {
      from = from.replace("sys.aents", "((").replace("sys.aente", `left join ${db}addon_ientry aientry on led.led_key=aientry.AONI_LEDID) left join ${db}addon_aentry aentry on led.led_key=aentry.aona_ledid)`);
    } else if (entryAddon) {
      from = from.replace("sys.aents", "(").replace("sys.aente", `left join ${db}ADDON_IENTRY aientry on led.led_key = aientry.AONI_LEDID)`);
    } else {
      from = from.replace("sys.aents", "(").replace("sys.aente", `left join ${db}ADDON_AENTRY aentry on led.led_key = aentry.aona_ledid)`);
    }
  } else {
    from = from.replace("sys.aents", "").replace("sys.aente", "");
  }
  const withoutSlabJoin = (text: string) => text.replace("sys.pdatas", "").replace("sys.pdatae", "");
  const slabJoin = `left join ${db}LEDGER_EXT ledext on ledext.LED_ID = led.LED_KEY and ledext.IL_ID is null and ledext.SLAB_ID in (${slabs.length > 0 ? slabs.map((slab) => slab.key).join(",") : "1"})) left join ${db}SLAB_MASTER slabmst on ledext.SLAB_ID = slabmst.SLAB_KEY)`;
  let plainFrom: string;
  if (call.prodAddonRelate === "P" && !entryAddon) {
    from = from.replace("sys.pdatas", "((").replace("sys.pdatae", `left join ${db}prod_ledger prodled on led.led_key = prodled.led_id)left join ${db}addon_data padata on prodled.prod_id = padata.prod_id)`);
    plainFrom = from;
  } else {
    plainFrom = withoutSlabJoin(from);
    if (printSlabs) from = from.replace("sys.pdatas", "((").replace("sys.pdatae", slabJoin);
    else from = plainFrom;
  }

  // The select list: the quantity, factor and MRP columns are 0 unless their option is ticked; credit days per voucher when ticked.
  let select = call.queryStart;
  if (!call.checkQuery.includes("CHK_QUANTITY,")) select = select.replace('coalesce(Qty,0) as "Quantity"', '0 as "Quantity"');
  if (!call.checkQuery.includes("CHK_FACTOR,")) select = select.replace('coalesce(Factor,0.00) as "Factor"', '0.00 as "Factor"');
  if (!call.checkQuery.includes("CHK_MRPVAL,")) select = select.replace('coalesce(Mrp_Value,0.00) as "Mrp_Value"', '0.00 as "Mrp_Value"');
  if (call.checkQuery.includes("CHK_CRDAYS,")) select = select.replace('case when ac.credit_days=0 then null else ac.credit_days end AS "CRDAY"', 'case when coalesce(led.credit_days,0)=0 then CAST(ac.CREDIT_DAYS AS TEXT) else CAST(led.credit_days AS TEXT) end AS "CRDAY"');
  const distinct = printSlabs || !entryAddon ? "" : "Distinct ";

  // Include / Exclude Slab: a column for each slab, and the vouchers that have none of the ticked slabs left out (or in).
  // Each voucher's slab amounts come from one grouped pass over LEDGER_EXT, joined (below) - a sub-query a voucher and slab read the whole
  // table each time, as LEDGER_EXT has no index on LED_ID. A voucher without the slab gets 0.00, as before.
  const columnSlabs: { key: number | string; short: string }[] = [];
  const slabColumn = (key: number | string, short: string) => { columnSlabs.push({ key, short }); return `,COALESCE(SLAB_SUMS.s${columnSlabs.length - 1},0.00) AS "${short}"`; };
  let slabColumns = "";
  let where = call.where;
  if (format === "ISLAB") {
    tickedKeys.forEach((key, at) => { slabColumns += slabColumn(key, tickedShorts[at] ?? key); });
    where += ` and led.LED_KEY in (select led_id from ${db}LEDGER_EXT where slab_id in (${tickedKeys.join(",") || "-1"}) and SLAB_AMT::numeric<>0)`;
  } else if (format === "ESLAB") {
    for (const slab of slabs) if (!tickedKeys.includes(String(slab.key)) && !slab.master) slabColumns += slabColumn(slab.key, slab.short);
    where += ` and led.LED_KEY not in (select led_id from ${db}LEDGER_EXT where slab_id in (${tickedKeys.join(",") || "-1"}) and SLAB_AMT::numeric<>0 and led_id is not null)`;
  }

  // OUTER APPLY: the expense account's name, and the product lines' quantity, factor and MRP value. The product lines' sums are worked
  // out once for every voucher (GROUP BY LED_ID) and joined, not once a voucher: PROD_LEDGER has no index on LED_ID, so a per-voucher
  // sub-query read the whole table each time (Quantity: 14 s, with Show Default Slabs 62 s on 831 vouchers). A voucher with no line gets NULL, as before.
  let apply = ` LEFT JOIN LATERAL (SELECT acc.name AS exp_name FROM ${db}ACCOUNT acc WHERE acc.Code=led.post_bkcode) ALIAS1 ON TRUE`;
  if (columnSlabs.length > 0) {
    apply += ` LEFT JOIN (SELECT LED_ID AS slab_led,${columnSlabs.map((slab, at) => `SUM(CASE WHEN SLAB_ID=${slab.key} THEN SLAB_AMT::numeric END) AS s${at}`).join(",")}`
      + ` FROM ${db}LEDGER_EXT WHERE IL_ID IS NULL AND SLAB_ID IN (${columnSlabs.map((slab) => slab.key).join(",")}) GROUP BY LED_ID) SLAB_SUMS ON SLAB_SUMS.slab_led=led.led_key`;
  }
  if (call.checkQuery.includes("CHK_QUANTITY,")) apply += ` LEFT JOIN (SELECT LED_ID AS alias4_led, SUM(Quantity) AS qty FROM ${db}prod_ledger WHERE IL_POS='A' AND LED_ID IS NOT NULL GROUP BY LED_ID) ALIAS4 ON ALIAS4.alias4_led=led.led_key`;
  if (call.checkQuery.includes("CHK_FACTOR,")) {
    apply += ` LEFT JOIN (SELECT prodled.LED_ID AS alias5_led, SUM(CASE WHEN PRODUCT.REP2_UOM=PRODUCT.PCS_UOM THEN prodled.TRN_PCS-prodled.ag_qty`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.QTY1_UOM THEN prodled.TRN_QTY1-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_qty1)::numeric,4)`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.QTY2_UOM THEN prodled.TRN_QTY2-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_qty2)::numeric,4)`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.qty3_uom THEN prodled.TRN_QTY3-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_qty3)::numeric,4)`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.PACK_UOM THEN prodled.TRN_PACK-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_pack)::numeric,4)`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.WEIGHT_UOM THEN prodled.TRN_WEIGHT-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_weight)::numeric,4)`
      + ` ELSE CAST(factor AS NUMERIC(20,2)) END) AS factor FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master PRODUCT ON PRODUCT.prod_key=prodled.prod_id WHERE prodled.LED_ID IS NOT NULL AND IL_POS='A' AND PRODUCT.PROD_POS='A' GROUP BY prodled.LED_ID) ALIAS5 ON ALIAS5.alias5_led=led.led_key`;
  }
  if (call.checkQuery.includes("CHK_MRPVAL,")) apply += ` LEFT JOIN (SELECT LED_ID AS alias6_led, round(SUM(master_rate*quantity),2) AS mrp_value FROM ${db}prod_ledger WHERE IL_POS='A' AND LED_ID IS NOT NULL GROUP BY LED_ID) ALIAS6 ON ALIAS6.alias6_led=led.led_key`;

  const end = call.queryEnd.trim() !== "" ? `,${call.queryEnd}` : "";
  const order = call.orderBy.trim();
  const orderBy = order !== "" && !order.toLowerCase().startsWith("led.doc_no")
    ? ` ORDER BY ${order},LED.DOC_NO,LED.FULL_DOCNO${printSlabs ? ",slabmst.SLAB_ORDER" : ""}`
    : printSlabs ? ` ORDER BY SORTING_DATE,LED.DOC_NO,slabmst.SLAB_ORDER` : ` ORDER BY SORTING_DATE,LED.DOC_NO`;
  const slabCells = printSlabs ? `,COALESCE(ltrim(rtrim(SLAB_REPOHD)),'') AS "SLAB_DESC",COALESCE(ledext.SLAB_AMT::numeric,0.00) AS "SLAB_AMOUNT"` : slabColumns;
  const narrationColumn = useUnion ? "NARRATION1" : "NARRATION";
  const sql = `SELECT ${distinct}${select}${slabCells},LED.DOC_REMARK,LED.NARRATION AS "${narrationColumn}"${end}${from}${apply}${where}${orderBy}`;
  // Hash joins: with a long list of vouchers the planner chose nested loops over LEDGER_EXT / PROD_LEDGER (no index on LED_ID) and the statement timed out.
  const result = await runReportSqlHashed(loader, frag(sql));
  let table = tableFromFields(result.fields);
  table.rows = result.rows.map((row) => ({ ...row }));

  // Print All Slabs: one row a voucher, a column for each slab (PIVOT), then NET_AMOUNT and the tax's name.
  const headings: string[] = [];
  const tax = { seen: false, first: 0, second: 0 };
  if (printSlabs) {
    const net: { name: string; minus: boolean }[] = [];
    for (const slab of slabs) {
      if (!slab.master && !tax.seen) net.push({ name: slab.short, minus: slab.order !== 1 && slab.mathop === "L" });
      if (headings.length === 0) headings.push(slab.short);
      else {
        if (slab.master) {
          const name = !tax.seen ? "TAX_DESCRIPTION" : "TAX_DESCRIPTION1";
          if (!tax.seen) { headings.push("NET_AMOUNT"); tax.first = slab.key; } else tax.second = slab.key;
          if (!headings.includes(name)) headings.push(name);
          tax.seen = true;
        }
        headings.push(slab.short);
      }
    }
    const descColumn = table.name("SLAB_DESC")!;
    const amountColumn = table.name("SLAB_AMOUNT")!;
    const voucherColumn = table.name("SMART_LED_KEY") ?? table.name("LED_KEY")!;
    const base = table.columns.filter((name) => name !== descColumn && name !== amountColumn);
    const pivot = tableFromFields(result.fields.filter((field) => field.name !== descColumn && field.name !== amountColumn));
    const slabNames = new Set(slabs.map((slab) => slab.short));
    const sums = new Map<string, Map<string, number>>();
    const vouchers: ResultRow[] = [];
    const index = new Map<string, ResultRow>();
    for (const row of table.rows) {
      const key = String(row[voucherColumn]);
      let voucher = index.get(key);
      if (!voucher) {
        voucher = Object.fromEntries(base.map((name) => [name, row[name]]));
        index.set(key, voucher);
        vouchers.push(voucher);
        sums.set(key, new Map());
      }
      const short = toText(row[descColumn]);
      if (slabNames.has(short)) { const bucket = sums.get(key)!; bucket.set(short, money((bucket.get(short) ?? 0) + num(row[amountColumn]))); }
    }
    for (const heading of headings) {
      pivot.addColumn(heading);
      if (heading !== "TAX_DESCRIPTION" && heading !== "TAX_DESCRIPTION1") pivot.setKind(heading, "decimal");
    }
    // TAX_DESCRIPTION: the tax master's name of the voucher's tax slab (product-wise taxes read just TAX).
    const productWise = tax.seen && toText((await runReportSql(loader, frag(`SELECT count(*) AS n FROM ${db}SLAB_MASTER WHERE SLAB_ACTIVE = 'Y' AND SLAB_MASTER = 'Y' AND SLAB_POS = 'P' AND BOOK IN (${registerSlabBook(call.book, call.againstBook)}) AND SLAB_FROMDT >= '${desktopDate(call.tarikh1)}' AND SLAB_UPTODT <= '${desktopDate(call.tarikh2)}'`))).rows[0]?.n) !== "0";
    const taxName = async (slabKey: number) => {
      const names = new Map<string, string>();
      if (productWise || slabKey === 0) return names;
      const rows = (await runReportSql(loader, frag(`SELECT ledext.LED_ID AS led_id, taxmst.tax_repohd AS tax_name FROM ${db}LEDGER_EXT ledext LEFT JOIN ${db}TAX_MASTER taxmst ON taxmst.tax_rec=ledext.tax_id WHERE ledext.IL_ID IS NULL AND ledext.SLAB_ID = ${slabKey}`))).rows;
      for (const row of rows) names.set(String(row.led_id), toText(row.tax_name));
      return names;
    };
    const firstTax = await taxName(tax.first);
    const secondTax = await taxName(tax.second);
    pivot.rows = vouchers.map((voucher) => {
      const key = String(voucher[voucherColumn]);
      const bucket = sums.get(key)!;
      const row: ResultRow = { ...voucher };
      for (const heading of headings) if (heading !== "NET_AMOUNT" && heading !== "TAX_DESCRIPTION" && heading !== "TAX_DESCRIPTION1") row[heading] = bucket.get(heading) ?? null;
      if (tax.seen) {
        // NET_AMOUNT = the first slab less / plus the slabs before the first tax slab.
        let value: number | null = null;
        net.forEach((term, at) => {
          const amount = bucket.get(term.name);
          if (at === 0) value = amount === undefined ? null : amount;
          else if (value !== null) value = money(value + (term.minus ? -1 : 1) * (amount ?? 0));
        });
        row.NET_AMOUNT = value;
        if (headings.includes("TAX_DESCRIPTION")) row.TAX_DESCRIPTION = productWise ? "TAX" : firstTax.get(key) ?? null;
        if (headings.includes("TAX_DESCRIPTION1")) row.TAX_DESCRIPTION1 = productWise ? "TAX" : secondTax.get(key) ?? null;
      }
      return row;
    });
    // The order of REGISTER5: the groups, the name when sorted on it, then date and voucher number.
    const groupColumns = order !== "" ? call.selectKey.slice(0, 4).map((key, at) => (key !== "" ? pivot.name(`SMART_SELECTED_ADDON${at + 1}`) : undefined)).filter((name): name is string => name !== undefined) : [];
    sortRows(pivot, [
      ...groupColumns.map((name) => (row: ResultRow) => textKey(row[name])),
      ...(order.toLowerCase().startsWith("ac.name") ? [(row: ResultRow) => textKey(pivot.get(row, "name"))] : []),
      (row) => textKey(pivot.get(row, "SORTING_DATE")),
      (row) => rightAlignedKey(pivot.get(row, "doc_no")),
      (row) => textKey(pivot.get(row, "full_docno")),
    ]);
    table = pivot;
  }

  // Show Narration in rows: ORDERCOL / ORDERCOL1 ('L'), the narration of each voucher under it (REGISTER2).
  if (useUnion) {
    table.columns.push("ORDERCOL", "ORDERCOL1");
    table.setKind("ORDERCOL", "int");
    table.rows.forEach((row, at) => { row.ORDERCOL = at + 1; row.ORDERCOL1 = "L"; });
    if (call.unionQuery === "") throw new ReportRefusal("Blank Groups For Narration\nCheck Database..OUTPUT", "INTERNAL PROGRAM FAILURE");
    const fixCols = call.fixCols.replace(`'LED' as "ROW_DATA_TYPE"`, `'NARRATION' as "ROW_DATA_TYPE"`);
    const narrationOrder = order !== "" && !order.toLowerCase().startsWith("led.doc_no") ? ` ORDER BY ${order},LED.DOC_NO,LED.FULL_DOCNO` : ` ORDER BY SORTING_DATE,LED.DOC_NO`;
    const narration = await runReportSql(loader, frag(`SELECT ${fixCols}${call.unionQuery}${plainFrom}${where}${narrationOrder}`));
    const names = table.columns.filter((name) => name !== "ORDERCOL" && name !== "ORDERCOL1");
    const nameAt = names.findIndex((name) => name.toUpperCase() === "NAME");
    const numberColumns = new Set(names.filter((name) => table.kind(name) !== "text"));
    narration.rows.forEach((source, rowAt) => {
      const cells = narration.fields.map((field) => source[field.name]);
      const blank: ResultRow = Object.fromEntries(table.columns.map((name) => [name, null]));
      cells.forEach((value, at) => { if (at < names.length) blank[names[at]] = value === "" && numberColumns.has(names[at]) ? 0 : value; });
      for (const heading of headings) blank[heading] = heading.startsWith("TAX_DESCRIPTION") ? "" : 0;
      blank.ORDERCOL = rowAt + 1;
      const full = cells[nameAt];
      if (full === null || full === undefined || toText(full).trim() === "\\") return;
      narrationPieces(String(full), { count: 13, firstMarked: false, lastUnbounded: true })
        .forEach((piece, chunk) => table.rows.push({ ...blank, [names[nameAt]]: piece, ORDERCOL1: `N${String(chunk + 1).padStart(2, "0")}` }));
    });
    const addonOrder = call.prodAddonRelate === "P" ? call.selectKey.slice(0, 4).map((key, at) => (key !== "" ? table.name(`SMART_SELECTED_ADDON${at + 1}`) : undefined)).filter((name): name is string => name !== undefined) : [];
    sortRows(table, [...addonOrder.map((name) => (row: ResultRow) => textKey(row[name])), (row) => numberKey(row.ORDERCOL), (row) => textKey(row.ORDERCOL1)]);
  }
  return table;
}

// ======================================================================================
// 5: OUTSTANDING AGEING (lines 3375-7003, "ACTIONS FOR OUTSTANDING AGEING")
// ======================================================================================
//
// Each party's bills still to be paid, aged in days since the bill, in the buckets 0-30, 31-60,
// 61-90, 91-180 and 181 and above. The procedure works a row at a time through temp tables; the web
// does the same sums with set queries and in memory (the results are the same, only quicker):
//  - The party's closing balance at the Upto date (opening of the year + debits - credits) plus the
//    advances not yet set against a bill is what is owed on the bills.
//  - It is spread over the party's bills, the newest first; a bill it does not reach is left out and
//    one it reaches in part shows what is left of it (CLEAR_AMOUNT is the rest).
//  - What is left after the last bill is one "Opening" row, dated the start of the year.
//  - A party whose balance is the other way shows one "Unadjusted" row with its amount below zero.
//  - With On Account To Settle the advances are rows of their own (negative), dated their entry.
// Party Wise puts a heading row for the party over its rows; Date Wise lists the rows by date.
//
// Summary: a row for each party (and credit days) with its bills added up, the party's oldest age in
// days, and its last receipt (or payment) and last invoice.
//
// The sortings (the value typed in their box is the limit):
//  - Party Wise: the parties, each with its heading; Date Wise: by date, no headings.
//  - Above Days / Below Days: only the rows older (not older) than the days.
//  - Above Amount / Below Amount: only the rows whose pending is at least (at most) the amount.
//  - Grace Days: the days are added to every bill's credit days.
//  - Interest Perc: the procedure does nothing with it for this report; it lists like Party Wise.
//
// Not ported (the web says so rather than print a different report): Multi Company, With FIFO,
// Outstanding With All Entries, With PDC, Only On Account Detail, and the ageing columns picked
// from DAYS_GAP.
//
// Monthly: a row for each party (and credit days) with its pending bills added up by the month of
// the bill (Oct_25_AMT ...), from the first bill's month (or From's month) to Upto's month; bills
// before From are one OPEN_AMT column; then TOT_AMT and the last receipt / invoice as in Summary.

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AGEING_BUCKETS: readonly [string, number, number][] = [["Days_0_30", 0, 30], ["Days_31_60", 31, 60], ["Days_61_90", 61, 90], ["Days_91_180", 91, 180], ["Days_181_Above", 181, 99999]];

async function ageing(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const checks = (name: string) => call.checkQuery.includes(`${name},`);
  const unsupported = (what: string) => new ReportRefusal(`${what} is not available in the web version of the ageing yet.`, "Not ported yet");
  for (const [name, caption] of [["CHK_MULTICO", "Multi Company Report"], ["CHK_FIFO", "Outstanding With FIFO"], ["CHK_WITHALLENT", "Outstanding With All Entries"], ["CHK_PDC", "With PDC"], ["CHK_ONACCSTL", "Only On Account Detail"], ["CHK_AGCOLSEL", "Ageing Column Selection"]] as const) {
    if (checks(name)) throw unsupported(caption);
  }
  const summary = call.filterText === "Summary";
  const monthly = call.filterText === "Monthly";
  const licence21 = loader.session.licence === 21;
  if (call.filterText !== "Detail" && !summary && !monthly) throw unsupported(`The ${call.filterText} filter`);
  const sorting = call.sortingText;
  const partyWise = sorting !== "Date Wise";
  const limitText = call.text.find((value) => value.trim() !== "")?.trim() ?? "";
  const limit = Number(limitText.replace(/,/g, ""));
  if (limitText !== "" && !Number.isFinite(limit)) throw new ReportRefusal(`Enter a number for ${sorting}`, "Report Generation Failed");
  if (call.dateField === "") throw new ReportRefusal("DATE FIELD FOUND BLANKS\nPLEASE CHECK DATABASE", "INTERNAL PROGRAM FAILURE");

  // Sale (8): the bills are debits of the debtors (book 2); purchase (13) and expense (15): credits of the creditors (3) / expense parties (1).
  const book = Number(call.fcValue);
  const sale = book === 8;
  const partyBook = book === 8 ? 2 : book === 13 ? 3 : 1;
  const billSide = sale ? 1 : 2;
  const adviceSide = sale ? 2 : 1;
  const upto = desktopDate(call.upto);
  const yearStart = desktopDate(call.tarikh1);

  // The bills: the setup's own select, from and where, with the setoffs up to the Upto date.
  const start = call.queryStart.split("ac.co_short").join("''").split("'|SYS.FROMDT|'").join(`'${upto}'`).split("|SYS.FROMDT|").join(`'${upto}'`);
  const from = `${call.from_.replace("|sys.aente|", "")} left join (select OUT_AG_OUTID, SUM(out_setoff::numeric) as OUTSETOF from ${db}OUTCLEAR where out_date<='${upto}' group by OUT_AG_OUTID) outsetoff on outsetoff.OUT_AG_OUTID=outclr.OUT_KEY`;
  const where = `${call.where.split("|sys.yearid|").join(call.yearId)} and outclr.out_dbcode=${billSide} and ac.book=${partyBook} and ac.os_flag<>'N' and ((led.doc_posting='L' and outclr.OUT_ENTRYAMT-outclr.OUT_LY_SETOFF<>0) or led.doc_posting<>'L') and (outclr.OUT_ENTRYAMT-coalesce(OUTSETOF,0.00)-outclr.out_ly_setoff) > 0`;
  const series = call.seriesText.trim() !== "" && call.seriesText.trim().toUpperCase() !== "ALL" ? ` and rtrim(led.doc_series) = '${call.seriesText.trim().replace(/'/g, "''")}'` : "";
  const bills = await runReportSql(loader, frag(`SELECT ${start},coalesce(led.credit_days,0) AS "_LEDDAYS",to_char(led.doc_date,'YYYYMMDD') AS "_SORTDATE"${from}${where}${series}`));
  const table = tableFromFields(bills.fields.filter((field) => field.name !== "_LEDDAYS" && field.name !== "_SORTDATE"));
  for (const name of ["ROW_DATA_TYPE", "SMART_NAME", "SMART_AC_CODE", "SORTING_DATE"]) if (!table.has(name)) table.addColumn(name);
  const col = (name: string) => table.name(name) ?? name;

  // The parties: those ticked (or, with an addon group, those that have bills).
  const ticked = call.selectKey[4].replace(/[()]/g, "").split(",").map((code) => Number(code.trim())).filter((code) => Number.isFinite(code) && code > 0);
  const codes = ticked.length > 0 ? ticked : [...new Set(bills.rows.map((row) => Number(row[bills.fields.find((field) => field.name.toLowerCase() === "ac_code")?.name ?? "ac_code"])))];
  if (codes.length === 0) throw new ReportRefusal("No Records Found", "No Data");
  const list = codes.join(",");

  // Addon groups (Sales Man, Area ...): each ticked addon's text for every party goes in the group column SMART_SELECTED_ADDON<n> that the
  // output groups and subtotals on (n by the order they were ticked; the account is the last group).
  const addonExpressions = call.unionGroups.split(",").map((text) => text.trim()).filter((text) => text !== "" && text.toLowerCase() !== "ac.name");
  const addonColumns = addonExpressions.map((_, at) => `SMART_SELECTED_ADDON${at + 1}`);
  const addonOf = new Map<number, string[]>();
  if (addonExpressions.length > 0) {
    const found = await runReportSql(loader, frag(`SELECT ac.code AS code, ${addonExpressions.map((expression, at) => `${expression} AS "g${at}"`).join(",")} FROM ${db}ACCOUNT ac LEFT JOIN ${db}ADDON_DATA adata ON adata.code = ac.code WHERE ac.code IN (${list})`));
    for (const row of found.rows) addonOf.set(Number(row.code), addonExpressions.map((_, at) => toText(row[`g${at}`])));
    for (const name of addonColumns) table.addColumn(name);
  }
  const setAddon = (row: ResultRow, code: number) => { const values = addonOf.get(code); addonColumns.forEach((name, at) => { row[col(name)] = values?.[at] ?? ""; }); };

  // Closing balance of each party at the Upto date, and its name and credit days.
  const sums = await runReportSql(loader, frag(`SELECT ac.code AS code, ac.name AS name, ac.credit_days AS credit_days, ac.grace_days AS grace_days, coalesce(MAX(acbal.opening::numeric),0.00) AS opening,`
    + ` coalesce((select sum(case when led.ac_dbcode=1 then led.amount::numeric else 0.00 end) - sum(case when led.ac_dbcode=2 then led.amount::numeric else 0.00 end) from ${db}LEDGER led where led.code=ac.code and led.doc_pos<>'D' and led.doc_date<='${upto}' and led.doc_posting='P' and led.book_code in (select code from ${db}ACCOUNT where a_pos<>'D')),0.00) AS movement`
    + ` FROM ${db}ACCOUNT ac left join ${db}AC_BALANCE acbal on acbal.code=ac.code and acbal.year_id='${call.yearId}' WHERE ac.a_pos<>'D' and ac.book=${partyBook} and ac.os_flag<>'N' and ac.code in (${list}) GROUP BY ac.code,ac.name,ac.credit_days,ac.grace_days`));
  const parties = new Map<number, { name: string; closing: number }>();
  for (const row of sums.rows) parties.set(Number(row.code), { name: toText(row.name), closing: money(num(row.opening) + num(row.movement)) });

  // Advances not yet set against a bill: rows of their own, below zero.
  const advances = await runReportSql(loader, frag(`SELECT outclr.out_ledid AS led_key, ac.code AS code, ac.name AS name, ac.a_short AS a_short, outclr.out_entrybook AS book, outclr.out_fulldocno AS full_docno, outclr.out_date AS out_date, outclr.out_entryamt::numeric AS amount, to_char(led.doc_date,'YYYYMMDD') AS sortdate, led.doc_no AS doc_no`
    + ` FROM ${db}ACCOUNT ac left join ${db}OUTCLEAR outclr on outclr.code=ac.code left join ${db}LEDGER led on led.led_key=outclr.out_ledid`
    + ` WHERE coalesce(out_ag_outid,0)=0 and outclr.out_dbcode=${adviceSide} and outclr.out_entryamt::numeric<>0 and ac.book=${partyBook} and outclr.out_fulldocno<>'OPENING' and led.doc_posting<>'L' and led.doc_pos<>'D' and ac.os_flag<>'N' and led.book=${book} and ac.code in (${list}) and led.doc_date<='${upto}'${series}`));
  const advanceOf = new Map<number, ResultRow[]>();
  for (const row of advances.rows) { const code = Number(row.code); (advanceOf.get(code) ?? advanceOf.set(code, []).get(code)!).push(row); }

  const billsOf = new Map<number, ResultRow[]>();
  const codeColumn = bills.fields.find((field) => field.name.toLowerCase() === "ac_code")!.name;
  bills.rows.forEach((row) => { (billsOf.get(Number(row[codeColumn])) ?? billsOf.set(Number(row[codeColumn]), []).get(Number(row[codeColumn]))!).push(row); });

  const upToDate = call.upto;
  const dayStart = Date.UTC(call.tarikh1.getFullYear(), call.tarikh1.getMonth(), call.tarikh1.getDate());
  const dayEnd = Date.UTC(upToDate.getFullYear(), upToDate.getMonth(), upToDate.getDate());
  const openingDays = Math.round((dayEnd - dayStart) / 86400000) + 1;
  const dateText = (value: Date | string) => dateStyle6(value instanceof Date ? value : new Date(value)).replace(/ /g, "-");
  const out: ResultRow[] = [];
  const blank = (): ResultRow => Object.fromEntries(table.columns.map((name) => [name, null]));
  const baseRow = (code: number, name: string, extra: Record<string, unknown>): ResultRow => {
    const row = blank();
    row[col("SMART_AC_CODE")] = code; row[col("SMART_NAME")] = name; row[col("NAME")] = name; row[col("SELECTED_NAME")] = name; row[col("ac_Code")] = code;
    for (const [key, value] of Object.entries(extra)) row[col(key)] = value;
    setAddon(row, code);
    return row;
  };
  const sortingCol = (name: string, code: number, suffix: string) => `${name.trim()}${code}${suffix}`;
  const graceTyped = sorting === "Grace Days" && limitText !== "";
  const graceAdd = checks("CHK_GRCDAYS") || graceTyped ? 1 : 0;

  for (const code of codes) {
    const party = parties.get(code);
    if (!party) continue;
    const sumRow = sums.rows.find((row) => Number(row.code) === code)!;
    const graceDays = graceTyped ? limit : graceAdd ? num(sumRow.grace_days) : 0;
    const credit = num(sumRow.credit_days) + graceDays;
    const advance = advanceOf.get(code) ?? [];
    const advanceTotal = money(advance.reduce((sum, row) => sum + num(row.amount), 0));
    // What is owed on the bills (positive): the closing plus the advances (sale), or the closing's other side (purchase).
    let open = sale ? money(party.closing + advanceTotal) : money(-(party.closing - advanceTotal));
    const rows: ResultRow[] = [];
    // The newest bill first (date, then voucher number, both falling).
    const docNo = (row: ResultRow) => Number(toText(row[col("DOC_NO")]).replace(/\D/g, "")) || 0;
    const mine = (billsOf.get(code) ?? []).slice().sort((a, b) => toText(b._SORTDATE).localeCompare(toText(a._SORTDATE)) || docNo(b) - docNo(a));
    if (open < 0) {
      if (!checks("CHK_OVERDUE")) {
        const row = baseRow(code, party.name, { SORTING_COL: sortingCol(party.name, code, `${dateStyle112(call.upto)}   P`), FULL_DOCNO: "Unadjusted", selected_date: dateText(call.upto), INVOICE_AMT: open, CLEAR_AMOUNT: 0, PENDING: open, Days: 0, ROW_DATA_TYPE: "LED", SORTING_DATE: dateStyle112(call.upto) });
        row._MD = dateStyle112(call.upto);
        rows.push(row);
      }
      open = 0;
    } else {
      for (const bill of mine) {
        const pending = num(bill[col("PENDING")]);
        const current = Math.min(open, pending);
        if (current <= 0) continue;
        const copy: ResultRow = { ...bill };
        delete copy._LEDDAYS; delete copy._SORTDATE;
        const days = num(bill[col("Days")]);
        const entryDays = checks("CHK_ENTCDAY") && num(bill._LEDDAYS) > 0 ? num(bill._LEDDAYS) + graceDays : credit;
        copy[col("PENDING")] = current;
        copy[col("Clear_Amount")] = money(num(bill[col("INVOICE_AMT")]) - current);
        copy[col("CDays")] = entryDays;
        copy[col("ROW_DATA_TYPE")] = "LED"; copy[col("SMART_NAME")] = party.name; copy[col("SMART_AC_CODE")] = code; copy[col("SORTING_DATE")] = toText(bill._SORTDATE);
        copy[col("MONTH_TOTAL")] = current; copy._MD = toText(bill._SORTDATE);
        setAddon(copy, code);
        // The setup's sort key starts with the addon's text; the groups are ordered on their own columns now, so the key is the party's, like the rows added below.
        if (addonColumns.length > 0) copy[col("SORTING_COL")] = sortingCol(party.name, code, `${toText(bill._SORTDATE)}   P`);
        if (checks("CHK_OVERDUE") && entryDays >= days) { open = money(open - current); continue; }
        open = money(open - current);
        rows.push(copy);
      }
      if (open > 0) {
        rows.push(baseRow(code, party.name, { SORTING_COL: sortingCol(party.name, code, `${dateStyle112(call.tarikh1)} OP`), FULL_DOCNO: "Opening", selected_date: dateText(call.tarikh1), INVOICE_AMT: open, CLEAR_AMOUNT: 0, PENDING: open, MONTH_TOTAL: open, Days: openingDays, CDays: credit, ROW_DATA_TYPE: "LED", SORTING_DATE: dateStyle112(call.tarikh1), _MD: dateStyle112(call.tarikh1) }));
      }
    }
    // The advances, below zero (On Account To Settle).
    if (checks("CHK_ACCSTL")) {
      for (const row of advance) {
        const amount = -num(row.amount);
        rows.push(baseRow(code, party.name, { SORTING_COL: sortingCol(party.name, code, `${toText(row.sortdate)}   P`), LED_KEY: row.led_key, FULL_DOCNO: toText(row.full_docno), selected_date: dateText(row.out_date as Date), INVOICE_AMT: amount, CLEAR_AMOUNT: 0, PENDING: amount, MONTH_TOTAL: amount, Days: 0, CDays: credit, a_short: toText(row.a_short), BOOK: row.book, ROW_DATA_TYPE: "LED", SORTING_DATE: toText(row.sortdate), _MD: dateStyle112(row.out_date as Date) }));
      }
    }
    // Above / Below Days and Amount: rows past the limit are left out.
    if (limitText !== "") {
      const keep = (row: ResultRow) => {
        const days = num(row[col("Days")]);
        const pending = num(row[col("PENDING")]);
        if (sorting === "Above Days") return !(days < limit);
        if (sorting === "Below Days") return !(days > limit);
        if (sorting === "Above Amount") return !(pending < limit);
        if (sorting === "Below Amount") return !(pending > limit);
        return true;
      };
      for (let at = rows.length - 1; at >= 0; at -= 1) if (!keep(rows[at])) rows.splice(at, 1);
    }
    if (rows.length === 0) continue;
    // The ageing columns: the pending amount in the bucket its days fall in.
    for (const row of rows) {
      const days = num(row[col("Days")]);
      const pending = num(row[col("PENDING")]);
      for (const [name, low, high] of AGEING_BUCKETS) row[col(name)] = days >= low && days <= high ? pending : 0;
    }
    if (partyWise) out.push(baseRow(code, party.name, { SORTING_COL: `${party.name.trim()}${code}   H`, FULL_DOCNO: party.name, ROW_DATA_TYPE: "AC" }));
    pushAll(out, rows);
  }
  if (out.length === 0) throw new ReportRefusal("No Records Found", "No Data");
  // The last receipt (or payment) and the last invoice of each party, by the party's code.
  const lastReceipts = async (): Promise<(sum: ResultRow, code: number) => void> => {
    const last = async (books: string, side: number | null) => {
      const found = await runReportSql(loader, frag(`SELECT DISTINCT ON (led.code) led.code AS code, to_char(led.doc_date,'DD Mon YY') AS doc_date, led.amount::numeric AS amount FROM ${db}LEDGER led WHERE led.code in (${list}) and led.doc_pos='A' and led.book in (${books})${side === null ? "" : ` and led.ac_dbcode=${side} and led.doc_posting='P'`} ORDER BY led.code, led.doc_date DESC, led.led_key DESC`));
      return new Map(found.rows.map((row) => [Number(row.code), { date: toText(row.doc_date).replace(/ /g, "-"), amount: num(row.amount) }]));
    };
    const cash = await last("4,6", sale ? 2 : 1);
    const invoice = await last(book === 8 ? "8" : book === 13 ? "13" : "15", null);
    const cashName = "LAST_" + (sale ? "RECD" : "PAY");
    return (sum, code) => {
      sum[cashName + "_DATE"] = cash.get(code)?.date ?? null;
      sum[cashName + "_AMT"] = cash.get(code)?.amount ?? null;
      sum.LAST_INV_DATE = invoice.get(code)?.date ?? null;
      sum.LAST_INV_AMT = invoice.get(code)?.amount ?? null;
    };
  };
  if (summary) {
    const result = new ResultTable();
    const mobile = checks("CHK_MOBILE");
    for (const name of ["ROW_DATA_TYPE", "SMART_NAME", "NAME", ...(mobile ? ["MOBILE_NO"] : []), "INVOICE_AMT", "CLEAR_AMOUNT", "PENDING", ...(licence21 ? ["TOTAL_ABOVE_90"] : []), "CDays", "Days", ...AGEING_BUCKETS.map((bucket) => bucket[0]), "SORTING_COL", "LAST_" + (sale ? "RECD" : "PAY") + "_DATE", "LAST_" + (sale ? "RECD" : "PAY") + "_AMT", "LAST_INV_DATE", "LAST_INV_AMT"]) result.addColumn(name);
    for (const name of ["INVOICE_AMT", "CLEAR_AMOUNT", "PENDING", ...(licence21 ? ["TOTAL_ABOVE_90"] : []), "LAST_" + (sale ? "RECD" : "PAY") + "_AMT", "LAST_INV_AMT", ...AGEING_BUCKETS.map((bucket) => bucket[0])]) result.setKind(name, "decimal");
    // Licence 21: TOTAL_ABOVE_90, the party's pending on its bills more than 90 days old (every credit days row of the party).
    const above90 = new Map<number, number>();
    if (licence21) for (const row of out) if (toText(row[col("ROW_DATA_TYPE")]) === "LED" && num(row[col("Days")]) > 90) { const code = Number(row[col("SMART_AC_CODE")]); above90.set(code, money((above90.get(code) ?? 0) + num(row[col("PENDING")]))); }
    for (const name of ["CDays", "Days"]) result.setKind(name, "int");
    // The party's oldest age, over all its rows.
    const oldest = new Map<number, number>();
    for (const row of out) { const code = Number(row[col("SMART_AC_CODE")]); oldest.set(code, Math.max(oldest.get(code) ?? 0, num(row[col("Days")]))); }
    const grouped = new Map<string, ResultRow>();
    for (const row of out) {
      if (toText(row[col("ROW_DATA_TYPE")]) === "AC") continue;
      const code = Number(row[col("SMART_AC_CODE")]);
      const key = `${code}|${num(row[col("CDays")])}`;
      let sum = grouped.get(key);
      if (!sum) {
        sum = { ROW_DATA_TYPE: "LED", SMART_NAME: row[col("SMART_NAME")], NAME: row[col("SMART_NAME")], ...(mobile ? { MOBILE_NO: row[col("MOBILE_NO")] } : {}), INVOICE_AMT: 0, CLEAR_AMOUNT: 0, PENDING: 0, ...(licence21 ? { TOTAL_ABOVE_90: above90.get(code) ?? 0 } : {}), CDays: num(row[col("CDays")]), Days: oldest.get(code) ?? 0, SORTING_COL: toText(row[col("SMART_NAME")]), _code: code };
        for (const [name] of AGEING_BUCKETS) sum[name] = 0;
        grouped.set(key, sum);
      }
      sum.INVOICE_AMT = money(num(sum.INVOICE_AMT) + num(row[col("INVOICE_AMT")]));
      sum.CLEAR_AMOUNT = money(num(sum.CLEAR_AMOUNT) + num(row[col("Clear_Amount")]));
      sum.PENDING = money(num(sum.PENDING) + num(row[col("PENDING")]));
      for (const [name] of AGEING_BUCKETS) sum[name] = money(num(sum[name]) + num(row[col(name)]));
    }
    const setLast = await lastReceipts();
    for (const sum of grouped.values()) { const code = Number(sum._code); delete sum._code; setLast(sum, code); }
    result.rows = [...grouped.values()];
    sortRows(result, [(row) => textKey(row.SORTING_COL), (row) => numberKey(row.CDays)]);
    return result;
  }
  if (monthly) {
    const mobile = checks("CHK_MOBILE");
    const lastName = "LAST_" + (sale ? "RECD" : "PAY");
    const monthStart = (value: string) => new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, 1);
    const fromText = dateStyle112(call.from);
    const midYear = call.from.getTime() !== call.tarikh1.getTime();
    // The first month: From's, or (From being the year's start) that of the oldest bill.
    const dated = out.filter((row) => toText(row[col("ROW_DATA_TYPE")]) === "LED" && /^\d{8}$/.test(toText(row._MD)));
    const oldest = dated.reduce((least, row) => (toText(row._MD) < least ? toText(row._MD) : least), "99999999");
    let month = midYear || oldest === "99999999" ? new Date(call.from.getFullYear(), call.from.getMonth(), 1) : monthStart(oldest);
    const months: Date[] = [];
    for (; month <= call.upto; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) months.push(month);
    const monthName = (value: Date) => `${MONTH_SHORT[value.getMonth()]}_${String(value.getFullYear()).slice(-2)}_AMT`;
    const names = ["ROW_DATA_TYPE", "SMART_NAME", "NAME", "CDays", ...(mobile ? ["MOBILE_NO"] : []), ...(midYear ? ["OPEN_AMT"] : []), ...months.map(monthName), "TOT_AMT", "SORTING_COL", lastName + "_DATE", lastName + "_AMT", "LAST_INV_DATE", "LAST_INV_AMT"];
    const result = new ResultTable();
    for (const name of names) result.addColumn(name);
    for (const name of names.filter((candidate) => candidate === "OPEN_AMT" || candidate === "TOT_AMT" || candidate.endsWith("_AMT"))) result.setKind(name, "decimal");
    result.setKind("CDays", "int");
    const grouped = new Map<string, ResultRow>();
    for (const row of out) {
      if (toText(row[col("ROW_DATA_TYPE")]) === "AC") continue;
      const code = Number(row[col("SMART_AC_CODE")]);
      const key = `${code}|${num(row[col("CDays")])}`;
      let sum = grouped.get(key);
      if (!sum) {
        sum = { ROW_DATA_TYPE: "LED", SMART_NAME: row[col("SMART_NAME")], NAME: row[col("SMART_NAME")], CDays: num(row[col("CDays")]), ...(mobile ? { MOBILE_NO: row[col("MOBILE_NO")] } : {}), SORTING_COL: toText(row[col("SMART_NAME")]), _code: code, TOT_AMT: 0 };
        if (midYear) sum.OPEN_AMT = 0;
        for (const value of months) sum[monthName(value)] = 0;
        grouped.set(key, sum);
      }
      const pending = num(row[col("PENDING")]);
      const day = toText(row._MD);
      sum.TOT_AMT = money(num(sum.TOT_AMT) + pending);
      if (midYear && day < fromText) sum.OPEN_AMT = money(num(sum.OPEN_AMT) + pending);
      else {
        const target = months.find((value) => /^\d{8}$/.test(day) && value.getFullYear() === Number(day.slice(0, 4)) && value.getMonth() === Number(day.slice(4, 6)) - 1);
        if (target) sum[monthName(target)] = money(num(sum[monthName(target)]) + pending);
      }
    }
    const setLast = await lastReceipts();
    for (const sum of grouped.values()) { const code = Number(sum._code); delete sum._code; setLast(sum, code); }
    result.rows = [...grouped.values()];
    sortRows(result, [(row) => textKey(row.SORTING_COL), (row) => numberKey(row.CDays)]);
    return result;
  }
  for (const name of ["INVOICE_AMT", "Clear_Amount", "PENDING", "MONTH_TOTAL", ...AGEING_BUCKETS.map((bucket) => bucket[0])]) if (table.has(name)) table.setKind(name, "decimal");
  for (const name of ["CDays", "Days"]) if (table.has(name)) table.setKind(name, "int");
  table.rows = out;
  // Licence 21: NET_AMOUNT, each bill's amount before tax: the register's master slab total (S_LASTOT) less its own amount (SLAB_AMT), found by the bill's number.
  if (licence21) {
    table.addColumn("NET_AMOUNT");
    table.setKind("NET_AMOUNT", "decimal");
    const slabKey = (await runReportSql(loader, `SELECT slab_key FROM ${db}SLAB_MASTER WHERE book = ${book} AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key DESC LIMIT 1`)).rows[0]?.slab_key;
    const numbers = [...new Set(out.filter((row) => toText(row[col("ROW_DATA_TYPE")]) === "LED").map((row) => toText(row[col("FULL_DOCNO")])).filter((text) => text !== ""))];
    const nets = new Map<string, number>();
    if (slabKey !== undefined && slabKey !== null && numbers.length > 0) {
      const found = await runReportSql(loader, `SELECT DISTINCT ON (led.full_docno) led.full_docno AS full_docno, (coalesce(ledext.S_LASTOT::numeric,0) - coalesce(ledext.SLAB_AMT::numeric,0)) AS net FROM ${db}LEDGER led JOIN ${db}LEDGER_EXT ledext ON ledext.led_id = led.led_key`
        + ` WHERE led.full_docno = ANY($1::text[]) AND ledext.il_id IS NULL AND ledext.slab_id = ${Number(slabKey)} AND led.doc_pos <> 'D' ORDER BY led.full_docno, led.led_key DESC`, [numbers]);
      for (const row of found.rows) nets.set(toText(row.full_docno), num(row.net));
    }
    for (const row of out) if (toText(row[col("ROW_DATA_TYPE")]) === "LED") row.NET_AMOUNT = nets.has(toText(row[col("FULL_DOCNO")])) ? money(nets.get(toText(row[col("FULL_DOCNO")]))!) : null;
  }
  // Due date of each bill: its date plus the credit days.
  if (checks("CHK_PRINTDUEDATE")) {
    for (const row of table.rows) {
      if (toText(row[col("ROW_DATA_TYPE")]) !== "LED") continue;
      const sort = toText(row[col("SORTING_DATE")]);
      if (!/^\d{8}$/.test(sort)) continue;
      const base = new Date(Number(sort.slice(0, 4)), Number(sort.slice(4, 6)) - 1, Number(sort.slice(6, 8)));
      const cdays = num(row[col("CDays")]);
      const due = cdays === 0 ? base : new Date(base.getTime() + (cdays - 1) * 86400000);
      row[col("DUE_DATE")] = dateText(due);
    }
  }
  // Party Wise: a heading row for each addon group (Sales Man ...), over the parties it holds; the group values inside it are blank.
  if (partyWise && addonColumns.length > 0) {
    const seen = new Set<string>();
    for (const row of [...table.rows]) {
      const values = addonColumns.map((name) => toText(row[col(name)]));
      for (let level = 0; level < addonColumns.length; level += 1) {
        const key = `${level}\u0001${values.slice(0, level + 1).join("\u0001")}`;
        if (seen.has(key) || values[level] === "") continue;
        seen.add(key);
        const heading = blank();
        addonColumns.forEach((name, at) => { heading[col(name)] = at <= level ? values[at] : ""; });
        heading[col("ROW_DATA_TYPE")] = `ADDON_${level + 1}`; heading[col("FULL_DOCNO")] = values[level]; heading[col("SORTING_COL")] = "";
        table.rows.push(heading);
      }
    }
  }
  // The order: the addon groups, then by party name and date (Party Wise: the heading first), or by date (Date Wise).
  const groupOrder = addonColumns.map((name) => (row: ResultRow) => textKey(row[col(name)]));
  if (partyWise) sortRows(table, [...groupOrder, (row) => textKey(row[col("SORTING_COL")]), (row) => textKey(row[col("SORTING_DATE")]), (row) => textKey(row[col("FULL_DOCNO")])]);
  else sortRows(table, [...groupOrder, (row) => textKey(row[col("SORTING_DATE")]), (row) => textKey(row[col("SMART_NAME")])]);
  // Date Wise Detail: the pending added up down the list, before NET_AMOUNT.
  if (!partyWise && !summary && !monthly && table.has("PENDING")) {
    table.addColumn("RUNNING_BAL"); table.setKind("RUNNING_BAL", "decimal");
    const at = table.columns.findIndex((name) => name.toUpperCase() === "NET_AMOUNT");
    if (at >= 0) { table.columns.splice(table.columns.indexOf("RUNNING_BAL"), 1); table.columns.splice(at, 0, "RUNNING_BAL"); }
    let running = 0;
    for (const row of table.rows) {
      if (toText(row[col("ROW_DATA_TYPE")]) !== "LED") continue;
      running = Math.round((running + num(row[col("PENDING")])) * 100) / 100;
      row[col("RUNNING_BAL")] = running;
    }
  }
  return table;
}

// ======================================================================================
// 2: JOURNAL (lines 975-1011, "ACTIONS FOR JV")
// ======================================================================================
//
// Every posted line (DOC_POSTING P) of each journal voucher that has a line in the period and
// the selection: the voucher is found by its FULL_DOCNO, so all its lines come, even those of
// accounts that were not ticked. In date, voucher and debit/credit order. Only a voucher's
// first line shows its date (and narration); the others are blank, so a voucher reads as a block.
// The rank is per (DOC_NO, SYSTEM_BLANK2) in the table's own order.

async function journal(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  if (call.dateField === "") throw new ReportRefusal("DATE FIELD FOUND BLANK\nPLEASE CHECK DATABASE", "INTERNAL PROGRAM FAILURE");
  const csFrom = cashBookFrom(plan);
  const dated = call.text[0] === "" ? ` AND ${call.dateField} BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}'` : "";
  const inner = `SELECT LED.FULL_DOCNO${csFrom}${call.where}${/\bbetween\b/i.test(call.where) ? "" : dated} and led.DOC_POSTING='P' `;
  // bit_use_union 0: the narration is a column of its own; otherwise (Show Narration in rows) it is left out.
  const narration = call.showNarration && call.useUnion ? "" : ",led.NARRATION";
  const sql = `SELECT ${call.queryStart}${narration}${csFrom} WHERE LED.FULL_DOCNO IN (${inner}) and led.DOC_POS<>'D' and led.DOC_POSTING='P'${dated} ORDER BY LED.DOC_NO,LED.AC_DBCODE,"SORTING_DATE"`;
  const lines = await runReportSql(loader, frag(sql));
  const table = tableFromFields(lines.fields);
  table.rows = lines.rows.map((row) => ({ ...row }));

  // TEMP_TABLE_JV2: ROW_NUMBER() per (doc_no, SYSTEM_BLANK2); the lines ranked after the first lose their date and narration.
  const docNo = table.name("doc_no");
  const blank = table.name("SYSTEM_BLANK2");
  const date = table.name("selected_date");
  const narrationName = table.name("NARRATION");
  // With groups ticked a voucher's lines fall under different groups, so every line keeps its date and narration.
  const grouped = plan.tickedGroups.length > 0;
  const seen = new Set<string>();
  for (const row of grouped ? [] : table.rows) {
    const key = `${docNo ? toText(row[docNo]) : ""}\u0001${blank ? toText(row[blank]) : ""}`;
    if (!seen.has(key)) { seen.add(key); continue; }
    if (date) row[date] = "";
    if (narrationName) row[narrationName] = "";
  }
  const dbcode = table.name("ac_dbcode");
  // The groups first (Area, then Account ...), as the subtotals break on them.
  const groupKeys = plan.grouping.map((name) => table.name(name)).filter((name): name is string => name !== undefined);
  sortRows(table, [
    ...groupKeys.map((name) => (row: ResultRow) => textKey(row[name])),
    (row) => textKey(table.get(row, "SORTING_DATE")),
    (row) => rightAlignedKey(table.get(row, "doc_no")),
    (row) => textKey(table.get(row, "full_docno")),
    (row) => (dbcode ? numberKey(row[dbcode]) : 0),
  ]);
  return table;
}

// ======================================================================================
// 1: DAYBOOK (lines 234-975)
// ======================================================================================
//
// No Account / Book / Schedule group: the account's vouchers in date order. Show Narration (not in
// the same line) adds each voucher's narration under it as rows of 40 characters; with no group and
// no filter the year's opening (and the postings before From) heads the list and a Closing Balance
// row ends it. With one of those groups (or Selected Groups As Heading): the vouchers sorted by the
// groups, a heading row per group value when Selected Groups As Heading is ticked, no opening.
// RECEIPT / PAYMENT become GIVEN / TAKEN (book 5) or DEPOSIT / WITHDRAWAL (6); the cheque number
// stays only for a bank, the short name only for licences 3, 5, 7, 8. Where the desktop fails (an
// INTO returning no rows with Show Narration unticked and a filter, a UNION of unequal halves with an
// addon group) the web returns the rows the procedure meant to.

const SHORT_LICENCES = [3, 5, 7, 8];

/** The procedure's renames and drops, the same on every path. */
function daybookColumns(plan: ReportPlan, table: ResultTable, keepCheque: boolean): void {
  const { book, licence } = plan.call;
  const [first, second] = cashBookColumns(book);
  renameColumn(table, "RECEIPT", first);
  renameColumn(table, "PAYMENT", second);
  if (!SHORT_LICENCES.includes(licence)) dropColumn(table, "short");
  if (book !== 6 && !keepCheque) dropColumn(table, "DOC_NO1");
  for (const column of ["CLOSING_BAL", "CC_AMT"]) if (table.has(column)) table.setKind(column, "decimal");
}

async function daybook(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const csFrom = cashBookFrom(plan);
  if (call.dateField === "") throw new ReportRefusal("DATE FIELD FOUND BLANKS\nPLEASE CHECK DATABASE", "INTERNAL PROGRAM FAILURE");
  const headings = call.groupsAsHeadings || call.selectKey[4] !== "" || call.selectScheduleKey !== "" || call.selectBookKey !== "";
  const useUnion = call.showNarration ? call.useUnion : false;
  const selectEnd = call.queryEnd.trim() !== "" ? `,${call.queryEnd}` : "";
  const orderBy = ` ORDER BY ${call.orderBy.trim() !== "" ? `${call.orderBy},` : ""}"SORTING_DATE",led.bk_dbcode,led.doc_no`;
  if (headings) return daybookByGroups(loader, plan, csFrom, useUnion, selectEnd, orderBy);

  // TEMP_TABLE_DAYBOOK1: the account's vouchers; ORDERCOL / ORDERCOL1 (IDENTITY, 'L') follow the narration.
  const narrationColumn = useUnion ? "NARRATION1" : "NARRATION";
  const lines = await runReportSql(loader, frag(`SELECT ${call.queryStart},LED.NARRATION AS "${narrationColumn}"${selectEnd} ${csFrom} ${call.where}${orderBy}`));
  const table = tableFromFields(lines.fields);
  if (useUnion) {
    table.columns.splice(table.columns.indexOf(table.name(narrationColumn)!) + 1, 0, "ORDERCOL", "ORDERCOL1");
    table.setKind("ORDERCOL", "int");
  }
  table.rows = lines.rows.map((row, index) => (useUnion ? { ...row, ORDERCOL: index + 1, ORDERCOL1: "L" } : { ...row }));
  const lineCount = table.rows.length;

  // TEMP_TABLE_DAYBOOK2: each voucher's narration under it (N01 .. N10); the union's halves line up by position.
  if (useUnion) {
    if (call.unionQuery === "") throw new ReportRefusal("Blank Groups For Narration\nCheck Database..OUTPUT", "INTERNAL PROGRAM FAILURE");
    const fixCols = call.fixCols.replace(`'LED' as "ROW_DATA_TYPE"`, `'NARRATION' as "ROW_DATA_TYPE"`);
    const narration = await runReportSql(loader, frag(`SELECT ${fixCols}${call.unionQuery},LED.NARRATION AS "NARRATION1" ${csFrom} ${call.where}${orderBy}`));
    const names = table.columns.filter((name) => name !== "ORDERCOL" && name !== "ORDERCOL1");
    const nameAt = names.findIndex((name) => name.toUpperCase() === "NAME");
    const numberColumns = new Set(names.filter((name) => table.kind(name) !== "text"));
    narration.rows.forEach((source, index) => {
      const cells = narration.fields.filter((field) => field.name !== "NARRATION1").map((field) => source[field.name]);
      const base: ResultRow = Object.fromEntries(table.columns.map((name) => [name, null]));
      cells.forEach((value, at) => { if (at < names.length) base[names[at]] = value === "" && numberColumns.has(names[at]) ? 0 : value; });
      base[table.name(narrationColumn)!] = source.NARRATION1;
      base.ORDERCOL = index + 1;
      const full = cells[nameAt];
      if (full === null || full === undefined || toText(full).trim() === "\\") return;
      narrationPieces(String(full), { count: 10, firstMarked: false, lastUnbounded: true })
        .forEach((piece, chunk) => table.rows.push({ ...base, [names[nameAt]]: piece, ORDERCOL1: `N${String(chunk + 1).padStart(2, "0")}` }));
    });
  }

  // The opening and closing rows: only with no group and no filter.
  const openingBlock = call.queryEnd === "" && call.unionGroups === "" && call.filterId.toUpperCase() === "NONE";
  if (openingBlock) {
    const opening = await cashBookOpening(loader, plan, csFrom, dayBefore(call.from));
    const amounts = { RECEIPT: opening > 0 ? opening : 0, PAYMENT: opening < 0 ? Math.abs(opening) : 0 };
    if (useUnion) {
      // Narration in rows: the opening and the closing come only when there is an opening.
      if (opening !== 0) {
        table.insert({ selected_date: dateStyle6(call.upto), ROW_DATA_TYPE: "LED", NAME: "Closing Balance", RECEIPT: 0, PAYMENT: 0, ORDERCOL: lineCount + 1, ORDERCOL1: "z" });
        table.insert({ SELECTED_DATE: dateStyle6(call.from), ROW_DATA_TYPE: "OPENINGS", NAME: "Opening Balance", ...amounts, ORDERCOL: 1, ORDERCOL1: "A" });
      }
    } else {
      if (opening !== 0) insertFirst(table, { selected_date: dateStyle6(call.from), ROW_DATA_TYPE: "OPENINGS", NAME: "Opening Balance", ...amounts });
      table.insert({ sorting_date: dateStyle112(call.upto), selected_date: dateStyle6(call.upto), bk_dbcode: 50, ROW_DATA_TYPE: "LED", NAME: "Closing Balance", RECEIPT: 0, PAYMENT: 0 });
      // ORDER BY SORTING_DATE, bk_dbcode, RIGHT(SPACE(10)+doc_no,10): the opening (no date) first.
      sortRows(table, [(row) => textKey(table.get(row, "SORTING_DATE")), (row) => numberKey(table.get(row, "bk_dbcode")), (row) => rightAlignedKey(table.get(row, "doc_no"))]);
    }
  }
  if (useUnion) sortRows(table, [(row) => numberKey(row.ORDERCOL), (row) => textKey(row.ORDERCOL1)]);

  daybookColumns(plan, table, !useUnion && !openingBlock && call.selectKey.slice(0, 4).some((key) => key !== "") && call.filterId.toUpperCase() === "NONE");
  return table;
}

/** With Account / Book / Schedule ticked (or Selected Groups As Heading): TEMP_TABLE_DAYBOOK3. */
async function daybookByGroups(loader: Loader, plan: ReportPlan, csFrom: string, useUnion: boolean, selectEnd: string, orderBy: string): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const narrationColumn = useUnion ? "NARRATION1" : "NARRATION";
  const lines = await runReportSql(loader, frag(`SELECT ${call.queryStart},LED.NARRATION AS "${narrationColumn}"${selectEnd} ${csFrom}${call.where}${orderBy}`));
  const table = tableFromFields(lines.fields);
  for (const column of ["SMART_AC_CODE", "BOOK", "ROW_DATA_TYPE", "NAME", "SORTING_COL", "SMART_BOOK_CODE", "SMART_SCHEDULE_CODE"]) table.addColumn(column);

  // A heading row for each value of each ticked group (FN_GETFIXCOLNAMEFOR, report 1).
  if (call.unionGroups !== "" && call.checkQuery.includes("CHK_GRPASHD,")) {
    const smartColumns: string[] = [];
    const smartValues: string[] = [];
    const sorting: string[] = [];
    let addonNumber = 0;
    for (const group of groupList(call.unionGroups)) {
      smartColumns.push(groupSmartColumn(group, addonNumber));
      smartValues.push(group);
      const isAddon = removeAliasUpper(group).includes("TXT_");
      if (isAddon) addonNumber += 1;
      const fix = groupHeadingColumns(group, addonNumber);
      if (!fix) throw groupFailed();
      sorting.push(group);
      const nameValue = group.toUpperCase().includes("AC.NAME") ? "AC.NAME" : group;
      const values = [...fix.values, `'${fix.rowType}'`, ...smartValues, nameValue, sorting.join(" || ' ' || ")];
      const headingSql = frag(`SELECT DISTINCT ${values.map((value, index) => `${value} AS "c${index}"`).join(", ")} ${csFrom} ${call.where} ORDER BY "c${fix.values.length + 1 + smartValues.length}"`);
      const targets = [...fix.columns, "ROW_DATA_TYPE", ...smartColumns, "NAME", "SORTING_COL"];
      for (const heading of (await runReportSql(loader, headingSql)).rows) {
        const row: Record<string, unknown> = {};
        targets.forEach((column, index) => { row[column] = heading[`c${index}`]; });
        for (const column of Object.keys(row)) table.addColumn(column);
        table.insert(row);
      }
    }
  }

  for (const row of lines.rows) table.rows.push({ ...Object.fromEntries(table.columns.map((name) => [name, null])), ...row });

  // SORTING_COL trimmed, account headings end in "   H", SELECTED_NAME is the account.
  const sortCol = table.name("SORTING_COL")!;
  for (const row of table.rows) if (row[sortCol] !== null && row[sortCol] !== undefined) row[sortCol] = toText(row[sortCol]).trim();
  for (const row of table.rows) if (table.get(row, "ROW_DATA_TYPE") === "AC" && row[sortCol] !== null && row[sortCol] !== undefined) row[sortCol] = `${row[sortCol]}   H`;
  table.addColumn("SELECTED_NAME");
  for (const row of table.rows) row.SELECTED_NAME = table.get(row, "SMART_NAME");

  // A schedule heading sorts by the schedule's code and name.
  if (call.selectScheduleKey !== "") {
    const keys = [...new Set(table.rows.filter((row) => table.get(row, "ROW_DATA_TYPE") === "SCHEDULE").map((row) => Number(table.get(row, "SMART_SCHEDULE_CODE"))).filter((key) => Number.isInteger(key)))];
    if (keys.length > 0) {
      const schedules = new Map((await runReportSql(loader, `SELECT bs_key, bs_code, bs_desc FROM ${db}balsheet WHERE bs_key = ANY($1::int[])`, [keys])).rows.map((row) => [String(row.bs_key), row]));
      for (const row of table.rows.filter((candidate) => table.get(candidate, "ROW_DATA_TYPE") === "SCHEDULE")) {
        const schedule = schedules.get(String(table.get(row, "SMART_SCHEDULE_CODE")));
        if (schedule) row[sortCol] = schedule.bs_code === null || schedule.bs_desc === null ? null : `${schedule.bs_code} ${schedule.bs_desc}`;
      }
    }
  }

  // Narration under each voucher: SORTING_COL + P, P1 .. P9, inserted piece by piece.
  const narrationName = table.name(narrationColumn);
  if (call.showNarration && useUnion && narrationName) {
    const copy = ["SMART_LED_KEY", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_BOOK_CODE", "SMART_SCHEDULE_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE", "SORTING_DATE", "SYSTEM_BLANK2", "SMART_NAME", "SMART_SELECTED_BOOK", "SMART_SELECTED_SCHDULE", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "bk_dbcode", "led_key", "book"];
    const pieces = table.rows.map((row) => {
      const narration = row[narrationName];
      return narration === null || narration === undefined || toText(narration).trim() === "" ? [] : narrationPieces(String(narration), { count: 10, firstMarked: true, lastUnbounded: true });
    });
    const added: Record<string, unknown>[] = [];
    for (let chunk = 0; chunk < 10; chunk += 1) {
      table.rows.forEach((row, index) => {
        const piece = pieces[index][chunk];
        if (piece === undefined) return;
        const values: Record<string, unknown> = {};
        for (const column of copy) if (table.has(column)) values[column] = table.get(row, column);
        values.SORTING_COL = row[sortCol] === null || row[sortCol] === undefined ? null : `${row[sortCol]}P${chunk === 0 ? "" : chunk}`;
        values.ROW_DATA_TYPE = "NARRATION";
        values.NAME = piece;
        added.push(values);
      });
    }
    for (const values of added) table.insert(values);
    sortRows(table, [(row) => textKey(row[sortCol]), (row) => textKey(table.get(row, "ROW_DATA_TYPE"))]);
  } else {
    sortRows(table, [(row) => textKey(row[sortCol])]);
  }
  daybookColumns(plan, table, false);
  return table;
}

const removeAliasUpper = (group: string) => (group.includes(".") ? group.slice(group.indexOf(".") + 1) : group).toUpperCase();

// ======================================================================================
// 4: LEDGER (lines 2269-3375)
// ======================================================================================
//
// RESULT_TABLE_<user> is built through a dozen INSERT / UPDATE / DELETE statements and returned
// ORDER BY SORTING_COL, SORTING_DATE: heading rows of the ticked groups, each account's opening
// (with what was posted before From), the postings, their narration as rows of 40 characters, a
// journal's contra lines, the closing and account heading rows.

const SUBLED = "SUBLED";

/** Licences whose ledger keeps only some voucher series (29, 30 and 73). */
const SERIES_FILTER = " and (left(led.DOC_SERIES,2)='MS' or left(led.DOC_SERIES,2)='RD' or left(led.DOC_SERIES,2)='AI' or left(led.DOC_SERIES,2)='AL' or left(led.DOC_SERIES,2)='RG' or left(led.DOC_SERIES,2)='HC' or left(led.DOC_SERIES,3)='ADC')";

/** A group's term in a sorting string: the schedule sorts by its code first. */
const sortingTerm = (group: string) => (group.toUpperCase() === "BS.BS_DESC" ? `BS.BS_CODE || ' ' || ${group}` : group);

async function ledger(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const fromText = desktopDate(call.from);
  const subLedger = call.addon[0].includes(SUBLED);
  const licence = call.licence;
  const entryPara = toText(session.setup.entry_para).toUpperCase();

  // bitHideBook: licences 19, 29, 68 and 73 hide entries booked against an account whose short name says CA_ENT.
  let hideBook = true;
  if ([19, 29, 68, 73].includes(licence)) {
    const found = await runReportSql(loader, `SELECT COUNT(*) AS n FROM ${db}account WHERE a_pos <> 'D' AND POSITION('CA_ENT' IN a_short) > 0`);
    hideBook = num(found.rows[0]?.n) > 0;
  }
  const hideBookFilter = (column: string) => (!hideBook && [19, 29, 68, 73].includes(licence) ? ` AND ${column} in (select code from ${db}ACCOUNT where a_pos='A')` : "");

  let csFrom: string;
  let openingFrom: string;
  if (subLedger) {
    const join = `left join ${db}addon_aentry aentry on led.LED_KEY=aentry.aona_ledid and ledpost.POST_BOOKCD<>ledpost.POST_CODE`;
    csFrom = withEntryAddon(call.from_, join);
    openingFrom = withEntryAddon(call.openingFrom, join);
    if (fromText !== desktopDate(call.tarikh1)) throw new ReportRefusal("Between Date Not Allowed For Sub Ledger", "INTERNAL PROGRAM FAILURE");
  } else {
    csFrom = withEntryAddon(call.from_, `left join ${db}addon_aentry aentry on led.led_key=aentry.aona_ledid`);
    openingFrom = withEntryAddon(call.openingFrom, `left join ${db}addon_aentry aentry on ac.code=aentry.aona_accode`);
  }
  const partyKey = call.addon.map((addon) => addon.replace(" adata.txt_", " adata.key_"));

  const useUnion = call.showNarration ? call.useUnion : false;
  const reference = licence === 14 ? `,(select txt_REFERENCE from ${db}ADDON_AENTRY aent1 where aent1.aona_ledid=led.led_key limit 1) as "REFERENCE"` : "";
  const narrationColumn = useUnion ? "NARRATION1" : "NARRATION";
  const selectEnd = call.queryEnd.trim() !== "" ? `,${call.queryEnd}` : "";
  const where = call.where;
  const lineFilters = (licence === 29 || licence === 30 || licence === 73 ? SERIES_FILTER : "") + hideBookFilter("LED.BOOK_CODE");
  const orderBy = ` ORDER BY "SORTING_COL", ledpost.post_code, "SORTING_DATE", ledpost.post_dbcode, led.doc_no`;

  // The ledger lines (TEMP_TABLE_LEDGER1): the result table takes its columns from them.
  const lineSql = frag(`SELECT ${call.queryStart}${reference},LED.NARRATION AS "${narrationColumn}"${selectEnd} ${csFrom} ${where}${lineFilters}`
    + (!useUnion && (check("CHK_WLED") || check("CHK_WALED")) ? " AND AC.BOOK=2" : "")
    + (check("CHK_OPENING") ? " AND LED.BOOK <> 4" : "")
    + orderBy);
  const lines = await runReportSql(loader, lineSql);
  const table = tableFromFields(lines.fields);
  const numberColumn = new Set(lines.fields.filter((field) => table.kind(field.name) !== "text").map((field) => field.name.toLowerCase()));
  for (const column of ["NAME", "SMART_NAME", "ROW_DATA_TYPE", "SORTING_COL", "CLOSING_BAL", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_SELECTED_BOOK", "SMART_SELECTED_SCHDULE", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "DR_CR", "DEBIT", "CREDIT", "AC_CODE", "AC_BOOK", "SELECTED_NAME", "SELECTED_DATE", "SORTING_DATE", "BOOK"]) table.addColumn(column);
  // RESULT_TABLE's ALTER COLUMNs: the amounts are money, the closing numeric(18,2).
  for (const column of ["DEBIT", "CREDIT", "CLOSING_BAL"]) table.setKind(column, "decimal");

  // Heading rows of the ticked groups other than the account (book, schedule, addon), one level at a time.
  const groups = groupList(replaceCI(call.unionGroups, "AC.NAME,", ""));
  const smartColumns: string[] = [];
  let addonNumber = 0;
  const sortingTerms: string[] = [];
  for (const group of groups) {
    const smart = groupSmartColumn(group, addonNumber);
    if (smart !== "") smartColumns.push(smart);
    const fix = groupHeadingColumns(group, addonNumber + (removeAliasUpper(group).includes("TXT_") ? 1 : 0));
    if (!fix) throw groupFailed();
    if (fix.addon) addonNumber += 1;
    sortingTerms.push(sortingTerm(group));
    const sortingSql = sortingTerms.join(" || ' ' || ");
    const smartValues = groups.slice(0, sortingTerms.length).map((part, index) => `${part} AS "s${index}"`).join(", ");
    const schedule = group.toUpperCase() === "BS.BS_DESC";
    const headingSql = frag(`SELECT DISTINCT ${fix.values[0]} AS "k", ${smartValues}, ${group} AS "n", ${sortingSql} AS "o"${schedule ? ", BS.BS_CODE AS \"b\"" : ""} ${csFrom} ${where} ORDER BY ${schedule ? "BS.BS_CODE" : group}`);
    for (const heading of (await runReportSql(loader, headingSql)).rows) {
      const values: Record<string, unknown> = { [fix.columns[0]]: heading.k, ROW_DATA_TYPE: fix.rowType, NAME: heading.n, SORTING_COL: heading.o };
      smartColumns.forEach((column, index) => { values[column] = heading[`s${index}`]; });
      if (schedule) values.SYSTEM_BLANK1 = heading.b;
      for (const column of Object.keys(values)) table.addColumn(column);
      table.insert(values);
    }
  }

  // Opening balances (TABLE_NAME_OPENING, TEMP_OPENINGS), unless the ledger is an entry addon's or the operator asked for none.
  if ((call.acAddonRepdefa !== "E" || subLedger) && !check("CHK_OPENING")) {
    const accountSorting = `${[...sortingTerms, subLedger ? "AC.SUB_NAME" : "AC.NAME"].join(" || ' ' || ")}`;
    const sorting = sortingTerms.length > 0 ? accountSorting : `' ' || ${subLedger ? "AC.SUB_NAME" : "AC.NAME"}`;
    const groupSelect = groups.map((part, index) => `${part} AS "g${index}"`).join(", ");
    let openingSql: string;
    if (!subLedger) {
      const fixedFrom = openingFrom.split("SYS.FIXDB").join(`${db}AC_BALANCE ACBAL LEFT JOIN ${db}ACCOUNT AC ON ACBAL.CODE = AC.Code`);
      const lic2973 = licence === 29 || licence === 73;
      const openingValue = lic2973 ? `case when acbal.opening::numeric = 0 then acbal.opening::numeric else (acbal.opening::numeric - coalesce(nullif(add1.local_code,'')::numeric,0)) end` : "ACBAL.OPENING::numeric";
      const fromPart = call.selectKey[0] === ""
        ? (lic2973 ? `${db}AC_BALANCE ACBAL LEFT JOIN ${db}ACCOUNT AC ON ACBAL.CODE = AC.Code LEFT JOIN ${db}ADDRESS ADD1 ON ACBAL.CODE = ADD1.Code and add1.address_id=1` : fixedFrom)
        : `${db}AC_BALANCE ACBAL LEFT JOIN ${db}ACCOUNT AC ON ACBAL.CODE = AC.Code left join ${db}ADDON_DATA adata on adata.code=ac.code${lic2973 ? ` LEFT JOIN ${db}ADDRESS ADD1 ON ACBAL.CODE = ADD1.Code and add1.address_id=1` : ""}`;
      openingSql = `SELECT ${sorting} AS "SORTINGCOL"${groupSelect !== "" ? `, ${groupSelect}` : ""}, AC.NAME AS "GRPNAME", ${openingValue} AS "OPENING", AC.CODE AS "AC_CODE", AC.BOOK AS "AC_BOOK", AC.NAME AS "SELECTED_NAME" FROM ${fromPart}`
        + ` WHERE AC.BOOK <> 0 AND YEAR_ID = '${call.yearId}' AND A_RECFLAG = 'AC'`
        + (call.selectKey[4] !== "" ? ` AND AC.CODE IN ${call.selectKey[4]}` : "")
        + (call.selectScheduleKey !== "" ? ` and AC.BS_ID IN ${call.selectScheduleKey}` : "")
        + (call.selectBookKey !== "" ? ` and AC.BOOK IN ${call.selectBookKey}` : "");
      if (call.selectKey[0] !== "") {
        const depth = [0, 1, 2, 3].filter((index) => call.selectKey.slice(0, index + 1).every((key) => key !== "")).length;
        for (let index = 0; index < depth; index += 1) openingSql += ` and ${partyKey[index]} in ${call.selectKey[index]}`;
      }
      openingSql += ` ORDER BY "SORTINGCOL"`;
    } else {
      if (call.selectKey[0] === "") throw new ReportRefusal("Sub ledger needs its sub ledgers ticked", "INTERNAL PROGRAM FAILURE");
      openingSql = `SELECT ${replaceCI(sorting, "aentry.txt_SUBLED", "")} AS "SORTINGCOL", AC.SUB_NAME AS "GRPNAME", ACBAL.SUB_OPENING::numeric AS "OPENING", AC.SUB_CODE AS "AC_CODE", 0 AS "AC_BOOK", NULL AS "SELECTED_NAME" FROM ${db}SUB_BALANCE ACBAL LEFT JOIN ${db}ADDON_SUB AC ON ACBAL.SUB_CODE = AC.SUB_Code`
        + ` WHERE SUB_YEARID = '${call.yearId}' AND AC.SUB_CODE IN ${call.selectKey[0]} ORDER BY "SORTINGCOL"`;
    }
    const openings = (await runReportSql(loader, frag(openingSql))).rows;

    // Postings before the From date join the year's opening (only when the report does not start at the year's start).
    if (call.from.getTime() !== call.tarikh1.getTime() && !subLedger) {
      const seriesOnly = licence === 29 || licence === 30 || licence === 73;
      const seriesTest = (side: number) => (seriesOnly
        ? `LEDPOST.POST_DBCODE = ${side} and (left(led.DOC_SERIES,2)='RD' or left(led.DOC_SERIES,2)='MS' or left(led.DOC_SERIES,2)='AL' or left(led.DOC_SERIES,2)='AI' or left(led.DOC_SERIES,2)='RG'${side === 1 ? " or left(led.DOC_SERIES,2)='HC'" : ""} or left(led.DOC_SERIES,3)='ADC')`
        : `LEDPOST.POST_DBCODE = ${side}`);
      let earlier = `SELECT AC.Code AS "KEY_CODE", SUM(CASE WHEN ${seriesTest(1)} then LEDPOST.POST_AMT::numeric else 0.00 end) - SUM(CASE WHEN ${seriesTest(2)} then LEDPOST.POST_AMT::numeric else 0.00 end) AS "OPENING" ${csFrom}`;
      earlier += call.selectKey[4] !== "" ? ` WHERE AC.CODE IN ${call.selectKey[4]} and LEDPOST.post_date < '${fromText}'` : ` where LEDPOST.post_date < '${fromText}'`;
      if (call.selectScheduleKey !== "") earlier += ` and AC.BS_ID IN ${call.selectScheduleKey}`;
      if (call.selectBookKey !== "") earlier += ` and AC.BOOK IN ${call.selectBookKey}`;
      earlier += hideBookFilter("LED.BOOK_CODE");
      for (let index = 0; index < 4 && call.selectKey.slice(0, index + 1).every((key) => key !== ""); index += 1) earlier += ` and ${partyKey[index]} in ${call.selectKey[index]}`;
      earlier += " GROUP BY AC.CODE";
      const before = new Map<string, number>();
      for (const row of (await runReportSql(loader, frag(earlier))).rows) before.set(String(row.KEY_CODE), money((before.get(String(row.KEY_CODE)) ?? 0) + num(row.OPENING)));
      for (const opening of openings) {
        const add = before.get(String(opening.AC_CODE));
        if (add !== undefined) opening.OPENING = money(num(opening.OPENING) + add);
      }
    }

    const openingDate = dateStyle6(call.from);
    for (const opening of openings) {
      const amount = money(num(opening.OPENING));
      if (amount === 0) continue;
      const values: Record<string, unknown> = {
        SORTING_COL: opening.SORTINGCOL === null || opening.SORTINGCOL === undefined ? null : subLedger ? `${String(opening.SORTINGCOL).trim()}   ${opening.AC_CODE}   O` : `${opening.SORTINGCOL}${opening.AC_CODE}   O`,
        SELECTED_DATE: openingDate,
        NAME: " Opening Balance B/d ",
        AC_CODE: opening.AC_CODE,
        SMART_AC_CODE: opening.AC_CODE,
        SMART_NAME: opening.GRPNAME,
        ROW_DATA_TYPE: "OPENINGS",
        DEBIT: amount > 0 ? amount : 0,
        CREDIT: amount < 0 ? -amount : 0,
        DR_CR: amount < 0 ? "CR" : amount > 0 ? "DR" : "",
        CLOSING_BAL: amount,
      };
      if (!subLedger) { values.AC_BOOK = opening.AC_BOOK; values.SELECTED_NAME = opening.SELECTED_NAME; }
      else values.SMART_SELECTED_ADDON1 = opening.GRPNAME;
      if (!subLedger) smartColumns.forEach((column, index) => { values[column] = opening[`g${index}`]; });
      table.insert(values);
    }
  }

  // The ledger lines, and (Show Narration without "In Same Line") each one's narration as rows of 40 characters.
  const lineRows: ResultRow[] = lines.rows.map((row) => ({ ...row }));
  const narrationRows: ResultRow[] = [];
  if (useUnion) {
    const narration = await runReportSql(loader, frag(`SELECT ${call.fixCols}${call.unionQuery}${reference},LED.NARRATION AS "NARRATION1"${selectEnd} ${csFrom} ${where}${lineFilters}${check("CHK_OPENING") ? " AND LED.BOOK <> 4" : ""}${orderBy}`));
    const names = lines.fields.map((field) => field.name);
    const nameAt = names.findIndex((name) => name.toUpperCase() === "NAME");
    const sortName = table.name("SORTING_COL")!;
    for (const source of narration.rows) {
      const cells = narration.fields.map((field) => source[field.name]);
      // NARRATION_1 is '\' + the narration; a voucher without one gives '\' (or NULL) and no rows.
      if (cells[nameAt] === null || cells[nameAt] === undefined) continue;
      const full = String(cells[nameAt]);
      if (full.trim() === "\\") continue;
      const base: ResultRow = {};
      names.forEach((name, index) => { base[name] = cells[index] === "" && numberColumn.has(name.toLowerCase()) ? 0 : cells[index]; });
      base[table.name("ROW_DATA_TYPE")!] = "NARRATION";
      narrationPieces(full, { count: 20, firstMarked: false, lastUnbounded: false }).forEach((piece, chunk) => {
        const row: ResultRow = { ...base };
        row[sortName] = base[sortName] === null ? null : `${base[sortName]}N${String(chunk + 1).padStart(2, "0")}`;
        row[names[nameAt]] = piece;
        narrationRows.push(row);
      });
    }
  }

  // A journal's line (NAME 'JOURNAL') becomes its contra lines, unless the company posts multi-JVs (MULTIJV).
  if (!entryPara.includes("MULTIJV,")) {
    const journals = lineRows.filter((row) => toText(table.get(row, "NAME")) === "JOURNAL");
    if (journals.length > 0) {
      const docNos = [...new Set(journals.map((row) => toText(table.get(row, "full_docno"))))];
      const contraSql = frag(`SELECT led.led_key, led.full_docno, led.doc_date, led.amount::numeric AS amount, led.ac_dbcode, led.book, ac.name, ac.a_short FROM ${db}LEDGER led LEFT JOIN ${db}account ac ON ac.Code = led.CODE`
        + ` WHERE led.full_docno = ANY($1) AND led.doc_pos <> 'D' AND led.doc_posting <> 'L' AND ac.a_pos <> 'D'${hideBookFilter("LED.BOOK_CODE")}${check("CHK_OPENING") ? " AND LED.BOOK <> 4" : ""} ORDER BY led.led_key`);
      const contras = (await runReportSql(loader, contraSql, [docNos])).rows;
      const added: ResultRow[] = [];
      // The contra lines of each voucher, found by its number (not by comparing every journal line with every contra line).
      const contrasOf = new Map<string, typeof contras>();
      for (const contra of contras) { const key = toText(contra.full_docno); const list = contrasOf.get(key); if (list) list.push(contra); else contrasOf.set(key, [contra]); }
      for (const journal of journals) {
        const journalDate = parseRowDate(toText(table.get(journal, "selected_date")));
        for (const contra of contrasOf.get(toText(table.get(journal, "full_docno"))) ?? []) {
          if (String(contra.led_key) === String(table.get(journal, "SMART_LED_KEY"))) continue;
          if (journalDate === null || !(contra.doc_date instanceof Date) || contra.doc_date.toDateString() !== journalDate.toDateString()) continue;
          if (String(table.get(journal, "post_dbcode")) === String(contra.ac_dbcode)) continue;
          const debit = num(table.get(journal, "Debit"));
          const credit = num(table.get(journal, "Credit"));
          const amount = num(contra.amount);
          const row: ResultRow = { ...journal };
          table.set(row, "SMART_LED_KEY", contra.led_key);
          table.set(row, "led_key", contra.led_key);
          table.set(row, "led_id", contra.led_key);
          table.set(row, "NAME", contra.name);
          table.set(row, "a_short", contra.a_short);
          table.set(row, "Debit", debit > 0 ? (debit > amount ? amount : debit) : 0);
          table.set(row, "Credit", credit > 0 ? (credit > amount ? amount : credit) : 0);
          added.push(row);
        }
      }
      const kept = lineRows.filter((row) => toText(table.get(row, "NAME")) !== "JOURNAL");
      lineRows.length = 0;
      pushAll(lineRows, kept, added);
    }
  }

  // CHK_WLED / CHK_WALED (WhatsApp ledgers) keep debtors (book 2) only.
  if (!useUnion && (check("CHK_WLED") || check("CHK_WALED"))) {
    if (check("CHK_WLED")) {
      const codes = new Set(lineRows.map((row) => toText(table.get(row, "SMART_AC_CODE"))));
      table.rows = table.rows.filter((row) => codes.has(toText(table.get(row, "SMART_AC_CODE"))));
    }
    table.rows = table.rows.filter((row) => toText(table.get(row, "AC_BOOK")) === "2");
    pushAll(table.rows, lineRows.filter((row) => toText(table.get(row, "AC_BOOK")) === "2"));
  } else {
    pushAll(table.rows, lineRows, narrationRows);
  }

  // Sorting "Above Amount" / "Below Amount" (|run_txt_Aboveamt|): rows on the wrong side of the amount go, openings and narration too.
  if (call.text[0] !== "" && (call.sortingText === "Above Amount" || call.sortingText === "Below Amount")) {
    const limit = num(call.text[0]);
    table.rows = table.rows.filter((row) => {
      const debit = table.get(row, "Debit");
      const credit = table.get(row, "Credit");
      // A NULL amount (a heading row) makes the DELETE's test unknown, so the row stays.
      if (debit === null || debit === undefined || credit === null || credit === undefined) return true;
      return call.sortingText === "Above Amount" ? !(num(debit) < limit && num(credit) < limit) : !(num(debit) > limit && num(credit) > limit);
    });
  }

  // Closing and account heading rows for every account the table holds.
  const accountCodes = [...new Set(table.rows.map((row) => table.get(row, "AC_CODE")).filter((code) => code !== null && code !== undefined && code !== "").map((code) => Number(code)).filter((code) => Number.isInteger(code)))];
  if (call.acAddonRepdefa !== "E") {
    const accounts = accountCodes.length === 0 ? [] : (await runReportSql(loader, `SELECT code, name, book, a_short FROM ${db}account WHERE code = ANY($1::int[])`, [accountCodes])).rows;
    for (const account of accounts) {
      table.insert({ SORTING_COL: account.name === null ? null : ` ${account.name}${account.code}z`, SORTING_DATE: dateStyle112(call.upto), SELECTED_DATE: dateStyle6(call.upto), NAME: "Closing Balance B/d", AC_CODE: account.code, SMART_NAME: account.name, BOOK: account.book, AC_BOOK: account.book, SELECTED_NAME: account.name, ROW_DATA_TYPE: "CLOSING", SMART_AC_CODE: account.code });
    }
    for (const account of accounts) {
      table.insert({ SMART_AC_CODE: String(account.code), SORTING_COL: account.name === null ? null : ` ${account.name}${account.code}   H`, NAME: account.name, AC_CODE: account.code, SMART_NAME: account.name, BOOK: account.book, AC_BOOK: account.book, SELECTED_NAME: account.name, ROW_DATA_TYPE: "AC" });
    }
  } else {
    const subCodes = [...new Set(table.rows.map((row) => table.get(row, "addon_1_code")).filter((code) => code !== null && code !== undefined && code !== "").map((code) => Number(code)).filter((code) => Number.isInteger(code)))];
    const subs = subCodes.length === 0 ? [] : (await runReportSql(loader, `SELECT sub_code, sub_name FROM ${db}addon_sub WHERE sub_code = ANY($1::int[])`, [subCodes])).rows;
    for (const sub of subs) {
      table.insert({ SORTING_COL: sub.sub_name === null ? null : `${sub.sub_name}z`, SORTING_DATE: dateStyle112(call.upto), SELECTED_DATE: dateStyle6(call.upto), NAME: "Closing Balance B/d", ADDON_1_CODE: sub.sub_code, SMART_SELECTED_ADDON1: sub.sub_name, BOOK: 0, ROW_DATA_TYPE: "CLOSING", doc_no: "z" });
    }
  }

  if (call.jvDetailsRequired) throw new ReportRefusal("Show JV Details is not available in the web version yet.", "Not ported yet");
  if (call.acAddonRepdefa !== "E") {
    const headingRows = (type: string) => table.rows.filter((row) => table.get(row, "ROW_DATA_TYPE") === type);
    const tail = (type: string) => (type === "AC" ? "   H" : "z");
    const concat = (...parts: unknown[]) => (parts.some((part) => part === null || part === undefined) ? null : parts.map((part) => String(part)).join(""));
    const accountOf = async (sql: string) => new Map((await runReportSql(loader, sql, [accountCodes])).rows.map((row) => [String(row.code), row]));
    if (call.selectBookKey !== "" && accountCodes.length > 0) {
      const books = await accountOf(`SELECT ac.code, bookmast.book_desc FROM ${db}account ac LEFT JOIN ${db}book_properties bookmast ON bookmast.book_key = ac.book WHERE ac.code = ANY($1::int[]) AND bookmast.book_key IN ${call.selectBookKey}`);
      for (const type of ["AC", "CLOSING"]) {
        for (const row of headingRows(type)) {
          const book = books.get(String(table.get(row, "AC_CODE")));
          if (book) table.set(row, "SMART_SELECTED_BOOK", book.book_desc);
        }
        for (const row of headingRows(type)) table.set(row, "SORTING_COL", concat(table.get(row, "SMART_SELECTED_BOOK"), " ", table.get(row, "SMART_NAME"), table.get(row, "AC_CODE"), tail(type)));
      }
    }
    if (call.selectScheduleKey !== "" && accountCodes.length > 0) {
      const schedules = await accountOf(`SELECT ac.code, bs.bs_desc, bs.bs_code FROM ${db}account ac LEFT JOIN ${db}balsheet bs ON bs.bs_key = ac.bs_id WHERE ac.code = ANY($1::int[]) AND bs.bs_key IN ${call.selectScheduleKey}`);
      for (const type of ["AC", "CLOSING"]) {
        for (const row of headingRows(type)) {
          const schedule = schedules.get(String(table.get(row, "AC_CODE")));
          if (schedule) { table.set(row, "SMART_SELECTED_SCHDULE", schedule.bs_desc); table.set(row, "SYSTEM_BLANK1", schedule.bs_code); }
        }
        for (const row of headingRows(type)) table.set(row, "SORTING_COL", concat(table.get(row, "SYSTEM_BLANK1"), " ", table.get(row, "SMART_SELECTED_SCHDULE"), " ", table.get(row, "SMART_NAME"), table.get(row, "AC_CODE"), tail(type)));
      }
    }
    for (let index = 0; index < 4; index += 1) {
      if (call.selectKey[index] === "" || accountCodes.length === 0) continue;
      const paraId = (await runReportSql(loader, `SELECT para_id FROM ${db}ADDON_SUB WHERE sub_code IN ${call.selectKey[index]} LIMIT 1`)).rows[0]?.para_id;
      const fieldName = toText((await runReportSql(loader, `SELECT fiel_save FROM ${db}ADDON_FLD WHERE fiel_key = $1`, [paraId ?? 0])).rows[0]?.fiel_save);
      if (!/^[A-Za-z0-9_]+$/.test(fieldName)) continue;
      const data = await accountOf(`SELECT code, txt_${fieldName} AS value, to_jsonb(ad) ->> 'key_${fieldName.toLowerCase()}' AS key FROM ${db}addon_data ad WHERE code = ANY($1::int[])`);
      for (const type of ["AC", "CLOSING"]) {
        for (const row of headingRows(type)) {
          const value = data.get(String(table.get(row, "AC_CODE")));
          if (value) table.set(row, `SMART_SELECTED_ADDON${index + 1}`, value.value);
        }
        for (const row of headingRows(type)) {
          const parts: unknown[] = [];
          for (let level = 0; level <= index; level += 1) parts.push(table.get(row, `SMART_SELECTED_ADDON${level + 1}`), " ");
          table.set(row, "SORTING_COL", concat(...parts, table.get(row, "SMART_NAME"), table.get(row, "AC_CODE"), tail(type)));
        }
      }
      // The heading rows came from the vouchers, so an account shown only for its opening balance (nothing
      // posted in the period) had no heading for its addon value (Dehradun, Firozabad). Give each one a heading.
      const levelValue = (row: ResultRow, level: number) => table.get(row, `SMART_SELECTED_ADDON${level + 1}`);
      const levelKey = (row: ResultRow) => Array.from({ length: index + 1 }, (_, level) => String(levelValue(row, level) ?? "")).join("\u0001");
      const headed = new Set(headingRows(`ADDON_${index + 1}`).map(levelKey));
      for (const row of headingRows("AC")) {
        if (levelValue(row, index) === null || levelValue(row, index) === undefined || headed.has(levelKey(row))) continue;
        headed.add(levelKey(row));
        const added: Record<string, unknown> = { ROW_DATA_TYPE: `ADDON_${index + 1}`, NAME: levelValue(row, index), [`ADDON_${index + 1}_CODE`]: data.get(String(table.get(row, "AC_CODE")))?.key ?? null };
        const parts: unknown[] = [];
        for (let level = 0; level <= index; level += 1) { added[`SMART_SELECTED_ADDON${level + 1}`] = levelValue(row, level); parts.push(levelValue(row, level)); }
        added.SORTING_COL = parts.some((part) => part === null || part === undefined) ? null : parts.map((part) => String(part)).join(" ");
        table.addColumn(`ADDON_${index + 1}_CODE`);
        table.insert(added);
      }
    }
    // An account left with only its heading and closing rows (nothing to show) goes.
    const counts = new Map<string, number>();
    for (const row of table.rows) {
      const code = num(table.get(row, "AC_CODE"));
      if (code > 0) counts.set(String(code), (counts.get(String(code)) ?? 0) + 1);
    }
    const empty = new Set([...counts].filter(([, count]) => count === 2).map(([code]) => code));
    if (empty.size > 0) table.rows = table.rows.filter((row) => !empty.has(String(num(table.get(row, "AC_CODE")))) || num(table.get(row, "AC_CODE")) <= 0);
  }
  if (check("CHK_PROD_DTL_REQ") && call.acAddonRepdefa !== "E") await ledgerProducts(loader, plan, table, hideBookFilter);
  if ([3, 5, 7, 8, 18].includes(licence)) {
    const shorts = new Map((accountCodes.length === 0 ? [] : (await runReportSql(loader, `SELECT code, name, a_short FROM ${db}account WHERE code = ANY($1::int[])`, [accountCodes])).rows).map((row) => [String(row.code), row]));
    for (const row of table.rows.filter((candidate) => table.get(candidate, "ROW_DATA_TYPE") === "AC")) {
      const account = shorts.get(String(table.get(row, "AC_CODE")));
      if (account) table.set(row, "NAME", account.a_short === null ? null : `${account.name} - ${account.a_short}`);
    }
  }
  if (call.acAddonRepdefa === "E") for (const row of table.rows.filter((candidate) => table.get(candidate, "ROW_DATA_TYPE") === "LED")) table.set(row, "NAME", table.get(row, "SMART_NAME"));
  if (check("CHK_ACC_CNFRM") || check("CHK_TFPRINT")) throw new ReportRefusal("Account Confirmation and T - Format Print are not available in the web version yet.\nUntick them to see the ledger.", "Not ported yet");

  // ORDER BY SORTING_COL, SORTING_DATE (stable, as rows were added).
  const sortCol = table.name("SORTING_COL")!;
  const sortDate = table.name("SORTING_DATE")!;
  sortRows(table, [(row) => textKey(row[sortCol]), (row) => textKey(row[sortDate])]);
  return table;
}

/** CHK_PROD_DTL_REQ: each voucher's products under it (TEMP_TABLE_PRODRECORD). */
async function ledgerProducts(loader: Loader, plan: ReportPlan, table: ResultTable, hideBookFilter: (column: string) => string) {
  const { call } = plan;
  const db = call.database;
  const licence = call.licence;
  if (call.selectKey[4] === "") throw new ReportRefusal("Product Detail Require needs the accounts ticked (Account group)", "INTERNAL PROGRAM FAILURE");
  if (licence !== 32) for (const column of ["QUANTITY", "RATE", "VALUE"]) table.setKind(column, "decimal");
  const keys = call.selectKey[4];
  const addon = call.selectKey[0] !== "" ? call.addon[0].trim() : "";
  const dbcode = licence === 2 || licence === 32 || addon !== ""
    ? "CAST(led.ac_dbcode AS varchar(20))"
    : "CAST((case when led.book IN (10, 15) AND ac.bs_id <> 30 AND led.post_bkcode = AC.Code then led.bk_dbcode else led.ac_dbcode end) AS varchar(20))";
  const marker = licence === 2 || addon !== "" && licence !== 32 ? "'3' || " : "";
  const suffix = addon !== "" ? "'PRODUCT'" : licence === 2 ? "'LED'" : "'LEDP'";
  const lead = addon !== "" ? `${addon} || ' ' || ac.name` : "' ' || ac.name";
  const sorting = `${lead} || CAST(ac.code AS varchar(10)) || '   P' || to_char(led.doc_date, 'YYYYMMDD') || ${dbcode} || ${marker}led.doc_no || CAST(led.led_key AS varchar(20)) || ${suffix}`;
  const name = licence === 2 ? "product.prod_short"
    : licence === 32 ? "product.prod_desc || '.... ' || CAST(round(pled.quantity::numeric, 2) AS varchar(20)) || ' @ ' || CAST(round(pled.rate::numeric, 2) AS varchar(20)) || '=' || CAST(pled.il_value::numeric AS varchar(20))"
    : "product.prod_desc || ' ' || case when coalesce(PLED.IL_PRODCD,'')<>'' then coalesce(PLED.IL_PRODCD,'') else ' ' end";
  let sql = `SELECT ${sorting} AS sorting_col, ${name} AS name, to_char(led.doc_date, 'YYYYMMDD') AS sorting_date, ac.name AS smart_name, ${addon !== "" ? `${addon} AS addon,` : ""} pled.quantity, pled.rate, pled.il_value::numeric AS il_value`
    + ` FROM ${db}LEDGER LED LEFT JOIN ${db}ACCOUNT AC ON (ac.bs_id = 30 AND LED.CODE = AC.Code) OR (ac.bs_id <> 30 AND ((led.book IN (10, 15) AND led.post_bkcode = AC.Code) OR (led.book NOT IN (10, 15) AND LED.CODE = AC.Code)))`
    + ` left join ${db}PROD_LEDGER PLED on pled.led_id=led.led_key LEFT JOIN ${db}PRODUCT_MASTER PRODUCT ON PRODUCT.PROD_KEY = PLED.PROD_ID`
    + (addon !== "" ? ` LEFT JOIN ${db}ADDON_DATA adata ON adata.code = PLED.code` : "")
    + ` where pled.il_pos='A' and led.doc_pos='A' and ((ac.bs_id = 30 AND led.code in ${keys}) or (ac.bs_id <> 30 AND ((led.book IN (10, 15) AND led.post_bkcode in ${keys}) OR (led.book NOT IN (10, 15) AND LED.CODE in ${keys}))))`
    + hideBookFilter("PLED.BOOK_CODE")
    + " and coalesce(pled.process_id,0)=0"
    + (licence === 29 || licence === 30 || licence === 73 ? SERIES_FILTER : "")
    + ` and led.DOC_DATE >= '${desktopDate(call.from)}' and LED.DOC_DATE <= '${desktopDate(call.upto)}'`;
  if (addon !== "") sql += ` and ${addon.replace("txt", "key")} in ${call.selectKey[0]}`;
  for (const row of (await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema))).rows) {
    const values: Record<string, unknown> = { SORTING_COL: row.sorting_col, FULL_DOCNO: "   **  ", NAME: row.name, DEBIT: 0, CREDIT: 0, CLOSING_BAL: 0, SORTING_DATE: row.sorting_date, SMART_NAME: row.smart_name, ROW_DATA_TYPE: "PRODUCT" };
    if (addon !== "") values.SMART_SELECTED_ADDON1 = row.addon;
    if (licence !== 32) { values.QUANTITY = row.quantity; values.RATE = row.rate; values.VALUE = row.il_value; }
    table.insert(values);
  }
}

// ======================================================================================
// 6: TRIAL BALANCE (lines 7004-8503, "ACTIONS FOR TRIAL BALANCE")
// ======================================================================================
//
// The accounts of the first combo's books (General Ledger, Debtors or Creditors) with their
// opening, what was debited and credited between From and Upto, and the closing. TEMP_TABLE_
// TRIALBALANCE1 holds each account's postings of the period, 2 (accounts alone) or 3 (with the
// ticked groups as headings) the result, 4 and 5 the Sundry Debtors / Creditors control lines of
// the General Ledger. Every statement the procedure runs on them is done on the result table here.
//
// Not ported: licence 14's Reference trial balance (Debtors with the Reference addon, which also
// carries Collection / Sales Man and the opening transfer to the next year).

/** The procedure's ORDER BY tail: the ticked groups' order, then the account's name. */
function trialOrder(orderBy: string): string {
  const base = orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").trim();
  if (base === "") return "AC.NAME";
  if (!/AC\.NAME/i.test(base)) return `${base},AC.NAME`;
  const rest = `${base},`.replace(/AC\.NAME,/gi, "");
  const kept = rest.endsWith(",") ? rest.slice(0, -1) : rest;
  return `${kept !== "" ? `${kept},` : ""}AC.NAME`;
}

/** The report system's own columns the result table carries (the procedure's ALTER COLUMNs name them). */
const TRIAL_COLUMNS = ["SMART_LED_KEY", "SMART_NAME", "NAME", "ROW_DATA_TYPE", "SORTING_COL", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_BOOK_CODE", "SMART_SCHEDULE_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE", "SYSTEM_BLANK2", "SMART_SELECTED_BOOK", "SMART_SELECTED_SCHDULE", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "OPENING_BAL", "DR_CR1", "DEBIT", "CREDIT", "CLOSING_BAL", "DR_CR", "AC_CODE"];

async function trialBalance(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const rowsOf = async (sql: string) => (await runReportSql(loader, frag(sql))).rows;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const first = call.fcValue;
  const licence = call.licence;
  const scheduleKey = call.selectScheduleKey;
  const bookKey = call.selectBookKey;
  const addonKeys = call.selectKey.slice(0, 4);
  const accountKey = call.selectKey[4];
  const filterFormat = call.filterId.toUpperCase();
  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);
  const yearStart = desktopDate(call.tarikh1);
  const dayBeforeFrom = desktopDate(dayBefore(call.from));
  const between = call.from.getTime() !== call.tarikh1.getTime();
  if (licence === 14 && first === 2 && call.addon[0].toUpperCase().includes("REFERENCE")) throw new ReportRefusal("The Reference trial balance (licence 14) is not available in the web version yet.", "Not ported yet");

  const noKeys = bookKey === "" && scheduleKey === "" && addonKeys.every((key) => key === "");
  if (call.groupsAsHeadings && first !== 1 && (bookKey !== "" || scheduleKey !== "")) throw new ReportRefusal("Selection Not Done Pl. Select General Ledger From Book", "Selection Not Done");
  const headings = call.groupsAsHeadings && !noKeys;

  // bitHideBook: licences 19, 29, 68 and 73 hide entries booked against an account whose short name says CA_ENT.
  let hideBook = true;
  if ([19, 29, 68, 73].includes(licence)) {
    const found = await runReportSql(loader, `SELECT COUNT(*) AS n FROM ${db}account WHERE a_pos <> 'D' AND POSITION('CA_ENT' IN a_short) > 0`);
    hideBook = num(found.rows[0]?.n) > 0;
  }
  const hide = !hideBook && [19, 29, 68, 73].includes(licence) ? ` AND LEDPOST.POST_BOOKCD in (select code from ${db}ACCOUNT where a_pos='A')` : "";
  const bookCondition = first === 1 ? "NOT IN (2,3)" : first === 2 ? "= 2" : "= 3";
  const posted = (from: string, upto: string) => `ledpost.post_date BETWEEN '${from}' AND '${upto}' and ledpost.post_bookcd in (select code from ${db}account where a_pos<>'D')${hide}`;
  const yearOf = `acbal.YEAR_ID = '${call.yearId}' AND acbal.A_RECFLAG = 'AC'`;
  const scheduleOf = scheduleKey !== "" ? ` and ac.bs_id in ${scheduleKey}` : "";
  const bookOf = bookKey !== "" ? ` and ac.book in ${bookKey}` : "";
  const accountOf = accountKey !== "" ? ` and ac.code in ${accountKey}` : "";
  const debitSum = "SUM(CASE WHEN ledpost.POST_DBCODE = 1 THEN ledpost.POST_AMT::numeric ELSE 0.00 END)";
  const creditSum = "SUM(CASE WHEN ledpost.POST_DBCODE = 2 THEN ledpost.POST_AMT::numeric ELSE 0.00 END)";

  // TEMP_TABLE_TRIALBALANCE1: the period's postings of each account.
  const t1Name = /TEMP_TABLE_TRIALBALANCE1_\w+/i.exec(call.queryStart)?.[0] ?? `TEMP_TABLE_TRIALBALANCE1_${call.userNo}`;
  const t1 = `${t1Name} AS (SELECT ${debitSum} AS "debit", ${creditSum} AS "credit", ledpost.post_code AS "post_code", to_char(MIN(ledpost.post_date),'YYYYMMDD') || ' TO ' || to_char(MAX(ledpost.post_date),'YYYYMMDD') AS "posting_date"`
    + ` FROM ${db}LEDGER_POST ledpost left join ${db}account ac on ac.code=ledpost.post_code WHERE ${posted(fromText, uptoText)}${scheduleOf}${bookOf}${accountOf} AND AC.BOOK ${bookCondition} GROUP BY ledpost.post_code)`;

  const csFrom = withEntryAddon(call.from_, `left join ${db}addon_aentry aentry on ac.code=aentry.aona_accode`).split("sys.aents").join("").split("sys.aente").join("");
  const where = call.where.split("|sys.yearid|").join(call.yearId);
  const selectEnd = call.queryEnd.trim() !== "" ? `,${call.queryEnd}` : "";
  const order = trialOrder(call.orderBy);
  const trialWhere = `${where} AND (AC.Code IN (SELECT POST_CODE FROM ${t1Name}) OR ACBAL.OPENING <> 0 OR AC.BOOK = 0) AND AC.BOOK ${bookCondition}`;

  // REPLACE_OPENING: the year's opening, plus (Debtors / Creditors from a later date) what was posted before From.
  const startString = (headingPath: boolean) => {
    const opening = first === 1 || !between
      ? "ACBAL.OPENING::numeric"
      : `ACBAL.OPENING::numeric + COALESCE((SELECT SUM(CASE WHEN LEDPOST1.POST_DBCODE = 1 THEN LEDPOST1.POST_AMT::numeric ELSE 0.00 END) - SUM(CASE WHEN LEDPOST1.POST_DBCODE = 2 THEN LEDPOST1.POST_AMT::numeric${headingPath ? "*-1" : ""} ELSE 0.00 END) FROM ${db}LEDGER_POST LEDPOST1 WHERE LEDPOST1.POST_CODE = AC.Code AND LEDPOST1.POST_BOOKCD in (select code from ${db}ACCOUNT where a_pos='A') AND LEDPOST1.POST_DATE BETWEEN '${yearStart}' AND '${dayBeforeFrom}'),0)`;
    return call.queryStart.split("REPLACE_OPENING").join(opening);
  };
  const mainSql = (headingPath: boolean, structureOnly: boolean) => `WITH ${t1} SELECT ${startString(headingPath)}${selectEnd} ${csFrom} ${structureOnly ? "WHERE 1=0" : `${trialWhere} ORDER BY ${order}`}`;

  const prepare = (table: ResultTable) => {
    for (const column of TRIAL_COLUMNS) table.addColumn(column);
    for (const column of ["OPENING_BAL", "DEBIT", "CREDIT", "CLOSING_BAL"]) table.setKind(column, "decimal");
  };
  const get = (table: ResultTable, row: ResultRow, column: string) => table.get(row, column);
  const type = (table: ResultTable, row: ResultRow) => toText(get(table, row, "ROW_DATA_TYPE"));
  const drCr = (value: unknown) => (num(value) >= 0 ? "DR" : "CR");
  const codeOf = (value: unknown) => (value === null || value === undefined ? null : String(value));
  const existing = (table: ResultTable) => new Set(table.rows.map((row) => codeOf(get(table, row, "AC_CODE"))).filter((code): code is string => code !== null));
  const isNull = (table: ResultTable, row: ResultRow, column: string) => get(table, row, column) === null || get(table, row, column) === undefined;
  /** coalesce(OPENING_BAL,0)+coalesce(DEBIT,0)-coalesce(CREDIT,0) = 0 on a row whose opening is not null (a NULL sum is not equal to 0). */
  const nothingLeft = (table: ResultTable, row: ResultRow) => !isNull(table, row, "OPENING_BAL") && num(get(table, row, "OPENING_BAL")) + num(get(table, row, "DEBIT")) - num(get(table, row, "CREDIT")) === 0;

  const setDrCr1 = (table: ResultTable, onlyLed = false) => { for (const row of table.rows) if (!onlyLed || type(table, row) === "LED") table.set(row, "DR_CR1", drCr(get(table, row, "OPENING_BAL"))); };
  const closingBalance = (table: ResultTable) => { for (const row of table.rows) if (type(table, row) === "LED") table.set(row, "CLOSING_BAL", money(num(get(table, row, "OPENING_BAL")) + num(get(table, row, "DEBIT")) - num(get(table, row, "CREDIT")))); };
  /** The Opening filter: the opening goes to the debit or credit side by its DR / CR. */
  const openingToSides = (table: ResultTable) => {
    for (const row of table.rows) {
      table.set(row, "DEBIT", get(table, row, "DR_CR1") === "DR" ? get(table, row, "OPENING_BAL") : 0);
      table.set(row, "CREDIT", get(table, row, "DR_CR1") === "CR" ? get(table, row, "OPENING_BAL") : 0);
    }
  };
  /** "Opening Difference": what the openings add up to, when the report covers the whole year and has no group selected. */
  const openingDifference = (table: ResultTable) => {
    if (between || !noKeys) return;
    const total = Math.round(table.rows.reduce((sum, row) => sum + num(get(table, row, "OPENING_BAL")), 0) * 100) / 100;
    if (total === 0) return;
    table.insert({ NAME: "Opening Difference", OPENING_BAL: -total, ROW_DATA_TYPE: "LED", SORTING_COL: "zzz" });
    setDrCr1(table);
  };

  // The Sundry Debtors / Creditors control lines (TEMP_TABLE_TRIALBALANCE4 and 5), General Ledger only.
  type Control = { name: unknown; code: number; opening: number; debit: number | null; credit: number | null; bs_desc: unknown; book_desc: unknown; bs_code: unknown; bs_key: unknown; book_key: unknown };
  const controlLines = async (headingPath: boolean): Promise<Control[]> => {
    const t4 = await rowsOf(`SELECT ac.book AS "book", ${debitSum} AS "debit", ${creditSum} AS "credit", bs.bs_code AS "bs_code"`
      + ` FROM ${db}LEDGER_POST ledpost left join ${db}ACCOUNT ac on ledpost.POST_CODE=ac.Code left join ${db}AC_BALANCE acbal on acbal.CODE=ledpost.POST_CODE left join ${db}BALSHEET bs on bs.bs_key=ac.bs_id left join ${db}BOOK_PROPERTIES bk on bk.book_key=ac.book`
      + ` WHERE ${posted(fromText, uptoText)}${scheduleOf} and ac.BOOK in (2,3) AND ${yearOf} GROUP BY ac.book, bs.bs_desc, bk.book_desc, bs.bs_code, bk.book_key, bs.bs_key ORDER BY ac.book, bs.bs_desc, bk.book_desc, bs.bs_code, bk.book_key, bs.bs_key`);
    const t5: Control[] = (await rowsOf(`SELECT ac.name AS "name", ac.code + 1 AS "code", acbal.opening::numeric AS "opening", bs.bs_desc AS "bs_desc", bk.book_desc AS "book_desc", bs.bs_code AS "bs_code", bs.bs_key AS "bs_key", bk.book_key AS "book_key"`
      + ` FROM ${db}ACCOUNT ac left join ${db}AC_BALANCE acbal on acbal.CODE=ac.CODE left join ${db}BALSHEET bs on bs.bs_key=ac.bs_id left join ${db}BOOK_PROPERTIES bk on bk.book_key=ac.book`
      + ` where ac.Code in (1,2)${scheduleOf} AND ${yearOf}`)).map((row) => ({ name: row.name, code: num(row.code), opening: num(row.opening), debit: 0, credit: 0, bs_desc: row.bs_desc, book_desc: row.book_desc, bs_code: row.bs_code, bs_key: row.bs_key, book_key: row.book_key }));
    if (between) {
      // The cursors group the earlier postings by book; the schedule filter of the procedure never reaches them.
      for (const code of [2, 3]) {
        const earlier = await rowsOf(`SELECT ac.book AS "book", ${debitSum} AS "debit", ${creditSum} AS "credit" FROM ${db}LEDGER_POST ledpost left join ${db}ACCOUNT ac on ledpost.POST_CODE=ac.Code left join ${db}AC_BALANCE acbal on acbal.CODE=ledpost.POST_CODE`
          + ` WHERE ${posted(yearStart, dayBeforeFrom)} and ac.BOOK in (${code}) AND ${yearOf} GROUP BY ac.book ORDER BY ac.book`);
        for (const sum of earlier) for (const line of t5) if (line.code === code) line.opening = money(line.opening + num(sum.debit) - (code === 2 ? Math.abs(num(sum.credit)) : num(sum.credit)));
      }
    }
    for (const line of t5) {
      const match = headingPath ? t4.find((sum) => sum.bs_code !== null && sum.bs_code === line.bs_code) : t4.find((sum) => Number(sum.book) === line.code);
      line.debit = match ? num(match.debit) : null;
      line.credit = match ? num(match.credit) : null;
    }
    return t5;
  };

  /** Accounts nothing was posted to that have no row yet: their year's opening alone (book > 0, not Debtors or Creditors). */
  const openingOnlyRows = (columns: string, extraWhere: string) => rowsOf(`SELECT ac.name AS "name", ac.code AS "code", acbal.opening::numeric AS "opening"${columns} FROM ${db}ACCOUNT ac left join ${db}AC_BALANCE acbal on acbal.code=ac.code left join ${db}BALSHEET bs on bs.bs_key=ac.bs_id left join ${db}BOOK_PROPERTIES bk on bk.book_key=ac.book`
    + ` where ac.a_pos<>'D' and ac.book not in (2,3) and ac.book > 0 and ${yearOf}${scheduleOf}${extraWhere}`);

  /** Debtors / Creditors from a later date: accounts that only have postings before From (the year's opening plus those postings). */
  const addEarlierOnly = async (table: ResultTable, carryClosing: boolean): Promise<void> => {
    const found = existing(table);
    const rows = await rowsOf(`SELECT ac.name AS "name", ac.code AS "code", acbal.opening::numeric + COALESCE(${debitSum} - ${creditSum},0) AS "opening"`
      + ` FROM ${db}LEDGER_POST ledpost left join ${db}ACCOUNT ac on ledpost.POST_CODE=ac.Code left join ${db}AC_BALANCE acbal on acbal.CODE=ledpost.POST_CODE`
      + ` WHERE ${posted(yearStart, dayBeforeFrom)} AND AC.BOOK ${bookCondition}${scheduleOf}${bookOf}${accountOf} AND ${yearOf} group by ac.name, ac.code, acbal.opening`);
    for (const row of rows) {
      if (found.has(codeOf(row.code)!)) continue;
      const values: Record<string, unknown> = { SORTING_COL: `${toText(row.name)}  P`, SMART_AC_CODE: row.code, ROW_DATA_TYPE: "LED", SMART_NAME: row.name, NAME: row.name, OPENING_BAL: num(row.opening), DR_CR1: drCr(row.opening), DR_CR: "", AC_CODE: row.code };
      if (carryClosing) values.CLOSING_BAL = num(row.opening);
      table.insert(values);
    }
  };

  /**
   * General Ledger from a later date: the postings before From (TEMP_TABLE_OPENTRIALBALANCE) give
   * accounts that have nothing else a row, and move every account's opening forward.
   */
  const generalOpening = async (table: ResultTable, headingPath: boolean): Promise<void> => {
    const bookAndSchedule = scheduleKey !== "" && bookKey !== "";
    const addonSelected = call.selectedAddon.filter((text) => text.trim() !== "");
    const extra = headingPath
      ? `${bookAndSchedule ? `, bs.bs_code AS "smart_schedule_code", bs.bs_desc AS "smart_selected_schdule", bk.book_key AS "smart_book_code", bk.book_desc AS "smart_selected_book"`
        : bookKey !== "" ? `, bk.book_key AS "smart_book_code", bk.book_desc AS "smart_selected_book"`
        : scheduleKey !== "" ? `, bs.bs_key AS "smart_schedule_code", bs.bs_desc AS "smart_selected_schdule", bs.bs_code AS "bs_code"`
        : addonSelected.map((text) => `, ${text}`).join("")}`
      : `${scheduleKey !== "" ? `, bs.bs_code AS "smart_schedule_code", bs.bs_desc AS "smart_selected_schdule"` : ""}${bookKey !== "" ? `, bk.book_key AS "smart_book_code", bk.book_desc AS "smart_selected_book"` : ""}`;
    // (The procedure also groups on the ticked groups' own expressions; bookmst is not joined here, so only the addons are.)
    const groupExtra = headingPath ? `, bs.bs_key, bs.bs_code, bs.bs_desc, bk.book_key, bk.book_desc${call.addon.filter((text) => text.trim() !== "").map((text) => `, ${text}`).join("")}` :`${scheduleKey !== "" ? ", bs.bs_code, bs.bs_desc" : ""}${bookKey !== "" ? ", bk.book_key, bk.book_desc" : ""}`;
    const partyOf = addonKeys.map((key, index) => (headingPath && key !== "" ? ` AND ${call.addon[index].replace(" adata.txt_", " adata.key_")} in ${key}` : "")).join("");
    const earlier = await rowsOf(`SELECT ac.name AS "name", acbal.opening::numeric AS "opening", ${debitSum} AS "debit", ${creditSum} AS "credit", ledpost.post_code AS "post_code"${extra}`
      + ` FROM ${db}LEDGER_POST ledpost left join ${db}ACCOUNT ac on ac.CODE=ledpost.post_CODE left join ${db}AC_BALANCE acbal on acbal.CODE=ledpost.post_CODE left join ${db}BALSHEET bs on bs.bs_key=ac.bs_id left join ${db}BOOK_PROPERTIES bk on bk.book_key=ac.book`
      + `${headingPath ? ` left join ${db}ADDON_DATA adata on adata.code=ac.code` : ""}`
      + ` WHERE ${posted(yearStart, dayBeforeFrom)} AND ${yearOf}${scheduleOf}${bookOf}${partyOf}${accountOf} AND AC.BOOK ${bookCondition} GROUP BY ac.name, acbal.opening, ledpost.post_code${groupExtra} ORDER BY ledpost.post_code`);
    const found = existing(table);
    for (const row of earlier) for (const [key, value] of Object.entries({ ...row })) row[key.toLowerCase()] = value;
    for (const row of earlier) {
      if (found.has(codeOf(row.post_code)!)) continue;
      const smartBook = toText(row.smart_selected_book);
      const lead = bookAndSchedule ? `${toText(row.smart_schedule_code)} ${smartBook} `
        : bookKey !== "" ? `${smartBook} `
        : scheduleKey !== "" ? (headingPath ? `${toText(row.bs_code)} ${toText(row.smart_selected_schdule)} ` : `${toText(row.smart_schedule_code)} `)
        : "";
      const values: Record<string, unknown> = { SORTING_COL: `${lead}${toText(row.name)}  P`, SMART_AC_CODE: row.post_code, ROW_DATA_TYPE: "LED", SMART_NAME: row.name, NAME: row.name, OPENING_BAL: num(row.opening), DR_CR1: drCr(row.opening), CLOSING_BAL: 0, DR_CR: "", AC_CODE: row.post_code };
      if (scheduleKey !== "") { values.SMART_SCHEDULE_CODE = row.smart_schedule_code; values.SMART_SELECTED_SCHDULE = row.smart_selected_schdule; }
      if (bookKey !== "") { values.SMART_BOOK_CODE = row.smart_book_code; values.SMART_SELECTED_BOOK = row.smart_selected_book; }
      addonSelectedNames.forEach((column, index) => { if (headingPath && scheduleKey === "" && bookKey === "") values[column] = row[`smart_selected_addon${index + 1}`]; });
      table.insert(values);
    }
    for (const row of earlier) {
      if (num(row.debit) === 0 && num(row.credit) === 0) continue;
      for (const target of table.rows) if (codeOf(get(table, target, "AC_CODE")) === codeOf(row.post_code)) table.set(target, "OPENING_BAL", money(num(row.opening) + num(row.debit) - num(row.credit)));
    }
    setDrCr1(table, headingPath);
  };
  const addonSelectedNames = ["SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4"].slice(0, addonKeys.filter((key) => key !== "").length);

  // ---- With the groups as headings (TEMP_TABLE_TRIALBALANCE3) ----
  if (headings) {
    const removeNames = call.unionGroups.toUpperCase() === "AC.NAME,";
    const structure = await runReportSql(loader, frag(mainSql(true, true)));
    const table = tableFromFields(structure.fields);
    prepare(table);

    // The ticked groups' heading rows, one level at a time.
    const groups = groupList(replaceCI(call.unionGroups, "AC.NAME,", ""));
    const smartColumns: string[] = [];
    let addonNumber = 0;
    const sortingTerms: string[] = [];
    for (const group of groups) {
      const smart = groupSmartColumn(group, addonNumber);
      if (smart !== "") smartColumns.push(smart);
      const fix = groupHeadingColumns(group, addonNumber + (removeAliasUpper(group).includes("TXT_") ? 1 : 0));
      if (!fix) throw groupFailed();
      if (fix.addon) addonNumber += 1;
      sortingTerms.push(sortingTerm(group));
      const sortingSql = sortingTerms.join(" || ' ' || ");
      const smartValues = groups.slice(0, sortingTerms.length).map((part, index) => `${part} AS "s${index}"`).join(", ");
      const schedule = group.toUpperCase() === "BS.BS_DESC";
      const headingSql = `WITH ${t1} SELECT DISTINCT ${fix.values[0]} AS "k", ${smartValues}, ${group} AS "n", ${sortingSql} AS "o"${schedule ? ', BS.BS_CODE AS "b"' : ""} ${csFrom} ${trialWhere} ORDER BY ${schedule ? "BS.BS_CODE" : group}`;
      for (const heading of await rowsOf(headingSql)) {
        const values: Record<string, unknown> = { [fix.columns[0]]: heading.k, ROW_DATA_TYPE: fix.rowType, NAME: heading.n, SORTING_COL: heading.o };
        smartColumns.forEach((column, index) => { values[column] = heading[`s${index}`]; });
        for (const column of Object.keys(values)) table.addColumn(column);
        table.insert(values);
      }
    }

    // The accounts.
    const data = await runReportSql(loader, frag(mainSql(true, false)));
    for (const row of data.rows) table.rows.push({ ...Object.fromEntries(table.columns.map((column) => [column, null])), ...row });

    if (between) await generalOpening(table, true);

    // Sundry Debtors / Creditors lines (only without an addon group).
    if (addonKeys[0] === "") {
      const lines = await controlLines(true);
      if (scheduleKey !== "") {
        for (const line of lines) for (const row of table.rows) if (toText(get(table, row, "NAME")) === toText(line.name) && ["SUNDRY DEBTORS", "SUNDRY CREDITORS"].includes(toText(line.name)) && type(table, row) === "LED") { table.set(row, "OPENING_BAL", line.opening); table.set(row, "DEBIT", line.debit); table.set(row, "CREDIT", line.credit); }
      } else {
        for (const line of lines) {
          const values: Record<string, unknown> = { SORTING_COL: bookKey !== "" ? `${toText(line.book_desc)} ${toText(line.name)}  P` : `${toText(line.name)}  P`, SMART_AC_CODE: line.code, ROW_DATA_TYPE: "LED", SMART_NAME: line.name, NAME: line.name, OPENING_BAL: line.opening, DR_CR1: drCr(line.opening), DEBIT: line.debit, CREDIT: line.credit, CLOSING_BAL: 0, DR_CR: "", AC_CODE: line.code };
          if (bookKey !== "") { values.SMART_BOOK_CODE = line.book_key; values.SMART_SELECTED_BOOK = line.book_desc; }
          table.insert(values);
        }
      }
      // Accounts with an opening and nothing posted.
      const found = existing(table);
      const bothColumns = `, bs.bs_key AS "bs_key", bs.bs_desc AS "bs_desc", bs.bs_code AS "bs_code", bk.book_key AS "book_key", bk.book_desc AS "book_desc"`;
      for (const row of await openingOnlyRows(bothColumns, bookOf)) {
        if (found.has(codeOf(row.code)!)) continue;
        const lead = scheduleKey !== "" && bookKey === "" ? `${toText(row.bs_code)} ${toText(row.bs_desc)} ` : "";
        const values: Record<string, unknown> = { SORTING_COL: `${lead}${toText(row.name)}  P`, SMART_AC_CODE: row.code, ROW_DATA_TYPE: "LED", SMART_NAME: row.name, NAME: row.name, OPENING_BAL: row.opening, DR_CR1: drCr(row.opening), CLOSING_BAL: 0, DR_CR: "", AC_CODE: row.code };
        if (scheduleKey !== "") { values.SMART_SCHEDULE_CODE = row.bs_key; values.SMART_SELECTED_SCHDULE = row.bs_desc; }
        if (bookKey !== "") { values.SMART_BOOK_CODE = row.book_key; values.SMART_SELECTED_BOOK = row.book_desc; }
        table.insert(values);
      }
    }

    // Clean-up: names off the entries when the account is the only group, the selected name, the Opening filter.
    for (const row of table.rows) {
      if (removeNames) { if (type(table, row) === "LED") table.set(row, "NAME", ""); }
      else table.set(row, "SORTING_COL", get(table, row, "SORTING_COL") === null ? null : toText(get(table, row, "SORTING_COL")).trim());
    }
    table.addColumn("SELECTED_NAME");
    for (const row of table.rows) table.set(row, "SELECTED_NAME", get(table, row, "SMART_NAME"));
    if (filterFormat === "OPENING") {
      openingToSides(table);
      table.rows = table.rows.filter((row) => !((num(get(table, row, "OPENING_BAL")) === 0 && num(get(table, row, "DEBIT")) === 0 && num(get(table, row, "CREDIT")) === 0) || (num(get(table, row, "OPENING_BAL")) === 0 && isNull(table, row, "DEBIT") && isNull(table, row, "CREDIT"))));
    }
    for (const row of table.rows) {
      if (type(table, row) !== "LED") continue;
      if (isNull(table, row, "DEBIT")) table.set(row, "DEBIT", 0);
      if (isNull(table, row, "CREDIT")) table.set(row, "CREDIT", 0);
      if (isNull(table, row, "CLOSING_BAL")) table.set(row, "CLOSING_BAL", 0);
    }
    closingBalance(table);
    if (scheduleKey !== "" || bookKey !== "") for (const row of table.rows) if (type(table, row) === "LED") table.set(row, "SMART_AC_CODE", get(table, row, "AC_CODE"));
    if (call.filterText === "Both" && !check("CHK_PRNT_ZERO") && licence === 4 && filterFormat !== "OPENING") {
      table.rows = table.rows.filter((row) => !(type(table, row) === "LED" && num(get(table, row, "OPENING_BAL")) === 0 && num(get(table, row, "CLOSING_BAL")) === 0));
    } else if (!check("CHK_PRNT_ZERO") && filterFormat !== "OPENING") {
      table.rows = table.rows.filter((row) => !(type(table, row) === "LED" && num(get(table, row, "CLOSING_BAL")) === 0));
    }

    // Book and schedule headings are made again from what is left, then the groups with nothing under them go.
    const regroup = async (rowType: string, codeColumn: string, selectedColumn: string, headingsOf: () => Promise<Map<string, { sorting: unknown; name: unknown }>>) => {
      table.rows = table.rows.filter((row) => type(table, row) !== rowType);
      const heads = await headingsOf();
      const seen = new Set<string>();
      for (const row of [...table.rows]) {
        const code = codeOf(get(table, row, codeColumn));
        if (code === null || seen.has(code)) continue;
        seen.add(code);
        const head = heads.get(code);
        table.insert({ SORTING_COL: head?.sorting ?? null, [codeColumn]: code, ROW_DATA_TYPE: rowType, NAME: head?.name ?? null, [selectedColumn]: head?.name ?? null });
      }
    };
    const dropSingles = (column: string) => {
      const counts = new Map<string, number>();
      for (const row of table.rows) { const code = codeOf(get(table, row, column)); if (code !== null) counts.set(code, (counts.get(code) ?? 0) + 1); }
      table.rows = table.rows.filter((row) => { const code = codeOf(get(table, row, column)); return code === null || counts.get(code) !== 1; });
    };
    if (scheduleKey !== "") {
      const schedules = new Map((await rowsOf(`SELECT bs_key, bs_code, bs_desc FROM ${db}BALSHEET`)).map((row) => [String(row.bs_key), { sorting: `${toText(row.bs_code)} ${toText(row.bs_desc)}`, name: row.bs_desc }]));
      await regroup("SCHEDULE", "SMART_SCHEDULE_CODE", "SMART_SELECTED_SCHDULE", async () => schedules);
    }
    if (bookKey !== "") {
      const books = new Map((await rowsOf(`SELECT book_key, book_desc FROM ${db}BOOK`)).map((row) => [String(row.book_key), { sorting: row.book_desc, name: row.book_desc }]));
      await regroup("BOOK", "SMART_BOOK_CODE", "SMART_SELECTED_BOOK", async () => books);
    }
    if (call.filterText === "Opening Only") table.rows = table.rows.filter((row) => !(type(table, row) === "LED" && num(get(table, row, "DEBIT")) === 0 && num(get(table, row, "CREDIT")) === 0));
    if (scheduleKey !== "") dropSingles("SMART_SCHEDULE_CODE");
    if (bookKey !== "") dropSingles("SMART_BOOK_CODE");
    addonKeys.forEach((key, index) => { if (key !== "") dropSingles(`ADDON_${index + 1}_CODE`); });

    const nameKey = (row: ResultRow) => textKey(get(table, row, "NAME"));
    sortRows(table, scheduleKey !== "" || addonKeys[0] !== "" ? [(row) => textKey(get(table, row, "SORTING_COL")), nameKey] : [(row) => textKey(get(table, row, "SORTING_COL"))]);
    return table;
  }

  // ---- Accounts alone (TEMP_TABLE_TRIALBALANCE2) ----
  const main = await runReportSql(loader, frag(mainSql(false, false)));
  const table = tableFromFields(main.fields);
  prepare(table);
  table.rows = main.rows.map((row) => ({ ...Object.fromEntries(table.columns.map((column) => [column, null])), ...row }));
  const opening = filterFormat === "OPENING";
  const sortingKey = (row: ResultRow) => textKey(get(table, row, "SORTING_COL"));

  if (opening && first !== 1) {
    if (between) await addEarlierOnly(table, false);
    openingToSides(table);
    table.rows = table.rows.filter((row) => isNull(table, row, "OPENING_BAL") || num(get(table, row, "OPENING_BAL")) !== 0);
    openingDifference(table);
  } else if (first === 1 && addonKeys[0] === "") {
    if (between) await generalOpening(table, false);
    const lines = await controlLines(false);
    if (scheduleKey !== "") {
      for (const line of lines) for (const row of table.rows) if (toText(get(table, row, "NAME")) === toText(line.name) && ["SUNDRY DEBTORS", "SUNDRY CREDITORS"].includes(toText(line.name))) { table.set(row, "OPENING_BAL", line.opening); table.set(row, "DEBIT", line.debit); table.set(row, "CREDIT", line.credit); }
    } else {
      for (const line of lines) table.insert({ SORTING_COL: `${toText(line.name)}  P`, SMART_AC_CODE: line.code, ROW_DATA_TYPE: "LED", SMART_NAME: line.name, NAME: line.name, OPENING_BAL: line.opening, DR_CR1: drCr(line.opening), DEBIT: line.debit, CREDIT: line.credit, CLOSING_BAL: 0, DR_CR: "", AC_CODE: line.code });
    }
    // Accounts with an opening and nothing posted ("ac.book in <accounts>" is how the procedure filters them).
    const found = existing(table);
    const extra = `, bs.bs_key AS "bs_key", bs.bs_desc AS "bs_desc", bk.book_key AS "book_key", bk.book_desc AS "book_desc"`;
    for (const row of await openingOnlyRows(extra, `${bookKey !== "" ? ` and ac.book in ${bookKey}` : ""}${accountKey !== "" ? ` and ac.book in ${accountKey}` : ""}`)) {
      if (found.has(codeOf(row.code)!)) continue;
      const values: Record<string, unknown> = { SORTING_COL: `${toText(row.name)}  P`, SMART_AC_CODE: row.code, ROW_DATA_TYPE: "LED", SMART_NAME: row.name, NAME: row.name, OPENING_BAL: row.opening, DR_CR1: drCr(row.opening), CLOSING_BAL: 0, DR_CR: "", AC_CODE: row.code };
      if (scheduleKey !== "") { values.SMART_SCHEDULE_CODE = row.bs_key; values.SMART_SELECTED_SCHDULE = row.bs_desc; }
      if (bookKey !== "") { values.SMART_BOOK_CODE = row.book_key; values.SMART_SELECTED_BOOK = row.book_desc; }
      table.insert(values);
    }
    if (opening) {
      openingToSides(table);
      table.rows = table.rows.filter((row) => isNull(table, row, "OPENING_BAL") || num(get(table, row, "OPENING_BAL")) !== 0);
    }
    table.rows = table.rows.filter((row) => !(num(get(table, row, "OPENING_BAL")) === 0 && ((num(get(table, row, "DEBIT")) === 0 && num(get(table, row, "CREDIT")) === 0) || (isNull(table, row, "DEBIT") && isNull(table, row, "CREDIT")))));
    closingBalance(table);
    if (!check("CHK_PRNT_ZERO") && filterFormat !== "OPENING") table.rows = table.rows.filter((row) => !(type(table, row) === "LED" && nothingLeft(table, row)));
    openingDifference(table);
  } else if (first !== 1) {
    if (between) await addEarlierOnly(table, true);
    if (!check("CHK_PRNT_ZERO")) table.rows = table.rows.filter((row) => !(type(table, row) === "LED" && nothingLeft(table, row)));
  } else if (filterFormat === "CLOSING") {
    if (!check("CHK_PRNT_ZERO")) table.rows = table.rows.filter((row) => !(type(table, row) === "LED" && ((num(get(table, row, "CLOSING_BAL")) === 0 && num(get(table, row, "DEBIT")) === 0 && num(get(table, row, "CREDIT")) === 0) || (isNull(table, row, "CLOSING_BAL") && isNull(table, row, "DEBIT") && isNull(table, row, "CREDIT")))));
    openingDifference(table);
    return table;
  } else {
    throw new ReportRefusal("This trial balance selection is not available in the web version yet.", "Not ported yet");
  }
  sortRows(table, [sortingKey]);
  return table;
}

// ======================================================================================
// 22: PROFIT & LOSS (lines 8771-10776, "ACTIONS FOR PROFIT & LOSS")
// ======================================================================================
//
// A two-sided table: the debit side (PARTICULAR, CURRENT_AMOUNT) on the left, the credit side
// (PARTICULAR_1, CURRENT_AMOUNT_1) on the right, one row per SR_NO. The procedure walks the
// accounts' net amounts by balance sheet level (1 trading, 2 profit and loss, 3 appropriation) and
// keeps two row counters, one per side: an item goes to a new row when its side's counter has
// caught up with the other side's, else into the row the other side already made. The
// gross and net profit / loss lines are put in at each change of level. The same counters are
// kept here, one for one.
//
// Not ported: the Previous Year (CHK_PREV_BAL), Cash / Cheque (CHK_CASH_CHQ) and Cash Sale
// (CHK_CSPLREQ) options, the closing stock worked out from the stock report (CHK_UPD_MASTER;
// a Closing / Opening amount typed in is used), and the procedure's write of the profit back
// to AC_BALANCE.OS_BILLDIFF (this program only reads).

type ProfitRow = { sr: number; particular: unknown; amount: unknown; particular1: unknown; amount1: unknown; level: unknown; desc: unknown; desc1: unknown };

async function profitLoss(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const rowsOf = async (sql: string) => (await runReportSql(loader, frag(sql))).rows;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const first = call.fcValue;
  const licence = call.licence;
  for (const [name, caption] of [["CHK_PREV_BAL", "Previous Year Balance"], ["CHK_CASH_CHQ", "Cash / Cheque"], ["CHK_CSPLREQ", "Cash Sale"]] as const) {
    if (check(name)) throw new ReportRefusal(`The ${caption} option of the Profit & Loss is not available in the web version yet.`, "Not ported yet");
  }
  if (call.sortingText.includes("Opening Amount")) throw new ReportRefusal("Pl. Cursor Select Closing Amount Row", "INTERNAL PROGRAM FAILURE");
  if (call.from.getTime() !== call.tarikh1.getTime() && first === 1) throw new ReportRefusal("Pl. Select Between Date Option Or From Date Select Year Start Date", "INTERNAL PROGRAM FAILURE");
  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);

  // bitHideBook: licences 19, 29, 68 and 73 hide entries booked against an account whose short name says CA_ENT.
  let hideBook = true;
  if ([19, 29, 68, 73].includes(licence)) {
    const found = await runReportSql(loader, `SELECT COUNT(*) AS n FROM ${db}account WHERE a_pos <> 'D' AND POSITION('CA_ENT' IN a_short) > 0`);
    hideBook = num(found.rows[0]?.n) > 0;
  }
  const hide = !hideBook && [19, 29, 68, 73].includes(licence) ? ` AND LEDPOST.POST_BOOKCD in (select code from ${db}ACCOUNT where a_pos='A')` : "";

  // The capital accounts the company has (BOSSCAPITAL): 0901 proprietor ... 0905.
  const capitals = (await rowsOf(`select left(bs_code,4) AS c4 from ${db}balsheet where BS_POS <> 'D' and bs_key in (select bs_id from ${db}account where a_pos<>'D' and bs_id in (select bs_key from ${db}balsheet where BS_POS <> 'D' and Left(bs_code,2)='09' and substring(bs_code,3,2) in ('01','02','03','04','05')))`)).map((row) => String(row.c4));
  const capital = (code: string) => capitals.includes(code);
  const partnership = capital("0901") || capital("0902") || capital("0904") || capital("0905");

  // The typed Closing / Opening stock amounts (var_text1, var_text2).
  const text1Raw = toText(call.text[0]).trim();
  const text1 = text1Raw === "" || text1Raw === "0" ? "0.00" : text1Raw;
  const text2 = toText(call.text[1]).trim();
  const noClosingText = text1 === "" || text1 === "0.00";
  const closingText = noClosingText ? 0 : num(text1);

  // The table (TEMP_TABLE_PROFITLOS), kept as rows.
  const rows: ProfitRow[] = [];
  let srNo = 0;
  let debitCounter = 0;
  let creditCounter = 0;
  let debitAmount = 0;
  let creditAmount = 0;
  let diff = 0;
  let profitSign = 0;
  let insertedClosing = false;
  let tempLevel = 0;
  let openSr = 0;
  let openAmount = 0;
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  const insert = (values: Partial<ProfitRow>) => { rows.push({ sr: srNo, particular: null, amount: null, particular1: null, amount1: null, level: null, desc: null, desc1: null, ...values }); };
  const update = (sr: number, values: Partial<ProfitRow>) => { for (const row of rows) if (row.sr === sr) Object.assign(row, values); };
  const sync = () => { if (debitCounter >= creditCounter) creditCounter = debitCounter + 1; else debitCounter = creditCounter + 1; };
  const even = () => { if (debitCounter > creditCounter) creditCounter = debitCounter; else debitCounter = creditCounter; };
  const half = (value: number) => ((licence === 5 || licence === 18) && check("CHK_PROFIT_FULL") ? value / 2 : value);
  const sumOf = (side: "amount" | "amount1", notTrading: boolean) => r2(rows.filter((row) => !notTrading || (row.desc !== null && row.desc !== "TRADING")).reduce((sum, row) => sum + num(row[side]), 0));

  // Opening stock: the opening stock account's opening (last year's closing for a between-date report).
  const opening = await rowsOf(`SELECT ac.name AS "particular", acbal.${first === 2 ? "last_year" : "opening"}::numeric AS "amount", acbal.os_billdiff::numeric AS "closing"`
    + ` FROM ${db}ACCOUNT ac left join ${db}AC_BALANCE acbal on acbal.code=ac.code left join ${db}balsheet bs on bs.bs_key=ac.bs_id`
    + ` where acbal.year_id='${call.yearId}' and ac.ac_opensty='CB' and ac.a_pos<>'D' and ac.bs_id=10`);
  let lyOpen = 0;
  for (const stock of opening) {
    openAmount = num(stock.amount);
    if (text2 !== "" && text2 !== "0.00" && text2 !== "0") openAmount = num(text2);
    if (openAmount > 0) {
      srNo += 1;
      insert({ particular: "OPENING STOCK", amount: Math.abs(openAmount), level: 1, desc: "TRADING" });
      openSr = srNo;
      lyOpen = Math.abs(openAmount);
      debitAmount += Math.abs(openAmount);
      debitCounter += 1;
    }
  }

  // The accounts' net amounts, by level, balance sheet head and name.
  const csFrom = withEntryAddon(call.from_, `left join ${db}addon_aentry aentry on ac.code=aentry.aona_accode`).split("sys.aents").join("").split("sys.aente").join("");
  const where = call.where.split("|sys.yearid|").join(call.yearId);
  const accounts = await rowsOf(`SELECT ac1.name AS "particular", SUM(CASE WHEN ledpost.POST_DBCODE = 1 THEN ledpost.POST_AMT::numeric ELSE 0.00 END) AS "debit", SUM(CASE WHEN ledpost.POST_DBCODE = 2 THEN ledpost.POST_AMT::numeric ELSE 0.00 END) AS "credit", bs2.bs_level AS "bs_level", bs2.bs_desc AS "bs_desc"`
    + ` FROM ${db}LEDGER_POST ledpost left join ${db}account ac1 on ac1.code=ledpost.post_code left join ${db}balsheet bs2 on bs2.bs_key=ac1.bs_id left join ${db}LEDGER led on led.led_key=ledpost.led_id`
    + ` WHERE ledpost.POST_DATE BETWEEN '${fromText}' AND '${uptoText}'${hide} and ledpost.post_bookcd in (select code from ${db}ACCOUNT where a_pos<>'D') and led.DOC_POS<>'D' and coalesce(LEFT(doc_no1,3),'')<>'END'`
    + ` and ledpost.POST_CODE in (select ac.code ${csFrom} ${where} and (ac.bs_id in (select bs1.bs_key from ${db}balsheet bs1 where (Left(bs1.bs_code,2) between '01' and '04') or (bs1.bs_key=10))))`
    + ` GROUP BY bs2.bs_level, bs2.bs_desc, ac1.name ORDER BY bs2.bs_level, bs2.bs_desc, ac1.name`);
  accounts.sort((a, b) => num(a.bs_level) - num(b.bs_level) || sqlServerCompare(toText(a.bs_desc), toText(b.bs_desc)) || sqlServerCompare(toText(a.particular), toText(b.particular)));

  /** The trading account's close (level 1 to the next): the closing stock, then the gross profit or loss carried to the profit and loss. */
  const closeTrading = (side: "debit" | "credit", balanceHead: string) => {
    if (noClosingText) {
      diff = r2(creditAmount - debitAmount);
    } else {
      if (creditCounter >= debitCounter) {
        creditCounter += 1; srNo += 1;
        insert({ particular1: "CLOSING STOCK", amount1: closingText, level: 1, desc: "TRADING" });
      } else {
        creditCounter += 1;
        update(creditCounter, { particular1: "CLOSING STOCK", amount1: closingText, level: 1, desc: "TRADING" });
      }
      insertedClosing = true;
      creditAmount += closingText;
      diff = r2(creditAmount - debitAmount);
    }
    const loss = side === "debit" ? diff < 0 : diff <= 0;
    if (loss) {
      srNo += 1; creditCounter += 1;
      insert({ particular1: "Gross Loss c/f", amount1: Math.abs(diff), level: 1, desc: "TRADING" });
      srNo += 1; debitCounter += 1;
      insert({ particular: "Gross Loss B/d", amount: Math.abs(diff), level: 2, desc: balanceHead });
      sync();
      debitAmount = Math.abs(diff); creditAmount = 0;
    } else {
      srNo += 1; debitCounter += 1;
      insert({ particular: "Gross Profit C/f", amount: Math.abs(diff), level: 1, desc: "TRADING" });
      srNo += 1;
      insert({ particular1: "Gross Profit B/d", amount1: Math.abs(diff), level: 2, desc: balanceHead });
      creditCounter += 1;
      sync();
      debitAmount = 0; creditAmount = Math.abs(diff);
    }
    even();
    diff = 0;
  };
  /** The profit and loss account's close (level 2 to the next): the net profit or loss and its appropriation line. */
  const closeProfitLoss = () => {
    diff = half(r2(creditAmount - debitAmount));
    if (diff >= 0) {
      srNo += 1; debitCounter += 1;
      insert({ particular: "NET PROFIT", amount: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" });
      if (capital("0903")) {
        srNo += 1; creditCounter += 1;
        insert({ particular1: "NET PROFIT B/d", amount1: Math.abs(diff), level: 3, desc: "PROFIT & LOSS APPROPRIATION" });
      }
      sync();
      creditAmount = Math.abs(diff); debitAmount = 0; profitSign = -1;
    } else {
      srNo += 1; creditCounter += 1;
      insert({ particular1: "NET LOSS", amount1: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" });
      if (capital("0903")) {
        srNo += 1; debitCounter += 1;
        insert({ particular: "NET LOSS B/d", amount: Math.abs(diff), level: 3, desc: "PROFIT & LOSS APPROPRIATION" });
      }
      sync();
      creditAmount = 0; debitAmount = Math.abs(diff); profitSign = 1;
    }
    even();
  };

  for (const account of accounts) {
    const particular = toText(account.particular);
    const level = num(account.bs_level);
    const balanceHead = toText(account.bs_desc);
    let net = r2(num(account.debit) - num(account.credit));
    if (licence === 5 && (particular === "PURCHASE BILL" || particular === "SALE BILL")) net -= Math.round(net * 0.18 * 100) / 100;
    if (net === 0) { continue; }
    const debitSide = net > 0;
    if (tempLevel !== level && tempLevel !== 0) {
      if (tempLevel === 1) {
        // A debit-side account also writes a nil closing stock when an opening stock was taken (LY_OPEN_AMOUNT <> 0, and nothing typed).
        if (debitSide && noClosingText && lyOpen !== 0) {
          diff = r2(creditAmount - debitAmount);
          if (creditCounter >= debitCounter) { creditCounter += 1; srNo += 1; insert({ particular1: "CLOSING STOCK", amount1: 0, level: 1, desc: "TRADING" }); }
          else { creditCounter += 1; update(creditCounter, { particular1: "CLOSING STOCK", level: 1, desc: "TRADING" }); }
          insertedClosing = true;
          const loss = diff < 0;
          if (loss) {
            srNo += 1; creditCounter += 1;
            insert({ particular1: "Gross Loss c/f", amount1: Math.abs(diff), level: 1, desc: "TRADING" });
            srNo += 1; debitCounter += 1;
            insert({ particular: "Gross Loss B/d", amount: Math.abs(diff), level: 2, desc: balanceHead });
            sync(); debitAmount = Math.abs(diff); creditAmount = 0;
          } else {
            srNo += 1; debitCounter += 1;
            insert({ particular: "Gross Profit C/f", amount: Math.abs(diff), level: 1, desc: "TRADING" });
            srNo += 1;
            insert({ particular1: "Gross Profit B/d", amount1: Math.abs(diff), level: 2, desc: balanceHead });
            creditCounter += 1; sync(); debitAmount = 0; creditAmount = Math.abs(diff);
          }
          even(); diff = 0;
        } else {
          closeTrading(debitSide ? "debit" : "credit", balanceHead);
        }
      } else if (tempLevel === 2) {
        closeProfitLoss();
      }
    }
    if (debitSide) {
      if (debitCounter >= creditCounter) {
        debitCounter += 1;
        srNo += 1;
        insert({ particular, amount: net, level, desc: balanceHead });
      } else {
        debitCounter += 1;
        update(openSr > 0 && particular === "OPENING STOCK" ? openSr : debitCounter, { particular, amount: net });
      }
      debitAmount += Math.abs(net);
    } else {
      creditAmount += Math.abs(net);
      if (creditCounter >= debitCounter) {
        creditCounter += 1;
        srNo += 1;
        insert({ particular1: particular, amount1: Math.abs(net), level, desc: balanceHead });
      } else {
        creditCounter += 1;
        update(creditCounter, { particular1: particular, amount1: Math.abs(net) });
      }
    }
    tempLevel = level;
  }

  // Closing stock typed in, when the accounts never reached the end of the trading account.
  if (!insertedClosing && call.sortingText !== "None") {
    if (noClosingText) {
      diff = r2(creditAmount - debitAmount);
    } else {
      if (creditCounter >= debitCounter) { creditCounter += 1; srNo += 1; insert({ particular1: "CLOSING STOCK", amount1: closingText, level: 1, desc: "TRADING" }); }
      else { creditCounter += 1; update(creditCounter, { particular1: "CLOSING STOCK", amount1: closingText, level: 1, desc: "TRADING" }); }
      insertedClosing = true;
      creditAmount += closingText;
      diff = r2(creditAmount - debitAmount);
    }
  }

  for (const row of rows) {
    if (num(row.level) === 1) { row.desc = ""; row.desc1 = "TRADING"; }
    if (num(row.level) === 2) { row.desc1 = "PROFIT & LOSS"; if (row.desc === "PROFIT & LOSS") row.desc = ""; }
  }
  const appropriated = rows.some((row) => num(row.level) === 3);

  // The profit or loss of the period, put to the capital accounts.
  if (capital("0903")) {
    creditAmount = sumOf("amount1", true);
    debitAmount = sumOf("amount", true);
    if (creditAmount === 0 && debitAmount === 0) {
      if (diff <= 0) {
        srNo += 1; creditCounter += 1;
        insert({ particular1: "Gross Loss c/f", amount1: Math.abs(diff), level: 1, desc: "TRADING" });
        srNo += 1; debitCounter += 1;
        insert({ particular: "Gross Loss B/d", amount: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" });
        sync(); debitAmount = Math.abs(diff); creditAmount = 0;
      } else {
        srNo += 1; debitCounter += 1;
        insert({ particular: "Gross Profit C/f", amount: Math.abs(diff), level: 1, desc: "TRADING" });
        srNo += 1;
        insert({ particular1: "Gross Profit B/d", amount1: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" });
        creditCounter += 1; sync(); debitAmount = 0; creditAmount = Math.abs(diff);
      }
      even();
    }
    diff = half(r2(creditAmount - debitAmount));
    if (diff >= 0) {
      if (!appropriated) {
        srNo += 1; debitCounter += 1;
        insert({ particular: "NET PROFIT", amount: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" });
        srNo += 1; creditCounter += 1;
        insert({ particular1: "NET PROFIT B/d", amount1: Math.abs(diff), level: 3, desc: "", desc1: "PROFIT & LOSS APPROPRIATION" });
      }
      sync(); creditAmount = Math.abs(diff); debitAmount = 0; profitSign = -1;
    } else {
      if (!appropriated) {
        srNo += 1; creditCounter += 1;
        insert({ particular1: "NET LOSS", amount1: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" });
        srNo += 1; debitCounter += 1;
        insert({ particular: "NET LOSS B/d", amount: Math.abs(diff), level: 3, desc: "PROFIT & LOSS APPROPRIATION", desc1: "PROFIT & LOSS APPROPRIATION" });
      }
      sync(); creditAmount = 0; debitAmount = Math.abs(diff); profitSign = 1;
    }
    even();
  }
  if (!capital("0903")) {
    const single = rows.length === 1;
    creditAmount = sumOf("amount1", !single);
    debitAmount = sumOf("amount", !single);
    diff = half(r2(creditAmount - debitAmount));
  }
  if (partnership) {
    if (creditAmount === 0 && debitAmount === 0) {
      creditAmount = sumOf("amount1", false);
      debitAmount = sumOf("amount", false);
      diff = half(r2(creditAmount - debitAmount));
    }
    if (diff > 0) {
      srNo += 1;
      insert({ particular: "NET PROFIT", amount: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" });
      profitSign = -1;
    } else if (diff < 0) {
      srNo += 1;
      insert({ particular1: "NET LOSS", amount1: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" });
      profitSign = 1;
    }
  } else if (diff >= 0) {
    if (!capital("0903")) { srNo += 1; insert({ particular: "NET PROFIT", amount: Math.abs(diff), level: 2, desc: "", desc1: "PROFIT & LOSS" }); }
    srNo += 1;
    insert({ particular: "APPROPRIATE PROFIT", amount: Math.abs(diff), level: 3, desc: "", desc1: "PROFIT & LOSS APPROPRIATION" });
    profitSign = -1;
  } else {
    srNo += 1;
    insert({ particular1: "APPROPRIATE LOSS", amount1: Math.abs(diff), level: 3, desc: "PROFIT & LOSS APPROPRIATION" });
    profitSign = 1;
  }
  diff = Math.abs(diff);

  // Profit shared among the partners (Profit Transfer): a line for each, by its percentage.
  if (partnership && check("CHK_PROFIT_TRF")) {
    const partners = await rowsOf(`SELECT ac.name AS "name", ac.a_perc AS "perc", ac.code AS "code", left(bs.bs_code,4) AS "bs_code" FROM ${db}ACCOUNT ac left join ${db}balsheet bs on bs.bs_key=ac.bs_id where ac.a_pos<>'D' and (left(bs.bs_code,4)='0901' or left(bs.bs_code,4)='0902' or left(bs.bs_code,4)='0904' or left(bs.bs_code,4)='0905') order by name`);
    partners.sort((a, b) => sqlServerCompare(toText(a.name), toText(b.name)));
    for (const partner of partners) {
      const perc = toText(partner.bs_code) === "0901" ? 100 : num(partner.perc);
      const entry = Math.round(diff * perc / 100 * 100) / 100 * profitSign;
      srNo += 1;
      insert({ particular: `${toText(partner.name)} == >> ${perc}%`, amount: Math.abs(entry), level: 20, desc: "PROFIT_DIST" });
      if (toText(partner.bs_code) === "0901") break;
    }
  }

  // The table.
  const table = new ResultTable();
  table.setKind("Sr_No", "decimal");
  table.addColumn("PARTICULAR");
  table.setKind("CURRENT_AMOUNT", "decimal");
  if (check("CHK_PROFIT_PERC")) table.setKind("Perc", "decimal");
  table.addColumn("PARTICULAR_1");
  table.setKind("CURRENT_AMOUNT_1", "decimal");
  if (check("CHK_PROFIT_PERC")) table.setKind("Perc_1", "decimal");
  table.setKind("BS_LEVEL", "decimal");
  table.addColumn("BS_DESC");
  table.addColumn("BS_DESC1");
  rows.sort((a, b) => a.sr - b.sr);
  for (const row of rows) {
    if (num(row.level) === 3) { row.desc = ""; row.desc1 = "PROFIT & LOSS APPROPRIATION"; }
    table.insert({ Sr_No: row.sr, PARTICULAR: row.particular, CURRENT_AMOUNT: row.amount, PARTICULAR_1: row.particular1, CURRENT_AMOUNT_1: row.amount1, BS_LEVEL: row.level, BS_DESC: row.desc, BS_DESC1: row.desc1 });
  }
  if (check("CHK_PROFIT_PERC")) {
    const sale = await rowsOf(`SELECT coalesce(SUM(CASE WHEN ledpost.POST_DBCODE = 2 THEN ledpost.POST_AMT::numeric ELSE ledpost.POST_AMT::numeric *-1 END),0) AS "sale" from ${db}LEDGER_POST ledpost left join ${db}ACCOUNT ac on ac.code=ledpost.post_code left join ${db}LEDGER led on led.led_key=ledpost.led_id where ac.book=8 and ac.a_pos<>'D' and left(doc_no1,3) <> 'END' and led.doc_pos<>'D'`
      + ` and ledpost.post_bookcd in (select code from ${db}ACCOUNT where a_pos='A') and ledpost.POST_DATE BETWEEN '${fromText}' AND '${uptoText}'`);
    const totalSale = num(sale[0]?.sale);
    if (totalSale !== 0) {
      for (const row of table.rows) {
        if (num(table.get(row, "CURRENT_AMOUNT")) !== 0) table.set(row, "Perc", Math.round(num(table.get(row, "CURRENT_AMOUNT")) / totalSale * 100 * 1000) / 1000);
        if (num(table.get(row, "CURRENT_AMOUNT_1")) !== 0) table.set(row, "Perc_1", Math.round(num(table.get(row, "CURRENT_AMOUNT_1")) / totalSale * 100 * 1000) / 1000);
      }
    }
  }
  return table;
}

// ======================================================================================
// 23: BALANCE SHEET (lines 10777-11296, "ACTIONS FOR BALSHEET REPORT")
// ======================================================================================
//
// Every account of the balance sheet heads (level 8 assets, level 9 liabilities) with its opening
// and its closing (opening + debits - credits from the year's start to Upto) is added into the
// heads' lines; a head that reverses (REV_BSREC, option Balance Sheet Reverse) goes to the other
// side when the account's amount runs the other way. The liability heads (code 09..) and the asset
// heads (08..) are then put side by side, row against row.
//
// Not ported: the multi company (136) balance sheet, which the same
// procedure serves.

type HeadLine = { heading: string; code: string; code1: string; opening: number; closing: number };

/** The balance sheet's heads for one database and period: the liability heads (09..) and the asset heads (08..) with an opening or closing. */
async function balanceHeads(loader: Loader, plan: ReportPlan, db: string, startText: string, uptoText: string, yearId: string): Promise<{ liabilities: HeadLine[]; assets: HeadLine[] }> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const rowsOf = async (sql: string) => (await runReportSql(loader, frag(sql))).rows;
  const licence = call.licence;
  const reverse = call.checkQuery.includes("CHK_BSREVERSE,");
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;

  // bitHideBook: licences 19, 29, 68 and 73 hide entries booked against an account whose short name says CA_ENT.
  let hideBook = true;
  if ([19, 29, 68, 73].includes(licence)) {
    const found = await runReportSql(loader, `SELECT COUNT(*) AS n FROM ${db}account WHERE a_pos <> 'D' AND POSITION('CA_ENT' IN a_short) > 0`);
    hideBook = num(found.rows[0]?.n) > 0;
  }
  const hide = !hideBook && [19, 29, 68, 73].includes(licence) ? ` AND POST_BOOKCD in (select code from ${db}ACCOUNT where a_pos='A')` : "";

  // TEMP_TABLE_BALSHEET1: the accounts of the heads at level 8 and above.
  type Line = { name: string; revKey: number; bsKey: number; opening: number; closing: number; level: string; code: string; level1: string; code1: string; revHeading: string; heading: string; accountCode: number };
  const accounts = await rowsOf(`SELECT ac1.code AS "account", ac1.name AS "name", coalesce(bs2.rev_bsrec,0) AS "rev", bs2.bs_key AS "bs_key", coalesce(acbal.opening::numeric,0) AS "opening",`
    + ` coalesce(acbal.opening::numeric,0) + coalesce(ld.debit_total,0) - coalesce(lc.credit_total,0) AS "closing", bs2.bs_level AS "level", bs2.bs_code AS "code",`
    + ` CASE WHEN bs2.rev_bsrec > 0 THEN rev_bs.bs_level END AS "level1", CASE WHEN bs2.rev_bsrec > 0 THEN rev_bs.bs_code END AS "code1", CASE WHEN bs2.rev_bsrec > 0 THEN rev_bs.bs_desc END AS "rev_heading", bs2.bs_desc AS "heading"`
    + ` FROM ${db}account ac1 LEFT JOIN ${db}balsheet bs2 ON bs2.bs_key = ac1.bs_id AND bs2.bs_pos <> 'D'`
    + ` LEFT JOIN ${db}AC_BALANCE acbal ON acbal.code = ac1.code AND acbal.year_id = '${yearId}' AND acbal.a_recflag = 'AC'`
    + ` LEFT JOIN (SELECT POST_CODE, SUM(CASE WHEN POST_DBCODE = 1 THEN POST_AMT::numeric ELSE 0 END) debit_total FROM ${db}LEDGER_POST WHERE POST_DATE BETWEEN '${startText}' AND '${uptoText}'${hide} GROUP BY POST_CODE) ld ON ld.POST_CODE = ac1.code`
    + ` LEFT JOIN (SELECT POST_CODE, SUM(CASE WHEN POST_DBCODE = 2 THEN POST_AMT::numeric ELSE 0 END) credit_total FROM ${db}LEDGER_POST WHERE POST_DATE BETWEEN '${startText}' AND '${uptoText}'${hide} GROUP BY POST_CODE) lc ON lc.POST_CODE = ac1.code`
    + ` LEFT JOIN ${db}balsheet rev_bs ON rev_bs.bs_key = bs2.rev_bsrec`
    + ` WHERE bs2.bs_level >= 8 and ac1.book > 0 and ac1.a_pos <> 'D' ORDER BY ac1.code`);
  const lines: Line[] = accounts.map((row) => ({
    name: toText(row.name), revKey: reverse ? num(row.rev) : 0, bsKey: num(row.bs_key), opening: num(row.opening), closing: num(row.closing), level: String(num(row.level)), code: toText(row.code),
    level1: reverse && row.level1 !== null ? String(num(row.level1)) : "", code1: reverse ? toText(row.code1) : "", revHeading: reverse ? toText(row.rev_heading) : "", heading: toText(row.heading), accountCode: num(row.account),
  }));
  // A head that reverses onto its own level does not reverse.
  for (const line of lines) if (line.level === line.level1 && line.revKey > 0) { line.revHeading = ""; line.revKey = 0; }

  // What the profit transfer and the closing stock left in OS_BILLDIFF goes into the closings.
  const billDiff = await rowsOf(`SELECT ac.code AS "code", ac.name AS "name", ac.bs_id AS "bs_id", left(bs.bs_code,6) AS "c6", ac.ac_opensty AS "style", acbal.os_billdiff::numeric AS "diff"`
    + ` FROM ${db}account ac inner join ${db}ac_balance acbal on acbal.code=ac.code left join ${db}balsheet bs on bs.bs_key=ac.bs_id`
    + ` where ac.a_pos<>'D' and acbal.year_id='${yearId}'`);
  for (const line of lines) {
    for (const row of billDiff) {
      if (toText(row.name) !== line.name) continue;
      const six = toText(row.c6);
      if (["090100", "090200", "090300", "090400", "090500"].includes(six) && num(row.diff) !== 0) line.closing += num(row.diff);
      else if (six === "090601" && row.diff !== null) line.closing += num(row.diff);
    }
  }
  for (const stock of billDiff.filter((row) => toText(row.style) === "CB")) for (const line of lines) if (line.bsKey === num(stock.bs_id)) line.closing = num(stock.diff);

  // TEMP_TABLE_BALSHEET3: a line for each head.
  const heads: HeadLine[] = [];
  const seen = new Set<string>();
  const addHead = (heading: string, code: string, code1: string) => {
    const key = `${heading}\u0000${code}\u0000${code1}`;
    if (seen.has(key)) return;
    seen.add(key);
    heads.push({ heading, code, code1, opening: 0, closing: 0 });
  };
  const codes = new Set(lines.map((line) => line.code));
  for (const line of [...lines].sort((a, b) => sqlServerCompare(a.code, b.code))) if (line.heading !== "") addHead(line.heading, line.code, line.code1);
  for (const line of [...lines].sort((a, b) => sqlServerCompare(a.code, b.code))) if (line.revHeading !== "" && !codes.has(line.code1)) addHead(line.revHeading, line.code, line.code1);

  const add = (heading: string, code: string | null, field: "opening" | "closing", amount: number, newCode?: string) => {
    for (const head of heads) {
      if (head.heading !== heading || (code !== null && head.code !== code)) continue;
      head[field] = r2(head[field] + amount);
      if (newCode !== undefined) head.code = newCode;
    }
  };
  for (const line of lines) {
    const open = r2(line.opening);
    const close = r2(line.closing);
    const nine = line.level === "9";
    const eight = line.level === "8";
    for (const [field, value] of [["opening", open], ["closing", close]] as const) {
      if ((value <= 0 && nine) || (value > 0 && nine && line.revKey === 0)) add(line.heading, line.code, field, -value);
      else if (value < 0 && eight && line.revKey > 0) add(line.revHeading, null, field, Math.abs(value), line.code1);
      if ((value >= 0 && eight) || (value < 0 && eight && line.revKey === 0)) add(line.heading, line.code, field, value);
      else if (value > 0 && nine && line.revKey > 0) add(line.revHeading, null, field, Math.abs(value), line.code1);
    }
  }

  // The two sides, row against row (ORDER BY co_short, bs_code).
  const side = (prefix: string) => heads.filter((head) => head.code.startsWith(prefix) && (head.opening !== 0 || head.closing !== 0)).sort((a, b) => sqlServerCompare(a.code, b.code));
  const liabilities = side("09");
  const assets = side("08");
  return { liabilities, assets };
}

async function balanceSheet(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const rowsOf = async (sql: string) => (await runReportSql(loader, frag(sql))).rows;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const licence = call.licence;
  const reverse = check("CHK_BSREVERSE");
  const startText = desktopDate(call.tarikh1);
  const uptoText = desktopDate(call.upto);
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;

  const { liabilities, assets } = await balanceHeads(loader, plan, db, startText, uptoText, call.yearId);
  const table = new ResultTable();
  table.setKind("Sr_No", "decimal");
  table.setKind("OPENING", "decimal");
  table.addColumn("LIABILITY");
  table.setKind("AMOUNT", "decimal");
  table.setKind("Perc", "decimal");
  table.setKind("OPENING_1", "decimal");
  table.addColumn("ASSET");
  table.setKind("AMOUNT_1", "decimal");
  table.setKind("Perc_1", "decimal");
  const count = Math.max(liabilities.length, assets.length);
  for (let index = 0; index < count; index += 1) {
    const l = liabilities[index];
    const a = assets[index];
    table.insert({
      Sr_No: index, OPENING: l?.opening ?? 0, LIABILITY: l ? l.heading : "LIABILITY", AMOUNT: l?.closing ?? 0, Perc: 0,
      OPENING_1: a?.opening ?? 0, ASSET: a ? a.heading : "ASSET", AMOUNT_1: a?.closing ?? 0, Perc_1: 0,
    });
  }

  // Percentages, the difference line, and the empty sides.
  const drAmount = r2(table.rows.reduce((sum, row) => sum + num(table.get(row, "AMOUNT")), 0));
  const crAmount = r2(table.rows.reduce((sum, row) => sum + num(table.get(row, "AMOUNT_1")), 0));
  if (check("CHK_BAL_PERC")) {
    for (const row of table.rows) {
      if (num(table.get(row, "AMOUNT")) !== 0 && drAmount !== 0) table.set(row, "Perc", Math.round(num(table.get(row, "AMOUNT")) / drAmount * 100 * 1000) / 1000);
      if (num(table.get(row, "AMOUNT_1")) !== 0 && crAmount !== 0) table.set(row, "Perc_1", Math.round(num(table.get(row, "AMOUNT_1")) / crAmount * 100 * 1000) / 1000);
    }
  }
  const total = r2(drAmount - crAmount);
  if (total !== 0) {
    if (total > 0) table.insert({ Sr_No: 1000, OPENING: 0, OPENING_1: 0, ASSET: "Difference", AMOUNT_1: total, AMOUNT: 0 });
    else table.insert({ Sr_No: 1000, OPENING: 0, OPENING_1: 0, LIABILITY: "Difference", AMOUNT: Math.abs(total), AMOUNT_1: 0 });
  }
  if (!check("CHK_PREV_FIGURE")) {
    for (const row of table.rows) {
      if (num(table.get(row, "AMOUNT_1")) === 0) table.set(row, "ASSET", "");
      if (num(table.get(row, "AMOUNT")) === 0) table.set(row, "LIABILITY", "");
    }
    table.rows = table.rows.filter((row) => !(toText(table.get(row, "ASSET")) === "" && toText(table.get(row, "LIABILITY")) === ""));
  }

  if (!check("CHK_BSVERTICAL")) return table;

  // Vertical: the assets, then the liabilities, one under the other.
  const vertical = new ResultTable();
  vertical.addColumn("ROW_DATA_TYPE");
  vertical.addColumn("SORTING_FIELD");
  vertical.setKind("OPENING", "decimal");
  vertical.addColumn("DESCRIPTION");
  vertical.setKind("AMOUNT", "decimal");
  vertical.setKind("PERC", "decimal");
  vertical.addColumn("SMART_SELECTED_ADDON1");
  vertical.insert({ ROW_DATA_TYPE: "ADDON_1", SORTING_FIELD: "ASSET", OPENING: 0, DESCRIPTION: "ASSET", AMOUNT: 0, PERC: 0, SMART_SELECTED_ADDON1: "ASSET" });
  for (const row of table.rows) if (toText(table.get(row, "ASSET")) !== "") vertical.insert({ ROW_DATA_TYPE: "LED", SORTING_FIELD: "ASSET1", OPENING: table.get(row, "OPENING_1"), DESCRIPTION: table.get(row, "ASSET"), AMOUNT: table.get(row, "AMOUNT_1"), PERC: table.get(row, "Perc_1"), SMART_SELECTED_ADDON1: "ASSET" });
  vertical.insert({ ROW_DATA_TYPE: "ADDON_1", SORTING_FIELD: "LIABILITY", OPENING: 0, DESCRIPTION: "LIABILITY", AMOUNT: 0, PERC: 0, SMART_SELECTED_ADDON1: "LIABILITY" });
  for (const row of table.rows) if (toText(table.get(row, "LIABILITY")) !== "") vertical.insert({ ROW_DATA_TYPE: "LED", SORTING_FIELD: "LIABILITY1", OPENING: table.get(row, "OPENING"), DESCRIPTION: table.get(row, "LIABILITY"), AMOUNT: table.get(row, "AMOUNT"), PERC: table.get(row, "Perc"), SMART_SELECTED_ADDON1: "LIABILITY" });
  sortRows(vertical, [(row) => textKey(vertical.get(row, "SORTING_FIELD"))]);
  return vertical;
}

// ======================================================================================
// 24: ANNEXURE (lines 11297-11466, "ANNEXURE")
// ======================================================================================
//
// The accounts under each ticked balance sheet head (level 8 and 9) with their closing, a heading
// line for each head and its group, and the heads that have nothing left taken out. An account
// whose figure runs the other way under a head that reverses (REV_BSREC) is shown under the head
// it reverses to.

type AnnexureRow = { sorting: string; name: string; amount: number | null; bsCode: string; drCr: string | null; reverse: string | null; schedule: string | null; type: string; level: string | null; addon1: string | null };

async function annexure(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const rowsOf = async (sql: string) => (await runReportSql(loader, frag(sql))).rows;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const licence = call.licence;
  const scheduleKeys = call.selectScheduleKey.replace(/[()]/g, "").split(",").map((key) => key.trim()).filter((key) => /^\d+$/.test(key));
  if (scheduleKeys.length === 0) throw new ReportRefusal("Minimum one Schedule should be selected", "No Selections Done!");
  const startText = desktopDate(call.tarikh1);
  const uptoText = desktopDate(call.upto);
  const skipCaEnt = !check("CHK_BOTHFIG") && (licence === 29 || licence === 73);
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;

  // The accounts of the ticked heads, with their closing up to Upto.
  const opening = skipCaEnt
    ? "(b.opening::numeric - coalesce((case when e.local_code is null or e.local_code='' or e.local_code='0' then 0.00 else cast(e.local_code AS NUMERIC(18,4)) end),0))"
    : "b.opening::numeric";
  const fetched = await rowsOf(`SELECT c.bs_code AS "bs_code", c.bs_desc AS "bs_desc", a.name AS "name", ${opening} + sum(case when d.post_dbcode=1 then d.post_amt::numeric else 0 end) - sum(case when d.post_dbcode=2 then d.post_amt::numeric else 0 end) AS "inner_amt",`
    + ` c.bs_level AS "bs_level", c.bs_key AS "bs_key", c.rev_bsrec AS "rev", c.bs_codelevel AS "codelevel", left(c.bs_code, c.bs_codelevel*2) AS "level", rev_bs.bs_level AS "level1", rev_bs.bs_code AS "rev_code", rev_bs.bs_desc AS "rev_desc", left(rev_bs.bs_code, rev_bs.bs_codelevel*2) AS "rev_level"`
    + ` FROM ${db}account a left join ${db}ac_balance b on a.Code=b.CODE and b.a_recflag='AC' left join ${db}balsheet c on a.BS_ID=c.BS_KEY left join ${db}balsheet rev_bs ON rev_bs.bs_key = c.REV_BSREC`
    + `${skipCaEnt ? ` left join ${db}address e on a.CODE=e.CODE` : ""}`
    + ` left join ${db}LEDGER_POST d on a.Code=d.POST_CODE and d.post_bookcd in (select code from ${db}ACCOUNT where a_pos<>'D'${skipCaEnt ? " and a_short<>'CA_ENT'" : ""}) and d.POST_DATE>='${startText}' AND d.POST_DATE<='${uptoText}'`
    + ` WHERE a.a_pos<>'D' and c.BS_LEVEL >= 8 and b.year_id='${call.yearId}' and a.bs_id in (${scheduleKeys.join(",")})`
    + ` group by c.bs_code,c.bs_desc,a.name,b.opening${skipCaEnt ? ",e.local_code" : ""},c.bs_level,c.bs_key,c.rev_bsrec,c.bs_codelevel,rev_bs.bs_level,rev_bs.bs_code,rev_bs.bs_desc,rev_bs.bs_codelevel`);
  fetched.sort((a, b) => sqlServerCompare(toText(a.bs_code), toText(b.bs_code)) || sqlServerCompare(toText(a.bs_desc), toText(b.bs_desc)) || sqlServerCompare(toText(a.name), toText(b.name)));

  const rows: AnnexureRow[] = [];
  for (const row of fetched) {
    const amount = row.inner_amt === null ? null : r2(num(row.inner_amt));
    const level = num(row.bs_level);
    const rev = num(row.rev);
    const level1 = row.level1 === null ? null : num(row.level1);
    const reversed = amount !== null && rev > 0 && level1 !== level && ((amount < 0 && level === 8) || (amount > 0 && level === 9));
    if (reversed) {
      rows.push({ sorting: `${toText(row.rev_code)}${toText(row.rev_desc)}${toText(row.name)}  P`, name: toText(row.name), amount, bsCode: toText(row.rev_code), drCr: null, reverse: toText(row.bs_desc), schedule: toText(row.rev_desc), type: "LED", level: toText(row.rev_level), addon1: null });
    } else {
      rows.push({ sorting: `${toText(row.bs_code)}${toText(row.bs_desc)}${toText(row.name)}  P`, name: toText(row.name), amount, bsCode: toText(row.bs_code), drCr: null, reverse: "", schedule: toText(row.bs_desc), type: "LED", level: toText(row.level), addon1: null });
    }
  }
  const remove = (test: (row: AnnexureRow) => boolean) => { for (let index = rows.length - 1; index >= 0; index -= 1) if (test(rows[index])) rows.splice(index, 1); };
  remove((row) => (row.name === "SUNDRY DEBTORS" || row.name === "SUNDRY CREDITORS") && row.type === "LED");
  for (const row of rows) if (row.amount !== null && row.amount !== 0) row.drCr = row.amount < 0 ? "Cr" : "Dr";

  // The head's group (SMART_SELECTED_ADDON1): the balance sheet line the account's head code starts with.
  const sheets = await rowsOf(`SELECT bs_code, bs_desc, bs_codelevel FROM ${db}balsheet ORDER BY bs_code`);
  for (const row of rows) {
    if (row.level === null) continue;
    const match = sheets.find((sheet) => toText(sheet.bs_code).slice(0, 4) === row.level!.slice(0, 4));
    if (match) row.addon1 = toText(match.bs_desc);
  }

  // A heading for each head and group.
  const groups = new Map<string, { schedule: string; addon1: string | null; code: string }>();
  for (const row of rows) if (row.schedule !== null) groups.set(`${row.schedule}\u0000${row.addon1 ?? "\u0001"}\u0000${row.bsCode}`, { schedule: row.schedule, addon1: row.addon1, code: row.bsCode });
  const ordered = [...groups.values()].sort((a, b) => sqlServerCompare(a.schedule, b.schedule) || sqlServerCompare(a.addon1 ?? "", b.addon1 ?? "") || sqlServerCompare(a.code, b.code));
  for (const group of ordered) {
    if (group.addon1 === null) continue;
    for (const sheet of sheets.filter((candidate) => toText(candidate.bs_desc) === group.addon1)) {
      rows.push({ sorting: `${group.code}${group.schedule}  H`, name: group.schedule, amount: null, bsCode: group.code, drCr: null, reverse: null, schedule: group.schedule, type: "AC", level: toText(sheet.bs_code).slice(0, num(sheet.bs_codelevel) * 2), addon1: group.addon1 });
    }
  }
  const addonCount = new Map<string, number>();
  for (const row of rows) if (row.addon1 !== null) addonCount.set(row.addon1, (addonCount.get(row.addon1) ?? 0) + 1);
  for (const addon of [...addonCount.keys()].filter((key) => (addonCount.get(key) ?? 0) > 1).sort(sqlServerCompare)) {
    for (const sheet of sheets.filter((candidate) => toText(candidate.bs_desc) === addon)) {
      rows.push({ sorting: `${toText(sheet.bs_code)}${addon}  A`, name: addon, amount: null, bsCode: toText(sheet.bs_code), drCr: null, reverse: null, schedule: null, type: "ADDON_1", level: null, addon1: addon });
    }
  }

  // Lines with nothing, then the heads and groups with nothing under them.
  remove((row) => row.amount === 0 && row.type === "LED");
  const pairCount = new Map<string, number>();
  for (const row of rows) pairCount.set(`${row.schedule ?? "\u0001"}\u0000${row.addon1 ?? "\u0001"}`, (pairCount.get(`${row.schedule ?? "\u0001"}\u0000${row.addon1 ?? "\u0001"}`) ?? 0) + 1);
  const single = [...pairCount.entries()].filter(([, count]) => count === 1).map(([key]) => key.split("\u0000"));
  const scheduleList = new Set(single.filter(([schedule]) => schedule !== "\u0001").map(([schedule]) => schedule));
  const addonList = new Set(single.filter(([schedule, addon]) => schedule !== "\u0001" && addon !== "\u0001").map(([, addon]) => addon));
  remove((row) => row.schedule !== null && scheduleList.has(row.schedule) && row.addon1 !== null && addonList.has(row.addon1));
  const addonOnly = new Map<string, number>();
  for (const row of rows) if (row.addon1 !== null) addonOnly.set(row.addon1, (addonOnly.get(row.addon1) ?? 0) + 1);
  remove((row) => row.addon1 !== null && addonOnly.get(row.addon1) === 1);

  // What the profit transfer left in OS_BILLDIFF: the partners' capital and the 090600 heads.
  const billDiff = await rowsOf(`SELECT ac.name AS "name", left(bs.bs_code,6) AS "c6", acbal.os_billdiff::numeric AS "diff" FROM ${db}account ac inner join ${db}BALSHEET bs on ac.bs_id=bs.bs_key inner join ${db}AC_BALANCE acbal on ac.code=acbal.code where ac.a_pos<>'D' and acbal.year_id='${call.yearId}' and acbal.os_billdiff is not null`);
  for (const row of rows) {
    if (row.type !== "LED") continue;
    for (const diff of billDiff) {
      if (toText(diff.name) !== row.name) continue;
      const six = toText(diff.c6);
      if (["090100", "090200", "090300", "090400", "090500", "090600"].includes(six) && row.amount !== null) row.amount = r2(row.amount + num(diff.diff));
    }
  }

  const table = new ResultTable();
  table.addColumn("SORTING_COL");
  table.addColumn("name");
  table.setKind("Inner_amt", "decimal");
  table.addColumn("dr_cr");
  table.addColumn("REVERSEBS_DESC");
  table.addColumn("SMART_SELECTED_SCHDULE");
  table.addColumn("ROW_DATA_TYPE");
  table.addColumn("SMART_SELECTED_ADDON1");
  for (const row of rows) table.insert({ SORTING_COL: row.sorting, name: row.name, Inner_amt: row.amount, dr_cr: row.drCr, REVERSEBS_DESC: row.reverse, SMART_SELECTED_SCHDULE: row.schedule, ROW_DATA_TYPE: row.type, SMART_SELECTED_ADDON1: row.addon1 });
  sortRows(table, [(row) => textKey(table.get(row, "SORTING_COL"))]);
  return table;
}

// ======================================================================================
// 15: BANK RECONCILIATION (SP_STD_RPT_BANKRECO, called at line 8556)
// ======================================================================================
//
// The bank book's balance (the account's opening and what was entered from the year's start to
// Upto), the cheques issued and deposited that the bank has not cleared by Upto (RECO_DATE empty or
// later), and from them the balance as per the pass book.

async function bankReconciliation(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const startText = desktopDate(call.tarikh1);
  const uptoText = desktopDate(call.upto);
  const code = Number(call.fcValue);
  if (!Number.isFinite(code) || code <= 0) throw new ReportRefusal("Select the bank book (Daybook) to reconcile.", "No Selections Done!");

  // The bank book's balance.
  const balance = (await runReportSql(loader, frag(`SELECT acbal.opening::numeric + (SELECT SUM(CASE WHEN LED.AC_DBCODE = 1 THEN LED.AMOUNT::numeric * -1 ELSE LED.AMOUNT::numeric END) FROM ${db}LEDGER LED`
    + ` WHERE LED.BOOK_CODE = ${code} AND LED.DOC_DATE >= '${startText}' AND LED.DOC_DATE <= '${uptoText}' AND (LED.YEAR_ID = '${call.yearId}') and (LED.DOC_POS <> 'D')) AS "bal", acbal.opening::numeric AS "opening"`
    + ` FROM ${db}AC_BALANCE acbal WHERE acbal.CODE = ${code} and acbal.YEAR_ID = '${call.yearId}'`))).rows[0];
  const bank = Math.round((balance?.bal === null || balance?.bal === undefined ? num(balance?.opening) : num(balance.bal)) * 100) / 100;
  const sign = (value: number) => (value > 0 ? "DR" : value < 0 ? "CR" : null);

  // The cheques not cleared: debits (issued) and credits (deposited).
  const from = call.from_.replace(/[()]/g, "");
  const where = `${call.where} and LED.DOC_POS <> 'D' and LED.DOC_DATE <= '${uptoText}' and ((LED.RECO_DATE IS NULL) or LED.RECO_DATE > '${uptoText}') and (LED.year_id = '${call.yearId}')`;
  const side = async (dbcode: number, ordering: number) => (await runReportSql(loader, frag(`SELECT ${call.queryStart},${ordering} AS "ORDERING_COL1",ROW_NUMBER() OVER (ORDER BY LED.DOC_DATE,LED.AC_DBCODE) AS "ORDERING_COL2" ${from} ${where} AND LED.AC_DBCODE = ${dbcode} ORDER BY LED.DOC_DATE`)));
  const added = await side(1, 3);
  const less = await side(2, 6);
  const table = tableFromFields(added.fields);
  for (const column of ["INNER_AMT", "OUTER_AMT"]) table.setKind(column, "decimal");
  const sum = (rows: readonly ResultRow[]) => Math.round(rows.reduce((total, row) => total + num(row.INNER_AMT ?? row.inner_amt), 0) * 100) / 100;
  const addedTotal = sum(added.rows);
  const lessTotal = sum(less.rows);
  const make = (type: string, values: Record<string, unknown>) => table.insert({ ROW_DATA_TYPE: type, ...values });
  make("H0", { NAME: "BALANCE AS PER BANK BOOK", OUTER_AMT: Math.abs(bank), DR_CR: sign(bank), ORDERING_COL1: 1, ORDERING_COL2: 1 });
  make("H1", { AC_DBCODE: 1, NAME: "ADD: CHEQUE ISSUED BUT NOT PRESENTED FOR PAYMENT", DR_CR: "", ORDERING_COL1: 2, ORDERING_COL2: 1 });
  for (const row of added.rows) table.rows.push({ ...Object.fromEntries(table.columns.map((column) => [column, null])), ...row });
  make("T1", { AC_DBCODE: 1, NAME: "* TOTAL ADD", INNER_AMT: addedTotal, OUTER_AMT: Math.abs(bank + addedTotal), DR_CR: sign(bank + addedTotal) ?? "", ORDERING_COL1: 4, ORDERING_COL2: 1 });
  make("H2", { AC_DBCODE: 2, NAME: "LESS: CHEQUE DEPOSITED BUT NOT CLEARED", DR_CR: "", ORDERING_COL1: 5, ORDERING_COL2: 1 });
  for (const row of less.rows) table.rows.push({ ...Object.fromEntries(table.columns.map((column) => [column, null])), ...row });
  make("T2", { AC_DBCODE: 1, NAME: "** TOTAL LESS", INNER_AMT: lessTotal, DR_CR: "", ORDERING_COL1: 7, ORDERING_COL2: 1 });
  const passBook = Math.round((bank + addedTotal - lessTotal) * 100) / 100;
  make("T0", { NAME: "*** BALANCE AS PER PASS BOOK", OUTER_AMT: Math.abs(passBook), DR_CR: sign(passBook) ?? "", ORDERING_COL1: 8, ORDERING_COL2: 1 });
  sortRows(table, [(row) => numberKey(table.get(row, "ORDERING_COL1")), (row) => numberKey(table.get(row, "ORDERING_COL2"))]);
  return table;
}

// ======================================================================================
// 14: FORM SUMMARY (SP_STD_RPT_FORM_SUMM and SP_FOMSUMM_COLS, called at line 8548)
// ======================================================================================
//
// The register's vouchers (the sale, purchase or expense book chosen, with its cash and return
// books) broken up by tax slab and tax: net, tax and final amounts of each slab line, with the
// cash memos and returns in their own columns when the book has them.
//
// The "Summary For Period Selected" and "Details (Summarized Taxes)" formats go through
// SP_REPORT_FORMATING (SP_FRT_RPT_FORM_SUMM): reportFormating.ts (formSummaryFormats).

async function formSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const book = call.fcValue;
  const against = call.againstBook;
  const combined = call.showNarration;
  const groupKeys = call.firstHelpKeys.filter((key) => /^\d+$/.test(key));
  if (groupKeys.length === 0) throw new ReportRefusal("Minimum One Account Should Be Selected To Generate Report", "No Selections Done!");
  const key5 = `,${groupKeys.join(",")},`;

  // The opposite book (returns) when a return account is ticked.
  const oppBook = key5.includes(",16") || key5.includes(",11") || key5.includes(",10")
    ? ([8, 9].includes(book) ? "16" : [13, 14].includes(book) ? "11" : book === 15 ? "10" : "") : "";
  const inBook = book === 8 ? "8,9" : book === 13 ? "13,14" : book === 15 ? "10,15" : [11, 16].includes(book) ? String(against) : `'${book}'`;

  // The tax slabs of the period for the book (TMP_SLAB).
  const slabBook = [11, 16].includes(book) ? String(against) : book === 10 ? "15" : String(book);
  const slabRows = (await runReportSql(loader, frag(`SELECT slab_key FROM ${db}SLAB_MASTER WHERE SLAB_ACTIVE = 'Y' AND SLAB_MASTER = 'Y' AND BOOK = ${slabBook} and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' and SLAB_UPTODT = '${desktopDate(call.tarikh2)}' ORDER BY SLAB_ORDER`))).rows;
  if (slabRows.length === 0) throw new ReportRefusal("No tax slab is set for this book and year (Internal program failure).", "Internal program failure");
  const slabKey = slabRows.map((row) => `'${num(row.slab_key)}'`).join(",");
  const lastPlace = num((await runReportSql(loader, `SELECT MAX(IDOPT_KEY) AS m FROM ${db}IDOPT_MASTER WHERE IDOPT_FLAG = 'TP'`)).rows[0]?.m);

  // SP_FOMSUMM_COLS: the amount columns.
  const opp = oppBook;
  const signed = (column: string) => (opp !== "" ? `(CASE WHEN LED.BOOK = ${opp} THEN (LEDEXT.${column} * -1) ELSE LEDEXT.${column} END)` : `LEDEXT.${column}`);
  const net = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN (${signed("S_LASTOT")} - ${signed("SLAB_AMT")}) ELSE ${signed("SLAB_AMT")} END)`;
  const tax = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN ${signed("SLAB_AMT")} ELSE 0.00 END)`;
  const fin = `(CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) THEN ${signed("S_LASTOT")} ELSE ${signed("SLAB_AMT")} END)`;
  const forBooks = (books: string) => (column: string) => `CASE WHEN LED.BOOK ${books} THEN ${column} ELSE 0.00 END`;
  const bookOnly = forBooks(`= ${book}`);
  const cashBooks = book === 8 ? "IN (9,11)" : book === 13 ? "IN (14,16)" : book === 15 ? "IN (10)" : "";
  const returnBook = [8, 9].includes(book) ? "16" : [13, 14].includes(book) ? "11" : book === 15 ? "10" : "";
  const columns = {
    bnet: combined ? "" : bookOnly(net), btax: combined ? "" : bookOnly(tax),
    cnnet: combined || cashBooks === "" ? "" : forBooks(cashBooks)(net), cntax: combined || cashBooks === "" ? "" : forBooks(cashBooks)(tax),
    rnet: combined || opp === "" || returnBook === "" ? "" : forBooks(`= ${returnBook}`)(net), rtax: combined || opp === "" || returnBook === "" ? "" : forBooks(`= ${returnBook}`)(tax),
    totnet: net, tottax: tax, totfin: fin,
  };
  let select = call.queryStart.split("|sys.tax.skey|").join(slabKey).split("|sys.aftertax.place|").join(lastPlace !== 0 ? String(lastPlace + 1) : "101");
  const fill = (token: string, expression: string, alias: string) => { select = select.split(token).join(expression !== "" ? `${expression} AS "${alias}" ,` : ""); };
  fill("sys.col.bnet,", columns.bnet, "B_NET"); fill("sys.col.btax,", columns.btax, "B_TAX"); fill("sys.col.cnnet,", columns.cnnet, "CN_NET"); fill("sys.col.cntax,", columns.cntax, "CN_TAX");
  fill("sys.col.rnet,", columns.rnet, "R_NET"); fill("sys.col.rtax,", columns.rtax, "R_TAX"); fill("sys.col.totnet,", columns.totnet, "TOT_NET"); fill("sys.col.tottax,", columns.tottax, "TOT_TAX"); fill("sys.col.totfin,", columns.totfin, "TOT_FIN");

  // The where: the ticked accounts, the books, the slab lines, the dates.
  let where = call.where;
  const keys = groupKeys.join(",");
  // A credit / debit note register reads its notes by the book they are against (AG_BOOK); the procedure tests the typed account codes for 11 and 16, which are book numbers only in its own database.
  if ((check("CHK_CRCASCOM") && (key5.includes(",16") || key5.includes(",11"))) || [11, 16].includes(call.fcValue)) where += ` AND (LED.BOOK_CODE IN (${keys}) OR LED.AG_BKCODE IN (${keys})) AND (LED.BOOK IN (${inBook}) OR LED.AG_BOOK IN (${inBook}))`;
  else where += ` AND (LED.BOOK_CODE IN (${keys})) AND (LED.BOOK IN (${inBook}))`;
  where += ` AND ((CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) AND TAX.TAX_DESC IS NULL THEN 'sys.remove' ELSE TAX.TAX_DESC END) <> 'sys.remove' OR LEDEXT.SLAB_ID not in (${slabKey}))`;
  where += ` AND SLAB.SLAB_ORDER >= (SELECT SM.SLAB_ORDER FROM ${db}SLAB_MASTER SM WHERE SM.SLAB_KEY in (${slabKey}) LIMIT 1)`;
  where += ` AND LED.DOC_DATE BETWEEN '${desktopDate(call.from)}' AND '${desktopDate(call.upto)}'`;
  const orderBy = "SLAB.SLAB_ORDER,TAX_PLACE,LED.DOC_DATE,LED.DOC_NO,IDOPT.OPT_DESC,TAX_SHORT,TAX.TAX_DESC,AC.NAME";

  // TAX_MASTER.TAX_TYPE is text in this schema: the join to IDOPT_MASTER needs it as a number.
  const from = call.from_.split("TAX.TAX_TYPE").join("nullif(TAX.TAX_TYPE,'')::int");
  const result = await runReportSql(loader, frag(`SELECT IDOP.OPT_DESC,${select} ${from} ${where} ORDER BY ${orderBy}`));
  const table = tableFromResult(result);
  for (const column of ["B_NET", "B_TAX", "CN_NET", "CN_TAX", "R_NET", "R_TAX", "TOT_NET", "TOT_TAX", "TOT_FIN"]) if (table.has(column)) table.setKind(column, "decimal");
  // SGST / UTGST lines carry their tax only.
  for (const row of table.rows) {
    const place = toText(table.get(row, "OPT_DESC")).toUpperCase();
    if (place !== "SGST" && place !== "UTGST") continue;
    if (!check("CHK_CRCASCOM") && table.has("CN_NET")) for (const column of ["B_NET", "CN_NET", "R_NET"]) if (table.has(column)) table.set(row, column, 0);
    table.set(row, "TOT_NET", 0);
    table.set(row, "TOT_FIN", table.get(row, "TOT_TAX"));
  }
  sortRows(table, [(row) => textKey(table.get(row, "TAX_PLACE_DESC")), (row) => textKey(table.get(row, "SORTING_DATE"))]);
  return table;
}

// ======================================================================================
// 7: ACCOUNT MASTER (SP_STD_RPT_ACC_MASTER, called at line 8504)
// ======================================================================================
//
// The accounts of the chosen ledger (all, General, Debtors, Creditors) with the setup's columns
// and the ticked addon fields; locked parties (a start or last date) only when asked, or left out
// unless "With Locked" is ticked.

async function accountMaster(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const selectedBook = call.fcValue;
  const onlyLocked = call.jvDetailsRequired;
  let where = call.where;
  if (selectedBook !== -1) where += selectedBook === 1 ? " AND AC.BOOK NOT IN (2,3)" : ` AND AC.BOOK IN (${selectedBook})`;
  if (onlyLocked) where += " AND (AC.A_STARTDATE IS NOT NULL OR AC.A_LASTDATE IS NOT NULL)";
  if (!check("CHK_WITHLCKED") && !onlyLocked) where += " and AC.A_LASTDATE IS NULL";
  where = where.split("|sys.yearid|").join(call.yearId);
  const addons = call.headingAddon.filter((text) => text.trim() !== "");
  // With the Account group alone the setup leaves the sorting column without its group (", || '   P'"): the account's name.
  let select = call.queryStart.replace(/,\s*\|\|\s*' {3}P'/, ", ac.name || '   P'");
  for (const text of addons) select += `,${text}`;
  if (check("CHK_IMAGE")) select += ',ac.IMAGE_FILE_NAME as "IMAGE"';
  let orderBy = call.orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").trim();
  if (orderBy !== "") { if (!orderBy.toUpperCase().includes("NAME")) orderBy += ",AC.NAME"; } else orderBy = "AC.NAME";
  const sql = pgFragment(`SELECT ${select} ${call.from_} ${where} ORDER BY ${orderBy}`, plan, session.companySchema);
  return tableFromResult(await runReportSql(loader, sql));
}

// ======================================================================================
// 10: PRODUCT MASTER (SP_STD_RPT_PROD_MASTER)
// ======================================================================================
//
// INVENTORY > Master > Product: the products with the year's opening (PROD_BALANCE, 'RP') in the
// first and second report units, the opening and report rates and values, and the group. After the
// setup's columns come the product's master addon fields (ADDON_FLD, relate 'P', master position
// 'Y', not an entry field), by their caption, each as its caption. "Only Lock Products" keeps the
// products with a start or last date; "Image Required" adds the product's image. The procedure's
// GROUP BY (only when the Group alone is ticked) is left out: it groups none of the other columns,
// so SQL Server refuses it as well; the grid groups the rows.

async function productMaster(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const addons = (await runReportSql(loader, `SELECT btrim(fiel_save) AS save, fiel_type AS kind, btrim(fiel_desc) AS caption FROM ${db}ADDON_FLD`
    + ` WHERE fiel_pos <> 'D' AND fiel_entrypos = 'N' AND fiel_relate = 'P' AND fiel_masterpos = 'Y' AND (fiel_uptodt IS NULL OR fiel_uptodt < $1) AND (fiel_fromdt IS NULL OR fiel_fromdt > $2) ORDER BY fiel_desc`,
  [call.tarikh1, call.tarikh2])).rows;
  // With no addon group ticked the setup leaves the sorting column without its group (", || '   P'"): the product's code.
  let select = call.queryStart.replace(/,\s*\|\|\s*' {3}P'/, ", product.PROD_SHORT || '   P'");
  for (const addon of addons) select += `,${toText(addon.kind) === "I" ? "ADATA.INPUT_" : "ADATA.TXT_"}${toText(addon.save)} AS "${toText(addon.caption).replace(/"/g, "")}"`;
  if (check("CHK_IMAGE")) select += ',prodimg.IMAGE_FILE_NAME as "IMAGE"';
  let where = call.where.split("|sys.yearid|").join(call.yearId);
  if (call.jvDetailsRequired) where += " AND ((product.START_DATE IS NOT NULL) OR (product.LAST_DATE IS NOT NULL))";
  let orderBy = call.orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").trim();
  if (orderBy.toLowerCase() === "idopt.opt_desc") orderBy += ",product.PROD_SHORT";
  if (orderBy === "") orderBy = "product.PROD_SHORT";
  const sql = pgFragment(`SELECT ${select} ${call.from_} ${where} ORDER BY ${orderBy}`, plan, session.companySchema);
  return tableFromResult(await runReportSql(loader, sql));
}

// ======================================================================================
// 9: PARTY WISE RATE (SP_STD_RPT_PWISERATE)
// ======================================================================================
//
// INVENTORY > Master > Party Wise Rate: the special rates (PARTY_RATE) of each party and product, of the side chosen in the first
// combo (ADD: purchase, LESS: sale; PR_ADDLESS A / L). Input Columns picks what the lines hold: RATE (PR_INPUTCOL 'R', with the
// rate's unit), or a slab: a tax slab (slab_master Y: 'T', with the tax) or a percentage slab ('P'). Kept are the lines still open
// (no Upto date) and those whose Upto is on or before the From date, as the procedure has it. Sorting Party: party, date (newest
// first), product; Product: date, product.

async function partyRate(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const slabs = call.slabsKey === "" ? "-1" : call.slabsKey;
  if (!/^-?\d+(,-?\d+)*$/.test(slabs)) throw new ReportRefusal("Choose an Input Column from its list", "Report Generation Failed");
  let kind = "R";
  if (slabs !== "-1") {
    const row = (await runReportSql(loader, `SELECT CASE slab_master WHEN 'Y' THEN 'T' ELSE 'P' END AS kind FROM ${db}SLAB_MASTER WHERE slab_key IN (${slabs})`)).rows.at(-1);
    if (!row) throw new ReportRefusal("Error No : 189.1\nInternal Program Failure\nSlab Master BLANK IN SP", "Report Generation Failed");
    kind = toText(row.kind);
  }
  const side = call.fcText.trim().toUpperCase().slice(0, 1);
  if (side === "") throw new ReportRefusal("Error No : 189.2\nInternal Program Failure\nFirst Combo Text BLANK IN SP", "Report Generation Failed");

  // The rate's unit (RATE) or the tax (a tax slab) is added to the setup's columns, with its table.
  let select = call.queryStart.replace(/,\s*\|\|\s*' {3}P'/, ", ac.name || '   P'");
  let from = call.from_.trim().replace(/^from\s+/i, "");
  if (kind === "R") {
    select += ",puom.UOM_SHORT";
    from = `(${from} INNER JOIN ${db}PROD_UOM puom on prate.PR_RUOM = puom.UOM_KEY)`;
  } else if (kind === "T") {
    select += ",tax.TAX_DESC";
    from = `(${from} INNER JOIN ${db}TAX_MASTER tax on prate.pr_slabtaxid = tax.TAX_REC)`;
  }

  const where = `${call.where.split("|sys.yearid|").join(call.yearId)} and prate.PR_INPUTCOL = '${kind}' and prate.PR_ADDLESS = '${side.replace(/'/g, "")}'`
    + ` AND (prate.PR_WEUPTO <= '${desktopDate(call.from)}' OR prate.PR_WEUPTO is null)`;
  let orderBy = call.orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").trim().replace(/^,|,$/g, "");
  orderBy = orderBy.split("|sys.party|").join("ac.NAME,prate.PR_WEFROM desc,product.PROD_DESC").split("|sys.product|").join("prate.PR_WEFROM desc,product.PROD_DESC");
  if (orderBy === "") orderBy = "ac.NAME,prate.PR_WEFROM desc,product.PROD_DESC";
  const table = tableFromResult(await runReportSql(loader, frag(`SELECT ${select} FROM ${from} ${where} ORDER BY ${orderBy}`)));
  // The hidden keys (addon sub, party, product, a group's code) are not figures: as numbers the grid would take the first as its first figure
  // column and put an empty PARTICULARS column before it.
  for (const column of ["PR_AONSUB", "CODE", "PR_PRODID", "PROD_KEY", "SMART_AC_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE"]) { const name = table.name(column); if (name !== undefined) table.numberKinds.delete(name); }
  return table;
}

// ======================================================================================
// 13: PRICE LIST (SP_STD_RPT_PRICELST)
// ======================================================================================
//
// INVENTORY > Master > Price List: each product's price list lines (sale, purchase and MRP rates with
// their units, the W.E.F. date), newest date first, lines with no date or no rate left out. The first
// combo is a W.E.F. range ("01/04/2025 TO 31/03/2026", "FROM 01/04/2025") or ALL: a range keeps the
// lines of exactly that range. A filter other than All works on the ticked rate columns (Input
// Columns) and ignores the range: Last Rate / First Rate keep each product's lines of the latest /
// earliest date with that rate above zero, Highest / Lowest Rate the lines with the product's highest /
// lowest rate, Zero Rate Only the lines whose rate is zero. With an addon group the addon's values are
// heading rows (ROW_DATA_TYPE 'AC') sorted in among the lines.

const PRICE_FILTERS = ["lrate", "frate", "hirate", "lorate", "zrate"] as const;

async function priceList(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  let where = call.where.split("|sys.yearid|").join(call.yearId);

  if (!/sys\.sp_filter/i.test(where)) {
    // The W.E.F. range of the first combo.
    if (call.fcText.toUpperCase() !== "ALL") {
      const caption = `(CASE WHEN PL_WEFROM IS NOT NULL AND PL_WEUPTO IS NOT NULL THEN TO_CHAR(PL_WEFROM, 'DD/MM/YYYY') || ' TO ' || TO_CHAR(PL_WEUPTO, 'DD/MM/YYYY') WHEN PL_WEFROM IS NOT NULL THEN 'FROM ' || TO_CHAR(PL_WEFROM, 'DD/MM/YYYY') WHEN PL_WEUPTO IS NOT NULL THEN 'UPTO ' || TO_CHAR(PL_WEUPTO, 'DD/MM/YYYY') ELSE 'NONE' END)`;
      const range = (await runReportSql(loader, `SELECT DISTINCT to_char(PL_WEFROM, 'YYYY-MM-DD') AS wefrom, to_char(PL_WEUPTO, 'YYYY-MM-DD') AS weupto FROM ${db}PRICELIST WHERE PL_POS <> 'D' AND ${caption} = $1`, [call.fcText])).rows.at(-1);
      if (range?.wefrom) where += ` AND price.PL_WEFROM = '${toText(range.wefrom)}'`;
      if (range?.weupto) where += ` AND price.PL_WEUPTO = '${toText(range.weupto)}'`;
    }
  } else {
    // The filter, over each ticked rate column (the units and the group are not rates).
    const columns = call.slabsKey.split(",").map((column) => column.trim()).filter((column) => column !== "" && !["SALE_UOM", "PUR_UOM", "MRP_UOM", "OPT_DESC"].includes(column.toUpperCase()));
    if (columns.length === 0) throw new ReportRefusal("Error no : 11\nPlease provide atleast one rate column for CURRENT FILTER", "Report Generation Failed");
    if (columns.some((column) => !/^\w+$/.test(column))) throw new ReportRefusal("The rate columns ticked are not known.", "Report Generation Failed");
    const filter = PRICE_FILTERS.find((name) => where.toLowerCase().includes(`|sys.sp_filter_${name}|`))!;
    const token = new RegExp(`\\|sys\\.sp_filter_${filter}\\|`, "i");
    // The procedure's "price.PL_KEY IN (SELECT PL_KEY <the same from and where> AND <test>)" is the line itself passing the test (PL_KEY is
    // the line's own key), and its test looks the product's latest / earliest date or highest / lowest rate up again for every line. Here
    // the lines passing the test are found first, from PRICELIST alone, and the report keeps those keys: the same lines in well under a
    // second (as one query, with the ticked products' long key list, it took 6 to 12 seconds).
    let parts: string[];
    if (filter === "zrate") parts = columns.map((column) => `price.${column} = 0`);
    else {
      const keys = new Set<string>();
      for (const column of columns) {
        const [aggregate, matched, condition] = filter === "lrate" ? ["MAX(PL.PL_WEFROM)", "PL_WEFROM", ` WHERE PL.${column} > 0`]
          : filter === "frate" ? ["MIN(PL.PL_WEFROM)", "PL_WEFROM", ` WHERE PL.${column} > 0`]
          : filter === "hirate" ? [`MAX(PL.${column})`, column, ""]
          : [`MIN(PL.${column})`, column, ""];
        const rows = (await runReportSql(loader, `SELECT price.PL_KEY AS key FROM ${db}PRICELIST price WHERE (price.PROD_ID, price.${matched}) IN (SELECT PL.PROD_ID, ${aggregate} FROM ${db}PRICELIST PL${condition} GROUP BY PL.PROD_ID)`)).rows;
        for (const row of rows) keys.add(String(num(row.key)));
      }
      parts = [keys.size > 0 ? `price.PL_KEY IN (${[...keys].join(",")})` : "1 = 0"];
    }
    where = where.replace(token, `(${parts.join(" OR ")})`);
  }

  let orderBy = call.orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").trim();
  if (call.licence === 9) orderBy = orderBy.split("product.PROD_SHORT").join("case when product.prod_group=81 then right(repeat(' ', 5)||product.DESC_1,5) else product.PROD_DESC end");
  // With no addon group ticked the setup leaves the sorting column without its group (", || '   P'"): the product's code.
  const select = call.queryStart.replace(/,\s*\|\|\s*' {3}P'/, ", product.PROD_SHORT || '   P'");
  const sql = `SELECT ${select} ${call.from_} ${where} and price.PL_WEFROM is not null and (coalesce(price.PL_SRATE,0)>0 or coalesce(price.PL_PRATE,0)>0 or coalesce(price.PL_MRP,0)>0)`
    + ` ORDER BY ${orderBy !== "" ? `${orderBy},` : ""}price.PL_WEFROM desc`;
  const table = tableFromResult(await runReportSql(loader, frag(sql)));
  // The hidden keys (the line's, the product's, an addon's) are not figures: as numbers the grid would take the first as its first figure column and put an empty PARTICULARS column before it.
  for (const column of ["PL_KEY", "PROD_KEY", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE"]) { const name = table.name(column); if (name !== undefined) table.numberKinds.delete(name); }
  // The MRP's unit goes with the MRP (the setup's MRP Rate item names PL_MRP alone).
  if (!call.slabsKey.split(",").includes("PL_MRP") && !plan.hidden.includes("MRP_UOM")) plan.hidden.push("MRP_UOM");

  // The addon groups' heading rows: each value of the addon (addon_sub) the lines carry.
  const ticked = call.selectKey.slice(0, 4).map((keys) => keys !== "");
  if (ticked.some(Boolean)) {
    for (const column of ["SORTING_COL", "PROD_DESC", "ROW_DATA_TYPE", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4"]) if (!table.has(column)) table.addColumn(column);
    const lines = [...table.rows];
    for (let level = 0; level < 4; level += 1) {
      const codeColumn = `ADDON_${level + 1}_CODE`;
      if (!ticked[level] || !table.has(codeColumn)) continue;
      const codes = [...new Set(lines.map((row) => toText(table.get(row, codeColumn))).filter((code) => code !== ""))];
      if (codes.length === 0) continue;
      const names = new Map((await runReportSql(loader, `SELECT sub_code::text AS code, sub_name AS name FROM ${db}addon_sub WHERE sub_code::text = ANY($1)`, [codes])).rows.map((row) => [toText(row.code), toText(row.name)]));
      const headings = new Map<string, string>();
      for (const row of lines) {
        const name = names.get(toText(table.get(row, codeColumn)));
        if (name === undefined) continue;
        const before = Array.from({ length: level }, (_, index) => toText(table.get(row, `SMART_SELECTED_ADDON${index + 1}`)));
        headings.set([...before, name].join(" "), name);
      }
      for (const [sorting, name] of headings) table.insert({ SORTING_COL: sorting, PROD_DESC: name, ROW_DATA_TYPE: "AC", [`SMART_SELECTED_ADDON${level + 1}`]: name });
    }
    if (ticked[0]) sortRows(table, [(row) => textKey(table.get(row, "SORTING_COL"))]);
  }
  return table;
}

// ======================================================================================
// 17: STOCK (SP_STD_RPT_STOCK, called at line 8570) - first slice
// ======================================================================================
//
// First combo LEDGER: each ticked product with its opening, its stock movements between From and
// Upto (added, less, running closing) and the closing; SUMMARY: one line per product (opening,
// added, less, closing). Quantities are in the product's first report unit (REP1_UOM), as the
// procedure takes them: an issue or receipt is its quantity less what was set against another
// entry (AG_QTY), except job work in / out.
//
// Not ported (the procedure is 8,439 lines of stock valuation and licence branches): the valuation
// by Actual, Average Rate / Value / C.Year, Last Purchase and Last Sale and MRP, the update of the
// master (CHK_UPD_MASTER, CHK_UPD_RATE), godown and batch / expiry reports, Folder and Challan-date
// options, ageing columns, factor columns and the Above / Below Days sorting.

async function stockReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const summary = call.fcText.toUpperCase() === "SUMMARY" || call.fcValue === 2;
  const filter = call.filterText.toUpperCase();
  const notPorted = (what: string) => new ReportRefusal(`${what} of the Stock report is not available in the web version yet.`, "Not ported yet");
  // Options that only the Summary allows (the procedure's own messages).
  if (!summary) {
    for (const [option, message] of [["CHK_MINMAX_COL", "Min - Max Qty Column Only In Summary Report Allowed"], ["CHK_UPD_MASTER", "Select Update Rate In Master Only Summary Option Allowed"], ["CHK_FG_VALADD", "Select Closing Stock FG With Additional Value Required Only Summary Option Allowed"],
      ["CHK_UPD_RATE", "Select Update Rate In Master To Trf. As Open Rate In Next Year Only Summary Option Allowed"], ["CHK_GST_OPEN", "Select Update Rate as Before GST Only Summary Option Allowed"]] as const) {
      if (check(option)) throw new ReportRefusal(message, "Report Generation Failed");
    }
  }
  if (filter === "AVERAGE VALUE") throw notPorted("The Average Value valuation (the procedure compares the closing quantity with a variable that is empty in this run and keeps a running count across products, so its figures are not reproducible)");
  if (!["NONE", "REPORT RATE", "", ...VALUATIONS].includes(filter)) throw notPorted(`The "${call.filterText}" valuation`);
  for (const [option, caption] of [["CHK_UPD_MASTER", "Update Value In Master"], ["CHK_UPD_RATE", "Update Rate In Master"], ["CHK_CHLNCOL", "Challan date"], ["CHK_FG_VALADD", "FG value add"], ["CHK_EXP", "Valuation with expense"]] as const) {
    if (check(option)) throw notPorted(`The ${caption} option`);
  }
  if (check("CHK_AGECOL") && !summary) throw notPorted("The Age columns option of the Ledger first combo (it is in the Summary)");
  // Above Days / Below Days (Ledger): the additions older (or newer) than the typed number of days are taken out; the issues have no days. The balances still run over every line.
  const daysLimit = call.text[0] !== undefined && call.text[0].trim() !== "" ? Number(call.text[0]) : null;
  const sorting = call.sortingText.toUpperCase();
  const daysFilter = !summary && daysLimit !== null && Number.isFinite(daysLimit) && (sorting === "ABOVE DAYS" || sorting === "BELOW DAYS") ? sorting : "";
  if (call.sortingText !== "" && sorting !== "NONE" && daysFilter === "" && !["ABOVE DAYS", "BELOW DAYS"].includes(sorting)) throw notPorted(`The "${call.sortingText}" sorting`);
  if (call.addon.some((text) => text.toUpperCase().includes("GODOWN")) || call.selectBookKey !== "") throw notPorted("The Godown and Batch / Expiry selections");

  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);
  const yearStart = desktopDate(call.tarikh1);
  const dayBeforeFrom = desktopDate(dayBefore(call.from));
  const between = call.from.getTime() !== call.tarikh1.getTime();
  const typeKey = num((await runReportSql(loader, `SELECT BOOK_KEY FROM ${db}BOOK_PROPERTIES WHERE STKM_POS = 'A' AND STKM_ID = 'NR' ORDER BY STKMODULE LIMIT 1`)).rows[0]?.book_key);

  /** The movement of a stock line in the product's first report unit (receipts and issues of job work count whole). */
  // `share`: the Summary's opening before From takes, for the other units than pieces, the entry's part of the quantity (the unit amount less AG_QTY / QUANTITY of it).
  const qtyOf = (l: string, p: string, whole: string, share = false) => {
    const units: [string, string][] = [["QTY1_UOM", "TRN_QTY1"], ["QTY2_UOM", "TRN_QTY2"], ["QTY3_UOM", "TRN_QTY3"], ["PACK_UOM", "TRN_PACK"], ["WEIGHT_UOM", "TRN_WEIGHT"]];
    const rest = (column: string) => (share ? `${l}.${column}-round((${l}.AG_QTY/nullif(${l}.QUANTITY,0)*${l}.${column}),4)` : `${l}.${column}-${l}.AG_QTY`);
    return `(case when ${p}.REP1_UOM=${p}.PCS_UOM then (case when ${l}.TRN_MODULE='${whole}' then ${l}.TRN_PCS else ${l}.TRN_PCS-${l}.AG_QTY end)`
      + units.map(([uom, column]) => ` when ${p}.REP1_UOM=${p}.${uom} then (case when ${l}.TRN_MODULE='${whole}' then ${l}.${column} else ${rest(column)} end)`).join("")
      + ` else ${l}.TRN_PCS-${l}.AG_QTY end)`;
  };
  // The licence and option filters of the procedure's line query (and of the opening before From): licence 22 leaves out the stock vouchers; with some licences and no
  // cash book entry account (19, 29, 68, 73) only the books of the active accounts count; Folder takes only the process lines of the folder products; licences 5, 7, 16 and 22 leave the process lines out.
  const hideBook = [19, 29, 68, 73].includes(call.licence)
    && num((await runReportSql(loader, frag(`SELECT COUNT(*) AS n FROM ${db}ACCOUNT WHERE A_POS <> 'D' AND POSITION('CA_ENT' IN A_SHORT) > 0`))).rows[0]?.n) === 0;
  const folder = check("CHK_FOLDER");
  const noProcess = [5, 7, 16, 22].includes(call.licence);
  const lineWhere = (l: string, opening = false) => `${l}."TYPE" <> ${typeKey} AND ${l}.INVENTORY='Y' AND ${l}.IL_POS='A'`
    + (folder ? ` AND (${l}.TRN_MODULE='PROC-OUT' or ${l}.TRN_MODULE='PROC-IN')` : noProcess ? ` AND ${l}.TRN_MODULE<>'PROC-OUT' AND ${l}.TRN_MODULE<>'PROC-IN'` : "")
    + (call.licence === 22 ? ` AND ${l}.TRN_MODULE <> 'SVOU-ADD' AND ${l}.TRN_MODULE <> 'SVOU-LESS' AND ${l}.TRN_MODULE <> 'STK-JV'` : "")
    + (call.licence === 17 && !opening ? ` AND ${l}.TRN_MODULE = ''` : "")
    + (hideBook ? ` AND (${l}.BOOK_CODE IN (SELECT code FROM ${db}ACCOUNT WHERE a_pos='A')${opening ? "" : ` OR ${l}.BOOK_CODE IS NULL`})` : "")
    + ` AND (${l}.QUANTITY-${l}.AG_QTY>0 or ${l}.TRN_MODULE='JOB-OUT' or ${l}.TRN_MODULE='JOB-IN') AND ${l}.QUANTITY>0`;
  // Similar Products: the ticked products' parents, and every product under those parents.
  let productFilter = call.where.split("|sys.yearid|").join(call.yearId);
  if (check("CHK_PRODSIMILIAR") && call.selectKey[4] !== "") {
    const parents = (await runReportSql(loader, `SELECT DISTINCT PARENT_PROD_ID AS "p" FROM ${db}PROD_SUBSITUDE WHERE SUB_PROD_ID IN ${call.selectKey[4]}`)).rows.map((row) => num(row.p));
    if (parents.length > 0) {
      const similar = (await runReportSql(loader, `SELECT DISTINCT SUB_PROD_ID AS "p" FROM ${db}PROD_SUBSITUDE WHERE PARENT_PROD_ID = ANY($1::int[])`, [parents])).rows.map((row) => num(row.p));
      const escaped = call.selectKey[4].replace(/[()]/g, "\\$&");
      const pattern = new RegExp(`PROD_KEY\\s+in\\s*${escaped}`, "i");
      productFilter = pattern.test(productFilter) ? productFilter.replace(pattern, `PROD_KEY IN (${similar.join(",")})`) : `${productFilter} and PRODUCT.PROD_KEY IN (${similar.join(",")})`;
    }
  }

  // The products: first-unit opening (the year's opening plus what moved before From).
  const openingCase = (column: string) => `product.rep1_uom=product.${column}_uom`;
  // What moved between the year's start and the day before From, for all the products in one query (a subquery for each product timed out with many products).
  const movedBefore = new Map<number, number>();
  if (between) {
    for (const row of (await runReportSql(loader, frag(`SELECT pl.PROD_ID AS "pid", (SUM(CASE pl.STOCK_NAT WHEN 'A' THEN ${qtyOf("pl", "p1", "JOB-IN", summary)} ELSE 0 END) - SUM(CASE pl.STOCK_NAT WHEN 'L' THEN ${qtyOf("pl", "p1", "JOB-OUT", summary)} ELSE 0 END))::numeric AS "moved"`
      + ` FROM ${db}PROD_LEDGER pl join ${db}PRODUCT_MASTER p1 on p1.PROD_KEY = pl.PROD_ID WHERE ${lineWhere("pl", true)} AND pl.IL_DATE BETWEEN '${yearStart}' AND '${dayBeforeFrom}' GROUP BY pl.PROD_ID`))).rows) movedBefore.set(num(row.pid), num(row.moved));
  }
  // The ticked addon groups (the Summary groups and sorts on them): the value of each (SMART_SELECTED_ADDONn) and its heading column.
  const addonAlias = (text: string) => /as\s+"([^"]+)"/i.exec(text)?.[1] ?? "";
  const addonLevels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "" && call.headingAddon[at].trim() !== "" && !/godown/i.test(call.addon[at]));
  const addonSelect = addonLevels.map((at) => `, ${call.selectedAddon[at].trim() !== "" ? call.selectedAddon[at].trim() : `${call.addon[at].trim()} as "SMART_SELECTED_ADDON${at + 1}"`}, ${call.headingAddon[at].trim()}`).join("");
  const headingAliases = addonLevels.map((at) => addonAlias(call.headingAddon[at])).filter((alias) => alias !== "");
  const products = (await runReportSql(loader, frag(`SELECT product.PROD_KEY AS "prod_key"${addonSelect}, product.PROD_SHORT AS "prod_short", product.hsn_code AS "hsn_code", product.bar_code AS "bar_code", product.prod_message AS "prod_message", product.min_qty::numeric AS "min_qty", product.max_qty::numeric AS "max_qty", (SELECT mu.UOM_SHORT FROM ${db}PROD_UOM mu WHERE mu.UOM_KEY = product.minuom_id) AS "min_uom", (SELECT xu.UOM_SHORT FROM ${db}PROD_UOM xu WHERE xu.UOM_KEY = product.maxuom_id) AS "max_uom",`
    + ` case when LEVEL.DIV_MAXLVL=LEVEL.STOCK_LEVEL then PRODUCT.PROD_DESC when LEVEL.STOCK_LEVEL=1 then PRODUCT.DESC_1 when LEVEL.STOCK_LEVEL=2 then PRODUCT.DESC_1 || ' ' || PRODUCT.DESC_2 when LEVEL.STOCK_LEVEL=3 then PRODUCT.DESC_1 || ' ' || PRODUCT.DESC_2 || ' ' || PRODUCT.DESC_3 when LEVEL.STOCK_LEVEL=4 then PRODUCT.DESC_1 || ' ' || PRODUCT.DESC_2 || ' ' || PRODUCT.DESC_3 || ' ' || PRODUCT.DESC_4 else ' ' end AS "prod_desc",`
    + ` (SELECT PUOM.UOM_SHORT FROM ${db}PROD_UOM PUOM WHERE PUOM.UOM_KEY = PRODUCT.REP1_UOM) AS "uom1", prodbal.rep_rate::numeric AS "rep_rate",`
    + ` (case when ${openingCase("pcs")} then prodbal.OPEN_PCS when ${openingCase("qty1")} then prodbal.open_qty1 when ${openingCase("qty2")} then prodbal.open_qty2 when ${openingCase("qty3")} then prodbal.open_qty3 when ${openingCase("pack")} then prodbal.open_pack when ${openingCase("weight")} then prodbal.open_weight else prodbal.OPEN_PCS end) AS "opening"`
    + ` FROM ${db}PRODUCT_MASTER PRODUCT left join ${db}LEVEL_MASTER LEVEL on PRODUCT.PROD_GROUP = LEVEL.PROD_GROUP left join ${db}addon_data adata on PRODUCT.PROD_KEY = adata.PROD_ID left join ${db}prod_balance prodbal on prodbal.PROD_ID = PRODUCT.PROD_KEY ${productFilter} AND prodbal.prec_flag='RP'${folder ? " AND PRODUCT.PROD_GROUP=27" : noProcess ? " AND PRODUCT.PROD_GROUP<>27" : ""} ORDER BY PRODUCT.PROD_SHORT`))).rows
    .map((row) => ({ raw: row, key: num(row.prod_key), short: toText(row.prod_short), desc: toText(row.prod_desc), uom: row.uom1 === null ? null : toText(row.uom1), rate: num(row.rep_rate), opening: decimalRound(num(row.opening) + (movedBefore.get(num(row.prod_key)) ?? 0), 4),
      hsn: row.hsn_code === null ? null : toText(row.hsn_code).trim(), barcode: row.bar_code === null ? null : toText(row.bar_code).trim(), message: row.prod_message === null ? null : toText(row.prod_message).trim(), min: row.min_qty === null || num(row.min_qty) === 0 ? null : num(row.min_qty), max: row.max_qty === null || num(row.max_qty) === 0 ? null : num(row.max_qty),
      minUom: row.min_uom === null ? null : toText(row.min_uom).trim(), maxUom: row.max_uom === null ? null : toText(row.max_uom).trim() }));
  const addonValue = (product: (typeof products)[number], at: number) => toText(product.raw[`SMART_SELECTED_ADDON${at + 1}`]);
  products.sort((a, b) => { for (const at of addonLevels) { const compare = sqlServerCompare(addonValue(a, at), addonValue(b, at)); if (compare !== 0) return compare; } return sqlServerCompare(a.short, b.short); });

  // The lines of the period.
  const fixCols = call.fixCols.replace(/,\s*\|\|\s*to_char\(prodled\.il_date/i, ",product.prod_short || to_char(prodled.il_date").replace(/,\s*$/, "");
  const start = call.queryStart.split("|SYS.FROMDT|").join(fromText);
  const lineSql = frag(`SELECT ${fixCols},${start}`
    + ` FROM ${db}PROD_LEDGER PRODLED right join ${db}PRODUCT_MASTER PRODUCT on PRODLED.PROD_ID = PRODUCT.PROD_KEY left join ${db}PROD_UOM PUOM on PUOM.UOM_KEY = PRODUCT.REP1_UOM left join ${db}PROD_UOM PUOM1 on PUOM1.UOM_KEY = PRODUCT.REP2_UOM`
    + ` left join ${db}ACCOUNT AC on PRODLED.CODE = AC.Code left join ${db}LEVEL_MASTER LEVEL on PRODUCT.PROD_GROUP = LEVEL.PROD_GROUP left join ${db}addon_data adata on PRODLED.PROD_ID = adata.PROD_ID left join ${db}LEDGER led on PRODLED.LED_ID = led.LED_KEY`
    + ` ${productFilter.split("prodbal").join("prodled")} AND ${lineWhere("PRODLED")} AND (PRODLED.IL_DATE BETWEEN '${fromText}' AND '${uptoText}') ORDER BY PRODUCT.PROD_SHORT, PRODLED.IL_DATE, PRODLED.STOCK_NAT, PRODLED.IL_KEY`);
  // The Summary needs only each product's totals: the server adds the lines up (a row for each product, not for each line), and the columns come from a query that returns nothing.
  const orderAt = lineSql.lastIndexOf(" ORDER BY PRODUCT.PROD_SHORT");
  const lineBody = lineSql.slice(0, orderAt);
  const lines = summary ? await runReportSql(loader, `${lineBody} LIMIT 0`) : await runReportSql(loader, lineSql);
  const totals = summary ? (await runReportSql(loader, (() => { const named = (wanted: string) => `t."${lines.fields.find((field) => field.name.toLowerCase() === wanted)?.name ?? wanted}"`; return `SELECT ${named("prod_key")} AS "pk", SUM(${named("add_qty")}) AS "a", SUM(${named("less_qty")}) AS "l" FROM (${lineBody}) t GROUP BY ${named("prod_key")}`; })())).rows : [];
  const table = tableFromFields(lines.fields);
  // TAX: the report heading of the entry's tax (not SGST), read from the ledger entry's extension by its ledger key, else by the second key the line carries.
  const taxOf = new Map<number, string>();
  {
    const ledKeys = summary ? [] : [...new Set(lines.rows.flatMap((row) => [num(row.SMART_LED_KEY), num(row.SYSTEM_BLANK2)]).filter((key) => key > 0))];
    if (ledKeys.length > 0) {
      for (const row of (await runReportSql(loader, frag(`SELECT DISTINCT ON (ledext.led_id) ledext.led_id AS "led_id", taxmst.TAX_REPOHD AS "code" FROM ${db}LEDGER_EXT ledext join ${db}TAX_MASTER taxmst on taxmst.tax_rec = ledext.tax_id join ${db}IDOPT_MASTER idopt on idopt.idopt_key::text = taxmst.tax_type::text`
        + ` WHERE ledext.led_id = ANY($1::int[]) and idopt.IDOPT_FLAG = 'TT' and idopt.opt_desc <> 'SGST' ORDER BY ledext.led_id, (idopt.opt_desc = 'CGST') DESC, ledext.ctid DESC`), [ledKeys])).rows) taxOf.set(num(row.led_id), toText(row.code));
    }
  }
  for (const column of ["ADD_QTY", "LESS_QTY", "CLSG_QTY", "ADD_FACT", "LESS_FACT", "BAL_FACT"]) table.setKind(column, "decimal");
  for (const column of ["NAME", "SORTING_COL", "SMART_SELECTED_PRODUCT", "ROW_DATA_TYPE", "PROD_SHORT", "SELECTED_PRODUCT", "FULL_DOCNO", "UOM1"]) table.addColumn(column);
  if (summary) table.setKind("OPENING", "decimal");
  if (summary) { for (const at of addonLevels) table.addColumn(`SMART_SELECTED_ADDON${at + 1}`); for (const alias of headingAliases) table.addColumn(alias); }
  else for (const at of addonLevels) table.addColumn(`SMART_SELECTED_ADDON${at + 1}`);
  // Ledger with addon groups: a heading row (ADDON_1 ..) where a group's value changes, and every row of the product carries the values of its groups so the subtotals follow them.
  const ledgerAddons = (product: (typeof products)[number]) => Object.fromEntries(addonLevels.map((at) => [`SMART_SELECTED_ADDON${at + 1}`, addonValue(product, at)]));
  let previousAddons: string[] = [];
  // The options that add a column (SYS.COL): HSN Code, Barcode, Product Warn Message, Min - Max Qty. Each reads the product master.
  const masterColumns: [string, string, (product: (typeof products)[number]) => unknown][] = [];
  if (check("CHK_HSNCODE")) masterColumns.push(["HSN_CODE", "text", (product) => product.hsn]);
  if (check("BARCODE")) masterColumns.push(["BARCODE", "text", (product) => product.barcode]);
  if (check("CHK_WARN_MESS")) masterColumns.push(["WARNING_MESSAGE", "text", (product) => product.message]);
  // Min Qty and its unit (NUOM), Max Qty and its unit (XUOM); the unit shows with a quantity. The Summary colours the cell when the closing is under the minimum or over the maximum (output.ts).
  if (check("CHK_MINMAX_COL")) masterColumns.push(["MIN_QTY", "decimal", (product) => product.min], ["NUOM", "text", (product) => (product.min === null ? null : product.minUom)], ["MAX_QTY", "decimal", (product) => product.max], ["XUOM", "text", (product) => (product.max === null ? null : product.maxUom)]);
  for (const [column, kind] of masterColumns) { table.addColumn(column); if (kind === "decimal") table.setKind(column, "decimal"); }
  const masterValues = (product: (typeof products)[number]) => Object.fromEntries(masterColumns.map(([column, , read]) => [column, read(product)]));
  const withRate = filter === "REPORT RATE" || VALUATIONS.includes(filter);
  if (withRate) { table.setKind("RATE", "decimal"); table.setKind("VALUE", "decimal"); }
  // Licence 21 Ledger: JOB CARD (the entry's job card, else the line's) and COLOUR from the entry addons.
  const jobCard = call.licence === 21 && !summary;
  if (jobCard) {
    table.addColumn("JOB_CARD"); table.addColumn("COLOUR");
    const ilKeys = [...new Set(lines.rows.map((row) => num(row.SYSTEM_BLANK2)).filter((key) => key > 0))];
    const processKeys = [...new Set(lines.rows.map((row) => num(row.SYSTEM_BLANK1)).filter((key) => key > 0))];
    const byLine = new Map((ilKeys.length === 0 ? [] : (await runReportSql(loader, `SELECT aoni_il_id AS "k", input_pjobcard AS "pjob", txt_colour AS "colour" FROM ${db}ADDON_IENTRY WHERE aoni_il_id = ANY($1::int[])`, [ilKeys])).rows).map((row) => [num(row.k), row] as const));
    const byEntry = new Map((processKeys.length === 0 ? [] : (await runReportSql(loader, `SELECT DISTINCT ON (aona_processid) aona_processid AS "k", input_job_card AS "job" FROM ${db}ADDON_AENTRY WHERE aona_processid = ANY($1::int[]) ORDER BY aona_processid, ctid DESC`, [processKeys])).rows).map((row) => [num(row.k), row] as const));
    for (const row of lines.rows) {
      const line = byLine.get(num(row.SYSTEM_BLANK2));
      const entryJob = toText(byEntry.get(num(row.SYSTEM_BLANK1))?.job ?? "");
      table.set(row, "JOB_CARD", entryJob !== "" ? entryJob : toText(line?.pjob ?? ""));
      table.set(row, "COLOUR", toText(line?.colour ?? ""));
    }
  }
  const byProduct = new Map<number, ResultRow[]>();
  for (const row of totals) byProduct.set(num(row.pk), [{ ADD_QTY: row.a, LESS_QTY: row.l } as unknown as ResultRow]);
  for (const row of lines.rows) {
    const tax = taxOf.get(num(row.SMART_LED_KEY)) ?? taxOf.get(num(row.SYSTEM_BLANK2));
    if (tax !== undefined) table.set(row, "FORM_CODE", tax);
    const key = num(table.get(row, "Prod_key"));
    const list = byProduct.get(key);
    if (list) list.push({ ...row }); else byProduct.set(key, [{ ...row }]);
  }

  // Summary: the rows with nothing at all are dropped, then those closing at nil unless Print Zero Stock, then those closing below nil unless Print Negative Stock.
  // Ledger: a product with no opening and no lines has no rows; the opening row is left out when there is no opening.
  const zero = check("CHK_PRNT_ZERO");
  const negative = check("CHK_NEGATIVE");
  // First the quantities of each product (the valuations work on its closing quantity), then the rows.
  const shown = products.flatMap((product) => {
    const rows = byProduct.get(product.key) ?? [];
    const added = decimalRound(rows.reduce((sum, row) => sum + num(table.get(row, "ADD_QTY")), 0), 4);
    const less = decimalRound(rows.reduce((sum, row) => sum + num(table.get(row, "LESS_QTY")), 0), 4);
    const closing = decimalRound((product.opening + added - less), 4);
    if (summary) {
      if (product.opening === 0 && added === 0 && less === 0 && closing === 0) return [];
      if (!zero && closing === 0) return [];
      if (!negative && closing < 0) return [];
    } else if (product.opening === 0 && rows.length === 0) return [];
    return [{ product, rows, added, less, closing }];
  });
  const r2 = (value: number) => decimalRound(value, 2);
  const valued = new Map<number, { rate: number; value: number }>();
  // Stock With Ageing / Print Days Column (Summary): the closing against the year's additions, newest first, in the age columns, and the age of the oldest lot used.
  const ageing = summary && check("CHK_AGECOL") ? await stockLots(loader, db, call.upto, call.tarikh1, typeKey, new Map(shown.map(({ product, closing }) => [product.key, closing] as const))) : null;
  if (ageing) {
    for (const column of STOCK_AGE_BUCKETS) table.setKind(column, "decimal");
    table.setKind("Days", "int");
    // With a valuation (Filter other than None) each age column also has its value, the rate (to 2 decimals) times the quantity.
    // Each value column stands right after the quantity column it values (the desktop's order).
    table.addColumn("AGE_OPENING"); table.setKind("AGE_OPENING", "decimal");
    if (withRate) { table.addColumn("OPEN_PCS_AMT"); table.setKind("OPEN_PCS_AMT", "decimal"); }
    if (withRate) {
      for (const column of AGE_VALUE_COLUMNS) { table.addColumn(column); table.setKind(column, "decimal"); }
      const first = table.columns.findIndex((column) => column === STOCK_AGE_BUCKETS[0]);
      if (first >= 0) {
        const rest = table.columns.filter((column) => column !== "AGE_OPENING" && column !== "OPEN_PCS_AMT" && !(STOCK_AGE_BUCKETS as readonly string[]).includes(column) && !AGE_VALUE_COLUMNS.includes(column));
        const before = table.columns.slice(0, first).filter((column) => rest.includes(column));
        const after = rest.filter((column) => !before.includes(column));
        table.columns.splice(0, table.columns.length, ...before, "AGE_OPENING", "OPEN_PCS_AMT", ...STOCK_AGE_BUCKETS.flatMap((bucket, at) => [bucket, AGE_VALUE_COLUMNS[at]]), ...after);
      }
    }
  }
  if (filter === "REPORT RATE") for (const { product, closing } of shown) valued.set(product.key, { rate: product.rate, value: r2(closing * product.rate) });
  else if (VALUATIONS.includes(filter)) for (const [key, entry] of await stockValuation(loader, plan, filter, new Map(shown.map(({ product, closing }) => [product.key, closing] as const)), typeKey)) valued.set(key, entry);
  for (const { product, rows, added, less, closing } of shown) {
    const entry = valued.get(product.key) ?? { rate: 0, value: 0 };
    const rateValues = withRate ? { RATE: entry.rate, VALUE: entry.value } : {};
    const ageValues = (key: number): Record<string, number> => {
      const found = ageing?.get(key);
      if (!ageing) return {};
      const rate = decimalRound(valued.get(key)?.rate ?? 0, 2);
      return Object.fromEntries([["Days", found ? found.days : 0], ["AGE_OPENING", found ? found.opening : 0], ...(withRate ? [["OPEN_PCS_AMT", decimalRound(rate * (found ? found.opening : 0), 2)]] : []), ...STOCK_AGE_BUCKETS.map((column, at) => [column, found ? found.buckets[at] : 0]),
        ...(withRate ? AGE_VALUE_COLUMNS.map((column, at) => [column, decimalRound(rate * (found ? found.buckets[at] : 0), 2)]) : [])]);
    };
    if (summary) {
      table.insert({ ...Object.fromEntries(addonLevels.map((at) => [`SMART_SELECTED_ADDON${at + 1}`, addonValue(product, at)])), ...Object.fromEntries(headingAliases.map((alias) => [alias, product.raw[alias]])), ROW_DATA_TYPE: "LED", SORTING_COL: `${product.short}   P`, PROD_SHORT: product.short, SELECTED_PRODUCT: product.desc, SMART_SELECTED_PRODUCT: product.desc, NAME: product.desc, Prod_key: product.key, UOM1: product.uom, OPENING: product.opening, ADD_QTY: added, LESS_QTY: less, CLSG_QTY: closing, ...rateValues, ...ageValues(product.key), ...masterValues(product) });
      continue;
    }
    const currentAddons = addonLevels.map((at) => addonValue(product, at));
    let changed = false;
    addonLevels.forEach((at, level) => {
      if (!changed && previousAddons[level] === currentAddons[level]) return;
      changed = true;
      table.insert({ ROW_DATA_TYPE: `ADDON_${level + 1}`, SORTING_COL: `${currentAddons.slice(0, level + 1).join("")}   H`, FULL_DOCNO: currentAddons[level], ...Object.fromEntries(addonLevels.slice(0, level + 1).map((_, up) => [`SMART_SELECTED_ADDON${addonLevels[up] + 1}`, currentAddons[up]])) });
    });
    previousAddons = currentAddons;
    table.insert({ ...ledgerAddons(product), ROW_DATA_TYPE: "PRODUCT", SORTING_COL: `${product.short}   H`, PROD_SHORT: product.short, SELECTED_PRODUCT: product.desc, SMART_SELECTED_PRODUCT: product.desc, FULL_DOCNO: `${product.short} - ${product.desc}`, Prod_key: product.key, ...masterValues(product) });
    // On a product's last row the value is the one worked out for its closing; before it, the running quantity at the rate.
    if (product.opening !== 0) table.insert({ ...ledgerAddons(product), ROW_DATA_TYPE: "OPENINGS", SORTING_COL: `${product.short}${desktopDate(call.from)}   O`, PROD_SHORT: product.short, SELECTED_PRODUCT: product.desc, SMART_SELECTED_PRODUCT: product.desc, NAME: "Opening", Prod_key: product.key, ADD_QTY: product.opening > 0 ? product.opening : 0, LESS_QTY: product.opening < 0 ? -product.opening : 0, CLSG_QTY: product.opening, ...(withRate ? { RATE: entry.rate, VALUE: rows.length === 0 ? entry.value : r2(product.opening * entry.rate) } : {}) });
    let running = product.opening;
    let factor = 0;
    rows.forEach((row, at) => {
      for (const [column, value] of Object.entries(ledgerAddons(product))) table.set(row, column, value);
      running = decimalRound((running + num(table.get(row, "ADD_QTY")) - num(table.get(row, "LESS_QTY"))), 4);
      table.set(row, "CLSG_QTY", running);
      // Factor: the balance of the second unit, running down the product's lines.
      factor = decimalRound(factor + num(table.get(row, "ADD_FACT")) - num(table.get(row, "LESS_FACT")), 4);
      table.set(row, "BAL_FACT", factor);
      if (daysFilter !== "") {
        const isIssue = toText(table.get(row, "stock_nat")).toUpperCase() === "L";
        if (isIssue) table.set(row, "Days", 0);
        else if (daysFilter === "ABOVE DAYS" ? num(table.get(row, "Days")) <= (daysLimit as number) : num(table.get(row, "Days")) >= (daysLimit as number)) return;
      }
      if (withRate) { table.set(row, "RATE", entry.rate); table.set(row, "VALUE", at === rows.length - 1 ? entry.value : r2(running * entry.rate)); }
      table.rows.push(row);
    });
    // The closing row, like the opening (which is in ADD, this is in LESS, so the subtotal's ADD and LESS balance): the balance at the end of the period, only when it is above nil (a nil or negative stock has no closing row) (the balance after the last line, which the lines taken out by Above / Below Days still count in).
    if (running > 0) table.insert({ ...ledgerAddons(product), ROW_DATA_TYPE: "CLOSINGS", SORTING_COL: `${product.short}${desktopDate(call.upto)}   Z`, PROD_SHORT: product.short, SELECTED_PRODUCT: product.desc, SMART_SELECTED_PRODUCT: product.desc, NAME: "Closing Balance", Prod_key: product.key, LESS_QTY: running,
      ...(withRate ? { RATE: entry.rate, VALUE: entry.value } : {}) });
  }
  return table;
}

// ======================================================================================
// 17: STOCK VALUATIONS (the Filter list of SP_STD_RPT_STOCK: Actual, Average Rate, Average C.Year,
//     Last Purchase, Last Sale and MRP). The Report Rate is in stockReport itself.
// ======================================================================================
//
// Worked out per product from its closing quantity, as the procedure does on the product heading /
// summary rows (the temp-table UPDATE and cursor loops):
// - MRP: the price list's latest MRP (latest PL_WEFROM, whatever its date).
// - Last Purchase: the rate of the latest purchase line up to the Upto date (IL_VALUE / quantity when
//   there is a value). Last Sale: the price list's latest sale rate up to the Upto date.
// - Average C.Year: the year's purchase value / quantity, to 3 decimals, then held to 2.
// - Average Rate: the plain average of the rates of the latest purchase lines that make up the
//   closing quantity (newest first), the opening rate counted once for what is left.
// - Actual: the closing quantity valued from the latest purchases back (first in first out), the
//   opening at its rate for what is left. Licence 21 takes the master rate, the opening rate or the
//   price list for products with no purchase, and values semi finished products from their BOM.
// Not ported: Average Value (see PENDING-WORK.md), the write of the closing value to the account's
// OS_BILLDIFF (CHK_UPD_MASTER) and to the product masters (CHK_UPD_RATE / CHK_GST_OPEN), and the
// special Actual code of licences 1, 8 and 62.

type Valuation = { rate: number; value: number };

/** The value of each age column (SP_STD_RPT_STOCK, Summary with a valuation): the rate times the quantity of the column. */
const AGE_VALUE_COLUMNS = ["Days30_AMT", "Days60_AMT", "Days90_AMT", "Days120_AMT", "Days150_AMT", "Days180_AMT", "DaysABOVE_AMT"];

/** The Filter choices worked out by stockValuation (REPORT RATE is the product's own report rate). */
const VALUATIONS = ["ACTUAL", "AVERAGE RATE", "AVERAGE C.YEAR", "LAST PURCHASE", "LAST SALE", "MRP"];

async function stockValuation(loader: Loader, plan: ReportPlan, filter: string, closings: ReadonlyMap<number, number>, typeKey: number): Promise<Map<number, Valuation>> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const licence = call.licence;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const notPorted = (what: string) => new ReportRefusal(`${what} of the Stock report is not available in the web version yet.`, "Not ported yet");
  const r2 = (value: number) => decimalRound(value, 2);
  const found = new Map<number, Valuation>();
  const keys = [...closings.keys()];
  if (keys.length === 0) return found;
  const closing = (key: number) => closings.get(key) ?? 0;
  const setRate = (key: number, rate: number) => found.set(key, { rate, value: r2(closing(key) * rate) });
  const yearStart = desktopDate(call.tarikh1);
  const uptoText = desktopDate(call.upto);
  const isType = (type: unknown, wanted: string) => type !== null && type !== undefined && toText(type).toUpperCase() === wanted;
  /** TXT_PRODTYPE <> 'FINISH GOODS' as SQL Server reads it: a product with no type is not in it. */
  const notFinished = (type: unknown) => type !== null && type !== undefined && toText(type).toUpperCase() !== "FINISH GOODS";

  /** A line's quantity in the product's first report unit (less what was set against another entry when `ag`). */
  const qtyCase = (l: string, p: string, ag: boolean) => {
    const columns: [string, string][] = [["PCS_UOM", "TRN_PCS"], ["QTY1_UOM", "TRN_QTY1"], ["QTY2_UOM", "TRN_QTY2"], ["QTY3_UOM", "TRN_QTY3"], ["PACK_UOM", "TRN_PACK"], ["WEIGHT_UOM", "TRN_WEIGHT"]];
    const minus = ag ? `-${l}.AG_QTY` : "";
    return `(case ${columns.map(([uom, column]) => `when ${p}.REP1_UOM=${p}.${uom} then ${l}.${column}${minus}`).join(" ")} else ${l}.TRN_PCS${minus} end)`;
  };
  const hideBook = [19, 29, 68, 73].includes(licence)
    && num((await runReportSql(loader, frag(`SELECT COUNT(*) AS n FROM ${db}ACCOUNT WHERE A_POS <> 'D' AND POSITION('CA_ENT' IN A_SHORT) > 0`))).rows[0]?.n) === 0;
  const bookCode = hideBook ? ` AND (pl.BOOK_CODE IN (SELECT code FROM ${db}ACCOUNT WHERE a_pos = 'A') OR pl.BOOK_CODE IS NULL)` : "";
  /** The purchase lines the average and the actual value are made of. */
  const purchaseCondition = check("CHK_STKADJCALC") && licence !== 21
    ? "(pl.BOOK=13 OR pl.TRN_STKMID='SA') AND pl.TRN_STKMID NOT IN ('CH','OR','PR','IN','AM','PF','QT','EQ') AND pl.STOCK_NAT='A'"
    : licence === 21 && check("CHK_WITHCN")
      ? "(pl.BOOK=13 OR pl.BOOK=16) AND pl.STOCK_NAT='A' AND pl.process_id IS NULL"
      : `pl.BOOK=13 AND pl.STOCK_NAT='A' AND pl.process_id IS NULL${bookCode}`;
  const purchaseLines = async (ids: number[]) => {
    const lines = new Map<number, { date: string; key: number; rate: number; amount: number; quantity: number; qty: number }[]>();
    if (ids.length === 0) return lines;
    const rows = (await runReportSql(loader, frag(`SELECT pl.PROD_ID AS "pid", pl.IL_KEY AS "ilkey", to_char(pl.IL_DATE,'YYYYMMDD') AS "d", pl.RATE::numeric AS "rate", pl.IL_VALUE::numeric AS "amount", pl.QUANTITY::numeric AS "quantity", ${qtyCase("pl", "p", true)}::numeric AS "qty"`
      + ` FROM ${db}PROD_LEDGER pl join ${db}PRODUCT_MASTER p ON p.PROD_KEY = pl.PROD_ID WHERE pl.PROD_ID = ANY($1::int[]) AND p.PROD_POS <> 'D' AND pl.IL_POS='A' AND pl.INVENTORY='Y' AND ${purchaseCondition}`
      + ` AND pl.IL_DATE BETWEEN '${yearStart}' AND '${uptoText}' ORDER BY pl.PROD_ID, pl.IL_DATE DESC, pl.IL_KEY DESC`), [ids])).rows;
    for (const row of rows) {
      const list = lines.get(num(row.pid)) ?? [];
      list.push({ date: toText(row.d), key: num(row.ilkey), rate: num(row.rate), amount: num(row.amount), quantity: num(row.quantity), qty: num(row.qty) });
      lines.set(num(row.pid), list);
    }
    return lines;
  };
  /** The year's opening of each product (its first report unit), its opening and report rates, and its type. */
  const openingInfo = async (ids: number[]) => {
    const open = (column: string) => `p.rep1_uom=p.${column}_uom`;
    const rows = ids.length === 0 ? [] : (await runReportSql(loader, frag(`SELECT p.PROD_KEY AS "pid", ad.TXT_PRODTYPE AS "ptype", coalesce(pb.open_rate,0)::numeric AS "open_rate", coalesce(pb.rep_rate,0)::numeric AS "rep_rate",`
      + ` (case when ${open("pcs")} then pb.OPEN_PCS when ${open("qty1")} then pb.open_qty1 when ${open("qty2")} then pb.open_qty2 when ${open("qty3")} then pb.open_qty3 when ${open("pack")} then pb.open_pack when ${open("weight")} then pb.open_weight else pb.OPEN_PCS end)::numeric AS "open_qty"`
      + ` FROM ${db}PRODUCT_MASTER p left join ${db}PROD_BALANCE pb ON pb.PROD_ID = p.PROD_KEY AND pb.PREC_FLAG='RP' left join ${db}ADDON_DATA ad ON ad.PROD_ID = p.PROD_KEY WHERE p.PROD_KEY = ANY($1::int[])`), [ids])).rows;
    return new Map(rows.map((row) => [num(row.pid), { type: row.ptype, openRate: num(row.open_rate), repRate: num(row.rep_rate), openQty: num(row.open_qty) }] as const));
  };

  if (filter === "MRP") {
    if ([7, 19].includes(licence)) throw notPorted(`The MRP of licence ${licence} (the party rate list)`);
    const rows = (await runReportSql(loader, frag(`SELECT DISTINCT ON (pr.PROD_ID) pr.PROD_ID AS "pid", pr.PL_MRP::numeric AS "rate" FROM ${db}PRICELIST pr WHERE pr.PL_POS <> 'D' AND pr.PROD_ID = ANY($1::int[]) ORDER BY pr.PROD_ID, pr.PL_WEFROM DESC`), [keys])).rows;
    for (const row of rows) setRate(num(row.pid), r2(num(row.rate)));
  } else if (filter === "LAST SALE" || (filter === "LAST PURCHASE" && licence === 9)) {
    const column = filter === "LAST SALE" ? "PL_SRATE" : "PL_PRATE";
    const rows = (await runReportSql(loader, frag(`SELECT DISTINCT ON (pr.PROD_ID) pr.PROD_ID AS "pid", pr.${column}::numeric AS "rate" FROM ${db}PRICELIST pr WHERE pr.PL_POS <> 'D' AND pr.PL_WEFROM <= '${uptoText}' AND pr.${column} > 0 AND pr.PROD_ID = ANY($1::int[]) ORDER BY pr.PROD_ID, pr.PL_WEFROM DESC`), [keys])).rows;
    for (const row of rows) setRate(num(row.pid), r2(num(row.rate)));
  } else if (filter === "LAST PURCHASE") {
    const rows = (await runReportSql(loader, frag(`SELECT DISTINCT ON (pl.PROD_ID) pl.PROD_ID AS "pid", pl.RATE::numeric AS "rate", pl.IL_VALUE::numeric AS "amount", ${qtyCase("pl", "p", false)}::numeric AS "qty"`
      + ` FROM ${db}PROD_LEDGER pl join ${db}PRODUCT_MASTER p ON p.PROD_KEY = pl.PROD_ID WHERE pl.PROD_ID = ANY($1::int[]) AND pl."TYPE" <> ${typeKey} AND pl.IL_DATE <= '${uptoText}' AND pl.INVENTORY='Y' AND pl.QUANTITY-pl.AG_QTY > 0 AND pl.IL_POS='A'`
      + ` AND pl.STOCK_NAT='A' AND pl.BOOK=13 AND pl.process_id IS NULL${bookCode} ORDER BY pl.PROD_ID, pl.IL_DATE DESC, pl.IL_KEY DESC`), [keys])).rows;
    for (const row of rows) setRate(num(row.pid), num(row.amount) > 0 && num(row.qty) > 0 ? r2(num(row.amount) / num(row.qty)) : r2(num(row.rate)));
  } else if (filter === "AVERAGE C.YEAR") {
    const rows = (await runReportSql(loader, frag(`SELECT pl.PROD_ID AS "pid", SUM(pl.QUANTITY)::numeric AS "qty", SUM(pl.IL_VALUE)::numeric AS "amount"`
      + ` FROM ${db}PROD_LEDGER pl join ${db}PRODUCT_MASTER p ON p.PROD_KEY = pl.PROD_ID WHERE pl.PROD_ID = ANY($1::int[]) AND p.PROD_POS <> 'D' AND pl.IL_POS='A' AND pl.INVENTORY='Y' AND ${purchaseCondition}`
      + ` AND pl.IL_DATE BETWEEN '${yearStart}' AND '${uptoText}' GROUP BY pl.PROD_ID`), [keys])).rows;
    // ROUND(value / quantity, 3) goes into the RATE column, which holds 2 decimals.
    for (const row of rows) if (num(row.qty) !== 0) setRate(num(row.pid), r2(decimalRound(num(row.amount) / num(row.qty), 3)));
  } else if (filter === "AVERAGE RATE") {
    const ids = keys.filter((key) => r2(closing(key)) > 0);
    const lines = await purchaseLines(ids);
    const info = await openingInfo(ids);
    for (const key of ids) {
      let remaining = r2(closing(key));
      let total = 0;
      let count = 0;
      for (const line of lines.get(key) ?? []) {
        count += 1;
        total += r2(line.rate);
        remaining = remaining >= r2(line.quantity) ? r2(remaining - r2(line.quantity)) : 0;
        if (remaining === 0) break;
      }
      const openRate = info.get(key)?.openRate ?? 0;
      if (openRate > 0 && remaining > 0) { total += openRate; count += 1; }
      if (count > 0 && total !== 0) setRate(key, r2(total / count));
    }
  } else if (filter === "ACTUAL") {
    if ([1, 8, 62].includes(licence)) throw notPorted(`The Actual valuation of licence ${licence}`);
    if (check("CHK_SLABVAL")) throw notPorted("The Actual valuation with slabs");
    const ids = keys.filter((key) => closing(key) > 0);
    const info = await openingInfo(keys);
    if (licence !== 21) {
      // First in first out: whole purchase values from the latest back, the rest at the opening rate.
      const lines = await purchaseLines(ids);
      for (const key of ids) {
        let remaining = closing(key);
        let total = 0;
        for (const line of lines.get(key) ?? []) {
          if (remaining >= line.qty) { total += line.amount; remaining -= line.qty; } else { total += (line.amount / line.qty) * remaining; remaining = 0; }
          if (remaining === 0) break;
        }
        const openRate = info.get(key)?.openRate ?? 0;
        if (openRate > 0 && remaining > 0) total += openRate * remaining;
        total = r2(total);
        found.set(key, { rate: total > 0 ? r2(total / closing(key)) : 0, value: total });
      }
    } else {
      const fifoIds = ids.filter((key) => notFinished(info.get(key)?.type));
      const lines = await purchaseLines(fifoIds);
      const yearStartKey = `${call.tarikh1.getFullYear()}${String(call.tarikh1.getMonth() + 1).padStart(2, "0")}${String(call.tarikh1.getDate()).padStart(2, "0")}`;
      for (const key of fifoIds) {
        const facts = info.get(key)!;
        // The layers: the opening (dated the year's start) and every purchase line, latest first.
        const layers = [{ date: yearStartKey, key: 0, qty: facts.openQty, rate: facts.openRate, rep: facts.repRate }, ...(lines.get(key) ?? []).map((line) => ({ date: line.date, key: line.key, qty: line.qty, rate: line.rate, rep: 0 }))];
        const priceOf = (layer: { rate: number; rep: number }) => (layer.rep > 0 ? layer.rep : layer.rate);
        layers.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key - b.key));
        let cumulative = 0;
        let used = 0;
        let total = 0;
        for (const layer of layers) {
          cumulative += layer.qty;
          const taken = cumulative <= closing(key) ? layer.qty : cumulative - layer.qty < closing(key) ? closing(key) - (cumulative - layer.qty) : 0;
          if (taken > 0) { used += taken; total += taken * priceOf(layer); }
        }
        if (closing(key) > used) {
          const first = [...layers].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key - b.key))[0];
          total += (closing(key) - used) * priceOf(first);
        }
        total = r2(total);
        found.set(key, { rate: total > 0 ? r2(total / closing(key)) : 0, value: total });
      }

      // Products still without a rate: the latest purchase rate, the opening rate, the master rate;
      // finished goods from the price list (52.5 % of the sale rate, or the rate itself with CHK_DPRATE).
      const rateOf = (key: number) => found.get(key)?.rate ?? 0;
      const give = (key: number, rate: number) => { const old = found.get(key); found.set(key, { rate, value: old?.value ?? 0 }); };
      const latest = (await runReportSql(loader, frag(`SELECT DISTINCT ON (a.PROD_ID) a.PROD_ID AS "pid", a.RATE::numeric AS "rate" FROM ${db}PROD_LEDGER a WHERE a.PROD_ID = ANY($1::int[]) AND a.BOOK = 13 AND a.IL_DATE BETWEEN '${yearStart}' AND '${uptoText}' AND a.IL_POS <> 'D' AND a.LED_ID IS NOT NULL ORDER BY a.PROD_ID, a.IL_DATE DESC, a.IL_KEY DESC`), [keys])).rows;
      for (const row of latest) if (notFinished(info.get(num(row.pid))?.type) && rateOf(num(row.pid)) === 0) give(num(row.pid), r2(num(row.rate)));
      for (const key of keys) { const facts = info.get(key); if (facts && notFinished(facts.type) && rateOf(key) === 0 && facts.openRate > 0) give(key, r2(facts.openRate)); }
      for (const key of keys) { const facts = info.get(key); if (facts && notFinished(facts.type) && rateOf(key) === 0 && facts.repRate > 0) give(key, r2(facts.repRate)); }
      const prices = (await runReportSql(loader, frag(`SELECT DISTINCT ON (pr.PROD_ID) pr.PROD_ID AS "pid", pr.PL_SRATE::numeric AS "rate" FROM ${db}PRICELIST pr WHERE pr.PROD_ID = ANY($1::int[]) AND pr.PL_POS <> 'D' AND pr.PL_SRATE > 0 AND pr.PL_WEFROM <= '${uptoText}' ORDER BY pr.PROD_ID, pr.PL_WEFROM DESC`), [keys])).rows;
      for (const row of prices) {
        const key = num(row.pid);
        if (isType(info.get(key)?.type, "FINISH GOODS") && rateOf(key) === 0) give(key, check("CHK_DPRATE") ? r2(num(row.rate)) : r2((num(row.rate) * 52.5) / 100));
      }
      for (const key of keys) if (isType(info.get(key)?.type, "FINISH GOODS")) found.set(key, { rate: rateOf(key), value: r2(rateOf(key) * closing(key)) });

      // Semi finished products: the cost of the materials taken in their BOM entries.
      const semi = (await runReportSql(loader, frag(`WITH latest AS (SELECT DISTINCT ON (a.PROD_ID) a.PROD_ID, a.RATE FROM ${db}PROD_LEDGER a WHERE a.BOOK = 13 AND a.IL_DATE BETWEEN '${yearStart}' AND '${uptoText}' AND a.IL_POS = 'A' AND COALESCE(a.LED_ID,0) > 0 ORDER BY a.PROD_ID, a.IL_DATE DESC, a.IL_KEY DESC),`
        + ` doc AS (SELECT l1.FULL_DOCNO, MIN(pm1.PROD_SHORT) AS semi_short FROM ${db}PROD_LEDGER l1 join ${db}ADDON_DATA ad ON ad.PROD_ID = l1.PROD_ID join ${db}PRODUCT_MASTER pm1 ON pm1.PROD_KEY = l1.PROD_ID`
        + ` WHERE l1.TRN_MODULE = 'MFG-BOM' AND l1.IL_POS <> 'D' AND l1.STOCK_NAT = 'A' AND upper(ad.TXT_PRODTYPE) = 'SEMI FINISHED MATERIAL' GROUP BY l1.FULL_DOCNO)`
        + ` SELECT doc.semi_short AS "short", SUM(CASE WHEN COALESCE(latest.RATE,0) * l.QUANTITY = 0 THEN COALESCE(pb.OPEN_RATE,0) * l.QUANTITY ELSE latest.RATE * l.QUANTITY END)::numeric AS "cost"`
        + ` FROM ${db}PROD_LEDGER l join ${db}PRODUCT_MASTER pm ON pm.PROD_KEY = l.PROD_ID AND pm.PROD_POS = 'A' join ${db}PROD_BALANCE pb ON pb.PROD_ID = pm.PROD_KEY AND pb.PREC_FLAG = 'RP' left join latest ON latest.PROD_ID = l.PROD_ID join doc ON doc.FULL_DOCNO = l.FULL_DOCNO`
        + ` WHERE l.TRN_MODULE = 'MFG-BOM' AND l.IL_POS <> 'D' AND l.STOCK_NAT = 'L' GROUP BY doc.semi_short`))).rows;
      if (semi.length > 0) {
        const shorts = new Map((await runReportSql(loader, frag(`SELECT PROD_KEY AS "pid", PROD_SHORT AS "short" FROM ${db}PRODUCT_MASTER WHERE PROD_KEY = ANY($1::int[])`), [keys])).rows.map((row) => [toText(row.short), num(row.pid)] as const));
        for (const row of semi) { const key = shorts.get(toText(row.short)); if (key !== undefined) give(key, r2(num(row.cost))); }
      }
      for (const key of keys) {
        const entry = found.get(key);
        if (entry && closing(key) !== 0 && entry.rate > 0) found.set(key, { rate: entry.rate, value: r2(entry.rate * closing(key)) });
      }
    }
  }
  return found;
}

// ======================================================================================
// 29: STOCK SUMMARY, ALL BOOKS (SP_FRT_RPT_STOCK_SUMMARY_ALLBOOK, called from SP_REPORT_FORMATING)
// ======================================================================================
//
// One line per product: the opening, then what came in and went out in each kind of voucher
// (purchase, credit note, challan in, stock voucher add, stock JV add; sale, debit note, challan
// out, stock voucher less, stock JV less; damage), and the closing. Quantities are in the product's
// first report unit, an entry's quantity less what was set against another entry (AG_QTY); the
// stock JV and the job work lines as the procedure takes them. Opening for a From date later than
// the year's start is the year's opening plus what moved before it.
//
// Licences 21 and 71 take Production and Consumption columns (and 21 the excise rate) and count only the
// stock voucher in STOCK_ADD. Not ported: the "With Date" (CHK_WITHDATE) layout, the Factor columns
// (CHK_FACTOR), godown and entry-addon stock, and the columns of licences 6, 15, 22 and 38.

export async function stockSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const notPorted = (what: string) => new ReportRefusal(`${what} of the Stock Summary is not available in the web version yet.`, "Not ported yet");
  const withDate = check("CHK_WITHDATE");
  if (check("CHK_FACTOR")) throw notPorted("The Factor columns");
  if ([6, 15, 22, 38].includes(call.licence)) throw notPorted(`The licence ${call.licence} columns`);
  if (call.addon.some((text) => text.toUpperCase().includes("GODOWN"))) throw notPorted("The Godown selection");
  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);
  const yearStart = desktopDate(call.tarikh1);
  const dayBeforeFrom = desktopDate(dayBefore(call.from));
  const between = call.from.getTime() !== call.tarikh1.getTime();
  // The keys of the Rate Difference (NR) and Damage (ND) books: lines of the rate difference book are left out, the damage credit / debit notes have their own columns.
  const keyOf = async (id: string) => num((await runReportSql(loader, `SELECT BOOK_KEY FROM ${db}BOOK_PROPERTIES WHERE STKM_ID = '${id}'${id === "NR" ? " AND STKM_POS = 'A'" : ""} ORDER BY STKMODULE LIMIT 1`)).rows[0]?.book_key);
  const typeKey = await keyOf("NR");
  const damageKey = await keyOf("ND");

  // A line's quantity in the product's first report unit. `minus`: the entry's quantity less what was set against another entry; `share`: the same where the
  // other units take their part of it (the opening before From counts purchases that way); `plain`: the entry's own.
  const units: [string, string][] = [["PCS_UOM", "TRN_PCS"], ["QTY1_UOM", "TRN_QTY1"], ["QTY2_UOM", "TRN_QTY2"], ["QTY3_UOM", "TRN_QTY3"], ["PACK_UOM", "TRN_PACK"], ["WEIGHT_UOM", "TRN_WEIGHT"]];
  type Way = (column: string) => string;
  const minus: Way = (column) => `prodled.${column}-prodled.ag_qty`;
  const share: Way = (column) => (column === "TRN_PCS" ? minus(column) : `prodled.${column}-round((prodled.AG_QTY/nullif(prodled.QUANTITY,0)*prodled.${column}),4)`);
  const plain: Way = (column) => `prodled.${column}`;
  /** The job work in lines count whole. */
  const jobIn: Way = (column) => `(case when prodled.trn_module='JOB-IN' then prodled.${column} else prodled.${column}-prodled.ag_qty end)`;
  const pick = (way: Way, other: string) => `case ${units.map(([uom, column]) => `when PRODUCT.REP1_UOM=PRODUCT.${uom} then ${way(column)}`).join(" ")} else ${other} end`;
  const sum = (condition: string, expression: string, alias: string) => `coalesce(sum(case when ${condition} then ${expression} else 0.00 end),0.00) AS "${alias}"`;
  const inv = "prodled.inventory='Y'";
  const rpl = call.licence === 21 || call.licence === 71;
  const typed = `prodled."TYPE"`;
  const production = "stock_nat='A' and (trn_module='PROD-FG' or trn_module='PROD-SFG' or trn_module='PROD-MULTI')";
  const consumption = "stock_nat='L' and (trn_module='PROD-FG' or trn_module='PROD-SFG' or trn_module='PROD-MULTI')";
  /** The columns of one pass: the period (SUMMARY1 of the procedure) or what came before From (SUMMARY2); the two pick their lines a little differently. */
  const passColumns = (period: boolean) => [
    sum(`(book=13 or book=14) and stock_nat='A' and ${inv} and led_id is not null`, period ? pick(minus, "prodled.TRN_PCS") : pick(share, "prodled.QUANTITY"), "purch_qty"),
    sum(call.licence === 7 ? `${inv} and prodled.trn_module='ORD-IN'` : `(book=16 or book=8) and stock_nat='A' and ${inv} and led_id is not null and ${typed}<>${damageKey}`, pick(minus, "0.00"), "cr_qty"),
    sum(`stock_nat='A' and (trn_module='CHLN-IN' or trn_module='JOB-IN' or trn_module='JOB-OUT') and ${inv} and process_id is not null`, pick(jobIn, "0.00"), "chlnin_qty"),
    ...(rpl ? [sum(`${production} and ${inv} and process_id is not null`, pick(minus, "prodled.TRN_PCS-prodled.ag_qty"), "production")] : []),
    sum(rpl || !period ? `stock_nat='A' and trn_module='SVOU-ADD' and ${inv} and process_id is not null` : `stock_nat='A' and (trn_module='SVOU-ADD' or trn_module='PROD-FG' or trn_module='PROD-SFG') and ${inv} and process_id is not null`, pick(minus, rpl || !period ? "prodled.trn_pcs" : "0.00"), "stock_add"),
    sum(`stock_nat='A' and ${inv} and (trn_module='STK-JV' or trn_module='RG-AC')`, pick(plain, "prodled.TRN_PCS"), "stock_jv_add"),
    sum(`(book=8 or book=9) and stock_nat='L' and ${inv} and led_id is not null`, pick(minus, "0.00"), "sale_qty"),
    sum(`(book=11 or book=13) and stock_nat='L' and ${inv} and led_id is not null and ${typed}<>${damageKey}`, pick(minus, "0.00"), "dr_qty"),
    sum(`stock_nat='L' and (trn_module='CHLN-OUT' or trn_module='IND-OUT' or trn_module='JOB-OUT'${period ? "" : " or trn_module='JOB-IN'"}) and ${inv} and process_id is not null`, `case when prodled.trn_module='JOB-OUT' then prodled.quantity else ${pick(minus, "0.00")} end`, "chlnout_qty"),
    ...(rpl ? [sum(`${consumption} and ${inv} and process_id is not null`, pick(minus, "0.00"), "consumption")] : []),
    sum(`stock_nat='L' and trn_module='SVOU-LESS' and ${inv} and process_id is not null`, pick(minus, rpl || !period ? "prodled.trn_pcs" : "0.00"), "stock_less"),
    sum(`stock_nat='L' and ${inv} and (trn_module='STK-JV' or trn_module='RG-AC')`, pick(plain, "prodled.TRN_PCS"), "stock_jv_less"),
    sum(`book=16 and ${typed}=${damageKey} and led_id is not null`, pick(minus, "0.00"), "damagein_qty"),
    sum(`book=11 and ${typed}=${damageKey} and led_id is not null`, pick(minus, "0.00"), "damageout_qty"),
  ];
  const movements = async (from: string, upto: string, period: boolean) => new Map((await runReportSql(loader, frag(`SELECT prodled.prod_id AS "prod_id", ${passColumns(period).join(", ")} FROM ${db}PROD_LEDGER prodled join ${db}PRODUCT_MASTER PRODUCT on PRODUCT.PROD_KEY = prodled.PROD_ID`
    + ` WHERE prodled.il_pos='A' AND prodled.IL_DATE BETWEEN '${from}' AND '${upto}' AND prodled.quantity>0 AND ${typed} <> ${typeKey} GROUP BY prodled.prod_id`))).rows.map((row) => [num(row.prod_id), row] as const));
  const period = withDate ? new Map<number, ResultRow>() : await movements(fromText, uptoText, true);
  const before = !withDate && between ? await movements(yearStart, dayBeforeFrom, false) : new Map<number, ResultRow>();

  const names = ["purch_qty", "cr_qty", "chlnin_qty", ...(rpl ? ["production"] : []), "stock_add", "stock_jv_add", "sale_qty", "dr_qty", "chlnout_qty", ...(rpl ? ["consumption"] : []), "stock_less", "stock_jv_less", "damagein_qty", "damageout_qty"];
  const net = (row: ResultRow | undefined) => (row === undefined ? 0 : num(row.purch_qty) + num(row.cr_qty) + num(row.chlnin_qty) + num(row.production) + num(row.stock_add) + num(row.stock_jv_add) + (rpl ? num(row.damagein_qty) : 0) - num(row.sale_qty) - num(row.dr_qty) - num(row.chlnout_qty) - num(row.consumption) - num(row.stock_less) - num(row.stock_jv_less) - (rpl ? num(row.damageout_qty) : 0));

  // The products: the ticked ones (and addon keys) of the setup's where.
  const addonFilter = call.addon.map((text, index) => (text.trim() !== "" && call.selectKey[index] !== "" ? ` and ${text.replace(" adata.txt_", " adata.key_")} in ${call.selectKey[index]}` : "")).join("");
  const open = (column: string) => `product.rep1_uom=product.${column}_uom`;
  // The ticked addon groups: their value (SMART_SELECTED_ADDONn) and their heading column.
  const addonAlias = (text: string) => /as\s+"([^"]+)"/i.exec(text)?.[1] ?? "";
  const addonLevels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "" && call.headingAddon[at].trim() !== "");
  const addonSelect = addonLevels.map((at) => `, ${call.selectedAddon[at].trim() !== "" ? call.selectedAddon[at].trim() : `${call.addon[at].trim()} as "SMART_SELECTED_ADDON${at + 1}"`}, ${call.headingAddon[at].trim()}`).join("");
  const products = (await runReportSql(loader, frag(`SELECT product.PROD_KEY AS "prod_key", product.PROD_SHORT AS "prod_short", product.PROD_DESC AS "prod_desc", product.BAR_CODE AS "bar_code", coalesce(prodbal.excise_rate,0) AS "act_rate"${addonSelect},`
    + ` prodbal.OPEN_PCS::numeric AS "open_pcs", product.BASE_PACK::numeric AS "base_pack", (case when ${open("pcs")} then prodbal.OPEN_PCS when ${open("qty1")} then prodbal.open_qty1 when ${open("qty2")} then prodbal.open_qty2 when ${open("qty3")} then prodbal.open_qty3 when ${open("pack")} then prodbal.open_pack when ${open("weight")} then prodbal.open_weight else prodbal.OPEN_PCS end) AS "opening"`
    + ` FROM ${db}product_master product left join ${db}prod_balance prodbal on product.prod_key=prodbal.prod_id inner join ${db}IDOPT_MASTER idopt on product.prod_group = idopt.idopt_key left join ${db}ADDON_DATA adata on adata.PROD_ID = product.PROD_KEY`
    + ` where product.prod_pos<>'D' and product.inventory='Y' and prodbal.prec_flag='RP' and prodbal.YEAR_ID='${call.yearId}'${call.selectKey[4] !== "" ? ` and product.prod_key in ${call.selectKey[4]}` : ""}${addonFilter}`))).rows;
  /**
   * "With Date" (CHK_WITHDATE): only the products that had a transaction between From and Upto, with the opening (the product's opening in pieces, plus what moved from the
   * year's start to the day before From), ADD and LESS of the period (the entry's quantity less what was set against another; job work whole), the closing, and for
   * licence 21 the standard pack, the whole cartons and the loose quantity (the product code shows a dot).
   */
  async function stockSummaryWithDate(): Promise<ResultTable> {
    const moved = new Map((await runReportSql(loader, frag(`SELECT prodled.prod_id AS "prod_id", coalesce(sum(case when stock_nat='A' and ${inv} then (case when btrim(trn_module) in ('JOB-OUT','JOB-IN') then quantity else quantity-ag_qty end) else 0.00 end),0.00) AS "add_qty",`
      + ` coalesce(sum(case when stock_nat='L' and ${inv} then (case when btrim(trn_module) in ('JOB-OUT','JOB-IN') then quantity else quantity-ag_qty end) else 0.00 end),0.00) AS "less_qty" FROM ${db}PROD_LEDGER prodled`
      + ` WHERE prodled.il_pos='A' AND prodled.IL_DATE BETWEEN '${fromText}' AND '${uptoText}' AND ${typed} <> ${typeKey} GROUP BY prodled.prod_id`))).rows.map((row) => [num(row.prod_id), row] as const));
    // What moved before From, as the procedure's second pass takes it (production and consumption for every licence, challan out without the job work in).
    const earlierColumns = [
      sum(`(book=13 or book=14) and stock_nat='A' and ${inv} and led_id is not null`, pick(share, "prodled.QUANTITY"), "purch_qty"),
      sum(`(book=16 or book=8) and stock_nat='A' and ${inv} and led_id is not null and ${typed}<>${damageKey}`, pick(minus, "0.00"), "cr_qty"),
      sum(`stock_nat='A' and (trn_module='CHLN-IN' or trn_module='JOB-IN' or trn_module='JOB-OUT') and ${inv} and process_id is not null`, pick(jobIn, "0.00"), "chlnin_qty"),
      sum(`${production} and ${inv} and process_id is not null`, pick(minus, "0.00"), "production"),
      sum(`stock_nat='A' and trn_module='SVOU-ADD' and ${inv} and process_id is not null`, pick(minus, "prodled.trn_pcs"), "stock_add"),
      sum(`stock_nat='A' and ${inv} and (trn_module='STK-JV' or trn_module='RG-AC')`, pick(plain, "prodled.TRN_PCS"), "stock_jv_add"),
      sum(`(book=8 or book=9) and stock_nat='L' and ${inv} and led_id is not null`, pick(minus, "0.00"), "sale_qty"),
      sum(`(book=11 or book=13) and stock_nat='L' and ${inv} and led_id is not null and ${typed}<>${damageKey}`, pick(minus, "0.00"), "dr_qty"),
      sum(`stock_nat='L' and (trn_module='CHLN-OUT' or trn_module='IND-OUT' or trn_module='JOB-OUT') and ${inv} and process_id is not null`, `case when prodled.trn_module='JOB-OUT' then prodled.quantity else ${pick(minus, "0.00")} end`, "chlnout_qty"),
      sum(`${consumption} and ${inv} and process_id is not null`, pick(minus, "0.00"), "consumption"),
      sum(`stock_nat='L' and trn_module='SVOU-LESS' and ${inv} and process_id is not null`, pick(minus, "prodled.trn_pcs"), "stock_less"),
      sum(`stock_nat='L' and ${inv} and (trn_module='STK-JV' or trn_module='RG-AC')`, pick(plain, "prodled.TRN_PCS"), "stock_jv_less"),
    ];
    const earlier = between ? new Map((await runReportSql(loader, frag(`SELECT prodled.prod_id AS "prod_id", ${earlierColumns.join(", ")} FROM ${db}PROD_LEDGER prodled join ${db}PRODUCT_MASTER PRODUCT on PRODUCT.PROD_KEY = prodled.PROD_ID`
      + ` WHERE prodled.il_pos='A' AND prodled.IL_DATE BETWEEN '${yearStart}' AND '${dayBeforeFrom}' AND prodled.quantity>0 AND ${typed} <> ${typeKey} GROUP BY prodled.prod_id`))).rows.map((row) => [num(row.prod_id), row] as const)) : new Map<number, ResultRow>();
    const table = new ResultTable();
    const lic21 = call.licence === 21;
    for (const column of ["SMART_SELECTED_PRODUCT", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "ROW_DATA_TYPE", "PROD_SHORT", "PROD_DESC", "OPEN_QTY", "ADD_QTY", "LESS_QTY", "CLSG_QTY", ...(lic21 ? ["STD_PACK", "CARTONS", "LOOSE_QTY"] : [])]) table.addColumn(column);
    for (const column of ["OPEN_QTY", "ADD_QTY", "LESS_QTY", "CLSG_QTY", ...(lic21 ? ["STD_PACK", "CARTONS", "LOOSE_QTY"] : [])]) table.setKind(column, "decimal");
    const aliases = addonLevels.map((at) => addonAlias(call.headingAddon[at])).filter((alias) => alias !== "");
    for (const alias of aliases) table.addColumn(alias);
    const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
    const seen = new Set<string>();
    for (const product of products) {
      const key = num(product.prod_key);
      const lineKey = `${key}|${addonLevels.map((at) => selectedAddon(product, at)).join("|")}`;
      if (seen.has(lineKey)) continue;
      seen.add(lineKey);
      const inPeriod = moved.get(key);
      const add = r2(num(inPeriod?.add_qty));
      const less = r2(num(inPeriod?.less_qty));
      if (add === 0 && less === 0) continue;
      const before = earlier.get(key);
      const opening = r2(num(product.open_pcs) + (before === undefined ? 0 : num(before.purch_qty) + num(before.cr_qty) + num(before.chlnin_qty) + num(before.production) + num(before.stock_add) + num(before.stock_jv_add) - num(before.sale_qty) - num(before.dr_qty) - num(before.chlnout_qty) - num(before.stock_less) - num(before.stock_jv_less) - num(before.consumption)));
      const closing = r2(opening + add - less);
      const pack = num(product.base_pack);
      const cartons = lic21 && closing !== 0 && pack > 1 ? Math.floor(closing / pack) : 0;
      table.insert({ SMART_SELECTED_PRODUCT: toText(product.prod_short), SMART_SELECTED_ADDON1: selectedAddon(product, 0), SMART_SELECTED_ADDON2: selectedAddon(product, 1), SMART_SELECTED_ADDON3: selectedAddon(product, 2), SMART_SELECTED_ADDON4: selectedAddon(product, 3), ROW_DATA_TYPE: "LED",
        PROD_SHORT: lic21 ? "." : product.prod_short, PROD_DESC: product.prod_desc, OPEN_QTY: opening, ADD_QTY: add, LESS_QTY: less, CLSG_QTY: closing,
        ...(lic21 ? { STD_PACK: product.base_pack === null ? null : pack, CARTONS: cartons, LOOSE_QTY: closing !== 0 && pack > 1 ? r2(closing - r2(pack * cartons)) : 0 } : {}),
        ...Object.fromEntries(aliases.map((alias) => [alias, product[alias]])) });
    }
    return table;
  }

  // By the ticked addon groups, then the product (the procedure's last select).
  const selectedAddon = (row: ResultRow, at: number) => toText(row[`SMART_SELECTED_ADDON${at + 1}`]);
  products.sort((a, b) => { for (const at of addonLevels) { const compare = sqlServerCompare(selectedAddon(a, at), selectedAddon(b, at)); if (compare !== 0) return compare; } return sqlServerCompare(toText(a.prod_short), toText(b.prod_short)); });

  if (withDate) return stockSummaryWithDate();

  const table = new ResultTable();
  for (const column of ["SMART_SELECTED_PRODUCT", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "ROW_DATA_TYPE", "PROD_SHORT", "PROD_DESC", ...(check("BARCODE") ? ["BAR_CODE"] : [])]) table.addColumn(column);
  const quantity = ["OPEN_QTY", "PURCH_QTY", "CR_QTY", "CHLNIN_QTY", ...(rpl ? ["PRODUCTION"] : []), "STOCK_ADD", "STOCK_JV_ADD", "SALE_QTY", "DR_QTY", "CHLNOUT_QTY", ...(rpl ? ["CONSUMPTION"] : []), "STOCK_LESS", "STOCK_JV_LESS", "DAMAGEIN_QTY", "DAMAGEOUT_QTY", "CLSG_QTY"];
  for (const column of quantity) table.setKind(column, "decimal");
  if (call.licence === 21) table.setKind("ACT_RATE", "decimal");
  const headingAliases = addonLevels.map((at) => addonAlias(call.headingAddon[at]));
  for (const alias of headingAliases) if (alias !== "") table.addColumn(alias);
  const seenLines = new Set<string>();
  for (const product of products) {
    const key = num(product.prod_key);
    // The same product under the same addon values is one line (the procedure groups by them).
    const lineKey = `${key}|${addonLevels.map((at) => selectedAddon(product, at)).join("|")}`;
    if (seenLines.has(lineKey)) continue;
    seenLines.add(lineKey);
    const moved = period.get(key);
    const opening = Math.round((num(product.opening) + net(before.get(key))) * 10000) / 10000;
    const values: Record<string, number> = { OPEN_QTY: opening };
    names.forEach((name) => { values[name.toUpperCase()] = Math.round(num(moved?.[name]) * 10000) / 10000; });
    if (quantity.slice(0, -1).every((column) => values[column] === 0)) continue;
    values.CLSG_QTY = Math.round((values.OPEN_QTY + values.PURCH_QTY + values.CR_QTY + values.CHLNIN_QTY + (values.PRODUCTION ?? 0) + values.STOCK_ADD + values.STOCK_JV_ADD + (rpl ? values.DAMAGEIN_QTY : 0) - values.SALE_QTY - values.DR_QTY - values.CHLNOUT_QTY - (values.CONSUMPTION ?? 0) - values.STOCK_LESS - values.STOCK_JV_LESS - (rpl ? values.DAMAGEOUT_QTY : 0)) * 10000) / 10000;
    table.insert({ SMART_SELECTED_PRODUCT: toText(product.prod_short), SMART_SELECTED_ADDON1: selectedAddon(product, 0), SMART_SELECTED_ADDON2: selectedAddon(product, 1), SMART_SELECTED_ADDON3: selectedAddon(product, 2), SMART_SELECTED_ADDON4: selectedAddon(product, 3), ROW_DATA_TYPE: "LED", PROD_SHORT: product.prod_short, PROD_DESC: product.prod_desc, ...(check("BARCODE") ? { BAR_CODE: product.bar_code } : {}), ...Object.fromEntries(headingAliases.filter((alias) => alias !== "").map((alias) => [alias, product[alias]])), ...values, ...(call.licence === 21 ? { ACT_RATE: num(product.act_rate) } : {}) });
  }
  return table;
}

// ======================================================================================
// 16: PARTYWISE STOCK (SP_STD_RPT_PWISESTOCK, called at line 8563) - the Detail format
// ======================================================================================
//
// Each stock line of the chosen book (Sale, Cash Sale or Purchase) under its party: date, voucher,
// product, quantity in / out, rate, purchase and sale value, and one column for each product-wise
// slab (discounts, taxes) with its percentage. The slab columns are pivoted from LEDGER_EXT as the
// procedure does: its heading list is built slab by slab (books 8 then 13) and NET_AMOUNT and the
// tax descriptions are only worked out when the setup has exactly one master (tax) slab.
//
// Not ported: the "Summary For Period Selected" format (SP_REPORT_FORMATING), godown / batch
// addons on the lines, and the licence 37 and 51 variants.

export async function partyStock(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const book = call.fcValue;
  const licence = call.licence;
  if (call.formating.toUpperCase().includes("SUMM")) return partyStockSummary(loader, plan);
  if ([37, 51].includes(licence)) throw new ReportRefusal(`The licence ${licence} variant of the Partywise Stock is not available in the web version yet.`, "Not ported yet");
  void check;

  // Product-wise slabs of the year for books 8 and 13 (CUR_SLAB).
  const slabs = (await runReportSql(loader, frag(`SELECT slab_key, slab_short, slab_master, slab_mathop FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' AND SLAB_ACTIVE = 'Y' and BOOK in (8,13) ORDER BY BOOK, SLAB_ORDER`))).rows;
  const productSlabs = (await runReportSql(loader, frag(`Select COUNT(*) AS n FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' AND SLAB_ACTIVE = 'Y' and BOOK = ${book}`))).rows[0];
  const withSlabs = num(productSlabs?.n) > 0;

  // The headings, in the order the procedure adds them.
  const headings: string[] = [];
  let heading1 = "";
  let columnTotal = "case when PURCH_VALUE = 0 then [SALE_VALUE] else [PURCH_VALUE] end";
  let taxSr = 0;
  const slabKeys: number[] = [];
  const add = (name: string) => { if (!headings.includes(name)) headings.push(name); };
  if (withSlabs) {
    for (const slab of slabs) {
      const short = toText(slab.slab_short);
      const master = toText(slab.slab_master) === "Y";
      slabKeys.push(num(slab.slab_key));
      if (!master && taxSr === 0 && !columnTotal.includes(short)) columnTotal += toText(slab.slab_mathop) === "L" ? `-abs(${short})` : `+${short}`;
      if (headings.length === 0) { add(short); add(`${short}_%`); heading1 += `[${short}]`; }
      else {
        if (master) {
          if (taxSr === 0) { add("NET_AMOUNT"); add("TAX_DESCRIPTION"); heading1 += ",[NET_AMOUNT],[TAX_DESCRIPTION]"; }
          else if (heading1.includes(",[TAX_DESCRIPTION1]")) { /* the purchase book's own tax slabs: no new column */ }
          else { add("TAX_DESCRIPTION1"); heading1 += ",[TAX_DESCRIPTION1]"; }
          taxSr += 1;
        }
        if (!heading1.includes(short)) heading1 += `,[${short}]`;
        if (!headings.some((name) => name.includes(short))) { add(short); if (!master) add(`${short}_%`); }
      }
    }
  }

  // The lines.
  const inner = call.from_.slice(call.from_.indexOf("sys.ledext.bstart") + "sys.ledext.bstart".length, call.from_.indexOf("sys.ledext.join sys.ledext.bend"));
  const from = licence === 21 || call.acAddonRepdefa.includes("E") ? ` from ((${inner}) left join ${db}ADDON_AENTRY aentry on aentry.AONA_LEDID = PRODLED.LED_ID)` : ` from (${inner})`;
  let select = call.queryStart.split("sys.col.slabcol,").join("").split("sys.col.slabrate,").join("");
  select = licence === 21 ? select.split("sys.col.box_qty").join('PRODLED.BUNDLE AS "BOX_QTY"') : select.split("sys.col.box_qty,").join("");
  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);
  let where = `${call.where.split("|sys.yearid|").join(call.yearId)} and PRODUCT.INVENTORY = 'Y' and PRODLED.INVENTORY = 'Y' AND PRODLED.IL_DATE >= '${fromText}' AND PRODLED.IL_DATE <= '${uptoText}'`;
  const drCrBook = num((await runReportSql(loader, frag(`SELECT COUNT(*) AS n FROM ${db}BOOK_PROPERTIES WHERE STKM_POS <> 'D' and BOOK_KEY = ${book === 8 ? 8 : 13} and POSITION(' 2, 3,' IN BS_ACHELP) > 0`))).rows[0]?.n) > 0;
  if (book === 8) where += drCrBook && licence !== 21 ? " and (PRODLED.BOOK = 16 or PRODLED.BOOK = 8)" : " and (PRODLED.BOOK = 13 or PRODLED.BOOK = 16 or PRODLED.BOOK = 11 or PRODLED.BOOK = 8) and ac.book = 2";
  else if (book === 9) where += " and PRODLED.BOOK = 9 and ac.book = 2";
  else where += drCrBook && licence !== 21 ? ` and (PRODLED.BOOK = 11 or PRODLED.BOOK = ${book})` : ` and (PRODLED.BOOK = 8 or PRODLED.BOOK = 11 or PRODLED.BOOK = 16 or PRODLED.BOOK = ${book}) and ac.book = 3`;
  const result = await runReportSql(loader, frag(`SELECT ${select}, PRODLED.BOOK AS "line_book" ${from} ${where} ORDER BY AC.NAME, TO_CHAR(PRODLED.IL_DATE,'YYYYMMDD'), PRODLED.DOC_NO1`));
  const table = tableFromResult(result);
  for (const column of ["ADD_QTY", "LESS_QTY", "BOX_QTY", "RATE", "PURCH_VALUE", "SALE_VALUE"]) if (table.has(column)) table.setKind(column, "decimal");

  if (headings.length > 0) {
    const ilKeys = table.rows.map((row) => num(table.get(row, "IL_KEY")));
    const ext = ilKeys.length === 0 ? [] : (await runReportSql(loader, frag(`SELECT ledext1.il_id AS "il_id", slabmst.slab_short AS "short", coalesce(ledext1.slab_perc,0.00)::numeric AS "perc", ledext1.slab_amt::numeric AS "amt" FROM ${db}LEDGER_EXT ledext1 left join ${db}SLAB_MASTER slabmst on ledext1.SLAB_ID = slabmst.SLAB_KEY WHERE ledext1.il_id = ANY($1::int[]) and ledext1.SLAB_ID in (${slabKeys.join(",")})`), [ilKeys])).rows;
    const bySlabLine = new Map<number, ResultRow[]>();
    for (const row of ext) bySlabLine.set(num(row.il_id), [...(bySlabLine.get(num(row.il_id)) ?? []), row]);
    for (const name of headings) table.setKind(name, "decimal");
    for (const name of ["NET_AMOUNT", "TAX_DESCRIPTION", "TAX_DESCRIPTION1"]) if (headings.includes(name) && name !== "NET_AMOUNT") table.setKind(name, "int");
    const plus = book === 8 ? [8, 11] : [13, 16];
    for (const row of table.rows) {
      const lineBook = num(table.get(row, "line_book"));
      for (const slab of bySlabLine.get(num(table.get(row, "IL_KEY"))) ?? []) {
        const short = toText(slab.short);
        if (short === "") continue;
        const amount = plus.includes(lineBook) ? num(slab.amt) : -num(slab.amt);
        if (headings.includes(short)) table.set(row, short, Math.round((num(table.get(row, short)) + amount) * 100) / 100);
        if (headings.includes(`${short}_%`)) table.set(row, `${short}_%`, Math.round((num(table.get(row, `${short}_%`)) + num(slab.perc)) * 100) / 100);
      }
    }
    // The net amount (the value less the discounts, before the tax) is worked out whenever the book has a tax slab. The procedure does it only when there is exactly one master slab, so with
    // GST (a master slab for the CGST and a linked one for the SGST / UTGST) its NET_AMOUNT came out empty; here it is filled.
    if (taxSr >= 1) {
      const names = ["TAX_DESCRIPTION", "TAX_DESCRIPTION1"].filter((name) => headings.includes(name));
      void names;
      for (const row of table.rows) {
        let total = num(table.get(row, "PURCH_VALUE")) === 0 ? num(table.get(row, "SALE_VALUE")) : num(table.get(row, "PURCH_VALUE"));
        for (const slab of slabs) if (toText(slab.slab_master) !== "Y") total += toText(slab.slab_mathop) === "L" ? -Math.abs(num(table.get(row, toText(slab.slab_short)))) : num(table.get(row, toText(slab.slab_short)));
        table.set(row, "NET_AMOUNT", Math.round(total * 100) / 100);
      }
    }
  }
  dropColumn(table, "line_book");
  sortRows(table, [(row) => textKey(table.get(row, "SORTING_COL"))]);
  return table;
}

/**
 * SP_FRT_RPT_PWISESTOCK, the "Summary For Period Selected" format: one row for each party and product (the product's description), with the quantity in and out
 * (the entry's quantity less what was set against another), the purchase and sale value, and with product-wise slabs a column for each slab (a row for each entry
 * line, as the procedure groups on IL_KEY then). The slabs that lessen the value are taken off, the others added, on the lines that have a value.
 */
async function partyStockSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const book = call.fcValue;
  const licence = call.licence;
  if ([37, 51].includes(licence)) throw new ReportRefusal(`The licence ${licence} variant of the Partywise Stock is not available in the web version yet.`, "Not ported yet");
  const slabs = num((await runReportSql(loader, frag(`Select COUNT(*) AS n FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' AND SLAB_ACTIVE = 'Y' and BOOK = ${book}`))).rows[0]?.n) > 0
    ? (await runReportSql(loader, frag(`SELECT slab_key, slab_short, slab_master, slab_mathop FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = '${desktopDate(call.tarikh1)}' AND SLAB_ACTIVE = 'Y' and BOOK = ${book} ORDER BY SLAB_ORDER`))).rows
    : [];
  // The slab amounts of a line are read once for all the lines (a subquery for each line is slow); the first master slab also gives the net amount (the value less the discounts).
  const slabColumns: string[] = [];
  let tax = 0;
  for (const slab of slabs) {
    if (toText(slab.slab_master) === "Y") { if (tax === 0) slabColumns.push("NET_AMOUNT"); tax += 1; }
    slabColumns.push(toText(slab.slab_short));
  }
  const lic21 = licence === 21;
  const heads = call.headingAddon.filter((text) => text.trim() !== "");
  const select = [`ac.Name AS "NAME"`, `PRODUCT.PROD_DESC AS "SELECTED_PRODUCT"`, `COALESCE(SUM(CASE PRODLED.STOCK_NAT WHEN 'A' THEN PRODLED.QUANTITY - PRODLED.AG_QTY ELSE 0.00 END),0.00) AS "ADD_QTY"`,
    `COALESCE(SUM(CASE PRODLED.STOCK_NAT WHEN 'L' THEN PRODLED.QUANTITY - PRODLED.AG_QTY ELSE 0.00 END),0.00) AS "LESS_QTY"`,
    ...(lic21 ? [`COALESCE(SUM(CASE PRODLED.STOCK_NAT WHEN 'L' THEN PRODLED.BUNDLE ELSE 0.00 END),0.00) AS "BOX_QTY"`] : []), ...(slabColumns.length > 0 ? [`PRODLED.IL_KEY AS "il_key"`, ...slabColumns.map((name) => `0::numeric AS "${name}"`)] : []),
    `COALESCE(SUM(case PRODLED.STOCK_NAT WHEN 'A' then PRODLED.IL_VALUE else 0.00 end),0.00) AS "PURCH_VALUE"`, `COALESCE(SUM(case PRODLED.STOCK_NAT WHEN 'L' then PRODLED.IL_VALUE else 0.00 end),0.00) AS "SALE_VALUE"`, ...heads,
    ...(num((await runReportSql(loader, frag(`Select CASE WHEN POSITION('X_MRP,' IN entry_para) = 0 THEN 1 ELSE 0 END AS n FROM ${db}SETUP`))).rows[0]?.n) === 1 ? [`ROUND(sum(PRODLED.MASTER_RATE*PRODLED.QUANTITY),2) AS "MRP_VALUE"`] : [])];
  const inner = call.from_.slice(call.from_.indexOf("sys.ledext.bstart") + "sys.ledext.bstart".length, call.from_.indexOf("sys.ledext.join sys.ledext.bend"));
  const from = licence === 21 || call.acAddonRepdefa.includes("E") ? ` from ((${inner}) left join ${db}ADDON_AENTRY aentry on aentry.AONA_LEDID = PRODLED.LED_ID)` : ` from (${inner})`;
  let where = `${call.where.split("|sys.yearid|").join(call.yearId)} and PRODUCT.INVENTORY = 'Y' and PRODLED.INVENTORY = 'Y' AND PRODLED.IL_DATE >= '${desktopDate(call.from)}' AND PRODLED.IL_DATE <= '${desktopDate(call.upto)}'`;
  if (book === 8) where += " and (PRODLED.BOOK = 13 or PRODLED.BOOK = 16 or PRODLED.BOOK = 8) and ac.book = 2";
  else if (book === 9) where += " and PRODLED.BOOK = 9 and ac.book = 2";
  else where += ` and (PRODLED.BOOK = 8 or PRODLED.BOOK = 11 or PRODLED.BOOK = ${book}) and ac.book = 3`;
  const withoutName = (text: string) => text.split(",").map((part) => part.trim()).filter((part) => part !== "" && part.toUpperCase() !== "AC.NAME");
  const groupBy = [...withoutName(call.groupBy), "AC.NAME", "PRODUCT.PROD_DESC", ...(slabColumns.length > 0 ? ["PRODLED.IL_KEY"] : [])];
  const addonOrder = heads.map((text) => /as\s+"([^"]+)"/i.exec(text)?.[1] ?? "").filter((name) => name !== "").map((name) => `"${name}"`);
  const result = await runReportSql(loader, frag(`SELECT ${select.join(", ")}${from} ${where} GROUP BY ${groupBy.join(", ")} ORDER BY ${[...addonOrder, `"NAME"`, `"SELECTED_PRODUCT"`].join(", ")}`));
  const table = tableFromResult(result);
  if (slabColumns.length > 0) {
    const lines = [...new Set(table.rows.map((row) => num(table.get(row, "il_key"))))];
    const amounts = new Map<string, { amount: number; net: number }>();
    if (lines.length > 0) {
      const slabKeys = slabs.map((slab) => num(slab.slab_key));
      for (const row of (await runReportSql(loader, frag(`SELECT il_id AS "il_id", slab_id AS "slab_id", sum(slab_amt)::numeric AS "amount", sum(s_lastot::numeric - slab_amt::numeric) AS "net" FROM ${db}LEDGER_EXT WHERE il_id = ANY($1::int[]) AND slab_id = ANY($2::int[]) GROUP BY il_id, slab_id`), [lines, slabKeys])).rows) amounts.set(`${num(row.il_id)}|${num(row.slab_id)}`, { amount: num(row.amount), net: num(row.net) });
    }
    for (const row of table.rows) {
      for (const slab of slabs) {
        const found = amounts.get(`${num(table.get(row, "il_key"))}|${num(slab.slab_key)}`);
        table.set(row, toText(slab.slab_short), found?.amount ?? 0);
      }
      const firstMaster = slabs.find((slab) => toText(slab.slab_master) === "Y");
      if (firstMaster !== undefined) table.set(row, "NET_AMOUNT", amounts.get(`${num(table.get(row, "il_key"))}|${num(firstMaster.slab_key)}`)?.net ?? 0);
    }
    dropColumn(table, "il_key");
  }
  for (const column of ["ADD_QTY", "LESS_QTY", "BOX_QTY", "PURCH_VALUE", "SALE_VALUE", "NET_AMOUNT", "MRP_VALUE", ...slabs.map((slab) => toText(slab.slab_short))]) if (table.has(column)) table.setKind(column, "decimal");
  // The slabs that lessen the value come off it, the others go on (only on the lines that have a value).
  const adjust = slabs.map((slab) => `${toText(slab.slab_mathop) === "L" ? "-" : "+"}${toText(slab.slab_short)}`);
  if (adjust.length > 0) {
    for (const row of table.rows) {
      const change = slabs.reduce((total, slab) => total + (toText(slab.slab_mathop) === "L" ? -1 : 1) * num(table.get(row, toText(slab.slab_short))), 0);
      for (const column of ["SALE_VALUE", "PURCH_VALUE"]) if (num(table.get(row, column)) !== 0) table.set(row, column, Math.round((num(table.get(row, column)) + change) * 100) / 100);
    }
  }
  return table;
}

// ======================================================================================
// 93: STOCK MOVEMENT (SP_FRT_RPT_STOCK_MOVEMENT, called from SP_REPORT_FORMATING)
// ======================================================================================
//
// REPORT = Sale: one line per product with its closing stock now (PROD_BALANCE.CLSG_PCS) and the
// quantity sold in the period (sales book 8 less credit notes 16, the entries only), then the
// products in stock that did not sell, with 0. REPORT = Stock: one line per product with its
// closing stock. The ticked groups (addons) are columns, the lines sort on them and then on the
// description. "None Moveble" sorts on the quantity, lowest first, and "Moveble" on the quantity,
// highest first. Quantity Gap Column Required puts the quantity in ten bands of 30 days' (or the
// typed number's) worth and one for the rest.
//
// Not ported: the Godown selections, and licences 2, 7, 16, 22 and 29 (they read other columns).

export async function stockMovement(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const licence = call.licence;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const notPorted = (what: string) => new ReportRefusal(`${what} of the Stock Movement is not available in the web version yet.`, "Not ported yet");
  if ([2, 7, 16, 22, 29].includes(licence)) throw notPorted(`The licence ${licence} columns`);
  if (call.addon.some((text) => text.toUpperCase().includes("GODOWN"))) throw notPorted("The Godown selection");
  const sale = call.fcText.toUpperCase() === "SALE";
  const format = call.formating.toUpperCase();
  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);
  const heads = call.headingAddon.filter((text) => text !== "");
  const selected = call.selectedAddon.filter((text) => text !== "");
  const addons = call.addon.filter((text) => text !== "");
  const headColumns = heads.length === 0 ? "" : `, ${heads.join(", ")}, ${selected.join(", ")}`;
  const addonNames = heads.map((text) => /as\s+"(\w+)"/i.exec(text)?.[1] ?? "").filter((name) => name !== "");
  const from = call.from_.split("sys.aent.bstart").join("").split("sys.aent.bend").join("");
  const where = call.where.split("|sys.yearid|").join(call.yearId);

  // ---- the lines ----
  const amount = "(PRODLED.QUANTITY - PRODLED.AG_QTY)";
  const groupBy = ["product.prod_key", "product.prod_short", "product.PROD_DESC", "prodbal.CLSG_PCS", ...addons].join(", ");
  const sql = sale
    ? `SELECT product.prod_key AS "prod_key", product.prod_short AS "PRODUCT_CODE", product.PROD_DESC AS "DESCRIPTION", prodbal.CLSG_PCS::numeric AS "CLOSING",`
      + ` SUM(case when prodled.book=16 then ${amount}*-1 when prodled.book=11 then ${amount}*-1 else ${amount} end)::numeric AS "QUANTITY"${headColumns}`
      + ` ${from} ${where} AND IL_DATE BETWEEN '${fromText}' AND '${uptoText}' and PRODLED.INVENTORY='Y' and PRODLED.il_pos='A' and (prodled.book=8 or prodled.book=16) and PRODUCT.last_date is null and prodled.led_id is not null and prodbal.prec_flag='RP'`
      + ` GROUP BY ${groupBy}`
    : `SELECT product.prod_short AS "PRODUCT_CODE", product.PROD_DESC AS "DESCRIPTION", SUM(prodbal.clsg_pcs)::numeric AS "QUANTITY"${headColumns}`
      + ` FROM ${db}PRODUCT_MASTER PRODUCT left join ${db}ADDON_DATA adata on adata.prod_id=product.prod_key left join ${db}PROD_BALANCE prodbal on prodbal.prod_id=product.prod_key ${where} and PRODUCT.last_date is null and prodbal.prec_flag='RP'`
      + ` GROUP BY ${["product.prod_short", "product.PROD_DESC", ...addons].join(", ")}`;
  const table = tableFromResult(await runReportSql(loader, frag(sql)));
  for (const column of ["CLOSING", "QUANTITY"]) if (table.has(column)) table.setKind(column, "decimal");

  // ---- the products in stock that did not sell ----
  if (sale) {
    const sold = table.rows.map((row) => num(table.get(row, "prod_key")));
    const keyFilter = (() => {
      const index = call.addon.findIndex((text) => text !== "");
      return index < 0 ? "" : ` and ${call.addon[index].replace(" adata.txt_", " adata.key_")} in ${call.selectKey[index]}`;
    })();
    const rest = await runReportSql(loader, frag(`SELECT product.prod_key AS "prod_key", product.prod_short AS "PRODUCT_CODE", product.PROD_DESC AS "DESCRIPTION", prodbal.CLSG_PCS::numeric AS "CLOSING", 0::numeric AS "QUANTITY"${headColumns}`
      + ` FROM ${db}PRODUCT_MASTER product left join ${db}PROD_BALANCE prodbal on prodbal.prod_id=product.prod_key left join ${db}ADDON_DATA adata on adata.prod_id=product.prod_key`
      + ` WHERE prodbal.prec_flag='RP' and prodbal.clsg_pcs>0${keyFilter}${call.selectKey[4] !== "" ? ` and product.prod_key in ${call.selectKey[4]}` : ""}`
      + ` and product.inventory='Y' and product.last_date is null and product.prod_pos<>'D' and NOT (product.prod_key = ANY($1::int[]))`), [sold]);
    for (const row of rest.rows) table.insert(row);
    dropColumn(table, "prod_key");
  }

  // ---- the quantity gap ----
  if (check("CHK_QTYGAP")) {
    const step = call.text[0] !== undefined && call.text[0].trim() !== "" ? Math.trunc(Number(call.text[0])) : 0;
    const bands: { name: string; low: number; high: number }[] = [];
    if (step > 0) {
      bands.push({ name: `Qty_0_To_${step}`, low: -99999, high: step });
      for (let at = 2; at <= 10; at += 1) bands.push({ name: `Qty_${(at - 1) * step + 1}_To_${at * step}`, low: (at - 1) * step + 1, high: at * step });
      bands.push({ name: `Qty_${10 * step + 1}_To_9999999`, low: 10 * step + 1, high: 9999999 });
    } else {
      const edges = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
      bands.push({ name: "Qty_0_To_30", low: -99999, high: 30 });
      edges.slice(0, -1).forEach((edge, at) => bands.push({ name: `Qty_${edge + 1}_To_${edges[at + 1]}`, low: edge + 1, high: edges[at + 1] }));
      bands.push({ name: "Qty_301_TO_999999", low: 301, high: 999999 });
    }
    for (const band of bands) table.setKind(band.name, "int");
    for (const row of table.rows) {
      const quantity = num(table.get(row, "QUANTITY"));
      for (const band of bands) table.set(row, band.name, quantity >= band.low && quantity <= band.high ? Math.round(quantity) : 0);
    }
  }

  // ---- the order ----
  const text = (name: string) => (row: ResultRow) => textKey(table.get(row, name));
  const addonKeys = addonNames.filter((name) => table.has(name)).map((name) => text(name));
  const quantityKey = (row: ResultRow) => num(table.get(row, "QUANTITY"));
  if (sale && format === "NONE MOVEBLE") sortRows(table, [quantityKey, ...addonKeys]);
  else if (sale && format === "MOVEBLE") sortRows(table, [(row: ResultRow) => -quantityKey(row), ...addonKeys]);
  else sortRows(table, [...addonKeys, text("DESCRIPTION")]);
  return table;
}

// ======================================================================================
// 258: MONTHLY CLOSING STOCK (SP_FRT_RPT_MONTHLY_CLOSING_STOCK, called from SP_REPORT_FORMATING)
// ======================================================================================
//
// One line per product (by description, with the ticked groups' columns) and a column for each
// month of the year, April to March: the year's opening quantity (PROD_BALANCE.OPEN_PCS) plus
// everything that came in less everything that went out (quantity less what was set against
// another entry) up to that month's last day. Products with no stock in any month are left out.
// The months follow the year, not the Upto date, so a month still to come shows today's stock.

export async function monthlyClosingStock(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  if (call.addon.some((text) => text.toUpperCase().includes("GODOWN"))) throw new ReportRefusal("The Godown selection of the Monthly Closing Stock is not available in the web version yet.", "Not ported yet");
  const months = ["APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER", "JANUARY", "FEBRUARY", "MARCH"];
  const firstYear = call.tarikh1.getFullYear();
  const secondYear = call.tarikh2.getFullYear();
  // Each month's last day, as the procedure spells it ('30/Apr/2026').
  const names = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const ends = names.map((name, at) => {
    const year = at < 9 ? firstYear : secondYear;
    const month = (at + 3) % 12;
    return `${new Date(year, month + 1, 0).getDate()}/${name}/${year}`;
  });

  const heads = call.headingAddon.filter((text) => text !== "");
  const selected = call.selectedAddon.filter((text) => text !== "");
  const addons = call.addon.filter((text) => text !== "");
  const headColumns = heads.length === 0 ? "" : `, ${heads.join(", ")}, ${selected.join(", ")}`;
  const headNames = heads.map((text) => /as\s+"(\w+)"/i.exec(text)?.[1] ?? "").filter((name) => name !== "");
  const filters = call.addon.map((text, index) => (text === "" ? "" : ` and ${text.replace(" adata.txt_", " adata.key_")} in ${call.selectKey[index]}`)).join("");
  const keyFilter = call.selectKey[4] !== "" ? ` and prodmas.PROD_KEY in ${call.selectKey[4]}` : "";

  // The products with their opening, then every product's movement up to each month's end.
  const products = (await runReportSql(loader, frag(`SELECT prodmas.PROD_KEY AS "prod_key", prodmas.PROD_DESC AS "Description", SUM(prodbal.OPEN_PCS)::numeric AS "open_qty"${headColumns}`
    + ` FROM ${db}PRODUCT_MASTER prodmas left join ${db}PROD_BALANCE prodbal on prodbal.PROD_ID = prodmas.PROD_KEY left join ${db}ADDON_DATA adata on adata.PROD_ID = prodmas.PROD_KEY`
    + ` WHERE prodmas.PROD_POS = 'A' and prodbal.PREC_FLAG = 'RP'${keyFilter}${filters}`
    + ` GROUP BY ${["prodmas.prod_key", "prodmas.PROD_DESC", ...addons].join(", ")}`))).rows;
  const ids = products.map((row) => num(row.prod_key));
  const movement = new Map<number, ResultRow>();
  if (ids.length > 0) {
    const columns = ends.map((end, at) => `COALESCE(SUM(CASE WHEN IL_DATE <= '${end}' THEN (CASE WHEN stock_nat = 'A' THEN (quantity - ag_qty) ELSE (quantity - ag_qty) * -1 END) ELSE 0 END),0)::numeric AS "m${at}"`).join(", ");
    const rows = (await runReportSql(loader, frag(`SELECT prod_id AS "prod_id", ${columns} FROM ${db}PROD_LEDGER WHERE prod_id = ANY($1::int[]) and il_pos = 'A' and INVENTORY = 'Y' GROUP BY prod_id`), [ids])).rows;
    for (const row of rows) movement.set(num(row.prod_id), row);
  }

  const table = new ResultTable();
  table.addColumn("Description");
  for (const month of months) table.setKind(month, "decimal");
  for (const name of headNames) table.addColumn(name);
  selected.forEach((_, at) => table.addColumn(`SMART_SELECTED_ADDON${at + 1}`));
  const lines = new Map<string, ResultRow>();
  for (const product of products) {
    const moved = movement.get(num(product.prod_key));
    const key = [toText(product.Description), ...headNames.map((name) => toText(product[name])), ...selected.map((_, at) => toText(product[`SMART_SELECTED_ADDON${at + 1}`]))].join("\u0001");
    let line = lines.get(key);
    if (!line) {
      line = table.insert({ Description: product.Description });
      for (const name of headNames) table.set(line, name, product[name] ?? null);
      selected.forEach((_, at) => table.set(line!, `SMART_SELECTED_ADDON${at + 1}`, product[`SMART_SELECTED_ADDON${at + 1}`] ?? null));
      months.forEach((month) => table.set(line!, month, 0));
      lines.set(key, line);
    }
    months.forEach((month, at) => table.set(line!, month, Math.round((num(table.get(line!, month)) + num(product.open_qty) + num(moved?.[`m${at}`])) * 100) / 100));
  }
  // Products with no stock in any month are not shown.
  table.rows = table.rows.filter((row) => months.some((month) => num(table.get(row, month)) !== 0));
  sortRows(table, [...headNames.map((name) => (row: ResultRow) => textKey(table.get(row, name))), (row: ResultRow) => textKey(table.get(row, "Description"))]);
  return table;
}

// ---- SP_FRT_RPT_DROP_ANALYSIS (report 232) and SP_FRT_RPT_PARTY_BILL_PDF (report 255): kept here, in the one program, not in files of their own ----
/**
 * SP_FRT_RPT_DROP_ANALYSIS' SQL and pivot, apart from the database (so they can be tested on their own). PostgreSQL; the SQL Server original is
 * quoted where it differs. A "drop" is one sale invoice (party) or one sale line (product); the figure is their count, quantity or amount.
 */
type DropMeasure = "count" | "quantity" | "amount";

type DropAddon = { save: string; text: boolean };

const DROP_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"] as const;
const LONG_MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/** 'Drop Count' / 'Quantity' / 'Amount' (the sorting combo's text); anything else leaves the desktop with no select, so the count is used. */
function dropMeasure(sortingText: string): DropMeasure {
  const text = sortingText.trim().toLowerCase();
  return text === "quantity" ? "quantity" : text === "amount" ? "amount" : "count";
}

type DropWindow = { from: string; upto: string; days: string[] };

const dropPad = (n: number): string => String(n).padStart(2, "0");

/**
 * The month the first combo names: January to March are in the year the financial year ends, April to December in the year it starts. February
 * ends on the 28th or 29th by the end year's leap year. The days are the pivot's columns "01".."31". Null when the text is no month.
 */
function dropWindow(monthText: string, startYear: number, endYear: number): DropWindow | null {
  const index = LONG_MONTHS.indexOf(monthText.trim().toUpperCase());
  if (index < 0) return null;
  const year = index <= 2 ? endYear : startYear;
  const last = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  return { from: `${year}-${dropPad(index + 1)}-01`, upto: `${year}-${dropPad(index + 1)}-${dropPad(last)}`, days: Array.from({ length: last }, (_, i) => dropPad(i + 1)) };
}

/** The addon columns of the select (COALESCE(adata.txt_X,'') AS "X") and of the group by. */
const dropAddonSelect = (addons: readonly DropAddon[]): string => addons.map((a) => `COALESCE(adata.${a.text ? "txt_" : "input_"}${a.save},'') AS "${a.save}"`).join(",");
const dropAddonGroup = (addons: readonly DropAddon[]): string => addons.map((a) => `adata.${a.text ? "txt_" : "input_"}${a.save}`).join(",");

type DropQueryInput = {
  db: string;
  product: boolean;
  measure: DropMeasure;
  /** Month-wise (CHK_MONTH): no date window, the bucket is the month's name. */
  monthly: boolean;
  window: DropWindow | null;
  /** SLAB_KEY of the sale book's first master slab (the party's amount). */
  slab: number;
  addons: readonly DropAddon[];
};

/** The rows of TEMP_TABLE_DROP_ANALYSIS1: name, bucket (day "01" or month "Apr"), Drop_Count and the addon columns, ordered by name and bucket. */
function dropQuery(input: DropQueryInput): string {
  const { db, product, measure, monthly, window, slab, addons } = input;
  const dateColumn = product ? "il_date" : "doc_date";
  const bucket = monthly ? `to_char(${dateColumn},'Mon')` : `to_char(${dateColumn},'DD')`;
  const bucketName = monthly ? "Month_Name" : "Day_Name";
  const figure = measure === "count" ? "COUNT(*)"
    : measure === "quantity" ? `sum(${product ? "a" : "d"}.quantity::numeric)`
    : product ? "sum(a.il_value::numeric)"
    : `coalesce((select sum(s_lastot::numeric-slab_amt::numeric) from ${db}LEDGER_EXT where led_id=a.led_key and il_id is null and slab_id=${Math.trunc(slab)}),0)`;
  const nameColumn = product ? `c.PROD_DESC AS "Description"` : `b.name AS "name"`;
  const nameGroup = product ? "c.PROD_DESC" : "b.name";
  const select = `SELECT ${nameColumn},${bucket} as "${bucketName}",${figure} as "Drop_Count"${addons.length > 0 ? `,${dropAddonSelect(addons)}` : ""}`;
  const dates = !monthly && window ? ` and a.${dateColumn} BETWEEN '${window.from}'::date and '${window.upto}'::date` : "";
  const group = `group by ${nameGroup},${bucket}${!product && measure === "amount" ? ",a.led_key" : ""}${addons.length > 0 ? `,${dropAddonGroup(addons)}` : ""} order by ${nameGroup},${bucket}`;
  if (product) {
    return `${select} FROM ${db}PROD_LEDGER a LEFT JOIN ${db}ADDON_DATA adata on adata.PROD_ID=a.PROD_ID LEFT JOIN ${db}PRODUCT_MASTER c on c.PROD_KEY=a.PROD_ID`
      + ` where a.IL_POS='A' and a.book=8 and c.prod_pos='A' and a.led_id is not null and c.inventory='Y' and position('PACKING CHARGE' in c.prod_desc)=0 and position('DELIVERY CHARGES' in c.prod_desc)=0${dates} ${group}`;
  }
  return `${select} FROM ${db}LEDGER a left join ${db}ACCOUNT b on a.CODE=b.CODE LEFT JOIN ${db}ADDON_DATA adata on adata.CODE=b.CODE${measure === "quantity" ? ` LEFT JOIN ${db}PROD_LEDGER d on d.led_id=a.led_key` : ""}`
    + ` where a.DOC_POS='A' and a.DOC_POSTING='P' and a.book=8 and b.a_pos='A'${measure === "quantity" ? " and d.il_pos='A' and d.led_id is not null" : ""}${dates} ${group}`;
}

type DropRow = Record<string, unknown>;

const dropCell = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * PIVOT SUM(Drop_Count) FOR Day_Name / Month_Name IN (...): one line per name and addon values, the figure of each bucket (blank where
 * there was none), then TOTAL = the sum of the cells each cut to an integer (CAST(... AS int)). Ordered by name.
 */
function pivotDrops(rows: readonly DropRow[], nameColumn: string, bucketColumn: string, buckets: readonly string[], addons: readonly string[]): DropRow[] {
  const lines = new Map<string, DropRow>();
  for (const row of rows) {
    const key = JSON.stringify([row[nameColumn], ...addons.map((a) => row[a])]);
    let line = lines.get(key);
    if (!line) {
      line = { [nameColumn]: row[nameColumn] ?? null };
      for (const b of buckets) line[b] = null;
      line.TOTAL = 0;
      for (const a of addons) line[a] = row[a] ?? "";
      lines.set(key, line);
    }
    const bucket = String(row[bucketColumn]);
    if (!buckets.includes(bucket)) continue;
    line[bucket] = (line[bucket] === null ? 0 : dropCell(line[bucket])) + dropCell(row.Drop_Count);
  }
  const result = [...lines.values()];
  for (const line of result) line.TOTAL = buckets.reduce((sum, b) => sum + Math.trunc(dropCell(line[b])), 0);
  return result.sort((a, b) => String(a[nameColumn] ?? "").localeCompare(String(b[nameColumn] ?? ""), "en", { sensitivity: "base" }));
}


/**
 * SP_FRT_RPT_DROP_ANALYSIS (REPORT > Extra > Drop Analysis, report 232): how many drops (sale invoices, or sale lines in the Product format),
 * or what quantity or amount, each customer (or product) had on every day of the month the first combo names, with a TOTAL; the Month-wise
 * option (CHK_MONTH) shows April to March of the whole year instead. The master addon fields follow as columns. The desktop pivots a temp table
 * (TEMP_TABLE_DROP_ANALYSIS_<machine>); here the pivot is made in memory from a read-only query.
 */
export async function dropAnalysis(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const product = call.formating.toUpperCase() === "PRODUCT";
  const monthly = call.checkQuery.includes("CHK_MONTH,");
  const measure = dropMeasure(call.sortingText);
  const window = dropWindow(call.fcText, call.tarikh1.getFullYear(), call.tarikh2.getFullYear())
    ?? { from: toIso(call.from), upto: toIso(call.upto), days: Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")) };

  // The master addon fields: the product's, or the account's that belong to the sale book (' 2,' in FIEL_INBOOK).
  const columnsOf = new Set((await runReportSql(loader, `select lower(column_name) as c from information_schema.columns where table_schema = $1 and table_name = 'addon_data'`, [loader.session.companySchema.toLowerCase()])).rows.map((row) => String(row.c)));
  const addons: DropAddon[] = (await runReportSql(loader, `SELECT btrim(fiel_save) AS save, fiel_type AS kind FROM ${db}ADDON_FLD WHERE fiel_relate = $1 AND fiel_masterpos = 'Y' AND fiel_entrypos = 'N' AND fiel_pos <> 'D'${product ? "" : " AND position(' 2,' in fiel_inbook) > 0"} ORDER BY fiel_key`, [product ? "P" : "A"])).rows
    .map((row) => ({ save: toText(row.save), text: toText(row.kind) === "M" }))
    .filter((a) => /^[A-Za-z0-9_]+$/.test(a.save) && columnsOf.has(`${a.text ? "txt_" : "input_"}${a.save}`.toLowerCase()));

  const slab = !product && measure === "amount"
    ? num((await runReportSql(loader, `SELECT slab_key FROM ${db}SLAB_MASTER WHERE slab_master = 'Y' AND slab_link = 0 AND book = 8 ORDER BY slab_order LIMIT 1`)).rows[0]?.slab_key) : 0;
  const result = await runReportSql(loader, frag(dropQuery({ db, product, measure, monthly, window, slab, addons })));

  const nameColumn = product ? "Description" : "name";
  const buckets: string[] = monthly ? [...DROP_MONTHS] : window.days;
  const names = addons.map((a) => a.save);
  const lines = pivotDrops(result.rows, nameColumn, monthly ? "Month_Name" : "Day_Name", buckets, names);

  const table = new ResultTable();
  for (const column of [nameColumn, ...buckets, "TOTAL", ...names]) table.addColumn(column);
  for (const bucket of buckets) table.setKind(bucket, measure === "count" ? "int" : "decimal");
  table.setKind("TOTAL", "int");
  table.rows = lines;
  return table;
}

const toIso = (date: Date): string => desktopDate(date).replace(/^(\d+)\/(\w+)\/(\d+)$/, (_all, d, m, y) => `${y}-${String(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m) + 1).padStart(2, "0")}-${d}`);

// ======================================================================================
// 30: PARTY SUMMARY (ANALYSIS REP. > Party All Transaction; SP_REPORT_STANDARD branch 30, REPORT_PARTY_SUMMARY)
// ======================================================================================
//
// One line per party ticked with all it did in the period: the opening (the year's opening, plus what posted before From), the
// SALE (or PURCHASE) and its quantity, the returns against the book (credit / debit notes, ag_book) and their quantity, receipts and
// payments (book 4), bank deposits and withdrawals (book 6), given / received (book 5), debit / credit journal (book 19), and the
// closing worked out from them. With SALE, a sale book that also takes creditors (BS_ACHELP " 2, 3,") adds the party's PURCHASE and
// DEBIT_NOTE. The party addon groups ticked (the first four of the order) come first and sort the lines; a party with nothing (the
// opening and every amount 0) is left out. Licences 19, 29, 68 and 73 without a "CA_ENT" account read only the vouchers of live
// books (book_code of an active account) and show no opening and no quantities, as the procedure. Licence 2 counts FACTOR.

export async function partySummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const { session } = loader;
  const db = call.database;
  const licence = session.licence;
  const sale = call.fcValue === 8;
  if (!sale && call.fcValue !== 13) throw new ReportRefusal("Select SALE or PURCHASE", "Report Generation Failed");
  let hideBook = true;
  if ([19, 29, 68, 73].includes(licence)) hideBook = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${db}ACCOUNT WHERE a_pos <> 'D' AND position('CA_ENT' in a_short) > 0`)).rows[0]?.n) > 0;
  const liveBooks = !hideBook && [19, 29, 68, 73].includes(licence);
  const drCrBook = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${db}BOOK_PROPERTIES WHERE stkm_pos <> 'D' AND book_key = ${sale ? 8 : 13} AND position(' 2, 3,' in bs_achelp) > 0`)).rows[0]?.n) > 0;
  const typeKey = num((await runReportSql(loader, `SELECT BOOK_KEY FROM ${db}BOOK_PROPERTIES WHERE STKM_POS = 'A' AND STKM_ID = 'NR' ORDER BY STKMODULE LIMIT 1`)).rows[0]?.book_key);
  const fromIso = toIso(call.from);
  const uptoIso = toIso(call.upto);

  // The party addon groups: the first four pieces of the order (adata.txt_AREA ...); their heading is the field's name.
  const pieces = call.orderBy.split(",").map((piece) => piece.trim()).filter((piece) => piece !== "").slice(0, 4);
  const addons = [0, 1, 2, 3].map((at) => pieces[at] ?? "").map((text) => (/^[a-z]+\.txt_[A-Za-z0-9_]+$/i.test(text) ? text : ""));
  const heads = addons.map((text) => text.replace(/^[a-z]+\.txt_/i, ""));

  // The period's amounts and quantities of each party, in one pass each; a column with no voucher stays NULL, as a SUM of nothing.
  const amount = "l.amount::numeric";
  const live = liveBooks ? ` and l.book_code in (select code from ${db}ACCOUNT where a_pos='A')` : "";
  const sums: [string, string][] = [];
  if (sale) {
    sums.push(["SALE", `l.book=8`]);
    if (!liveBooks && drCrBook) sums.push(["DEBIT_NOTE", `l.ag_book=13`]);
    sums.push(["SALE_RETURN", `l.ag_book=8`]);
    if (!liveBooks && drCrBook) sums.push(["PURCHASE", `l.book=13`]);
  } else {
    sums.push(["PURCHASE", `l.book=13`]);
    sums.push(["PURCH_RETURN", `l.ag_book=13`]);
  }
  for (const [name, condition] of [["RECEIPT_AMT", "l.book=4 and l.ac_dbcode=2"], ["PAYMENT_AMT", "l.book=4 and l.ac_dbcode=1"], ["DEPOSIT", "l.book=6 and l.ac_dbcode=2"], ["WITHDRAWAL", "l.book=6 and l.ac_dbcode=1"],
    ["GIVEN_AMT", "l.book=5 and l.ac_dbcode=2"], ["RECEIVED_AMT", "l.book=5 and l.ac_dbcode=1"], ["DEBIT_AMT", "l.book=19 and l.ac_dbcode=1"], ["CREDIT_AMT", "l.book=19 and l.ac_dbcode=2"]] as const) sums.push([name, condition]);
  // A note against the book counts its own book (credit note 16, debit note 11) and takes the other way off.
  const signed = (name: string) => (name === "SALE_RETURN" ? `case when l.book=16 then ${amount} else -${amount} end`
    : name === "DEBIT_NOTE" || name === "PURCH_RETURN" ? `case when l.book=11 then ${amount} else -${amount} end` : amount);
  const amountSql = `SELECT l.code,${sums.map(([name, condition]) => `sum(case when ${condition} then ${signed(name)} end) AS "${name}"`).join(",")}`
    + ` FROM ${db}LEDGER l WHERE l.doc_pos<>'D' and l.doc_date::date between '${fromIso}' and '${uptoIso}'${live} GROUP BY l.code`;

  const figure = licence === 2 ? "p.factor::numeric" : "p.quantity::numeric";
  const quantities: [string, string, string][] = liveBooks ? [] : sale
    ? [["SALE_QTY", "l.book=8", figure], ...(drCrBook ? [["DNOTE_QTY", `l.ag_book=13 and p."TYPE"<>${typeKey}`, `case when l.book=11 then ${figure} else -${figure} end`] as [string, string, string]] : []),
      ["SALE_RET_QTY", `l.ag_book=8 and p."TYPE"<>${typeKey}`, `case when l.book=16 then ${figure} else -${figure} end`], ...(drCrBook ? [["PURCH_QTY", "l.book=13", figure] as [string, string, string]] : [])]
    : [["PURCH_QTY", "l.book=13", figure], ["PURCH_RET_QTY", `l.ag_book=13 and p."TYPE"<>${typeKey}`, `case when l.book=11 then ${figure} else -${figure} end`]];
  const quantitySql = quantities.length === 0 ? "" : `SELECT l.code,${quantities.map(([name, condition, value]) => `sum(case when ${condition} then ${value} end) AS "${name}"`).join(",")}`
    + ` FROM ${db}LEDGER l JOIN ${db}PROD_LEDGER p ON p.led_id=l.led_key WHERE l.doc_pos<>'D' and p.il_pos<>'D' and l.doc_date::date between '${fromIso}' and '${uptoIso}' GROUP BY l.code`;

  // The opening: the year's (a purchase party's the other way round) plus what posted before From.
  const midYear = call.from.getTime() !== call.tarikh1.getTime();
  const yearOpening = sale ? "acbal.opening::numeric" : "case when acbal.opening::numeric<0 then abs(acbal.opening::numeric) else acbal.opening::numeric*-1 end";
  const opening = liveBooks ? "0" : midYear
    ? `${yearOpening}+coalesce((SELECT sum(case when lp.post_dbcode=${sale ? 1 : 2} then lp.post_amt::numeric else lp.post_amt::numeric*-1 end) FROM ${db}LEDGER_POST lp WHERE lp.post_date::date < '${fromIso}' and lp.post_code=ac.code),0)`
    : yearOpening;

  // The columns in the procedure's order.
  const order = sale
    ? ["SALE", "SALE_QTY", "DEBIT_NOTE", "DNOTE_QTY", "SALE_RETURN", "SALE_RET_QTY", "PURCHASE", "PURCH_QTY"]
    : ["PURCHASE", "PURCH_QTY", "PURCH_RETURN", "PURCH_RET_QTY"];
  const present = new Set([...sums.map(([name]) => name), ...quantities.map(([name]) => name)]);
  const book = order.filter((name) => present.has(name));
  const moves = ["RECEIPT_AMT", "PAYMENT_AMT", "DEPOSIT", "WITHDRAWAL", "GIVEN_AMT", "RECEIVED_AMT", "DEBIT_AMT", "CREDIT_AMT"];
  const valueOf = (name: string) => (quantities.some(([q]) => q === name) ? `q."${name}"` : `a."${name}"`);
  const addonSelect = addons.map((text, at) => `${text === "" ? "''" : text} AS "SMART_SELECTED_ADDON${at + 1}"`).join(",");
  const headSelect = addons.map((text, at) => (text === "" ? "" : `,${text} AS "${heads[at]}"`)).join("");
  const where = call.where.split("|sys.yearid|").join(call.yearId);
  const sql = `WITH a AS (${amountSql})${quantitySql !== "" ? `, q AS (${quantitySql})` : ""}`
    + ` SELECT ac.name AS "SMART_NAME",${addonSelect},ac.name AS "NAME",ac.code AS "AC_CODE",${opening} AS "OPENING",${[...book, ...moves].map((name) => `${valueOf(name)} AS "${name}"`).join(",")},`
    + `0.00::numeric AS "CLOSING_AMT",ac.name AS "SORTING_COL"${headSelect}`
    // The setup's FROM ends in its own brackets: the joins to the sums go after it, the WHERE is the setup's (both read as PostgreSQL).
    + ` ${pgFragment(call.from_, plan, session.companySchema).replace(/\s*$/, "")} LEFT JOIN a ON a.code=ac.code${quantitySql !== "" ? " LEFT JOIN q ON q.code=ac.code" : ""}`;
  const table = tableFromResult(await runReportSql(loader, `${sql}${pgFragment(where, plan, session.companySchema)}`));

  // NULL amounts to 0 (the quantities stay as they are), the closing, and the sorting key of the addon groups.
  const zeroed = ["OPENING", ...book.filter((name) => !quantities.some(([q]) => q === name)), ...moves];
  const cell = (row: ResultRow, name: string) => num(table.get(row, name));
  for (const row of table.rows) {
    for (const name of zeroed) if (table.get(row, name) === null || table.get(row, name) === undefined) table.set(row, name, 0);
    const v = (name: string) => cell(row, name);
    let closing = sale
      ? v("OPENING") + v("SALE") + (drCrBook && !liveBooks ? v("DEBIT_NOTE") : 0) + v("PAYMENT_AMT") + v("WITHDRAWAL") + v("DEBIT_AMT") + v("RECEIVED_AMT")
        - v("SALE_RETURN") - (drCrBook && !liveBooks ? v("PURCHASE") : 0) - v("RECEIPT_AMT") - v("DEPOSIT") - v("CREDIT_AMT") - v("GIVEN_AMT")
      : v("OPENING") + v("PURCHASE") - v("PAYMENT_AMT") - v("WITHDRAWAL") - v("DEBIT_AMT") - v("RECEIVED_AMT") + v("PURCH_RETURN") + v("RECEIPT_AMT") + v("DEPOSIT") + v("CREDIT_AMT") + v("GIVEN_AMT");
    closing = money(closing);
    if (!sale && closing > 0) closing = -closing;
    table.set(row, "CLOSING_AMT", closing);
    const name = toText(table.get(row, "SMART_NAME"));
    const addon = (at: number) => toText(table.get(row, `SMART_SELECTED_ADDON${at}`));
    let sorting = name;
    if (addons[0] !== "") sorting = `${addon(1)} ${name}`;
    if (addons[1] !== "") sorting = addons[0] !== "" ? `${addon(1)} ${addon(2)} ${name}` : `${addon(2)} ${name}`;
    if (addons[2] !== "") sorting = addons[0] !== "" && addons[1] !== "" ? `${addon(1)} ${addon(2)} ${addon(3)} ${name}` : `${addon(3)} ${name}`;
    if (addons[3] !== "") sorting = addons[0] !== "" && addons[1] !== "" && addons[2] !== "" ? `${sorting} ${addon(4)} ${name}` : `${addon(4)} ${name}`;
    table.set(row, "SORTING_COL", sorting);
  }

  // A party with nothing is left out; the lines in the order of the sorting key.
  const shown = sale ? ["OPENING", "SALE", "SALE_RETURN"] : ["OPENING", "PURCHASE", "PURCH_RETURN"];
  table.rows = table.rows.filter((row) => [...shown, ...moves].some((name) => cell(row, name) !== 0));
  sortRows(table, [(row) => textKey(table.get(row, "SORTING_COL"))]);
  for (const name of ["OPENING", ...book, ...moves, "CLOSING_AMT"]) if (table.has(name)) table.setKind(name, "decimal");
  return table;
}

// ======================================================================================
// 143: SALES ANALYSIS (SP_FRT_RPT_SALES_ANALYSIS, ANALYSIS REP. > Sales Analysis)
// ======================================================================================
//
// One line per inventory product: its sale quantity month by month (SALE_Apr, SALE_May ... from the From month to the Upto month), the
// period's SALE, the closing stock (Clsg_Stk), and the master addon groups ticked. A sale is a sale or credit note line (book 8 / 16) net
// of what was set against another entry (QUANTITY - AG_QTY, to a whole number); a return line counts against it.
//  - Purchase Required (CHK_PURCHASE): PURCH_<Mon> before each month's sale, and a PURCHASE total (book 13 / 11).
//  - Daily Sale Require (CHK_DAILY): a column per day and month instead (Apr_1, May_1 ... Mar_1, Apr_2 ...), in the desktop's order;
//    it takes no Previous Sale and leaves every product in (the desktop's delete there never matches).
//  - Previous Sale Column Require (CHK_PRVSALE): PSALE, the sale of every earlier year of the company (its other year databases).
//  - Zero Closing Stock Required (CHK_ZEROSTOCK): keeps the products with no sale, no closing stock and nothing in the months.
// STK_FOR_DAY (licences 7, 51 and 68): the days the closing stock lasts at the period's rate of sale (365 with no sale).
// As the desktop, each month after the first counts from the From date's day of that month (From 15/Apr: May from 15/May).
// The licence branches are the procedure's (2 VINAYAK: TRN_QTY3; 7 / 22 laminates: brand / design / finish / status and the challan
// modules; 19 AKSHAT, 25, 51 HITANSHI, 61 DREAMHOUSE, 68 AYRA, 74 EVA, and the product child / parent setup). Not ported: licence 28 (PRITHVI).

type SalesColumn = { name: string; sql: string };

/** DATEADD(m, 1, date): the same day next month, or that month's last day. */
function addMonth(date: Date): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  return new Date(next.getFullYear(), next.getMonth(), Math.min(date.getDate(), last));
}

const SALES_KEYS = /^\(\s*-?\d+(\s*,\s*-?\d+)*\s*\)$/;

export async function salesAnalysis(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const { session } = loader;
  const db = call.database;
  const licence = session.licence;
  if (licence === 28) throw new ReportRefusal("The Sales Analysis of licence 28 is not available in the web version yet.", "Not ported yet");
  const daily = call.checkQuery.includes("CHK_DAILY,");
  const checks = daily ? call.checkQuery.replace("CHK_PRVSALE,", "") : call.checkQuery;
  const has = (name: string) => checks.includes(`${name},`);
  const purchase = has("CHK_PURCHASE");
  const vinayak = licence === 2;
  const laminate = licence === 7 || licence === 22;
  // MOON_LAM, JAIN_LAM and SUN_LAM read the books, except in their 2019 year, which reads the challan modules as the other laminates do.
  const laminateBooks = laminate && /MOON_LAM|JAIN_LAM|SUN_LAM/i.test(db) && desktopDate(call.tarikh1) !== "01/Apr/2019";
  const setup = (await runReportSql(loader, `SELECT position('PROD_CHILD_PARENT,' in coalesce(item_para,'')) > 0 AS pcp FROM ${db}SETUP LIMIT 1`)).rows[0];
  const childParent = setup?.pcp === true;
  let hideBook = true;
  if ([19, 29, 68, 73].includes(licence)) hideBook = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${db}ACCOUNT WHERE a_pos <> 'D' AND position('CA_ENT' in a_short) > 0`)).rows[0]?.n) > 0;
  const bookFilter = !hideBook && [19, 29, 68, 73].includes(licence) ? ` and (pl.book_code in (select code from ${db}ACCOUNT where a_pos='A') or pl.book_code is null)` : "";

  // The movement of a line, and the conditions of a sale and a purchase line.
  const quantity = vinayak ? "round(pl.trn_qty3::numeric,2)" : "round((pl.quantity-coalesce(pl.ag_qty,0))::numeric,0)";
  const saleSigned = `case when pl.stock_nat='L' then ${quantity} else -${quantity} end`;
  const purchaseSigned = `case when pl.stock_nat='A' then ${quantity} else -${quantity} end`;
  const line = ` and pl.inventory='Y' and pl.quantity-coalesce(pl.ag_qty,0)>0${bookFilter}`;
  const challanOut = "(pl.trn_module='CHLN-OUT' or pl.trn_module='IND-OUT' or pl.trn_module='ORD-IN')";
  const saleLine = laminate ? (laminateBooks ? "pl.book in (8,16)" : challanOut)
    : licence === 19 ? `(${challanOut.slice(1, -1)} or pl.book in (8,16))`
    : licence === 25 ? "((coalesce(pl.code,0)>0 and pl.book in (8,16)) or left(pl.full_docno,4)='Less')"
    : "coalesce(pl.code,0)>0 and pl.book in (8,16)";
  const saleTotalLine = laminate || licence === 19 ? saleLine
    : licence === 25 ? "((pl.process_id is null and pl.book in (8,16)) or left(pl.full_docno,4)='Less')"
    : "pl.process_id is null and pl.book in (8,16)";
  const purchaseLine = laminate ? (laminateBooks ? "pl.book in (13,11)" : "pl.trn_module='CHLN-IN'")
    : licence === 19 ? "(pl.trn_module='CHLN-IN' or pl.book in (13,11))"
    : "coalesce(pl.code,0)>0 and pl.book in (13,11)";
  const sum = (name: string, where: string, signed: string): SalesColumn => ({ name, sql: `coalesce(sum(case when ${where} then ${signed} end),0) AS "${name}"` });

  // The columns of the period: the months (or the days), then the totals.
  const from = call.from;
  const upto = call.upto;
  const fromIso = toIso(from);
  const uptoIso = toIso(upto);
  const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const periodColumns: SalesColumn[] = [];
  if (!daily) {
    for (let at = new Date(from.getFullYear(), from.getMonth(), from.getDate()); at <= upto; at = addMonth(at)) {
      const month = MONTH_NAMES_SHORT[at.getMonth()];
      const window = `extract(month from pl.il_date)=${at.getMonth() + 1} and pl.il_date::date between '${toIso(at)}' and '${uptoIso}'${line}`;
      if (purchase) periodColumns.push(sum(`PURCH_${month}`, `${window} and ${purchaseLine}`, purchaseSigned));
      periodColumns.push(sum(`SALE_${month}`, `${window} and ${saleLine}`, saleSigned));
    }
  } else {
    for (let day = 1; day <= 31; day += 1) {
      for (let at = new Date(from.getFullYear(), from.getMonth(), from.getDate()); at <= upto; at = addMonth(at)) {
        periodColumns.push(sum(`${MONTH_NAMES_SHORT[at.getMonth()]}_${day}`, `extract(month from pl.il_date)=${at.getMonth() + 1} and extract(day from pl.il_date)=${day}${line} and ${saleLine}`, saleSigned));
      }
    }
  }
  const period = `pl.il_date::date between '${fromIso}' and '${uptoIso}'${line}`;
  const totalColumns: SalesColumn[] = [];
  if (!daily && purchase) totalColumns.push(sum("PURCHASE", `${period} and ${purchaseLine}`, purchaseSigned));
  totalColumns.push(sum("SALE", `${period} and ${saleTotalLine}`, saleSigned));

  // The ticked addon groups (their keys) and products.
  const productKeys = SALES_KEYS.test(call.selectKey[4].trim()) ? call.selectKey[4].trim() : "";
  let addonCount = 0;
  while (addonCount < 4 && SALES_KEYS.test(call.selectKey[addonCount].trim()) && call.addon[addonCount].trim() !== "") addonCount += 1;
  const asAdata = (text: string) => text.replace(/\b[a-z]+\.txt_/gi, "adata.txt_");
  const addonText = Array.from({ length: addonCount }, (_, at) => asAdata(call.addon[at]).trim());
  const addonSelect = addonCount === 0 ? "" : `,${[...call.headingAddon.slice(0, addonCount), ...call.selectedAddon.slice(0, addonCount)].map((text) => asAdata(text).trim()).join(",")}`;
  const addonWhere = addonText.map((text, at) => ` and ${text.replace("adata.txt_", "adata.key_")} in ${call.selectKey[at].trim()}`).join("");

  // The product's own columns, the closing stock and the licence's columns.
  const lead = laminate
    ? `prodmas.prod_key AS "prod_key",adata.TXT_PRODBRAN AS "BRAND",prodmas.DESC_1 AS "DESIGN",adata.TXT_PRODFINISH AS "FINISH",adata.TXT_PRODSTAT AS "STATUS",0 AS "PSALE"`
    : `prodmas.prod_key AS "prod_key",prodmas.prod_desc AS "Description",0 AS "PSALE"`;
  const parentStock = `coalesce((select sum(pb.clsg_pcs::numeric) from ${db}PROD_BALANCE pb where pb.prec_flag='RP' and pb.prod_id in (select p1.prod_key from ${db}PRODUCT_MASTER p1 where p1.txprod_id=prodmas.txprod_id)),0)`;
  let stock: string;
  if (vinayak) stock = `round(prodbal.clsg_qty3::numeric,2) AS "Clsg_Stk",0 AS "STK_FOR_DAY"`;
  else if (licence === 51 && !purchase) stock = `trunc(${parentStock}) AS "Clsg_Stk",prodmas.min_qty AS "Min_Qty",coalesce((select sum(p2.quantity-p2.ag_qty) from ${db}PROD_LEDGER p2 where p2.prod_id=prodmas.prod_key and p2.il_pos<>'D' and p2.trn_module='ORD-IN'),0) AS "PEND_ORD",0 AS "ORD_SUG",0 AS "STK_FOR_DAY"`;
  else if (licence === 74 && !purchase) stock = `trunc(prodbal.clsg_pcs::numeric) AS "Clsg_Stk",prodmas.min_qty AS "Min_Qty",0 AS "ORD_SUG",0 AS "STK_FOR_DAY"`;
  else if (licence === 61 && !purchase) stock = `round(prodbal.clsg_pcs::numeric,0) AS "Clsg_Stk",prodmas.min_qty AS "Min_Qty",0 AS "MIN_ORD_SUG",prodmas.max_qty AS "Max_Qty",0 AS "MAX_ORD_SUG",0 AS "STK_FOR_DAY"`;
  else if (licence === 68 && !purchase) stock = `round(prodbal.clsg_pcs::numeric,0) AS "Clsg_Stk",prodmas.min_qty AS "Min_Qty",0 AS "MIN_ORD_SUG",0 AS "STK_FOR_DAY"`;
  else if (childParent && !purchase) stock = `trunc(${parentStock}) AS "Clsg_Stk",0 AS "STK_FOR_DAY"`;
  else stock = `round(prodbal.clsg_pcs::numeric,0) AS "Clsg_Stk",0 AS "STK_FOR_DAY"`;

  const movement = [...periodColumns, ...totalColumns];
  const sql = `WITH moved AS (SELECT pl.prod_id,${movement.map((column) => column.sql).join(",")} FROM ${db}PROD_LEDGER pl WHERE pl.il_pos='A'${productKeys !== "" ? ` and pl.prod_id in ${productKeys}` : ""} GROUP BY pl.prod_id)`
    + ` SELECT ${lead},${movement.map((column) => `coalesce(moved."${column.name}",0) AS "${column.name}"`).join(",")},${stock}${addonSelect}`
    + ` FROM ${db}PRODUCT_MASTER prodmas LEFT JOIN ${db}PROD_BALANCE prodbal ON prodmas.prod_key=prodbal.prod_id LEFT JOIN ${db}ADDON_DATA adata ON adata.prod_id=prodmas.prod_key AND adata.prod_id>0`
    + ` LEFT JOIN moved ON moved.prod_id=prodmas.prod_key`
    + ` WHERE prodmas.prod_pos<>'D' AND prodbal.prec_flag='RP' AND prodmas.last_date IS NULL AND prodmas.inventory='Y'${productKeys !== "" ? ` AND prodmas.prod_key in ${productKeys}` : ""}${addonWhere}`;
  const table = tableFromResult(await runReportSql(loader, sql));
  const cell = (row: ResultRow, name: string) => num(table.get(row, name));

  // The products with nothing: no sale, no closing stock, nothing in a month (or a purchase).
  if (!daily) {
    if (!has("CHK_ZEROSTOCK")) {
      table.rows = table.rows.filter((row) => !((!purchase || cell(row, "PURCHASE") === 0) && cell(row, "SALE") === 0 && cell(row, "Clsg_Stk") === 0 && periodColumns.every((column) => cell(row, column.name) === 0)));
    }
    const days = Math.round((Date.UTC(upto.getFullYear(), upto.getMonth(), upto.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000) + 1;
    for (const row of table.rows) {
      const closing = cell(row, "Clsg_Stk");
      const sale = cell(row, "SALE");
      if (closing > 0 && sale > 0) table.set(row, "STK_FOR_DAY", decimalRound(closing / (decimalRound(sale, 6) / days), 0));
      else if (closing > 0 && sale === 0) table.set(row, "STK_FOR_DAY", 365);
    }
  }

  // PSALE: the sale of the company's earlier years (each year's database, by the company's name), CAST(... AS INT) a line.
  if (has("CHK_PRVSALE")) {
    const years = (await runReportSql(loader, `SELECT n.c_tarikh1::date AS y1, n.c_tarikh2::date AS y2, lower(btrim(c.co_dataname)) AS schema_name FROM ${SYSTEM_SCHEMA}.CNAME n LEFT JOIN ${SYSTEM_SCHEMA}.COMPANY c ON c.co_key=n.c_id`
      + ` WHERE n.c_tarikh2::date <= $1::date - 1 AND btrim(c.name) = $2 ORDER BY c.co_short`, [toIso(call.tarikh1), session.companyName.trim()])).rows;
    const previous = new Map<number, number>();
    const lineQuantity = vinayak ? "round(trn_qty3::numeric,2)" : "trunc((quantity-coalesce(ag_qty,0))::numeric)";
    for (const year of years) {
      const schema = toText(year.schema_name);
      if (!/^[a-z0-9_]+$/.test(schema)) continue;
      const exists = (await runReportSql(loader, "SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'prod_ledger'", [schema])).rows.length > 0;
      if (!exists) continue;
      const sold = await runReportSql(loader, `SELECT prod_id, sum(case when stock_nat='L' then ${lineQuantity} else -${lineQuantity} end) AS qty FROM ${schema}.PROD_LEDGER`
        + ` WHERE il_date::date >= $1::date AND il_date::date <= $2::date AND il_pos='A' AND inventory='Y' AND quantity-coalesce(ag_qty,0)>0 AND coalesce(code,0)>0`
        + `${licence === 7 ? " and (trn_module='CHLN-OUT' or trn_module='IND-OUT' or trn_module='ORD-IN')" : " AND book IN (8,16)"} GROUP BY prod_id`, [year.y1, year.y2]);
      for (const row of sold.rows) previous.set(num(row.prod_id), (previous.get(num(row.prod_id)) ?? 0) + num(row.qty));
    }
    for (const row of table.rows) table.set(row, "PSALE", previous.get(cell(row, "prod_key")) ?? 0);
  }

  // The licences' order suggestions.
  const minimum = (row: ResultRow) => cell(row, "Min_Qty");
  if (licence === 51 && !purchase) for (const row of table.rows) if (minimum(row) > 0) table.set(row, "ORD_SUG", minimum(row) - (cell(row, "Clsg_Stk") + Math.max(cell(row, "PEND_ORD"), 0)));
  if (licence === 74 && !purchase) for (const row of table.rows) if (minimum(row) > 0) table.set(row, "ORD_SUG", minimum(row) - cell(row, "Clsg_Stk"));
  if ((licence === 61 || licence === 68) && !purchase) {
    for (const row of table.rows) {
      if (minimum(row) > 0) table.set(row, "MIN_ORD_SUG", minimum(row) - cell(row, "Clsg_Stk"));
      if (licence === 61 && cell(row, "Max_Qty") > 0) table.set(row, "MAX_ORD_SUG", cell(row, "Max_Qty") - cell(row, "Clsg_Stk"));
    }
  }

  // The order: the addon groups, then the product (laminates: brand and design).
  const addonColumns = call.selectedAddon.slice(0, addonCount).map((_, at) => `SMART_SELECTED_ADDON${at + 1}`);
  sortRows(table, [
    ...addonColumns.map((column) => (row: ResultRow) => textKey(table.get(row, column))),
    ...(laminate ? [...(addonCount === 0 ? [(row: ResultRow) => textKey(table.get(row, "BRAND"))] : []), (row: ResultRow) => textKey(table.get(row, "DESIGN"))] : [(row: ResultRow) => textKey(table.get(row, "Description"))]),
  ]);

  dropColumn(table, "prod_key");
  if (!((licence === 7 || licence === 51 || licence === 68) && !daily)) dropColumn(table, "STK_FOR_DAY");
  // The desktop's column types: numeric(18,0) / (18,2) columns are decimals (the grid totals them), CAST(... AS int) ones are whole numbers.
  for (const column of [...movement.map((entry) => entry.name), "STK_FOR_DAY", "MIN_ORD_SUG", "MAX_ORD_SUG"]) if (table.has(column)) table.setKind(column, "decimal");
  if (table.has("Clsg_Stk")) table.setKind("Clsg_Stk", (licence === 51 || licence === 74 || childParent) && !purchase && !vinayak ? "int" : "decimal");
  if (table.has("ORD_SUG")) table.setKind("ORD_SUG", "decimal");
  if (table.has("PSALE")) table.setKind("PSALE", vinayak ? "decimal" : "int");
  return table;
}


/**
 * SP_FRT_RPT_PARTY_BILL_PDF's SQL, apart from the database (so it can be tested on its own). PostgreSQL; the SQL Server original is quoted where
 * it differs. `from` and `upto` are SQL date literals; `codes` the selected accounts (none: every account).
 */
type PartyBillInput = {
  db: string;
  book: number;
  codes: readonly number[];
  from: string;
  upto: string;
  /** Licences 19, 29, 68 and 73 keep out the entries booked in a CA_ENT cash account, unless no account is short-named CA_ENT. */
  hideCaEnt: boolean;
};

/** The selected account codes out of the "(1,2,3)" list the Account tab gives. */
const codesOf = (list: string): number[] => [...list.matchAll(/-?\d+/g)].map((match) => Number(match[0])).filter((code) => Number.isInteger(code) && code > 0);

/** CONVERT(varchar(11),DOC_DATE,103) is the SELECTED_DATE text; Note_Nature is 1 when the voucher has inventory lines. */
function partyBillQuery(input: PartyBillInput): string {
  const { db, book, codes, from, upto, hideCaEnt } = input;
  return `select led.LED_KEY::text AS "SMART_LED_KEY",ac.Name AS "name",to_char(led.DOC_DATE,'DD/MM/YYYY') as "SELECTED_DATE",led.FULL_DOCNO as "FULL_DOCNO",led.AMOUNT::numeric AS "AMOUNT",`
    // Whether the voucher has inventory lines: one grouped read of PROD_LEDGER, not a count a voucher (no index on LED_ID: it read the
    // whole table once a bill, 13 s for 829 sale bills).
    + `case when pl.led_id is null then 0 else 1 end as "Note_Nature"`
    + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code`
    + ` left join (select distinct led_id from ${db}prod_ledger where il_pos='A' and led_id is not null) pl on pl.led_id=led.led_key`
    + ` where led.DOC_POS='A'${codes.length > 0 ? ` and led.code in (${codes.join(",")})` : ""}`
    + ` and led.book=${Math.trunc(book)} and led.DOC_DATE BETWEEN ${from} AND ${upto}`
    + `${hideCaEnt ? ` AND LED.BOOK_CODE in (select code from ${db}ACCOUNT where A_SHORT<>'CA_ENT')` : ""}`;
}


/**
 * SP_FRT_RPT_PARTY_BILL_PDF (REPORT > Extra > Party Wise Bill PDF, report 255): the bills of the first combo's book (sale, purchase, ...) in the
 * period, of the selected accounts, to be made into a PDF per party: LED_KEY (hidden, as SMART_LED_KEY), name, date, bill no, amount and Note_Nature (1 when the voucher has
 * inventory lines). The desktop builds it in TEMP_TABLE_PARTY_BILL_PDF_<machine>; here it comes straight from a read-only query.
 */
export async function partyBillPdf(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  // Licences 19 / 29 / 68 / 73 hide the CA_ENT books, unless there is no CA_ENT account at all (then nothing is hidden).
  let hideCaEnt = false;
  if ([19, 29, 68, 73].includes(call.licence)) {
    hideCaEnt = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${call.database}ACCOUNT WHERE A_POS <> 'D' AND position('CA_ENT' in A_SHORT) > 0`)).rows[0]?.n) === 0;
  }
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const table = tableFromResult(await runReportSql(loader, frag(partyBillQuery({ db: call.database, book: call.fcValue, codes: codesOf(call.selectKey[4]), from: day(call.from), upto: day(call.upto), hideCaEnt }))));
  table.setKind("AMOUNT", "decimal");
  table.setKind("Note_Nature", "int");
  // ORDER BY Name, the date (yyyymmdd), FULL_DOCNO.
  const sortDate = (row: Record<string, unknown>): string => String(row.SELECTED_DATE).split("/").reverse().join("");
  sortRows(table, [(row) => textKey(row.name), (row) => sortDate(row), (row) => textKey(row.FULL_DOCNO)]);
  return table;
}

/** SP_FRT_RPT_PHYSICAL_STOCK's SQL: PostgreSQL; the SQL Server original is quoted where it differs. The addon arguments are the generated ones (" adata.txt_X", "(1,2)"), checked before they reach the SQL. */
type PhysicalAddons = { texts: readonly string[]; keys: readonly string[]; headings: readonly string[] };

const PHYSICAL_TEXT_FIELD = /^\s*adata\.txt_[A-Za-z0-9_]+\s*$/i;
const PHYSICAL_KEY_LIST = /^\(\s*[-\w' ]+(\s*,\s*[-\w' ]+)*\s*\)$/;

/** The addon filters: the field's key_ column in the ticked keys ((1,2)); the second filter of the godown report is the godown (prodbal.I_PARACD). */
function physicalAddonFilters(addons: PhysicalAddons, godownSecond: boolean): string {
  let sql = "";
  addons.texts.forEach((text, at) => {
    const keys = (addons.keys[at] ?? "").trim();
    if (text.trim() === "" || keys === "") return;
    if (!PHYSICAL_TEXT_FIELD.test(text) || !PHYSICAL_KEY_LIST.test(keys)) throw new Error("The addon selection is not valid.");
    const column = godownSecond && at === 1 ? "prodbal.I_PARACD" : text.trim().replace(/txt_/i, "key_");
    sql += ` and ${column} in ${keys}`;
  });
  return sql;
}

/** The addon fields as extra columns of licence 21 (the desktop's @var_heading_addon1 / 2). */
const physicalHeadingColumns = (addons: PhysicalAddons): string => addons.headings.filter((heading) => heading.trim() !== "").slice(0, 2).map((heading) => `,${heading.trim()}`).join("");

/** The product's opening stock in the report's unit (REP1_UOM picks which of the balance's quantities). */
const PHYSICAL_OPENING_STOCK = "case when prodmas.rep1_uom=prodmas.pcs_uom then prodbal.open_pcs when prodmas.rep1_uom=prodmas.qty1_uom then prodbal.open_qty1 when prodmas.rep1_uom=prodmas.qty2_uom then prodbal.open_qty2 when prodmas.rep1_uom=prodmas.qty3_uom then prodbal.open_qty3 when prodmas.rep1_uom=prodmas.pack_uom then prodbal.open_pack when prodmas.rep1_uom=prodmas.weight_uom then prodbal.open_weight else prodbal.open_pcs end";

/** Licence 21: the products with their opening stock, the latest selling rate, and the physical-count columns (0). */
function physicalOpening21(db: string, addons: PhysicalAddons): string {
  const latest = (extra: string) => `(select pl_srate from ${db}PRICELIST where pl_pos<>'D'${extra} and prod_id=prodmas.prod_key order by pl_wefrom desc limit 1)::numeric(18,2)`;
  return `SELECT prodmas.PROD_DESC as "PROD_DESC",prodmas.prod_key as "PROD_KEY",prodmas.base_pack as "PACKING",(${PHYSICAL_OPENING_STOCK})::numeric as "STOCK"`
    + `,coalesce(case when ${latest("")} = 0 then prodbal.open_rate::numeric(18,2) else ${latest(" and pl_srate > 0")} end,0) as "RATE"`
    + `,0::numeric(20,0) AS "BOX_QTY",0::numeric(20,0) AS "LOOSE_QTY",0::numeric(20,0) AS "PHYSICAL_STOCK",0::numeric(20,0) AS "DIFF_STOCK",adata.key_PRODTYPE as "BRAND_ID",0::numeric(20,2) AS "STOCK_VAL",0::numeric(20,2) AS "DIFF_VAL",prodmas.RECDUOM_ID as "UOM"${physicalHeadingColumns(addons)}`
    + ` FROM ${db}PRODUCT_MASTER prodmas left join ${db}PROD_BALANCE prodbal on prodbal.PROD_ID=prodmas.PROD_KEY left join ${db}ADDON_DATA adata on adata.prod_id=prodmas.PROD_KEY`
    + ` where prodmas.PROD_POS='A' and prodmas.INVENTORY='Y' and prodbal.PREC_FLAG='RP'${physicalAddonFilters(addons, false)}`;
}

/** The quantity of a ledger row in the report's unit, less the part billed against another (AG_QTY); the job work module counts whole. */
function physicalMovement(job: string, pcsJob: string): string {
  const unit = (uom: string, column: string) => `when product.rep1_uom=product.${uom}_uom then case when PRODLED.TRN_MODULE='${job}' then prodled.${column} else prodled.${column}-round((prodled.AG_QTY/prodled.QUANTITY*prodled.${column}),4) end`;
  return `case when product.rep1_uom=product.pcs_uom then case when PRODLED.TRN_MODULE='${pcsJob}' then prodled.TRN_PCS else prodled.TRN_PCS-prodled.ag_qty end `
    + `${unit("qty1", "trn_qty1")} ${unit("qty2", "trn_qty2")} ${unit("qty3", "trn_qty3")} ${unit("pack", "trn_pack")} ${unit("weight", "trn_weight")} else prodled.QUANTITY end`;
}

/** What came in (ADD_QTY) and went out (LESS_QTY) of each product. Licence 21 counts the period, 22 everything up to the date. */
function physicalMovements(db: string, licence: 21 | 22, noteBook: number, from: string, upto: string): string {
  const range = licence === 21 ? `prodled.QUANTITY>0 and IL_DATE BETWEEN ${from} and ${upto} and (quantity-ag_qty>0 or PRODLED.TRN_MODULE='JOB-OUT' or PRODLED.TRN_MODULE='JOB-IN')` : `IL_DATE<=${upto}`;
  return `SELECT product.RECDUOM_ID as "UOM",product.prod_key as "PROD_KEY"`
    + `,sum(case when prodled.STOCK_NAT='A' then (${physicalMovement("JOB-IN", licence === 21 ? "JOB-IN" : "JOB-OUT")}) else 0.00 end) As "ADD_QTY"`
    + `,sum(case when prodled.STOCK_NAT='L' then (${physicalMovement("JOB-OUT", "JOB-OUT")}) else 0.00 end) As "LESS_QTY"`
    + ` FROM ${db}PRODUCT_MASTER product left join ${db}PROD_LEDGER prodled on prodled.PROD_ID=product.PROD_KEY`
    + ` where product.PROD_POS='A' and product.INVENTORY='Y' and prodled.IL_POS='A' and prodled.INVENTORY='Y' and prodled.TYPE <> ${Math.trunc(noteBook)} and ${range}`
    + ` group by product.prod_key,product.RECDUOM_ID`;
}

/** Licence 22: the products with the opening pieces, to which the physicalMovements are added. */
function physicalOpening22(db: string, addons: PhysicalAddons): string {
  return `SELECT prodmas.prod_key as "PROD_ID",prodmas.BILL_DESC as "BILL_DESC",adata.KEY_PRODBRAN as "BRAND_ID",prodmas.prod_key as "PROD_KEY",adata.TXT_PRODBRAN as "BRAND",adata.TXT_PRODFINISH as "FINISH",ltrim(rtrim(prodmas.LEVEL_1)) as "DESIGN",prodbal.open_pcs::numeric as "STOCK",0::numeric(20,0) AS "PHYSICAL_STOCK",0::numeric(20,0) AS "DIFF_STOCK"`
    + ` FROM ${db}PRODUCT_MASTER prodmas left join ${db}PROD_BALANCE prodbal on prodbal.PROD_ID=prodmas.PROD_KEY left join ${db}ADDON_DATA adata on adata.prod_id=prodmas.PROD_KEY`
    + ` where prodmas.PROD_POS='A' and prodmas.INVENTORY='Y' and prodbal.PREC_FLAG='RP'${physicalAddonFilters(addons, false)}`;
}

/** Every other licence: the closing pieces of each godown (PROD_BALANCE rows flagged GW). */
function physicalGodownStock(db: string, addons: PhysicalAddons): string {
  return `SELECT prodmas.prod_key as "PROD_ID",prodbal.prodbal_key as "PRODBAL_KEY",prodmas.BILL_DESC as "BILL_DESC",adata.KEY_PRODBRAN as "BRAND_ID",asub.sub_code as "GODOWN_ID",prodmas.prod_key as "PROD_KEY",asub.sub_name as "GODOWN",adata.TXT_PRODBRAN as "BRAND",adata.TXT_PRODFINISH as "FINISH",ltrim(rtrim(prodmas.LEVEL_1)) as "DESIGN",prodbal.clsg_pcs::numeric as "STOCK",0::numeric(20,0) AS "PHYSICAL_STOCK",0::numeric(20,0) AS "DIFF_STOCK"`
    + ` FROM ${db}PRODUCT_MASTER prodmas left join ${db}PROD_BALANCE prodbal on prodbal.PROD_ID=prodmas.PROD_KEY left join ${db}ADDON_DATA adata on adata.prod_id=prodmas.PROD_KEY left join ${db}ADDON_SUB asub on asub.SUB_CODE=prodbal.I_PARACD`
    + ` where prodmas.PROD_POS='A' and prodmas.INVENTORY='Y' and prodbal.PREC_FLAG='GW'${physicalAddonFilters(addons, true)}`;
}

/**
 * SP_FRT_RPT_PHYSICAL_STOCK (REPORT > Inventory > Physical Stock, report 112): the sheet for a physical count, a row per product with the book
 * stock and empty PHYSICAL_STOCK / DIFF_STOCK columns to fill. Licence 21 gives the stock at the date (the opening plus what the stock ledger added
 * and took off in the period) with the latest selling rate and the stock value; licence 22 the stock up to the date by brand, finish and design;
 * any other licence the closing stock of each godown. The desktop builds it in TEMP_TABLE_PHYSICAL_STOCK_<machine>; here it is built in memory.
 * Where the desktop's SQL is loose: it added the movements to the stock with `||` (text joining), which is meant as `+`; licence 22 read every
 * balance row of a product (the godown rows too), here only the product's own (PREC_FLAG 'RP').
 */
export async function physicalStock(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const addons: PhysicalAddons = { texts: call.addon, keys: call.selectKey.slice(0, 4), headings: call.headingAddon };
  const run = async (sql: string) => runReportSql(loader, frag(sql));

  if (call.licence !== 21 && call.licence !== 22) {
    const result = await run(physicalGodownStock(db, addons));
    const table = tableFromFields(result.fields);
    table.rows = result.rows.map((row) => ({ ...row }));
    for (const column of ["STOCK", "PHYSICAL_STOCK", "DIFF_STOCK"]) table.setKind(column, "decimal");
    sortRows(table, [(row) => textKey(row.GODOWN), (row) => textKey(row.BRAND), (row) => textKey(row.FINISH), (row) => rightAlignedKey(row.DESIGN)]);
    return table;
  }

  // The book that stock notes are kept in (BOOK_PROPERTIES, STKM_ID 'NR'); its rows are not counted. 25 when none.
  const noteBook = num((await runReportSql(loader, `SELECT book_key FROM ${db}BOOK_PROPERTIES WHERE STKM_POS = 'A' AND STKM_ID = 'NR' ORDER BY STKMODULE LIMIT 1`)).rows[0]?.book_key) || 25;
  const licence = call.licence;
  const base = await run(licence === 21 ? physicalOpening21(db, addons) : physicalOpening22(db, addons));
  const table = tableFromFields(base.fields);
  table.rows = base.rows.map((row) => ({ ...row }));
  const moved = new Map<string, number>();
  for (const row of (await run(physicalMovements(db, licence, noteBook, day(call.tarikh1), day(call.upto)))).rows) moved.set(String(row.PROD_KEY), num(row.ADD_QTY) - num(row.LESS_QTY));
  for (const row of table.rows) {
    const stock = num(row.STOCK) + (moved.get(String(row.PROD_KEY)) ?? 0);
    row.STOCK = stock;
    if (licence === 21) {
      row.PHYSICAL_STOCK = stock;
      row.STOCK_VAL = Math.round(stock * num(row.RATE) * 100) / 100;
    }
  }
  for (const column of ["STOCK", "RATE", "BOX_QTY", "LOOSE_QTY", "PHYSICAL_STOCK", "DIFF_STOCK", "STOCK_VAL", "DIFF_VAL"]) if (table.has(column)) table.setKind(column, "decimal");
  if (licence === 21) sortRows(table, [(row) => textKey(row.PROD_DESC)]);
  else sortRows(table, [(row) => textKey(row.BRAND), (row) => textKey(row.FINISH), (row) => rightAlignedKey(row.DESIGN)]);
  return table;
}

type Row = Record<string, unknown>;

// ======================================================================================
// BOOKWISE (135)
// ======================================================================================

/**
 * SP_FRT_RPT_BOOKWISE's SQL and its row clean-up, apart from the database (so they can be tested on their own).
 * PostgreSQL; the SQL Server original is quoted where it differs.
 */

/** The select of the expense book (15): its entries and the bills each was set against (EXPENSE_LINK), or of any other book: its entries and the bills cleared (OUTCLEAR). */
export function bookwiseSelect(db: string, book: number): { select: string; from: string; extraWhere: string } {
  const style6 = (column: string) => `to_char(${column}, 'DD-Mon-YY')`;
  if (book === 15) {
    return {
      select: `led.led_key AS "LED_KEY",to_char(led.doc_date,'YYYYMMDD')||led.full_docno||ac.name||led.amount::numeric::text AS "SORTING_COL",${style6("led.doc_date")} AS "selected_date",led.full_docno AS "DOC_NO",ac.name AS "PARTY_NAME",led.amount::numeric AS "AMOUNT",${style6("outclr.elink_date")} AS "Ag_Date",outclr.elink_fulldocno AS "Ag_No"`,
      from: `FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}EXPENSE_LINK outclr on outclr.elink_ag_ledid=led.led_key`,
      extraWhere: ` and ac.A_POS='A' and ac.book in (1)`,
    };
  }
  return {
    select: `led.led_key AS "LED_KEY",to_char(led.doc_date,'YYYYMMDD')||led.full_docno||ac.name||outclr.out_entryamt::numeric::text AS "SORTING_COL",${style6("led.doc_date")} AS "selected_date",led.full_docno AS "DOC_NO",ac.name AS "PARTY_NAME",case when coalesce(outclr.out_entryamt::numeric,0)=0 then led.amount::numeric else coalesce(outclr.out_entryamt::numeric,0) end AS "AMOUNT",${style6("outclr1.out_date")} AS "Ag_Date",outclr1.out_fulldocno AS "Ag_No",outclr.out_setoff::numeric AS "Ag_Amt"`,
    from: `FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}OUTCLEAR outclr on outclr.out_ledid=led.led_key left join ${db}OUTCLEAR outclr1 on outclr1.out_key=outclr.out_ag_outid left join ${db}BALSHEET bs on bs.bs_key=ac.bs_id`,
    extraWhere: ` and ac.A_POS='A' and led.full_docno<>'Auto/999999' and ac.book in (1,2,3)`,
  };
}

/** The where the procedure builds: the report's own where, its extra conditions and the dates (the base may be a bare "where"). */
export function bookwiseWhere(base: string, extra: string, from: string, upto: string): string {
  const bare = base.trim().toLowerCase() === "where";
  return `${base}${bare ? extra.replace(/^ and /, " ") : extra} and led.doc_date BETWEEN ${from} AND ${upto}`;
}


/**
 * SR_NO: the row's number among those of the same voucher, date, amount and ledger key; every row after the first of its voucher is
 * blanked (DOC_NO, selected_date, AMOUNT 0), so a voucher with several bills shows once. LED_KEY goes. Rows keep the query's order.
 */
export function numberAndBlank(rows: readonly Row[]): Row[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = [row.DOC_NO, row.selected_date, row.AMOUNT, row.LED_KEY].map((value) => String(value ?? "")).join("\u0000");
    const rank = (seen.get(key) ?? 0) + 1;
    seen.set(key, rank);
    const rest: Row = { ...row };
    delete rest.LED_KEY;
    return rank === 1 ? { ...rest, SR_NO: rank } : { ...rest, DOC_NO: "", selected_date: "", AMOUNT: 0, SR_NO: rank };
  });
}

/**
 * SP_FRT_RPT_BOOKWISE (REPORT > Outstanding > Bookwise, report 135): the entries of the period of the accounts of the books (parties,
 * book 1, 2 and 3; for the expense book 15 the general accounts) with the bills each was set against: the entry's date, voucher,
 * party and amount, then the bill's date, number and the amount set off. A voucher set against several bills shows once, the bills under it.
 * The desktop builds it in TEMP_TABLE_BOOKWISE_<machine>; here the rows are built in memory from a read-only query.
 */
export async function bookwise(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  // The BOOK combo's value is the book number when the combo gives no book column.
  const book = call.book >= 0 ? call.book : call.fcValue;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const parts = bookwiseSelect(call.database, book);
  const where = bookwiseWhere(call.where.split("|sys.yearid|").join(call.yearId), parts.extraWhere, day(call.from), day(call.upto));
  const result = await runReportSql(loader, frag(`SELECT ${parts.select} ${parts.from} ${where} ORDER BY led.doc_date, led.doc_no`));

  const table = tableFromFields(result.fields.filter((field) => field.name !== "LED_KEY"));
  table.addColumn("SR_NO");
  table.setKind("SR_NO", "int");
  for (const column of ["AMOUNT", "Ag_Amt"]) if (table.has(column)) table.setKind(column, "decimal");
  table.rows = numberAndBlank(result.rows);
  sortRows(table, [(row) => textKey(row.SORTING_COL)]);
  return table;
}

// ======================================================================================
// CHECKLIST DAYBOOK (120)
// ======================================================================================

/**
 * SP_FRT_RPT_CHECKLIST_DAYBOOK's SQL, apart from the database (so it can be tested on its own): the
 * select list for the books chosen, the addon columns, the joins and the filter. PostgreSQL;
 * the procedure's SQL Server original is quoted where it differs.
 */
export type AddonField = { save: string; type: string };

/** CHARINDEX(' <book>,', FIEL_INBOOK): the desktop searches " " + "<book>" + ","; all books searches "  4, 5, 6,". */
export const inBookNeedle = (book: number): string => ` ${book < 0 ? " 4, 5, 6" : String(book)},`;

/** The MASTER addon fields are the ones kept for accounts of books 1, 2 and 3. */
export const MASTER_NEEDLE = " 1, 2, 3,";

const identifier = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "");

/** AENT.txt_X AS "X" for a memo (M) field, AENT.input_X AS "X" for the others. */
export const entryAddonColumn = (field: AddonField): string => `aent.${field.type === "M" ? "txt_" : "input_"}${identifier(field.save)} AS "${identifier(field.save)}"`;

/** COALESCE(adata.txt_X,'') AS "X"; a number column is coalesced to 0 as SQL Server's '' becomes. */
export const masterAddonColumn = (field: AddonField, numeric: boolean): string => {
  const name = identifier(field.save);
  if (field.type === "M") return `COALESCE(adata.txt_${name}::text,'') AS "${name}"`;
  return numeric ? `COALESCE(adata.input_${name},0) AS "${name}"` : `COALESCE(adata.input_${name}::text,'') AS "${name}"`;
};

const dayText = (column: string, alias: string) => `to_char(${column}, 'DD-Mon-YY') AS "${alias}"`;

/**
 * The select list: all books (book < 0) show the cheque columns and BOOK_NAME; the bank book (6) the
 * cheque columns; the cash and discount books only date, voucher, account, schedule and amounts.
 */
export function checklistSelect(book: number, entryAddons: readonly string[], masterAddons: readonly string[]): string {
  const cheque = book < 0 || book === 6;
  const parts = [
    dayText("led.doc_date", "DATE"), "led.full_docno", `ltrim(led.doc_no::text) AS "DOC_NO"`,
    ...(cheque ? [`ltrim(led.doc_no1::text) AS "CHQ_NO"`, dayText("led.chln_date", "CHQ_DATE"), dayText("led.reco_date", "RECO_DATE")] : []),
    "ac.name",
    ...(book < 0 ? [`ac1.name AS "BOOK_NAME"`] : []),
    `bsheet.bs_desc AS "Schedule"`,
    `(case when led.ac_dbcode=2 then led.amount::numeric else 0 end) AS "RECEIPT"`,
    `(case when led.ac_dbcode=1 then led.amount::numeric else 0 end) AS "PAYMENT"`,
    ...entryAddons, ...masterAddons,
    `led.narration AS "NARRATION"`,
  ];
  return parts.join(",");
}

/** FROM ... WHERE ... ORDER BY of the procedure; `from` and `upto` are SQL date literals. */
export function checklistFrom(db: string, book: number, bookCode: number, hasEntryAddon: boolean, from: string, upto: string): string {
  const parts = [`from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}ADDON_DATA adata on adata.code=led.code left join ${db}BALSHEET bsheet on bsheet.bs_key=ac.bs_id`];
  if (book < 0) parts.push(`left join ${db}ACCOUNT ac1 on ac1.code=led.book_code`);
  if (hasEntryAddon) parts.push(`left join ${db}ADDON_AENTRY aent on aent.aona_ledid=led.led_key`);
  // (doc_posting<>'L' or (doc_posting<>'L' or reco_date is not null)) is doc_posting<>'L'.
  parts.push(`where led.doc_date BETWEEN ${from} AND ${upto} and led.doc_pos<>'D' and led.doc_posting<>'L'`);
  parts.push(book < 0 ? `and COALESCE(led.doc_no,'') not like '%999999%' and led.book in (4,5,6)` : `and led.book_code=${Math.trunc(bookCode)}`);
  // The procedure's final select: by date, then the voucher number right-aligned to 10.
  parts.push(`order by led.doc_date::date, right('          ' || ltrim(led.doc_no::text), 10) nulls first, led.ac_dbcode, led.doc_no`);
  return parts.join(" ");
}

/**
 * SP_FRT_RPT_CHECKLIST_DAYBOOK: every voucher of a cash, discount or bank book (or of all three) in
 * the period, for checking: date, voucher, (cheque, cheque date, reconciled date), account, schedule,
 * receipt, payment, the entry addon fields of the book, the account's master addon fields, narration.
 * It is the cash book's lines with nothing summed, no opening and no balance.
 *
 * Where the desktop's SQL cannot run on this database the web does what it meant: an addon field
 * whose column is not on ADDON_AENTRY / ADDON_DATA is left out (SQL Server would stop with an
 * invalid column), and a number addon column of the account master is 0 when empty, as '' becomes 0.
 */
export async function checklistDaybook(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const schema = loader.session.companySchema;
  if (call.book >= 0 && ![4, 5, 6].includes(call.book)) throw new ReportRefusal("Checklist Daybook is only for a cash, discount or bank book", "INTERNAL PROGRAM FAILURE");
  if (call.book >= 0 && !(call.fcValue > 0)) throw new ReportRefusal("Select the book (Daybook).", "No Selections Done!");

  // One query at a time: runReportSql keeps a savepoint per statement on the one connection, so overlapping statements release each other's.
  const columns = (await runReportSql(loader, `select lower(table_name) as t, lower(column_name) as c, data_type as d from information_schema.columns where table_schema = $1 and table_name in ('addon_aentry', 'addon_data')`, [schema.toLowerCase()])).rows;
  const entryColumns = new Set(columns.filter((row) => row.t === "addon_aentry").map((row) => String(row.c)));
  const masterColumns = new Set(columns.filter((row) => row.t === "addon_data").map((row) => String(row.c)));
  const masterTypes = new Map(columns.filter((row) => row.t === "addon_data").map((row) => [String(row.c), String(row.d)]));

  const fields = async (where: string, params: unknown[]): Promise<AddonField[]> => (await runReportSql(loader, `select btrim(fiel_save) as save, btrim(fiel_type) as type from ${db}ADDON_FLD where fiel_pos <> 'D' and ${where} order by fiel_key`, params)).rows
    .map((row) => ({ save: String(row.save ?? ""), type: String(row.type ?? "") })).filter((field) => field.save !== "");
  const entryFields = (await fields(`(position($1 in fiel_inbook) > 0 or position('AUTONAR,' in fiel_err) > 0)`, [inBookNeedle(call.book)]))
    .filter((field) => entryColumns.has(`${field.type === "M" ? "txt_" : "input_"}${field.save}`.toLowerCase()));
  const masterFields = (await fields(`fiel_relate = 'A' and fiel_masterpos = 'Y' and fiel_entrypos = 'N' and position($1 in fiel_inbook) > 0`, [MASTER_NEEDLE]))
    .filter((field) => masterColumns.has(`${field.type === "M" ? "txt_" : "input_"}${field.save}`.toLowerCase()));

  const numeric = (field: AddonField) => ["numeric", "integer", "smallint", "bigint", "real", "double precision", "money"].includes(masterTypes.get(`input_${field.save}`.toLowerCase()) ?? "");
  const select = checklistSelect(call.book, entryFields.map(entryAddonColumn), masterFields.map((field) => masterAddonColumn(field, numeric(field))));
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const sql = `select ${select} ${checklistFrom(db, call.book, call.fcValue, entryFields.length > 0, day(call.from), day(call.upto))}`;

  const table = tableFromResult(await runReportSql(loader, sql));
  for (const column of ["RECEIPT", "PAYMENT"]) table.setKind(column, "decimal");
  return table;
}

// ======================================================================================
// CHECKLIST INVOICE (119)
// ======================================================================================

/**
 * SP_FRT_RPT_CHECKLIST_INVOICE's SQL, apart from the database (so it can be tested on its own): the
 * slab columns and their joins, the select list for the licence, the joins and the filter.
 * PostgreSQL; the procedure's SQL Server original is quoted where it differs.
 */
export type Slab = { key: number; short: string; master: boolean };

/** @varBook: a credit note (16) is looked up as the sale (8), a debit note (11) as the purchase (13). */
export const slabBook = (book: number): number => (book === 16 ? 8 : book === 11 ? 13 : book);

/** CHARINDEX('<book>,', FIEL_INBOOK) for the entry addon fields (no leading space, as the desktop has it). */
export const entryNeedle = (book: number): string => `${slabBook(book)},`;

/** The account master's addon fields: sale books look for " 2,", the others " 3,". */
export const masterNeedle = (book: number): string => (slabBook(book) === 8 ? " 2," : " 3,");


/**
 * What each slab adds: a master slab (CGST ...) the net amount before it and the tax description, a
 * slab the amount itself. SGST and UTGST are the second half of a split tax and use NET_AMT1 and
 * TAX_DESC1, with the net taken off twice. The desktop would stop on a second master slab that
 * names NET_AMT again (the same alias twice); here it is added once.
 */
export function slabParts(slabs: readonly Slab[]): { columns: string[]; joins: string[] } {
  const columns: string[] = [];
  const joins: string[] = [];
  const used = new Set<string>();
  const join = (alias: string, column: string, select: string, from: string) => {
    if (used.has(alias)) return false;
    used.add(alias);
    columns.push(column);
    joins.push(`left join (${select} from ${from}) "${alias}" on "${alias}".led_id=led.led_key`);
    return true;
  };
  for (const slab of slabs) {
    const short = identifier(slab.short);
    const key = Math.trunc(slab.key);
    const ext = (extra = "") => `LEDGER_EXT where SLAB_ID = ${key} and il_id is null${extra}`;
    if (slab.master) {
      const split = short.toUpperCase() === "SGST" || short.toUpperCase() === "UTGST";
      const n = split ? "1" : "";
      join(`NET_AMT${n}`, `COALESCE("NET_AMT${n}".net,0.00) AS "NET_AMT${n}"`, `select led_id, s_lastot::numeric-${split ? "(slab_amt::numeric+slab_amt::numeric)" : "slab_amt::numeric"} as net`, ext());
      join(`TAX_DESC${n}`, `COALESCE("TAX_DESC${n}".tax_desc,'') AS "TAX_DESC${n}"`, `select ledext.led_id, taxmst.tax_desc as tax_desc`, `LEDGER_EXT ledext left join TAX_MASTER taxmst on taxmst.tax_rec=ledext.tax_id where ledext.il_id is null and ledext.slab_id = ${key}`);
    }
    join(short, `COALESCE("${short}"."${short}",0.00) AS "${short}"`, `select led_id, slab_amt::numeric as "${short}"`, ext());
  }
  return { columns, joins };
}


/** The select list: licence 2 shows bundle, quantity and kgs; the others the quantity. */
export function invoiceSelect(db: string, license: number, slabColumns: readonly string[], entryAddons: readonly string[], masterAddons: readonly string[]): string {
  const sum = (column: string) => `coalesce((select SUM(${column}::numeric) from ${db}PROD_LEDGER where il_pos='A' and led_id=led.led_key),0)`;
  return [
    dayText("led.doc_date", "DATE"), "led.full_docno", `ltrim(led.doc_no::text) AS "DOC_NO"`, `led.doc_no1 AS "CHALLAN_NO"`, dayText("led.chln_date", "CHLN_DATE"), "ac.name",
    ...(license === 2 ? [`coalesce("BUNDLE".bundle,0) AS "BUNDLE"`, `${sum("quantity")} AS "QTY"`, `${sum("trn_qty1")} AS "KGS"`] : [`coalesce("QTY".qty,0) AS "QTY"`]),
    ...slabColumns, `led.amount::numeric AS "AMOUNT"`, ...entryAddons, ...masterAddons, `led.narration AS "NARRATION"`,
  ].join(",");
}

/** FROM ... WHERE ... ORDER BY; `from` and `upto` are SQL date literals. */
export function invoiceFrom(db: string, license: number, bookCode: number, hasEntryAddon: boolean, slabJoins: readonly string[], from: string, upto: string): string {
  const parts = [`from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}ADDON_DATA adata on adata.code=led.code`];
  parts.push(license === 2
    ? `left join (Select led_id, sum(bundle::numeric) as bundle from ${db}PROD_LEDGER where il_pos='A' group by led_id) "BUNDLE" on "BUNDLE".led_id=led.led_key`
    : `left join (Select led_id, sum(quantity::numeric) as qty from ${db}PROD_LEDGER where il_pos='A' group by led_id) "QTY" on "QTY".led_id=led.led_key`);
  if (hasEntryAddon) parts.push(`left join ${db}ADDON_AENTRY aent on aent.aona_ledid=led.led_key`);
  parts.push(...slabJoins.map((join) => join.split("LEDGER_EXT").join(`${db}LEDGER_EXT`).split("TAX_MASTER").join(`${db}TAX_MASTER`)));
  parts.push(`where led.doc_date BETWEEN ${from} AND ${upto} and led.doc_pos<>'D' and led.book_code=${Math.trunc(bookCode)}`);
  // The procedure's final select: by date, then the voucher number right-aligned to 10.
  parts.push(`order by led.doc_date::date, right('          ' || ltrim(led.doc_no::text), 10) nulls first, led.doc_no`);
  return parts.join(" ");
}

/**
 * SP_FRT_RPT_CHECKLIST_INVOICE (REPORT > Register > Checklist Invoice, report 119): every voucher of
 * the register's book in the period, for checking: date, voucher, challan, account, quantity (or
 * bundle, quantity and kgs for licence 2), a column a tax slab of the book, the amount, the entry
 * addon fields of the book, the account master's addon fields and the narration. Nothing is summed.
 *
 * As in the checklist daybook, an addon field whose column is not on ADDON_AENTRY / ADDON_DATA is left
 * out (SQL Server would stop), and an empty number addon field of the account master is 0.
 * Statements run one at a time: runReportSql keeps a savepoint per statement on the one connection.
 */
export async function checklistInvoice(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const schema = loader.session.companySchema;
  if (!(call.fcValue > 0)) throw new ReportRefusal("Select the book (Register).", "No Selections Done!");

  // The tax slabs of the book for the year (SLAB_FROMDT is the year's start).
  const slabRows = (await runReportSql(loader, `select slab_key, btrim(slab_short) as short, slab_master from ${db}SLAB_MASTER where slab_fromdt = '${desktopDate(call.tarikh1)}' and slab_active <> 'N' and book = $1 order by slab_order`, [slabBook(call.book)])).rows;
  const slabs = slabRows.map((row) => ({ key: Number(row.slab_key), short: String(row.short ?? ""), master: String(row.slab_master ?? "") === "Y" })).filter((slab) => slab.short !== "");
  const { columns: slabColumns, joins: slabJoins } = slabParts(slabs);

  const columns = (await runReportSql(loader, `select lower(table_name) as t, lower(column_name) as c, data_type as d from information_schema.columns where table_schema = $1 and table_name in ('addon_aentry', 'addon_data')`, [schema.toLowerCase()])).rows;
  const entryColumns = new Set(columns.filter((row) => row.t === "addon_aentry").map((row) => String(row.c)));
  const masterColumns = new Set(columns.filter((row) => row.t === "addon_data").map((row) => String(row.c)));
  const masterTypes = new Map(columns.filter((row) => row.t === "addon_data").map((row) => [String(row.c), String(row.d)]));

  const fields = async (where: string, params: unknown[]): Promise<AddonField[]> => (await runReportSql(loader, `select btrim(fiel_save) as save, btrim(fiel_type) as type from ${db}ADDON_FLD where fiel_relate = 'A' and fiel_pos <> 'D' and ${where} order by fiel_key`, params)).rows
    .map((row) => ({ save: String(row.save ?? ""), type: String(row.type ?? "") })).filter((field) => field.save !== "");
  const column = (field: AddonField) => `${field.type === "M" ? "txt_" : "input_"}${field.save}`.toLowerCase();
  const entryFields = (await fields(`fiel_entrypos = 'L' and position($1 in fiel_inbook) > 0`, [entryNeedle(call.book)])).filter((field) => entryColumns.has(column(field)));
  const masterFields = (await fields(`fiel_masterpos = 'Y' and fiel_entrypos = 'N' and position($1 in fiel_inbook) > 0`, [masterNeedle(call.book)])).filter((field) => masterColumns.has(column(field)));
  const numeric = (field: AddonField) => ["numeric", "integer", "smallint", "bigint", "real", "double precision", "money"].includes(masterTypes.get(`input_${field.save}`.toLowerCase()) ?? "");

  const select = invoiceSelect(db, call.licence, slabColumns, entryFields.map(entryAddonColumn), masterFields.map((field) => masterAddonColumn(field, numeric(field))));
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const table = tableFromResult(await runReportSql(loader, `select ${select} ${invoiceFrom(db, call.licence, call.fcValue, entryFields.length > 0, slabJoins, day(call.from), day(call.upto))}`));
  table.setKind("AMOUNT", "decimal");
  return table;
}

// ======================================================================================
// DAILY TRANSACTION (156)
// ======================================================================================

/**
 * SP_FRT_RPT_DAILY_TRANSACTION's SQL, apart from the database (so it can be tested on its own): the summary's lines (the day's sale,
 * purchase, expense, deposits and withdrawals by book, the inventory moved, the parties by quantity and amount) and the detail's nine
 * kinds of voucher. PostgreSQL; the SQL Server original is quoted where it differs. `from` and `upto` are SQL date literals.
 */
export type SummaryQuery = { sorting: string; smart: string; sql: string };

/** One line of the summary: SORTING_COL, SMART_NAME, DESCRIPTION and FIGURE from the select given. */
const line = (sorting: string, smart: string, describe: string, figure: string, from: string, where: string, group: string): SummaryQuery => ({
  sorting, smart,
  sql: `SELECT '${sorting}' AS "SORTING_COL",'${smart}' AS "SMART_NAME",${describe} AS "DESCRIPTION",${figure} AS "FIGURE" ${from} ${where} ${group}`,
});

export function summaryQueries(db: string, from: string, upto: string): SummaryQuery[] {
  const out: SummaryQuery[] = [];
  const bookAccount = `FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.book_code`;
  const partyAccount = `FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code`;
  const ledgerDates = `and led.doc_date BETWEEN ${from} AND ${upto}`;
  const money = "round(sum(led.amount::numeric),2)";

  // The books' totals: the sale, the purchase, the expense, what went into and out of the bank and cash books.
  const book = (sorting: string, smart: string, where: string) => out.push(line(sorting, smart, "ac.name", money, bookAccount, `where led.doc_pos<>'D' and ac.a_pos<>'D' and ${where} ${ledgerDates}`, "group by ac.name"));
  book("01 SALE", "SALE", "led.book = 8");
  book("01 SALE", "SALE", "led.book = 16");
  book("02 PURCHASE", "PURCHASE", "led.book = 13");
  book("02 PURCHASE", "PURCHASE", "led.book = 11");
  book("03 EXPENSE", "EXPENSE", "led.book = 15");
  book("04 DEPOSITE", "DEPOSITE", "led.book = 6 and led.ac_dbcode=2");
  book("04 DEPOSITE", "DEPOSITE", "led.book = 4 and led.ac_dbcode=2");
  book("05 WITHDRAWAL", "WITHDRAWAL", "led.book = 6 and led.ac_dbcode=1");
  book("05 WITHDRAWAL", "WITHDRAWAL", "led.book = 4 and led.ac_dbcode=1");

  // The inventory moved: by product.
  const product = `FROM ${db}PROD_LEDGER prodled left join ${db}PRODUCT_MASTER product on product.prod_key=prodled.prod_id`;
  const productDates = `and prodled.il_date BETWEEN ${from} AND ${upto}`;
  const base = `where prodled.il_pos<>'D' and product.prod_pos<>'D'`;
  const stock = `product.inventory='Y' and prodled.inventory='Y'`;
  const byProduct = "group by product.prod_desc order by product.prod_desc";
  const net = "round(sum(prodled.quantity::numeric - prodled.ag_qty::numeric),2)";
  const made = "round(sum(prodled.quantity::numeric),2)";
  const inventory = (smart: string, figure: string, where: string) => out.push(line("06 INVENTORY", smart, "product.prod_desc", figure, product, `${base} and ${where} and ${stock} ${productDates}`, byProduct));
  inventory("SALE_INV", net, "prodled.book = 8 and prodled.led_id is not null");
  inventory("CN_INV", net, "prodled.book = 16 and prodled.led_id is not null");
  inventory("PURCH_INV", net, "prodled.book = 13 and prodled.led_id is not null");
  inventory("DN_INV", net, "prodled.book = 11 and prodled.led_id is not null");
  inventory("LESS", net, "prodled.book = 8 and prodled.process_id is not null and prodled.quantity::numeric - prodled.ag_qty::numeric > 0");
  inventory("ADD", net, "prodled.book = 13 and prodled.process_id is not null and prodled.quantity::numeric - prodled.ag_qty::numeric > 0");
  inventory("PRODUCTION FG ADD", made, "prodled.process_id is not null and prodled.trn_module='PROD-FG' and prodled.stock_nat='A'");
  inventory("PRODUCTION FG LESS", made, "prodled.process_id is not null and prodled.trn_module='PROD-FG' and prodled.stock_nat='L'");
  const sfg = "(prodled.trn_module='PROD-SFG' or (prodled.trn_module='PROD-MULTI' and coalesce(prodled.close_remark,'')<>''))";
  inventory("PRODUCTION SFG ADD", made, `prodled.process_id is not null and ${sfg} and prodled.stock_nat='A'`);
  inventory("PRODUCTION SFG LESS", made, `prodled.process_id is not null and ${sfg} and prodled.stock_nat='L'`);
  const job = "(prodled.trn_module='PROD-SFG' or prodled.trn_module='PROD-MULTI')";
  inventory("JOB OUT", made, `prodled.process_id is not null and ${job} and prodled.stock_nat='L'`);
  inventory("JOB IN", made, `prodled.process_id is not null and ${job} and prodled.stock_nat='A'`);

  // The parties: quantity and amount of the sale and the purchase, the expense.
  const partyQty = (sorting: string, book: number) => out.push(line(sorting, sorting.slice(3), "ac.name", net, `FROM ${db}PROD_LEDGER prodled left join ${db}ACCOUNT ac on ac.code=prodled.code`, `where prodled.il_pos<>'D' and ac.a_pos<>'D' and prodled.book = ${book} and prodled.led_id is not null and prodled.inventory='Y' and prodled.quantity::numeric - prodled.ag_qty::numeric > 0 ${productDates}`, "group by ac.name order by ac.name"));
  partyQty("07 SALE PARTY QTY", 8);
  partyQty("08 PURCHASE PARTY QTY", 13);
  const partyAmt = (sorting: string, book: number) => out.push(line(sorting, sorting.slice(3), "ac.name", money, partyAccount, `where led.doc_pos<>'D' and ac.a_pos<>'D' and led.book = ${book} ${ledgerDates}`, "group by ac.name order by ac.name"));
  partyAmt("09 SALE PARTY AMT", 8);
  partyAmt("10 PURCHASE PARTY AMT", 13);
  partyAmt("11 EXPENSE PARTY AMT", 15);
  return out;
}

/**
 * The detail: the cash and bank payments and receipts, the journals, then the sale, purchase, credit note, debit note, expense and agency
 * vouchers, each of the day's posted entries of the accounts. The journal's amount goes to the debit column (its credit side is read).
 */
export function detailQuery(db: string, from: string, upto: string): string {
  const kind = (sorting: string, type: string, dbcode: number, books: string, debit: boolean, posting: boolean) =>
    `SELECT led.led_key AS "SMART_LED_KEY",'${sorting}' AS "SORTING_COL",led.book AS "book",to_char(led.doc_date,'DD/MM/YYYY') AS "Date",ac.name AS "Particular",${type} AS "Voucher_Type",ltrim(rtrim(led.doc_no::text)) AS "Voucher_No",`
    + `${debit ? 'led.amount::numeric' : '0::numeric'} AS "Debit",${debit ? '0::numeric' : 'led.amount::numeric'} AS "Credit"`
    + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code where led.doc_pos = 'A' and ac.a_pos='A' and led.ac_dbcode=${dbcode}${posting ? " and led.doc_posting='P'" : ""} and led.doc_date between ${from} AND ${upto} and led.book in (${books})`;
  return [
    kind("01", "'Payment'", 1, "4,6", true, true),
    kind("02", "'Receipt'", 2, "4,6", false, true),
    kind("03", "'Journal'", 2, "19", true, true),
    kind("04", "led.doc_series", 1, "8", true, false),
    kind("05", "led.doc_series", 2, "13", false, false),
    kind("06", "led.doc_series", 2, "16", false, false),
    kind("07", "led.doc_series", 1, "11", true, false),
    kind("08", "led.doc_series", 2, "15", false, false),
    kind("09", "led.doc_series", 1, "10", true, false),
  ].join(" UNION ALL ");
}

/**
 * SP_FRT_RPT_DAILY_TRANSACTION (REPORT > Extra > Daily Transaction, report 156). The Summary format is the day's figures in lines: the sale,
 * purchase, expense, deposits and withdrawals of each book, the inventory moved by product (sale, credit note, purchase, debit note, added,
 * less, production, job work), and the sale, purchase and expense by party. Any other format is the day's posted vouchers: payments,
 * receipts, journals, sale, purchase, credit and debit notes, expense and agency vouchers. The desktop builds the summary in
 * TEMP_TABLE_DAILY_TRANS_<machine>; here its lines are built in memory from read-only queries.
 */
export async function dailyTransaction(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const day = (date: Date) => `'${desktopDate(date)}'::date`;

  if (call.formating.toUpperCase() !== "SUMMARY") {
    const table = tableFromResult(await runReportSql(loader, frag(detailQuery(call.database, day(call.from), day(call.upto)))));
    for (const column of ["Debit", "Credit"]) table.setKind(column, "decimal");
    // ORDER BY SORTING_COL, date (its dd/mm/yyyy text), Voucher_No.
    sortRows(table, [(row) => textKey(row.SORTING_COL), (row) => textKey(row.Date), (row) => textKey(row.Voucher_No)]);
    return table;
  }

  const table = new ResultTable();
  for (const column of ["SORTING_COL", "SMART_NAME", "DESCRIPTION", "FIGURE"]) table.addColumn(column);
  table.setKind("FIGURE", "decimal");
  for (const query of summaryQueries(call.database, day(call.from), day(call.upto))) {
    for (const row of (await runReportSql(loader, frag(query.sql))).rows) table.rows.push({ SORTING_COL: query.sorting, SMART_NAME: query.smart, DESCRIPTION: row.DESCRIPTION ?? row.description ?? null, FIGURE: num(row.FIGURE ?? row.figure) });
  }
  sortRows(table, [(row) => textKey(row.SORTING_COL)]);
  return table;
}

// ======================================================================================
// FUND FLOW (109)
// ======================================================================================

/**
 * SP_FRT_RPT_FUND_FLOW's arithmetic, apart from the database: the receipt and payment lines of
 * the cash / bank books pivoted to a column a book, the row total, and each row's share of its
 * side. Kept free of imports so it can be tested on its own.
 */
export type FundSide = "RECEIPT" | "PAYMENT";

/** One line of TEMP_TABLE_RECPT_: a schedule's (or "  Opening") amount in one book; a payment is negative. */
export type FundLine = { side: FundSide; particular: string | null; book: string; amount: number };

export type FundRow = { PARTICULAR: string | null; SMART_SELECTED_SCHDULE: FundSide; TOTAL: number; PERC: number | null } & Record<string, string | number | null>;

const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** The pivot groups on the particular the way SQL Server compares text: case and trailing spaces ignored. */
const groupKey = (side: FundSide, particular: string | null): string => `${side}\u0000${particular === null ? "\u0001" : particular.replace(/\s+$/, "").toLowerCase()}`;

/**
 * PIVOT (SUM(AMOUNT) FOR BOOK_NAME IN (books)), TOTAL = the books added, PERC = the row's TOTAL
 * over its side's total x 100 (rounded to 2 places; payments x -1, so a payment's share shows
 * negative as the desktop does). A line of a book that is not among `books` is dropped by the pivot.
 * Rows come back receipts first, then payments, each by particular as the caller sorts them.
 */
export function pivotFundFlow(books: readonly string[], lines: readonly FundLine[]): FundRow[] {
  const column = new Map(books.map((book) => [book.trim().toLowerCase(), book]));
  const groups = new Map<string, FundRow>();
  for (const line of lines) {
    const book = column.get(line.book.trim().toLowerCase());
    if (book === undefined) continue;
    const key = groupKey(line.side, line.particular);
    let row = groups.get(key);
    if (!row) {
      row = { PARTICULAR: line.particular, SMART_SELECTED_SCHDULE: line.side, ...Object.fromEntries(books.map((name) => [name, null])), TOTAL: 0, PERC: null } as FundRow;
      groups.set(key, row);
    }
    row[book] = Number(row[book] ?? 0) + line.amount;
  }
  const rows = [...groups.values()];
  for (const row of rows) {
    for (const book of books) if (row[book] !== null) row[book] = cents(Number(row[book]));
    row.TOTAL = cents(books.reduce((sum, book) => sum + Number(row[book] ?? 0), 0));
  }
  for (const side of ["RECEIPT", "PAYMENT"] as const) {
    const ofSide = rows.filter((row) => row.SMART_SELECTED_SCHDULE === side);
    const sideTotal = cents(ofSide.reduce((sum, row) => sum + row.TOTAL, 0));
    // The desktop skips a nil row and a row with no name (its update names no row); a side that nets to nothing would divide by zero there.
    if (sideTotal === 0) continue;
    for (const row of ofSide) {
      if (row.TOTAL === 0 || row.PARTICULAR === null) continue;
      const share = cents((row.TOTAL / sideTotal) * 100);
      row.PERC = side === "PAYMENT" ? share * -1 : share;
    }
  }
  return rows;
}

/**
 * SP_FRT_RPT_FUND_FLOW: where the cash and bank books' money came from and went to. A row a
 * schedule (balance sheet head) of the accounts the books were posted against, a column a cash /
 * bank book (account books 4 and 6, named by A_MAPCODE), TOTAL, and PERC (the row's share of the
 * receipts, or of the payments, in %). "  Opening" rows carry each book's balance at From (the
 * year's opening, plus its postings from the year's start to the day before From). The desktop
 * builds this in TEMP_TABLE_RECPT_ / PAY_ / FUND_<machine>; here the same lines are built in
 * memory from read-only queries, so the report never writes.
 *
 * The date is the voucher's, or the reconciliation date when "CHK_RECODATE" is ticked.
 *
 * Where the desktop's SQL is loose the web does what it meant, and only here:
 *  - the books' opening balances are read for the report's year (the desktop joined AC_BALANCE on
 *    the account alone, so a second year's row would have been counted twice);
 *  - a book name repeated among the books is one column (the desktop's PIVOT refuses duplicates);
 *  - a side whose rows add up to nothing gets no PERC (the desktop divides by zero).
 */
export async function fundFlow(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const year = call.yearId.replace(/'/g, "''");
  const schedules = call.selectScheduleKey.trim();
  if (!/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(schedules)) throw new ReportRefusal("Select the schedules to report.", "No Selections Done!");
  const dateColumn = call.checkQuery.includes("CHK_RECODATE,") ? "reco_date" : "doc_date";
  const day = (date: Date) => `'${desktopDate(date)}'::date`;

  // One column a cash / bank book.
  const named = await runReportSql(loader, `select distinct ltrim(rtrim(a_mapcode)) as "name" from ${db}account where a_pos <> 'D' and book in (4,6) and coalesce(a_mapcode,'') <> '' order by 1`);
  const books: string[] = [];
  for (const row of named.rows) {
    const name = String(row.name);
    if (!books.some((book) => book.toLowerCase() === name.toLowerCase())) books.push(name);
  }
  if (books.length === 0) throw new ReportRefusal("No cash or bank book has a map code (A_MAPCODE).", "INTERNAL PROGRAM FAILURE");

  const lines: FundLine[] = [];
  const side = async (debit: 1 | 2, sideName: "RECEIPT" | "PAYMENT") => {
    const result = await runReportSql(loader,
      `select bs.bs_desc as "PARTICULAR", ltrim(rtrim(ac1.a_mapcode)) as "BOOK_NAME", sum(led.amount::numeric) as "AMOUNT"`
      + ` from ${db}account ac left join ${db}ac_balance acbal on ac.code = acbal.code left join ${db}balsheet bs on ac.bs_id = bs.bs_key`
      + ` left join ${db}ledger led on ac.code = led.code and led.${dateColumn} between ${day(call.from)} and ${day(call.upto)}`
      + ` left join ${db}account ac1 on ac1.code = led.book_code`
      + ` where led.ac_dbcode = ${debit} and led.doc_pos <> 'D' and ac.a_pos <> 'D' and acbal.year_id = '${year}' and led.book in (4,6) and ac.bs_id in ${schedules}`
      + ` group by bs.bs_desc, ltrim(rtrim(ac1.a_mapcode))`);
    for (const row of result.rows) {
      const amount = num(row.AMOUNT);
      lines.push({ side: sideName, particular: row.PARTICULAR === null || row.PARTICULAR === undefined ? null : String(row.PARTICULAR), book: String(row.BOOK_NAME ?? ""), amount: sideName === "PAYMENT" ? money(amount * -1) : money(amount) });
    }
  };
  await side(2, "RECEIPT");
  await side(1, "PAYMENT");

  // Each book's balance at From: a debit balance is money received, a credit balance money paid.
  const priorTo = call.from.getTime() !== call.tarikh1.getTime();
  const opening = await runReportSql(loader, priorTo
    ? `select ltrim(rtrim(ac.a_mapcode)) as "name", acbal.opening::numeric + (coalesce(sum(case when led.bk_dbcode = 1 then led.amount::numeric else 0.00 end),0.00) - coalesce(sum(case when led.bk_dbcode = 2 then led.amount::numeric else 0.00 end),0.00)) as "opening"`
      + ` from ${db}account ac left join ${db}ac_balance acbal on acbal.code = ac.code and acbal.year_id = '${year}'`
      + ` left join ${db}ledger led on led.book_code = ac.code and led.${dateColumn} between ${day(call.tarikh1)} and ${day(dayBefore(call.from))} and led.doc_pos <> 'D'`
      + ` where ac.a_pos <> 'D' and ac.book in (4,6) group by acbal.opening, ac.a_mapcode order by ac.a_mapcode`
    : `select ltrim(rtrim(ac.a_mapcode)) as "name", acbal.opening::numeric as "opening" from ${db}account ac left join ${db}ac_balance acbal on acbal.code = ac.code and acbal.year_id = '${year}'`
      + ` where ac.a_pos <> 'D' and ac.book in (4,6) order by ac.a_mapcode`);
  for (const row of opening.rows) {
    if (row.opening === null || row.opening === undefined || row.name === null || row.name === undefined) continue;
    const amount = money(num(row.opening));
    if (amount !== 0) lines.push({ side: amount > 0 ? "RECEIPT" : "PAYMENT", particular: "  Opening", book: String(row.name), amount });
  }

  const table = new ResultTable();
  for (const column of ["PARTICULAR", "SMART_SELECTED_SCHDULE", ...books, "TOTAL", "PERC"]) table.addColumn(column);
  for (const column of [...books, "TOTAL", "PERC"]) table.setKind(column, "decimal");
  table.rows = pivotFundFlow(books, lines);
  // SMART_SELECTED_SCHDULE desc (receipts first), then PARTICULAR.
  sortRows(table, [(row) => (row.SMART_SELECTED_SCHDULE === "RECEIPT" ? 0 : 1), (row) => (toText(row.PARTICULAR).trim() === "Opening" ? 0 : 1), (row) => textKey(row.PARTICULAR)]);
  return table;
}

// ======================================================================================
// INTEREST CALCULATION (32)
// ======================================================================================

/**
 * SP_FRT_RPT_INTEREST's arithmetic and SQL pieces, apart from the database (so they can be tested on their own): the rate and the
 * days of the year, the percent expressions, and the summary format's roll-up of each party's balance into periods. PostgreSQL;
 * the SQL Server original is quoted where it differs.
 */

/** Feb of the year (of Tarikh2) has 28 days: 365; else 366. */
export const daysInYear = (yearEnd: Date): number => { const year = yearEnd.getFullYear(); return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365; };

const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const interestRound2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** The rate typed in the runtime box (12 when blank) and its percent as the desktop rounds it (INT_PERC). */
export function interestRate(typed: string): { rate: number; percent: number; typed: boolean } {
  const text = typed.trim();
  const rate = text === "" ? 12 : Number(text);
  return { rate: Number.isFinite(rate) ? rate : 12, percent: round4((Number.isFinite(rate) ? rate : 12) / 100), typed: text !== "" };
}

/** The percent an account (or ledger line) is charged: its own INT_PERC unless 0 (the typed rate when one is typed, for every account). */
export function percentExpression(rate: { rate: number; percent: number; typed: boolean }): string {
  return rate.typed ? String(rate.percent) : `(case when ac.int_perc::numeric=0 then ${round4(rate.rate / 100)} else round(ac.int_perc::numeric/100,4) end)`;
}

/** The INTEREST column: the account's own rate, or the rate typed. */
export function interestExpression(rate: { rate: number; typed: boolean }): string {
  return rate.typed ? String(rate.rate) : `(case when ac.int_perc::numeric=0 then ${rate.rate} else ac.int_perc::numeric end)`;
}

/** DATEDIFF(d, a, b) of two dates. */
export const daysBetween = (from: Date, upto: Date): number => Math.round((Date.UTC(upto.getFullYear(), upto.getMonth(), upto.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);

/** dd/mm/yyyy as a date; null when it is not one. */
export function parseDmy(text: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

const dmy = (date: Date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
const ymd = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;

/** A row of the detail table that the summary format reads. */
export type InterestLine = { name: string; date: string; principal: number; side: string };

export type SummaryRow = { SMART_NAME: string; Name: string; CLOSING_AMT: number; FROM_DATE: string; UPTO_DATE: string; DAYS: number; INT_RATE: number; Interest_Amt: number; DR_CR: string; SORTING_DATE: string };

/**
 * The summary format: for each party the balance (credits plus, debits minus) from each date its balance changed to the day before the next
 * change, and from the last change to the Upto date, with the interest at the one rate for that period. A period whose date does not
 * change adds nothing; the last period of a party (and of the report) ends on the Upto date (the text as the desktop gives it).
 */
export function summarize(lines: readonly InterestLine[], rate: number, noOfDays: number, uptoText: string, upto: Date): SummaryRow[] {
  const out: SummaryRow[] = [];
  const same = (a: string, b: string) => a.trimEnd().toLowerCase() === b.trimEnd().toLowerCase();
  const interest = (total: number, from: Date, to: Date) => {
    const days = daysBetween(from, to) + 1;
    return { days, amount: interestRound2(((total * round4(rate / 100)) / noOfDays) * days) };
  };
  const row = (party: string, total: number, from: string, uptoLabel: string, to: Date): SummaryRow => {
    const start = parseDmy(from) ?? to;
    const { days, amount } = interest(total, start, to);
    return { SMART_NAME: party, Name: party, CLOSING_AMT: interestRound2(total), FROM_DATE: from, UPTO_DATE: uptoLabel, DAYS: days, INT_RATE: rate, Interest_Amt: amount, DR_CR: amount > 0 ? "Cr" : "Dr", SORTING_DATE: `${party} ${ymd(start)}A` };
  };
  let found = "";
  let foundFrom = "";
  let total = 0;
  for (const line of lines) {
    if (found !== "" && same(found, line.name) && foundFrom !== line.date) {
      const dayBefore = parseDmy(line.date);
      if (dayBefore) { dayBefore.setDate(dayBefore.getDate() - 1); out.push(row(found, total, foundFrom, dmy(dayBefore), dayBefore)); }
    }
    if (found !== "" && !same(found, line.name)) {
      out.push(row(found, total, foundFrom, uptoText, upto));
      total = 0;
    }
    found = line.name;
    foundFrom = line.date;
    total = interestRound2(total + (line.side === "Cr" ? line.principal : -line.principal));
  }
  if (found !== "") out.push(row(found, total, foundFrom, uptoText, upto));
  return out;
}

/**
 * SP_FRT_RPT_INTEREST (REPORT > Extra > Interest Calculation, report 32): interest on the accounts of a book (1, 2, 3) at one rate for the
 * period, in the detail format a line for each account's opening balance and each interest-bearing entry (its principal, the days to
 * Upto and the interest received or paid), in the summary a line for each period of an account's balance. The rate is the runtime box's (12
 * when blank) unless the account has its own. TDSREQ adds the TDS rate. The desktop builds it in TEMP_TABLE_INTEREST_<machine>; here the
 * rows are built in memory from read-only queries.
 *
 * Read as the desktop does: with a From after the year's start the openings are the year's opening balance (without its sign) plus the
 * entries before From, and every account then takes its Dr / Cr from that sum.
 */
export async function interestCalculation(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const book = call.book >= 0 ? call.book : call.fcValue;
  const year = call.yearId.replace(/'/g, "''");
  const rate = interestRate(call.text[0] ?? "");
  const noOfDays = daysInYear(call.tarikh2);
  const tds = call.filterId.toUpperCase() === "TDSREQ";
  const percent = percentExpression(rate);
  const dateText = (date: Date) => ddMmYyyy(date);
  const ymd = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const fromBefore = call.from.getTime() !== call.tarikh1.getTime();

  // The balance sheet heads of the liabilities and the capital (ENT_FRAME L or C).
  const heads = (await runReportSql(loader, `SELECT bs_key FROM ${db}BALSHEET WHERE ent_frame like '%L%' or ent_frame like '%C%' ORDER BY bs_code`)).rows.map((row) => num(row.bs_key));
  const bsKeys = heads.length > 0 ? heads.join(",") : "0";
  const inBook = `(ac.bs_id in (${bsKeys}) or ${book === 1 ? "" : book === 2 ? "ac.book=2 or " : "ac.book=3 or "}ac.ac_opensty in ('TD','IR','IP'))`;
  const accounts = call.selectKey[4] !== "" ? ` and ac.code in ${call.selectKey[4]}` : "";
  const tdsRate = `(case when coalesce((select tds_rate from ${db}INT_MASTER intmst left join ${db}ACCOUNT accc on accc.code=intmst.code where accc.bs_id=15 and accc.nature_pay=ac.nature_pay limit 1),0)=0 then intmst.tds_rate else coalesce((select tds_rate from ${db}INT_MASTER intmst left join ${db}ACCOUNT accc on accc.code=intmst.code where accc.bs_id=15 and accc.nature_pay=ac.nature_pay limit 1),0) end) AS "TDS_RATE"`;
  const days = daysBetween(call.from, call.upto) + 1;

  // The opening of each account.
  const opening = await runReportSql(loader, frag(
    `SELECT ac.name AS "SMART_NAME",'${dateText(call.from)}' AS "DATE",'Opening' AS "NO",ac.name AS "NAME",'${dateText(call.from)}' AS "FROM_DATE",'${dateText(call.upto)}' AS "UPTO_DATE",${days} AS "Days",`
    + `abs(acbal.opening::numeric) AS "PRINCIPAL_AMT",(CASE WHEN acbal.opening::numeric < 0 THEN 'Cr' ELSE 'Dr' END) AS "PDR_CR",`
    + `(case when acbal.opening::numeric > 0 then (acbal.opening::numeric * ${percent})/${noOfDays}*${days} else 0.00 end) AS "INTRECD_AMT",`
    + `(case when acbal.opening::numeric < 0 then abs((abs(acbal.opening::numeric) * ${percent})/${noOfDays}*${days}) else 0.00 end) AS "INTPAY_AMT",`
    + `abs(acbal.opening::numeric) AS "CLOSING_BAL",''::varchar(2) AS "DR_CR",${interestExpression(rate)} AS "INTEREST",ac.code AS "ac_code",(ac.name||' '||'${ymd(call.tarikh1)}'||'A') AS "SORTING_DATE"${tds ? `,${tdsRate}` : ""}`
    + ` FROM ${db}AC_BALANCE acbal LEFT JOIN ${db}ACCOUNT ac ON acbal.code = ac.code${tds ? ` LEFT JOIN ${db}IDOPT_MASTER idopt ON idopt.idopt_key = ac.nature_pay LEFT JOIN ${db}INT_MASTER intmst ON intmst.code = ac.code` : ""}`
    + ` WHERE acbal.a_recflag = 'AC' AND ac.a_pos <> 'D' AND acbal.year_id = '${year}' AND ac.book = ${book} AND ${inBook}${accounts}`));
  const openings: Row[] = opening.rows.map((row) => ({ ...row }));

  const where = `${call.where.split("|sys.yearid|").join(call.yearId)} AND ac.BOOK = ${book} and led.int_type<>10 and (led.book=19 or led.doc_type='R') AND ${inBook}`;
  if (fromBefore) {
    // The entries before From: debits less credits for each account (TEMP_OPENINGS_).
    const moved = await runReportSql(loader, frag(
      `SELECT ac.code AS "key_code", SUM(CASE WHEN led.ac_dbcode = 1 then led.amount::numeric else 0.00 end) - SUM(CASE WHEN led.ac_dbcode = 2 then led.amount::numeric else 0.00 end) AS "openings"`
      + ` FROM ${db}ACCOUNT ac LEFT JOIN ${db}AC_BALANCE acbal ON ac.code = acbal.code${tds ? ` LEFT JOIN ${db}INT_MASTER intmst ON intmst.code = ac.code` : ` LEFT JOIN ${db}IDOPT_MASTER idopt ON idopt.idopt_key = ac.nature_pay LEFT JOIN ${db}INT_MASTER intmst ON intmst.code = ac.code`}`
      + ` LEFT JOIN ${db}LEDGER led ON ac.code = led.code ${where} AND led.doc_date < ${day(call.from)} GROUP BY ac.code ORDER BY ac.code`));
    if (moved.rows.length > 0) {
      const byCode = new Map(moved.rows.map((row) => [String(row.key_code), num(row.openings)]));
      for (const row of openings) if (byCode.has(String(row.ac_code))) row.PRINCIPAL_AMT = money(num(row.PRINCIPAL_AMT) + (byCode.get(String(row.ac_code)) ?? 0));
      for (const row of openings) {
        const principal = num(row.PRINCIPAL_AMT);
        const side = principal < 0 ? "Cr" : "Dr";
        const amount = Math.abs(principal);
        const percentOf = Math.round(num(row.INTEREST) / 100 * 10000) / 10000;
        row.PDR_CR = side;
        row.PRINCIPAL_AMT = amount;
        row.INTRECD_AMT = side === "Dr" ? (amount * percentOf / noOfDays) * days : 0;
        row.INTPAY_AMT = side === "Cr" ? Math.abs((Math.abs(amount) * percentOf / noOfDays) * days) : 0;
      }
    }
  }
  const kept = openings.filter((row) => num(row.PRINCIPAL_AMT) !== 0);

  // The entries of the period.
  const lineDays = `(${day(call.upto)} - led.doc_date::date + 1)`;
  const lines = await runReportSql(loader, frag(
    `SELECT ac.name AS "SMART_NAME",to_char(led.doc_date,'DD/MM/YYYY') AS "DATE",led.full_docno AS "NO",ac.name AS "Name",to_char(led.doc_date,'DD/MM/YYYY') AS "FROM_DATE",'${dateText(call.upto)}' AS "UPTO_DATE",${lineDays} AS "Days",`
    + `led.amount::numeric AS "PRINCIPAL_AMT",(CASE WHEN led.ac_dbcode = 2 then 'Cr' else 'Dr' end) AS "PDR_CR",`
    + `(CASE WHEN led.ac_dbcode = 1 THEN round((led.amount::numeric * ${percent})/${noOfDays}*${lineDays},2) ELSE 0.00 END) AS "INTRECD_AMT",`
    + `(CASE WHEN led.ac_dbcode = 2 THEN round((led.amount::numeric * ${percent})/${noOfDays}*${lineDays},2) ELSE 0.00 END) AS "INTPAY_AMT",`
    + `led.amount::numeric AS "CLOSING_BAL",''::varchar(2) AS "DR_CR",${interestExpression(rate)} AS "INTEREST",ac.code AS "ac_code",(ac.name||' '||to_char(led.doc_date,'YYYYMMDD')||'B') AS "SORTING_DATE"${tds ? `,${tdsRate}` : ""}`
    + ` FROM ${db}ACCOUNT ac LEFT JOIN ${db}AC_BALANCE acbal ON ac.code = acbal.code LEFT JOIN ${db}LEDGER led ON ac.code = led.code${tds ? ` LEFT JOIN ${db}IDOPT_MASTER idopt ON idopt.idopt_key = ac.nature_pay LEFT JOIN ${db}INT_MASTER intmst ON intmst.code = ac.code` : ""}`
    + ` ${where} AND led.doc_date >= ${day(call.from)} AND led.doc_date <= ${day(call.upto)} ORDER BY ac.name, led.doc_date`));

  // UNION of the two (the lines named by position as the first select names them), by SORTING_DATE then SMART_NAME.
  const names = opening.fields.map((field) => field.name);
  const named = (row: Row): Row => { const values = Object.values(row); return Object.fromEntries(names.map((name, at) => [name, values[at] ?? null])); };
  const table = tableFromFields(opening.fields);
  for (const column of ["PRINCIPAL_AMT", "INTRECD_AMT", "INTPAY_AMT", "CLOSING_BAL", "INTEREST", "TDS_RATE"]) if (table.has(column)) table.setKind(column, "decimal");
  const seen = new Set<string>();
  for (const row of [...kept.map(named), ...lines.rows.map(named)]) {
    const key = JSON.stringify(names.map((name) => row[name]));
    if (seen.has(key)) continue;
    seen.add(key);
    table.rows.push(row);
  }
  sortRows(table, [(row) => textKey(row.SORTING_DATE), (row) => textKey(row.SMART_NAME)]);
  const format = call.formating.toUpperCase();
  if (format === "" || format === "DETAIL") return table;

  // Summary: each party's balance by period.
  const summary = summarize(table.rows.map((row) => ({ name: toText(row.NAME), date: toText(row.DATE), principal: num(row.PRINCIPAL_AMT), side: toText(row.PDR_CR) })), rate.rate, noOfDays, desktopDate(call.upto), call.upto);
  const out = new ResultTable();
  for (const column of ["SMART_NAME", "Name", "CLOSING_AMT", "FROM_DATE", "UPTO_DATE", "DAYS", "INT_RATE", "Interest_Amt", "DR_CR", "SORTING_DATE"]) out.addColumn(column);
  for (const column of ["CLOSING_AMT", "INT_RATE", "Interest_Amt"]) out.setKind(column, "decimal");
  out.setKind("DAYS", "int");
  out.rows = summary.map((row) => ({ ...row }));
  sortRows(out, [(row) => textKey(row.SORTING_DATE), (row) => textKey(row.SMART_NAME)]);
  return out;
}

// ======================================================================================
// TARGET (152)
// ======================================================================================

/**
 * SP_FRT_RPT_TARGET's arithmetic and SQL pieces, apart from the database (so they can be tested on their own): the months of the
 * period, the quarter targets, the shortfalls, and the three summaries. PostgreSQL; the SQL Server original is quoted where it differs.
 */

const targetNum = (value: unknown): number => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const targetRound2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const targetText = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

/** The loop's dates: From, then a month later each time (DATEADD(m, 1, ...), a 31st going to the month's last day), while not past Upto. */
export function monthStarts(from: Date, upto: Date): Date[] {
  const out: Date[] = [];
  for (let step = 0; ; step += 1) {
    const first = new Date(from.getFullYear(), from.getMonth() + step, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const date = new Date(first.getFullYear(), first.getMonth(), Math.min(from.getDate(), last));
    if (date.getTime() > upto.getTime() || step > 120) return out;
    out.push(date);
  }
}

export const yyyymmdd = (date: Date): string => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;

/** A quarter's target: the budget times the percentages of the months in it (a percentage between 0.01 and 99.99), rounded to a whole number. */
export function quarterTarget(db: string, from: number, to: number): string {
  return `coalesce((case when ac.budget::numeric > 0 then round(ac.budget::numeric*(coalesce((select round(sum(a.trg_perc::numeric),0) from ${db}TARGET a where a.trg_aaocode=targ.trg_aaocode and EXTRACT(MONTH FROM a.trg_from) between ${from} and ${to} and a.trg_perc::numeric between 0.01 and 99.99),0)/100),0) else 0 end),0)`;
}

/**
 * SHORT_FALL = Month_Target - Net_Sale and Archive = Net_Sale / Month_Target % where both are above nothing; then each customer's running
 * shortfall (Tot_Short) month by month (its rows of the same month all take the figure the running sum reaches).
 */
export function targetFinishRows(rows: readonly Row[]): Row[] {
  const out: Row[] = rows.map((row) => ({ ...row, Short_fall: 0, Tot_Short: 0, Archive: 0 }));
  for (const row of out) {
    if (targetNum(row.Net_Sale) > 0 && targetNum(row.Month_Target) > 0) {
      row.Short_fall = targetRound2(targetNum(row.Month_Target) - targetNum(row.Net_Sale));
      row.Archive = targetRound2((targetNum(row.Net_Sale) / targetNum(row.Month_Target)) * 100);
    }
  }
  const customers = [...new Set(out.map((row) => targetText(row.Customer_Name)))];
  for (const customer of customers) {
    let run = 0;
    const own = out.filter((row) => targetText(row.Customer_Name) === customer).sort((a, b) => targetText(a.SORTING_COL).localeCompare(targetText(b.SORTING_COL)));
    for (const row of own) {
      run += targetNum(row.Short_fall);
      for (const same of own) if (targetText(same.Month) === targetText(row.Month)) same.Tot_Short = targetRound2(run);
    }
  }
  return out;
}

/** CHK_SUMMARY: a row for each customer, the months added; Archive = Net_Sale / Month_Target % (nil when the yearly target is 1 or less). */
export function customerSummary(rows: readonly Row[]): Row[] {
  const groups = new Map<string, Row>();
  for (const row of rows) {
    if (targetNum(row.Yearly_Trg) <= 0) continue;
    const key = ["SMART_SELECTED_ADDON1", "Sales_Person", "Cust_Type", "Customer_Name", "Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4"].map((name) => targetText(row[name])).join("\u0000");
    const current = groups.get(key);
    if (!current) groups.set(key, { SMART_SELECTED_ADDON1: row.SMART_SELECTED_ADDON1, Sales_Person: row.Sales_Person, Cust_Type: row.Cust_Type, Customer_Name: row.Customer_Name, Yearly_Trg: row.Yearly_Trg, Trg_Qtr1: row.Trg_Qtr1, Trg_Qtr2: row.Trg_Qtr2, Trg_Qtr3: row.Trg_Qtr3, Trg_Qtr4: row.Trg_Qtr4, Month_Target: targetNum(row.Month_Target), Net_Sale: targetNum(row.Net_Sale), Short_fall: targetNum(row.Short_fall), Archive: 0 });
    else { current.Month_Target = targetNum(current.Month_Target) + targetNum(row.Month_Target); current.Net_Sale = targetNum(current.Net_Sale) + targetNum(row.Net_Sale); current.Short_fall = targetNum(current.Short_fall) + targetNum(row.Short_fall); }
  }
  for (const row of groups.values()) row.Archive = targetNum(row.Yearly_Trg) > 1 && targetNum(row.Month_Target) !== 0 ? targetRound2((targetNum(row.Net_Sale) / targetNum(row.Month_Target)) * 100) : 0;
  return [...groups.values()];
}

export type SalesExpense = { code: string; month: string; salary: number; expense: number };

/** CHK_SMSALEXP: a row for each sales person and month with the target, the net sale, the salary and expense, and the two percentages. */
export function salesExpenseRows(rows: readonly Row[], costs: readonly SalesExpense[]): Row[] {
  const groups = new Map<string, Row>();
  for (const row of rows) {
    if (!(targetNum(row.Net_Sale) > 0 && targetNum(row.Yearly_Trg) > 0 && targetNum(row.Month_Target) > 0)) continue;
    for (const cost of costs) {
      if (cost.code !== targetText(row.Sales_Person_Code) || cost.month !== targetText(row.Month)) continue;
      const key = [row.SORTING_COL, row.Sales_Person, row.Month, cost.salary, cost.expense].map(targetText).join("\u0000");
      const current = groups.get(key);
      if (!current) groups.set(key, { SORTING_COL: row.SORTING_COL, SMART_SELECTED_ADDON1: null, Sales_Person: row.Sales_Person, Month: row.Month, Month_Target: targetNum(row.Month_Target), Net_Sale: targetNum(row.Net_Sale), Expense: targetRound2(cost.salary + cost.expense), "Target_Vs_Sale_%": 0, "Sale_Vs_Exp_%": 0 });
      else { current.Month_Target = targetNum(current.Month_Target) + targetNum(row.Month_Target); current.Net_Sale = targetNum(current.Net_Sale) + targetNum(row.Net_Sale); }
    }
  }
  for (const row of groups.values()) {
    if (targetNum(row.Net_Sale) > 0 && targetNum(row.Month_Target) > 0) row["Target_Vs_Sale_%"] = targetRound2((targetNum(row.Net_Sale) / targetNum(row.Month_Target)) * 100);
    if (targetNum(row.Net_Sale) > 0 && targetNum(row.Expense) > 0) row["Sale_Vs_Exp_%"] = targetRound2((targetNum(row.Expense) / targetNum(row.Net_Sale)) * 100);
  }
  return [...groups.values()];
}

/**
 * CHK_GRPSUM: a row for each customer type (as its sales person name) with its target (the sales persons' target for the months), its net
 * sale, the shortfall and the % achieved; a sales person with a target and no sale is added; rows with no target are left out.
 */
export function groupSummary(rows: readonly Row[], targets: ReadonlyMap<string, number>): Row[] {
  const sales = new Map<string, number>();
  for (const row of rows) sales.set(targetText(row.Cust_Type), targetRound2((sales.get(targetText(row.Cust_Type)) ?? 0) + targetNum(row.Net_Sale)));
  const out: Row[] = [];
  for (const [name, netSale] of sales) {
    const target = targets.get(name) ?? 0;
    out.push({ Sales_Person: name, Target: target, Net_Sale: netSale, Shortfall: netSale > 0 && target > 1 ? targetRound2(target - netSale) : 0, "Achieved_%": netSale > 0 && target > 1 ? targetRound2((netSale / target) * 100) : 0 });
  }
  for (const [name, target] of targets) if (!sales.has(name)) out.push({ Sales_Person: name, Target: target, Net_Sale: 0, Shortfall: 0, "Achieved_%": 0 });
  return out.filter((row) => targetNum(row.Target) > 0).sort((a, b) => targetText(a.Sales_Person).toLowerCase().localeCompare(targetText(b.Sales_Person).toLowerCase()));
}

/**
 * SP_FRT_RPT_TARGET (REPORT > Extra > Target, report 152): the targets of the customers of the ticked sales persons (an addon group) month by
 * month against the net sale (the sale and its debit / credit notes before tax, from the first tax slab of the sale book): the yearly target,
 * its four quarters, the month's % and target, the net sale, the shortfall, the running shortfall and the % achieved. Options: Summary
 * (a row a customer), Sales With Expense (a row a sales person and month with the salary and expense) and Group Wise (a row a customer
 * type). The desktop builds it in TEMP_TABLE_TARGET_<machine>; here the rows are built in memory from read-only queries.
 */
export async function target(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const addon = call.addon[0].trim();
  const selected = call.selectedAddon[0].trim();
  if (addon === "" || selected === "" || call.selectKey[0] === "") throw new ReportRefusal("Minimum One Sales Man Should Be Selected To Generate Report", "No Selections Done!");
  const keyAddon = ` ${addon}`.replace(" adata.txt_", " adata.key_").trim();

  // The sale book's first tax slab (the net sale is the tax slab's S_LASTOT less its amount).
  const slab = num((await runReportSql(loader, frag(`SELECT coalesce(slab_key,0) AS k FROM ${db}SLAB_MASTER WHERE SLAB_FROMDT = '${desktopDate(call.tarikh1)}' AND SLAB_MASTER = 'Y' AND slab_link = 0 AND SLAB_ACTIVE = 'Y' AND BOOK = 8 LIMIT 1`))).rows[0]?.k);

  const rows: Row[] = [];
  for (const date of monthStarts(call.from, call.upto)) {
    const month = date.getMonth() + 1;
    const sql = `SELECT '${yyyymmdd(date)}' AS "SORTING_COL",${selected},ac.name AS "SMART_NAME",asub.sub_code AS "Sales_Person_Code",asub.sub_name AS "Sales_Person",adata.txt_custtype AS "Cust_Type",adata.key_custtype AS "Cust_Type_Id",ac.name AS "Customer_Name",`
      + `coalesce(ac.budget::numeric,0) AS "Yearly_Trg",${quarterTarget(db, 4, 6)} AS "Trg_Qtr1",${quarterTarget(db, 7, 9)} AS "Trg_Qtr2",${quarterTarget(db, 10, 12)} AS "Trg_Qtr3",${quarterTarget(db, 1, 3)} AS "Trg_Qtr4",`
      + `'${MONTH_NAMES[month - 1]}' AS "Month",targ.trg_perc::numeric AS "Month_perc",(case when targ.trg_perc::numeric > 0 then round(ac.budget::numeric*(targ.trg_perc::numeric/100),0) else 0 end) AS "Month_Target",`
      + `coalesce(SUM(case when EXTRACT(MONTH FROM led.doc_date)=${month} then case when led.book=8 or led.book=11 then ledext.s_lastot::numeric-ledext.slab_amt::numeric else (ledext.s_lastot::numeric-ledext.slab_amt::numeric)*-1 end else 0 end),0) AS "Net_Sale"`
      + ` FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}ADDON_DATA adata on adata.code=ac.code left join ${db}LEDGER_EXT ledext on ledext.led_id=led.led_key`
      + ` left join ${db}TARGET targ on targ.trg_aaocode=${keyAddon} left join ${db}ADDON_SUB asub on asub.sub_code=${keyAddon}`
      + ` where ledext.il_id is null and led.doc_pos<>'D' and ac.a_pos<>'D' AND EXTRACT(MONTH FROM targ.trg_from)=${month}`
      + ` AND (led.book = 8 or (led.book = 16 and led.ag_book = 8 and led.type=42) or (led.book = 11 and led.ag_book = 8 and led.type=42)) and ledext.slab_id=${slab} and targ.trg_aaocode in ${call.selectKey[0]}`
      + ` group by ${addon},asub.sub_code,asub.sub_name,ac.name,ac.budget,targ.trg_aaocode,targ.trg_perc,adata.txt_custtype,adata.key_custtype order by asub.sub_name,ac.name`;
    pushAll(rows, (await runReportSql(loader, frag(sql))).rows);
  }
  const finished = targetFinishRows(rows);
  const decimal = (table: ResultTable, columns: readonly string[]) => { for (const column of columns) if (table.has(column)) table.setKind(column, "decimal"); };
  const build = (names: readonly string[], list: readonly Row[], decimals: readonly string[]): ResultTable => {
    const table = new ResultTable();
    for (const name of names) table.addColumn(name);
    decimal(table, decimals);
    table.rows = list.map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? null])));
    return table;
  };

  if (check("CHK_SUMMARY")) {
    const table = build(["SMART_SELECTED_ADDON1", "Sales_Person", "Cust_Type", "Customer_Name", "Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4", "Month_Target", "Net_Sale", "Short_fall", "Archive"], customerSummary(finished), ["Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4", "Month_Target", "Net_Sale", "Short_fall", "Archive"]);
    sortRows(table, [(row) => textKey(row.Sales_Person), (row) => textKey(row.Cust_Type), (row) => textKey(row.Customer_Name)]);
    return table;
  }
  if (check("CHK_SMSALEXP")) {
    const costs = (await runReportSql(loader, `SELECT adon_code, month_name, coalesce(salary_amount::numeric,0) AS salary, coalesce(exp_amount::numeric,0) AS expense FROM ${db}SMAN_SALE_EXP`)).rows
      .map((row) => ({ code: toText(row.adon_code), month: toText(row.month_name), salary: num(row.salary), expense: num(row.expense) }));
    const table = build(["SORTING_COL", "SMART_SELECTED_ADDON1", "Sales_Person", "Month", "Month_Target", "Net_Sale", "Expense", "Target_Vs_Sale_%", "Sale_Vs_Exp_%"], salesExpenseRows(finished, costs), ["Month_Target", "Net_Sale", "Expense", "Target_Vs_Sale_%", "Sale_Vs_Exp_%"]);
    sortRows(table, [(row) => textKey(row.Sales_Person), (row) => textKey(row.SORTING_COL)]);
    return table;
  }
  if (check("CHK_GRPSUM")) {
    // The sales persons' target over the months of the period (month numbers, as the desktop compares them).
    const targets = new Map((await runReportSql(loader, `SELECT sub_name, coalesce(sum(trg_value::numeric),0) AS target FROM ${db}TARGET targ, ${db}ADDON_SUB asub WHERE asub.sub_code=targ.trg_aaocode AND EXTRACT(MONTH FROM trg_from) >= ${call.from.getMonth() + 1} AND EXTRACT(MONTH FROM trg_upto) <= ${call.upto.getMonth() + 1} AND trg_value::numeric > 0 GROUP BY sub_name`)).rows.map((row) => [toText(row.sub_name), num(row.target)]));
    return build(["Sales_Person", "Target", "Net_Sale", "Shortfall", "Achieved_%"], groupSummary(finished, targets), ["Target", "Net_Sale", "Shortfall", "Achieved_%"]);
  }
  const names = ["SORTING_COL", "SMART_SELECTED_ADDON1", "SMART_NAME", "Sales_Person", "Cust_Type", "Customer_Name", "Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4", "Month", "Month_perc", "Month_Target", "Net_Sale", "Short_fall", "Tot_Short", "Archive"];
  const table = build(names, finished.filter((row) => num(row.Yearly_Trg) > 0), ["Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4", "Month_perc", "Month_Target", "Net_Sale", "Short_fall", "Tot_Short", "Archive"]);
  sortRows(table, [(row) => textKey(row.Sales_Person), (row) => textKey(row.Customer_Name), (row) => textKey(row.SORTING_COL)]);
  return table;
}

// ======================================================================================
// TAX SUMMARY (18)
// ======================================================================================

/**
 * SP_FRT_RPT_TAXSUMM's SQL, apart from the database (so it can be tested on its own): the net and tax
 * column lists the procedure builds in @varSlabNetCols / @varSlabTaxCols. PostgreSQL; the SQL Server
 * original is quoted where it differs.
 */
export type TaxRow = { rec: number; place: number; repohd: string; placeDesc: string };
export type SlabRow = { key: number; short: string };

export type TaxColumnInput = {
  /** @varNet, @varTax and @varSlab_TOT_Net: the amount expressions (SGST nets nothing, a return book changes sign). */
  net: string;
  tax: string;
  totNet: string;
  /** CHK_MONTHCOL: the columns are named without the |..| markers the grid splits its headings on. */
  month: boolean;
  /** TAX_MASTER's active taxes by TAX_PLACE. */
  taxes: readonly TaxRow[];
  /** How many TAX_MASTER rows each TAX_PLACE has, active or not (a place's total column goes after its last row only when they all are here). */
  placeRows: ReadonlyMap<number, number>;
  /** @varTaxPlaces: every TAX_PLACE of the active taxes, comma separated. */
  places: string;
  /** The slabs after the last tax slab, by SLAB_ORDER; slabCount is how many slabs of the book have such an order, active or not. */
  slabs: readonly SlabRow[];
  slabCount: number;
  slabKeys: string;
};

const quoted = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const sum = (when: string, amount: string, alias: string): string => `SUM(CASE WHEN ${when} THEN ${amount} ELSE 0.00 END) AS ${quoted(alias)},`;

/** @varSlabNetCols and @varSlabTaxCols, without the last comma: the net amount row's and the tax amount row's columns, position for position. */
export function taxColumns(input: TaxColumnInput): { netCols: string; taxCols: string } {
  const placeName = (desc: string) => (input.month ? desc : `|${desc}|`);
  let net = "";
  let tax = "";
  const seen = new Map<number, number>();
  for (const row of input.taxes) {
    net += sum(`LEDEXT.TAX_ID = ${row.rec}`, input.net, row.repohd);
    tax += sum(`LEDEXT.TAX_ID = ${row.rec}`, input.tax, row.repohd);
    const rank = (seen.get(row.place) ?? 0) + 1;
    seen.set(row.place, rank);
    if (rank === (input.placeRows.get(row.place) ?? -1)) {
      net += sum(`TAX.TAX_PLACE = ${row.place}`, input.net, `${placeName(row.placeDesc)}_TOTAL_TAX`);
      tax += sum(`TAX.TAX_PLACE = ${row.place}`, input.tax, `${placeName(row.placeDesc)}_TOTAL_TAX`);
    }
  }
  net += sum(`TAX.TAX_PLACE IN (${input.places})`, input.net, input.month ? "TOTAL_TAX_AMT" : "|TOTAL|_TAX_AMT");
  tax += sum(`TAX.TAX_PLACE IN (${input.places})`, input.tax, input.month ? "TOTAL_TAX_AMT1" : "|TOTAL|_TAX_AMT1");
  input.slabs.forEach((slab, at) => {
    net += sum(`LEDEXT.SLAB_ID = ${slab.key}`, input.tax, slab.short);
    tax += sum(`LEDEXT.SLAB_ID = ${slab.key}`, "0.00", slab.short);
    if (at + 1 === input.slabCount) {
      net += sum(`LEDEXT.SLAB_ID IN (${input.slabKeys})`, input.tax, "|SLABS|_TOTAL_AMT");
      tax += sum(`LEDEXT.SLAB_ID IN (${input.slabKeys})`, "0.00", "|SLABS|_TOTAL_AMT");
    }
  });
  net += `SUM(${input.totNet}) AS ${quoted("|TOTAL|_MONTHLY_AMT")},`;
  tax += `SUM(0.00) AS ${quoted("|TOTAL|_MONTHLY_AMT1")},`;
  return { netCols: net.replace(/,$/, ""), taxCols: tax.replace(/,$/, "") };
}

/**
 * The amount expressions. A sale (8, 9) or purchase (13, 14) book has a return book (16 / 11) whose amounts count the other way; SGST
 * carries no net (its CGST twin does).
 */
export function amountExpressions(oppBook: string): { net: string; tax: string; totNet: string } {
  const sgst = (amount: string) => `(case when IDOP.OPT_DESC='SGST' then 0 else ${amount} end)`;
  if (oppBook !== "") {
    const signed = (amount: string) => `(CASE WHEN LED.BOOK = ${oppBook} THEN (${sgst(`${amount} * -1`)}) ELSE (${sgst(amount)}) END)`;
    const tax = `(CASE WHEN LED.BOOK = ${oppBook} THEN (LEDEXT.SLAB_AMT * -1) ELSE LEDEXT.SLAB_AMT END)`;
    const net = `(${signed("LEDEXT.S_LASTOT")} - ${signed("LEDEXT.SLAB_AMT")})`;
    return { net, tax, totNet: `${net}+${tax}` };
  }
  const net = `(${sgst("LEDEXT.S_LASTOT")} - ${sgst("LEDEXT.SLAB_AMT")})`;
  return { net, tax: "LEDEXT.SLAB_AMT", totNet: `${net}+LEDEXT.SLAB_AMT` };
}

/**
 * SP_FRT_RPT_TAXSUMM (REPORT > Register > Yearly Tax Summary, report 18, format SUMMARY): a Net Amount row and a Tax Amount row
 * for each month of the period, then the year's Total Net and Total Tax, with a column for each tax (CGST 9% ...), a total for each
 * tax place (local, out of state ...), the tax total and the slabs after the tax (TCS, rounding ...). With "CHK_MONTHCOL" it is
 * turned round: a row for each tax and amount, a column for each month and a TOTAL.
 *
 * As in Form Summary the accounts ticked are the register's books (LED.BOOK_CODE) and the amounts are those of SP_FOMSUMM_COLS's
 * kind. The desktop builds it in TEMP_TABLE_YEAR_TAX_<machine>; here the rows are built in memory from read-only queries.
 *
 * Where the desktop's SQL is loose the web does what it meant: the slab that ends the taxes is the last linked slab (the desktop's
 * "top 1" had no order), a tax name used twice is one column, and the ordering columns are left out of the grid.
 */
export async function taxSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  // The report's only format is the yearly summary; the first format runs the standard procedure, which this is too.
  if (call.formating !== "" && call.formating.toUpperCase() !== "SUMMARY") throw new ReportRefusal("Internal program failure\nQuery Was Blank", "INTERNAL PROGRAM FAILURE");
  const monthColumns = call.checkQuery.includes("CHK_MONTHCOL,");
  const book = call.fcValue;
  const against = call.againstBook;
  const groupKeys = call.firstHelpKeys.filter((key) => /^\d+$/.test(key));
  if (groupKeys.length === 0) throw new ReportRefusal("Minimum One Account Should Be Selected To Generate Report", "No Selections Done!");
  const keys = groupKeys.join(",");
  const oppBook = [8, 9].includes(book) ? "16" : [13, 14].includes(book) ? "11" : "";
  const inBook = book === 8 ? "8,9" : book === 13 ? "13,14" : [11, 16].includes(book) ? String(against) : `'${book}'`;
  const slabBook = [11, 16].includes(book) ? against : book;
  const day = (date: Date) => `'${desktopDate(date)}'`;

  // The tax slabs of the year for the book.
  const slabRows = (await runReportSql(loader, frag(`SELECT slab_key, slab_order, slab_link FROM ${db}SLAB_MASTER WHERE SLAB_ACTIVE = 'Y' AND SLAB_MASTER = 'Y' AND BOOK = ${slabBook} and SLAB_FROMDT = ${day(call.tarikh1)} and SLAB_UPTODT = ${day(call.tarikh2)} ORDER BY SLAB_ORDER`))).rows;
  if (slabRows.length === 0) throw new ReportRefusal("No tax slab is set for this book and year (Internal program failure).", "Internal program failure");
  const slabKey = slabRows.map((row) => `'${num(row.slab_key)}'`).join(",");
  const linked = slabRows.filter((row) => num(row.slab_link) > 0);
  const lastSlabOrder = Math.max(...(slabRows.length > 1 && linked.length > 0 ? linked : slabRows).map((row) => num(row.slab_order)));

  // The taxes, their places, the slabs after the taxes.
  const taxRows = (await runReportSql(loader, `SELECT tax.tax_rec, tax.tax_place, tax.tax_repohd, coalesce(idopt.opt_desc,'') AS place_desc FROM ${db}TAX_MASTER tax LEFT JOIN ${db}IDOPT_MASTER idopt ON idopt.idopt_key = tax.tax_place AND idopt.idopt_flag = 'TP' WHERE tax.tax_pos = 'A' ORDER BY tax.tax_place, tax.tax_rec`)).rows;
  const taxes = taxRows.map((row) => ({ rec: num(row.tax_rec), place: num(row.tax_place), repohd: toText(row.tax_repohd), placeDesc: toText(row.place_desc) }));
  const placeRows = new Map((await runReportSql(loader, `SELECT tax_place, count(*) AS n FROM ${db}TAX_MASTER GROUP BY tax_place`)).rows.map((row) => [num(row.tax_place), num(row.n)]));
  const slabs = (await runReportSql(loader, `SELECT slab_key, btrim(slab_short) AS short FROM ${db}SLAB_MASTER WHERE BOOK = ${slabBook} AND SLAB_ACTIVE = 'Y' AND SLAB_ORDER > ${lastSlabOrder} ORDER BY SLAB_ORDER`)).rows.map((row) => ({ key: num(row.slab_key), short: toText(row.short) }));
  const slabCount = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${db}SLAB_MASTER WHERE SLAB_ORDER > ${lastSlabOrder} AND BOOK = ${[11, 16].includes(against) ? against : book}`)).rows[0]?.n);
  const amounts = amountExpressions(oppBook);
  const { netCols, taxCols } = taxColumns({
    ...amounts, month: monthColumns, taxes, placeRows, places: taxes.map((row) => row.place).join(",") || "0",
    slabs, slabCount, slabKeys: slabs.map((slab) => slab.key).join(",") || "0",
  });

  // The where (as Form Summary's) and the four selects of the procedure's UNION.
  let where = call.where;
  if (call.checkQuery.includes("CHK_CRCASCOM,")) where += ` AND (LED.BOOK_CODE IN (${keys}) OR LED.AG_BKCODE IN (${keys})) AND (LED.BOOK IN (${inBook}) OR LED.AG_BOOK IN (${inBook}))`;
  else where += ` AND LED.BOOK_CODE IN (${keys}) AND LED.BOOK IN (${inBook})`;
  where += ` AND ((CASE WHEN LEDEXT.SLAB_ID in (${slabKey}) AND TAX.TAX_DESC IS NULL THEN 'sys.remove' ELSE TAX.TAX_DESC END) <> 'sys.remove' OR LEDEXT.SLAB_ID not in (${slabKey}))`;
  where += ` AND SLAB.SLAB_ORDER >= (SELECT SM.SLAB_ORDER FROM ${db}SLAB_MASTER SM WHERE SM.SLAB_KEY in (${slabKey}) LIMIT 1)`;
  where += ` AND LED.DOC_DATE BETWEEN ${day(call.from)} AND ${day(call.upto)}`;
  const from = call.from_.split("TAX.TAX_TYPE").join("nullif(TAX.TAX_TYPE,'')::int");
  const monthName = `trim(to_char(LED.DOC_DATE,'Month'))`;
  const year = `EXTRACT(YEAR FROM LED.DOC_DATE)::int`;
  const month = `EXTRACT(MONTH FROM LED.DOC_DATE)::int`;
  const monthly = (order: number, head: string, columns: string) => `SELECT ${year} AS "ORDERING_COL1",${month} AS "ORDERING_COL2",${order} AS "ORDERING_COL3",${monthName} AS "SELECTED_MONTH",'${head}' AS "AMT_HEAD",${columns} ${from} ${where} GROUP BY ${monthName},${year},${month}`;
  const yearly = (order: number, head: string, columns: string) => `SELECT ${call.tarikh2.getFullYear() + 1} AS "ORDERING_COL1",${order + 10} AS "ORDERING_COL2",${order} AS "ORDERING_COL3",'Yearly' AS "SELECTED_MONTH",'${head}' AS "AMT_HEAD",${columns} ${from} ${where}`;
  const sql = [monthly(1, "Net Amount", netCols), monthly(2, "Tax Amount", taxCols), yearly(3, "Total Net", netCols), yearly(4, "Total Tax", taxCols)].join(" UNION ") + ` ORDER BY "ORDERING_COL1","ORDERING_COL2","ORDERING_COL3"`;
  const table = tableFromResult(await runReportSql(loader, frag(sql)));
  for (const column of table.columns) if (!["ORDERING_COL1", "ORDERING_COL2", "ORDERING_COL3", "SELECTED_MONTH", "AMT_HEAD"].includes(column)) table.setKind(column, "decimal");

  if (monthColumns) return monthsAcross(loader, table, taxes.map((row) => row.repohd), day(call.from), day(call.upto), db);

  // |TOTAL|_MONTHLY_AMT: the tax amounts and, when the book has slabs after the taxes, those too.
  const total = table.name("|TOTAL|_TAX_AMT");
  const monthly1 = table.name("|TOTAL|_MONTHLY_AMT");
  const slabsTotal = table.name("|SLABS|_TOTAL_AMT");
  if (total && monthly1) for (const row of table.rows) row[monthly1] = money(num(row[total]) + (slabsTotal ? num(row[slabsTotal]) : 0));
  for (const column of ["ORDERING_COL1", "ORDERING_COL2", "ORDERING_COL3"]) dropColumn(table, column);
  return table;
}

/** CHK_MONTHCOL: TEMP_TABLE_YEAR_TAX_SUM_ (UNPIVOT the tax columns, PIVOT the months): a row for each tax and amount, a column for each month, TOTAL. */
async function monthsAcross(loader: Loader, table: ResultTable, taxHeads: readonly string[], from: string, upto: string, db: string): Promise<ResultTable> {
  const months: string[] = [];
  for (const row of (await runReportSql(loader, `SELECT trim(to_char(DOC_DATE,'Month')) AS m, to_char(DOC_DATE,'YYYYMM') AS k FROM ${db}LEDGER WHERE DOC_POS = 'A' AND DOC_DATE BETWEEN ${from} AND ${upto} GROUP BY 1, 2 ORDER BY 2`)).rows) {
    const name = toText(row.m);
    if (!months.includes(name)) months.push(name);
  }
  const heads = taxHeads.filter((head, at) => taxHeads.indexOf(head) === at);
  const cells = new Map<string, number>();
  for (const row of table.rows) {
    const monthName = toText(row.SELECTED_MONTH);
    const amountHead = toText(row.AMT_HEAD);
    if (monthName === "Yearly") continue;
    for (const head of heads) {
      const key = `${head}\u0000${amountHead}\u0000${monthName}`;
      const amount = num(row[head]);
      cells.set(key, cells.has(key) ? Math.min(cells.get(key)!, amount) : amount);
    }
  }
  const out = new ResultTable();
  for (const column of ["TYPE", "AMT_HEAD", ...months, "TOTAL"]) out.addColumn(column);
  for (const column of [...months, "TOTAL"]) out.setKind(column, "decimal");
  for (const head of heads) {
    for (const amountHead of ["Net Amount", "Tax Amount"]) {
      const values = months.map((monthName) => cells.get(`${head}\u0000${amountHead}\u0000${monthName}`));
      const totalAmount = money(values.reduce<number>((sum, value) => sum + (value ?? 0), 0));
      if (totalAmount === 0) continue;
      out.insert({ TYPE: head, AMT_HEAD: amountHead, ...Object.fromEntries(months.map((monthName, at) => [monthName, values[at] ?? null])), TOTAL: totalAmount });
    }
  }
  sortRows(out, [(row) => textKey(row.TYPE), (row) => textKey(row.AMT_HEAD)]);
  return out;
}

// ======================================================================================
// TDS REPORT (162)
// ======================================================================================

/**
 * SP_FRT_RPT_TDS_REPORT's SQL and arithmetic, apart from the database (so they can be tested on their own): the purchase, expense and
 * expense-return vouchers with the deductee's details, the tax deducted against each, and what the rate says it should have been.
 * PostgreSQL; the SQL Server original is quoted where it differs.
 */

const tdsNum = (value: unknown): number => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const round0 = (value: number): number => Math.round(value);
const tdsRound2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * The vouchers of the period (books 10 expense return, 13 purchase, 15 expense) with the party's address, PAN, deductee type and the TDS chart's
 * nature of payment, section and rates, the net amount (the voucher's amount before the first tax slab of its book) and the TDS journal set
 * against it. `setup` is the schema of the TDS chart; `from` and `upto` are SQL date literals.
 */
export function tdsQuery(db: string, setup: string, purchaseSlab: number, expenseSlab: number, from: string, upto: string): string {
  const slab = `case when led.book=13 then ${Math.trunc(purchaseSlab)} else ${Math.trunc(expenseSlab)} end`;
  const net = `(select s_lastot::numeric-slab_amt::numeric from ${db}LEDGER_EXT where led.led_key=led_id and il_id is null and slab_id=${slab} limit 1)`;
  return `select led.full_docno AS "full_docno",outclr.out_ag_outid AS "OUT_AG_OUTID",led.book AS "BOOK",led.code AS "CODE",outclr1.out_key AS "OUT_KEY",ac.name AS "name",`
    + `(addr.address_1||' '||addr.address_2||' '||addr.address_3||' '||addr.city||' '||addr.pin_code) AS "Address",addr.pan_no AS "PAN",smrtset.nature_of_payment AS "NATURE_OF_PAYMENT",idopt.opt_desc AS "Deductee_Type",smrtset.section_no AS "Section",`
    + `(case when led.book=13 then 'Purch' when position('JOB' in upper(led.doc_series)) > 0 then 'Job' when led.book=10 then 'ExpReturn' else 'Exp' end) AS "Inovice_Type",`
    + `ltrim(rtrim(led.doc_no::text)) AS "Invoice_No",to_char(led.doc_date,'DD/MM/YYYY') AS "Invoice_Date",ltrim(rtrim(led.doc_no1::text)) AS "Ref_No",to_char(led.chln_date,'DD/MM/YYYY') AS "Ref_Date",`
    + `(case when led.book=10 then ${net}*-1 else ${net} end) AS "Net_Amount",`
    + `(case when left(idopt.opt_desc,1) = 'C' then smrtset.tds_rate_company::numeric else smrtset.tds_rate_individual::numeric end) AS "TDS_Rate",`
    + `(case when led.book=10 then outclr1.out_entryamt::numeric*-1 else outclr1.out_entryamt::numeric end) AS "TDS_AMOUNT",outclr1.out_fulldocno AS "TDS_JV_No"`
    + ` FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}ADDRESS addr on addr.code=ac.code and addr.address_id=1`
    + ` left join ${db}IDOPT_MASTER idopt on idopt.idopt_key::text=ac.type_deduct::text left join ${setup}.TDS_CHART smrtset on smrtset.tds_key::text=ac.nature_pay::text`
    + ` left join ${db}OUTCLEAR outclr on outclr.out_ledid=led.led_key left join ${db}OUTCLEAR outclr1 on outclr1.out_ag_outid=outclr.out_key and outclr1.out_entrybook=19 and outclr1.out_ledid in (select led_key from ${db}LEDGER where book = 19 and imp_ledkey>0)`
    + ` where led.doc_date BETWEEN ${from} AND ${upto} and led.doc_pos='A' and led.book in (10,13,15) order by led.doc_date,led.doc_no1`;
}

/** An expense return set against a bill takes the TDS of the other side: the first clearing of another account in the TDS journal. */
export const returnLookup = (db: string): string =>
  `select p.code, p.ag, o.amount, o.out_key from unnest($1::int[], $2::int[]) as p(code, ag) left join lateral (select out_setoff::numeric*-1 as amount, out_key from ${db}OUTCLEAR where p.code <> code and out_fulldocno in (select out_fulldocno from ${db}OUTCLEAR where out_entrybook=19 and out_ag_outid=p.ag) order by out_key limit 1) o on true`;

/** The TDS journal's number of a clearing key. */
export const journalLookup = (db: string): string =>
  `select p.k, (select out_fulldocno from ${db}OUTCLEAR where out_ag_outid=p.k order by out_key limit 1) as number from unnest($1::int[]) as p(k)`;

const COLUMNS = ["name", "Address", "PAN", "NATURE_OF_PAYMENT", "Deductee_Type", "Section", "Inovice_Type", "Invoice_No", "Invoice_Date", "Ref_No", "Ref_Date", "Net_Amount", "TDS_Rate", "TDS_AMOUNT", "TDS_JV_No", "ACT_TDS_AMT", "DIFF_TDS_AMT"];
export const TDS_COLUMNS: readonly string[] = COLUMNS;

/**
 * ACT_TDS_AMT = Net_Amount x TDS_Rate / 100 to the rupee where there is a rate and a net amount; DIFF_TDS_AMT = TDS_AMOUNT - ACT_TDS_AMT; the
 * vouchers with a rate and TDS deducted are kept, and the working columns (voucher, clearing keys, book, account) go.
 */
export function tdsFinishRows(rows: readonly Row[]): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    const rate = tdsNum(row.TDS_Rate);
    const act = rate > 0 && tdsNum(row.Net_Amount) !== 0 ? round0((tdsNum(row.Net_Amount) * rate) / 100) : 0;
    const amount = row.TDS_AMOUNT === null || row.TDS_AMOUNT === undefined ? null : tdsNum(row.TDS_AMOUNT);
    const diff = amount === null ? null : tdsRound2(amount - act);
    if (!(rate > 0 && amount !== null && amount !== 0)) continue;
    out.push(Object.fromEntries(COLUMNS.map((name) => [name, name === "ACT_TDS_AMT" ? act : name === "DIFF_TDS_AMT" ? diff : row[name] ?? null])));
  }
  return out;
}

/**
 * SP_FRT_RPT_TDS_REPORT (REPORT > Extra > TDS Report, report 162): the purchase, expense and expense-return vouchers of the period with the
 * party's PAN, address and deductee type, the TDS chart's nature of payment, section and rate, the net amount, the tax deducted (the TDS journal set
 * against the voucher), what the rate gives (ACT_TDS_AMT) and the difference. Only vouchers with a rate and tax deducted show. The desktop builds it in
 * TEMP_TABLE_TDS_REP_<machine>; here the rows are built in memory from read-only queries.
 */
export async function tdsReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const slabOf = async (book: number) => num((await runReportSql(loader, `SELECT coalesce(slab_key,0) AS k FROM ${db}SLAB_MASTER WHERE SLAB_MASTER = 'Y' AND slab_link = 0 AND SLAB_ACTIVE = 'Y' AND BOOK = ${book} ORDER BY slab_order LIMIT 1`)).rows[0]?.k);
  const purchaseSlab = await slabOf(13);
  const expenseSlab = await slabOf(15);
  const rows: Row[] = (await runReportSql(loader, frag(tdsQuery(db, SETUP_SCHEMA, purchaseSlab, expenseSlab, day(call.from), day(call.upto))))).rows.map((row) => ({ ...row }));

  // An expense return set against a bill: the TDS journal of the bill's clearing, for the other account.
  const returns = rows.filter((row) => num(row.BOOK) === 10 && num(row.OUT_AG_OUTID) > 0);
  if (returns.length > 0) {
    const found = (await runReportSql(loader, returnLookup(db), [returns.map((row) => num(row.CODE)), returns.map((row) => num(row.OUT_AG_OUTID))])).rows;
    const byPair = new Map(found.map((row) => [`${num(row.code)}|${num(row.ag)}`, row]));
    for (const row of returns) {
      const hit = byPair.get(`${num(row.CODE)}|${num(row.OUT_AG_OUTID)}`);
      row.TDS_AMOUNT = hit && hit.amount !== null && hit.amount !== undefined ? num(hit.amount) : 0;
      row.OUT_KEY = hit && hit.out_key !== null && hit.out_key !== undefined ? num(hit.out_key) : 0;
    }
  }
  const journals = rows.filter((row) => num(row.BOOK) === 10 && num(row.OUT_KEY) > 0);
  if (journals.length > 0) {
    const keys = [...new Set(journals.map((row) => num(row.OUT_KEY)))];
    const found = new Map((await runReportSql(loader, journalLookup(db), [keys])).rows.map((row) => [num(row.k), row.number]));
    for (const row of journals) row.TDS_JV_No = found.get(num(row.OUT_KEY)) ?? "";
  }

  const table = new ResultTable();
  for (const column of TDS_COLUMNS) table.addColumn(column);
  for (const column of ["Net_Amount", "TDS_Rate", "TDS_AMOUNT", "ACT_TDS_AMT", "DIFF_TDS_AMT"]) table.setKind(column, "decimal");
  table.rows = tdsFinishRows(rows);
  return table;
}

// ======================================================================================
// TOP REPORTS (211)
// ======================================================================================

/**
 * SP_FRT_RPT_TOP_REPORTS' SQL, apart from the database (so it can be tested on its own): which of its five reports the first combo names, and
 * each one's select. PostgreSQL; the SQL Server original is quoted where it differs. `from` and `upto` are SQL date literals.
 */
export type TopMode = "party" | "value" | "quantity";

export type TopPlan = { book: 8 | 13; mode: TopMode };

/** Customers, Suppliers: the parties by amount; Item Sold / Purchase by Value: the products by value; Item Sold / Purchase by Quantity: the products by quantity. Sale for the three of the sale. */
export function topPlan(firstText: string): TopPlan {
  const text = firstText.trim().toLowerCase();
  const sale = text === "customers" || text === "item sold by value" || text === "item sold by quantity";
  const mode: TopMode = text === "customers" || text === "suppliers" ? "party" : text === "item sold by value" || text === "item purchase by value" ? "value" : "quantity";
  return { book: sale ? 8 : 13, mode };
}

/** A master addon field (FIEL_SAVE) as a column: COALESCE(adata.txt_X,'') AS "X" for the select, adata.txt_X for the group by. */
export const addonSelect = (fields: readonly string[]): string => fields.map((name) => `COALESCE(adata.txt_${name},'') AS "${name}"`).join(",");
export const addonGroup = (fields: readonly string[]): string => fields.map((name) => `adata.txt_${name}`).join(",");

type Dates = { from: string; upto: string };

/** The parties by amount: the sale (book 8) with its credit notes taken off, the purchase (13) with its debit notes. The net amount (before tax) when the book has a first tax slab. */
export function partyQuery(db: string, plan: TopPlan, slab: number, addons: readonly string[], dates: Dates, yearId: string): string {
  const sale = plan.book === 8;
  const returnBook = sale ? 16 : 11;
  const base = slab > 0 ? "(S_LASTOT::numeric-SLAB_AMT::numeric)" : "led.amount::numeric";
  const signed = `sum(case when led.ag_book=${plan.book} and led.book=${returnBook} then ${base}*-1 else ${base} end)`;
  const withAddons = sale && addons.length > 0;
  const quantity = `coalesce((select sum(quantity::numeric-ag_qty::numeric) from ${db}PROD_LEDGER where code=led.code and il_pos='A' and book = ${plan.book} and IL_DATE between ${dates.from} AND ${dates.upto} and inventory='Y' and led_id>0),0)`;
  const books = sale ? "8,16,11" : "13,16,11";
  return `select led.code AS "code",ROW_NUMBER() OVER (ORDER BY ${signed} DESC) AS "Row_No",ac.name AS "name",${signed} AS "amount",acbal.closing::numeric AS "clsg_bal",count(*) AS "No_Of_invoice",${quantity} AS "Quantity"${withAddons ? `,${addonSelect(addons)}` : ""}`
    + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code = led.code left join ${db}AC_BALANCE acbal on acbal.code = ac.code and acbal.year_id = '${yearId.replace(/'/g, "''")}' and acbal.a_recflag = 'AC'`
    + `${withAddons ? ` left join ${db}ADDON_DATA adata on ac.code = adata.code` : ""}${slab > 0 ? ` inner join ${db}LEDGER_EXT ledext on ledext.led_id=led.led_key and ledext.il_id is null and ledext.slab_id=${Math.trunc(slab)}` : ""}`
    + ` where led.doc_pos<>'D' and ac.a_pos<>'D' and led.doc_posting = 'P' and ac.book=${sale ? 2 : 3} and led.doc_date between ${dates.from} AND ${dates.upto}`
    + ` and led.book in (${books}) and (led.ag_book=${plan.book} or coalesce(led.ag_book,0)=0) group by led.code,ac.name,acbal.closing${withAddons ? `,${addonGroup(addons)}` : ""} order by amount desc`;
}

/** The products by value (IL_VALUE), the sale less its credit notes or the purchase less its debit notes. */
export function valueQuery(db: string, plan: TopPlan, addons: readonly string[], dates: Dates): string {
  const sale = plan.book === 8;
  const signed = `sum(case when prodled.book=${sale ? 16 : 11} then il_value::numeric*-1 else il_value::numeric end)`;
  return `select prodled.prod_id AS "code",ROW_NUMBER() OVER (ORDER BY ${signed} DESC) AS "Row_No",prodmas.prod_desc AS "name",${signed} AS "amount"${addons.length > 0 ? `,${addonSelect(addons)}` : ""}`
    + ` from ${db}PROD_LEDGER prodled left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key = prodled.prod_id left join ${db}ACCOUNT ac on ac.code = prodled.code${addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.prod_id = prodmas.prod_key` : ""}`
    + ` where prodled.il_pos<>'D' and prodled.inventory='Y' and prodmas.prod_pos<>'D' and ac.a_pos<>'D' and prodled.quantity::numeric-prodled.ag_qty::numeric>0 and prodled.il_value::numeric > 0 and prodled.il_date between ${dates.from} AND ${dates.upto}`
    + ` and prodled.book in (${sale ? "8,16" : "13,11"}) and (prodled.led_id>0 or prodled.trn_module='${sale ? "CHLN-OUT" : "CHLN-IN"}') group by prodled.prod_id,prodmas.prod_desc${addons.length > 0 ? `,${addonGroup(addons)}` : ""} order by amount desc`;
}

/** The products' closing stock in the report's unit (REP1_UOM picks which of the balance's quantities). */
export const CLOSING_STOCK = "case when prodmas.rep1_uom=prodmas.pcs_uom then prodbal.clsg_pcs when prodmas.rep1_uom=prodmas.qty1_uom then prodbal.clsg_qty1 when prodmas.rep1_uom=prodmas.qty2_uom then prodbal.clsg_qty2 when prodmas.rep1_uom=prodmas.qty3_uom then prodbal.clsg_qty3 when prodmas.rep1_uom=prodmas.pack_uom then prodbal.clsg_pack when prodmas.rep1_uom=prodmas.weight_uom then prodbal.clsg_weight else prodbal.clsg_pcs end";

/** The products by quantity (licence 2 counts the first quantity column), with the closing stock. */
export function quantityQuery(db: string, plan: TopPlan, licence: number, addons: readonly string[], dates: Dates): string {
  const sale = plan.book === 8;
  const returnBook = sale ? 16 : 11;
  const signed = licence === 2
    ? `sum(case when prodled.book=${returnBook} then trn_qty1::numeric*-1 else trn_qty1::numeric end)`
    : `sum(case when prodled.book=${returnBook} then prodled.quantity::numeric*-1 else prodled.quantity::numeric-prodled.ag_qty::numeric end)`;
  const groupUnits = "prodmas.rep1_uom,prodmas.pcs_uom,prodmas.qty1_uom,prodmas.qty2_uom,prodmas.qty3_uom,prodmas.pack_uom,prodmas.weight_uom,prodbal.clsg_pcs,prodbal.clsg_qty1,prodbal.clsg_qty2,prodbal.clsg_qty3,prodbal.clsg_pack,prodbal.clsg_weight";
  return `select prodled.prod_id AS "prod_id",ROW_NUMBER() OVER (ORDER BY ${signed} DESC) AS "Row_No",prodmas.prod_desc AS "name",${signed} AS "Quantity",(${CLOSING_STOCK})::numeric AS "Clsg_Stock"${addons.length > 0 ? `,${addonSelect(addons)}` : ""}`
    + ` from ${db}PROD_LEDGER prodled left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key = prodled.prod_id left join ${db}ACCOUNT ac on ac.code = prodled.code left join ${db}PROD_BALANCE prodbal on prodbal.prod_id = prodmas.prod_key${addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.prod_id = prodmas.prod_key` : ""}`
    + ` where prodled.il_pos<>'D' and prodled.inventory='Y' and prodbal.prec_flag='RP' and prodmas.prod_pos<>'D' and ac.a_pos<>'D' and prodled.quantity::numeric-prodled.ag_qty::numeric>0 and prodled.il_date between ${dates.from} AND ${dates.upto}`
    + ` and prodled.book in (${sale ? "8,16" : "13,11"}) and (prodled.led_id>0 or prodled.trn_module='${sale ? "CHLN-OUT" : "CHLN-IN"}') group by prodled.prod_id,prodmas.prod_desc,${groupUnits}${addons.length > 0 ? `,${addonGroup(addons)}` : ""} order by "Quantity" desc`;
}

/** Licence 51 lists what has no sale or purchase too, after those that have, with 0 for Row_No and the figures. */
export function absentQuery(db: string, plan: TopPlan, addons: readonly string[]): string {
  const addonColumns = addons.length > 0 ? `,${addonSelect(addons)}` : "";
  if (plan.mode === "party") {
    return `select ac.code AS "code",0 AS "Row_No",ac.name AS "name",0 AS "amount",acbal.closing::numeric AS "clsg_bal",0 AS "No_Of_invoice",0 AS "Quantity"${plan.book === 8 ? addonColumns : ""}`
      + ` from ${db}ACCOUNT ac left join ${db}AC_BALANCE acbal on acbal.code = ac.code${plan.book === 8 && addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.code = ac.code` : ""} where ac.a_pos<>'D' and ac.book=${plan.book === 8 ? 2 : 3}`;
  }
  const base = plan.mode === "value"
    ? `select prodmas.prod_key AS "code",0 AS "Row_No",prodmas.prod_desc AS "name",0 AS "amount"${addonColumns}`
    : `select prodbal.prod_id AS "prod_id",0 AS "Row_No",prodmas.prod_desc AS "name",0 AS "Quantity",(${CLOSING_STOCK})::numeric AS "Clsg_Stock"${addonColumns}`;
  const from = plan.mode === "value"
    ? ` from ${db}PRODUCT_MASTER prodmas left join ${db}PROD_BALANCE prodbal on prodbal.prod_id = prodmas.prod_key${addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.prod_id = prodmas.prod_key` : ""} where prodmas.prod_pos<>'D' and prodbal.prec_flag='RP'`
    : ` from ${db}PROD_BALANCE prodbal left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key = prodbal.prod_id${addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.prod_id = prodmas.prod_key` : ""} where prodbal.prec_flag='RP' and prodmas.prod_pos<>'D' and prodmas.inventory = 'Y' and prodbal.clsg_pcs::numeric>0`;
  return base + from;
}

/**
 * SP_FRT_RPT_TOP_REPORTS (REPORT > Extra > Top Reports, report 211): the best customers or suppliers by amount (the net amount before the first
 * tax slab of the sale or purchase book, credit / debit notes taken off, with their closing balance, number of invoices and quantity), or the best
 * products by value or by quantity (with the closing stock), each ranked (Row_No). The first combo names which: Customers, Item Sold by Value,
 * Item Sold by Quantity, Suppliers, Item Purchase by Value, Item Purchase by Quantity. Licence 51 adds those with nothing sold or bought, last.
 * The desktop builds it in TEMP_TABLE_TOP_REPORTS_<machine>; here the rows come from read-only queries.
 */
export async function topReports(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const top = topPlan(call.fcText);
  const dates = { from: `'${desktopDate(call.from)}'::date`, upto: `'${desktopDate(call.upto)}'::date` };

  // The master addon fields shown as columns: the account's for the customers (those of the sale book's register), the product's for the items.
  const addonRelate = top.mode === "party" ? "A" : "P";
  const wantAddons = top.mode !== "party" || top.book === 8;
  const columnsOf = new Set((await runReportSql(loader, `select lower(column_name) as c from information_schema.columns where table_schema = $1 and table_name = 'addon_data'`, [loader.session.companySchema.toLowerCase()])).rows.map((row) => String(row.c)));
  const addons = !wantAddons ? [] : (await runReportSql(loader, `SELECT btrim(fiel_save) AS save FROM ${db}ADDON_FLD WHERE fiel_relate = $1 AND fiel_masterpos = 'Y' AND fiel_entrypos = 'N' AND fiel_pos <> 'D' AND fiel_type = 'M'${top.mode === "party" ? " AND position(' 2,' in fiel_inbook) > 0" : ""} ORDER BY fiel_key`, [addonRelate])).rows
    .map((row) => toText(row.save)).filter((name) => /^[A-Za-z0-9_]+$/.test(name) && columnsOf.has(`txt_${name}`.toLowerCase()));

  let sql: string;
  if (top.mode === "party") {
    const slab = num((await runReportSql(loader, `SELECT slab_key FROM ${db}SLAB_MASTER WHERE slab_master = 'Y' AND slab_active = 'Y' AND book = ${top.book} AND slab_link = 0 ORDER BY slab_order LIMIT 1`)).rows[0]?.slab_key);
    sql = partyQuery(db, top, slab, addons, dates, call.yearId);
  } else sql = top.mode === "value" ? valueQuery(db, top, addons, dates) : quantityQuery(db, top, call.licence, addons, dates);
  const result = await runReportSql(loader, frag(sql));
  const table = tableFromFields(result.fields);
  table.rows = result.rows.map((row) => ({ ...row }));

  // Licence 51: those with no sale or purchase, added after.
  if (call.licence === 51) {
    const key = top.mode === "quantity" ? "prod_id" : "code";
    const have = new Set(table.rows.map((row) => String(row[key])));
    for (const row of (await runReportSql(loader, frag(absentQuery(db, top, addons)))).rows) if (!have.has(String(row[key]))) table.rows.push({ ...row });
  }

  dropColumn(table, top.mode === "quantity" ? "prod_id" : "code");
  for (const column of ["amount", "clsg_bal", "Quantity", "Clsg_Stock"]) if (table.has(column)) table.setKind(column, "decimal");
  for (const column of ["Row_No", "No_Of_invoice"]) if (table.has(column)) table.setKind(column, "int");
  // ORDER BY Amount desc, name (the parties and the products by value) or Quantity desc, name.
  const figure = top.mode === "quantity" ? "Quantity" : "amount";
  sortRows(table, [(row) => -num(row[figure]), (row) => textKey(row.name)]);
  return table;
}

// ======================================================================================
// 284: UPLOAD DOCUMENT (SP_FRT_RPT_DOCUMENT_UPLOAD)
// ======================================================================================
//
// REPORT > Extra > Upload Document: the entries of the chosen book in the period with the documents attached to them
// (<COMPANY>_IMAGE.DOCUMENT_UPLOAD: IMAGE_ENT_KEY, Sr, the remark and the path of each document), or, with "Without Upload
// Document Entry Require" ticked (CHK_WUPLOADDOC), the entries that have no document yet (IMAGE_ENT_KEY 0). The first combo's book
// (the account's book) below 20 is a cash / bank / ... book, read from LEDGER (ENTRY_MODE 'L'); from 20 it is a stock module
// (BOOK_PROPERTIES.STKM_SHORT), read from PROCESS (ENTRY_MODE 'P'), by product for the PROD-FG / PROD-SFG / PROD-MULTI modules.
// LED_KEY and PROCESS_KEY are hidden by the report's output columns. The desktop fills a temp table; here it is one read-only query.

type DocumentUploadInput = { db: string; imageDb: string; withoutDocument: boolean; fcValue: number; stockModule: string; from: string; upto: string };

/** The numbered rows of the documents of an entry: Sr restarts for each entry. */
const DOCUMENT_SERIAL = `ROW_NUMBER() over (partition by docupload.ENTRY_MODE,docupload.ENTRY_ID order by docupload.ENTRY_MODE,docupload.ENTRY_ID)`;
const DOCUMENT_ENTRY_DATE = (column: string) => `to_char(${column}, 'DD-Mon-YYYY')`;
const PRODUCTION_MODULES = ["PROD-FG", "PROD-SFG", "PROD-MULTI"];

/** The ledger entries of a book (below 20) with their documents, or without any. */
function documentUploadLedgerQuery(input: DocumentUploadInput): string {
  const { db, imageDb, withoutDocument, fcValue, from, upto } = input;
  const entry = `led.led_key AS "LED_KEY",0 AS "PROCESS_KEY"`;
  const entryColumns = `ac.name AS "Name",${DOCUMENT_ENTRY_DATE("led.doc_date")} AS "Entry_Date",led.full_docno AS "full_Docno",ltrim(rtrim(led.doc_no1)) AS "Doc_no1",led.amount::numeric AS "Amount"`;
  const range = `led.doc_pos='A' and ac.a_pos='A' and led.book_code=${Math.trunc(fcValue)} and led.doc_date BETWEEN ${from} AND ${upto}`;
  if (withoutDocument) {
    return `select 0 AS "SMART_IMAGE_ENT_KEY",${entry},${entryColumns} from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code where ${range}`
      + ` and coalesce(led.led_key,0) not in (select coalesce(ENTRY_ID,0) from ${imageDb}DOCUMENT_UPLOAD where ENTRY_MODE='L') order by led.doc_date,led.doc_no`;
  }
  return `select docupload.DOC_IMAGE_KEY AS "SMART_IMAGE_ENT_KEY",${entry},${DOCUMENT_SERIAL} AS "Sr",${entryColumns},docupload.DOCUMENT_REMARK AS "REMARK",docupload.DOCUMENT_PATH AS "DOCUMENT_PATH"`
    + ` from ${imageDb}DOCUMENT_UPLOAD docupload left join ${db}LEDGER led on led.LED_KEY=docupload.ENTRY_ID left join ${db}ACCOUNT ac on ac.code=led.code`
    + ` where ${range} and docupload.ENTRY_MODE='L' order by led.doc_date,led.doc_no`;
}

/** The process entries of a stock module (book 20 and above) with their documents, or without any. */
function documentUploadProcessQuery(input: DocumentUploadInput): string {
  const { db, imageDb, withoutDocument, stockModule, from, upto } = input;
  const moduleText = `'${stockModule.replace(/'/g, "''")}'`;
  const production = PRODUCTION_MODULES.includes(stockModule);
  // The production modules name the entry by its (first) product, the others by the party.
  const nameColumn = production ? "prod_data.prod_desc" : "ac.name";
  const nameJoin = production
    ? ` left join (select process_id,max(product.prod_Desc) AS prod_desc from ${db}prod_ledger prodled LEFT join ${db}product_master product on product.prod_key=prodled.prod_id where il_pos='A' and trn_module=${moduleText} and stock_nat='A' GROUP BY prodled.process_id) prod_data ON prod_data.process_id = led.PROCESS_KEY`
    : ` left join ${db}ACCOUNT ac on ac.code=led.code and ac.a_pos='A'`;
  const entry = `0 AS "LED_KEY",led.process_key AS "PROCESS_KEY"`;
  const entryColumns = `${DOCUMENT_ENTRY_DATE("led.p_date")} AS "Entry_Date",led.full_docno AS "full_Docno",ltrim(rtrim(led.doc_no2)) AS "Doc_no",${nameColumn} AS "Name",led.p_amount::numeric AS "Amount"`;
  const range = `led.il_pos='A' and led.stk_module=${moduleText} and led.p_date BETWEEN ${from} AND ${upto}`;
  if (withoutDocument) {
    return `select 0 AS "SMART_IMAGE_ENT_KEY",${entry},${entryColumns} from ${db}PROCESS led${nameJoin} where ${range}`
      + ` and coalesce(led.process_key,0) not in (select coalesce(ENTRY_ID,0) from ${imageDb}DOCUMENT_UPLOAD where ENTRY_MODE='P') order by led.p_date,led.doc_no2`;
  }
  return `select docupload.DOC_IMAGE_KEY AS "SMART_IMAGE_ENT_KEY",${entry},${DOCUMENT_SERIAL} AS "Sr",${entryColumns},docupload.DOCUMENT_REMARK AS "REMARK",docupload.DOCUMENT_PATH AS "DOCUMENT_PATH"`
    + ` from ${imageDb}DOCUMENT_UPLOAD docupload left join ${db}PROCESS led on led.PROCESS_KEY=docupload.ENTRY_ID${nameJoin}`
    + ` where ${range} and docupload.ENTRY_MODE='P' order by led.p_date,led.doc_no2`;
}

export async function documentUpload(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const withoutDocument = call.checkQuery.includes("CHK_WUPLOADDOC,");
  let stockModule = "";
  if (call.book >= 20) {
    const row = (await runReportSql(loader, `SELECT stkm_short FROM ${call.database}BOOK_PROPERTIES WHERE STKM_POS <> 'D' and book_key = $1`, [call.book])).rows[0];
    stockModule = toText(row?.stkm_short).trim();
  }
  const input: DocumentUploadInput = { db: call.database, imageDb: `${loader.session.companySchema}_image.`, withoutDocument, fcValue: call.fcValue, stockModule, from: day(call.from), upto: day(call.upto) };
  const sql = call.book >= 20 ? documentUploadProcessQuery(input) : documentUploadLedgerQuery(input);
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  for (const column of ["SMART_IMAGE_ENT_KEY", "LED_KEY", "PROCESS_KEY", "Sr"]) if (table.has(column)) table.setKind(column, "int");
  table.setKind("Amount", "decimal");
  return table;
}

// ======================================================================================
// 127: GST FORM SUMMARY (SP_FRT_RPT_GST_FORM_SUMM)
// ======================================================================================
//
// REPORT > GST > Form Summary: for the sale (8), purchase (13) or expense (15) book (with "Combine Figure Of Credit And Cash" the credit
// and debit notes, 16 and 11, are netted in) the tax of the period by the party's state (PLACE_OF_SUPPLY, "<state code>-<state name>") and
// tax rate: the CGST, UT_SGST (the same figure, the tax slab being the first of the pair) and IGST (the tax of the other states) and the
// Taxable_Value. The tax is that of the year's CGST slab (the master slab with no link), read from LEDGER_EXT; when the book has product
// slabs the stock lines (PROD_LEDGER) decide the sign of a return. The Account tab works as in Form Summary: the ticked accounts are the
// book's accounts (BOOK_CODE; with the credit / cash switch also AG_BKCODE) and at least one must be ticked (the procedure itself does not
// read them). Like the procedure, it does not read the format; the rows are by state then rate.

type GstFormSummaryInput = { db: string; book: number; slabId: number; accountKeys: string; productWise: boolean; netted: boolean; companyState: string; from: string; upto: string };

/** The tax or taxable amount of a ledger_ext row, signed for the book: a return (stock line out of the book's side, or a note against the book) takes it off. */
function gstFormAmount(input: GstFormSummaryInput, amount: string): string {
  const { book, productWise } = input;
  if (!input.netted) return `sum(${amount})`;
  const returnSide = book === 8 ? { stock: "A", note: 2, other: 1 } : { stock: "L", note: 1, other: 2 };
  if (productWise) return `sum(case when c.stock_nat = '${returnSide.stock}' or (a.ag_book = ${book} and a.ac_dbcode=${returnSide.note}) then (${amount})*-1 else ${amount} end)`;
  return `sum(case when a.ag_book = ${book} and a.ac_dbcode=${returnSide.note} then (${amount})*-1 when a.ag_book = ${book} and a.ac_dbcode=${returnSide.other} then ${amount} when a.ag_book = 0 then ${amount} end)`;
}

function gstFormSummaryQuery(input: GstFormSummaryInput): string {
  const { db, book, slabId, accountKeys, productWise, netted, from, upto } = input;
  const state = `'${input.companyState.replace(/'/g, "''")}'`;
  const tax = gstFormAmount(input, "b.slab_amt::numeric");
  const taxable = gstFormAmount(input, "b.s_lastot::numeric-b.slab_amt::numeric");
  const books = netted ? `${book},16,11` : String(book);
  return `select i.opt_short||'-'||i.opt_desc as "PLACE_OF_SUPPLY"`
    + `,(case when i.opt_short=${state} then coalesce(${tax},0) else 0 end) as "CGST",(case when i.opt_short=${state} then coalesce(${tax},0) else 0 end) as "UT_SGST"`
    + `,(case when i.opt_short<>${state} then coalesce(${tax},0) else 0 end) as "IGST",coalesce(${taxable},0) as "Taxable_Value"`
    + ` from ${db}ledger a left join ${db}ledger_ext b on a.led_key = b.led_id`
    + `${productWise ? ` left join ${db}prod_ledger c on b.il_id = c.il_key and c.il_pos is not null` : ""}`
    + ` left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}Address h on h.code = a.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text`
    + ` where a.DOC_DATE between ${from} AND ${upto} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and b.slab_id=${slabId}`
    + ` AND ${netted ? `(a.BOOK_CODE IN (${accountKeys}) OR a.AG_BKCODE IN (${accountKeys}))` : `a.BOOK_CODE IN (${accountKeys})`} AND a.BOOK IN (${books}) and h.address_id=1 and (b.led_id is not null${productWise ? " or b.il_id is not null" : ""})`
    + ` group by i.opt_short,i.opt_desc order by i.opt_short,i.opt_desc`;
}

export async function gstFormSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  // The ticked accounts of the Account tab are the book's accounts (LED.BOOK_CODE), as in Form Summary and Yearly Tax Summary.
  const groupKeys = call.firstHelpKeys.filter((key) => /^[0-9]+$/.test(key));
  if (groupKeys.length === 0) throw new ReportRefusal("Minimum One Account Should Be Selected To Generate Report", "No Selections Done!");
  // The slab book: the book itself, or for a return / note the book it is against.
  const book = call.fcValue;
  const slabBook = book === 11 || book === 16 ? call.againstBook : book;
  const company = (await runReportSql(loader, `SELECT coalesce(STATE_CODE,'') AS state_code FROM smart_system.COMPANY WHERE co_key = $1`, [loader.session.companyKey])).rows[0];
  const productWise = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${db}SLAB_MASTER WHERE SLAB_ACTIVE = 'Y' AND SLAB_MASTER = 'Y' AND SLAB_POS = 'P' AND BOOK IN (${Math.trunc(slabBook)}) AND SLAB_FROMDT >= ${day(call.tarikh1)} AND SLAB_UPTODT <= ${day(call.tarikh2)}`)).rows[0]?.n) > 0;
  const slab = (await runReportSql(loader, `SELECT coalesce(SLAB_KEY,0) AS slab_key FROM ${db}SLAB_MASTER WHERE SLAB_FROMDT = ${day(call.tarikh1)} AND SLAB_MASTER='Y' and slab_link=0 AND SLAB_ACTIVE = 'Y' AND BOOK IN (${Math.trunc(slabBook)}) ORDER BY SLAB_KEY DESC LIMIT 1`)).rows[0];
  const netted = (book === 8 || book === 13) && call.checkQuery.includes("CHK_CRCASCOM,");
  const sql = gstFormSummaryQuery({ db, book, slabId: num(slab?.slab_key), accountKeys: groupKeys.join(","), productWise, netted, companyState: toText(company?.state_code), from: day(call.from), upto: day(call.upto) });
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  for (const column of ["CGST", "UT_SGST", "IGST", "Taxable_Value"]) table.setKind(column, "decimal");
  return table;
}

// ======================================================================================
// 129: GSTR 3B (SP_FRT_RPT_GSTR_3B), 130: GSTR 1 (SP_FRT_RPT_GSTR_1), 131: GSTR 2 (SP_FRT_RPT_GSTR_2)
// ======================================================================================
//
// The three GST return reports. Each reads the company, or with "Multi Company Require" every company of the same GSTIN for the same year
// (the procedures' CUR_YEAR cursor), and adds the figures of each company into one table. The SQL Server procedures build it in
// TEMP_TABLE_GSTR_3B_ / TEMP_TABLE_GSTR_1_ / TEMP_TABLE_GSTR_2_<machine>; here the rows are built in memory from read-only queries.
//
// Where the desktop's SQL cannot run on this database the web does what it meant: a column of the group by that the select needs is added,
// and PROD_LEDGER has no DOC_NO (the voucher's own, from LEDGER, is read).

type GstrEnv = {
  loader: Loader; plan: ReportPlan; from: string; upto: string; tarikh1: string; tarikh2: string; license: number; state: string; currentDb: string;
  dbs: string[]; flag: (name: string) => boolean;
};
type GstrRow = Record<string, unknown>;

const GSTR_SCHEMA = /^[a-z_][a-z0-9_]*$/;

/** The company's state code and the companies the report adds up (CUR_YEAR): this one, or with CHK_MULTICO all of its GSTIN for the year. */
async function gstrEnvironment(loader: Loader, plan: ReportPlan): Promise<GstrEnv> {
  const { call } = plan;
  const { session } = loader;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const flag = (name: string) => call.checkQuery.includes(`${name},`);
  const state = toText((await runReportSql(loader, `SELECT coalesce(STATE_CODE,'') AS s FROM smart_system.COMPANY WHERE co_key = $1`, [session.companyKey])).rows[0]?.s);
  let dbs = [call.database];
  if (flag("CHK_MULTICO")) {
    const gst = toText((await runReportSql(loader, `SELECT coalesce(GST_NO,'') AS g FROM smart_system.COMPANY WHERE co_key = $1 and coalesce(GST_NO,'')<>''`, [session.companyKey])).rows[0]?.g);
    if (gst === "") throw new ReportRefusal("Multi Company GSTIN Not Set", "Multi Company GSTIN Not Set");
    const rows = (await runReportSql(loader, `SELECT lower(btrim(comp.CO_DATANAME)) AS schema_name FROM smart_system.CNAME cnam left join smart_system.COMPANY comp on comp.co_key=cnam.c_id WHERE cnam.C_TARIKH1::date = ${day(call.tarikh1)} and cnam.C_TARIKH2::date = ${day(call.tarikh2)} and coalesce(comp.CO_SHORT,'')<>'' and comp.GST_NO = $1 ORDER BY comp.CO_SHORT`, [gst])).rows;
    dbs = rows.map((row) => toText(row.schema_name)).filter((name) => GSTR_SCHEMA.test(name)).map((name) => `${name}.`);
  }
  return { loader, plan, from: day(call.from), upto: day(call.upto), tarikh1: day(call.tarikh1), tarikh2: day(call.tarikh2), license: call.licence, state, currentDb: call.database, dbs, flag };
}

const gstrQuery = async (env: GstrEnv, sql: string): Promise<GstrRow[]> => (await runReportSql(env.loader, pgFragment(sql, env.plan, env.loader.session.companySchema))).rows;
const gstrRound = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const gstrStateLiteral = (env: GstrEnv): string => `'${env.state.replace(/'/g, "''")}'`;
/** Licences 19, 29 and 73 leave out the CA_ENT books. */
const gstrCaEnt = (env: GstrEnv, alias: string, db: string): string => ([19, 29, 73].includes(env.license) ? ` and ${alias}.book_code not in (select code from ${db}ACCOUNT where a_short='CA_ENT')` : "");
/** REPLACE(CONVERT(CHAR(9), date, 6), ' ', '-'): 05-Jan-24. */
const gstrDate6 = (column: string): string => `to_char(${column},'DD-Mon-YY')`;
/** The party's name without what follows a "[". */
const GSTR_PARTY = `(case when strpos(g.name,'[') > 0 then left(g.name,strpos(g.name,'[')-1) else g.name end)`;

/** The slab of the year for the book: the master slab (link 0, the CGST one) or the linked one (SGST). */
async function gstrSlab(env: GstrEnv, db: string, book: number, link: "=0" | ">0"): Promise<number> {
  return num((await gstrQuery(env, `SELECT coalesce(SLAB_KEY,0) AS k FROM ${db}SLAB_MASTER WHERE SLAB_FROMDT = ${env.tarikh1} AND SLAB_MASTER='Y' and slab_link${link} AND SLAB_ACTIVE = 'Y' AND BOOK = ${book} ORDER BY SLAB_KEY DESC LIMIT 1`))[0]?.k);
}

/** Whether the book's slabs are by product (SLAB_POS 'P'). */
async function gstrProductWise(env: GstrEnv, db: string, book: number): Promise<boolean> {
  return num((await gstrQuery(env, `SELECT count(*) AS n FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = ${env.tarikh1} AND SLAB_MASTER='Y' AND SLAB_ACTIVE = 'Y' and BOOK = ${book}`))[0]?.n) > 0;
}

// ---- GSTR 3B ----

/** The ledger lines with the party's registration (i by P_REG, or by DESIGNATION for the purchases) and, when asked, the tax place (j). */
function gstr3bFrom(db: string, productWise: boolean, party: "p_reg" | "designation", place: boolean): string {
  return ` from ${db}ledger a left join ${db}ledger_ext b on a.led_key = b.led_id${productWise ? ` left join ${db}prod_ledger c on b.il_id = c.il_key` : ""}`
    + ` left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
    + ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.${party}::text`
    + `${place ? ` left join ${db}idopt_master j on j.idopt_key::text = e.tax_place::text` : ""}`;
}

const GSTR_TAX_OF_ORDER: Readonly<Record<number, string>> = { 1: "='CGST'", 2: " in ('SGST','UTGST')", 3: "='IGST'" };

/** Where the stock lines decide (a product slab book): a line of the book, or an entry with no line but a tax. */
const gstrLineCondition = (line: string): string => ` and ((${line}.il_key is not null and ${line}.il_pos = 'A') or (${line}.il_key is null and b.tax_id > 0))`;

function gstr3bSale(env: GstrEnv, db: string, order: number, productWise: boolean, cgst: number, sgst: number): string {
  return `select coalesce(sum(case when a.ag_book = 8 and a.book=16 then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end),0) as amount,coalesce(sum(case when a.ag_book = 8 and a.book=16 then b.slab_amt::numeric *-1 else b.slab_amt::numeric end),0) as tax_amt`
    + gstr3bFrom(db, productWise, "p_reg", false)
    + ` where a.doc_date between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", env.currentDb)}`
    + ` and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and f.opt_Desc${GSTR_TAX_OF_ORDER[order]} and b.slab_id=${order === 2 ? sgst : cgst}`
    + `${productWise ? gstrLineCondition("c") : ""} and (a.book in (8,11,16) or a.ag_book in (8)) and h.address_id=1 and (b.led_id is not null${productWise ? " or b.tax_id > 0" : ""})`;
}

/** The expense book's lines: with reverse charge (rc), without it (pexp, book 15) or the debit notes (dn, book 10). */
function gstr3bExpense(env: GstrEnv, db: string, order: number, productWise: boolean, kind: "rc" | "pexp" | "dn"): string {
  const sums = kind === "rc"
    ? `coalesce(sum(case when a.book = 15 then a.amount::numeric else a.amount::numeric *-1 end),0) as amount,coalesce(sum(case when a.book = 15 then b.slab_amt::numeric else b.slab_amt::numeric *-1 end),0) as tax_amt`
    : `coalesce(sum(a.amount::numeric),0) as amount,coalesce(sum(b.slab_amt::numeric),0) as tax_amt`;
  const which = kind === "rc" ? ` and a.rev_charge='Y' and a.book in (10,15)` : kind === "pexp" ? ` and a.rev_charge='N' and a.book=15` : ` and a.rev_charge='N' and a.book=10`;
  return `select ${sums} from ${db}ledger a left join ${db}ledger_ext b on a.led_key = b.led_id${productWise ? ` left join ${db}prod_ledger f on f.il_key = b.il_id` : ""}`
    + ` left join ${db}slab_master c on b.slab_id = c.slab_key left join ${db}tax_master d on b.tax_id = d.tax_rec left join ${db}idopt_master e on d.tax_type = e.idopt_key::text`
    + ` where a.doc_date between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", env.currentDb)}`
    + ` and a.doc_pos<>'D' and b.tax_id>0 and e.opt_Desc${GSTR_TAX_OF_ORDER[order]}${which}`
    + `${productWise ? gstrLineCondition("f") : ""} and (b.led_id is not null${productWise ? " or b.tax_id > 0" : ""})`;
}

/** The purchase book's tax by order (1 CGST, 2 SGST, 3 IGST), without the imports and the ISD. */
function gstr3bPurchase(env: GstrEnv, db: string, order: number, productWise: boolean, slabs: { pc: number; ps: number; ec: number; es: number }): string {
  const slab = order === 1 ? ` and (b.slab_id=${slabs.pc} or b.slab_id=${slabs.ec})` : order === 2 ? ` and (b.slab_id=${slabs.ps} or b.slab_id=${slabs.es})` : ` and b.slab_id=${slabs.pc}`;
  return `select coalesce(sum(case when a.ag_book = 13 and a.book=11 then b.slab_amt::numeric *-1 else b.slab_amt::numeric end),0) as tax_amt`
    + gstr3bFrom(db, productWise, "designation", true)
    + ` where a.doc_date between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", env.currentDb)}`
    + ` and a.doc_pos<>'D' and b.tax_id>0 and f.opt_Desc${GSTR_TAX_OF_ORDER[order]}${slab}`
    + ` and j.opt_Desc<>'IMPORT OF GOODS' and j.opt_Desc<>'IMPORT GOODS OF SERVICE' and j.opt_Desc<>'ISD'`
    + ` and (a.book in (11,13,16) or a.ag_book in (13)) and h.address_id=1${productWise ? gstrLineCondition("c") : ""} and (b.led_id is not null${productWise ? " or b.tax_id > 0" : ""})`;
}

/** The zero rated / exempted outward supplies (kind zero, nil) of registered persons, by the tax place. */
function gstr3bNil(env: GstrEnv, db: string, productWise: boolean, cgst: number, kind: "zero" | "nil"): string {
  const amount = productWise ? `coalesce(sum(case when a.ag_book = 8 then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end),0)` : `coalesce(sum(case when a.ag_book = 8 then a.amount::numeric *-1 else a.amount::numeric end),0)`;
  const slab = kind === "zero" ? ` and f.opt_Desc='IGST' and b.slab_id=${cgst}` : ` and b.slab_id=${cgst}`;
  const place = kind === "zero" ? `(j.opt_Desc='EXPORT' or j.opt_Desc='SUPPLY TO SEZ EXEMPTED')` : `(j.opt_Desc='NIL RATED' or j.opt_Desc='EXEMPTED')`;
  return `select ${amount} as amount` + gstr3bFrom(db, productWise, "p_reg", true)
    + ` where a.doc_date between ${env.from} AND ${env.upto} and a.doc_pos<>'D' and b.tax_id>0${slab}${gstrCaEnt(env, "a", env.currentDb)}${productWise ? gstrLineCondition("c") : ""}`
    + ` and e.tax_perc::numeric=0 and i.opt_Desc='REGISTER' and ${place} and (a.book in (8) or a.ag_book in (8)) and h.address_id=1 and (b.led_id is not null${productWise ? " or b.tax_id>0" : ""})`;
}

/** The input tax of the imports of goods / services and of the ISD (by the tax place's name). */
function gstr3bInput(env: GstrEnv, db: string, productWise: boolean, purchCgst: number, place: string): string {
  return `select coalesce(sum(case when a.ag_book = 13 then b.slab_amt::numeric *-1 else b.slab_amt::numeric end),0) as tax_amt` + gstr3bFrom(db, productWise, "designation", true)
    + ` where a.doc_date between ${env.from} AND ${env.upto} and a.doc_pos<>'D' and j.opt_Desc='${place}' and b.tax_id>0 and f.opt_Desc='IGST' and b.slab_id=${purchCgst}${gstrCaEnt(env, "a", env.currentDb)}`
    + `${productWise ? gstrLineCondition("c") : ""} and (a.book in (13) or a.ag_book in (13)) and h.address_id=1 and (b.led_id is not null${productWise ? " or b.tax_id > 0" : ""})`;
}

export async function gstr3b(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const env = await gstrEnvironment(loader, plan);
  const t = {
    gstBill: 0, gstCgst: 0, gstIgst: 0, gstSgst: 0, expBill: 0, expCgst: 0, expIgst: 0, expSgst: 0, zero: 0, nil: 0, purchCgst: 0, purchIgst: 0, purchSgst: 0,
    imp: 0, impSer: 0, isd: 0, pexpBill: 0, pexpCgst: 0, pexpIgst: 0, pexpSgst: 0, dnBill: 0, dnCgst: 0, dnIgst: 0, dnSgst: 0,
  };
  const first = async (sql: string, column: string): Promise<number> => num((await gstrQuery(env, sql))[0]?.[column]);
  for (const db of env.dbs) {
    const salePw = await gstrProductWise(env, db, 8);
    const purchPw = await gstrProductWise(env, db, 13);
    const expPw = await gstrProductWise(env, db, 15);
    const sgst = await gstrSlab(env, db, 8, ">0");
    const cgst = await gstrSlab(env, db, 8, "=0");
    const slabs = { ps: await gstrSlab(env, db, 13, ">0"), pc: await gstrSlab(env, db, 13, "=0"), es: await gstrSlab(env, db, 15, ">0"), ec: await gstrSlab(env, db, 15, "=0") };
    for (let order = 1; order <= 3; order += 1) {
      // One query at a time: runReportSql keeps a savepoint per statement on the one connection.
      const sale = (await gstrQuery(env, gstr3bSale(env, db, order, salePw, cgst, sgst)))[0];
      if (order === 1) { t.gstBill = gstrRound(t.gstBill + num(sale?.amount)); t.gstCgst = gstrRound(t.gstCgst + num(sale?.tax_amt)); }
      else if (order === 2) t.gstSgst = gstrRound(t.gstSgst + num(sale?.tax_amt));
      else { t.gstBill = gstrRound(t.gstBill + num(sale?.amount)); t.gstIgst = gstrRound(t.gstIgst + num(sale?.tax_amt)); }

      for (const kind of ["rc", "pexp", "dn"] as const) {
        const row = (await gstrQuery(env, gstr3bExpense(env, db, order, expPw, kind)))[0];
        const key = kind === "rc" ? "exp" : kind;
        const bill = `${key}Bill` as keyof typeof t;
        const cg = `${key}Cgst` as keyof typeof t;
        const sg = `${key}Sgst` as keyof typeof t;
        const ig = `${key}Igst` as keyof typeof t;
        if (order === 1) { t[bill] = gstrRound(t[bill] + num(row?.amount)); t[cg] = gstrRound(t[cg] + num(row?.tax_amt)); }
        else if (order === 2) t[sg] = gstrRound(t[sg] + num(row?.tax_amt));
        else { t[bill] = gstrRound(t[bill] + num(row?.amount)); t[ig] = gstrRound(t[ig] + num(row?.tax_amt)); }
      }

      const purchase = await first(gstr3bPurchase(env, db, order, purchPw, slabs), "tax_amt");
      if (order === 1) t.purchCgst = gstrRound(t.purchCgst + purchase);
      else if (order === 2) t.purchSgst = gstrRound(t.purchSgst + purchase);
      else t.purchIgst = gstrRound(t.purchIgst + purchase);
    }
    t.zero = gstrRound(t.zero + await first(gstr3bNil(env, db, salePw, cgst, "zero"), "amount"));
    t.nil = gstrRound(t.nil + await first(gstr3bNil(env, db, salePw, cgst, "nil"), "amount"));
    t.imp = gstrRound(t.imp + await first(gstr3bInput(env, db, purchPw, slabs.pc, "IMPORT OF GOODS"), "tax_amt"));
    t.impSer = gstrRound(t.impSer + await first(gstr3bInput(env, db, purchPw, slabs.pc, "IMPORT GOODS OF SERVICE"), "tax_amt"));
    t.isd = gstrRound(t.isd + await first(gstr3bInput(env, db, purchPw, slabs.pc, "ISD"), "tax_amt"));
  }

  const table = new ResultTable();
  for (const column of ["NATURE_OF_SUPPLIES", "PLACE_OF_SUPPLY", "TOTAL_TAXABLE_VALUE", "IGST", "CGST", "SGST", "CESS"]) table.addColumn(column);
  for (const column of ["TOTAL_TAXABLE_VALUE", "IGST", "CGST", "SGST", "CESS"]) table.setKind(column, "decimal");
  const line = (nature: string, values: { place?: string; total?: number; igst?: number; cgst?: number; sgst?: number } = {}) => table.insert({
    NATURE_OF_SUPPLIES: nature, PLACE_OF_SUPPLY: values.place ?? null, TOTAL_TAXABLE_VALUE: values.total ?? null, IGST: values.igst ?? null, CGST: values.cgst ?? null, SGST: values.sgst ?? null,
  });
  const inputIgst = gstrRound(t.purchIgst + t.pexpIgst + t.imp + t.impSer + t.isd);
  const inputCgst = gstrRound(t.purchCgst + t.pexpCgst);
  const inputSgst = gstrRound(t.purchSgst + t.pexpSgst);
  line("3.1 Detail of Outward Supplies and Inward supplies", { place: "", total: gstrRound(t.gstBill + t.expBill), igst: gstrRound(t.gstIgst + t.expIgst), cgst: gstrRound(t.gstCgst + t.expCgst), sgst: gstrRound(t.gstSgst + t.expSgst) });
  line("      liable to reverse charges");
  line("( a) Outward taxable supplies (other than following)", { place: "", total: t.gstBill, igst: t.gstIgst, cgst: t.gstCgst, sgst: t.gstSgst });
  line("( b) Outward taxable supplies (zero rated", { place: "", total: t.zero });
  line("       I.E., EXPORT & SUPPLY TO SEZ)");
  line("( c) Other outward supplies, (Nil rated, exempted)", { total: t.nil });
  line("( d) Inward supplies (liable to reverse charge)", { total: t.expBill, igst: t.expIgst, cgst: t.expCgst, sgst: t.expSgst });
  line("( e) Non GST outward supplies");
  line("3.2 Of the supplies shown in 3.1 (a) above, details of inter-State supplies made to");
  line("     unregistered persons, composition taxable persons and UIN holders");
  line("Supplies made to Unregistered Persons");
  // The procedure's loops over the supplies to unregistered, composition and UIN holder persons fetch from the cursor it has already run
  // to its end, so they add no rows: only these headings come out.
  line("Supplies made to Composition Taxable Persons");
  line("Supplies made to UIN Holders");
  line("4 Eligible ITC");
  line("(A) ITC Available (whether in full or part)");
  line("(1) Import of goods", { igst: t.imp });
  line("(2) Import of services", { igst: t.impSer });
  line("(3) Inward supplies liable to reverse charge");
  line("      (other than 1 & 2 above)");
  line("(4) Inward supplies from ISD", { igst: t.isd });
  line("(5) All  other ITC");
  line("   (A)  Purchase", { place: "", igst: t.purchIgst, cgst: t.purchCgst, sgst: t.purchSgst });
  line("   (B)  Expense", { place: "", igst: t.pexpIgst, cgst: t.pexpCgst, sgst: t.pexpSgst });
  line("TOTAL (A)", { place: "", igst: inputIgst, cgst: inputCgst, sgst: inputSgst });
  line("(B) ITC Reversed");
  line("(1) As per rules 42 & 43 of CGST Rules");
  line("(2) Others", { place: "", igst: t.dnIgst, cgst: t.dnCgst, sgst: t.dnSgst });
  line("TOTAL (B)", { place: "", igst: t.dnIgst, cgst: t.dnCgst, sgst: t.dnSgst });
  line("(C) Net ITC Available (A) – (B)", { place: "", igst: gstrRound(inputIgst - t.dnIgst), cgst: gstrRound(inputCgst - t.dnCgst), sgst: gstrRound(inputSgst - t.dnSgst) });
  line("(D) Ineligible ITC");
  line("(1) As per section 17(5)");
  line("(2) Others");
  line("Total (D)");
  line("(E) Net ITC Available (C) – (D)");
  line("5 Values of exempt, nil-rated and non-GST inward supplies");
  line("From a supplier under composition scheme,");
  line("Exempt and Nil rated supply");
  line("Non GST supply");
  return table;
}

// ---- result tables of the GSTR 1 / GSTR 2 ----

type GstrColumn = string | readonly [string, "decimal" | "int"];

/** A result table of the given columns (a name alone is text, a pair a number column). */
function gstrTable(columns: readonly GstrColumn[]): ResultTable {
  const table = new ResultTable();
  for (const column of columns) {
    if (typeof column === "string") table.addColumn(column);
    else table.setKind(column[0], column[1]);
  }
  return table;
}

/** An INSERT naming some columns: numbers read from the database as text become numbers, the other columns stay null. */
function gstrInsert(table: ResultTable, values: GstrRow): ResultRow {
  const converted: GstrRow = {};
  for (const [column, value] of Object.entries(values)) {
    const name = table.name(column);
    if (name === undefined) continue;
    converted[name] = table.kind(name) === "text" || value === null || value === undefined ? value ?? null : num(value);
  }
  return table.insert(converted);
}

/** How many different values the column has, leaving out the blank ones (COUNT over GROUP BY of COALESCE(x,'')<>''). */
function gstrDistinct(table: ResultTable, column: string): number {
  return new Set(table.rows.map((row) => table.get(row, column)).filter((value) => value !== null && value !== undefined && value !== "")).size;
}

/** The date of a text in the styles the reports write (05-Jan-24, 05/01/2024) as yyyymmdd; null when it is none of them. */
function gstrDateKey(value: unknown): string | null {
  const text = toText(value).trim();
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text);
  if (named) {
    const month = months.indexOf(named[2].toLowerCase());
    if (month < 0) return null;
    const year = named[3].length === 2 ? (Number(named[3]) <= 49 ? 2000 : 1900) + Number(named[3]) : Number(named[3]);
    return `${year}${String(month + 1).padStart(2, "0")}${named[1].padStart(2, "0")}`;
  }
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  return slashed ? `${slashed[3]}${slashed[2].padStart(2, "0")}${slashed[1].padStart(2, "0")}` : null;
}

/** ORDER BY convert(datetime, column, 103): by the date, the rows without one first (a stable sort). */
function gstrSortByDate(table: ResultTable, column: string): void {
  const indexed = table.rows.map((row, index) => ({ row, index, key: gstrDateKey(table.get(row, column)) }));
  indexed.sort((a, b) => (a.key === b.key ? a.index - b.index : a.key === null ? -1 : b.key === null ? 1 : a.key < b.key ? -1 : 1));
  table.rows = indexed.map((entry) => entry.row);
}

/** The SR_NO the procedures add with ROW_NUMBER() over a partition: the first row of each keeps its amounts, the others have the given columns set to 0. */
function gstrFirstOfPartition(table: ResultTable, partition: readonly string[], zero: readonly string[]): void {
  table.setKind("SR_NO", "int");
  const seen = new Map<string, number>();
  for (const row of table.rows) {
    const key = partition.map((column) => String(table.get(row, column) ?? "")).join("|");
    const rank = (seen.get(key) ?? 0) + 1;
    seen.set(key, rank);
    row[table.name("SR_NO") as string] = rank;
    if (rank !== 1) for (const column of zero) table.set(row, column, 0);
  }
}

/** DROP COLUMN. */
function gstrDropColumn(table: ResultTable, column: string): void {
  const name = table.name(column);
  if (name === undefined) return;
  table.columns.splice(table.columns.indexOf(name), 1);
  table.numberKinds.delete(name);
  for (const row of table.rows) delete row[name];
}

// ---- GSTR 2 ----

/** Integrated / Central / State tax amounts of the lines (the book given has its amounts taken off: the debit notes of the expense book). */
function gstrTaxSums(negativeBook?: string): string {
  const amount = negativeBook ? `case when ${negativeBook} = 10 then b.slab_amt::numeric *-1 else b.slab_amt::numeric end` : `b.slab_amt::numeric`;
  return `coalesce(sum(case when f.opt_Desc='IGST' then ${amount} else 0.00 end),0) as "Integrated_Tax_Amount",`
    + `coalesce(sum(case when f.opt_Desc='CGST' then ${amount} else 0.00 end),0) as "Cenral_Tax_Amount",`
    + `coalesce(sum(case when (f.opt_Desc='SGST' or f.opt_Desc='UTGST') then ${amount} else 0.00 end),0) as "State_UT_Tax_Amount"`;
}

const gstrRateOf = (env: GstrEnv): string => `case when i.opt_short = ${gstrStateLiteral(env)} then b.slab_perc * 2 else b.slab_perc end`;
const GSTR_PLACE = `i.opt_short||'-'||i.opt_desc`;

/** The stock lines of a book with their entry (k), the party's state (i) and registration (j): the product slab books' register. */
const gstrStockFrom = (db: string): string => ` from ${db}prod_ledger a left join ${db}ledger_ext b on a.il_key = b.il_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master c on c.tax_rec = b.tax_id`
  + ` left join ${db}idopt_master f on c.tax_type = f.idopt_key::text left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code`
  + ` left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text left join ${db}ledger k on k.led_key = a.led_id`;

/** The entries of a book with the party's state (i) and registration (j). */
const gstrEntryFrom = (db: string, stock: boolean): string => ` from ${db}ledger a left join ${db}ledger_ext b on a.led_key = b.led_id${stock ? ` left join ${db}prod_ledger c on b.il_id = c.il_key` : ""}`
  + ` left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
  + ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`;

const gstrB2bColumns: readonly GstrColumn[] = [
  "GSTIN_UIN", "DOC_NO", "Invoice_Number", "Invoice_Date", ["Invoice_Value", "decimal"], "Reverse_Charge", "Invoice_Type", ["Rate", "decimal"], ["Taxable_Value", "decimal"], "PLACE_OF_SUPPLY",
  ["Integrated_Tax_Amount", "decimal"], ["Cenral_Tax_Amount", "decimal"], ["State_UT_Tax_Amount", "decimal"], ["Cess_Amount", "decimal"], ["Total_Tax", "decimal"], "Party_Name",
];

/** B2B: the purchase book's entries of the registered parties (from the stock lines when the book's slabs are by product). */
function gstr2B2bPurchase(env: GstrEnv, db: string, productWise: boolean, docno: boolean, chln: boolean): string {
  const lic21 = env.license === 21;
  if (productWise) {
    const invoiceValue = docno
      ? `coalesce((select sum(case when book = 10 then amount::numeric *-1 else amount::numeric end) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0)`
      : `coalesce((select sum(amount::numeric) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0)`;
    const taxable = docno
      ? `coalesce(sum(case when d.slab_link=0 then case when k.book = 10 then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end else 0 end),0)`
      : `coalesce(sum(case when d.slab_link=0 then b.s_lastot::numeric-b.slab_amt::numeric else 0 end),0)`;
    const head = docno
      ? `btrim(h.gst_no) as "GSTIN_UIN",btrim(k.doc_no) as "DOC_NO",btrim(${lic21 ? "k.doc_no1" : "k.doc_no"}) as "Invoice_Number",${gstrDate6(lic21 ? "k.chln_date" : "k.doc_date")} as "Invoice_Date"`
      : `btrim(h.gst_no) as "GSTIN_UIN",a.full_docno as "Invoice_Number",${gstrDate6("a.il_date")} as "Invoice_Date"`;
    const group = docno
      ? (lic21 ? "k.book,h.gst_no,k.chln_date,k.doc_no,k.doc_no1" : "k.book,h.gst_no,a.il_date,k.doc_date,k.doc_no,a.full_docno")
      : "k.book,h.gst_no,a.il_date,a.full_docno";
    const orderDate = docno ? (lic21 ? "k.chln_date" : "k.doc_date") : "a.il_date";
    return `select ${head},${invoiceValue} as "Invoice_Value",(select REV_CHARGE from ${db}ledger where led_key=a.led_id) as "Reverse_Charge",'Regular' as "Invoice_Type",${gstrRateOf(env)} as "Rate",${taxable} as "Taxable_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
      + `${gstrTaxSums("k.book")},0.00 as "Cess_Amount",0.00 as "Total_Tax",${GSTR_PARTY} as "Party_Name"`
      + gstrStockFrom(db)
      + ` where ${chln ? "k.CHLN_DATE" : "a.IL_DATE"} between ${env.from} AND ${env.upto} and a.il_pos<>'D' and b.tax_id>0 and c.tax_perc::numeric>0 and j.opt_Desc='REGISTER' and a.book in (13) and h.address_id=1${gstrCaEnt(env, "k", db)}`
      + ` and b.led_id is not null and b.il_id is not null group by ${group},i.opt_short,i.opt_desc,a.led_id,b.slab_perc,g.name order by ${orderDate},${docno ? "k.doc_no" : "a.full_docno"}`;
  }
  const head = docno
    ? `btrim(h.gst_no) as "GSTIN_UIN",a.doc_no as "DOC_NO",btrim(a.doc_no) as "Invoice_Number",${gstrDate6("a.chln_date")} as "Invoice_Date"`
    : `btrim(h.gst_no) as "GSTIN_UIN",a.doc_no as "DOC_NO",a.full_docno as "Invoice_Number",${gstrDate6("a.doc_date")} as "Invoice_Date"`;
  const group = docno
    ? (lic21 ? "a.book,h.gst_no,a.chln_date,a.doc_no,a.doc_no1" : "a.book,h.gst_no,a.chln_date,a.doc_no,a.full_docno")
    : "a.book,h.gst_no,a.doc_date,a.doc_no,a.full_docno";
  return `select ${head},coalesce(case when a.book = 10 then a.amount::numeric *-1 else a.amount::numeric end,0) as "Invoice_Value",a.rev_charge as "Reverse_Charge",case when a.rev_charge='Y' then 'RC' else 'Regular' end as "Invoice_Type",${gstrRateOf(env)} as "Rate",`
    + `coalesce(sum(case when d.slab_link=0 then case when a.book = 10 then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end else 0 end),0) as "Taxable_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
    + `${gstrTaxSums("a.book")},0.00 as "Cess_Amount",0.00 as "Total_Tax",${GSTR_PARTY} as "Party_Name"`
    + gstrEntryFrom(db, false)
    + ` where ${chln ? "a.CHLN_DATE" : "a.DOC_DATE"} between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0`
    + `${env.license === 43 ? " and (a.book in (10,13,15) or (a.book = 16 and a.ag_book = 13))" : " and a.book in (10,13,15)"} and h.address_id=1 and (b.led_id is not null)`
    + ` group by ${group},i.opt_short,i.opt_desc,a.rev_charge,b.slab_perc,g.name,a.amount order by ${docno ? "a.chln_date" : "a.doc_date"},a.doc_no`;
}

/** B2B: the expense book's entries of the registered parties (the table TEMP_TABLE_GSTR_P_, added to the rest by invoice number). */
function gstr2B2bExpense(env: GstrEnv, db: string, productWise: boolean, docno: boolean, chln: boolean): string {
  const lic21 = env.license === 21;
  if (productWise) {
    const invoiceValue = docno
      ? `coalesce((select sum(case when book = 10 then amount::numeric *-1 else amount::numeric end) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0)`
      : `coalesce((select amount::numeric from ${db}ledger where led_key=a.led_id and amount::numeric>0 limit 1),0)`;
    const head = docno
      ? `btrim(h.gst_no) as "GSTIN_UIN",btrim(k.doc_no) as "DOC_NO",btrim(${lic21 ? "k.doc_no1" : "k.doc_no"}) as "Invoice_Number",${gstrDate6(lic21 ? "k.chln_date" : "k.doc_date")} as "Invoice_Date"`
      : `btrim(h.gst_no) as "GSTIN_UIN",a.full_docno as "Invoice_Number",${gstrDate6("a.il_date")} as "Invoice_Date"`;
    const group = docno
      ? (lic21 ? "k.book,h.gst_no,k.chln_date,k.doc_no,k.doc_no1" : "k.book,h.gst_no,a.il_date,k.doc_date,k.doc_no,a.full_docno")
      : "k.book,h.gst_no,a.il_date,a.full_docno";
    return `select ${head},${invoiceValue} as "Invoice_Value",(select REV_CHARGE from ${db}ledger where led_key=a.led_id) as "Reverse_Charge",'Regular' as "Invoice_Type",${gstrRateOf(env)} as "Rate",`
      + `coalesce(sum(case when d.slab_link=0 then case when k.book = 10 then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end else 0 end),0) as "Taxable_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
      + `${gstrTaxSums("k.book")},0.00 as "Cess_Amount",0.00 as "Total_Tax",${GSTR_PARTY} as "Party_Name"`
      + gstrStockFrom(db)
      + ` where ${chln ? "k.CHLN_DATE" : "a.IL_DATE"} between ${env.from} AND ${env.upto} and a.il_pos<>'D' and b.tax_id>0 and c.tax_perc::numeric>0 and j.opt_Desc='REGISTER' and a.book in (15) and h.address_id=1${gstrCaEnt(env, "k", db)}`
      + ` and b.led_id is not null and b.il_id is not null group by ${group},i.opt_short,i.opt_desc,a.led_id,b.slab_perc,g.name order by ${docno ? (lic21 ? "k.chln_date" : "a.il_date") : "a.il_date"},${docno ? "k.doc_no" : "a.full_docno"}`;
  }
  const invoice = docno ? `btrim(a.doc_no1)` : `a.full_docno`;
  return `select btrim(h.gst_no) as "GSTIN_UIN",a.doc_no as "DOC_NO",${invoice} as "Invoice_Number",${gstrDate6("a.doc_date")} as "Invoice_Date",coalesce(sum(case when d.slab_link=0 then case when a.book = 10 then a.amount::numeric *-1 else a.amount::numeric end else 0 end),0) as "Invoice_Value",`
    + `case when a.rev_charge='Y' then 'RC' else 'Regular' end as "Invoice_Type",${gstrRateOf(env)} as "Rate",`
    + `coalesce(sum(case when d.slab_link=0 then case when a.book = 10 then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end else 0 end),0) as "Taxable_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
    + `${gstrTaxSums("a.book")},0.00 as "Cess_Amount",0.00 as "Total_Tax",${GSTR_PARTY} as "Party_Name"`
    + gstrEntryFrom(db, false)
    + ` where ${chln ? "a.CHLN_DATE" : "a.DOC_DATE"} between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and j.opt_Desc='REGISTER' and a.book in (10,15) and h.address_id=1 and (b.led_id is not null)`
    + ` group by a.book,h.gst_no,a.doc_date,a.doc_no,${docno ? "a.doc_no1" : "a.full_docno"},i.opt_short,i.opt_desc,a.rev_charge,b.slab_perc,g.name order by a.doc_date,a.doc_no`;
}

/** HSN of the purchase side: quantity, value, taxable value and the taxes of each HSN code and unit. */
function gstr2Hsn(env: GstrEnv, db: string, purchPw: boolean, summary: boolean, factor: boolean): string {
  const aient = env.license === 17;
  const hsn = aient ? `(case when aient.TXT_HSNCODE=' NONE' then btrim(k.hsn_code) else btrim(aient.TXT_HSNCODE) end)` : `btrim(k.hsn_code)`;
  const uoms = [["qty1", "trn_qty1"], ["qty2", "trn_qty2"], ["qty3", "trn_qty3"], ["pack", "trn_pack"], ["weight", "trn_weight"]] as const;
  const added = `(case when c.uomentry_id=k.pcs_uom then c.trn_pcs-c.ag_qty ${uoms.map(([uom, col]) => `when c.uomentry_id=k.${uom}_uom then c.${col}-round((c.AG_QTY/nullif(c.QUANTITY,0)*c.${col}),2)`).join(" ")} else c.QUANTITY-c.ag_qty end)`;
  const taken = `(case when c.uomentry_id=k.pcs_uom then c.trn_pcs ${uoms.map(([uom, col]) => `when c.uomentry_id=k.${uom}_uom then c.${col}`).join(" ")} else c.QUANTITY end)`;
  const quantity = factor
    ? `coalesce(sum(case when c.STOCK_NAT='A' and c.inventory='Y' and d.slab_link = 0 then c.factor else case when c.STOCK_NAT='L' and d.slab_link = 0 then c.factor *-1 else 0 end end),0)`
    : `coalesce(sum(case when c.STOCK_NAT='A' and c.inventory='Y' and d.slab_link = 0 then ${added} else 0.00 end),0)-coalesce(sum(case when c.STOCK_NAT='L' and c.inventory='Y' and d.slab_link = 0 then ${taken} else 0.00 end),0)`;
  const share = `(c.il_value::numeric/nullif(a.prod_amt::numeric,0))`;
  const signed = (amount: string, extra: string) => `coalesce(sum(case when c.stock_nat = 'A'${extra} then ${amount} else case when c.stock_nat = 'L'${extra} then (${amount}) *-1 else 0.00 end end),0)`;
  const value = signed("c.il_value::numeric", " and d.slab_link = 0");
  const taxable = purchPw ? signed("b.s_lastot::numeric-b.slab_amt::numeric", " and d.slab_link = 0") : signed(`round(${share} * (b.s_lastot::numeric-b.slab_amt::numeric),2)`, " and d.slab_link = 0");
  const tax = (kind: string) => purchPw ? signed("b.slab_amt::numeric", ` and ${kind}`) : signed(`round(${share} * b.slab_amt::numeric,2)`, ` and ${kind}`);
  const select = `${hsn} as "HSN",${summary ? "" : `k.prod_desc as "Description",`}l.uom_short as "UQC",${quantity} as "Total_Quantity",${value} as "Total_Value",${taxable} as "Taxable_Value",`
    + `${tax("f.opt_Desc='IGST'")} as "Integrated_Tax_Amount",${tax("f.opt_Desc='CGST'")} as "Cenral_Tax_Amount",${tax("(f.opt_Desc='SGST' or f.opt_Desc='UTGST')")} as "State_UT_Tax_Amount",0.00 as "Cess_Amount"`;
  const group = `${aient ? "aient.TXT_HSNCODE," : ""}k.hsn_code,${summary ? "" : "k.prod_desc,"}l.uom_short`;
  return `select ${select} from ${db}ledger a left join ${db}ledger_ext b on b.led_id = a.led_key left join ${db}prod_ledger c on ${purchPw ? "c.il_key = b.il_id" : "c.led_id = a.led_key"} and c.il_pos='A'`
    + ` left join ${db}slab_master d on d.slab_key = b.slab_id left join ${db}tax_master e on e.tax_rec = b.tax_id left join ${db}idopt_master f on f.idopt_key::text = e.tax_type left join ${db}product_master k on k.prod_key = c.prod_id and k.prod_pos<>'D'`
    + ` left join ${db}prod_uom l on l.uom_key = ${factor ? "c.rateuom_id" : "c.uomentry_id"}${aient ? ` left join ${db}addon_ientry aient on aient.aoni_il_id = c.il_key` : ""}`
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto} and a.doc_pos<>'D' and b.tax_id>0${gstrCaEnt(env, "a", db)} and a.book in (13,15,16,11) and (a.ag_book=13 or coalesce(a.ag_book,0)=0)`
    + ` and b.led_id is not null and b.il_id is ${purchPw ? "not " : ""}null group by ${group} order by k.hsn_code`;
}

/** B2C large: the purchase book's entries of the unregistered parties. */
function gstr2B2cLarge(env: GstrEnv, db: string, purchPw: boolean, chln: boolean): string {
  const sums = (amount: string) => `coalesce(sum(case when f.opt_Desc='IGST' then ${amount} else 0.00 end),0) as "Integrated_Tax_Amount",coalesce(sum(case when f.opt_Desc='CGST' then ${amount} else 0.00 end),0) as "Cenral_Tax_Amount",`
    + `coalesce(sum(case when (f.opt_Desc='SGST' or f.opt_Desc='UTGST') then ${amount} else 0.00 end),0) as "State_UT_Tax_Amount",0.00 as "Cess_Amount",0.00 as "Total_Tax"`;
  if (purchPw) {
    return `select btrim(h.gst_no) as "GSTIN_UIN",a.full_docno as "Invoice_Number",${gstrDate6("a.il_date")} as "Invoice_Date",coalesce((select sum(amount::numeric) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0) as "Invoice_Value",'Regular' as "Invoice_Type",${gstrRateOf(env)} as "Rate",`
      + `coalesce(sum(case when d.slab_link=0 then b.s_lastot::numeric-b.slab_amt::numeric else 0 end),0) as "Taxable_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",${sums("b.slab_amt::numeric")}`
      + gstrStockFrom(db)
      + ` where ${chln ? "k.CHLN_DATE" : "a.IL_DATE"} between ${env.from} AND ${env.upto} and a.il_pos<>'D' and b.tax_id>0 and c.tax_perc::numeric>0 and j.opt_Desc='UN-REGISTER' and a.book in (13) and h.address_id=1 and b.led_id is not null and b.il_id is not null${gstrCaEnt(env, "k", db)}`
      + ` group by h.gst_no,a.il_date,a.full_docno,i.opt_short,i.opt_desc,a.led_id,b.slab_perc order by a.il_date,a.full_docno`;
  }
  return `select btrim(h.gst_no) as "GSTIN_UIN",a.full_docno as "Invoice_Number",${gstrDate6("a.doc_date")} as "Invoice_Date",coalesce(sum(case when d.slab_link=0 then a.amount::numeric else 0 end),0) as "Invoice_Value",'Regular' as "Invoice_Type",${gstrRateOf(env)} as "Rate",`
    + `coalesce(sum(case when d.slab_link=0 then b.s_lastot::numeric-b.slab_amt::numeric else 0 end),0) as "Taxable_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",${sums("b.slab_amt::numeric")}`
    + gstrEntryFrom(db, false)
    + ` where ${chln ? "a.CHLN_DATE" : "a.DOC_DATE"} between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and j.opt_Desc='UN-REGISTER' and a.book in (13) and h.address_id=1 and (b.led_id is not null)`
    + ` group by h.gst_no,a.doc_date,a.full_docno,i.opt_short,i.opt_desc,a.rev_charge,b.slab_perc order by a.doc_date,a.full_docno`;
}

/** B2C small: the taxable value by place and rate of the purchases from parties that are not registered, up to 250000. */
function gstr2B2cSmall(env: GstrEnv, db: string, purchPw: boolean, purchCgst: number, chln: boolean): string {
  const taxable = purchPw
    ? `coalesce(sum(case when c.stock_nat = 'L' then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end),0)`
    : `coalesce(sum(case when a.ag_book = 13 and a.ac_dbcode=1 then b.slab_amt::numeric *-1 when a.ag_book = 13 and a.ac_dbcode=2 then b.s_lastot::numeric-b.slab_amt::numeric when a.ag_book = 0 then b.s_lastot::numeric-b.slab_amt::numeric end),0)`;
  return `select 'OE' as "Invoice_Type",${GSTR_PLACE} as "PLACE_OF_SUPPLY",(${gstrRateOf(env)}) as "Rate",${taxable} as "Taxable_Value",'' as "E_Commerce_GSTIN"`
    + gstrEntryFrom(db, purchPw)
    + ` where ${chln ? "a.CHLN_DATE" : "a.DOC_DATE"} between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and a.amount::numeric<=250000 and b.slab_id=${purchCgst}`
    + `${purchPw ? " and (c.il_pos='A' or c.il_pos is not null)" : ""} and j.opt_Desc<>'REGISTER' and a.book in (13,11,16) and h.address_id=1 and (b.led_id is not null${purchPw ? " or b.il_id is not null" : ""})`
    + ` group by i.opt_short,i.opt_desc,b.slab_perc order by i.opt_short,i.opt_desc,b.slab_perc`;
}

/** Credit / debit notes (register persons) of the purchase book: the notes against a bill (CTE_TEMP) and the bills' own (CTE_TEMP1), joined by OUT_AG_OUTID / OUT_KEY. */
function gstr2NoteQueries(env: GstrEnv, db: string, purchPw: boolean, purchCgst: number, registered: boolean): { notes: string; bills: string } {
  const partyCondition = registered ? `j.opt_Desc='REGISTER'` : `j.opt_Desc<>'REGISTER'`;
  const type = `(case when a.book=11 then 'D' else 'C' end)`;
  const place = GSTR_PLACE;
  const rate = gstrRateOf(env);
  const outclear = (key: string) => ` left join ${db}outclear k on k.out_ledid = ${key}`;
  const people = ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`;
  const slabs = ` left join ${db}ledger_ext b on a.led_key = b.led_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`;
  const ur = registered ? "" : `'B2CL' as "UR_Type",`;
  const receiver = registered ? `btrim(h.gst_no) as "GSTIN_UIN_of_Recipient",(case when strpos(g.name,'[') > 0 then left(g.name,strpos(g.name,'[')-1) else g.name end) as "Receiver_Name",` : "";
  let notes: string;
  if (purchPw) {
    notes = `select ${ur}${receiver}a.full_docno as "invoice_Advance_Receipt_Number",${gstrDate6("a.il_date")} as "invoice_Advance_Receipt_DATE",'' as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.il_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${place} as "PLACE_OF_SUPPLY",`
      + `coalesce((select sum(amount::numeric) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0) as "Note_Refund_Voucher_Value",0 as "App_Tax_Rate",${rate} as "Rate",`
      + `coalesce(sum(${registered ? "case when l.book in (11) and l.ag_book in (8) then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end" : "b.s_lastot::numeric-b.slab_amt::numeric"}),0) as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",k.OUT_AG_OUTID as "OUT_AG_OUTID"`
      + ` from ${db}prod_ledger a left join ${db}ledger_ext b on a.il_key = b.il_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
      + `${people}${outclear("a.led_id")} left join ${db}ledger l on l.led_key = a.led_id left join ${db}addon_aentry m on m.aona_ledid = a.led_id`
      + ` where a.il_DATE between ${env.from} AND ${env.upto} and a.il_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and coalesce(k.out_ag_outid,0)>0 and b.slab_id=${purchCgst}`
      + ` and ${partyCondition} and ${registered ? "(a.book in (11) or (l.book in (16) and l.ag_book in (13)))" : "(a.book in (16) or (l.book in (11) and l.ag_book in (8)))"} and h.address_id=1${gstrCaEnt(env, "l", db)} and b.led_id is not null and b.il_id is not null`
      + ` group by ${registered ? "h.gst_no,g.name," : ""}a.il_date,a.full_docno,i.opt_short,i.opt_desc,k.out_ag_outid,a.book,b.slab_perc,k.out_ag_outid,a.led_id`;
  } else {
    notes = `select ${ur}${receiver}a.full_docno as "invoice_Advance_Receipt_Number",${gstrDate6("a.doc_date")} as "invoice_Advance_Receipt_DATE",a.doc_no as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.doc_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${place} as "PLACE_OF_SUPPLY",`
      + `coalesce(sum(case when d.slab_link=0 then a.amount::numeric else 0 end),0) as "Note_Refund_Voucher_Value",0 as "App_Tax_Rate",${rate} as "Rate",`
      + `coalesce(sum(${registered ? "case when a.book in (11) and a.ag_book in (8) then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end" : "b.s_lastot::numeric-b.slab_amt::numeric"}),0) as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",k.OUT_AG_OUTID as "OUT_AG_OUTID"`
      + ` from ${db}ledger a${slabs}${people}${outclear("a.led_key")} left join ${db}addon_aentry l on l.aona_ledid = a.led_key`
      + ` where a.DOC_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and coalesce(k.out_ag_outid,0)>0 and b.slab_id=${purchCgst}`
      + ` and ${partyCondition} and ${registered ? "(a.book in (11) or (a.book in (16) and a.ag_book in (13)))" : "a.book in (16,11) and a.ag_book in (13)"} and h.address_id=1 and (b.led_id is not null)`
      + ` group by ${registered ? "h.gst_no,g.name," : ""}a.doc_date,a.doc_no,a.full_docno,i.opt_short,i.opt_desc,a.book,b.slab_perc,k.out_ag_outid`;
  }
  const billPlace = !registered && !purchPw ? `i.opt_short||' - '||i.opt_desc` : place;
  const bills = `select ${ur}${receiver}a.full_docno as "invoice_Advance_Receipt_Number",${gstrDate6("a.doc_date")} as "invoice_Advance_Receipt_DATE",a.doc_no as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.doc_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${billPlace} as "PLACE_OF_SUPPLY",`
    + `coalesce(sum(a.amount::numeric),0) as "Note_Refund_Voucher_Value",0.00 as "App_Tax_Rate",0.00 as "Rate",0.00 as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",k.OUT_KEY as "OUT_KEY"`
    + ` from ${db}ledger a${people}${outclear("a.led_key")}`
    + ` where a.doc_pos<>'D'${registered ? "" : " and a.amount::numeric>250000"}${gstrCaEnt(env, "a", db)} and ${partyCondition} and a.book in (${registered ? "13,11,19" : "13"}) and h.address_id=1`
    + ` group by ${registered ? "h.gst_no,g.name," : ""}${registered || purchPw ? "h.gst_no," : ""}a.doc_date,a.doc_no,a.full_docno,i.opt_short,i.opt_desc,a.book,k.out_key`;
  return { notes, bills };
}

/** The credit / debit notes of the register persons not set off against a bill (the second insert of the section). */
function gstr2NotesOpen(env: GstrEnv, db: string, purchPw: boolean, purchCgst: number): string {
  const type = `(case when a.book=11 then 'D' else 'C' end)`;
  const people = ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`;
  const receiver = `btrim(h.gst_no) as "GSTIN_UIN_of_Recipient",(case when strpos(g.name,'[') > 0 then left(g.name,strpos(g.name,'[')-1) else g.name end) as "Receiver_Name"`;
  if (purchPw) {
    return `select ${receiver},'' as "invoice_Advance_Receipt_Number",null as "invoice_Advance_Receipt_DATE",'' as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.il_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
      + `coalesce((select sum(case when book in (11) and ag_book in (8) then amount::numeric *-1 else amount::numeric end) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0) as "Note_Refund_Voucher_Value",0.00 as "App_Tax_Rate",${gstrRateOf(env)} as "Rate",`
      + `coalesce(sum(case when l.book in (11) and l.ag_book in (8) then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end),0) as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",l.full_docno as "SKIP_KEY"`
      + ` from ${db}prod_ledger a left join ${db}ledger_ext b on a.il_key = b.il_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
      + `${people} left join ${db}outclear k on k.out_ledid = a.led_id left join ${db}ledger l on l.led_key = a.led_id left join ${db}addon_aentry m on m.aona_ledid = a.led_id`
      + ` where a.il_DATE between ${env.from} AND ${env.upto} and a.il_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and coalesce(k.out_ag_outid,0)=0 and b.slab_id=${purchCgst}`
      + ` and j.opt_Desc='REGISTER' and (a.book in (11) or (l.book in (16) and l.ag_book in (13))) and h.address_id=1 and b.led_id is not null${gstrCaEnt(env, "l", db)} and b.il_id is not null`
      + ` group by h.gst_no,g.name,a.il_date,a.full_docno,i.opt_short,i.opt_desc,a.book,b.slab_perc,a.led_id,l.full_docno`;
  }
  return `select ${receiver},'' as "invoice_Advance_Receipt_Number",null as "invoice_Advance_Receipt_DATE",a.doc_no as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.doc_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
    + `coalesce(sum(case when d.slab_link=0 then a.amount::numeric else 0 end),0) as "Note_Refund_Voucher_Value",0.00 as "App_Tax_Rate",${gstrRateOf(env)} as "Rate",coalesce(sum(b.s_lastot::numeric-b.slab_amt::numeric),0) as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",a.full_docno as "SKIP_KEY"`
    + ` from ${db}ledger a left join ${db}ledger_ext b on a.led_key = b.led_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
    + `${people} left join ${db}outclear k on k.out_ledid = a.led_key left join ${db}addon_aentry l on l.aona_ledid = a.led_key`
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and coalesce(k.out_ag_outid,0)=0 and b.slab_id=${purchCgst}`
    + ` and j.opt_Desc='REGISTER' and a.book in (16,11) and a.ag_book in (13) and h.address_id=1 and (b.led_id is not null)`
    + ` group by h.gst_no,g.name,a.doc_date,a.doc_no,a.full_docno,i.opt_short,i.opt_desc,a.book,b.slab_perc`;
}

/** Exempted / nil rated purchases of the registered parties, inter-State (the state differs from the company's) or intra-State. */
function gstr2Exempt(env: GstrEnv, db: string, inter: boolean, chln: boolean): string {
  return `select sum(case when k.tax_type='N' then c.il_value::numeric else 0 end) as "Nill_Rated_Supplies",sum(case when k.tax_type='E' then c.il_value::numeric else 0 end) as "Exempted",0.00 as "Non_GST"`
    + ` from ${db}ledger a left join ${db}prod_ledger c on a.led_key = c.led_id left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code`
    + ` left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text left join ${db}product_master k on k.prod_key = c.prod_id`
    + ` where ${chln ? "a.CHLN_DATE" : "a.DOC_DATE"} between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and btrim(i.opt_short)${inter ? "<>" : "="}${gstrStateLiteral(env)} and (k.tax_type='N' or k.tax_type='E')`
    + ` and (c.il_pos='A' or c.il_pos is not null) and j.opt_Desc='REGISTER' and a.book in (13) and h.ADDRESS_ID = 1`;
}

export async function gstr2(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const env = await gstrEnvironment(loader, plan);
  const choice = plan.call.fcValue;
  const docno = env.flag("CHK_DOCNO");
  const chln = env.flag("CHK_CHLNDATE");
  const summary = env.flag("CHK_SUMMARY");
  const factor = env.flag("CHK_FACTCOL");
  let purchPw = false;
  let expPw = false;
  const query = (sql: string) => gstrQuery(env, sql);

  // The table of the choice, made before the first company (the procedure's first pass).
  const kindsOf = (names: readonly string[], numbers: readonly string[]): GstrColumn[] => names.map((name) => (numbers.includes(name) ? ([name, "decimal"] as const) : name));
  let table: ResultTable;
  const noteColumns = ["GSTIN_UIN_of_Recipient", "Receiver_Name", "invoice_Advance_Receipt_Number", "invoice_Advance_Receipt_DATE", "doc_no", "Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date", "Document_Type", "PLACE_OF_SUPPLY", "Note_Refund_Voucher_Value", "App_Tax_Rate", "Rate", "Taxable_Value", "Cess_Amount", "Pre_GST", "OUT_KEY"];
  const noteNumbers = ["Note_Refund_Voucher_Value", "App_Tax_Rate", "Rate", "Taxable_Value", "Cess_Amount", "OUT_KEY"];
  const urColumns = ["UR_Type", "Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date", "Document_Type", "invoice_Advance_Receipt_Number", "invoice_Advance_Receipt_DATE", "doc_no", "PLACE_OF_SUPPLY", "Note_Refund_Voucher_Value", "App_Tax_Rate", "Rate", "Taxable_Value", "Cess_Amount", "Pre_GST"];
  const urNumbers = ["Note_Refund_Voucher_Value", "App_Tax_Rate", "Rate", "Taxable_Value", "Cess_Amount"];
  const taxNumbers = ["Invoice_Value", "Rate", "Taxable_Value", "Integrated_Tax_Amount", "Cenral_Tax_Amount", "State_UT_Tax_Amount", "Cess_Amount", "Total_Tax"];
  switch (choice) {
    case 1: table = gstrTable(gstrB2bColumns); break;
    case 2: table = gstrTable(kindsOf(summary ? ["HSN", "UQC", "Total_Quantity", "Total_Value", "Taxable_Value", "Integrated_Tax_Amount", "Cenral_Tax_Amount", "State_UT_Tax_Amount", "Cess_Amount", "Total_Amount"] : ["HSN", "Description", "UQC", "Total_Quantity", "Total_Value", "Taxable_Value", "Integrated_Tax_Amount", "Cenral_Tax_Amount", "State_UT_Tax_Amount", "Cess_Amount", "Total_Amount"], ["Total_Quantity", "Total_Value", "Taxable_Value", "Integrated_Tax_Amount", "Cenral_Tax_Amount", "State_UT_Tax_Amount", "Cess_Amount", "Total_Amount"])); break;
    case 3: table = gstrTable(kindsOf(["GSTIN_UIN", "Invoice_Number", "Invoice_Date", "Invoice_Value", "Invoice_Type", "Rate", "Taxable_Value", "PLACE_OF_SUPPLY", "Integrated_Tax_Amount", "Cenral_Tax_Amount", "State_UT_Tax_Amount", "Cess_Amount", "Total_Tax"], taxNumbers)); break;
    case 4: table = gstrTable(kindsOf(["Invoice_Type", "PLACE_OF_SUPPLY", "Rate", "Taxable_Value", "E_Commerce_GSTIN"], ["Rate", "Taxable_Value"])); break;
    case 5: table = gstrTable(kindsOf(noteColumns, noteNumbers)); break;
    case 6: table = gstrTable(kindsOf(urColumns, urNumbers)); break;
    case 7: table = gstrTable(kindsOf(["Description", "Nill_Rated_Supplies", "Exempted", "Non_GST"], ["Nill_Rated_Supplies", "Exempted", "Non_GST"])); break;
    default: throw new ReportRefusal("Internal program failure\nQuery Was Blank", "INTERNAL PROGRAM FAILURE");
  }

  for (const db of env.dbs) {
    purchPw = await gstrProductWise(env, db, 13);
    expPw = await gstrProductWise(env, db, 15);
    const purchCgst = await gstrSlab(env, db, 13, "=0");
    if (choice === 1) {
      for (const row of await query(gstr2B2bPurchase(env, db, purchPw, docno, chln))) gstrInsert(table, row);
      const existing = new Set(table.rows.map((row) => table.get(row, "Invoice_Number")));
      const hasNull = [...existing].some((value) => value === null || value === undefined);
      // INSERT ... WHERE Invoice_Number NOT IN (the invoice numbers already in the table): nothing when one of them is NULL.
      for (const row of await query(gstr2B2bExpense(env, db, expPw, docno, chln))) {
        if (hasNull || row.Invoice_Number === null || existing.has(row.Invoice_Number)) continue;
        const { DOC_NO: _docNo, Reverse_Charge: _reverse, ...rest } = row;
        void _docNo; void _reverse;
        gstrInsert(table, rest);
      }
      for (const row of table.rows) table.set(row, "Total_Tax", gstrRound(num(table.get(row, "Integrated_Tax_Amount")) + num(table.get(row, "Cenral_Tax_Amount")) + num(table.get(row, "State_UT_Tax_Amount"))));
    } else if (choice === 2) {
      for (const row of await query(gstr2Hsn(env, db, purchPw, summary, factor))) gstrInsert(table, row);
    } else if (choice === 3) {
      for (const row of await query(gstr2B2cLarge(env, db, purchPw, chln))) gstrInsert(table, row);
    } else if (choice === 4) {
      for (const row of await query(gstr2B2cSmall(env, db, purchPw, purchCgst, chln))) gstrInsert(table, row);
    } else if (choice === 5 || choice === 6) {
      const registered = choice === 5;
      const { notes, bills } = gstr2NoteQueries(env, db, purchPw, purchCgst, registered);
      const noteRows = await query(notes);
      const billRows = await query(bills);
      const byKey = new Map<unknown, GstrRow>();
      for (const bill of billRows) if (!byKey.has(bill.OUT_KEY)) byKey.set(bill.OUT_KEY, bill);
      const joined = noteRows.map((note) => ({ note, bill: byKey.get(note.OUT_AG_OUTID) }))
        .filter((pair) => registered || num(pair.bill?.Note_Refund_Voucher_Value) > 250000);
      joined.sort((a, b) => String(gstrDateKey(a.note.Note_Refund_Voucher_Date) ?? "").localeCompare(String(gstrDateKey(b.note.Note_Refund_Voucher_Date) ?? "")) || String(a.note.Note_Refund_Voucher_Number).localeCompare(String(b.note.Note_Refund_Voucher_Number)));
      for (const { note, bill } of joined) {
        const noteDate = gstrDateKey(note.Note_Refund_Voucher_Date);
        const shown = noteDate ? `${noteDate.slice(6)}/${noteDate.slice(4, 6)}/${noteDate.slice(0, 4)}` : null;
        if (registered) {
          gstrInsert(table, {
            GSTIN_UIN_of_Recipient: note.GSTIN_UIN_of_Recipient, Receiver_Name: note.Receiver_Name, invoice_Advance_Receipt_Number: bill?.invoice_Advance_Receipt_Number ?? null, invoice_Advance_Receipt_DATE: bill?.invoice_Advance_Receipt_DATE ?? null,
            doc_no: note.doc_no, Note_Refund_Voucher_Number: note.Note_Refund_Voucher_Number, Note_Refund_Voucher_Date: shown, Document_Type: note.Document_Type, PLACE_OF_SUPPLY: note.PLACE_OF_SUPPLY,
            Note_Refund_Voucher_Value: num(note.Note_Refund_Voucher_Value), App_Tax_Rate: 0, Rate: note.Rate, Taxable_Value: num(note.Taxable_Value), Cess_Amount: note.Cess_Amount, Pre_GST: note.Pre_GST, OUT_KEY: bill?.OUT_KEY ?? null,
          });
        } else {
          const billDate = gstrDateKey(bill?.invoice_Advance_Receipt_DATE);
          gstrInsert(table, {
            UR_Type: note.UR_Type, Note_Refund_Voucher_Number: note.Note_Refund_Voucher_Number, Note_Refund_Voucher_Date: shown, Document_Type: note.Document_Type,
            invoice_Advance_Receipt_Number: bill?.invoice_Advance_Receipt_Number ?? null, invoice_Advance_Receipt_DATE: billDate ? `${billDate.slice(6)}/${billDate.slice(4, 6)}/${billDate.slice(0, 4)}` : null,
            doc_no: note.doc_no, PLACE_OF_SUPPLY: note.PLACE_OF_SUPPLY, Note_Refund_Voucher_Value: num(note.Note_Refund_Voucher_Value), App_Tax_Rate: 0, Rate: note.Rate, Taxable_Value: num(note.Taxable_Value), Cess_Amount: note.Cess_Amount, Pre_GST: note.Pre_GST,
          });
        }
      }
      if (registered) {
        // The notes not set off against a bill, unless their number is already in the table.
        const existing = new Set(table.rows.map((row) => table.get(row, "Note_Refund_Voucher_Number")));
        const hasNull = [...existing].some((value) => value === null || value === undefined);
        for (const row of await query(gstr2NotesOpen(env, db, purchPw, purchCgst))) {
          if (hasNull || row.SKIP_KEY === null || existing.has(row.SKIP_KEY)) continue;
          const { SKIP_KEY: _skip, ...rest } = row;
          void _skip;
          gstrInsert(table, rest);
        }
      }
    } else {
      for (const inter of [true, false]) {
        const row = (await query(gstr2Exempt(env, db, inter, chln)))[0];
        gstrInsert(table, { Description: `${inter ? "Inter" : "Intra"}-State supplies to registered persons`, Nill_Rated_Supplies: row?.Nill_Rated_Supplies ?? null, Exempted: row?.Exempted ?? null, Non_GST: row?.Non_GST ?? null });
      }
    }
  }

  // What the procedure does once every company is read.
  if (choice === 1) {
    if (purchPw || expPw) {
      table.rows = table.rows.filter((row) => num(table.get(row, "Invoice_Value")) !== 0);
      gstrFirstOfPartition(table, ["Invoice_Number", "Invoice_Date"], ["Invoice_Value"]);
    }
    const gstins = gstrDistinct(table, "GSTIN_UIN");
    const invoices = gstrDistinct(table, "Invoice_Number");
    gstrDropColumn(table, "DOC_NO");
    gstrInsert(table, { GSTIN_UIN: String(gstins), Invoice_Number: String(invoices), Invoice_Date: null, Invoice_Value: 0, PLACE_OF_SUPPLY: "", Invoice_Type: "", Rate: 0, Taxable_Value: 0 });
    gstrSortByDate(table, "Invoice_Date");
  } else if (choice === 2) {
    const hsns = gstrDistinct(table, "HSN");
    gstrInsert(table, summary
      ? { HSN: String(hsns), Total_Quantity: 0, Total_Value: 0, Taxable_Value: 0, Integrated_Tax_Amount: 0, Cenral_Tax_Amount: 0, State_UT_Tax_Amount: 0, Cess_Amount: 0 }
      : { HSN: String(hsns), Description: "", UQC: "", Total_Quantity: 0, Total_Value: 0, Taxable_Value: 0, Integrated_Tax_Amount: 0, Cenral_Tax_Amount: 0, State_UT_Tax_Amount: 0, Cess_Amount: 0 });
    // The final select keeps the rows whose quantity is not 0, which leaves the count row out.
    table.rows = table.rows.filter((row) => table.get(row, "Total_Quantity") !== null && num(table.get(row, "Total_Quantity")) !== 0);
  } else if (choice === 3) {
    for (const row of table.rows) table.set(row, "Total_Tax", gstrRound(num(table.get(row, "Integrated_Tax_Amount")) + num(table.get(row, "Cenral_Tax_Amount")) + num(table.get(row, "State_UT_Tax_Amount"))));
    if (purchPw) {
      table.rows = table.rows.filter((row) => num(table.get(row, "Invoice_Value")) !== 0);
      gstrFirstOfPartition(table, ["Invoice_Number", "Invoice_Date"], ["Invoice_Value"]);
    }
    const gstins = gstrDistinct(table, "GSTIN_UIN");
    const invoices = gstrDistinct(table, "Invoice_Number");
    gstrInsert(table, { GSTIN_UIN: String(gstins), Invoice_Number: String(invoices), Invoice_Date: null, Invoice_Value: 0, PLACE_OF_SUPPLY: "", Invoice_Type: "", Rate: 0, Taxable_Value: 0 });
  } else if (choice === 4) {
    // select Invoice_Type, PLACE_OF_SUPPLY, Rate, sum(Taxable_Value), E_Commerce_GSTIN ... group by Invoice_Type, PLACE_OF_SUPPLY, Rate, E_Commerce_GSTIN.
    const groups = new Map<string, GstrRow>();
    for (const row of table.rows) {
      const key = ["Invoice_Type", "PLACE_OF_SUPPLY", "Rate", "E_Commerce_GSTIN"].map((column) => String(table.get(row, column) ?? "")).join("|");
      const sum = groups.get(key);
      if (sum) sum[table.name("Taxable_Value") as string] = gstrRound(num(sum[table.name("Taxable_Value") as string]) + num(table.get(row, "Taxable_Value")));
      else groups.set(key, { ...row });
    }
    table.rows = [...groups.values()].sort((a, b) => String(table.get(a, "PLACE_OF_SUPPLY")).localeCompare(String(table.get(b, "PLACE_OF_SUPPLY"))) || num(table.get(a, "Rate")) - num(table.get(b, "Rate")));
  } else if (choice === 5 || choice === 6) {
    table.rows = table.rows.filter((row) => num(table.get(row, "Note_Refund_Voucher_Value")) !== 0);
    gstrFirstOfPartition(table, ["Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date"], ["Note_Refund_Voucher_Value", "Taxable_Value", "Rate"]);
    gstrDropColumn(table, "doc_no");
    const invoices = gstrDistinct(table, "invoice_Advance_Receipt_Number");
    const notes = gstrDistinct(table, "Note_Refund_Voucher_Number");
    if (choice === 5) {
      const recipients = gstrDistinct(table, "GSTIN_UIN_of_Recipient");
      gstrInsert(table, { GSTIN_UIN_of_Recipient: String(recipients), invoice_Advance_Receipt_Number: String(invoices), invoice_Advance_Receipt_DATE: null, Note_Refund_Voucher_Number: String(notes), Note_Refund_Voucher_Date: null, Document_Type: "", PLACE_OF_SUPPLY: "", Note_Refund_Voucher_Value: 0, Rate: 0, Taxable_Value: 0, Cess_Amount: 0, Pre_GST: "" });
      gstrSortByDate(table, "Note_Refund_Voucher_Date");
    } else {
      gstrInsert(table, { UR_Type: "", Note_Refund_Voucher_Number: String(notes), Note_Refund_Voucher_Date: null, Document_Type: "", invoice_Advance_Receipt_Number: String(invoices), invoice_Advance_Receipt_DATE: null, PLACE_OF_SUPPLY: "", Note_Refund_Voucher_Value: 0, Rate: 0, Taxable_Value: 0, Cess_Amount: 0, Pre_GST: "" });
    }
  }
  return table;
}

// ---- GSTR 1 ----

/** dd/mm/yyyy of a date text the reports write (CONVERT(varchar(11), date, 103)); null when it is none. */
function gstrDate103(value: unknown): string | null {
  const key = gstrDateKey(value);
  return key ? `${key.slice(6)}/${key.slice(4, 6)}/${key.slice(0, 4)}` : null;
}

/** The ledger entries of the sale book with the party's state (i) and registration (j), the entry's stock lines (c) when the book's slabs are by product. */
const gstr1EntryFrom = (db: string, stock: boolean): string => ` from ${db}ledger a left join ${db}ledger_ext b on a.led_key = b.led_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec`
  + ` left join ${db}idopt_master f on e.tax_type = f.idopt_key::text left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code`
  + ` left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text${stock ? ` left join ${db}prod_ledger c on b.il_id = c.il_key` : ""}`;

/** The stock lines of the sale book (the product slab books' register), with their entry (k). */
const gstr1StockFrom = (db: string): string => ` from ${db}prod_ledger a left join ${db}ledger_ext b on a.il_key = b.il_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master c on c.tax_rec = b.tax_id`
  + ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text left join ${db}ledger k on k.led_key = a.led_id`;

/** The sale entry's amount: the invoice (slab link 0) less what a credit note (ag_book 8, ac_dbcode 2) takes off. */
const GSTR1_INVOICE_VALUE = `coalesce(sum(case when a.ag_book = 8 and a.ac_dbcode=2 and d.slab_link=0 then a.amount::numeric *-1 when a.ag_book = 8 and a.ac_dbcode=1 and d.slab_link=0 then a.amount::numeric when a.ag_book = 0 and d.slab_link=0 then a.amount::numeric end),0)`;
const GSTR1_ENTRY_TAXABLE = `coalesce(sum(case when a.ag_book = 8 and a.ac_dbcode=2 then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 when a.ag_book = 8 and a.ac_dbcode=1 then b.s_lastot::numeric-b.slab_amt::numeric when a.ag_book = 0 then b.s_lastot::numeric-b.slab_amt::numeric end),0)`;

/** The company's year as the two digits of its start and end year (RIGHT(@var_tarikh1,2)-RIGHT(@var_tarikh2,2)). */
const gstr1YearSuffix = (env: GstrEnv): string => `${String(env.plan.call.tarikh1.getFullYear()).slice(-2)}-${String(env.plan.call.tarikh2.getFullYear()).slice(-2)}`;

/** B2B of the stock lines (a product slab sale book). */
function gstr1B2bStock(env: GstrEnv, db: string, cgst: number, docno: boolean): string {
  const invoice = docno ? `btrim(k.doc_no)` : env.license === 73 ? `btrim(k.doc_no)||'/${gstr1YearSuffix(env)}'` : `a.full_docno`;
  const group = docno || env.license === 73 ? "k.doc_no" : "a.full_docno";
  return `select btrim(h.gst_no) as "GSTIN_UIN_of_Recipient",${GSTR_PARTY} as "Receiver_Name",${invoice} as "Invoice_Number",${gstrDate6("a.il_date")} as "Invoice_Date",`
    + `coalesce((select sum(amount::numeric) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0) as "Invoice_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",(select REV_CHARGE from ${db}ledger where led_key=a.led_id) as "Reverse_Charge",'Regular' as "Invoice_Type",'' as "E_Commerce_GSTIN",0 as "App_Tax_Rate",`
    + `${gstrRateOf(env)} as "Rate",coalesce(sum(b.s_lastot::numeric-b.slab_amt::numeric),0) as "Taxable_Value"`
    + gstr1StockFrom(db)
    + ` where a.IL_DATE between ${env.from} AND ${env.upto} and a.il_pos<>'D' and b.tax_id>0 and c.tax_perc::numeric>0 and b.slab_id=${cgst} and j.opt_Desc='REGISTER' and a.book in (8) and h.address_id=1${gstrCaEnt(env, "a", db)}`
    + ` and b.led_id is not null and b.il_id is not null group by h.gst_no,a.il_date,${group},i.opt_short,i.opt_desc,a.led_id,b.slab_perc,g.name order by a.il_date,${group}`;
}

/** B2B of the entries (a sale book without product slabs): the entry's own amounts. */
function gstr1B2bEntry(env: GstrEnv, db: string, cgst: number, docno: boolean, stockless: boolean): string {
  const invoice = docno ? `btrim(a.doc_no)` : stockless && env.license === 73 ? `btrim(a.doc_no)||'/${gstr1YearSuffix(env)}'` : `a.full_docno`;
  const from = stockless ? `${gstr1EntryFrom(db, false)} left join ${db}book_setup k on k.BOOK_CODE = a.BOOK_CODE` : gstr1EntryFrom(db, false);
  return `select btrim(h.gst_no) as "GSTIN_UIN_of_Recipient",${GSTR_PARTY} as "Receiver_Name",a.doc_no as "doc_no",${invoice} as "Invoice_Number",${gstrDate6("a.doc_date")} as "Invoice_Date",${GSTR1_INVOICE_VALUE} as "Invoice_Value",`
    + `${GSTR_PLACE} as "PLACE_OF_SUPPLY",a.rev_charge as "Reverse_Charge",'Regular' as "Invoice_Type",'' as "E_Commerce_GSTIN",0 as "App_Tax_Rate",${gstrRateOf(env)} as "Rate",${GSTR1_ENTRY_TAXABLE} as "Taxable_Value"`
    + from
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and b.slab_id=${cgst} and j.opt_Desc='REGISTER' and a.book in (8) and h.address_id=1${gstrCaEnt(env, "a", db)}`
    + ` and (b.led_id is not null)${stockless ? " and k.R_USESTOCK='N'" : ""} group by h.gst_no,a.doc_date,a.doc_no,${docno ? "" : "a.full_docno,"}i.opt_short,i.opt_desc,a.rev_charge,b.slab_perc,g.name order by a.doc_date,a.doc_no`;
}

/** The parties whose GSTIN does not match their state or is not 15 digits (TEMP_TABLE_INVALID_GST_). */
function gstr1Invalid(env: GstrEnv, db: string): string {
  return `select b.name as "name",btrim(c.GST_NO) as "GST_NO",d.opt_desc as "STATE_NAME",d.opt_short as "STATE_CODE",case when coalesce(c.GST_NO,'')='' then 'GSTIN has not been specified.' when length(btrim(c.GST_NO))<15 then 'GSTIN Less Then 15 Digit' when length(btrim(c.GST_NO))>15 then 'GSTIN Greater Then 15 Digit' when coalesce(c.GST_NO,'')<>'' and left(c.GST_NO,2)<> d.opt_short then 'State And GSTIN Mismatch' else '' end as "Reason_For_Mismatch"`
    + ` from ${db}ledger a, ${db}account b, ${db}Address c, ${db}idopt_master d, ${db}idopt_master e`
    + ` where a.code=b.code and b.code=c.code and c.state_id=d.idopt_key and a.doc_pos='A' and c.address_id=1 and (coalesce(c.GST_NO,'')='' or left(btrim(c.gst_no),2)<>btrim(d.opt_short) or (coalesce(c.GST_NO,'')<>'' and (length(btrim(c.GST_NO))<15 or length(btrim(c.GST_NO))>15)))`
    + ` and b.a_pos<>'D' and d.idopt_flag='ST' and e.opt_Desc='REGISTER' and a.DOC_DATE between ${env.from} AND ${env.upto} and a.book = 8 and e.idopt_key::text = c.p_reg::text${gstrCaEnt(env, "a", db)} order by b.name`;
}

/** The quantity of a stock line in the unit it was entered in, less the part billed against another (qtyAdded), or whole (qtyTaken). */
function gstr1Quantity(): { added: string; taken: string } {
  const uoms = [["qty1", "trn_qty1"], ["qty2", "trn_qty2"], ["qty3", "trn_qty3"], ["pack", "trn_pack"], ["weight", "trn_weight"]] as const;
  return {
    added: `(case when c.uomentry_id=k.pcs_uom then c.trn_pcs-c.ag_qty ${uoms.map(([uom, col]) => `when c.uomentry_id=k.${uom}_uom then c.${col}-round((c.AG_QTY/nullif(c.QUANTITY,0)*c.${col}),2)`).join(" ")} else c.QUANTITY-c.ag_qty end)`,
    taken: `(case when c.uomentry_id=k.pcs_uom then c.trn_pcs ${uoms.map(([uom, col]) => `when c.uomentry_id=k.${uom}_uom then c.${col}`).join(" ")} else c.QUANTITY end)`,
  };
}

/** HSN of the sale side: within-State (CGST lines), out-of-State (IGST lines) and total quantity, value, taxable value and the taxes of each HSN code, unit and rate. */
function gstr1Hsn(env: GstrEnv, db: string, salePw: boolean, typeKey: number, summary: boolean, factor: boolean): string {
  const aient = env.license === 17;
  const { added, taken } = gstr1Quantity();
  const hsn = aient ? `(case when aient.TXT_HSNCODE=' NONE' then btrim(k.hsn_code) else btrim(aient.TXT_HSNCODE) end)` : `btrim(k.hsn_code)`;
  const out = `c.STOCK_NAT='L' and c."TYPE" <> ${typeKey} and d.slab_link = 0`;
  const back = `c.STOCK_NAT='A' and c."TYPE" <> ${typeKey} and d.slab_link = 0`;
  const qty = (kind: string): string => {
    if (factor) {
      return `case when k.supply_type='G' then coalesce(sum(case when c.STOCK_NAT='L' and c."TYPE" <> ${typeKey} and d.slab_link = 0${kind} then c.factor else case when c.STOCK_NAT='A' and c.inventory='Y' and d.slab_link = 0${kind} then c.factor *-1 else 0 end end),0) else 0 end`;
    }
    return `case when k.supply_type='G' then coalesce(sum(case when ${kind === "" ? "true" : kind.replace(" and ", "")} then case when ${out} then ${added} else 0.00 end else 0.00 end),0)-coalesce(sum(case when ${kind === "" ? "true" : kind.replace(" and ", "")} then case when ${back} then ${taken} else 0.00 end else 0.00 end),0) else 0 end`;
  };
  const cgstLine = ` and f.opt_Desc='CGST'`;
  const igstLine = ` and f.opt_Desc='IGST'`;
  const share = `(c.il_value::numeric/nullif(a.prod_amt::numeric,0))`;
  const sale = (extra: string, amount: string): string => `coalesce(sum(case when c.stock_nat = 'L' and d.slab_link = 0${extra} then ${amount} else case when c.STOCK_NAT = 'A' and d.slab_link = 0${extra} then (${amount}) *-1 else 0.00 end end),0)`;
  const taxLine = (extra: string, amount: string, slabLink: boolean): string => `coalesce(sum(case when c.stock_nat = 'L'${slabLink ? " and d.slab_link = 0" : ""}${extra} then ${amount} else case when c.stock_nat = 'A'${extra} then (${amount}) *-1 else 0.00 end end),0)`;
  const stateTax = ` and (f.opt_Desc='SGST' or f.opt_Desc='UTGST')`;
  let values: string;
  if (salePw) {
    const taxable = "b.s_lastot::numeric-b.slab_amt::numeric";
    values = `${sale(cgstLine, "c.il_value::numeric")} as "Within_State_Value",${sale(igstLine, "c.il_value::numeric")} as "Out_State_Value",${sale("", "c.il_value::numeric")} as "Total_Value",`
      + `${sale(cgstLine, taxable)} as "Within_State_Taxable_Value",${sale(igstLine, taxable)} as "Out_State_Taxable_Value",${sale("", taxable)} as "Taxable_Value",`
      + `coalesce(case when f.opt_Desc in ('CGST','SGST','UTGST') then b.slab_perc * 2 else b.slab_perc end,0) as "Rate",`
      + `${taxLine(igstLine, "b.slab_amt::numeric", true)} as "Integrated_Tax_Amount",${taxLine(cgstLine, "b.slab_amt::numeric", true)} as "Cenral_Tax_Amount",${taxLine(stateTax, "b.slab_amt::numeric", false)} as "State_UT_Tax_Amount",0.00 as "Cess_Amount"`;
  } else {
    const whole = (extra: string) => `coalesce(sum(case when c.rate = 0 then 0 else case when c.stock_nat = 'L' and d.slab_link = 0${extra} then round(c.il_value::numeric,2) else case when c.STOCK_NAT = 'A' and d.slab_link = 0${extra} then round(c.il_value::numeric,2) *-1 else 0.00 end end end),0)`;
    const prorated = (extra: string, amount: string, slabLink: boolean) => `coalesce(sum(case when c.rate = 0 then 0 else case when c.stock_nat = 'L'${slabLink ? " and d.slab_link = 0" : ""}${extra} then round(${share} * (${amount}),2) else case when c.stock_nat = 'A'${slabLink ? " and d.slab_link = 0" : ""}${extra} then round(${share} * (${amount}),2) *-1 else 0.00 end end end),0)`;
    const taxable = "b.s_lastot::numeric-b.slab_amt::numeric";
    values = `${whole(cgstLine)} as "Within_State_Value",${whole(igstLine)} as "Out_State_Value",${whole("")} as "Total_Value",`
      + `${prorated(cgstLine, taxable, true)} as "Within_State_Taxable_Value",${prorated(igstLine, taxable, true)} as "Out_State_Taxable_Value",${prorated("", taxable, true)} as "Taxable_Value",`
      + `max(case when d.slab_link = 0 and f.opt_Desc='CGST' then b.slab_perc * 2 else b.slab_perc end) as "Rate",`
      + `${prorated(igstLine, "b.slab_amt::numeric", true)} as "Integrated_Tax_Amount",${prorated(cgstLine, "b.slab_amt::numeric", true)} as "Cenral_Tax_Amount",${prorated(stateTax, "b.slab_amt::numeric", false)} as "State_UT_Tax_Amount",0.00 as "Cess_Amount"`;
  }
  const totalAmount = `coalesce(sum(case when c.stock_nat = 'L' and d.slab_link = 0 then round(${share} * a.amount::numeric,2) else case when c.stock_nat = 'A' and d.slab_link = 0 then round(${share} * a.amount::numeric,2) *-1 else 0.00 end end),0) as "Total_Amount"`;
  const saleType = `case when coalesce(j.opt_desc,'')='REGISTER' then 'B2B' when coalesce(j.opt_desc,'')='UN-REGISTER' then 'URP' when coalesce(j.opt_desc,'')='CONSUMER' then 'CON' when coalesce(j.opt_desc,'')='COMPOSITION TAXABLE' then 'CONTAX' when coalesce(j.opt_desc,'')='UIN HOLDER' then 'UIN' else 'URP' end as "Sale_Type"`;
  const group = aient
    ? `aient.TXT_HSNCODE,k.supply_type,k.hsn_code,${summary ? "" : "k.prod_desc,"}l.uom_short,j.opt_desc`
    : salePw ? `k.supply_type,k.hsn_code,k.prod_desc,l.uom_short,j.opt_desc,coalesce(case when f.opt_Desc in ('CGST','SGST','UTGST') then b.slab_perc * 2 else b.slab_perc end,0)` : `k.supply_type,k.hsn_code,k.prod_desc,l.uom_short,j.opt_desc`;
  return `select ${hsn} as "HSN",${aient && summary ? `null as "Description"` : `k.prod_desc as "Description"`},l.uom_short as "UQC",${qty(cgstLine)} as "Within_State_Qty",${qty(igstLine)} as "Out_State_Qty",${qty("")} as "Total_Quantity",${values},${totalAmount},${saleType}`
    + ` from ${db}ledger a left join ${db}ledger_ext b on b.led_id = a.led_key left join ${db}prod_ledger c on ${salePw ? "c.il_key = b.il_id" : "c.led_id = a.led_key"} and c.il_pos='A'`
    + ` left join ${db}slab_master d on d.slab_key = b.slab_id left join ${db}tax_master e on e.tax_rec = b.tax_id left join ${db}idopt_master f on f.idopt_key::text = e.tax_type left join ${db}product_master k on k.prod_key = c.prod_id and k.prod_pos<>'D'`
    + ` left join ${db}prod_uom l on l.uom_key = ${factor ? "c.rateuom_id" : "c.uomentry_id"}${aient ? ` left join ${db}addon_ientry aient on aient.aoni_il_id = c.il_key` : ""}`
    + ` left join ${db}Address h on h.code = a.code and h.ADDRESS_ID = 1 left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0${aient ? "" : " and coalesce(k.hsn_code,'')<>''"}`
    + ` and a.book in (8,16,11) and a.amount::numeric > 0 and (a.ag_book=8 or coalesce(a.ag_book,0)=0) and b.led_id is not null and b.il_id is ${salePw ? "not " : ""}null group by ${group} order by k.hsn_code`;
}

/** The debit / credit notes of the sale book entered as the "OTHERS" type (no product): one row of HSN OTHER (or the entry's own HSN and product addon fields). */
function gstr1HsnOthers(env: GstrEnv, db: string, noteType: number, addonFields: boolean): string {
  const sums = (extra: string, amount: string) => `coalesce(sum(case when a.ag_book=8 and a.book=11 and d.slab_link = 0${extra} then ${amount} else case when a.ag_book=8 and a.book=16 and d.slab_link = 0${extra} then (${amount}) *-1 else 0.00 end end),0)`;
  const taxOf = (extra: string) => `coalesce(sum(case when a.ag_book=8 and a.book=11 and d.slab_link = 0${extra} then round(b.slab_amt::numeric,2) else case when a.ag_book=8 and a.book=16 and d.slab_link = 0${extra} then round(b.slab_amt::numeric,2) *-1 else 0.00 end end),0)`;
  const stateTax = `coalesce(sum(case when a.ag_book=8 and a.book=11 and (f.opt_Desc='SGST' or f.opt_Desc='UTGST') then round(b.slab_amt::numeric,2) else case when a.ag_book=8 and a.book=16 and (f.opt_Desc='SGST' or f.opt_Desc='UTGST') then round(b.slab_amt::numeric,2) *-1 else 0.00 end end),0)`;
  const taxable = `round(b.s_lastot::numeric-b.slab_amt::numeric,2)`;
  const head = addonFields ? `c.TXT_HSN as "HSN",c.TXT_PRODUCT as "Description",'PCS' as "UQC",0 as "Total_Quantity"` : `'OTHER' as "HSN",'OTHER' as "Description",'PCS' as "UQC",0 as "Total_Quantity"`;
  return `select ${head},${sums(" and f.opt_Desc='CGST'", "round(a.prod_amt::numeric,2)")} as "Within_State_Value",${sums(" and f.opt_Desc='IGST'", "round(a.prod_amt::numeric,2)")} as "Out_State_Value",${sums("", "round(a.prod_amt::numeric,2)")} as "Total_Value",`
    + `${sums(" and f.opt_Desc='CGST'", taxable)} as "Within_State_Taxable_Value",${sums(" and f.opt_Desc='IGST'", taxable)} as "Out_State_Taxable_Value",${sums("", taxable)} as "Taxable_Value",${gstrRateOf(env)} as "Rate",`
    + `${taxOf(" and f.opt_Desc='IGST'")} as "Integrated_Tax_Amount",${taxOf(" and f.opt_Desc='CGST'")} as "Cenral_Tax_Amount",${stateTax} as "State_UT_Tax_Amount",0.00 as "Cess_Amount",`
    + `${sums("", "round(a.amount::numeric,2)")} as "Total_Amount",case when coalesce(j.opt_desc,'')='REGISTER' then 'B2B' when coalesce(j.opt_desc,'')='UN-REGISTER' then 'URP' when coalesce(j.opt_desc,'')='CONSUMER' then 'CON' when coalesce(j.opt_desc,'')='COMPOSITION TAXABLE' then 'CONTAX' when coalesce(j.opt_desc,'')='UIN HOLDER' then 'UIN' else 'NONE' end as "Sale_Type"`
    + ` from ${db}ledger a left join ${db}ledger_ext b on b.led_id = a.led_key left join ${db}slab_master d on d.slab_key = b.slab_id left join ${db}tax_master e on e.tax_rec = b.tax_id left join ${db}idopt_master f on f.idopt_key::text = e.tax_type`
    + `${addonFields ? ` left join ${db}addon_aentry c on c.aona_ledid = a.led_key` : ""} left join ${db}Account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto} and a.doc_pos<>'D' and b.tax_id>0 and a.book in (16,11) and a.ag_book=8 and h.ADDRESS_ID = 1${gstrCaEnt(env, "a", db)} and b.led_id is not null and b.il_id is null and a."TYPE"=${noteType}`
    + `${addonFields ? " and coalesce(c.TXT_HSN,'') <> '' group by c.TXT_HSN,c.TXT_PRODUCT,b.slab_perc,i.opt_short,j.opt_desc" : " group by b.slab_perc,i.opt_short,j.opt_desc"}`;
}

/** B2C large: the sale entries of consumers and unregistered persons of other States. */
function gstr1B2cLarge(env: GstrEnv, db: string, cgst: number, salePw: boolean): string {
  const state = gstrStateLiteral(env);
  if (salePw) {
    return `select a.full_docno as "Invoice_Number",${gstrDate6("a.il_date")} as "Invoice_Date",coalesce((select sum(amount::numeric) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0) as "Invoice_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",0 as "App_Tax_Rate",${gstrRateOf(env)} as "Rate",`
      + `coalesce(sum(b.s_lastot::numeric-b.slab_amt::numeric),0) as "Taxable_Value",'' as "E_Commerce_GSTIN",${GSTR_PARTY} as "Party_Name"`
      + ` from ${db}prod_ledger a left join ${db}ledger_ext b on a.il_key = b.il_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master c on c.tax_rec = b.tax_id left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code`
      + ` left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`
      + ` where a.IL_DATE between ${env.from} AND ${env.upto} and a.il_pos<>'D' and b.tax_id>0 and c.tax_perc::numeric>0 and b.slab_id=${cgst} and (j.opt_Desc='CONSUMER' or j.opt_Desc='UN-REGISTER') and i.opt_short<>${state} and a.book in (8) and h.address_id=1`
      + ` and b.led_id is not null and b.il_id is not null${gstrCaEnt(env, "a", db)} group by a.il_date,a.full_docno,i.opt_short,i.opt_desc,a.led_id,b.slab_perc,g.name order by a.il_date,a.full_docno`;
  }
  return `select a.doc_no as "doc_no",a.full_docno as "Invoice_Number",${gstrDate6("a.doc_date")} as "Invoice_Date",${GSTR1_INVOICE_VALUE} as "Invoice_Value",${GSTR_PLACE} as "PLACE_OF_SUPPLY",0 as "App_Tax_Rate",${gstrRateOf(env)} as "Rate",`
    + `coalesce(sum(case when a.ag_book = 8 and a.ac_dbcode=2 then b.slab_amt::numeric *-1 when a.ag_book = 8 and a.ac_dbcode=1 then b.s_lastot::numeric-b.slab_amt::numeric when a.ag_book = 0 then b.s_lastot::numeric-b.slab_amt::numeric end),0) as "Taxable_Value",'' as "E_Commerce_GSTIN",${GSTR_PARTY} as "Party_Name"`
    + gstr1EntryFrom(db, false)
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and a.amount::numeric>=250000 and b.slab_id=${cgst}`
    + ` and (j.opt_Desc='CONSUMER' or j.opt_Desc='UN-REGISTER') and i.opt_short<>${state} and a.book in (8) and h.address_id=1 and (b.led_id is not null)`
    + ` group by a.doc_date,a.doc_no,a.full_docno,i.opt_short,i.opt_desc,b.slab_perc,g.name order by a.doc_date,a.doc_no`;
}

/** B2C small: the taxable value by place and rate of the sales to parties that are not registered (or composition). */
function gstr1B2cSmall(env: GstrEnv, db: string, cgst: number, salePw: boolean): string {
  const taxable = salePw
    ? `coalesce(sum(case when c.stock_nat = 'A' then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end),0)`
    : `coalesce(sum(case when a.ag_book = 8 and a.ac_dbcode=2 then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 when a.ag_book = 8 and a.ac_dbcode=1 then b.s_lastot::numeric-b.slab_amt::numeric when a.ag_book = 0 then b.s_lastot::numeric-b.slab_amt::numeric end),0)`;
  return `select (case when h.BUS_TYPE='Y' then 'E' else 'OE' end) as "Invoice_Type",${GSTR_PLACE} as "PLACE_OF_SUPPLY",0 as "App_Tax_Rate",(${gstrRateOf(env)}) as "Rate",${taxable} as "Taxable_Value",(case when h.BUS_TYPE='Y' then h.gst_no else '' end) as "E_Commerce_GSTIN"`
    + gstr1EntryFrom(db, salePw)
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and b.slab_id=${cgst}${salePw ? " and c.il_pos='A'" : ""}`
    + ` and j.opt_Desc<>'REGISTER' and j.opt_Desc<>'COMPOSITION TAXABLE' and a.book in (8) and h.address_id=1 and a.AMOUNT::numeric > 0 and b.SLAB_AMT::numeric > 0 and (b.led_id is not null${salePw ? " or b.il_id is not null" : ""})`
    + ` group by i.opt_short,i.opt_desc,b.slab_perc,h.BUS_TYPE,h.gst_no order by i.opt_short,i.opt_desc,b.slab_perc`;
}

/** The credit / debit notes of the sale book (against the bills, CTE_TEMP and the bills' own, CTE_TEMP1), registered or not. */
function gstr1NoteQueries(env: GstrEnv, db: string, salePw: boolean, cgst: number, registered: boolean, noteType: number | null): { notes: string; bills: string } {
  const partyCondition = registered ? `j.opt_Desc='REGISTER'` : `j.opt_Desc<>'REGISTER'`;
  const type = `(case when a.book=11 then 'D' else 'C' end)`;
  const people = ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`;
  const slabs = ` left join ${db}ledger_ext b on a.led_key = b.led_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`;
  const outclear = (key: string) => ` left join ${db}outclear k on k.out_ledid = ${key}`;
  const ur = registered ? "" : `'B2CL' as "UR_Type",`;
  const receiver = registered ? `btrim(h.gst_no) as "GSTIN_UIN_of_Recipient",left(btrim(h.gst_no),2) as "State_Code",(case when strpos(g.name,'[') > 0 then left(g.name,strpos(g.name,'[')-1) else g.name end) as "Receiver_Name",` : "";
  const rate = gstrRateOf(env);
  const typeCondition = noteType === null ? "" : ` and a."TYPE"=${noteType}`;
  let notes: string;
  if (salePw && noteType === null) {
    notes = `select ${ur}${receiver}a.full_docno as "invoice_Advance_Receipt_Number",${gstrDate6("a.il_date")} as "invoice_Advance_Receipt_DATE",'' as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.il_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
      + `coalesce((select sum(amount::numeric) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0) as "Note_Refund_Voucher_Value",0 as "App_Tax_Rate",${rate} as "Rate",`
      + `coalesce(sum(${registered ? "case when l.book in (11) and l.ag_book in (8) then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end" : "b.s_lastot::numeric-b.slab_amt::numeric"}),0) as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",k.OUT_AG_OUTID as "OUT_AG_OUTID"`
      + ` from ${db}prod_ledger a left join ${db}ledger_ext b on a.il_key = b.il_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
      + `${people}${outclear("a.led_id")} left join ${db}ledger l on l.led_key = a.led_id left join ${db}addon_aentry m on m.aona_ledid = a.led_id`
      + ` where a.il_DATE between ${env.from} AND ${env.upto} and a.il_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0${registered ? " and coalesce(k.out_ag_outid,0)>0" : ""} and b.slab_id=${cgst}`
      + ` and ${partyCondition} and (a.book in (16) or (l.book in (11) and l.ag_book in (8))) and h.address_id=1${gstrCaEnt(env, "l", db)} and b.led_id is not null and b.il_id is not null`
      + ` group by ${registered ? "h.gst_no,g.name," : ""}a.il_date,a.full_docno,i.opt_short,i.opt_desc,k.out_ag_outid,a.book,b.slab_perc,k.out_ag_outid,a.led_id`;
  } else {
    notes = `select ${ur}${receiver}a.full_docno as "invoice_Advance_Receipt_Number",${gstrDate6("a.doc_date")} as "invoice_Advance_Receipt_DATE",a.doc_no as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.doc_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
      + `coalesce(sum(case when d.slab_link=0 then a.amount::numeric else 0 end),0) as "Note_Refund_Voucher_Value",0 as "App_Tax_Rate",${rate} as "Rate",`
      + `coalesce(sum(case when a.book in (11) and a.ag_book in (8) then (b.s_lastot::numeric-b.slab_amt::numeric) *-1 else b.s_lastot::numeric-b.slab_amt::numeric end),0) as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",k.OUT_AG_OUTID as "OUT_AG_OUTID"`
      + ` from ${db}ledger a${slabs}${people}${outclear("a.led_key")} left join ${db}addon_aentry l on l.aona_ledid = a.led_key`
      + ` where a.DOC_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and b.slab_id=${cgst}`
      + ` and ${partyCondition} and a.book in (16,11) and a.ag_book in (8) and h.address_id=1${typeCondition} and (b.led_id is not null)`
      + ` group by ${registered ? "h.gst_no,g.name," : ""}a.doc_date,a.doc_no,a.full_docno,i.opt_short,i.opt_desc,a.book,b.slab_perc,k.out_ag_outid`;
  }
  const billPlace = !registered && !salePw ? `i.opt_short||' - '||i.opt_desc` : GSTR_PLACE;
  const bookList = registered ? "8,11,16,19" : "8";
  const bills = `select ${ur}${receiver}a.full_docno as "invoice_Advance_Receipt_Number",${gstrDate6("a.doc_date")} as "invoice_Advance_Receipt_DATE",a.doc_no as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.doc_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${billPlace} as "PLACE_OF_SUPPLY",`
    + `coalesce(sum(a.amount::numeric),0) as "Note_Refund_Voucher_Value",0.00 as "App_Tax_Rate",0.00 as "Rate",0.00 as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",k.OUT_KEY as "OUT_KEY"`
    + ` from ${db}ledger a${people}${outclear("a.led_key")}`
    + ` where a.doc_pos<>'D'${gstrCaEnt(env, "a", db)} and ${partyCondition} and a.book in (${bookList}) and h.address_id=1`
    + ` group by ${registered || salePw ? "h.gst_no," : ""}${registered ? "g.name," : ""}a.doc_date,a.doc_no,a.full_docno,i.opt_short,i.opt_desc,a.book,k.out_key`;
  return { notes, bills };
}

/** The credit / debit notes of the registered persons that are not set off against a bill (the second insert), not already in the table. */
function gstr1NotesOpen(env: GstrEnv, db: string, salePw: boolean, cgst: number): string {
  const type = `(case when a.book=11 then 'D' else 'C' end)`;
  const people = ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`;
  const receiver = `btrim(h.gst_no) as "GSTIN_UIN_of_Recipient",left(btrim(h.gst_no),2) as "State_Code",(case when strpos(g.name,'[') > 0 then left(g.name,strpos(g.name,'[')-1) else g.name end) as "Receiver_Name"`;
  if (salePw) {
    return `select ${receiver},'' as "invoice_Advance_Receipt_Number",null as "invoice_Advance_Receipt_DATE",'' as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.il_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
      + `coalesce((select sum(amount::numeric) from ${db}ledger where led_key=a.led_id and amount::numeric>0),0) as "Note_Refund_Voucher_Value",0.00 as "App_Tax_Rate",${gstrRateOf(env)} as "Rate",coalesce(sum(b.s_lastot::numeric-b.slab_amt::numeric),0) as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",l.full_docno as "SKIP_KEY"`
      + ` from ${db}prod_ledger a left join ${db}ledger_ext b on a.il_key = b.il_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
      + `${people} left join ${db}outclear k on k.out_ledid = a.led_id left join ${db}ledger l on l.led_key = a.led_id left join ${db}addon_aentry m on m.aona_ledid = a.led_id`
      + ` where a.il_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "l", db)} and a.il_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and coalesce(k.out_ag_outid,0)=0 and b.slab_id=${cgst}`
      + ` and j.opt_Desc='REGISTER' and (a.book in (16) or (l.book in (11) and l.ag_book in (8))) and h.address_id=1 and b.led_id is not null and b.il_id is not null`
      + ` group by h.gst_no,g.name,a.il_date,a.full_docno,i.opt_short,i.opt_desc,a.book,b.slab_perc,a.led_id,l.full_docno`;
  }
  return `select ${receiver},'' as "invoice_Advance_Receipt_Number",null as "invoice_Advance_Receipt_DATE",a.doc_no as "doc_no",a.full_docno as "Note_Refund_Voucher_Number",${gstrDate6("a.doc_date")} as "Note_Refund_Voucher_Date",${type} as "Document_Type",${GSTR_PLACE} as "PLACE_OF_SUPPLY",`
    + `coalesce(sum(case when d.slab_link=0 then a.amount::numeric else 0 end),0) as "Note_Refund_Voucher_Value",0.00 as "App_Tax_Rate",${gstrRateOf(env)} as "Rate",coalesce(sum(b.s_lastot::numeric-b.slab_amt::numeric),0) as "Taxable_Value",0.00 as "Cess_Amount",'N' as "Pre_GST",a.full_docno as "SKIP_KEY"`
    + ` from ${db}ledger a left join ${db}ledger_ext b on a.led_key = b.led_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
    + `${people} left join ${db}outclear k on k.out_ledid = a.led_key left join ${db}addon_aentry l on l.aona_ledid = a.led_key`
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc::numeric>0 and coalesce(k.out_ag_outid,0)=0 and b.slab_id=${cgst}`
    + ` and j.opt_Desc='REGISTER' and a.book in (16,11) and a.ag_book in (8) and h.address_id=1 and (b.led_id is not null)`
    + ` group by h.gst_no,g.name,a.doc_date,a.doc_no,a.full_docno,i.opt_short,i.opt_desc,a.book,b.slab_perc`;
}

/** Exempted / nil rated supplies (no tax) of the sale book by the party's registration and State. */
function gstr1Exempt(env: GstrEnv, db: string, salePw: boolean, cgst: number, inter: boolean, registered: boolean): string {
  return `select sum(case when k.tax_type='N' then c.il_value::numeric else 0 end) as "Nill_Rated_Supplies",sum(case when k.tax_type='E' then c.il_value::numeric else 0 end) as "Exempted",0.00 as "Non_GST"`
    + ` from ${db}ledger a left join ${db}prod_ledger c on a.led_key = c.led_id left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code`
    + ` left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text left join ${db}product_master k on k.prod_key = c.prod_id`
    + ` left join ${db}ledger_ext l on ${salePw ? "l.il_id = c.il_key" : "l.led_id = a.led_key"}`
    + ` where a.DOC_DATE between ${env.from} AND ${env.upto}${gstrCaEnt(env, "a", db)} and a.doc_pos<>'D' and btrim(i.opt_short)${inter ? "<>" : "="}${gstrStateLiteral(env)} and (k.tax_type='N' or k.tax_type='E')`
    + ` and c.il_pos='A' and j.opt_Desc${registered ? "=" : "<>"}'REGISTER' and a.book in (8) and h.ADDRESS_ID = 1 and l.slab_id=${cgst} and l.tax_id>0 and c.quantity<>0 and c.il_value::numeric<>0 and l.SLAB_PERC=0`;
}

export async function gstr1(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const env = await gstrEnvironment(loader, plan);
  const choice = plan.call.fcValue;
  const docno = env.flag("CHK_DOCNO");
  const summary = env.flag("CHK_SUMMARY");
  const factor = env.flag("CHK_FACTCOL");
  const query = (sql: string) => gstrQuery(env, sql);
  let salePw = false;
  let lastDb = env.currentDb;
  const invalid: GstrRow[] = [];

  // The first company decides the table (the procedure builds it on its first pass).
  const firstPw = await gstrProductWise(env, env.dbs[0], 8);
  const names = (list: readonly string[], numbers: readonly string[]): GstrColumn[] => list.map((name) => (numbers.includes(name) ? ([name, "decimal"] as const) : name));
  const b2bColumns = firstPw
    ? ["GSTIN_UIN_of_Recipient", "Receiver_Name", "Invoice_Number", "Invoice_Date", "Invoice_Value", "PLACE_OF_SUPPLY", "Reverse_Charge", "App_Tax_Rate", "Invoice_Type", "E_Commerce_GSTIN", "Rate", "Taxable_Value"]
    : ["GSTIN_UIN_of_Recipient", "Receiver_Name", "doc_no", "Invoice_Number", "Invoice_Date", "Invoice_Value", "PLACE_OF_SUPPLY", "Reverse_Charge", "App_Tax_Rate", "Invoice_Type", "E_Commerce_GSTIN", "Rate", "Taxable_Value"];
  const hsnColumns = ["HSN", "Description", "UQC", "Within_State_Qty", "Out_State_Qty", "Total_Quantity", "Within_State_Value", "Out_State_Value", "Total_Value", "Within_State_Taxable_Value", "Out_State_Taxable_Value", "Taxable_Value", "Rate", "Integrated_Tax_Amount", "Cenral_Tax_Amount", "State_UT_Tax_Amount", "Cess_Amount", "Total_Amount", "Sale_type"];
  const noteColumns = ["GSTIN_UIN_of_Recipient", "State_Code", "Receiver_Name", "invoice_Advance_Receipt_Number", "invoice_Advance_Receipt_DATE", "doc_no", "Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date", "Document_Type", "PLACE_OF_SUPPLY", "Note_Refund_Voucher_Value", "App_Tax_Rate", "Rate", "Taxable_Value", "Cess_Amount", "Pre_GST", "OUT_KEY"];
  const urColumns = ["UR_Type", "Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date", "Document_Type", "invoice_Advance_Receipt_Number", "invoice_Advance_Receipt_DATE", "doc_no", "PLACE_OF_SUPPLY", "Note_Refund_Voucher_Value", "App_Tax_Rate", "Rate", "Taxable_Value", "Cess_Amount", "Pre_GST"];
  let table: ResultTable;
  switch (choice) {
    case 1: table = gstrTable(names(b2bColumns, ["Invoice_Value", "App_Tax_Rate", "Rate", "Taxable_Value"])); break;
    case 2: table = gstrTable(names(hsnColumns, hsnColumns.filter((name) => !["HSN", "Description", "UQC", "Sale_type"].includes(name)))); break;
    case 3: table = gstrTable(names(firstPw ? ["Invoice_Number", "Invoice_Date", "Invoice_Value", "PLACE_OF_SUPPLY", "App_Tax_Rate", "Rate", "Taxable_Value", "E_Commerce_GSTIN", "Party_Name"] : ["doc_no", "Invoice_Number", "Invoice_Date", "Invoice_Value", "PLACE_OF_SUPPLY", "App_Tax_Rate", "Rate", "Taxable_Value", "E_Commerce_GSTIN", "Party_Name"], ["Invoice_Value", "App_Tax_Rate", "Rate", "Taxable_Value"])); break;
    case 4: table = gstrTable(names(["Invoice_Type", "PLACE_OF_SUPPLY", "App_Tax_Rate", "Rate", "Taxable_Value", "E_Commerce_GSTIN"], ["App_Tax_Rate", "Rate", "Taxable_Value"])); break;
    case 5: table = gstrTable(names(noteColumns, ["Note_Refund_Voucher_Value", "App_Tax_Rate", "Rate", "Taxable_Value", "Cess_Amount", "OUT_KEY"])); break;
    case 6: table = gstrTable(names(urColumns, ["Note_Refund_Voucher_Value", "App_Tax_Rate", "Rate", "Taxable_Value", "Cess_Amount"])); break;
    case 7: table = gstrTable(names(["Description", "Nill_Rated_Supplies", "Exempted", "Non_GST"], ["Nill_Rated_Supplies", "Exempted", "Non_GST"])); break;
    default: throw new ReportRefusal("Internal program failure\nQuery Was Blank", "INTERNAL PROGRAM FAILURE");
  }

  for (const db of env.dbs) {
    lastDb = db;
    salePw = await gstrProductWise(env, db, 8);
    const cgst = await gstrSlab(env, db, 8, "=0");
    const typeKey = num((await query(`SELECT BOOK_KEY AS k FROM ${db}BOOK_PROPERTIES WHERE STKM_POS = 'A' AND STKM_ID = 'NR' ORDER BY STKMODULE DESC LIMIT 1`))[0]?.k) || 25;
    const noteType = num((await query(`SELECT BOOK_KEY AS k FROM ${db}BOOK_PROPERTIES where BOOK_DESC='OTHERS' and STKM_POS<>'D' ORDER BY BOOK_KEY DESC LIMIT 1`))[0]?.k);

    if (choice === 1) {
      pushAll(invalid, await query(gstr1Invalid(env, db)));
      for (const row of await query(salePw ? gstr1B2bStock(env, db, cgst, docno) : gstr1B2bEntry(env, db, cgst, docno, false))) gstrInsert(table, row);
      if (salePw) {
        // The entries of the books that keep no stock (R_USESTOCK 'N') are added to the stock lines'.
        for (const row of await query(gstr1B2bEntry(env, db, cgst, docno, true))) { const { doc_no: _docNo, ...rest } = row; void _docNo; gstrInsert(table, rest); }
      }
    } else if (choice === 2) {
      for (const row of await query(gstr1Hsn(env, db, salePw, typeKey, summary, factor))) gstrInsert(table, { ...row, Sale_type: row.Sale_Type });
      if (noteType > 0) {
        const fields = await query(`SELECT upper(column_name) AS name FROM information_schema.columns WHERE table_schema = '${db.replace(".", "")}' and upper(column_name) in ('TXT_PRODUCT','TXT_HSN')`);
        const addonFields = fields.some((field) => field.name === "TXT_PRODUCT") && fields.some((field) => field.name === "TXT_HSN");
        for (const row of await query(gstr1HsnOthers(env, db, noteType, addonFields))) gstrInsert(table, { ...row, Sale_type: row.Sale_Type });
      }
    } else if (choice === 3) {
      for (const row of await query(gstr1B2cLarge(env, db, cgst, salePw))) gstrInsert(table, row);
    } else if (choice === 4) {
      for (const row of await query(gstr1B2cSmall(env, db, cgst, salePw))) gstrInsert(table, row);
    } else if (choice === 5 || choice === 6) {
      const registered = choice === 5;
      const batches: { notes: string; bills: string }[] = [gstr1NoteQueries(env, db, salePw, cgst, registered, null)];
      if (registered && salePw && noteType > 0) batches.push(gstr1NoteQueries(env, db, false, cgst, registered, noteType));
      for (const { notes, bills } of batches) {
        const noteRows = await query(notes);
        const billRows = await query(bills);
        const byKey = new Map<unknown, GstrRow>();
        for (const bill of billRows) if (!byKey.has(bill.OUT_KEY)) byKey.set(bill.OUT_KEY, bill);
        const joined = noteRows.map((note) => ({ note, bill: byKey.get(note.OUT_AG_OUTID) }));
        joined.sort((a, b) => String(gstrDateKey(a.note.Note_Refund_Voucher_Date) ?? "").localeCompare(String(gstrDateKey(b.note.Note_Refund_Voucher_Date) ?? "")) || String(a.note.Note_Refund_Voucher_Number).localeCompare(String(b.note.Note_Refund_Voucher_Number)));
        for (const { note, bill } of joined) {
          if (registered) {
            gstrInsert(table, {
              GSTIN_UIN_of_Recipient: note.GSTIN_UIN_of_Recipient, State_Code: note.State_Code, Receiver_Name: note.Receiver_Name, invoice_Advance_Receipt_Number: bill?.invoice_Advance_Receipt_Number ?? null, invoice_Advance_Receipt_DATE: bill?.invoice_Advance_Receipt_DATE ?? null,
              doc_no: note.doc_no, Note_Refund_Voucher_Number: note.Note_Refund_Voucher_Number, Note_Refund_Voucher_Date: gstrDate103(note.Note_Refund_Voucher_Date), Document_Type: note.Document_Type, PLACE_OF_SUPPLY: note.PLACE_OF_SUPPLY,
              Note_Refund_Voucher_Value: num(note.Note_Refund_Voucher_Value), App_Tax_Rate: 0, Rate: note.Rate, Taxable_Value: num(note.Taxable_Value), Cess_Amount: note.Cess_Amount, Pre_GST: note.Pre_GST, OUT_KEY: bill?.OUT_KEY ?? null,
            });
          } else {
            gstrInsert(table, {
              UR_Type: note.UR_Type, Note_Refund_Voucher_Number: note.Note_Refund_Voucher_Number, Note_Refund_Voucher_Date: gstrDate103(note.Note_Refund_Voucher_Date), Document_Type: note.Document_Type,
              invoice_Advance_Receipt_Number: bill?.invoice_Advance_Receipt_Number ?? null, invoice_Advance_Receipt_DATE: gstrDate103(bill?.invoice_Advance_Receipt_DATE), doc_no: note.doc_no, PLACE_OF_SUPPLY: note.PLACE_OF_SUPPLY,
              Note_Refund_Voucher_Value: num(note.Note_Refund_Voucher_Value), App_Tax_Rate: 0, Rate: note.Rate, Taxable_Value: num(note.Taxable_Value), Cess_Amount: note.Cess_Amount, Pre_GST: note.Pre_GST,
            });
          }
        }
      }
      if (registered) {
        const existing = new Set(table.rows.map((row) => table.get(row, "Note_Refund_Voucher_Number")));
        const hasNull = [...existing].some((value) => value === null || value === undefined);
        for (const row of await query(gstr1NotesOpen(env, db, salePw, cgst))) {
          if (hasNull || row.SKIP_KEY === null || existing.has(row.SKIP_KEY)) continue;
          const { SKIP_KEY: _skip, ...rest } = row;
          void _skip;
          gstrInsert(table, rest);
        }
      }
    } else {
      const registeredFlags = [true, true, false, false];
      const interFlags = [true, false, true, false];
      const labels = ["Inter-State supplies to registered persons", "Intra-State supplies to registered persons", "Inter-State supplies to unregistered persons", "Intra-State supplies to unregistered persons"];
      for (let at = 0; at < 4; at += 1) {
        const row = (await query(gstr1Exempt(env, db, salePw, cgst, interFlags[at], registeredFlags[at])))[0];
        gstrInsert(table, { Description: labels[at], Nill_Rated_Supplies: row?.Nill_Rated_Supplies ?? null, Exempted: row?.Exempted ?? null, Non_GST: row?.Non_GST ?? null });
      }
    }
  }

  // What the procedure does once every company is read.
  const invoiceNumbers = (column: string) => gstrDistinct(table, column);
  const copyDncn = async (nameColumn: string, withPosition: boolean) => {
    // Update ... set invoice_Advance_Receipt_Number / DATE from the voucher's addon fields INPUT_DNCN_BILL / INPUT_DNCN_DATE where they are blank.
    const schema = lastDb.replace(".", "");
    const columns = await query(`SELECT upper(column_name) AS name, data_type FROM information_schema.columns WHERE table_schema = '${schema}' and table_name = 'addon_aentry' and upper(column_name) in ('INPUT_DNCN_BILL','INPUT_DNCN_DATE')`);
    const bill = columns.find((column) => column.name === "INPUT_DNCN_BILL");
    const when = columns.find((column) => column.name === "INPUT_DNCN_DATE");
    if (!bill || !when) return;
    const rows = await query(`SELECT led.full_docno AS number, aent.input_dncn_bill AS bill, ${/date|time/.test(String(when.data_type)) ? gstrDate6("aent.input_dncn_date") : "aent.input_dncn_date::text"} AS billdate FROM ${lastDb}LEDGER led left join ${lastDb}ADDON_AENTRY aent on aent.aona_ledid=led.led_key${withPosition ? " where led.doc_pos<>'D'" : ""}`);
    const byNumber = new Map<unknown, GstrRow>();
    for (const row of rows) if (!byNumber.has(row.number)) byNumber.set(row.number, row);
    for (const row of table.rows) {
      if (toText(table.get(row, "invoice_Advance_Receipt_Number")) !== "") continue;
      const source = byNumber.get(table.get(row, nameColumn));
      if (!source) continue;
      table.set(row, "invoice_Advance_Receipt_Number", source.bill ?? null);
      table.set(row, "invoice_Advance_Receipt_DATE", source.billdate ?? null);
    }
  };
  if (choice === 1) {
    if (salePw) {
      gstrFirstOfPartition(table, ["Invoice_Number", "Invoice_Date"], ["Invoice_Value"]);
    } else {
      table.rows = table.rows.filter((row) => num(table.get(row, "Invoice_Value")) !== 0);
    }
    const seen = new Set<string>();
    for (const row of invalid) {
      const key = JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      gstrInsert(table, {
        GSTIN_UIN_of_Recipient: toText(row.GST_NO), Invoice_Number: "ERROR", Invoice_Date: null, Invoice_Value: 0, PLACE_OF_SUPPLY: `${toText(row.STATE_CODE).trim()}-${toText(row.STATE_NAME).trim()}`, Reverse_Charge: "", Invoice_Type: "",
        E_Commerce_GSTIN: toText(row.Reason_For_Mismatch), App_Tax_Rate: 0, Rate: 0, Taxable_Value: 0, Receiver_Name: toText(row.name),
      });
    }
    const gstins = invoiceNumbers("GSTIN_UIN_of_Recipient");
    const invoices = invoiceNumbers("Invoice_Number");
    gstrDropColumn(table, "doc_no");
    gstrInsert(table, { GSTIN_UIN_of_Recipient: String(gstins), Invoice_Number: String(invoices), Invoice_Date: null, Invoice_Value: 0, PLACE_OF_SUPPLY: "", Reverse_Charge: "", Invoice_Type: "", E_Commerce_GSTIN: "", App_Tax_Rate: 0, Rate: 0, Taxable_Value: 0, Receiver_Name: "" });
    // ORDER BY the date, then the invoice number right-aligned in 10 (with the document number) or 20 characters.
    const width = docno ? 10 : 20;
    const padded = (row: ResultRow) => toText(table.get(row, "Invoice_Number")).padStart(width).slice(-width).toLowerCase();
    const indexed = table.rows.map((row, index) => ({ row, index, key: gstrDateKey(table.get(row, "Invoice_Date")), text: padded(row) }));
    indexed.sort((a, b) => (a.key === b.key ? (a.text === b.text ? a.index - b.index : a.text < b.text ? -1 : 1) : a.key === null ? -1 : b.key === null ? 1 : a.key < b.key ? -1 : 1));
    table.rows = indexed.map((entry) => entry.row);
  } else if (choice === 2) {
    // The sums by HSN, unit, rate and kind of sale (TEMP_TABLE_GSTR_SUM_), the count of the HSN codes first, then ORDER BY Sale_Type, HSN.
    const groups = new Map<string, GstrRow>();
    const sumColumns = ["Within_State_Qty", "Out_State_Qty", "Total_Quantity", "Within_State_Value", "Out_State_Value", "Total_Value", "Within_State_Taxable_Value", "Out_State_Taxable_Value", "Taxable_Value", "Integrated_Tax_Amount", "Cenral_Tax_Amount", "State_UT_Tax_Amount", "Cess_Amount", "Total_Amount"];
    for (const row of table.rows) {
      const key = ["HSN", ...(summary ? [] : ["Description"]), "UQC", "Rate", "Sale_type"].map((column) => String(table.get(row, column) ?? "")).join("|");
      const sum = groups.get(key);
      if (sum) for (const column of sumColumns) { const name = table.name(column) as string; sum[name] = gstrRound(num(sum[name]) + num(row[name])); }
      else groups.set(key, { ...row });
    }
    const grouped = [...groups.values()];
    const hsns = new Set(grouped.map((row) => toText(table.get(row, "HSN"))).filter((value) => value !== "")).size;
    const total: GstrRow = Object.fromEntries(table.columns.map((column) => [column, null]));
    total[table.name("HSN") as string] = ` ${hsns}`;
    for (const column of ["Total_Quantity", "Total_Value", "Taxable_Value", "Integrated_Tax_Amount", "Cenral_Tax_Amount", "State_UT_Tax_Amount", "Cess_Amount"]) total[table.name(column) as string] = 0;
    total[table.name("Sale_type") as string] = "";
    if (!summary) { total[table.name("Description") as string] = ""; total[table.name("UQC") as string] = ""; }
    grouped.push(total);
    grouped.sort((a, b) => toText(table.get(a, "Sale_type")).toLowerCase().localeCompare(toText(table.get(b, "Sale_type")).toLowerCase()) || toText(table.get(a, "HSN")).toLowerCase().localeCompare(toText(table.get(b, "HSN")).toLowerCase()));
    table.rows = grouped;
    if (summary) gstrDropColumn(table, "Description");
  } else if (choice === 3) {
    if (salePw) {
      table.rows = table.rows.filter((row) => num(table.get(row, "Invoice_Value")) !== 0 && num(table.get(row, "Invoice_Value")) >= 250000);
      gstrFirstOfPartition(table, ["Invoice_Number", "Invoice_Date"], ["Invoice_Value"]);
    } else gstrDropColumn(table, "doc_no");
    const invoices = invoiceNumbers("Invoice_Number");
    gstrInsert(table, { Invoice_Number: String(invoices), Invoice_Date: null, Invoice_Value: 0, PLACE_OF_SUPPLY: "", App_Tax_Rate: 0, Rate: 0, Taxable_Value: 0, E_Commerce_GSTIN: "", Party_Name: "" });
  } else if (choice === 4) {
    const groups = new Map<string, GstrRow>();
    for (const row of table.rows) {
      const key = ["Invoice_Type", "PLACE_OF_SUPPLY", "Rate", "E_Commerce_GSTIN"].map((column) => String(table.get(row, column) ?? "")).join("|");
      const sum = groups.get(key);
      if (sum) sum[table.name("Taxable_Value") as string] = gstrRound(num(sum[table.name("Taxable_Value") as string]) + num(table.get(row, "Taxable_Value")));
      else groups.set(key, { ...row, [table.name("App_Tax_Rate") as string]: 0 });
    }
    table.rows = [...groups.values()].sort((a, b) => toText(table.get(a, "PLACE_OF_SUPPLY")).localeCompare(toText(table.get(b, "PLACE_OF_SUPPLY"))) || num(table.get(a, "Rate")) - num(table.get(b, "Rate")));
  } else if (choice === 5) {
    gstrFirstOfPartition(table, salePw ? ["Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date", "Rate", "Taxable_Value"] : ["Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date", "Rate"], ["Note_Refund_Voucher_Value", "Taxable_Value", "Rate"]);
    gstrDropColumn(table, "doc_no");
    const recipients = invoiceNumbers("GSTIN_UIN_of_Recipient");
    const invoices = invoiceNumbers("invoice_Advance_Receipt_Number");
    const notes = invoiceNumbers("Note_Refund_Voucher_Number");
    await copyDncn("Note_Refund_Voucher_Number", true);
    gstrInsert(table, { GSTIN_UIN_of_Recipient: String(recipients), Receiver_Name: "", invoice_Advance_Receipt_Number: String(invoices), invoice_Advance_Receipt_DATE: null, Note_Refund_Voucher_Number: String(notes), Note_Refund_Voucher_Date: null, Document_Type: "", PLACE_OF_SUPPLY: "", Note_Refund_Voucher_Value: 0, App_Tax_Rate: 0, Rate: 0, Taxable_Value: 0, Cess_Amount: 0, Pre_GST: "" });
    gstrSortByDate(table, "Note_Refund_Voucher_Date");
  } else if (choice === 6) {
    table.rows = table.rows.filter((row) => num(table.get(row, "Note_Refund_Voucher_Value")) !== 0);
    gstrFirstOfPartition(table, salePw ? ["Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date", "Taxable_Value"] : ["Note_Refund_Voucher_Number", "Note_Refund_Voucher_Date"], ["Note_Refund_Voucher_Value", "Taxable_Value", "Rate"]);
    gstrDropColumn(table, "doc_no");
    const invoices = invoiceNumbers("invoice_Advance_Receipt_Number");
    const notes = invoiceNumbers("Note_Refund_Voucher_Number");
    await copyDncn("Note_Refund_Voucher_Number", false);
    gstrInsert(table, { UR_Type: "", Note_Refund_Voucher_Number: String(notes), Note_Refund_Voucher_Date: null, Document_Type: "", invoice_Advance_Receipt_Number: String(invoices), invoice_Advance_Receipt_DATE: null, PLACE_OF_SUPPLY: "", Note_Refund_Voucher_Value: 0, App_Tax_Rate: 0, Rate: 0, Taxable_Value: 0, Cess_Amount: 0, Pre_GST: "" });
  }
  return table;
}

// ======================================================================================
// 126: INVALID GST NO (SP_FRT_RPT_INVALID_GST_REP), 132: GSTR ENTRY TAX MISMATCH (SP_FRT_RPT_GSTR_TAX_MISMATCH)
// ======================================================================================
//
// Invalid GST No: the sale (8) or purchase (13) entries of the period whose party has no GSTIN (DOC_NO, SELECTED_DATE, amount, name, GST_NO, STATE_NAME,
// STATE_CODE); with "Only Master Level Require" the debtors (sale) or creditors (purchase) whose GSTIN is blank or does not start with their State's code.
// GSTR Entry Tax Mismatch: the entries of the chosen book (sale, purchase, expense, credit note, debit note) whose CGST line and SGST line (of the same entry, or of
// the same stock line when the book's slabs are by product) differ in rate or amount, or have the same tax name. Both are built in memory from read-only queries.

export async function invalidGst(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const purchase = call.fcValue === 13;
  let sql: string;
  if (!call.checkQuery.includes("CHK_ONLYMAST,")) {
    sql = `select a.full_docno as "DOC_NO",${gstrDate6("a.doc_date")} as "SELECTED_DATE",a.amount::numeric as "amount",b.name as "name",'GSTIN has not been specified.' as "GST_NO",d.opt_desc as "STATE_NAME",d.opt_short as "STATE_CODE"`
      + ` from ${db}ledger a, ${db}account b, ${db}Address c, ${db}idopt_master d where a.code=b.code and b.code=c.code and c.state_id=d.idopt_key and a.doc_pos='A' and c.address_id=1 and coalesce(c.GST_NO,'')=''`
      + ` and b.a_pos<>'D' and d.idopt_flag='ST' and a.DOC_DATE between ${day(call.from)} AND ${day(call.upto)} and ${purchase ? "b.book=3 and a.book = 13" : "b.book=2 and a.book = 8"} order by a.doc_date,b.name`;
  } else {
    sql = `select a.name as "name",case when coalesce(b.GST_NO,'')='' then 'GSTIN has not been specified.' else b.GST_NO end as "GST_NO",c.opt_desc as "STATE_NAME",c.opt_short as "STATE_CODE"`
      + ` from ${db}account a, ${db}Address b, ${db}idopt_master c where a.code=b.code and b.state_id=c.idopt_key and b.address_id=1 and (coalesce(b.GST_NO,'')='' or left(b.gst_no::text, 2)<>c.opt_short)`
      + ` and a.a_pos<>'D' and c.idopt_flag='ST' and a.book=${purchase ? 3 : 2} order by a.name`;
  }
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  if (table.has("amount")) table.setKind("amount", "decimal");
  return table;
}

/** The entries' CGST (link 0) or SGST (UTGST) lines of the book the choice names: the stock lines when the book's slabs are by product. */
function gstrMismatchLines(db: string, choice: number, productWise: boolean, tax: "cgst" | "sgst", slab: number, from: string, upto: string): string {
  const books: Readonly<Record<number, number>> = { 1: 8, 2: 13, 3: 15, 4: 16, 5: 11 };
  const book = books[choice] ?? 8;
  const taxName = tax === "cgst" ? `f.opt_Desc='CGST'` : `(f.opt_Desc='SGST' or f.opt_Desc='UTGST')`;
  // The credit note's CGST lines of a product book are not limited to the CGST tax, as in the procedure.
  const taxCondition = tax === "cgst" && productWise && choice === 4 ? "" : ` and ${taxName}`;
  if (productWise) {
    return `select g.name as "name",a.full_docno as "Invoice_Number",to_char(a.il_date, 'DD/MM/YYYY') as "Invoice_Date",a.il_value::numeric as "Amount",b.slab_perc,b.slab_amt::numeric as slab_amt,c.tax_desc,b.il_id,b.led_id`
      + ` from ${db}prod_ledger a left join ${db}ledger_ext b on a.il_key = b.il_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master c on c.tax_rec = b.tax_id left join ${db}idopt_master f on c.tax_type = f.idopt_key::text`
      + ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`
      + ` where a.IL_DATE between ${from} AND ${upto} and a.il_pos<>'D' and b.tax_id>0 and c.tax_perc>0 and a.book in (${book}) and h.address_id=1${taxCondition} and b.slab_id=${slab} and b.led_id is not null and b.il_id is not null`
      + ` order by to_char(a.il_date, 'DD/MM/YYYY'),a.full_docno,b.il_id`;
  }
  return `select g.name as "name",a.full_docno as "Invoice_Number",to_char(a.doc_date, 'DD/MM/YYYY') as "Invoice_Date",a.amount::numeric as "Amount",b.slab_perc,b.slab_amt::numeric as slab_amt,e.tax_desc,b.il_id,b.led_id`
    + ` from ${db}ledger a left join ${db}ledger_ext b on a.led_key = b.led_id left join ${db}slab_master d on b.slab_id = d.slab_key left join ${db}tax_master e on b.tax_id = e.tax_rec left join ${db}idopt_master f on e.tax_type = f.idopt_key::text`
    + ` left join ${db}account g on g.code = a.code left join ${db}Address h on h.code = g.code left join ${db}idopt_master i on i.idopt_key::text = h.state_id::text left join ${db}idopt_master j on j.idopt_key::text = h.p_reg::text`
    + ` where a.DOC_DATE between ${from} AND ${upto} and a.doc_pos<>'D' and b.tax_id>0 and e.tax_perc>0 and b.slab_id=${slab} and a.book in (${book}) and h.address_id=1 and ${taxName} and b.slab_id=${slab} and b.led_id is not null`
    + ` order by to_char(a.doc_date, 'DD/MM/YYYY'),a.doc_no`;
}

export async function gstrTaxMismatch(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const choice = call.fcValue;
  // The book whose slabs are read: the sale (and credit note) 8, the purchase (and debit note) 13, the expense 15.
  const slabBook = choice === 1 || choice === 4 ? 8 : choice === 2 || choice === 5 ? 13 : 15;
  const slabOf = async (link: string): Promise<number> => num((await runReportSql(loader, `SELECT coalesce(SLAB_KEY,0) AS k FROM ${db}SLAB_MASTER WHERE SLAB_FROMDT = ${day(call.tarikh1)} AND SLAB_MASTER='Y' and slab_link${link} AND SLAB_ACTIVE = 'Y' and BOOK = ${slabBook} ORDER BY SLAB_KEY DESC LIMIT 1`)).rows[0]?.k);
  const productWise = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = ${day(call.tarikh1)} AND SLAB_MASTER='Y' AND SLAB_ACTIVE = 'Y' and BOOK = ${slabBook}`)).rows[0]?.n) > 0;
  const sgst = await slabOf(">0");
  const cgst = await slabOf("=0");
  const cgstLines = (await runReportSql(loader, pgFragment(gstrMismatchLines(db, choice, productWise, "cgst", cgst, day(call.from), day(call.upto)), plan, loader.session.companySchema))).rows;
  const sgstLines = (await runReportSql(loader, pgFragment(gstrMismatchLines(db, choice, productWise, "sgst", sgst, day(call.from), day(call.upto)), plan, loader.session.companySchema))).rows;

  const table = gstrTable(["name", "Invoice_Number", "Invoice_Date", ["Amount", "decimal"], ["slab_perc", "decimal"], ["slab_amt", "decimal"], "tax_desc"]);
  const key = productWise ? "il_id" : "led_id";
  const differs = (x: unknown, y: unknown): boolean => x !== null && y !== null && x !== undefined && y !== undefined && num(x) !== num(y);
  // The CGST line paired with the SGST line of the same entry (or stock line): a different rate or amount, or the same tax name.
  for (const a of cgstLines) {
    for (const b of sgstLines) {
      if (a[key] === null || a[key] !== b[key]) continue;
      if (differs(a.slab_perc, b.slab_perc) || differs(a.slab_amt, b.slab_amt) || (a.tax_desc !== null && a.tax_desc === b.tax_desc)) {
        gstrInsert(table, { name: a.name, Invoice_Number: a.Invoice_Number, Invoice_Date: a.Invoice_Date, Amount: a.Amount, slab_perc: a.slab_perc, slab_amt: a.slab_amt, tax_desc: a.tax_desc });
      }
    }
  }
  return table;
}

// ======================================================================================
// 31: STOCK VOUCHER (SP_FRT_RPT_STOCK_VOUCHER)
// ======================================================================================
//
// REPORT > Stock Voucher (the stock vouchers: indent, amendment / adjustment, sample challan, quotation, production slip, job work ...): the stock lines of the chosen
// voucher book in the period, one row a line. The book's name picks the stock moduleText (TRN_MODULE: IND-PURCH, AMD-OUT, PROD-FG ...). A book that keeps a party (STKM_PCODE) shows
// the party, product, quantity and unit (and the factor, rate and value, the entry remark of a sample challan, the job card of job work); the others show the voucher's number and product with the
// quantity (an add and a less column for the production vouchers), and the addon fields as columns. The desktop fills TEMP_TABLE_STOCK_VOUCHER_<machine>; here it is one read-only query.
//
// Not ported: the Dryer Entry report, "Transfer Data" (it writes the godown transfers into the next year's company), and the production slip layouts of licences 7, 30, 38, 40 and 71.

/** The stock moduleText a voucher book's name stands for (@str_stkmid): the first matching name, as the procedure's chain of IFs reads them. */
function stockVoucherModule(where: string): string {
  const has = (text: string) => where.includes(text);
  let id = "";
  if (has("STOCK VOUCHER-ADD")) id = "SVOU-ADD  ";
  if (has("STOCK VOUCHER - ADD")) id = "SVOU-ADD  ";
  else if (has("STOCK VOUCHER - LESS") || has("STOCK VOUCHER-LESS")) id = "SVOU-LESS ";
  else if (has("PROCESS FOR STOCK ADD")) id = "PROC-IN";
  else if (has("PROCESS FOR STOCK LESS")) id = "PROC-OUT";
  else if (has("INDENT ADD") || has("EXCHANGE IN") || has("FOLDER MAKING")) id = "IND-IN    ";
  else if (has("INDENT LESS")) id = "IND-OUT   ";
  else if (has("PROFORMA") || has("SELECTION SLIP")) id = "IND-OUT   ";
  else if (has("BRANCH TRANSFER ADD")) id = "IND-IN    ";
  else if (has("BRANCH TRANSFER LESS")) id = "IND-OUT   ";
  else if (has("AMENDMENT ADD") || has("REPLACE IN")) id = "AMD-IN    ";
  else if (has("AMENDMENT LESS") || has("REPLACE OUT") || has("SAMPLE CHALLAN") || has("PRODUCT SELECTION")) id = "AMD-OUT   ";
  else if (has("PANEL")) id = "AMD-OUT   ";
  else if (has("REPLACE FOR STOCK ADD")) id = "PROC-IN";
  else if (has("REPLACE FOR STOCK LESS")) id = "PROC-OUT";
  else if (has("SAMPLE FOR STOCK ADD")) id = "SPL-IN";
  else if (has("SAMPLE FOR STOCK LESS")) id = "SPL-OUT";
  else if (has("GODOWN TRANSFER")) id = "GW-TRF   ";
  else if (has("FOLDER-IN")) id = "PROC-IN";
  else if (has("FOLDER-OUT")) id = "PROC-OUT";
  else if (has("ORDER")) id = "QTN-IN";
  else if (has("SHORTAGE")) id = "QTN-OUT";
  else if (has("BROKEN") || has("STORE TO ISSUE")) id = "ENQ-OUT";
  else if (has("FORMULA")) id = "MFG-BOM";
  else if (has("JOB STOCK OUT")) id = "JOB-OUT";
  else if (has("JOB STOCK IN")) id = "JOB-IN";
  else if (has("INDENT PURCHASE")) id = "IND-PURCH";
  else if (has("QUOTATION-PURCHASE")) id = "QTN-PURCH";
  else if (has("PRODUCTION SLIP [FG]")) id = "PROD-FG";
  else if (has("PRODUCTION SLIP [SFG]")) id = "PROD-SFG";
  else if (has("PRODUCTION MULTI")) id = "PROD-MULTI";
  else if (has("RG AC ENTRY")) id = "RG-AC";
  else if (has("STOCK JV")) id = "STK-JV";
  else if (has("DRYER ENTRY")) id = "DRYER";
  if (has("FORMULA1")) id = "MFG-BOM1";
  return id;
}

export async function stockVoucher(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const where = call.fcText.toUpperCase();
  const has = (text: string) => where.includes(text);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const licence = call.licence;
  const book = call.book;
  const day = (date: Date) => `'${desktopDate(date)}'::date`;
  const stkmid = stockVoucherModule(where);
  const production = has("PRODUCTION SLIP") || has("PRODUCTION MULTI");
  const jobIn = has("JOB STOCK IN");
  const jobOut = has("JOB STOCK OUT");
  const sample = has("SAMPLE CHALLAN");
  const formula = has("FORMULA");
  if (has("DRYER ENTRY")) throw new ReportRefusal("The Dryer Entry report is not available in the web version yet.", "Not ported yet");
  if (check("CHK_GWTRF") && has("GODOWN TRANSFER")) throw new ReportRefusal("Transfer Data writes the godown transfers into the next year's company, which the web version does not do.", "Not ported yet");
  if (production && [7, 30, 38, 40, 71].includes(licence)) throw new ReportRefusal(`The production slip layout of licence ${licence} is not available in the web version yet.`, "Not ported yet");
  const moduleText = `'${stkmid.replace(/'/g, "''")}'`;
  const addons = call.addon;
  const keyOf = (addon: string) => addon.replace(" adata.txt_", " adata.key_").replace(" aentry.txt_", " aentry.key_");
  // The addon field's name as its column is called (the procedure's alias keeps the table prefix; the name alone is what it means).
  const aliasOf = (addon: string) => addon.slice(addon.toLowerCase().lastIndexOf("txt_") + 4).trim();
  const addonColumns = addons.map((addon) => (addon !== "" ? `,${addon} as "${aliasOf(addon)}"` : "")).join("");

  // A book that keeps a party (STKM_PCODE).
  const partyWise = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${db}BOOK_PROPERTIES WHERE STKM_PCODE = 'Y' AND STKM_POS <> 'D' and rtrim(STKM_SHORT) = rtrim(${moduleText}) AND BOOK_ACTUAL = 'N' and STKM_FORBOOK = ${Math.trunc(book)}`)).rows[0]?.n) > 0;
  const date103 = (column: string) => `to_char(${column},'DD/MM/YYYY')`;
  const whole = (expression: string) => `trunc(${expression})::int`;
  const part = (expression: string, alias: string) => `${expression} as "${alias}"`;
  const procModule = stkmid.trim() === "PROC-IN" || stkmid.trim() === "PROC-OUT";
  const factor = check("CHK_FACTOR");
  const withRate = check("CHK_RATE");
  const periodWhere = `a.IL_POS = 'A' and c.prod_pos <> 'D' and b.il_pos = 'A' AND b.p_DATE >= ${day(call.from)} AND b.p_DATE <= ${day(call.upto)}`;
  const rangeText = (extra: string) => `${periodWhere}${extra} AND rtrim(a.trn_module) = rtrim(${moduleText})`;
  let sql: string;

  if (partyWise) {
    const rateName = licence === 15 && procModule ? "MRP_RATE" : "Rate";
    const rateOf = (guard: boolean) => `cast((case when ${licence} = 15${guard ? " and (a.trn_module = 'PROC-IN' or a.trn_module = 'PROC-OUT')" : ""} then a.master_rate::numeric else a.rate end) as numeric(20,2))`;
    const valueOf = (guard: boolean) => `(case when ${licence} = 15${guard ? " and (a.trn_module = 'PROC-IN' or a.trn_module = 'PROC-OUT')" : ""} then round(a.master_rate::numeric*a.quantity,2) else a.il_value::numeric end)`;
    const columns: string[] = [part(date103("a.il_date"), "DATE"), part("a.full_docno", "NO")];
    if (jobIn) columns.push(part("a.order_no", "JOB_OUT_NO"), part("aent.input_pjobcard", "Job_Card_No"), part("d.name", "NAME"), part("c.prod_desc", "DESCRIPTION"), part("a.quantity", "QTY"), part("a.cost_rate::numeric", "REJECTION"));
    else if (jobOut) columns.push(part("aent.input_pjobcard", "Job_Card_No"), part("d.name", "Name"), part("c.prod_desc", "Description"), part("a.quantity", "Qty"));
    else columns.push(part("d.name", "Name"), part("c.prod_desc", "Description"), part("a.quantity", "Qty"));
    columns.push(part("puom.uom_short", "Uom"));
    if (factor) columns.push(part("a.factor", "Fact"));
    if (withRate) columns.push(part(rateOf(!factor), rateName), part(valueOf(!factor), "Value"));
    if (sample) columns.push(part("aent.input_ent_remark", "ENTRY_REMARK"));
    columns.push(part("b.stk_remark", "REMARK"));
    const entryJoin = sample || jobOut || jobIn ? ` left join ${db}addon_ientry aent on aent.aoni_il_id = a.il_key` : "";
    const keys = [0, 1, 2, 3].map((at) => (call.selectKey[at] !== "" ? ` and ${keyOf(addons[at])} in ${call.selectKey[at]}` : "")).join("");
    sql = `select ${columns.join(",")}${addonColumns} from ${db}prod_ledger a left join ${db}process b on a.process_id=b.process_key left join ${db}product_master c on a.prod_id=c.prod_key left join ${db}account d on a.code=d.code`
      + ` left join ${db}addon_data adata on a.prod_id=adata.prod_id left join ${db}prod_uom puom on puom.uom_key = a.uomentry_id${entryJoin}`
      + ` where ${rangeText(` and a.quantity>0${jobOut ? " and a.stock_nat='L'" : jobIn ? " and a.stock_nat='A'" : ""}`)}${book > 0 ? ` AND b.BOOK = ${Math.trunc(book)}` : ""}${keys} ORDER BY b.doc_no2,b.p_date,b.full_docno,a.il_key`;
  } else {
    const columns: string[] = [part(date103("a.il_date"), "DATE")];
    const addonSelected: string[] = [];
    let extraFrom = "";
    let production21 = false;
    if (book > 0) {
      columns.push(part("a.full_docno", "NO"), part("c.prod_desc", "Description"));
      if (factor && withRate) columns.push(part(whole("a.quantity"), "Qty"), part("a.factor", "Fact"), part("cast(a.rate as numeric(20,2))", "Rate"), part("puom.uom_short", "Uom"), part("a.il_value::numeric", "Value"));
      else if (factor) columns.push(part(whole("a.quantity"), "Qty"), part("puom.uom_short", "Uom"), part("a.factor", "Fact"));
      else if (withRate) columns.push(part(whole("a.quantity"), "Qty"), part("cast(a.rate as numeric(20,2))", "Rate"), part("puom.uom_short", "Uom"), part("a.il_value::numeric", "Value"));
      else if (licence === 21) {
        const packing = `(case when c.base_pack > 1 then ${whole("c.base_pack")} else 0 end)`;
        if (formula || production) {
          columns.push(part(packing, "Packing"), part("case when a.stock_nat = 'A' then cast(a.quantity as numeric(18,4)) else 0 end", "Mfg_qty"), part("case when a.stock_nat = 'L' then cast(a.quantity as numeric(18,4)) else 0 end", "Rm_qty"),
            part("cast(a.rate as numeric(20,2))", "Rate"), part("puom.uom_short", "Uom"), part("a.il_value::numeric", "Amount"));
        } else columns.push(part(whole("a.bundle"), "Box"), part(whole("a.pack_qty"), "Packing"), part(whole("a.loose_qty"), "Loose"), part("cast(a.quantity as numeric(18,4))", "Qty"), part("cast(a.rate as numeric(20,2))", "Rate"), part("puom.uom_short", "Uom"), part("a.il_value::numeric", "Amount"));
      } else if ((formula && licence === 30) || (has("FORMULA1") && licence === 40)) {
        columns[2] = part(`case when a.stock_nat = 'A' then (select sub_name from ${db}ADDON_SUB where sub_code=a.prod_id limit 1) else c.prod_desc end`, "Description");
        columns.push(part(`case when a.stock_nat = 'A' then ${whole("a.quantity")} else 0 end`, "Mfg_qty"), part("case when a.stock_nat = 'L' then a.quantity else 0 end", "Rm_qty"), part("puom.uom_short", "Uom"));
      } else if (formula && licence === 40) columns.push(part(`case when a.stock_nat = 'A' then ${whole("a.quantity")} else 0 end`, "Mfg_qty"), part("case when a.stock_nat = 'L' then a.quantity else 0 end", "Rm_qty"), part("puom.uom_short", "Uom"));
      else columns.push(part(whole("a.quantity"), "Qty"), part("puom.uom_short", "Uom"));
      columns.push(part("b.stk_remark", "REMARK"));
      for (let at = 0; at < 4; at += 1) addonSelected.push(call.selectedAddon[at] === "" ? `'' as "SMART_SELECTED_ADDON${at + 1}"` : call.selectedAddon[at]);
    } else if (licence === 21 && production) {
      production21 = true;
      columns.unshift("a.prod_id");
      columns.push(part("a.full_docno", "NO"), part("aent.input_job_card", "JOB_CARD_NO"), part("c.prod_desc", "Description"), part(whole("c.base_pack"), "std_pack"), part("case when a.stock_nat = 'A' then cast(a.quantity as numeric(18,4)) else 0 end", "Add_qty"),
        part("case when a.stock_nat = 'L' then cast(a.quantity as numeric(18,4)) else 0 end", "Less_qty"), part("cast(a.rate as numeric(20,2))", "Rate"), part("puom.uom_short", "Uom"), part("a.il_value::numeric", "Amount"), part("b.stk_remark", "REMARK"));
    } else {
      const quantity = licence === 21 ? (expression: string) => `cast(${expression} as numeric(18,4))` : (expression: string) => whole(expression);
      columns.push(part("btrim(b.doc_no2)", "NO"), part("c.prod_desc", "Description"));
      if (factor) columns.push(part(`case when a.stock_nat='L' then ${whole("a.quantity")} else 0 end`, "Less_Qty"), part("case when a.stock_nat='L' then a.factor else 0.00 end", "Less_FACT"), part(`case when a.stock_nat='A' then ${whole("a.quantity")} else 0 end`, "Add_Qty"), part("case when a.stock_nat='A' then a.factor else 0.00 end", "Add_Fact"), part("cast(a.rate as numeric(20,2))", "Rate"), part("puom.uom_short", "Uom"));
      else columns.push(part(`case when a.stock_nat='L' then ${quantity("a.quantity")} else ${quantity("0")} end`, "Less_Qty"), part(`case when a.stock_nat='A' then ${quantity("a.quantity")} else ${quantity("0")} end`, "Add_Qty"), part("cast(a.rate as numeric(20,2))", "Rate"), part("puom.uom_short", "Uom"));
      // Godown transfers: the godown the stock came from (the less line) and went to (the add line).
      const godown = addons.findIndex((addon) => addon.toUpperCase().includes("TXT_GODOWN"));
      if (godown >= 0) {
        const pick = (nature: string) => `case when a.stock_nat='${nature}' then (select txt_godown from ${db}addon_ientry aentry where aentry.aoni_il_id=a.il_key and ${keyOf(addons[godown])} in ${call.selectKey[godown]} limit 1) else '' end`;
        columns.push(part(pick("L"), "From_Godown"), part(pick("A"), "To_Godown"), part("b.stk_remark", "REMARK"));
      }
    }
    if (production21 || (production && [21, 30, 38, 7, 40, 71].includes(licence)) || (has("DRYER ENTRY"))) extraFrom += ` left join ${db}addon_aentry aent on a.process_id=aent.aona_processid`;
    if (addons.some((addon) => addon.toUpperCase().includes("TXT_GODOWN")) || has("STORE TO ISSUE")) extraFrom += ` left join ${db}addon_ientry aentry on a.il_key=aentry.aoni_il_id`;
    const filter = addons[0] !== "" ? ` and ${keyOf(addons[0])} in ${call.selectKey[0]}` : "";
    const headings = call.headingAddon;
    let lead = 0;
    while (lead < 4 && headings[lead] !== "") lead += 1;
    const headOrder = addons.slice(0, lead).filter((addon) => addon !== "").join(",");
    let order: string;
    if (book === -1) order = formula ? "b.doc_no2,a.stock_nat,a.il_date,a.il_serial" : "b.p_date,b.doc_no2,b.full_docno,a.stock_nat desc,a.il_billdesc";
    else if (headOrder !== "") order = `${headOrder},b.doc_no2,${formula ? "a.stock_nat" : "b.p_date,b.full_docno"},a.il_serial`;
    else order = formula ? "b.doc_no2,a.stock_nat,a.il_date,a.il_serial" : "b.doc_no2,b.p_date,b.full_docno,a.il_serial";
    sql = `select ${[...columns, ...addonSelected].join(",")}${addonColumns} from ${db}prod_ledger a left join ${db}process b on a.process_id=b.process_key left join ${db}product_master c on a.prod_id=c.prod_key left join ${db}account d on a.code=d.code`
      + ` left join ${db}addon_data adata on a.prod_id=adata.prod_id left join ${db}prod_uom puom on puom.uom_key=a.uomentry_id${extraFrom}`
      + ` where ${rangeText("")}${filter}${book > 0 ? ` AND b.BOOK = ${Math.trunc(book)}` : ""} ORDER BY ${order}`;
  }
  if (stkmid === "") throw new ReportRefusal("Internal program failure\nQuery Was Blank", "INTERNAL PROGRAM FAILURE");
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema)));
  // Licence 21's finished goods slip is valued at the latest selling rate.
  if (licence === 21 && has("PRODUCTION SLIP [FG]") && table.has("prod_id") && table.has("Rate")) {
    const rates = new Map((await runReportSql(loader, pgFragment(`select distinct on (prod_id) prod_id, pl_srate::numeric as rate from ${db}pricelist where pl_pos='A' and pl_srate>0 and pl_wefrom<=${day(call.upto)} order by prod_id, pl_wefrom desc`, plan, loader.session.companySchema))).rows.map((row) => [num(row.prod_id), num(row.rate)] as const));
    for (const row of table.rows) {
      const rate = rates.get(num(table.get(row, "prod_id")));
      table.set(row, "Rate", rate ?? null);
      table.set(row, "Amount", rate === undefined ? null : Math.round(num(table.get(row, "Add_qty")) * rate * 100) / 100);
    }
  }
  return table;
}

// ======================================================================================
// 11: CHALLAN REGISTER (SP_STD_RPT_CHLN_REG: Detail; SP_FRT_RPT_CHALLAN_REG: Summary For Period Selected)
// ======================================================================================
//
// INVENTORY > Challan > Register: the delivery (SALE, book 8) or receipt (PURCHASE, book 13) challans of the period. The procedures copy
// the challans (PROCESS, of the book's challan module: BOOK_PROPERTIES STKM_ID 'CH') into TEMP_TABLE_CHLN_REG1 (TCR1) and their product
// lines (PROD_LEDGER) into TEMP_TABLE_CHLN_REG2 (TCR2), and the setup's FROM joins the two; here they are the same two queries as
// subqueries, so nothing is written. Detail: a line per product line with the setup's columns. Summary: a line per challan, its
// quantities and value added up. Licence 21 also takes challans with no party (as the procedure); an addon group adds its column and
// orders by it; Date Wise Sorting orders by the date before the challan number.

/** TCR1 and TCR2 as subqueries in the setup's FROM, the challan module of the book and what the FROM's sys.aent marks become. */
export async function challanFrom(loader: Loader, plan: ReportPlan, summary: boolean, addonColumns: readonly string[]): Promise<string> {
  const { call } = plan;
  const db = call.database;
  const book = call.book;
  if (!Number.isInteger(book) || book < 0) throw new ReportRefusal("Choose a book from its list", "Report Generation Failed");
  const challan = toText((await runReportSql(loader, `SELECT btrim(STKM_SHORT) AS module FROM ${db}BOOK_PROPERTIES WHERE btrim(STKM_ID) = 'CH' AND STKM_FORBOOK = $1`, [book])).rows.at(-1)?.module);
  const from = `'${desktopDate(call.from)}'`;
  const upto = `'${desktopDate(call.upto)}'`;
  const godown = call.addon.some((text) => text.toUpperCase().includes("GODOWN"));
  const entryAddon = call.acAddonRepdefa.includes("E");
  // Licence 21 keeps the challans with no party (the Detail procedure does; the Summary one does not, which leaves it empty where the
  // Detail lists them: the web keeps them in both).
  const anyParty = call.licence === 21;
  const tcr1 = `(SELECT proces.* FROM ${db}PROCESS proces left join ${db}ACCOUNT ac on ac.code=proces.code`
    + ` WHERE proces.IL_POS = 'A'${anyParty ? "" : " AND proces.CODE > 0 AND proces.CODE IS NOT NULL and ac.a_pos<>'D'"}`
    + ` AND proces.P_DATE between ${from} AND ${upto} AND proces.BOOK = ${book} AND btrim(proces.STK_MODULE) = '${challan.replace(/'/g, "''")}')`;
  // The licence 2 delivery charge per bundle (the party's addon DELIVERY); others have none.
  const delivery = call.licence === 2 && !summary ? "adata.input_DELIVERY::text" : "NULL::text";
  const lineFrom = summary
    ? `${db}PROD_LEDGER PRODLED left join ${db}PRODUCT_MASTER PRODUCT on product.prod_key=prodled.prod_id left join ${db}ADDON_DATA ADATA on adata.prod_id=prodled.prod_id`
    : `${db}PROD_LEDGER PRODLED left join ${db}PRODUCT_MASTER PRODUCT on product.prod_key=prodled.prod_id left join ${db}ADDON_DATA PADATA on padata.prod_id=prodled.prod_id left join ${db}ADDON_DATA ADATA on adata.code=prodled.code`;
  const tcr2 = `(SELECT PRODLED.*, PRODUCT.PROD_SHORT, PRODUCT.PROD_DESC, PRODUCT.PROD_KEY, ${delivery} AS "delivery"${addonColumns.map((column) => `, ${column}`).join("")} FROM ${lineFrom}`
    + ` WHERE PRODLED.BOOK = ${book}${anyParty ? "" : " AND PRODLED.CODE > 0 AND PRODLED.CODE IS NOT NULL"} AND btrim(PRODLED.TRN_MODULE) = '${challan.replace(/'/g, "''")}'`
    + ` AND PRODLED.IL_POS = 'A' and PRODUCT.PROD_POS <> 'D' AND PRODLED.IL_DATE between ${from} AND ${upto})`;
  let fromSql = call.from_
    .replace(/TEMP_TABLE_CHLN_REG1_\|SYS\.USER_NO\|/i, tcr1)
    .replace(/TEMP_TABLE_CHLN_REG2_\|SYS\.USER_NO\|/i, tcr2);
  if (godown) fromSql = fromSql.replace("sys.aent.bstart", "(").replace("sys.aent.bend", ` left join ${db}ADDON_IENTRY aentry on aentry.AONI_IL_ID=TCR2.IL_KEY)`);
  else if (entryAddon && !summary) fromSql = fromSql.replace("sys.aent.bstart", "(").replace("sys.aent.bend", ` left join ${db}ADDON_AENTRY aentry on aentry.aona_processid=TCR2.process_id)`);
  else fromSql = fromSql.replace("sys.aent.bstart", "").replace("sys.aent.bend", "");
  return fromSql;
}

// ======================================================================================
// 19: CHALLAN PENDING (SP_STD_RPT_CHLN_PEND_REG: Detail; SP_FRT_RPT_CHALLAN_PENDING_REG: Summary For Period Selected)
// ======================================================================================
//
// INVENTORY > Challan > Pending: the challan lines of the period still pending, their quantity not yet billed or closed (quantity less
// what was set against it and the closed quantity above zero). The same two temp tables as the register (TEMP_TABLE_CHLN_PEND_REG1 /
// REG2, here subqueries). Detail takes the challans with or without a party; Summary only those with a party and an addon row for the
// product (as the procedure), except licence 21, whose challans have no party (as the register).

/** TCR1 and TCR2 of the pending challans as subqueries in the setup's FROM. */
export async function pendingChallanFrom(loader: Loader, plan: ReportPlan, summary: boolean): Promise<string> {
  const { call } = plan;
  const db = call.database;
  const book = call.book;
  if (!Number.isInteger(book) || book < 0) throw new ReportRefusal("Choose a book from its list", "Report Generation Failed");
  const challan = toText((await runReportSql(loader, `SELECT btrim(STKM_SHORT) AS module FROM ${db}BOOK_PROPERTIES WHERE btrim(STKM_ID) = 'CH' AND STKM_FORBOOK = $1`, [book])).rows.at(-1)?.module).replace(/'/g, "''");
  const from = `'${desktopDate(call.from)}'`;
  const upto = `'${desktopDate(call.upto)}'`;
  const godown = call.addon.some((text) => text.toUpperCase().includes("GODOWN"));
  const entryAddon = call.acAddonRepdefa.includes("E");
  const party = summary && call.licence !== 21;
  const pending = "PRODLED.quantity-(PRODLED.ag_qty+coalesce(PRODLED.setof_qty,0))>0";
  const tcr1 = `(SELECT proces.* FROM ${db}PROCESS proces left join ${db}ACCOUNT ac on ac.code=proces.code WHERE proces.IL_POS = 'A'${party ? " AND proces.CODE > 0 AND proces.CODE IS NOT NULL and ac.a_pos<>'D'" : ""}`
    + ` AND proces.P_DATE between ${from} AND ${upto} AND proces.BOOK = ${book} AND btrim(proces.STK_MODULE) = '${challan}')`;
  const tcr2 = summary
    ? `(SELECT PRODLED.*, PRODUCT.PROD_SHORT, PRODUCT.PROD_DESC, PRODUCT.PROD_KEY FROM ${db}PROD_LEDGER PRODLED join ${db}PRODUCT_MASTER PRODUCT on PRODLED.PROD_ID = PRODUCT.PROD_KEY join ${db}ADDON_DATA PADATA on PADATA.PROD_ID = PRODLED.PROD_ID`
      + `${godown ? ` join ${db}ADDON_IENTRY aentry on aentry.AONI_IL_ID=PRODLED.IL_KEY` : ""}`
      + ` WHERE PRODLED.BOOK = ${book} AND ${pending}${party ? " AND PRODLED.CODE IS NOT NULL" : ""} AND btrim(PRODLED.TRN_MODULE) = '${challan}' AND PRODLED.IL_POS = 'A' and PRODUCT.PROD_POS <> 'D'`
      + ` AND PRODLED.IL_DATE between ${from} AND ${upto})`
    : `(SELECT PRODLED.*, PRODUCT.PROD_SHORT, PRODUCT.PROD_DESC, PRODUCT.PROD_KEY`
      + ` FROM ${db}PROCESS PROCESS left join ${db}PROD_LEDGER PRODLED on prodled.process_id=process.process_key AND PRODLED.AG_QTY<PRODLED.QUANTITY left join ${db}PRODUCT_MASTER PRODUCT on product.prod_key=prodled.prod_id`
      + ` WHERE PRODLED.BOOK = ${book} AND btrim(PRODLED.TRN_MODULE) = '${challan}' AND PRODLED.IL_POS = 'A' and PRODUCT.PROD_POS <> 'D' AND ${pending}`
      + ` AND PROCESS.P_DATE between ${from} AND ${upto})`;
  let fromSql = call.from_
    .replace(/TEMP_TABLE_CHLN_PEND_REG1_\|SYS\.USER_NO\|/i, tcr1)
    .replace(/TEMP_TABLE_CHLN_PEND_REG2_\|SYS\.USER_NO\|/i, tcr2);
  if (godown) fromSql = fromSql.replace("sys.aent.bstart", "(").replace("sys.aent.bend", ` left join ${db}ADDON_IENTRY aentry on aentry.AONI_IL_ID=TCR2.IL_KEY)`);
  else if (entryAddon && !summary) fromSql = fromSql.replace("sys.aent.bstart", "(").replace("sys.aent.bend", ` left join ${db}ADDON_AENTRY aentry on aentry.aona_processid=TCR2.process_id)`);
  else fromSql = fromSql.replace("sys.aent.bstart", "").replace("sys.aent.bend", "");
  return fromSql;
}

async function challanPending(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const ticked = call.selectKey.slice(0, 4).map((keys, index) => (keys !== "" && call.addon[index].trim() !== "" ? call.addon[index].trim() : "")).filter(Boolean);
  const fromSql = await pendingChallanFrom(loader, plan, false);
  let select = call.queryStart.replace(/,\s*\|\|\s*' {3}P'/, ", TCR1.DOC_NO2 || '   P'");
  if (ticked.length > 0) select += `,${ticked.map((column) => `${column} AS "${column.replace(/^\w+\.txt_/i, "").toUpperCase()}"`).join(",")}`;
  const where = call.where.trim().toLowerCase() === "where" ? "" : call.where;
  const order = [...ticked, ...(call.checkQuery.includes("CHK_SORTDATE,") ? ["TCR1.P_DATE"] : []), "TCR1.DOC_NO2"];
  const table = tableFromResult(await runReportSql(loader, pgFragment(`SELECT ${select} ${fromSql} ${where} ORDER BY ${order.join(",")}`, plan, session.companySchema)));
  for (const column of ["BOOK", "PROCESS_KEY", "SMART_AC_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE"]) { const name = table.name(column); if (name !== undefined) table.numberKinds.delete(name); }
  // The challan number the rows sort by: the setup hides it under the field name CHALLAN, which no column has.
  if (!plan.hidden.includes("DOC_NO2")) plan.hidden.push("DOC_NO2");
  return table;
}

async function challanRegister(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const dateSort = call.checkQuery.includes("CHK_SORTDATE,");
  const ticked = call.selectKey.slice(0, 4).map((keys, index) => (keys !== "" && call.addon[index].trim() !== "" ? call.addon[index].trim() : "")).filter(Boolean);
  // The addon's column under its field's name (the procedure's heading addon: adata.txt_AREA as "AREA").
  const addonSelect = ticked.map((column) => `${column} AS "${column.replace(/^\w+\.txt_/i, "").toUpperCase()}"`);
  const fromSql = await challanFrom(loader, plan, false, []);
  let select = call.queryStart.replace(/,\s*\|\|\s*' {3}P'/, ", TCR1.DOC_NO2 || '   P'");
  // The delivery charge is text in the addon; as a number only where it is one.
  select = select.replace(/coalesce\(TCR2\.DELIVERY,\s*''\)\s*=\s*''/gi, "coalesce(TCR2.DELIVERY,'')=''").replace(/TCR2\.BUNDLE\s*\*\s*TCR2\.DELIVERY/gi, "TCR2.BUNDLE*nullif(TCR2.DELIVERY,'')::numeric");
  if (addonSelect.length > 0) select += `,${addonSelect.join(",")}`;
  const where = call.where.trim().toLowerCase() === "where" ? "" : call.where;
  const order = ticked.length > 0 ? [...ticked] : call.orderBy.trim().toLowerCase() === "ac.name" ? ["AC.NAME"] : [];
  if (dateSort) order.push("TCR1.P_DATE");
  order.push("TCR1.DOC_NO2");
  const sql = `SELECT ${select} ${fromSql} ${where} ORDER BY ${order.join(",")}`;
  const table = tableFromResult(await runReportSql(loader, pgFragment(sql, plan, session.companySchema)));
  // The hidden keys (book, challan, a group's code) are not figures: as numbers the grid would put an empty PARTICULARS column first.
  for (const column of ["BOOK", "PROCESS_KEY", "SMART_AC_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE"]) { const name = table.name(column); if (name !== undefined) table.numberKinds.delete(name); }
  // The challan number the rows sort by: the setup hides it, under a field name ("Challan") no column has.
  if (!plan.hidden.includes("DOC_NO2")) plan.hidden.push("DOC_NO2");
  return table;
}

// ======================================================================================
// 20: ORDER PENDING (SP_STD_RPT_PEND_ORDER_REG: Detail; SP_FRT_RPT_PEND_ORDER_REG: Summary For Period Selected)
// ======================================================================================
//
// INVENTORY > Order > Pending: the order lines of the period (the book's order module, BOOK_PROPERTIES STKM_ID 'OR'; job orders JO / JI
// with CHK_JOBORD) whose quantity is not yet billed or closed (quantity less what was set against it and the closed quantity above zero).
// Detail: the setup's columns per line; the procedure fills the setup's SYS.COL / SYS.BOXCOL1 / SYS.SLAB_COL places by licence and side:
//  - licence 21, SALE (and the Kanpur / Kaithal companies' PURCHASE): the line's remark (item entry addon), box, packing, loose and the
//    boxes still pending; the billed quantity column is left out;
//  - licence 21, PURCHASE: the job card, delivery date and specification (item entry addons);
//  - any other licence (or job orders): none of them.
// Stock: the product's closing stock is spread over its pending lines (the procedure's cursor): the first line shows what is left after
// it, each next line what is left after that one, none below zero. The procedure ran it over the slab rows (a line per slab), which took
// a line's quantity once for each slab; here once per line.
// Rishabh Plastic's SALE (licence 21) and Kanpur / Kaithal's PURCHASE add the book's product slabs (SLAB_MASTER slab_pos 'P', active) as
// columns, as the procedure's PIVOT (withProductSlabs). Not ported: licence 71's SALE layout.

/** The order module of the book (job orders: JO for sale, JI for purchase). */
async function orderModule(loader: Loader, plan: ReportPlan, jobOrder: boolean): Promise<string> {
  const { call } = plan;
  const id = jobOrder ? (call.book === 8 ? "JO" : "JI") : "OR";
  return toText((await runReportSql(loader, `SELECT btrim(STKM_SHORT) AS module FROM ${call.database}BOOK_PROPERTIES WHERE btrim(STKM_ID) = $1 AND STKM_FORBOOK = $2`, [id, call.book])).rows.at(-1)?.module).replace(/'/g, "''");
}

/** The order lines' where, after the setup's: the book, its order module, the period; `pending` only the lines still to bill or close. */
export async function orderPendingWhere(loader: Loader, plan: ReportPlan, jobOrder: boolean, withCode: boolean, pending = true, dateColumn = "prodled.IL_DATE"): Promise<string> {
  const { call } = plan;
  if (!Number.isInteger(call.book) || call.book < 0) throw new ReportRefusal("Choose a book from its list", "Report Generation Failed");
  const orderModuleName = await orderModule(loader, plan, jobOrder);
  const where = call.where.split("|sys.yearid|").join(call.yearId);
  return `${where}${where.trim().toUpperCase() === "WHERE" ? "" : " AND "} prodled.BOOK = ${call.book}${withCode ? " AND PRODLED.CODE IS NOT NULL" : ""}`
    + `${pending ? " AND prodled.quantity-(prodled.ag_qty+coalesce(prodled.setof_qty,0))>0" : ""} AND btrim(PRODLED.TRN_MODULE) = '${orderModuleName}' and prodled.il_pos='A'`
    + ` AND (${dateColumn} >= '${desktopDate(call.from)}' AND ${dateColumn} <= '${desktopDate(call.upto)}')`;
}

/** The setup's FROM as the procedures use it: no brackets, the year's balance, and the entry addon joins at sys.aent.bend. */
export function orderPendingFrom(plan: ReportPlan, joins: string): string {
  const { call } = plan;
  return call.from_.replace(/[()]/g, "").replace(/prodbal\.PREC_FLAG\s*=\s*'RP'/i, `prodbal.PREC_FLAG='RP' and prodbal.YEAR_ID='${call.yearId}'`).replace("sys.aent.bend", joins).replace("sys.aent.bstart", "");
}

// ======================================================================================
// 12: ORDER REGISTER (SP_STD_RPT_ORDER_REG: Detail; SP_FRT_RPT_ORDER_REG: Summary For Period Selected)
// ======================================================================================
//
// INVENTORY > Order > Register: every order line of the period (the book's order module; JO / JI job orders with CHK_JOBORD), billed or
// not. As the Order Pending, but this report's first combo is SALE 1, PURCHASE 2 (the Pending's is SALE 2): licence 21 SALE has the
// remark, box, packing, loose and the entry's source (ENTRY_FROM) and, for Rishabh Plastic, the sale product slabs as columns (Kanpur /
// Kaithal: the PURCHASE side); licence 21 PURCHASE has the job card, delivery date and specification (Rishabh Plastic) or box, packing,
// loose. Licence 14 adds the order's addresses. Despatch Required (CHK_ORD_DESPATCH, SALE) lists the production plan's despatches of the
// period instead. No stock column.

async function orderRegister(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const company = db.toUpperCase();
  const kanpur = company.includes("RISHABH_KANPUR") || company.includes("RISHABH_KAITHAL");
  const plastic = company.includes("RISHABH_PLASTIC");
  const fc = call.fcValue;
  const lic = call.licence;
  const jobOrder = check("CHK_JOBORD");
  const despatch = fc === 1 && check("CHK_ORD_DESPATCH");
  const slabSide = (fc === 1 && lic === 21 && plastic) || (fc === 2 && kanpur);
  const slabs = !slabSide ? [] : (await runReportSql(loader, `SELECT SLAB_KEY AS key, btrim(SLAB_SHORT) AS short, btrim(coalesce(SLAB_MASTER,'')) AS master, btrim(coalesce(SLAB_MATHOP,'')) AS mathop FROM ${db}SLAB_MASTER`
    + ` WHERE SLAB_POS = 'P' AND SLAB_ACTIVE = 'Y' and BOOK = $1 ORDER BY BOOK, SLAB_ORDER`, [call.book])).rows;
  const pivot = slabs.length > 0;

  // The entry addon joins at sys.aent.bend, as the procedure.
  const godown = call.addon.some((text) => text.toUpperCase().includes("GODOWN"));
  const acEntry = call.acAddonRepdefa.includes("E");
  const prodEntry = call.prodAddonRepdefa.includes("E");
  const itemEntry = (alias: string) => ` left join ${db}ADDON_IENTRY ${alias} on ${alias}.AONI_IL_ID=prodled.IL_KEY`;
  const voucherEntry = (alias: string) => ` left join ${db}ADDON_AENTRY ${alias} on ${alias}.AONA_PROCESSID=prodled.PROCESS_ID`;
  let joins = "";
  if (godown || (pivot && lic === 21)) {
    if (acEntry && prodEntry) joins = itemEntry("aientry") + voucherEntry("aentry");
    else if (acEntry) joins = lic === 14 ? voucherEntry("aentry") : voucherEntry("aientry");
    else if (prodEntry) joins = lic === 14 ? itemEntry("aientry") + voucherEntry("aentry") : itemEntry("aientry");
    else joins = itemEntry("aentry");
  } else if (despatch) joins = ` left join ${db}PRODUCTION_PLANING prodplan on prodplan.PEND_QTY=prodled.IL_KEY`;
  else if (acEntry) joins = voucherEntry("aentry");
  else if (prodEntry) joins = itemEntry("aientry");
  else if (lic === 14) joins = voucherEntry("aentry");
  else if (lic === 21 && fc === 2 && plastic) joins = itemEntry("aentry");

  // The setup's SYS.COL places.
  let select = call.queryStart.replace(/,\s*\|\|\s*' {3}P'/, ", process.doc_no2 || '   P'");
  if (lic === 14) select += `,aentry.INPUT_ADDRESS1 as "ADDRESS_1",aentry.INPUT_ADDRESS2 as "ADDRESS_2",aentry.INPUT_ADDRESS3 as "ADDRESS_3"`;
  if (lic === 21) {
    if (fc === 1) {
      select = select.replace("SYS.COL", `aentry.INPUT_ENT_REMARK as "Remark",prodled.BUNDLE AS "BOX",prodled.PACK_QTY AS "PACKING",prodled.LOOSE_QTY AS "LOOSE"`)
        .replace(`,process.STK_REMARK as "STK_REMARK"`, `,process.STK_REMARK as "STK_REMARK",process.EINV_IRNNO as "ENTRY_FROM"`);
    } else if (plastic) {
      select = select.replace("SYS.COL", `aentry.INPUT_PJOBCARD as "JOB_CARD_NO",to_char(aentry.INPUT_SCH_DATE,'DD/MM/YYYY') AS "DELIVERY_DATE",aentry.INPUT_REMARK AS "SPECIFICATION"`);
    } else select = select.replace("SYS.COL", `prodled.BUNDLE AS "BOX",prodled.PACK_QTY AS "PACKING",prodled.LOOSE_QTY AS "LOOSE"`);
    select = select.replace(/SYS\.SLAB_COL,?/, "");
  } else select = select.replace(/SYS\.COL,?/, "").replace(/SYS\.SLAB_COL,?/, "");
  if (despatch) select = `to_char(prodplan.ENT_DATE, 'DD-Mon-YY') as "selected_date",prodled.FULL_DOCNO,AC.NAME,product.PROD_DESC as "SELECTED_PRODUCT",prodled.FACTOR as "ORDER_QTY",coalesce(prodplan.plan_qty,0) as "DESPATCH_QTY"`;
  if (company.includes("ALCON") && fc === 1 && !despatch) {
    select = select.replace("prodled.QUANTITY,", `prodled.FACTOR as "QUANTITY",`)
      .replace(`case when prodled.quantity=prodled.setof_qty then 0 else prodled.AG_QTY-coalesce(prodled.setof_qty,0) end as "AG_QTY"`, `prodled.AG_FACT as "AG_QTY"`)
      .replace(`prodled.QUANTITY - prodled.AG_QTY as "BAL_QTY",`, `prodled.FACTOR - prodled.AG_FACT as "BAL_QTY",`);
  }
  // A column of an entry addon the joins do not give is joined on its own.
  if (/\baientry\./i.test(select) && !/\saientry\s/i.test(joins)) joins += itemEntry("aientry");
  if (/\baentry\./i.test(select) && !/\saentry\s/i.test(joins)) joins += lic === 14 ? voucherEntry("aentry") : itemEntry("aentry");
  const ticked = call.selectKey.slice(0, 4).map((keys, index) => (keys !== "" && call.addon[index].trim() !== "" ? call.addon[index].trim() : "")).filter(Boolean);
  const addonNames = ticked.map((column) => column.replace(/^\w+\.txt_/i, "").toUpperCase());
  if (ticked.length > 0 && !despatch) select += `,${ticked.map((column, index) => `${column} AS "${addonNames[index]}"`).join(",")}`;

  let where = await orderPendingWhere(loader, plan, jobOrder, true, false, despatch ? "prodplan.ENT_DATE" : "prodled.IL_DATE");
  if (despatch) where += " and prodplan.plan_qty>0";
  let orderBy = call.orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").trim();
  orderBy = `${orderBy !== "" ? `${orderBy},` : ""}${check("CHK_SORTDATE") ? (despatch ? "prodplan.ENT_DATE," : "prodled.IL_DATE,") : ""}process.doc_no2`;
  const table = tableFromResult(await runReportSql(loader, pgFragment(`SELECT ${select} ${orderPendingFrom(plan, joins)} ${where} ORDER BY ${orderBy}`, plan, session.companySchema)));
  for (const column of ["IL_KEY", "IL_SERIAL", "DOC_NO1", "PROD_ID", "TYPE", "CODE", "PROCESS_ID", "PROD_KEY", "RESERVE_UOM", "BOOK", "PROCESS_KEY", "SMART_AC_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE"]) { const name = table.name(column); if (name !== undefined) table.numberKinds.delete(name); }
  if (!pivot || despatch) return table;
  return withProductSlabs(loader, plan, table, slabs, ["SMART_LED_KEY", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_BOOK_CODE", "SMART_PRODUCT_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE", "SORTING_COL", "SORTING_DATE", "ROW_DATA_TYPE",
    "SYSTEM_BLANK2", "SMART_NAME", "SMART_SELECTED_BOOK", "SMART_SELECTED_PRODUCT", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "IL_KEY", "IL_SERIAL", "DOC_NO1", "PROD_ID",
    "IL_BILLDESC", "TYPE", "CODE", "AG_FACT", "PROCESS_ID", "PROD_KEY", "RESERVE_UOM", "ac_Code", "selected_date", "FULL_DOCNO", "NAME", "SELECTED_PRODUCT", ...(fc === 1 && plastic ? ["REMARK"] : []), "BOX", "PACKING", "LOOSE",
    "QUANTITY", "AG_QTY", "BAL_QTY", "SETOF_QTY", "CLOSE_REMARK", "RATE", "IL_VALUE", "book", "PROCESS_KEY", "STK_REMARK", ...(fc === 1 && plastic ? ["ENTRY_FROM"] : []), ...addonNames]);
}

/**
 * The book's product slabs as columns, the order reports' PIVOT (Order Pending's SALE and Order Register's PURCHASE of Rishabh Plastic, the
 * other side of Kanpur / Kaithal): each slab's amount and (a discount's) percentage on the line, NET_AMOUNT (the value less the discounts
 * before the first tax slab), TAX_DESCRIPTION / TAX_DESCRIPTION1 (the tax slabs' tax), in the procedure's column order and with its quirks
 * (a name already in the list, even inside another, is not added again); the line's columns are only those of the procedure's list `fixed`.
 */
async function withProductSlabs(loader: Loader, plan: ReportPlan, table: ResultTable, slabs: readonly ResultRow[], fixed: readonly string[]): Promise<ResultTable> {
  const db = plan.call.database;
  // The product slabs as columns (the procedure's PIVOT): the columns in its order, its quirks kept (a name already in the list,
  // even inside another, is not added again).
  const has = (list: string, name: string) => list.toUpperCase().includes(name.toUpperCase());
  const amountColumns: string[] = [];
  const percentColumns: string[] = [];
  const columns: string[] = [];
  const discounts: { short: string; less: boolean }[] = [];
  let totalText = "IL_VALUE";
  let heading1 = "";
  let disHeading = "";
  let taxSeen = false;
  let cgst = 0;
  let sgst = 0;
  for (const slab of slabs) {
    const short = toText(slab.short);
    const master = toText(slab.master) === "Y";
    if (!master && !taxSeen && !has(totalText, short)) { totalText += `|${short}`; discounts.push({ short, less: toText(slab.mathop) === "L" }); }
    if (disHeading === "") { disHeading = `[${short}_%]`; percentColumns.push(short); }
    else if (!master && !has(disHeading, short)) { disHeading += `,[${short}_%]`; percentColumns.push(short); }
    if (columns.length === 0) { heading1 = `[${short}]`; columns.push(short, `${short}_%`); amountColumns.push(short); continue; }
    if (master) {
      if (!taxSeen) { heading1 += ",[NET_AMOUNT],[TAX_DESCRIPTION]"; columns.push("NET_AMOUNT", "TAX_DESCRIPTION"); cgst = num(slab.key); }
      else if (!has(heading1, ",[TAX_DESCRIPTION1]")) { heading1 += ",[TAX_DESCRIPTION1]"; columns.push("TAX_DESCRIPTION1"); sgst = num(slab.key); }
      taxSeen = true;
    }
    if (!has(heading1, short)) heading1 += `,[${short}]`;
    if (!columns.some((column) => has(column, short))) { columns.push(short); amountColumns.push(short); if (!master) columns.push(`${short}_%`); }
  }
  const keys = table.rows.map((row) => num(table.get(row, "IL_KEY"))).filter((key) => key > 0);
  const extRows = keys.length === 0 ? [] : (await runReportSql(loader, `SELECT ledext.IL_ID AS il, btrim(slabmst.SLAB_SHORT) AS short, ledext.SLAB_ID AS slab, sum(coalesce(ledext.SLAB_PERC,0)) AS perc,`
    + ` sum(coalesce(ledext.SLAB_AMT::numeric,0)) AS amount, max(taxmst.tax_repohd) AS tax FROM ${db}LEDGER_EXT ledext join ${db}SLAB_MASTER slabmst on ledext.SLAB_ID = slabmst.SLAB_KEY left join ${db}TAX_MASTER taxmst on taxmst.tax_rec = ledext.tax_id`
    + ` WHERE ledext.IL_ID = ANY($1) AND ledext.SLAB_ID = ANY($2) GROUP BY ledext.IL_ID, slabmst.SLAB_SHORT, ledext.SLAB_ID`, [keys, slabs.map((slab) => num(slab.key))])).rows;
  const ext = new Map<number, ResultRow[]>();
  for (const row of extRows) ext.set(num(row.il), [...(ext.get(num(row.il)) ?? []), row]);

  // The procedure's column list, then the slab columns.
  const out = new ResultTable();
  const kept = fixed.map((name) => table.name(name)).filter((name): name is string => name !== undefined);
  for (const name of kept) { out.addColumn(name); const kind = table.kind(name); if (kind !== "text") out.setKind(name, kind); }
  for (const column of columns) { if (column === "TAX_DESCRIPTION" || column === "TAX_DESCRIPTION1") out.addColumn(column); else out.setKind(column, "decimal"); }
  const round2 = (value: number) => Math.round(value * 100) / 100;
  for (const row of table.rows) {
    const values: Record<string, unknown> = {};
    for (const name of kept) values[name] = table.get(row, name);
    const lines = ext.get(num(table.get(row, "IL_KEY"))) ?? [];
    const amountOf = (short: string) => lines.filter((line) => toText(line.short).toUpperCase() === short.toUpperCase()).reduce((sum, line) => sum + num(line.amount), 0);
    const lineAmounts = (short: string) => lines.some((line) => toText(line.short).toUpperCase() === short.toUpperCase());
    for (const short of amountColumns) values[short] = lineAmounts(short) ? amountOf(short) : null;
    for (const short of percentColumns) {
      const found = lines.filter((line) => toText(line.short).toUpperCase() === short.toUpperCase());
      values[`${short}_%`] = found.length > 0 ? found.reduce((sum, line) => sum + num(line.perc), 0) : null;
    }
    if (taxSeen) {
      values.NET_AMOUNT = round2(num(table.get(row, "IL_VALUE")) + discounts.reduce((sum, discount) => sum + (discount.less ? -Math.abs(round2(amountOf(discount.short))) : round2(amountOf(discount.short))), 0));
      values.TAX_DESCRIPTION = toText(lines.find((line) => num(line.slab) === cgst)?.tax) || null;
      values.TAX_DESCRIPTION1 = toText(lines.find((line) => num(line.slab) === sgst)?.tax) || null;
    }
    out.insert(values);
  }
  return out;
}

async function orderPending(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const company = db.toUpperCase();
  const kanpur = company.includes("RISHABH_KANPUR") || company.includes("RISHABH_KAITHAL");
  const plastic = company.includes("RISHABH_PLASTIC");
  const fc = call.fcValue;
  const lic = call.licence;
  const jobOrder = check("CHK_JOBORD");
  if (fc === 2 && lic === 71) throw new ReportRefusal("Licence 71's SALE layout of the Order Pending is not available in the web version yet.", "Not ported yet");
  const slabSide = (fc === 2 && lic === 21 && plastic) || (fc === 1 && kanpur);
  const slabs = !slabSide ? [] : (await runReportSql(loader, `SELECT SLAB_KEY AS key, btrim(SLAB_SHORT) AS short, btrim(coalesce(SLAB_MASTER,'')) AS master, btrim(coalesce(SLAB_MATHOP,'')) AS mathop FROM ${db}SLAB_MASTER`
    + ` WHERE SLAB_POS = 'P' AND SLAB_ACTIVE = 'Y' and BOOK = $1 ORDER BY BOOK, SLAB_ORDER`, [call.book])).rows;
  const pivot = slabs.length > 0;

  // The entry addon joins at sys.aent.bend (aentry / aientry), as the procedure.
  const godown = call.addon.some((text) => text.toUpperCase().includes("GODOWN"));
  const itemEntry = (alias: string) => ` left join ${db}ADDON_IENTRY ${alias} on ${alias}.AONI_IL_ID=prodled.IL_KEY`;
  const voucherEntry = (alias: string) => ` left join ${db}ADDON_AENTRY ${alias} on ${alias}.AONA_PROCESSID=prodled.PROCESS_ID`;
  let joins = "";
  if (godown || lic === 21) joins = pivot && lic === 21 && fc === 2 ? itemEntry("aientry") + voucherEntry("aentry") : itemEntry("aentry");
  else if (call.acAddonRepdefa.includes("E")) joins = lic === 14 ? voucherEntry("aentry") : voucherEntry("aientry");
  else if (call.prodAddonRepdefa.includes("E")) joins = lic === 14 ? itemEntry("aientry") + voucherEntry("aentry") : itemEntry("aientry");

  // The setup's SYS.COL places.
  let select = call.queryStart.replace(/,\s*\|\|\s*' {3}P'/, ", process.doc_no2 || '   P'");
  if (lic === 21 && !jobOrder) {
    if (fc === 2 || kanpur) {
      select = select.replace("SYS.COL", kanpur ? `prodled.BUNDLE AS "BOX",prodled.PACK_QTY AS "PACKING",prodled.LOOSE_QTY AS "LOOSE"` : `aientry.INPUT_ENT_REMARK as "Remark",prodled.BUNDLE AS "BOX",prodled.PACK_QTY AS "PACKING",prodled.LOOSE_QTY AS "LOOSE"`)
        .replace("SYS.BOXCOL1", `coalesce(prodled.BUNDLE,0)-coalesce(prodled.AG_PACK,0) AS "PEND_BOX"`).replace("prodled.AG_QTY,", "").replace(/SYS\.SLAB_COL,?/, "");
    } else {
      select = select.replace("SYS.COL", `aentry.INPUT_PJOBCARD as "JOB_CARD_NO",to_char(aentry.INPUT_SCH_DATE,'DD/MM/YYYY') AS "DELIVERY_DATE",aentry.INPUT_REMARK AS "SPECIFICATION"`)
        .replace(/SYS\.BOXCOL1,?/, "").replace(/SYS\.SLAB_COL,?/, "");
    }
  } else select = select.replace(/SYS\.COL,?/, "").replace(/SYS\.BOXCOL1,?/, "").replace(/SYS\.SLAB_COL,?/, "");
  if (company.includes("ALCON") && fc === 2) {
    select = select.replace("prodled.QUANTITY,", `prodled.FACTOR as "QUANTITY",`).replace("prodled.AG_QTY,", `prodled.AG_FACT as "AG_QTY",`)
      .replace(`prodled.QUANTITY - prodled.AG_QTY as "BAL_QTY",`, `prodled.FACTOR - prodled.AG_FACT as "BAL_QTY",`).replace(`prodbal.CLSG_PCS as "Stock"`, `prodbal.CLSG_PACK as "Stock"`);
  }
  // A column of an entry addon the joins do not give (aientry with no item entry join) is joined on its own.
  if (/\baientry\./i.test(select) && !/\saientry\s/i.test(joins)) joins += itemEntry("aientry");
  if (/\baentry\./i.test(select) && !/\saentry\s/i.test(joins)) joins += itemEntry("aentry");
  const ticked = call.selectKey.slice(0, 4).map((keys, index) => (keys !== "" && call.addon[index].trim() !== "" ? call.addon[index].trim() : "")).filter(Boolean);
  const addonNames = ticked.map((column) => column.replace(/^\w+\.txt_/i, "").toUpperCase());
  if (ticked.length > 0) select += `,${ticked.map((column, index) => `${column} AS "${addonNames[index]}"`).join(",")}`;

  const where = await orderPendingWhere(loader, plan, jobOrder, true);
  let orderBy = call.orderBy.replace(/^\s*ORDER\s+(BY\s+)?/i, "").trim();
  orderBy = `${orderBy !== "" ? `${orderBy},` : ""}${check("CHK_SORTDATE") ? "prodled.IL_DATE," : ""}process.doc_no2`;
  const table = tableFromResult(await runReportSql(loader, pgFragment(`SELECT ${select} ${orderPendingFrom(plan, joins)} ${where} ORDER BY ${orderBy}`, plan, session.companySchema)));
  for (const column of ["IL_KEY", "IL_SERIAL", "DOC_NO1", "PROD_ID", "TYPE", "CODE", "PROCESS_ID", "PROD_KEY", "RESERVE_UOM", "BOOK", "PROCESS_KEY", "SMART_AC_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE"]) { const name = table.name(column); if (name !== undefined) table.numberKinds.delete(name); }

  // The stock spread over the product's pending lines (rows with stock, by product, in the report's order).
  if (table.has("STOCK") && table.has("SELECTED_PRODUCT") && table.has("BAL_QTY")) {
    const withStock = table.rows.filter((row) => num(table.get(row, "STOCK")) > 0);
    const byProduct = [...withStock].sort((a, b) => sqlServerCompare(toText(table.get(a, "SELECTED_PRODUCT")), toText(table.get(b, "SELECTED_PRODUCT"))));
    let product: string | null = null;
    let actual = 0;
    let serial = 0;
    for (const row of byProduct) {
      const pending = num(table.get(row, "BAL_QTY"));
      const stock = num(table.get(row, "STOCK"));
      const name = toText(table.get(row, "SELECTED_PRODUCT"));
      if (name !== product) { actual = stock > pending ? stock - pending : stock; product = name; serial = 1; }
      const balance = pending > actual ? 0 : actual - pending;
      if (serial > 1 && balance >= 0) { table.set(row, "STOCK", Math.round(balance * 10000) / 10000); actual -= pending; }
      else if (serial === 1 && actual > 0) table.set(row, "STOCK", Math.round(actual * 10000) / 10000);
      serial += 1;
    }
  }
  if (!pivot) return table;

  return withProductSlabs(loader, plan, table, slabs, ["SMART_LED_KEY", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_BOOK_CODE", "SMART_PRODUCT_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE", "SORTING_COL", "SORTING_DATE", "ROW_DATA_TYPE",
    "SYSTEM_BLANK2", "SMART_NAME", "SMART_SELECTED_BOOK", "SMART_SELECTED_PRODUCT", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "IL_KEY", "IL_SERIAL", "DOC_NO1", "PROD_ID",
    "IL_BILLDESC", "TYPE", "CODE", "AG_FACT", "PROCESS_ID", "PROD_KEY", "RESERVE_UOM", "ac_Code", "selected_date", "FULL_DOCNO", "NAME", "SELECTED_PRODUCT", ...(fc === 2 && plastic ? ["REMARK"] : []), "BOX", "PACKING", "LOOSE",
    "QUANTITY", "PEND_BOX", "BAL_QTY", "STOCK", "RATE", "IL_VALUE", "book", "PROCESS_KEY", "STK_REMARK", ...addonNames]);
}

// ======================================================================================
// 25: MARKETING ANALYSIS, No Formating (SP_STD_RPT_MKTANALYS)
// ======================================================================================
//
// ANALYSIS REP. > Marketing with no format: the book's product lines of the period (date, voucher, party, product, quantity less what was
// set against, rate, value), books 16 / 11 and the inward sale / outward purchase lines negative. Free Include keeps the lines with no rate
// and the process lines; Return Include adds the book's notes (SALE: credit notes 16, PURCHASE: debit notes 11; licence 7 / 22: both).
// Slab Add-Less, where the book has product slabs this year: each slab's percentage and amount as columns and the value taken with every
// slab, discounts less and the GST slabs added (as the procedure's UPDATE). Licence 1 also has AMOUNT, batch no. and expiry date.
// Groups As Heading: the procedure inserts heading rows into its temp table and orders it on SORTING_COL; here the lines are sorted the same
// way and a heading goes in where each group starts: the addons (outermost first), then the party, or the product when Product Code is
// ticked; the lines then show the product in the name column (the party is the heading). Without it, the addon columns are added (not one
// already there as SELECTED_<addon>(S)) and the lines run by addon, then by party or product, then date (the procedure ran them by date
// first with no addon, which broke a party's subtotal at each date). With only an addon group the procedure put the party headings ahead
// of their lines' dates (the lines ran by date); here each party's lines follow its heading.

async function marketingAnalysis(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const lic = call.licence;
  const book = call.book;
  if (!Number.isInteger(book) || book < 0) throw new ReportRefusal("Choose a book from its list", "Report Generation Failed");
  const returns = check("CHK_RETURN_INCLUDE");
  const productWise = (await runReportSql(loader, `SELECT 1 FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = $1 AND SLAB_ACTIVE = 'Y' and BOOK = $2 LIMIT 1`, [call.tarikh1, book])).rows.length > 0;
  const hideBook = ![19, 29, 73].includes(lic) || (await runReportSql(loader, `SELECT 1 FROM ${db}ACCOUNT WHERE A_POS <> 'D' and position('CA_ENT' in A_SHORT) > 0 LIMIT 1`)).rows.length > 0;
  const addonCount = call.addon.filter((text, index) => text.trim() !== "" && call.selectKey[index] !== "").length;

  // The select: the heading addons as columns (no headings), licence 1's AMOUNT, the slab columns.
  let select = call.queryStart;
  // (Not one the setup already selects as SELECTED_<addon>(S): the grid showed the same column twice.)
  if (!call.groupsAsHeadings) {
    const selected = (text: string) => select.toLowerCase().includes(`${text.trim().split(/\s+as\s+/i)[0].toLowerCase()} as "selected_`);
    select += call.headingAddon.filter((text) => text.trim() !== "" && !selected(text)).map((text) => `,${text.trim()}`).join("");
  }
  const negative = (expr: string) => `(case when prodled.book=16 then (${expr}) *-1 when prodled.book=11 then (${expr}) *-1 when prodled.book=8 and prodled.stock_nat='A' then (${expr}) *-1 when prodled.book=13 and prodled.stock_nat='L' then (${expr}) *-1 else (${expr}) end)`;
  select = select.replace("sys.col.totalamt,", lic === 1 ? `${negative("PRODLED.IL_VALUE")} AS "AMOUNT",` : "");
  const slabs = check("CHK_SLABADDLESS") && productWise
    ? (await runReportSql(loader, `SELECT SLAB_KEY AS key, btrim(SLAB_SHORT) AS short, btrim(coalesce(SLAB_MATHOP,'')) AS mathop FROM ${db}SLAB_MASTER WHERE SLAB_POS = 'P' and SLAB_FROMDT = $1 AND SLAB_ACTIVE = 'Y' and BOOK = $2 ORDER BY SLAB_ORDER`, [call.tarikh1, book])).rows
    : [];
  // Each slab's percentage and amount on the line, from one grouped LEDGER_EXT (the procedure's subquery a slab a line).
  const slabColumns: string[] = [];
  const slabParts: string[] = [];
  const slabValue: { short: string; add: boolean }[] = [];
  const seen = new Set<string>();
  for (const slab of slabs) {
    const key = Math.trunc(num(slab.key));
    const short = toText(slab.short).replace(/"/g, "");
    if (short === "" || seen.has(short.toUpperCase())) continue;
    seen.add(short.toUpperCase());
    const amount = `lx.amt_${key}`;
    slabColumns.push(`lx.perc_${key} AS "${short}_%"`, `COALESCE(${returns ? `case when prodled.book in (16,11) then ${amount} *-1 else ${amount} end` : amount},0.00) AS "${short}"`);
    slabParts.push(`max(case when SLAB_ID = ${key} then SLAB_PERC end) AS perc_${key}, sum(case when SLAB_ID = ${key} then SLAB_AMT::numeric end) AS amt_${key}`);
    slabValue.push({ short, add: toText(slab.mathop) === "A" });
  }
  select = slabColumns.length > 0 ? select.replace("sys.col.slabrate", slabColumns.join(",")) : select.replace(/sys\.col\.slabrate,?/, "");
  const slabJoin = slabParts.length === 0 ? ""
    : ` LEFT JOIN (SELECT IL_ID, ${slabParts.join(", ")} FROM ${db}LEDGER_EXT WHERE SLAB_ID IN (${slabs.map((slab) => Math.trunc(num(slab.key))).join(",")}) GROUP BY IL_ID) lx ON lx.IL_ID = PRODLED.IL_KEY`;
  // The item entry addon (a product entry addon group, licence 1's batch), or the voucher's.
  const itemEntry = call.prodAddonRepdefa.includes("E") || lic === 1;
  const entryJoin = /ADDON_IENTRY/i.test(call.from_) ? ""
    : itemEntry ? ` left join ${db}ADDON_IENTRY aentry on aentry.AONI_IL_ID = PRODLED.IL_KEY`
    : call.acAddonRepdefa.includes("E") ? ` left join ${db}ADDON_AENTRY aentry on aentry.AONA_LEDID = PRODLED.LED_ID` : "";
  if (lic === 1) select += `,aentry.INPUT_BATCH_NO as "BATCH_NO",to_char(aentry.input_EXPIRY_DATE,'DD/MM/YYYY') as "EXP_DATE"`;
  const from = call.from_.replace("sys.aent.bstart", "").replace("sys.ledext.bstart", "").replace("|sys.sp.aentry|", entryJoin).replace(/sys\.ledext\.join\s*sys\.ledext\.bend/, "") + slabJoin;

  // The where: the period, the lines with a rate, the book (and its notes), no stock adjustment lines.
  let where = call.where.trim().toLowerCase() === "where" ? " where 1=1" : call.where;
  where += ` AND PRODLED.IL_DATE >= '${desktopDate(call.from)}' AND PRODLED.IL_DATE <= '${desktopDate(call.upto)}'`;
  if (!check("CHK_FREE_INCLUDE")) where += " AND PRODLED.RATE > 0 and PRODLED.PROCESS_ID is null";
  const processNull = [7, 19, 22].includes(lic) ? "" : " and PRODLED.PROCESS_ID is null";
  if (!returns) where += ` AND PRODLED.BOOK <> 11 and PRODLED.BOOK <> 16 AND PRODLED.BOOK=${book}${processNull}`;
  else if (lic === 7 || lic === 22) where += ` AND (PRODLED.BOOK = 11 or PRODLED.BOOK = 16 or PRODLED.BOOK=${book})`;
  else where += ` AND (PRODLED.BOOK = ${book === 8 ? 16 : 11} or PRODLED.BOOK=${book})${processNull}`;
  where += " and ((prodled.trn_stkmid<>'SA' and prodled.trn_stkmid<>'SL') or btrim(coalesce(prodled.trn_stkmid,''))='')";
  if (!hideBook) where += ` and (prodled.book_code in (select code from ${db}ACCOUNT where a_pos='A') or prodled.book_code is null)`;

  const table = tableFromResult(await runReportSqlHashed(loader, pgFragment(`SELECT ${select} ${from} ${where}`, plan, session.companySchema)));
  for (const column of ["SMART_LED_KEY", "SMART_AC_CODE", "SMART_BOOK_CODE", "IL_KEY", "BOOK", "PROCESS_KEY", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE"]) { const name = table.name(column); if (name !== undefined) table.numberKinds.delete(name); }
  // The value with the slabs (the procedure's UPDATE value = value + / - each slab).
  if (slabValue.length > 0) {
    for (const row of table.rows) table.set(row, "VALUE", money(num(table.get(row, "VALUE")) + slabValue.reduce((sum, slab) => sum + (slab.add ? 1 : -1) * num(table.get(row, slab.short)), 0)));
  }

  const productGroup = /product/i.test(call.orderBy);
  const accountOrder = /ac\.name/i.test(call.orderBy);
  const text = (row: ResultRow, column: string) => textKey(table.get(row, column));
  const addonKeys = Array.from({ length: addonCount }, (_, at) => (row: ResultRow) => text(row, `SMART_SELECTED_ADDON${at + 1}`));
  const sortingCol = (row: ResultRow) => text(row, "SORTING_COL");
  const sortingDate = (row: ResultRow) => text(row, "SORTING_DATE");
  // No headings: by the addons, then the group (the procedure ran the lines by date first, so a party's subtotal broke at each of its dates).
  if (!call.groupsAsHeadings) {
    sortRows(table, addonCount > 0 ? [...addonKeys, ...(productGroup || accountOrder ? [sortingCol] : []), sortingDate] : [sortingCol, sortingDate]);
    return table;
  }

  // Groups as headings: a line shows its product (the party is its heading) unless Product Code is ticked.
  const nameColumn = table.name("NAME");
  const party = new Map<ResultRow, string>();
  for (const row of table.rows) {
    party.set(row, toText(nameColumn ? table.get(row, nameColumn) : table.get(row, "SMART_NAME")));
    if (!productGroup && nameColumn) table.set(row, nameColumn, table.get(row, "PROD_DESC"));
  }
  dropColumn(table, "PROD_DESC");
  const inner = productGroup ? (row: ResultRow) => text(row, "SMART_SCHEDULE_CODE") : (row: ResultRow) => `${party.get(row) ?? ""}${toText(table.get(row, "SMART_AC_CODE"))}`;
  sortRows(table, [...addonKeys, inner, sortingCol, sortingDate]);
  const lines = table.rows;
  table.rows = [];
  let previous: ResultRow | undefined;
  const addonsOf = (row: ResultRow, upto: number): Record<string, unknown> => {
    const values: Record<string, unknown> = {};
    for (let at = 1; at <= upto; at += 1) { values[`SMART_SELECTED_ADDON${at}`] = table.get(row, `SMART_SELECTED_ADDON${at}`); values[`ADDON_${at}_CODE`] = table.get(row, `ADDON_${at}_CODE`); }
    return values;
  };
  for (const row of lines) {
    const last = previous;
    let changed = last === undefined ? 0 : addonKeys.findIndex((key) => key(last) !== key(row));
    if (changed < 0) changed = addonCount;
    for (let level = changed; level < addonCount; level += 1) {
      const name = toText(table.get(row, `SMART_SELECTED_ADDON${level + 1}`));
      if (name.trim() === "") continue;
      table.insert({ ...addonsOf(row, level + 1), NAME: name, ROW_DATA_TYPE: `ADDON_${level + 1}`, SORTING_COL: `${name.trimStart()}   H` });
    }
    if (last === undefined || changed < addonCount || inner(last) !== inner(row)) {
      if (productGroup) {
        const product = toText(table.get(row, "SMART_SELECTED_PRODUCT"));
        const code = toText(table.get(row, "SMART_SCHEDULE_CODE"));
        // Its party is its first line's (the procedure's blank one gave a "Subtotal For :" of nothing under each product heading).
        if (product.trim() !== "") {
          table.insert({ ...addonsOf(row, addonCount), NAME: product, SMART_SCHEDULE_CODE: code, SMART_SELECTED_PRODUCT: product, SMART_NAME: table.get(row, "SMART_NAME"), ROW_DATA_TYPE: "AC", SORTING_COL: `${code.trimStart()}   H` });
        }
      } else {
        const name = party.get(row) ?? "";
        const code = toText(table.get(row, "SMART_AC_CODE"));
        if (name.trim() !== "") table.insert({ ...addonsOf(row, addonCount), NAME: name, SMART_AC_CODE: table.get(row, "SMART_AC_CODE"), SMART_NAME: name, ROW_DATA_TYPE: "AC", SORTING_COL: `${name.trimStart()}${code}   H` });
      }
    }
    table.rows.push(row);
    previous = row;
  }
  return table;
}

// ======================================================================================
// 27: GP REPORT (ANALYSIS REP. > GP Report, REPORT_PROFIT_REPORT; SP_REPORT_STANDARD branch 27)
// ======================================================================================
//
// The gross profit of each sale line, matched first in first out against the product's stock: the opening at From first
// (PURCH_NO "OPENING"), then the stock-in lines of the period (any book, STOCK_NAT 'A'). A sale line takes from as many
// stock lines as its quantity needs; each piece is a row: the sale (date, voucher, party, the quantity matched, rate, value)
// against the stock line (date, voucher, its whole quantity, rate, the matched quantity's value), the profit and the profit
// percentage on the cost. Once a product's stock is used up its remaining sales are left out. Detail lists the rows in
// product and stock date order; Summary a row a product, sale rate and purchase rate.
//
// Options: Slab Add-Less Include (CHK_SLABADDLESS): where the year's product-wise slabs of the sale (8) or purchase (13) book
// start at the year's first day, a line's value is less those slabs and its rate the value over the quantity.
// When From is not the year's first day the opening is the year's plus the stock's movement before From, valued at the
// purchases (book 13) before Upto, latest first, and what they do not cover at the year's opening rate.
//
// The matching itself is in gp.ts. As the procedure: only the products with a balance row (PROD_BALANCE, 'RP') for the year come in; the cursors take the sales,
// stock lines and purchases in the order of their dd-Mon-yy text (not of the date), and a stock line's PURCH_QTY is its whole
// quantity. Licence 2 counts TRN_QTY1 and the year's OPEN_QTY1; licence 5 names the product by its group (TXT_PRODGROUP) and
// values an opening at From = year start at TOLL_PERC plus 18%. The desktop builds TEMP_TABLE_PROFIT_<machine> with an INSERT a
// row; here the rows are made in memory from read-only queries.

async function gpReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const round2 = (value: number): number => decimalRound(value, 2);
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const day = (date: Date) => `'${desktopDate(date)}'`;
  const licence = call.licence;
  const qty = (alias: string) => (licence === 2 ? `coalesce(${alias}.trn_qty1::numeric,0)` : `(${alias}.quantity::numeric-${alias}.ag_qty::numeric)`);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const fromYearStart = sameDay(call.from, call.tarikh1);

  // The ticked products (@var_select_key5) and addon subs (@var_select_key1-4 on @var_addon1-4, read by key).
  const keyFilters = (productColumn: string) => [
    call.selectKey[4] !== "" ? ` and ${productColumn} in ${call.selectKey[4]}` : "",
    ...[0, 1, 2, 3].map((slot) => (call.selectKey[slot] !== "" && call.addon[slot] !== "" ? ` and ${call.addon[slot].replace(" adata.txt_", " adata.key_")} in ${call.selectKey[slot]}` : "")),
  ].join("");

  // Slab Add-Less: the book's product-wise slabs from the year's first day, taken off each line's value.
  const slabLess = async (book: number, alias: string): Promise<string> => {
    if (!call.checkQuery.includes("CHK_SLABADDLESS,")) return "";
    const slabs = (await runReportSql(loader, `SELECT slab_key FROM ${db}SLAB_MASTER WHERE slab_pos = 'P' AND slab_fromdt = ${day(call.tarikh1)} AND slab_active = 'Y' AND slab_master = 'N' AND book = ${book} ORDER BY slab_order`)).rows;
    return slabs.map((slab) => `-coalesce((select sum(le.slab_amt::numeric) from ${db}LEDGER_EXT le where le.il_id = ${alias}.il_key and le.slab_id = ${Math.trunc(num(slab.slab_key))}),0)`).join("");
  };
  const saleSlabs = await slabLess(8, "tcp1");
  const stockSlabs = await slabLess(13, "proled");

  // TEMP_TABLE_PROD_OPENING: the products with their opening (at From) and opening rate.
  const desc = licence === 5 ? "adata.txt_prodgroup" : "prodmas.prod_desc";
  const yearOpening = licence === 2 ? "prodbal.open_qty1" : "prodbal.open_pcs";
  const movedBefore = `coalesce((select sum(case when prodled.stock_nat='A' then ${qty("prodled")} else ${qty("prodled")}*-1 end) from ${db}PROD_LEDGER prodled where prodled.prod_id=prodmas.prod_key and prodled.inventory='Y' and prodled.il_pos='A' and prodled.process_id is null and prodled.il_date < ${day(call.from)}),0)`;
  const openingRate = licence === 5 && fromYearStart ? "round(prodmas.toll_perc::numeric+(prodmas.toll_perc::numeric*.18),2)" : "prodbal.open_rate::numeric";
  const openingRows = (await runReportSql(loader, frag(`SELECT prodmas.prod_key AS "PROD_KEY",${desc} AS "PROD_DESC",coalesce(${yearOpening}::numeric,0)${fromYearStart ? "" : `+${movedBefore}`} AS "PROD_OPENING",coalesce(${openingRate},0) AS "PROD_RATE"`
    + ` FROM ${db}PRODUCT_MASTER prodmas left join ${db}PROD_BALANCE prodbal on prodbal.prod_id=prodmas.prod_key left join ${db}ADDON_DATA adata on adata.prod_id=prodmas.prod_key`
    + ` WHERE prodmas.inventory = 'Y' and prodbal.year_id = '${call.yearId}' and prodbal.prec_flag = 'RP'${keyFilters("prodmas.prod_key")}`
    + ` GROUP BY prodmas.prod_key,${desc},${yearOpening},prodbal.open_rate${licence === 5 ? ",prodmas.toll_perc" : ""} ORDER BY prodmas.prod_key`))).rows;
  const products: GpProduct[] = openingRows.map((row) => ({ key: Number(row.PROD_KEY), desc: toText(row.PROD_DESC), opening: round2(num(row.PROD_OPENING)), rate: round2(num(row.PROD_RATE)) }));

  // From after the year's start: the opening valued at the purchases before Upto (TEMP_TABLE_PRODBET_OPENING).
  if (!fromYearStart && products.length > 0) {
    const bought = (await runReportSql(loader, frag(`SELECT prodled.prod_id AS "PROD_KEY",prodled.il_date AS "IL_DATE",coalesce(${qty("prodled")},0) AS "QTY",prodled.il_value::numeric AS "VALUE"`
      + ` FROM ${db}PROD_LEDGER prodled left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key=prodled.prod_id left join ${db}ADDON_DATA adata on adata.prod_id=prodmas.prod_key`
      + ` WHERE prodmas.inventory = 'Y' and prodled.inventory = 'Y' and prodled.il_pos = 'A' and prodled.stock_nat = 'A' and prodled.book = 13 and prodled.process_id is null and prodled.il_date < ${day(call.upto)}${keyFilters("prodmas.prod_key")}`
      + ` ORDER BY prodled.prod_id,prodled.il_date desc,prodled.il_key desc`))).rows;
    const boughtOf = new Map<number, { date: Date; qty: number; value: number }[]>();
    for (const row of bought) boughtOf.set(Number(row.PROD_KEY), [...(boughtOf.get(Number(row.PROD_KEY)) ?? []), { date: new Date(row.IL_DATE as string), qty: num(row.QTY), value: num(row.VALUE) }]);
    for (const product of products) product.rate = round2(gpOpeningValue(product.opening, product.rate, boughtOf.get(product.key) ?? []).rate);
  }

  // A line's rate: with Slab Add-Less its value (less the slabs) over its quantity.
  const lineRate = (row: Readonly<Record<string, unknown>>, slabs: string) => {
    const value = round2(num(row.VALUE));
    const lineQty = round2(num(row.QTY));
    return slabs !== "" && value > 0 && lineQty !== 0 ? round2(value / lineQty) : round2(num(row.RATE));
  };

  // TEMP_TABLE_PROD_PURCHASE: the stock-in lines of the period.
  const stockRows = (await runReportSql(loader, frag(`SELECT proled.prod_id AS "PROD_ID",proled.il_date AS "IL_DATE",proled.full_docno AS "NO",${qty("proled")} AS "QTY",proled.rate::numeric AS "RATE",proled.il_value::numeric${stockSlabs} AS "VALUE"`
    + ` FROM ${db}PROD_LEDGER proled left join ${db}ADDON_DATA adata on adata.prod_id=proled.prod_id`
    + ` WHERE proled.stock_nat = 'A' and proled.inventory = 'Y' and proled.il_pos = 'A' and proled.quantity::numeric-proled.ag_qty::numeric > 0 and proled.code > 0 and proled.process_id is null`
    + ` and proled.il_date between ${day(call.from)} and ${day(call.upto)} and proled.rate::numeric > 1${keyFilters("proled.prod_id")} ORDER BY proled.prod_id,proled.il_date,proled.il_key`))).rows;
  const stock: GpStock[] = stockRows.map((row) => ({ product: Number(row.PROD_ID), date: new Date(row.IL_DATE as string), no: toText(row.NO), qty: round2(num(row.QTY)), rate: lineRate(row, stockSlabs) }));

  // TEMP_TABLE_PROD_SALE: the sale lines of the period, of the ticked products / addons (@var_union_select_list).
  const saleRows = (await runReportSql(loader, frag(`SELECT ac.name AS "NAME",ac.code AS "CODE",tcp1.prod_id AS "PROD_ID",tcp1.il_date AS "IL_DATE",tcp1.full_docno AS "NO",${qty("tcp1")} AS "QTY",tcp1.rate::numeric AS "RATE",tcp1.il_value::numeric${saleSlabs} AS "VALUE"`
    + ` FROM ${db}PROD_LEDGER tcp1 left join ${db}ACCOUNT ac on ac.code=tcp1.code left join ${db}ADDON_DATA adata on adata.prod_id=tcp1.prod_id`
    + ` WHERE tcp1.stock_nat = 'L' and tcp1.inventory = 'Y' and tcp1.il_pos = 'A' and ac.a_pos <> 'D' and tcp1.quantity::numeric-tcp1.ag_qty::numeric > 0 and tcp1.process_id is null`
    + ` and tcp1.il_date between ${day(call.from)} and ${day(call.upto)} and tcp1.rate::numeric > 1${call.unionQuery.trim() !== "" ? ` and ${call.unionQuery}` : ""}`
    + `${call.selectKey[4] !== "" ? ` and tcp1.prod_id in ${call.selectKey[4]}` : ""} ORDER BY tcp1.prod_id,tcp1.il_date,tcp1.il_key`))).rows;
  const sales: GpSale[] = saleRows.map((row) => ({ product: Number(row.PROD_ID), code: num(row.CODE), name: toText(row.NAME), date: new Date(row.IL_DATE as string), no: toText(row.NO), qty: round2(num(row.QTY)), rate: lineRate(row, saleSlabs) }));

  const matched = matchGp(products, stock, sales, call.from);
  const table = new ResultTable();
  if (call.sortingText.trim().toLowerCase() === "detail") {
    for (const column of ["PROD_ID", "CODE", "NAME", "DESCRIPTION", "SALE_DATE", "SALE_NO", "SALE_QTY", "SALE_RATE", "SALE_VALUE", "PURCH_DATE", "PURCH_NO", "PURCH_QTY", "PURCH_RATE", "PURCH_VALUE", "PROFIT_PERC", "PROFIT_AMOUNT", "SMART_SELECTED_PRODUCT", "SMART_NAME"]) table.addColumn(column);
    table.setKind("PROD_ID", "int");
    table.setKind("CODE", "int");
    for (const column of ["SALE_QTY", "SALE_RATE", "SALE_VALUE", "PURCH_QTY", "PURCH_RATE", "PURCH_VALUE", "PROFIT_PERC", "PROFIT_AMOUNT"]) table.setKind(column, "decimal");
    // order by sorting_col (the product, then the stock line's date); the sorting key itself is no column of the output.
    table.rows = matched.map((row, index) => ({ row, index, key: row.SORTING_COL.toUpperCase() }))
      .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? -1 : 1))
      .map(({ row }) => { const line: Record<string, unknown> = { ...row }; delete line.SORTING_COL; return line; });
    return table;
  }
  for (const column of ["NAME", "SALE_RATE", "SALE_QTY", "SALE_VALUE", "PURCH_RATE", "PURCH_VALUE", "PROFIT_AMT", "PROFIT_PERC"]) table.addColumn(column);
  for (const column of ["SALE_RATE", "SALE_QTY", "SALE_VALUE", "PURCH_RATE", "PURCH_VALUE", "PROFIT_AMT", "PROFIT_PERC"]) table.setKind(column, "decimal");
  table.rows = summariseGp(matched);
  return table;
}

// ======================================================================================
// 35: FUNCTIONAL PARTY PRODUCT (ANALYSIS REP. > Functional Party Product, REPORT_NON_FUNCTION; report 35)
// ======================================================================================
//
// Which parties (first combo ACCOUNT) or products (PRODUCT) did something in the period and which did not. The parties are the
// debtors (Sorting Sale, book 2) or the creditors (Purchase, book 3); a party "functioned" when it has a voucher of the year in
// the dates (licence 7: a process entry), a product when it has a stock line of the year in the dates. Formats:
//  - Functional: the ones that functioned, with their closing (the account's closing; the product's closing pieces, licence 2
//    CLSG_QTY3).
//  - None Functional: the ones that did not and have no opening (a product: no closing pieces, unless With Closing Require).
//  - Only Opening Within Period: the ones that did not but have an opening (OPENING).
// A party shows its mobile number (address 1). The ticked addon groups (the where) narrow the list, come as columns and set the
// order, then the name. The desktop builds TEMP_TABLE_NON_FUNCTION1_<machine> (the ones that functioned) and reads the rest
// against it; here that list is a sub-query of the one read-only query.

export async function nonFunction(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const order = call.orderBy.replace(/\s+/g, "");
  if (order.toLowerCase() === "product.prod_desc,ac.name" || order.toLowerCase() === "ac.name,product.prod_desc") {
    throw new ReportRefusal("ACCOUNT AND PRODUCT BOTH ARE NOT ALLOWED PLEASE SELECT ANY ONE", "ERROR_DETAILS");
  }
  const format = call.formating.toUpperCase();
  const from = `'${desktopDate(call.from)}'`;
  const upto = `'${desktopDate(call.upto)}'`;
  const year = `'${call.yearId}'`;
  // The ticked addon groups: their columns (@var_heading_addon1-4) and order (@var_addon1-4).
  const headings = call.headingAddon.filter((heading) => heading.trim() !== "").map((heading) => `,${heading.trim()}`).join("");
  const addonOrder = call.addon.filter((addon) => addon.trim() !== "").map((addon) => `${addon.trim()},`).join("");
  // @var_CS_Where: " where <addon keys>", or nothing when no group narrows it.
  const where = call.where.trim().toLowerCase() === "where" ? "" : call.where;
  const and = (condition: string) => `${where === "" ? " where " : `${where} and `}${condition}`;

  let sql: string;
  if (call.fcValue === 1) {
    const book = call.sortingText.trim() === "Sale" ? 2 : 3;
    const moved = call.licence === 7
      ? `select led.code from ${db}process led where led.year_id=${year} and led.p_date >= ${from} and led.p_date <= ${upto} and led.il_pos='A'`
      : `select led.code from ${db}ledger led where led.year_id=${year} and led.doc_date >= ${from} and led.doc_date <= ${upto} and led.doc_pos<>'D'`;
    // TEMP_TABLE_NON_FUNCTION1: the book's parties that functioned.
    const functioned = `select ac.code from ${db}account ac left join ${db}addon_data adata on adata.code=ac.code left join ${db}address addr on addr.code=ac.code and addr.address_id=1`
      + `${and(`ac.a_pos<>'D' and ac.code in (${moved}) and ac.book=${book}`)}`;
    const party = `from ${db}account ac left join ${db}ac_balance acbal on acbal.code=ac.code left join ${db}addon_data adata on adata.code=ac.code left join ${db}address addr on addr.code=ac.code and addr.address_id=1`;
    if (format === "OPENING") {
      sql = `select ac.name as "NAME",acbal.opening::numeric as "OPENING",addr.mobile_no as "MOBILE_NO"${headings} ${party}`
        + `${and(`ac.a_pos<>'D' and ac.book=${book} and acbal.year_id=${year} and acbal.opening::numeric<>0 and ac.code not in (${functioned})`)}`;
    } else {
      const which = format === "FUNCTION" ? `ac.code in (${functioned})` : `coalesce(acbal.opening::numeric,0)=0 and ac.code not in (${functioned})`;
      sql = `select ac.name as "NAME",acbal.closing::numeric as "CLS_BAL",addr.mobile_no as "MOBILE_NO"${headings} ${party}${and(`ac.a_pos<>'D' and ac.book=${book} and ${which}`)}`;
    }
    sql += ` order by ${addonOrder}ac.name`;
  } else {
    // TEMP_TABLE_NON_FUNCTION1: the products that functioned.
    const functioned = `select product.prod_key from ${db}product_master product left join ${db}addon_data adata on adata.prod_id=product.prod_key`
      + `${and(`product.prod_key in (select prodled.prod_id from ${db}prod_ledger prodled where prodled.year_id=${year} and prodled.il_date >= ${from} and prodled.il_date <= ${upto} and prodled.il_pos='A') and product.prod_pos<>'D'`)}`;
    const goods = `from ${db}product_master product left join ${db}prod_balance prodbal on prodbal.prod_id=product.prod_key left join ${db}addon_data adata on adata.prod_id=product.prod_key`;
    if (format === "OPENING") {
      sql = `select product.prod_desc as "prod_desc",prodbal.open_pcs::numeric as "OPENING"${headings} ${goods}`
        + `${and(`product.prod_pos<>'D' and prodbal.year_id=${year} and prodbal.prec_flag='RP' and prodbal.open_pcs::numeric<>0 and product.prod_key not in (${functioned})`)}`;
    } else {
      const closing = call.licence === 2 ? "prodbal.clsg_qty3" : "prodbal.clsg_pcs";
      const which = format === "FUNCTION" ? `product.prod_key in (${functioned})`
        : call.checkQuery.includes("CHK_CLOSING,") ? `product.prod_key not in (${functioned})`
        : `prodbal.clsg_pcs::numeric=0 and product.prod_key not in (${functioned})`;
      sql = `select product.prod_desc as "prod_desc",${closing}::numeric as "CLS_BAL"${headings} ${goods}${and(`product.prod_pos<>'D' and prodbal.prec_flag='RP' and ${which}`)}`;
    }
    sql += ` order by ${addonOrder}product.prod_desc`;
  }
  const table = tableFromResult(await runReportSql(loader, frag(sql)));
  for (const column of ["OPENING", "CLS_BAL"]) if (table.has(column)) table.setKind(column, "decimal");
  return table;
}

// ======================================================================================
// 138: MULTI YEAR BALANCE SHEET (the same branch of SP_REPORT_STANDARD as 23)
// ======================================================================================
//
// The company's years that meet From .. Upto (SMART_SYSTEM.CNAME, the companies of the same name, oldest first), each balance sheet worked out
// on its own database for the year's own dates (as report 23: the heads' closing from the opening and the postings, reversing heads, the
// profit transfer and closing stock in OS_BILLDIFF). A row a head, the liability heads (' LIABILITY' + name) before the asset heads
// ('ASSET' + name), a column a year (2025_2026) and TOTAL; a year whose sides do not balance adds a "Difference" row, last.
//  - Put right: the procedure numbers the rows of all the years together (ORDER BY co_short, bs_code) and sets a liability row against the
//    asset row of the same number, so an asset's amount can land in another year's column; here each year is its own.
//  - The procedure's filler rows (a side with fewer heads than the other shows "LIABILITY" / "ASSET" with 0.00) are not made.
//  - The difference of a year with more liabilities than assets is the amount with its sign, as the procedure writes it.

async function multiYearBalanceSheet(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const company = (await runReportSql(loader, `SELECT name FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $1`, [call.companyKey])).rows[0];
  const years = company === undefined ? [] : (await runReportSql(loader, `SELECT n.c_tarikh1::date AS y1, n.c_tarikh2::date AS y2, lower(btrim(c.co_dataname)) AS schema_name`
    + ` FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id WHERE n.c_tarikh2::date >= $1::date AND n.c_tarikh1::date <= $2::date AND c.name = $3 ORDER BY n.c_tarikh1`,
  [desktopDate(call.from), desktopDate(call.upto), company.name])).rows;
  const dayText = (date: Date) => `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
  return balanceColumns(loader, plan, years.map((year) => ({
    schema: toText(year.schema_name), label: `${(year.y1 as Date).getFullYear()}_${(year.y2 as Date).getFullYear()}`,
    start: desktopDate(year.y1 as Date), upto: desktopDate(year.y2 as Date), yearId: `${dayText(year.y1 as Date)}${dayText(year.y2 as Date)}`,
  })));
}

// ======================================================================================
// 136: MULTI COMPANY BALANCE SHEET (the same branch of SP_REPORT_STANDARD as 23)
// ======================================================================================
//
// The companies of the group (the same billing name and group, a short name; the ticked ones of the Book group) that have the year, each balance
// sheet worked out on its own database from the year's start to Upto as report 23 does. Laid out as report 138 with a column a company (its
// short name) in place of a column a year; a company whose sides do not balance adds a "Difference" row.

async function multiCompanyBalanceSheet(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const companies = (await runReportSql(loader, `SELECT lower(btrim(c.co_dataname)) AS schema_name, btrim(c.co_short) AS short FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id`
    + ` WHERE n.c_tarikh1::date = $1::date AND n.c_tarikh2::date = $2::date AND coalesce(btrim(c.co_short), '') <> ''`
    + ` AND c.co_group_name = (SELECT co_group_name FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $3)`
    + (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectBookKey.trim()) ? ` AND c.co_key IN ${call.selectBookKey.trim()}` : "")
    + ` ORDER BY c.co_short`, [desktopDate(call.tarikh1), desktopDate(call.tarikh2), call.companyKey])).rows;
  return balanceColumns(loader, plan, companies.map((company) => ({ schema: toText(company.schema_name), label: toText(company.short), start: desktopDate(call.tarikh1), upto: desktopDate(call.upto), yearId: call.yearId })));
}

/** The side-by-side balance sheet of 136 and 138: a column a database (company or year), a row a head, TOTAL. */
async function balanceColumns(loader: Loader, plan: ReportPlan, units: { schema: string; label: string; start: string; upto: string; yearId: string }[]): Promise<ResultTable> {
  type Bucket = { side: string; name: string; values: Map<string, number> };
  const buckets = new Map<string, Bucket>();
  const labels: string[] = [];
  const put = (side: string, name: string, label: string, amount: number) => {
    const key = `${side}\u0000${name}`;
    const bucket = buckets.get(key) ?? { side, name, values: new Map<string, number>() };
    bucket.values.set(label, (bucket.values.get(label) ?? 0) + amount);
    buckets.set(key, bucket);
  };
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
  for (const unit of units) {
    const schema = unit.schema;
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('account','ac_balance','balsheet','ledger_post')", [schema])).rows[0];
    if (num(exists?.n) < 4) continue;
    const label = unit.label;
    labels.push(label);
    const { liabilities, assets } = await balanceHeads(loader, plan, `${schema}.`, unit.start, unit.upto, unit.yearId);
    for (const head of liabilities) put("LIABILITY", head.heading, label, head.closing);
    for (const head of assets) put("ASSET", head.heading, label, head.closing);
    const total = r2(liabilities.reduce((sum, head) => sum + head.closing, 0) - assets.reduce((sum, head) => sum + head.closing, 0));
    if (total > 0) put("ASSET", "Difference", label, total);
    else if (total < 0) put("LIABILITY", "Difference", label, total);
  }

  const table = new ResultTable();
  table.addColumn("BAL_SIDE");
  table.addColumn("SORTING_COL");
  table.addColumn("NAME");
  for (const label of labels) table.setKind(label, "decimal");
  table.setKind("TOTAL", "decimal");
  const ordered = [...buckets.values()]
    .filter((bucket) => bucket.name !== "")
    .map((bucket, index) => ({ bucket, index, sorting: bucket.name === "Difference" ? "z" : bucket.side === "LIABILITY" ? ` LIABILITY${bucket.name}` : `ASSET${bucket.name}` }))
    .sort((a, b) => (a.sorting.toUpperCase() === b.sorting.toUpperCase() ? (a.bucket.side === b.bucket.side ? a.index - b.index : a.bucket.side < b.bucket.side ? -1 : 1) : a.sorting.toUpperCase() < b.sorting.toUpperCase() ? -1 : 1));
  for (const { bucket, sorting } of ordered) {
    const row: ResultRow = { BAL_SIDE: bucket.name === "Difference" ? "" : bucket.side, SORTING_COL: sorting, NAME: bucket.name };
    let total = 0;
    for (const label of labels) {
      const value = bucket.values.get(label);
      row[label] = value === undefined ? null : r2(value);
      total += value === undefined ? 0 : r2(value);
    }
    row.TOTAL = r2(total);
    table.rows.push(row);
  }
  return table;
}
