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
