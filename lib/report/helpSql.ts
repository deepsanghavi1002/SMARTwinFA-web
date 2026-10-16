/**
 * Help queries (smart_setup.help_table) written for SQL Server look a product's row up in another table once per product: the
 * product's first ADDON_DATA row, its latest MRP in PRICELIST. Neither table has an index on PROD_ID here, so each lookup reads the
 * whole table, once for each of the 17,839 products (the Product help of the stock and analysis reports: 30 s to open). The same rows
 * are found here by grouping each table once and joining it.
 */

const ADDON_FIRST = /adata\.aon_key\s+in\s*\(\s*select\s+a\.aon_key\s+from\s+(\S*?)addon_data\s+a\s+where\s+a\.prod_id\s*=\s*product\.prod_key\s+limit\s+1\s*\)/gi;
const LATEST_MRP = /\(\s*select\s+pl_mrp\s+from\s+(\S*?)pricelist\s+where\s+prod_id\s*=\s*product\.prod_key\s+and\s+pl_pos\s*<>\s*'D'\s+and\s+pl_mrp\s*>\s*0\s+order\s+by\s+pl_wefrom\s+desc\s+limit\s+1\s*\)/i;
const PRODUCT_TABLE = /(\S*?product_master\s+product)(?=\s)/i;

/** "The first row of another table for each row" as LEFT JOIN LATERAL (select col as ALIAS from t where key = outer.col limit 1): the Jobout No help's job card. */
const FIRST_ROW_LATERAL = /left\s+join\s+lateral\s*\(\s*select\s+(\w+)\s+as\s+(\w+)\s+from\s+(\S*?\w+)\s+where\s+(\w+)\s*=\s*(\w+)\.(\w+)\s+limit\s+1\s*\)\s+(\w+)\s+on\s+true/gi;

export function fastHelpSql(sql: string): string {
  // "The first addon row of the product" (no order: SQL Server's TOP 1 gives the first stored, in practice the lowest key).
  let out = sql.replace(ADDON_FIRST, (_all, db: string) => `adata.aon_key in (select min(a.aon_key) from ${db}addon_data a where a.prod_id is not null group by a.prod_id)`);
  // A first-row lateral lookup (no index on the key: a table read for each row) grouped once and joined.
  out = out.replace(FIRST_ROW_LATERAL, (_all, column: string, alias: string, table: string, key: string, outer: string, outerColumn: string, name: string) =>
    `left join (select distinct on (${key}) ${key} as lateral_key, ${column} as ${alias} from ${table} where ${key} is not null order by ${key}) ${name} on ${name}.lateral_key = ${outer}.${outerColumn}`);
  // The latest MRP above 0: one row per product from PRICELIST, joined beside PRODUCT_MASTER.
  const mrp = LATEST_MRP.exec(out);
  if (mrp && PRODUCT_TABLE.test(out)) {
    const db = mrp[1];
    out = out.replace(LATEST_MRP, "help_mrp.pl_mrp").replace(PRODUCT_TABLE, (table) => `${table} left join (select distinct on (prod_id) prod_id, pl_mrp from ${db}pricelist where pl_pos<>'D' and pl_mrp > 0 order by prod_id, pl_wefrom desc) help_mrp on help_mrp.prod_id=product.prod_key`);
  }
  return out;
}

/**
 * The Patiya report's Invoice help (HELP_INVOICENO): the desktop's grid has a LOCATION column (the voucher's remark) that the PostgreSQL
 * copy of the query lacks, and a voucher without a transport would lose its DOC_NO (a NULL in the concatenation). Its order,
 * right(space(20)+DOC_NO,10), adds texts with +, which PostgreSQL refuses: the whole help came back empty.
 */
export function invoiceHelpSql(sql: string): string {
  return sql
    .replace(/\(aent\.TXT_TRANS\)::text\s+as\s+"DOC_NO"/i, `coalesce(aent.TXT_TRANS, '')::text as "DOC_NO"`)
    .replace(/right\(\s*space\(20\)\s*\+\s*DOC_NO\s*,\s*10\s*\)/i, "right(repeat(' ', 20) || DOC_NO, 10)")
    .replace(/(as\s+"DATE")(\s+FROM\b)/i, `$1,coalesce(led.doc_remark,'') as "LOCATION"$2`);
}

/**
 * Help orders written as right(space(10)+COLUMN,10) (the Job Card help of the Stock Balance reports, the Steel Plant help ...): PostgreSQL refuses
 * texts added with +, and the whole help came back empty.
 */
export function spaceConcatSql(sql: string): string {
  return sql.replace(/right\(\s*space\((\d+)\)\s*\+\s*([\w.]+)\s*,\s*(\d+)\s*\)/gi, "right(repeat(' ', $1) || $2, $3)");
}
