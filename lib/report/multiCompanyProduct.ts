import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";
import { SYSTEM_SCHEMA } from "../master-program/session";

/**
 * 116: MULTI COMPANY PRODUCT ANALYSIS (SP_FRT_RPT_MULTI_COMP_PROD_ANALYSIS_REP; ANALYSIS REP. > Multi Company > Product Analysis).
 *
 * The products of every company of the group that has the year (a short name; the ticked ones of the Book group) side by side, one quantity
 * chosen in the first combo: 1 Stock (the year's opening plus every movement to Upto; inventory products only), 2 Opening, 3 Sale, 4 Purchase,
 * 5 Credit Note, 6 Debit Note, 7 Stock Add, 8 Stock Less (From .. Upto). A row a product code and description, a column a company (every
 * company of the group, also one with no row), TOTAL. A product with nothing in a company is not counted there (a product with nothing in any
 * is left out). Licence 7's Stock is a row a product with its addon attributes (main group / brand, paper Kgs, brand, company, panel code,
 * finish, status, group) and keeps the zero rows, ordered by brand and product. Licence 2 (Vinayak) takes the quantity from TRN_QTY3.
 * Each company is one grouped read.
 */
const SCHEMA = /^[a-z0-9_]+$/;

const ATTRIBUTES = ["PROD_CODE", "PROD_DESC"];
const LICENCE7 = ["MAIN_GROUP", "MAIN_BRAND", "Paper_Kgs", "BRAND", "PROD_COMPANY", "PANEL_CODE", "PRODUCT", "PROD_FINISH", "PROD_STATUS", "PROD_GROUP"];

