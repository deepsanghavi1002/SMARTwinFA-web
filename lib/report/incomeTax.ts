import type { Loader } from "../master-program/load";
import type { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment } from "./generate";
import { tableFromResult } from "./library";
import { num, runReportSql } from "./run";
import { ReportRefusal } from "./refusal";

/**
 * 26: TAX REPORT (REPORT_TAX_REPORT; ANALYSIS REP. > Income / Sales Tax). The book of the first combo (cash 4, sale 8, purchase 13, credit note 16,
 * debit note 11 ...), the vouchers From .. Upto of the ticked accounts / books / schedules / addons, for the tax places of the filter (All, Local,
 * Out-State) as the income tax (sales tax) department asks for them:
 *  - Summary (SP_STD_RPT_INCOMETAX): a line for each party with its Gross and GST / VAT / CST numbers, and under it the party's address lines
 *    (address 1, address 2, address 3 - city - pin) and an empty line (the ordering column SORTING_FIELD, the party's name and 0 .. 4). The cash
 *    book (4) lists the receipts instead: date, party, amount.
 *  - Bill Detail: a line for each bill (date, number, party, Net_Amt, Tax_Amt, Gross, tax numbers, transaction code; Remark with Return Include).
 *  - 704 Summary: a line for each party with Net_Amt, Tax_Amt, Gross, VAT / CST number, mobile and e-mail.
 * With Return Include (sale and purchase only) the returns against the book (credit / debit notes) are taken in with a negative sign.
 * The tax amounts are those of the book's tax slab of the year (the first slab by order for Bill Detail and 704 Summary, every master slab for
 * the Summary) on the taxes of the filter's places; a book with product-wise slabs is not narrowed to the places' taxes (Bill Detail, 704).
 */

type Parts = { frag: (sql: string) => string; from: string; where: string; book: number; slabBook: number; ret: boolean; day: (date: Date) => string; db: string };

async function parts(loader: Loader, plan: ReportPlan): Promise<Parts> {
  const { call } = plan;
  const book = call.book;
  return {
    frag: (sql) => pgFragment(sql, plan, loader.session.companySchema),
    from: call.from_, where: call.where.split("|sys.yearid|").join(call.yearId), book,
    slabBook: book === 11 ? 13 : book === 16 ? 8 : book,
    // Return Include counts for sale and purchase only.
    ret: call.checkQuery.includes("CHK_RETURN_INCLUDE,") && (call.fcValue === 8 || call.fcValue === 13),
    day: (date) => `'${desktopDate(date)}'`, db: call.database,
  };
}

/** The tax master keys of the filter's places (the idopt rows flagged TP, narrowed to Local / Out-State). */
async function taxCodes(loader: Loader, plan: ReportPlan, db: string): Promise<string> {
  const filter = plan.call.filterText.trim().toUpperCase();
  const places = (await runReportSql(loader, `SELECT idopt_key FROM ${db}IDOPT_MASTER WHERE IDOPT_FLAG = 'TP'${filter !== "" && filter !== "ALL" && filter !== "SUMMARY" ? " AND upper(btrim(opt_desc)) = $1" : ""}`,
    filter !== "" && filter !== "ALL" && filter !== "SUMMARY" ? [filter] : [])).rows.map((row) => num(row.idopt_key));
  if (places.length === 0) return "-1";
  const taxes = (await runReportSql(loader, `SELECT tax_rec FROM ${db}TAX_MASTER WHERE tax_pos <> 'D' AND tax_place IN (${places.join(",")})`)).rows.map((row) => num(row.tax_rec));
  return taxes.length === 0 ? "-1" : taxes.join(",");
}

const ledgerFrom = (from: string, db: string, withExt: boolean) => from.split("|sys.sp.ledext|").join(withExt ? `left join ${db}ledger_ext ledext on ledext.led_id=led.led_key` : "");

function finish(table: ResultTable): ResultTable {
  for (const column of table.columns) if (["Gross", "Net_Amt", "Tax_Amt"].includes(column)) table.setKind(column, "decimal");
  return table;
}

