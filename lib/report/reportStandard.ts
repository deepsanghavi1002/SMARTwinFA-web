import type { Loader } from "../master-program/load";
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
import { checklistDaybook } from "./checklistDaybook";
import { checklistInvoice } from "./checklistInvoice";
import { fundFlow } from "./fundFlow";
import { money, num, runReportSql } from "./run";

/**
 * SP_REPORT_STANDARD: the standard (unformatted) output of every report, one branch per report
 * key as in the SQL Server procedure. The procedure builds its result in TEMP_TABLE_* / RESULT_TABLE
 * tables; here the same table is built in memory from read-only queries, so a report never writes
 * to the database. What branches share is in library.ts; Report_Combine's own work before and
 * after is in generate.ts and output.ts.
 *
 * Ported branches: 109 (fund flow, in fundFlow.ts), 119 (checklist invoice, in checklistInvoice.ts), 120 (checklist daybook, in checklistDaybook.ts), 1 (day book), 2 (journal), 3 (register), 4 (ledger), 5 (outstanding ageing), 6 (trial balance), 22 (profit and loss), 23 (balance sheet), 24 (annexure).
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
    case 14: return formSummary(loader, plan);
    case 15: return bankReconciliation(loader, plan);
    case 109: return fundFlow(loader, plan);
    case 119: return checklistInvoice(loader, plan);
    case 120: return checklistDaybook(loader, plan);
    case 23: return balanceSheet(loader, plan);
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

/** The slab book of the voucher book: a sale return (16) or purchase return (11) reads the slabs of the book it is against. */
export function registerSlabBook(book: number, against: number): number {
  if (book === 16 && against === 8) return 8;
  if (book === 16 && against === 13) return 13;
  if (book === 11 && against === 13) return 13;
  if (book === 11 && against === 8) return 8;
  if (book === 10 || book === 15) return 15;
  return book;
}

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
  const slabColumn = (key: number | string, short: string) => `,COALESCE((SELECT SLAB_AMT::numeric FROM ${db}LEDGER_EXT WHERE LED_ID=LED.LED_KEY AND SLAB_ID=${key} AND (IL_ID IS NULL) LIMIT 1),0.00) AS "${short}"`;
  let slabColumns = "";
  let where = call.where;
  if (format === "ISLAB") {
    tickedKeys.forEach((key, at) => { slabColumns += slabColumn(key, tickedShorts[at] ?? key); });
    where += ` and led.LED_KEY in (select led_id from ${db}LEDGER_EXT where slab_id in (${tickedKeys.join(",") || "-1"}) and SLAB_AMT::numeric<>0 and led_id=led.led_key)`;
  } else if (format === "ESLAB") {
    for (const slab of slabs) if (!tickedKeys.includes(String(slab.key)) && !slab.master) slabColumns += slabColumn(slab.key, slab.short);
    where += ` and led.LED_KEY not in (select led_id from ${db}LEDGER_EXT where slab_id in (${tickedKeys.join(",") || "-1"}) and SLAB_AMT::numeric<>0 and led_id=led.led_key)`;
  }

  // OUTER APPLY: the expense account's name, and the product lines' quantity, factor and MRP value.
  let apply = ` LEFT JOIN LATERAL (SELECT acc.name AS exp_name FROM ${db}ACCOUNT acc WHERE acc.Code=led.post_bkcode) ALIAS1 ON TRUE`;
  if (call.checkQuery.includes("CHK_QUANTITY,")) apply += ` LEFT JOIN LATERAL (SELECT SUM(Quantity) AS qty FROM ${db}prod_ledger WHERE LED_ID=led.led_key AND IL_POS='A') ALIAS4 ON TRUE`;
  if (call.checkQuery.includes("CHK_FACTOR,")) {
    apply += ` LEFT JOIN LATERAL (SELECT SUM(CASE WHEN PRODUCT.REP2_UOM=PRODUCT.PCS_UOM THEN prodled.TRN_PCS-prodled.ag_qty`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.QTY1_UOM THEN prodled.TRN_QTY1-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_qty1)::numeric,4)`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.QTY2_UOM THEN prodled.TRN_QTY2-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_qty2)::numeric,4)`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.qty3_uom THEN prodled.TRN_QTY3-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_qty3)::numeric,4)`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.PACK_UOM THEN prodled.TRN_PACK-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_pack)::numeric,4)`
      + ` WHEN PRODUCT.REP2_UOM=PRODUCT.WEIGHT_UOM THEN prodled.TRN_WEIGHT-round((prodled.AG_QTY/NULLIF(prodled.QUANTITY,0)*prodled.trn_weight)::numeric,4)`
      + ` ELSE CAST(factor AS NUMERIC(20,2)) END) AS factor FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master PRODUCT ON PRODUCT.prod_key=prodled.prod_id WHERE LED_ID=led.led_key AND IL_POS='A' AND PRODUCT.PROD_POS='A') ALIAS5 ON TRUE`;
  }
  if (call.checkQuery.includes("CHK_MRPVAL,")) apply += ` LEFT JOIN LATERAL (SELECT round(SUM(master_rate*quantity),2) AS mrp_value FROM ${db}prod_ledger WHERE LED_ID=led.led_key AND IL_POS='A') ALIAS6 ON TRUE`;

  const end = call.queryEnd.trim() !== "" ? `,${call.queryEnd}` : "";
  const order = call.orderBy.trim();
  const orderBy = order !== "" && !order.toLowerCase().startsWith("led.doc_no")
    ? ` ORDER BY ${order},LED.DOC_NO,LED.FULL_DOCNO${printSlabs ? ",slabmst.SLAB_ORDER" : ""}`
    : printSlabs ? ` ORDER BY SORTING_DATE,LED.DOC_NO,slabmst.SLAB_ORDER` : ` ORDER BY SORTING_DATE,LED.DOC_NO`;
  const slabCells = printSlabs ? `,COALESCE(ltrim(rtrim(SLAB_REPOHD)),'') AS "SLAB_DESC",COALESCE(ledext.SLAB_AMT::numeric,0.00) AS "SLAB_AMOUNT"` : slabColumns;
  const narrationColumn = useUnion ? "NARRATION1" : "NARRATION";
  const sql = `SELECT ${distinct}${select}${slabCells},LED.DOC_REMARK,LED.NARRATION AS "${narrationColumn}"${end}${from}${apply}${where}${orderBy}`;
  const result = await runReportSql(loader, frag(sql));
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

  // Closing balance of each party at the Upto date, and its name and credit days.
  const sums = await runReportSql(loader, frag(`SELECT ac.code AS code, ac.name AS name, ac.credit_days AS credit_days, ac.grace_days AS grace_days, coalesce(MAX(acbal.opening::numeric),0.00) AS opening,`
    + ` coalesce((select sum(case when led.ac_dbcode=1 then led.amount::numeric else 0.00 end) - sum(case when led.ac_dbcode=2 then led.amount::numeric else 0.00 end) from ${db}LEDGER led where led.code=ac.code and led.doc_pos<>'D' and led.doc_date<='${upto}' and led.doc_posting='P' and led.book_code in (select code from ${db}ACCOUNT where a_pos<>'D')),0.00) AS movement`
    + ` FROM ${db}ACCOUNT ac left join ${db}AC_BALANCE acbal on acbal.code=ac.code and acbal.year_id='${call.yearId}' WHERE ac.a_pos<>'D' and ac.book=${partyBook} and ac.os_flag<>'N' and ac.code in (${list}) GROUP BY ac.code,ac.name,ac.credit_days,ac.grace_days`));
  const parties = new Map<number, { name: string; closing: number }>();
  for (const row of sums.rows) parties.set(Number(row.code), { name: toText(row.name), closing: money(num(row.opening) + num(row.movement)) });

  // Advances not yet set against a bill: rows of their own, below zero.
  const advances = await runReportSql(loader, frag(`SELECT outclr.out_ledid AS led_key, ac.code AS code, ac.name AS name, ac.a_short AS a_short, outclr.out_entrybook AS book, outclr.out_fulldocno AS full_docno, outclr.out_date AS out_date, outclr.out_entryamt::numeric AS amount, to_char(led.doc_date,'YYYYMMDD') AS sortdate, led.doc_no AS doc_no`
    + ` FROM ${db}ACCOUNT ac left join ${db}OUTCLEAR outclr on outclr.code=ac.code left join ${db}LEDGER led on led.led_key=outclr.out_ledid`
    + ` WHERE coalesce(out_ag_outid,0)=0 and outclr.out_dbcode=${adviceSide} and outclr.out_entryamt::numeric<>0 and ac.book=${partyBook} and outclr.out_fulldocno<>'OPENING' and led.doc_posting<>'L' and led.doc_pos<>'D' and ac.os_flag<>'N' and ac.code in (${list}) and led.doc_date<='${upto}'${series}`));
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
    out.push(...rows);
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
    for (const name of ["ROW_DATA_TYPE", "SMART_NAME", "NAME", ...(mobile ? ["MOBILE_NO"] : []), "INVOICE_AMT", "CLEAR_AMOUNT", "PENDING", "CDays", "Days", ...AGEING_BUCKETS.map((bucket) => bucket[0]), "SORTING_COL", "LAST_" + (sale ? "RECD" : "PAY") + "_DATE", "LAST_" + (sale ? "RECD" : "PAY") + "_AMT", "LAST_INV_DATE", "LAST_INV_AMT"]) result.addColumn(name);
    for (const name of ["INVOICE_AMT", "CLEAR_AMOUNT", "PENDING", "LAST_" + (sale ? "RECD" : "PAY") + "_AMT", "LAST_INV_AMT", ...AGEING_BUCKETS.map((bucket) => bucket[0])]) result.setKind(name, "decimal");
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
        sum = { ROW_DATA_TYPE: "LED", SMART_NAME: row[col("SMART_NAME")], NAME: row[col("SMART_NAME")], ...(mobile ? { MOBILE_NO: row[col("MOBILE_NO")] } : {}), INVOICE_AMT: 0, CLEAR_AMOUNT: 0, PENDING: 0, CDays: num(row[col("CDays")]), Days: oldest.get(code) ?? 0, SORTING_COL: toText(row[col("SMART_NAME")]), _code: code };
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
  // The order: by party name then date (Party Wise: the heading first), or by date (Date Wise).
  if (partyWise) sortRows(table, [(row) => textKey(row[col("SORTING_COL")])]);
  else sortRows(table, [(row) => textKey(row[col("SORTING_DATE")]), (row) => textKey(row[col("SMART_NAME")])]);
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
      for (const journal of journals) {
        const journalDate = parseRowDate(toText(table.get(journal, "selected_date")));
        for (const contra of contras) {
          if (toText(contra.full_docno) !== toText(table.get(journal, "full_docno"))) continue;
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
      lineRows.push(...kept, ...added);
    }
  }

  // CHK_WLED / CHK_WALED (WhatsApp ledgers) keep debtors (book 2) only.
  if (!useUnion && (check("CHK_WLED") || check("CHK_WALED"))) {
    if (check("CHK_WLED")) {
      const codes = new Set(lineRows.map((row) => toText(table.get(row, "SMART_AC_CODE"))));
      table.rows = table.rows.filter((row) => codes.has(toText(table.get(row, "SMART_AC_CODE"))));
    }
    table.rows = table.rows.filter((row) => toText(table.get(row, "AC_BOOK")) === "2");
    table.rows.push(...lineRows.filter((row) => toText(table.get(row, "AC_BOOK")) === "2"));
  } else {
    table.rows.push(...lineRows, ...narrationRows);
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
// Not ported: the multi company (136) and multi year (138) balance sheets, which the same
// procedure serves.

type HeadLine = { heading: string; code: string; code1: string; opening: number; closing: number };

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
    + ` LEFT JOIN ${db}AC_BALANCE acbal ON acbal.code = ac1.code AND acbal.year_id = '${call.yearId}' AND acbal.a_recflag = 'AC'`
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
    + ` where ac.a_pos<>'D' and acbal.year_id='${call.yearId}'`);
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
// SP_REPORT_FORMATING (SP_FRT_RPT_FORM_SUMM): formSummaryFormats.ts.

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
  if (check("CHK_CRCASCOM") && (key5.includes(",16") || key5.includes(",11"))) where += ` AND (LED.BOOK_CODE IN (${keys}) OR LED.AG_BKCODE IN (${keys})) AND (LED.BOOK IN (${inBook}) OR LED.AG_BOOK IN (${inBook}))`;
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
  if (filter === "AVERAGE VALUE") throw notPorted("The Average Value valuation (the procedure compares the closing quantity with a variable that is empty in this run and keeps a running count across products, so its figures are not reproducible)");
  if (!["NONE", "REPORT RATE", "", ...VALUATIONS].includes(filter)) throw notPorted(`The "${call.filterText}" valuation`);
  for (const [option, caption] of [["CHK_UPD_MASTER", "Update Value In Master"], ["CHK_UPD_RATE", "Update Rate In Master"], ["CHK_FOLDER", "Folder"], ["CHK_CHLNCOL", "Challan date"], ["CHK_AGECOL", "Age columns"], ["CHK_FG_VALADD", "FG value add"], ["CHK_MINMAX_COL", "Min / Max columns"], ["CHK_EXP", "Valuation with expense"]] as const) {
    if (check(option)) throw notPorted(`The ${caption} option`);
  }
  if (call.sortingText !== "" && call.sortingText.toUpperCase() !== "NONE") throw notPorted("The Above / Below Days sorting");
  if (call.addon.some((text) => text.toUpperCase().includes("GODOWN")) || call.selectBookKey !== "") throw notPorted("The Godown and Batch / Expiry selections");

  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);
  const yearStart = desktopDate(call.tarikh1);
  const dayBeforeFrom = desktopDate(dayBefore(call.from));
  const between = call.from.getTime() !== call.tarikh1.getTime();
  const typeKey = num((await runReportSql(loader, `SELECT BOOK_KEY FROM ${db}BOOK_PROPERTIES WHERE STKM_POS = 'A' AND STKM_ID = 'NR' ORDER BY STKMODULE LIMIT 1`)).rows[0]?.book_key);

  /** The movement of a stock line in the product's first report unit (receipts and issues of job work count whole). */
  const qtyOf = (l: string, p: string, whole: string) => `(case when ${p}.REP1_UOM=${p}.PCS_UOM then (case when ${l}.TRN_MODULE='${whole}' then ${l}.TRN_PCS else ${l}.TRN_PCS-${l}.AG_QTY end)`
    + ` when ${p}.REP1_UOM=${p}.QTY1_UOM then (case when ${l}.TRN_MODULE='${whole}' then ${l}.TRN_QTY1 else ${l}.TRN_QTY1-${l}.AG_QTY end)`
    + ` when ${p}.REP1_UOM=${p}.QTY2_UOM then (case when ${l}.TRN_MODULE='${whole}' then ${l}.TRN_QTY2 else ${l}.TRN_QTY2-${l}.AG_QTY end)`
    + ` when ${p}.REP1_UOM=${p}.QTY3_UOM then (case when ${l}.TRN_MODULE='${whole}' then ${l}.TRN_QTY3 else ${l}.TRN_QTY3-${l}.AG_QTY end)`
    + ` when ${p}.REP1_UOM=${p}.PACK_UOM then (case when ${l}.TRN_MODULE='${whole}' then ${l}.TRN_PACK else ${l}.TRN_PACK-${l}.AG_QTY end)`
    + ` when ${p}.REP1_UOM=${p}.WEIGHT_UOM then (case when ${l}.TRN_MODULE='${whole}' then ${l}.TRN_WEIGHT else ${l}.TRN_WEIGHT-${l}.AG_QTY end)`
    + ` else ${l}.TRN_PCS-${l}.AG_QTY end)`;
  const lineWhere = (l: string) => `${l}.TYPE <> ${typeKey} AND ${l}.INVENTORY='Y' AND ${l}.IL_POS='A' AND (${l}.QUANTITY-${l}.AG_QTY>0 or ${l}.TRN_MODULE='JOB-OUT' or ${l}.TRN_MODULE='JOB-IN') AND ${l}.QUANTITY>0`;
  const productFilter = call.where.split("|sys.yearid|").join(call.yearId);

  // The products: first-unit opening (the year's opening plus what moved before From).
  const openingCase = (column: string) => `product.rep1_uom=product.${column}_uom`;
  const earlier = between
    ? ` + COALESCE((SELECT SUM(CASE pl.STOCK_NAT WHEN 'A' THEN ${qtyOf("pl", "p1", "JOB-IN")} ELSE 0 END) - SUM(CASE pl.STOCK_NAT WHEN 'L' THEN ${qtyOf("pl", "p1", "JOB-OUT")} ELSE 0 END) FROM ${db}PROD_LEDGER pl join ${db}PRODUCT_MASTER p1 on p1.PROD_KEY = pl.PROD_ID WHERE pl.PROD_ID = product.PROD_KEY AND ${lineWhere("pl")} AND pl.IL_DATE BETWEEN '${yearStart}' AND '${dayBeforeFrom}'),0)`
    : "";
  const products = (await runReportSql(loader, frag(`SELECT product.PROD_KEY AS "prod_key", product.PROD_SHORT AS "prod_short",`
    + ` case when LEVEL.DIV_MAXLVL=LEVEL.STOCK_LEVEL then PRODUCT.PROD_DESC when LEVEL.STOCK_LEVEL=1 then PRODUCT.DESC_1 when LEVEL.STOCK_LEVEL=2 then PRODUCT.DESC_1 || ' ' || PRODUCT.DESC_2 when LEVEL.STOCK_LEVEL=3 then PRODUCT.DESC_1 || ' ' || PRODUCT.DESC_2 || ' ' || PRODUCT.DESC_3 when LEVEL.STOCK_LEVEL=4 then PRODUCT.DESC_1 || ' ' || PRODUCT.DESC_2 || ' ' || PRODUCT.DESC_3 || ' ' || PRODUCT.DESC_4 else ' ' end AS "prod_desc",`
    + ` (SELECT PUOM.UOM_SHORT FROM ${db}PROD_UOM PUOM WHERE PUOM.UOM_KEY = PRODUCT.REP1_UOM) AS "uom1", prodbal.rep_rate::numeric AS "rep_rate",`
    + ` (case when ${openingCase("pcs")} then prodbal.OPEN_PCS when ${openingCase("qty1")} then prodbal.open_qty1 when ${openingCase("qty2")} then prodbal.open_qty2 when ${openingCase("qty3")} then prodbal.open_qty3 when ${openingCase("pack")} then prodbal.open_pack when ${openingCase("weight")} then prodbal.open_weight else prodbal.OPEN_PCS end)${earlier} AS "opening"`
    + ` FROM ${db}PRODUCT_MASTER PRODUCT left join ${db}LEVEL_MASTER LEVEL on PRODUCT.PROD_GROUP = LEVEL.PROD_GROUP left join ${db}addon_data adata on PRODUCT.PROD_KEY = adata.PROD_ID left join ${db}prod_balance prodbal on prodbal.PROD_ID = PRODUCT.PROD_KEY ${productFilter} AND prodbal.prec_flag='RP' ORDER BY PRODUCT.PROD_SHORT`))).rows
    .map((row) => ({ key: num(row.prod_key), short: toText(row.prod_short), desc: toText(row.prod_desc), uom: row.uom1 === null ? null : toText(row.uom1), rate: num(row.rep_rate), opening: Math.round(num(row.opening) * 10000) / 10000 }));
  products.sort((a, b) => sqlServerCompare(a.short, b.short));

  // The lines of the period.
  const fixCols = call.fixCols.replace(/,\s*\|\|\s*to_char\(prodled\.il_date/i, ",product.prod_short || to_char(prodled.il_date").replace(/,\s*$/, "");
  const start = call.queryStart.split("|SYS.FROMDT|").join(fromText);
  const lineSql = frag(`SELECT ${fixCols},${start}`
    + ` FROM ${db}PROD_LEDGER PRODLED right join ${db}PRODUCT_MASTER PRODUCT on PRODLED.PROD_ID = PRODUCT.PROD_KEY left join ${db}PROD_UOM PUOM on PUOM.UOM_KEY = PRODUCT.REP1_UOM left join ${db}PROD_UOM PUOM1 on PUOM1.UOM_KEY = PRODUCT.REP2_UOM`
    + ` left join ${db}ACCOUNT AC on PRODLED.CODE = AC.Code left join ${db}LEVEL_MASTER LEVEL on PRODUCT.PROD_GROUP = LEVEL.PROD_GROUP left join ${db}addon_data adata on PRODLED.PROD_ID = adata.PROD_ID left join ${db}LEDGER led on PRODLED.LED_ID = led.LED_KEY`
    + ` ${productFilter.split("prodbal").join("prodled")} AND ${lineWhere("PRODLED")} AND (PRODLED.IL_DATE BETWEEN '${fromText}' AND '${uptoText}') ORDER BY PRODUCT.PROD_SHORT, PRODLED.IL_DATE, PRODLED.STOCK_NAT`);
  const lines = await runReportSql(loader, lineSql);
  const table = tableFromFields(lines.fields);
  for (const column of ["ADD_QTY", "LESS_QTY", "CLSG_QTY", "ADD_FACT", "LESS_FACT", "BAL_FACT"]) table.setKind(column, "decimal");
  for (const column of ["NAME", "SORTING_COL", "SMART_SELECTED_PRODUCT", "ROW_DATA_TYPE", "PROD_SHORT", "SELECTED_PRODUCT", "FULL_DOCNO", "UOM1"]) table.addColumn(column);
  if (summary) table.setKind("OPENING", "decimal");
  const withRate = filter === "REPORT RATE" || VALUATIONS.includes(filter);
  if (withRate) { table.setKind("RATE", "decimal"); table.setKind("VALUE", "decimal"); }
  const byProduct = new Map<number, ResultRow[]>();
  for (const row of lines.rows) {
    const key = num(table.get(row, "Prod_key"));
    byProduct.set(key, [...(byProduct.get(key) ?? []), { ...row }]);
  }

  const zero = check("CHK_PRNT_ZERO");
  // First the quantities of each product (the valuations work on its closing quantity), then the rows.
  const shown = products.flatMap((product) => {
    const rows = byProduct.get(product.key) ?? [];
    const added = Math.round(rows.reduce((sum, row) => sum + num(table.get(row, "ADD_QTY")), 0) * 10000) / 10000;
    const less = Math.round(rows.reduce((sum, row) => sum + num(table.get(row, "LESS_QTY")), 0) * 10000) / 10000;
    const closing = Math.round((product.opening + added - less) * 10000) / 10000;
    return !zero && product.opening === 0 && rows.length === 0 && closing === 0 ? [] : [{ product, rows, added, less, closing }];
  });
  const r2 = (value: number) => Math.round(value * 100) / 100;
  const valued = new Map<number, { rate: number; value: number }>();
  if (filter === "REPORT RATE") for (const { product, closing } of shown) valued.set(product.key, { rate: product.rate, value: r2(closing * product.rate) });
  else if (VALUATIONS.includes(filter)) for (const [key, entry] of await stockValuation(loader, plan, filter, new Map(shown.map(({ product, closing }) => [product.key, closing] as const)), typeKey)) valued.set(key, entry);
  for (const { product, rows, added, less, closing } of shown) {
    const entry = valued.get(product.key) ?? { rate: 0, value: 0 };
    const rateValues = withRate ? { RATE: entry.rate, VALUE: entry.value } : {};
    if (summary) {
      table.insert({ ROW_DATA_TYPE: "LED", SORTING_COL: `${product.short}   P`, PROD_SHORT: product.short, SELECTED_PRODUCT: product.desc, SMART_SELECTED_PRODUCT: product.desc, NAME: "", Prod_key: product.key, UOM1: product.uom, OPENING: product.opening, ADD_QTY: added, LESS_QTY: less, CLSG_QTY: closing, ...rateValues });
      continue;
    }
    table.insert({ ROW_DATA_TYPE: "PRODUCT", SORTING_COL: `${product.short}   H`, PROD_SHORT: product.short, SELECTED_PRODUCT: product.desc, SMART_SELECTED_PRODUCT: product.desc, FULL_DOCNO: `${product.short} - ${product.desc}`, Prod_key: product.key, UOM1: product.uom });
    // On a product's last row the value is the one worked out for its closing; before it, the running quantity at the rate.
    table.insert({ ROW_DATA_TYPE: "OPENINGS", SORTING_COL: `${product.short}${desktopDate(call.from)}   O`, PROD_SHORT: product.short, SELECTED_PRODUCT: product.desc, SMART_SELECTED_PRODUCT: product.desc, NAME: "Opening", Prod_key: product.key, UOM1: product.uom, CLSG_QTY: product.opening, ...(withRate ? { RATE: entry.rate, VALUE: rows.length === 0 ? entry.value : r2(product.opening * entry.rate) } : {}) });
    let running = product.opening;
    rows.forEach((row, at) => {
      running = Math.round((running + num(table.get(row, "ADD_QTY")) - num(table.get(row, "LESS_QTY"))) * 10000) / 10000;
      table.set(row, "CLSG_QTY", running);
      if (withRate) { table.set(row, "RATE", entry.rate); table.set(row, "VALUE", at === rows.length - 1 ? entry.value : r2(running * entry.rate)); }
      table.rows.push(row);
    });
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
  const r2 = (value: number) => Math.round(value * 100) / 100;
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
    for (const row of rows) if (num(row.qty) !== 0) setRate(num(row.pid), r2(Math.round((num(row.amount) / num(row.qty)) * 1000) / 1000));
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
  if (check("CHK_WITHDATE")) throw notPorted("The With Date layout");
  if (check("CHK_FACTOR")) throw notPorted("The Factor columns");
  if ([6, 15, 22, 38].includes(call.licence)) throw notPorted(`The licence ${call.licence} columns`);
  if (call.addon.some((text) => text.toUpperCase().includes("GODOWN"))) throw notPorted("The Godown selection");
  const fromText = desktopDate(call.from);
  const uptoText = desktopDate(call.upto);
  const yearStart = desktopDate(call.tarikh1);
  const dayBeforeFrom = desktopDate(dayBefore(call.from));
  const between = call.from.getTime() !== call.tarikh1.getTime();
  const typeKey = 25;
  const damageKey = 0;

  /** A line's quantity in the product's first report unit; `whole` is the job work module that counts the whole entry, `plain` leaves AG_QTY alone. */
  const qty = (whole: string, plain: boolean) => {
    const columns: [string, string][] = [["PCS_UOM", "TRN_PCS"], ["QTY1_UOM", "TRN_QTY1"], ["QTY2_UOM", "TRN_QTY2"], ["QTY3_UOM", "TRN_QTY3"], ["PACK_UOM", "TRN_PACK"], ["WEIGHT_UOM", "TRN_WEIGHT"]];
    const line = (column: string) => (plain ? `prodled.${column}` : whole !== "" ? `(case when prodled.trn_module='${whole}' then prodled.${column} else prodled.${column}-prodled.ag_qty end)` : `(prodled.${column}-prodled.ag_qty)`);
    return `case ${columns.map(([uom, column]) => `when PRODUCT.REP1_UOM=PRODUCT.${uom} then ${line(column)}`).join(" ")} else ${line("TRN_PCS")} end`;
  };
  const sum = (condition: string, expression: string, alias: string) => `coalesce(sum(case when ${condition} then ${expression} else 0.00 end),0.00) AS "${alias}"`;
  const inv = "prodled.inventory='Y'";
  const rpl = call.licence === 21 || call.licence === 71;
  const columns = [
    sum(`(book=13 or book=14) and stock_nat='A' and ${inv} and led_id is not null`, qty("", false), "purch_qty"),
    sum(`(book=16 or book=8) and stock_nat='A' and ${inv} and led_id is not null and prodled."TYPE"<>${damageKey}`, qty("", false), "cr_qty"),
    sum(`stock_nat='A' and (trn_module='CHLN-IN' or trn_module='JOB-IN' or trn_module='JOB-OUT') and ${inv} and process_id is not null`, qty("JOB-IN", false), "chlnin_qty"),
    ...(rpl ? [sum(`stock_nat='A' and (trn_module='PROD-FG' or trn_module='PROD-SFG' or trn_module='PROD-MULTI') and ${inv} and process_id is not null`, qty("", false), "production")] : []),
    sum(`stock_nat='A' and (${rpl ? "trn_module='SVOU-ADD'" : "trn_module='SVOU-ADD' or trn_module='PROD-FG' or trn_module='PROD-SFG'"}) and ${inv} and process_id is not null`, qty("", false), "stock_add"),
    sum(`stock_nat='A' and ${inv} and (trn_module='STK-JV' or trn_module='RG-AC')`, qty("", true), "stock_jv_add"),
    sum(`(book=8 or book=9) and stock_nat='L' and ${inv} and led_id is not null`, qty("", false), "sale_qty"),
    sum(`(book=11 or book=13) and stock_nat='L' and ${inv} and led_id is not null and prodled."TYPE"<>${damageKey}`, qty("", false), "dr_qty"),
    sum(`stock_nat='L' and (trn_module='CHLN-OUT' or trn_module='IND-OUT' or trn_module='JOB-OUT') and ${inv} and process_id is not null`, `case when trn_module='JOB-OUT' then prodled.quantity else ${qty("", false)} end`, "chlnout_qty"),
    ...(rpl ? [sum(`stock_nat='L' and (trn_module='PROD-FG' or trn_module='PROD-SFG' or trn_module='PROD-MULTI') and ${inv} and process_id is not null`, qty("", false), "consumption")] : []),
    sum(`stock_nat='L' and trn_module='SVOU-LESS' and ${inv} and process_id is not null`, qty("", false), "stock_less"),
    sum(`stock_nat='L' and ${inv} and (trn_module='STK-JV' or trn_module='RG-AC')`, qty("", true), "stock_jv_less"),
    sum(`book=16 and prodled."TYPE"=${damageKey} and led_id is not null`, qty("", false), "damagein_qty"),
    sum(`book=11 and prodled."TYPE"=${damageKey} and led_id is not null`, qty("", false), "damageout_qty"),
  ];
  const movements = async (from: string, upto: string) => new Map((await runReportSql(loader, frag(`SELECT prodled.prod_id AS "prod_id", ${columns.join(", ")} FROM ${db}PROD_LEDGER prodled join ${db}PRODUCT_MASTER PRODUCT on PRODUCT.PROD_KEY = prodled.PROD_ID`
    + ` WHERE prodled.il_pos='A' AND prodled.IL_DATE BETWEEN '${from}' AND '${upto}' AND prodled.quantity>0 AND prodled.TYPE <> ${typeKey} GROUP BY prodled.prod_id`))).rows.map((row) => [num(row.prod_id), row] as const));
  const period = await movements(fromText, uptoText);
  const before = between ? await movements(yearStart, dayBeforeFrom) : new Map<number, ResultRow>();
  const names = ["purch_qty", "cr_qty", "chlnin_qty", ...(rpl ? ["production"] : []), "stock_add", "stock_jv_add", "sale_qty", "dr_qty", "chlnout_qty", ...(rpl ? ["consumption"] : []), "stock_less", "stock_jv_less", "damagein_qty", "damageout_qty"];
  const net = (row: ResultRow | undefined) => (row === undefined ? 0 : num(row.purch_qty) + num(row.cr_qty) + num(row.chlnin_qty) + num(row.production) + num(row.stock_add) + num(row.stock_jv_add) + (rpl ? num(row.damagein_qty) : 0) - num(row.sale_qty) - num(row.dr_qty) - num(row.chlnout_qty) - num(row.consumption) - num(row.stock_less) - num(row.stock_jv_less) - (rpl ? num(row.damageout_qty) : 0));

  // The products: the ticked ones (and addon keys) of the setup's where.
  const addonFilter = call.addon.map((text, index) => (text.trim() !== "" && call.selectKey[index] !== "" ? ` and ${text.replace(" adata.txt_", " adata.key_")} in ${call.selectKey[index]}` : "")).join("");
  const open = (column: string) => `product.rep1_uom=product.${column}_uom`;
  const products = (await runReportSql(loader, frag(`SELECT product.PROD_KEY AS "prod_key", product.PROD_SHORT AS "prod_short", product.PROD_DESC AS "prod_desc", coalesce(prodbal.excise_rate,0) AS "act_rate",`
    + ` (case when ${open("pcs")} then prodbal.OPEN_PCS when ${open("qty1")} then prodbal.open_qty1 when ${open("qty2")} then prodbal.open_qty2 when ${open("qty3")} then prodbal.open_qty3 when ${open("pack")} then prodbal.open_pack when ${open("weight")} then prodbal.open_weight else prodbal.OPEN_PCS end) AS "opening"`
    + ` FROM ${db}product_master product left join ${db}prod_balance prodbal on product.prod_key=prodbal.prod_id inner join ${db}IDOPT_MASTER idopt on product.prod_group = idopt.idopt_key left join ${db}ADDON_DATA adata on adata.PROD_ID = product.PROD_KEY`
    + ` where product.prod_pos<>'D' and product.inventory='Y' and prodbal.prec_flag='RP' and prodbal.YEAR_ID='${call.yearId}'${call.selectKey[4] !== "" ? ` and product.prod_key in ${call.selectKey[4]}` : ""}${addonFilter}`))).rows;
  products.sort((a, b) => sqlServerCompare(toText(a.prod_short), toText(b.prod_short)));

  const table = new ResultTable();
  for (const column of ["SMART_SELECTED_PRODUCT", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "ROW_DATA_TYPE", "PROD_SHORT", "PROD_DESC"]) table.addColumn(column);
  const quantity = ["OPEN_QTY", "PURCH_QTY", "CR_QTY", "CHLNIN_QTY", ...(rpl ? ["PRODUCTION"] : []), "STOCK_ADD", "STOCK_JV_ADD", "SALE_QTY", "DR_QTY", "CHLNOUT_QTY", ...(rpl ? ["CONSUMPTION"] : []), "STOCK_LESS", "STOCK_JV_LESS", "DAMAGEIN_QTY", "DAMAGEOUT_QTY", "CLSG_QTY"];
  for (const column of quantity) table.setKind(column, "decimal");
  if (call.licence === 21) table.setKind("ACT_RATE", "decimal");
  for (const product of products) {
    const key = num(product.prod_key);
    const moved = period.get(key);
    const opening = Math.round((num(product.opening) + net(before.get(key))) * 10000) / 10000;
    const values: Record<string, number> = { OPEN_QTY: opening };
    names.forEach((name) => { values[name.toUpperCase()] = Math.round(num(moved?.[name]) * 10000) / 10000; });
    if (quantity.slice(0, -1).every((column) => values[column] === 0)) continue;
    values.CLSG_QTY = Math.round((values.OPEN_QTY + values.PURCH_QTY + values.CR_QTY + values.CHLNIN_QTY + (values.PRODUCTION ?? 0) + values.STOCK_ADD + values.STOCK_JV_ADD + (rpl ? values.DAMAGEIN_QTY : 0) - values.SALE_QTY - values.DR_QTY - values.CHLNOUT_QTY - (values.CONSUMPTION ?? 0) - values.STOCK_LESS - values.STOCK_JV_LESS - (rpl ? values.DAMAGEOUT_QTY : 0)) * 10000) / 10000;
    table.insert({ SMART_SELECTED_PRODUCT: toText(product.prod_short), SMART_SELECTED_ADDON1: "", SMART_SELECTED_ADDON2: "", SMART_SELECTED_ADDON3: "", SMART_SELECTED_ADDON4: "", ROW_DATA_TYPE: "LED", PROD_SHORT: product.prod_short, PROD_DESC: product.prod_desc, ...values, ...(call.licence === 21 ? { ACT_RATE: num(product.act_rate) } : {}) });
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
  if (call.formating.toUpperCase().includes("SUMM")) throw new ReportRefusal("The Summary format of the Partywise Stock is not available in the web version yet.", "Not ported yet");
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
    // With exactly one master slab the net amount and the tax description are worked out.
    if (taxSr === 1) {
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
