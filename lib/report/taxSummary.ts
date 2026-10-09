import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { dropColumn, sortRows, tableFromResult, textKey } from "./library";
import { amountExpressions, taxColumns } from "./taxSummarySql";
import { money, num, runReportSql } from "./run";

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
