import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import type { ResultRow } from "./call";
import { ResultTable } from "./call";
import { dateStyle112, dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import {
  cashBookColumns, dayBefore, dropColumn, groupFailed, groupHeadingColumns, groupList, groupSmartColumn, insertFirst, narrationPieces, numberKey,
  parseRowDate, renameColumn, replaceCI, rightAlignedKey, sortRows, tableFromFields, textKey, withEntryAddon,
} from "./library";
import { money, num, runReportSql } from "./run";

/**
 * SP_REPORT_STANDARD: the standard (unformatted) output of every report, one branch per report
 * key as in the SQL Server procedure. The procedure builds its result in TEMP_TABLE_* / RESULT_TABLE
 * tables; here the same table is built in memory from read-only queries, so a report never writes
 * to the database. What branches share is in library.ts; Report_Combine's own work before and
 * after is in generate.ts and output.ts.
 *
 * Ported branches: 1 (day book), 2 (journal), 3 (register), 4 (ledger), 5 (outstanding ageing).
 */
export async function standardReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  switch (plan.call.reportKey) {
    case 1: return daybook(loader, plan);
    case 2: return journal(loader, plan);
    case 3: return register(loader, plan);
    case 5: return ageing(loader, plan);
    case 4: return ledger(loader, plan);
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