/** The Summary format (SP_STD_RPT_INCOMETAX). */
export async function incomeTaxSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const p = await parts(loader, plan);
  const range = ` AND LED.DOC_DATE >= ${p.day(call.from)} AND LED.DOC_DATE <= ${p.day(call.upto)}`;
  const codes = await taxCodes(loader, plan, p.db);

  if (p.book === 4) {
    const sql = `SELECT to_char(led.doc_date, 'DD-Mon-YY') AS "DOC_DATE", ac.name AS "NAME", LED.AMOUNT AS "Gross" ${ledgerFrom(p.from, p.db, false)}${p.where}${range} AND LED.BOOK = 4 and led.bk_dbcode=2 and led.doc_posting<>'L' and led.amount>=1 ORDER BY led.doc_date, ac.name`;
    return finish(tableFromResult(await runReportSql(loader, p.frag(sql))));
  }
  const slabs = (await runReportSql(loader, `SELECT slab_key FROM ${p.db}SLAB_MASTER WHERE SLAB_ACTIVE = 'Y' AND SLAB_MASTER = 'Y' AND BOOK = ${p.slabBook} AND SLAB_FROMDT = ${p.day(call.tarikh1)} AND SLAB_UPTODT = ${p.day(call.tarikh2)} AND slab_link = 0 ORDER BY SLAB_ORDER`)).rows.map((row) => `'${num(row.slab_key)}'`);
  const from = ledgerFrom(p.from, p.db, true);
  const base = `${p.where}${range} AND LED.BOOK = ${p.book} AND LEDEXT.slab_id in (${slabs.join(",") || "'-1'"}) AND COALESCE(ledext.il_id, 0)=0 and add1.address_id::text='1' and ledext.tax_id in (${codes})`;
  // A party's line and under it its address lines and an empty one (the procedure's five tables, UNIONed and ordered by SORTING_FIELD).
  const line = (name: string, extra: string, order: number, gross: string, groupBy = "") => `SELECT ${name} AS "NAME", ${gross} AS "Gross", ${order === 0 ? 'add1.GST_NO' : "''"} AS "Gst_No", ${order === 0 ? 'add1.LST_NO' : "''"} AS "Vat_No", ${order === 0 ? 'add1.CST_NO' : "''"} AS "Cst_No", ac.name||'${order}' AS "sorting_field" ${from}${base}${extra}${groupBy}`;
  const sql = [
    line("ac.name", "", 0, "SUM(LED.AMOUNT)", " GROUP BY ac.NAME,add1.GST_NO,add1.LST_NO,add1.CST_NO"),
    line("add1.address_1", "", 1, "(0)::decimal(18,4)"),
    line("add1.address_2", " AND add1.address_2 <> ''", 2, "(0)::decimal(18,4)"),
    `SELECT * FROM (${line("add1.address_3||'-'||add1.CITY||'-'||add1.PIN_CODE", "", 3, "(0)::decimal(18,4)")}) t3 WHERE "NAME" <> ''`,
    line("''", "", 4, "(0)::decimal(18,4)"),
  ].map((part) => `(${part})`).join(" UNION ") + ` ORDER BY "sorting_field"`;
  return finish(tableFromResult(await runReportSql(loader, p.frag(sql))));
}

