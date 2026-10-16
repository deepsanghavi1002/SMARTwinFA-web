import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 248: DISTRIBUTORS WISE DISPATCH CHECK (REPORT_RPI_DISTRIBUTORS_DISPATCH_CHECK, SP_FRT_RPT_RPI_DISTRIBUTORS_DISPATCH_CHECK; SPECIAL > Extra Report (RP1)).
 * The boxes (BUNDLE) sold (book 8, From..Upto) to each distributor of the ticked products (up to 10), a column for each product named by its short name,
 * and TOTAL; then the customers (book 2) of the ticked account addons that bought none of them, with nothing against them. As the procedure's PIVOT does,
 * a product's column holds the boxes of the sale lines whose description is the same as the product's SHORT name. By grade, then distributor.
 * The sale lines are one grouped read.
 */
const whole = (value: number) => Math.round(value + Math.sign(value) * 1e-9);

export async function distributorsDispatch(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const products = call.selectKey[4].trim();
  if (!/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(products)) throw new ReportRefusal("Select the products (Product Code group)", "INTERNAL PROGRAM FAILURE");
  if (products.split(",").length > 10) throw new ReportRefusal("Maximum 10 Product Selection Allowed", "INTERNAL PROGRAM FAILURE");
  const addons = [0, 1, 2, 3].filter((at) => /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[at].trim()) && call.addon[at].trim() !== "")
    .map((at) => ` AND ${call.addon[at].trim().replace(/^(p?adata)\.txt_/i, "adata.key_")} IN ${call.selectKey[at].trim()}`).join("");

  const shorts = (await runReportSql(loader, `SELECT btrim(prod_short) AS prod_short FROM ${db}product_master WHERE prod_key IN ${products} ORDER BY prod_short`)).rows.map((row) => toText(row.prod_short));
  const sales = (await runReportSql(loader, `SELECT ac.code, addrs.city, ac.name, idopt.opt_desc, adata.txt_grade, prodmas.prod_desc, sum(prodled.bundle::numeric) AS box FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`
    + ` LEFT JOIN ${db}account ac ON ac.code = prodled.code LEFT JOIN ${db}ledger led ON led.led_key = prodled.led_id LEFT JOIN ${db}addon_data adata ON adata.code = prodled.code LEFT JOIN ${db}address addrs ON addrs.code = prodled.code`
    + ` LEFT JOIN ${db}idopt_master idopt ON idopt.idopt_key::text = addrs.state_id::text WHERE prodled.il_pos = 'A' AND addrs.address_id = 1 AND led.doc_pos = 'A' AND prodmas.prod_pos = 'A' AND ac.a_pos = 'A' AND prodled.book = 8 AND prodled.led_id IS NOT NULL`
    + ` AND prodled.prod_id IN ${products} AND prodled.il_date >= $1::date AND prodled.il_date <= $2::date${addons} GROUP BY ac.code, ac.name, adata.txt_grade, prodmas.prod_desc, addrs.city, idopt.opt_desc`, [desktopDate(call.from), desktopDate(call.upto)])).rows;

  // The pivot: a row for each distributor, the boxes under the product whose short name is the line's description.
  type Party = { row: ResultRow; code: number };
  const parties = new Map<string, Party>();
  const columnOf = (description: string) => shorts.find((short) => short.toLowerCase() === description.trim().toLowerCase());
  for (const sale of sales) {
    const key = JSON.stringify([sale.code, sale.name, sale.city, sale.opt_desc, sale.txt_grade]);
    let party = parties.get(key);
    if (!party) {
      party = { code: num(sale.code), row: { Distributors: sale.name, City: sale.city, State: sale.opt_desc, Grade: sale.txt_grade, ...Object.fromEntries(shorts.map((short) => [short, null])), TOTAL: null } };
      parties.set(key, party);
    }
    const column = columnOf(toText(sale.prod_desc));
    if (column !== undefined) party.row[column] = (party.row[column] === null ? 0 : num(party.row[column])) + whole(num(sale.box));
  }
  const rows: ResultRow[] = [...parties.values()].map(({ row }) => {
    row.TOTAL = shorts.reduce((total, short) => total + Math.trunc(num(row[short])), 0);
    return row;
  });

  // The customers with no such sale.
  const sold = new Set([...parties.values()].map((party) => party.code));
  for (const row of (await runReportSql(loader, `SELECT ac.code, ac.name, addrs.city, idopt.opt_desc, adata.txt_grade FROM ${db}account ac LEFT JOIN ${db}addon_data adata ON adata.code = ac.code LEFT JOIN ${db}address addrs ON addrs.code = ac.code`
    + ` LEFT JOIN ${db}idopt_master idopt ON idopt.idopt_key = addrs.state_id WHERE ac.a_pos = 'A' AND addrs.address_id = 1 AND ac.book = 2${addons}`)).rows) {
    if (sold.has(num(row.code))) continue;
    rows.push({ Distributors: row.name, City: row.city, State: row.opt_desc, Grade: row.txt_grade, ...Object.fromEntries(shorts.map((short) => [short, null])), TOTAL: null });
  }

  const table = new ResultTable();
  const columns = ["Distributors", "City", "State", "Grade", ...shorts, "TOTAL"];
  for (const column of columns) table.addColumn(column);
  for (const column of [...shorts, "TOTAL"]) table.setKind(column, "int");
  const low = (value: unknown) => toText(value).toLowerCase();
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => low(a.row.Grade).localeCompare(low(b.row.Grade)) || low(a.row.Distributors).localeCompare(low(b.row.Distributors)) || a.index - b.index).map(({ row }) => row);
  return table;
}