export async function multiCompanyProduct(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const combo = call.fcValue;
  const vinayak = call.licence === 2;
  const panel = call.licence === 7 && combo === 1;
  if (!Number.isInteger(combo) || combo < 1 || combo > 8) return new ResultTable();

  const companies = (await runReportSql(loader, `SELECT lower(btrim(c.co_dataname)) AS schema_name, btrim(c.co_short) AS short FROM ${SYSTEM_SCHEMA}.cname n LEFT JOIN ${SYSTEM_SCHEMA}.company c ON c.co_key = n.c_id`
    + ` WHERE n.c_tarikh1::date = $1::date AND n.c_tarikh2::date = $2::date AND coalesce(btrim(c.co_short), '') <> ''`
    + ` AND c.co_group_name = (SELECT co_group_name FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $3)`
    + (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectBookKey.trim()) ? ` AND c.co_key IN ${call.selectBookKey.trim()}` : "")
    + ` ORDER BY c.co_short`, [desktopDate(call.tarikh1), desktopDate(call.tarikh2), call.companyKey])).rows;

  const attributes = panel ? LICENCE7 : ATTRIBUTES;
  const attributeSql = panel
    ? ["padata.txt_maingroup", "padata.txt_mainbran", "padata.input_pap_kgs", "padata.txt_prodbran", "padata.txt_prodcomp", "product.level_2", "product.level_1", "padata.txt_prodfinish", "padata.txt_prodstat", "padata.txt_prodgroup"]
    : ["product.prod_short", "product.prod_desc"];
  const shorts = companies.map((company) => toText(company.short));

  const table = new ResultTable();
  for (const name of attributes) table.addColumn(name);
  for (const short of shorts) table.setKind(short, "decimal");
  table.setKind("TOTAL", "decimal");

  const quantity = vinayak ? "trn_qty3" : "(quantity - ag_qty)";
  // The movement by product: the expression summed and the rows it is taken over (the dates are $1 .. $2: the year's start (stock) or From, and Upto).
  const movement: Record<number, { expr: string; where: string }> = {
    1: { expr: "CASE WHEN stock_nat = 'A' THEN (quantity - ag_qty) ELSE -(quantity - ag_qty) END", where: "il_pos = 'A' AND inventory = 'Y'" },
    3: { expr: `CASE WHEN stock_nat = 'L' THEN ${quantity} ELSE 0 END`, where: `il_pos = 'A' AND inventory = 'Y' AND book = 8 AND ${vinayak ? "process_id IS NULL" : "(process_id IS NULL OR trn_module = 'CHLN-OUT')"}` },
    4: { expr: `CASE WHEN stock_nat = 'A' THEN ${quantity} ELSE 0 END`, where: `il_pos = 'A' ${vinayak ? "" : "AND inventory = 'Y' "}AND book = 13 AND ${vinayak ? "process_id IS NULL" : "(process_id IS NULL OR trn_module = 'CHLN-IN')"}` },
    5: { expr: quantity, where: "il_pos = 'A' AND book = 16 AND process_id IS NULL" },
    6: { expr: quantity, where: "il_pos = 'A' AND book = 11 AND process_id IS NULL" },
    7: { expr: quantity, where: "il_pos = 'A' AND trn_stkmid = 'SA' AND led_id IS NULL" },
    8: { expr: quantity, where: "il_pos = 'A' AND trn_stkmid = 'SL' AND led_id IS NULL" },
  };

  const cells = new Map<string, { values: string[]; byCompany: Map<string, number> }>();
  const params = [desktopDate(combo === 1 ? call.tarikh1 : call.from), desktopDate(call.upto)];
  for (const company of companies) {
    const schema = toText(company.schema_name);
    const short = toText(company.short);
    if (!SCHEMA.test(schema)) continue;
    const exists = (await runReportSql(loader, "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('product_master','prod_balance','prod_ledger')", [schema])).rows[0];
    if (num(exists?.n) < 3) continue;

    const opening = `(SELECT prod_id, sum(open_pcs) AS o FROM ${schema}.prod_balance WHERE prec_flag = 'RP' GROUP BY prod_id) b ON b.prod_id = product.prod_key`;
    const moved = combo === 2 ? "" : ` LEFT JOIN (SELECT prod_id, sum(${movement[combo].expr}) AS v FROM ${schema}.prod_ledger WHERE ${movement[combo].where} AND il_date BETWEEN $1 AND $2 GROUP BY prod_id) l ON l.prod_id = product.prod_key`;
    const value = combo === 1 ? "coalesce(b.o, 0) + coalesce(l.v, 0)" : combo === 2 ? "coalesce(b.o, 0)" : "coalesce(l.v, 0)";
    const sql = `SELECT ${attributeSql.map((expression, index) => `coalesce(${expression}::text, '') AS a${index}`).join(", ")}, ${value} AS v FROM ${schema}.product_master product`
      + (panel ? ` LEFT JOIN ${schema}.addon_data padata ON padata.prod_id = product.prod_key` : "")
      + (combo <= 2 ? ` LEFT JOIN ${opening}` : "") + moved
      + ` WHERE product.prod_pos <> 'D'${combo <= 2 ? " AND product.inventory = 'Y'" : ""}`;
    const rows = (await runReportSql(loader, sql, combo === 2 ? [] : params)).rows;
    for (const row of rows) {
      const amount = Math.round(num(row.v) * 100) / 100;
      if (amount === 0 && !panel) continue;
      const values = attributes.map((_, index) => toText(row[`a${index}`]));
      const key = values.join("\u0000");
      const entry = cells.get(key) ?? { values, byCompany: new Map<string, number>() };
      entry.byCompany.set(short, Math.round(((entry.byCompany.get(short) ?? 0) + amount) * 100) / 100);
      cells.set(key, entry);
    }
  }

  for (const short of shorts) table.addColumn(short);
  table.addColumn("TOTAL");
  const rows: ResultRow[] = [];
  for (const entry of cells.values()) {
    const row: ResultRow = {};
    attributes.forEach((name, index) => { row[name] = entry.values[index]; });
    let total = 0;
    for (const short of shorts) { const value = entry.byCompany.get(short); row[short] = value ?? null; total += value ?? 0; }
    row.TOTAL = Math.round(total * 100) / 100;
    rows.push(row);
  }
  const order = panel ? ["BRAND", "PRODUCT"] : ["PROD_CODE"];
  const lower = (value: unknown) => toText(value).toLowerCase();
  rows.sort((a, b) => { for (const name of order) { const result = lower(a[name]).localeCompare(lower(b[name])); if (result !== 0) return result; } return 0; });
  table.rows = rows;
  return table;
}