/** Bill Detail and 704 Summary (SP_REPORT_FORMATING's branch of report 26). */
export async function incomeTaxFormats(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const format = call.formating.toUpperCase();
  if (format !== "BILL_DETAIL" && format !== "704_SUMMARY") return incomeTaxSummary(loader, plan);
  const p = await parts(loader, plan);
  const range = ` AND LED.DOC_DATE >= ${p.day(call.from)} AND LED.DOC_DATE <= ${p.day(call.upto)}`;
  const codes = await taxCodes(loader, plan, p.db);
  const empty = (): ResultTable => tableFromResult({ fields: [], rows: [] });
  if (format === "704_SUMMARY" && p.book === 4) return empty();

  let bitProductWise = false;
  let slab = "";
  if (p.book !== 4) {
    bitProductWise = num((await runReportSql(loader, `SELECT count(*) AS n FROM ${p.db}SLAB_MASTER WHERE SLAB_POS = 'P' AND SLAB_FROMDT = ${p.day(call.tarikh1)} AND SLAB_MASTER = 'Y' AND SLAB_ACTIVE = 'Y' AND BOOK = ${p.slabBook}`)).rows[0]?.n) > 0;
    const first = (await runReportSql(loader, `SELECT slab_key FROM ${p.db}SLAB_MASTER WHERE SLAB_ACTIVE = 'Y' AND SLAB_MASTER = 'Y' AND BOOK = ${p.slabBook} AND slab_fromdt = ${p.day(call.tarikh1)} AND slab_uptodt = ${p.day(call.tarikh2)} ORDER BY SLAB_ORDER LIMIT 1`)).rows[0];
    if (!first) throw new ReportRefusal("No tax slab is set for this book and year (Internal program failure).", "Internal program failure");
    slab = `'${num(first.slab_key)}'`;
  }
  const book = p.book;
  const bookWhere = p.ret
    ? book === 8 ? ` AND (LED.BOOK = ${book} or LED.BOOK = 9 or LED.AG_BOOK = ${book})` : book === 13 ? ` AND (LED.BOOK = ${book} or LED.BOOK = 14 or LED.AG_BOOK = ${book})` : ""
    : ` AND LED.BOOK = ${book}`;
  const tail = ` AND LEDEXT.slab_id in (${slab})`;
  const taxes = bitProductWise ? "" : ` and ledext.tax_id in (${codes})`;
  // The sign of a return: its side against the book (8 / 13 / other), as the procedure's three CASEs.
  const against = call.fcValue === 8 ? "LED.AG_BOOK = " + book + " AND LED.AC_DBCODE = 2" : call.fcValue === 13 ? "LED.AG_BOOK = " + book + " AND LED.AC_DBCODE = 1" : "LED.AG_BOOK = " + book;
  const from = ledgerFrom(p.from, p.db, book !== 4);

  if (format === "BILL_DETAIL" && book === 4) {
    const sql = `SELECT ac.name AS "NAME", to_char(led.doc_date, 'DD/MM/YYYY') AS "DOC_DATE", led.full_docno AS "DOC_NO", led.amount AS "Gross" ${from}${p.where}${range} and led.bk_dbcode=2 and led.doc_posting<>'L' and led.amount>=1 AND LED.BOOK = ${book} and ADD1.ADDRESS_ID::text='1' ORDER BY led.doc_date`;
    return finish(tableFromResult(await runReportSql(loader, p.frag(sql))));
  }
  if (format === "BILL_DETAIL") {
    const pos = (value: string) => `CASE WHEN ${value} > 0 THEN ${value} ELSE 0.00 END`;
    const signed = (value: string) => `CASE WHEN ${against} THEN ${pos(value)} *-1 ELSE ${pos(value)} END`;
    const amounts = p.ret
      ? `SUM(${signed("(ledext.s_lastot-LEDEXT.SLAB_AMT)")}) AS "Net_Amt",SUM(${signed("LEDEXT.SLAB_AMT")}) AS "Tax_Amt",SUM(${signed("LED.AMOUNT")}) AS "Gross"`
      : `SUM(${pos("(ledext.s_lastot-LEDEXT.SLAB_AMT)")}) AS "Net_Amt",SUM(${pos("LEDEXT.SLAB_AMT")}) AS "Tax_Amt",SUM(${pos("LED.AMOUNT")}) AS "Gross"`;
    const sql = `SELECT ac.name AS "NAME", to_char(led.doc_date, 'DD-Mon-YY') AS "DOC_DATE", led.doc_no AS "DOC_NO", led.full_docno AS "FULL_DOCNO", ${amounts}, add1.GST_NO AS "Gst_No", add1.LST_NO AS "Vat_No", add1.CST_NO AS "Cst_No", ac.TRANSACTION_CODE${p.ret ? ', led.narration AS "Remark"' : ""}`
      + ` ${from}${p.where}${range}${bookWhere}${tail} AND coalesce(ledext.il_id,0)=0 and ADD1.ADDRESS_ID::text='1'${taxes}`
      + ` GROUP BY ac.NAME,add1.GST_NO,add1.LST_NO,add1.CST_NO,led.doc_date,led.doc_no,led.full_docno,ac.TRANSACTION_CODE${p.ret ? ",led.NARRATION" : ""} ORDER BY led.doc_date,led.doc_no`;
    return finish(tableFromResult(await runReportSql(loader, p.frag(sql))));
  }
  // 704 Summary.
  const net = "(ledext.s_lastot-LEDEXT.SLAB_AMT)";
  const amounts = p.ret
    ? `round(cast(SUM(CASE WHEN ${against} THEN (CASE WHEN ${net} <> 0 then ${net} *-1 ELSE 0.00 END) ELSE (CASE WHEN ${net} <> 0 THEN ${net} ELSE 0.00 END) END) AS NUMERIC(18,2)),2) AS "Net_Amt",`
      + `round(cast(SUM(CASE WHEN ${against} THEN LEDEXT.SLAB_AMT *-1 ELSE LEDEXT.SLAB_AMT END) AS NUMERIC(18,2)),2) AS "Tax_Amt",`
      + `round(cast(SUM(CASE WHEN ${against} THEN LED.AMOUNT *-1 ELSE LED.AMOUNT END) AS NUMERIC(18,2)),2) AS "Gross"`
    : `round(cast(SUM(CASE WHEN ${net} > 0 THEN ${net} ELSE 0.00 END) AS NUMERIC(18,2)),2) AS "Net_Amt",round(cast(SUM(CASE WHEN LEDEXT.SLAB_AMT > 0 THEN LEDEXT.SLAB_AMT ELSE 0.00 END) AS NUMERIC(18,2)),2) AS "Tax_Amt",round(cast(SUM(CASE WHEN LED.AMOUNT > 0 THEN LED.AMOUNT ELSE 0.00 END) AS NUMERIC(18,2)),2) AS "Gross"`;
  const sql = `SELECT ac.name AS "NAME", ${amounts}, add1.LST_NO AS "Vat_No", add1.CST_NO AS "Cst_No", add1.mobile_no AS "Mobile_No", add1.e_mail AS "E_Mail"`
    + ` ${from}${p.where}${range}${bookWhere}${tail} AND coalesce(ledext.il_id,0)=0 and LEDEXT.slab_amt <> 0 and ADD1.address_id::text='1'${taxes}`
    + ` GROUP BY ac.NAME,add1.LST_NO,add1.CST_NO,add1.MOBILE_NO,add1.E_MAIL ORDER BY ac.NAME`;
  return finish(tableFromResult(await runReportSql(loader, p.frag(sql))));
}
