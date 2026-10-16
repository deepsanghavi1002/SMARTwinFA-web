import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 148: ORDER COMPARE (REPORT_RP_ORDER_COMPARE, SP_FRT_RPT_RP_ORDER_COMPARE; SPECIAL > Extra Report (RP) > Order Comparison).
 * For the process (job card / order) of the first combo: the purchase lines of that process (party, product, quantity, unit, rate, and the product's last
 * purchase rate, book 13) and the lines of every order linked to the same entries through PROD_LINK (PROD_LINK walked process -> entries -> all orders of those
 * entries -> their lines), laid out as one column per party holding the rate that party quoted: DESCRIPTION, QUANTITY, LAST_RATE, UNIT, then a party column each
 * (in name order), by description. The process's own lines keep their quantity / last rate / unit; the linked lines come with 0 / 0 / "" and so join in one
 * line a product. The procedure's cursors that build the key lists are single reads here.
 */
export async function orderCompare(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const process = Math.trunc(call.fcValue);
  const noRecord = () => new ReportRefusal("No Record Found", "Query Was Blank");

  // Entries of the process -> every link of those entries -> all the lines linked to them.
  const first = (await runReportSql(loader, `SELECT iled_rec1 FROM ${db}prod_link WHERE plink_flag = 'P' AND iled_rec2 IN (SELECT il_key FROM ${db}prod_ledger WHERE il_pos <> 'D' AND process_id = $1) ORDER BY iled_rec2`, [process])).rows.map((row) => num(row.iled_rec1));
  if (first.length === 0) throw noRecord();
  const entries = [...new Set((await runReportSql(loader, `SELECT DISTINCT iled_rec1 FROM ${db}prod_link WHERE iled_rec2 = ANY($1::int[])`, [first])).rows.map((row) => num(row.iled_rec1)))];
  if (entries.length === 0) throw noRecord();
  const linked = [...new Set((await runReportSql(loader, `SELECT iled_rec2 FROM ${db}prod_link WHERE iled_rec1 = ANY($1::int[])`, [entries])).rows.map((row) => num(row.iled_rec2)))];
  if (linked.length === 0) throw noRecord();

  const select = `SELECT ac.name AS name, prodmas.prod_desc AS description, prodled.rate::numeric AS rate`;
  const from = ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}account ac ON ac.code = prodled.code LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id`;
  const own = (await runReportSql(loader, `${select}, prodled.quantity::numeric AS quantity, prduom.uom_short AS unit,`
    + ` coalesce((SELECT l.rate::numeric FROM ${db}prod_ledger l WHERE l.book = 13 AND l.led_id IS NOT NULL AND l.il_pos <> 'D' AND l.prod_id = prodled.prod_id ORDER BY l.il_date DESC LIMIT 1), 0) AS last_rate`
    + `${from} LEFT JOIN ${db}prod_uom prduom ON prduom.uom_key = prodled.rateuom_id WHERE prodled.il_pos <> 'D' AND ac.a_pos <> 'D' AND prodled.process_id = $1`, [process])).rows;
  const others = (await runReportSql(loader, `${select}${from} WHERE prodled.il_pos <> 'D' AND ac.a_pos <> 'D' AND prodled.il_key = ANY($1::int[])`, [linked])).rows;

  const lines: RateLine[] = [...own.map((row) => ({ name: row.name, description: row.description, rate: row.rate, quantity: num(row.quantity), last_rate: num(row.last_rate), unit: toText(row.unit) })), ...others.map((row) => ({ name: row.name, description: row.description, rate: row.rate, quantity: 0, last_rate: 0, unit: "" }))];
  return pivotRates(lines);
}

type RateLine = { name: unknown; description: unknown; rate: unknown; quantity: number; last_rate: number; unit: string };

/** The procedures' PIVOT: a row for each description / quantity / last rate / unit, a column for each party holding the sum of its rates. */
function pivotRates(lines: RateLine[]): ResultTable {
  // Party columns: distinct names, in name order (SQL Server's case-insensitive order).
  const names: string[] = [];
  for (const line of lines) {
    const name = toText(line.name);
    if (!names.some((known) => known.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const table = new ResultTable();
  for (const column of ["description", "quantity", "last_rate", "unit", ...names]) table.addColumn(column);
  for (const column of ["quantity", "last_rate", ...names]) table.setKind(column, "decimal");
  const grouped = new Map<string, Record<string, unknown>>();
  for (const line of lines) {
    const key = `${toText(line.description).toLowerCase()}\u0000${line.quantity}\u0000${line.last_rate}\u0000${line.unit.toLowerCase()}`;
    let row = grouped.get(key);
    if (!row) {
      row = { description: line.description, quantity: line.quantity, last_rate: line.last_rate, unit: line.unit };
      for (const name of names) row[name] = null;
      grouped.set(key, row);
    }
    const column = names.find((name) => name.toLowerCase() === toText(line.name).toLowerCase())!;
    if (line.rate !== null && line.rate !== undefined) row[column] = (row[column] === null ? 0 : num(row[column])) + num(line.rate);
  }
  table.rows = [...grouped.values()].map((row, index) => ({ row, index })).sort((a, b) => toText(a.row.description).toLowerCase().localeCompare(toText(b.row.description).toLowerCase()) || a.index - b.index).map(({ row }) => row);
  return table;
}


/**
 * 149: INDENT COMPARE (REPORT_RP_INDENT_COMPARE, SP_FRT_RPT_RP_INDENT_COMPARE; SPECIAL > Extra Report (RP) > Indent Comparison).
 * For the indent (process) of the first combo: the lines linked to it through PROD_LINK, as in the Order Compare (a column for each party holding its rate,
 * with the quantity, last purchase rate and unit). With "Pending Indent" ticked: the indent lines (IND-PURCH) with a quantity not yet against and
 * no link made, as INDENT_NO, INDENT_DATE, DESCRIPTION, QUANTITY, UNIT by date.
 */
export async function indentCompare(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  if (call.checkQuery.includes("CHK_PENDINDENT,")) {
    const rows = (await runReportSql(loader, `SELECT prodled.full_docno, prodled.il_date, prodmas.prod_desc, prodled.quantity::numeric AS quantity, prduom.uom_short FROM ${db}prod_ledger prodled`
      + ` LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}prod_uom prduom ON prduom.uom_key = prodled.rateuom_id LEFT JOIN ${db}process proce ON proce.process_key = prodled.process_id`
      + ` WHERE prodled.il_pos <> 'D' AND proce.il_pos <> 'D' AND btrim(proce.stk_module) = 'IND-PURCH' AND prodled.quantity - coalesce(prodled.ag_qty, 0) > 0`
      + ` AND prodled.process_id NOT IN (SELECT coalesce(led_rec1, 0) FROM ${db}prod_link WHERE plink_flag = 'P') ORDER BY prodled.il_date, prodled.il_key`)).rows;
    const table = new ResultTable();
    for (const column of ["INDENT_NO", "INDENT_DATE", "DESCRIPTION", "QUANTITY", "UNIT"]) table.addColumn(column);
    table.setKind("QUANTITY", "decimal");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    table.rows = rows.map((row) => {
      const date = row.il_date as Date;
      return { INDENT_NO: toText(row.full_docno), INDENT_DATE: `${String(date.getDate()).padStart(2, "0")}-${months[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`, DESCRIPTION: row.prod_desc, QUANTITY: num(row.quantity), UNIT: row.uom_short };
    });
    return table;
  }
  const linked = [...new Set((await runReportSql(loader, `SELECT iled_rec2 FROM ${db}prod_link WHERE plink_flag = 'P' AND led_rec1 = $1`, [Math.trunc(call.fcValue)])).rows.map((row) => num(row.iled_rec2)))];
  if (linked.length === 0) throw new ReportRefusal("No Record Found", "Query Was Blank");
  const rows = (await runReportSql(loader, `SELECT ac.name AS name, prodmas.prod_desc AS description, prodled.rate::numeric AS rate, prodled.quantity::numeric AS quantity, prduom.uom_short AS unit,`
    + ` coalesce((SELECT l.rate::numeric FROM ${db}prod_ledger l WHERE l.book = 13 AND l.led_id IS NOT NULL AND l.il_pos <> 'D' AND l.prod_id = prodled.prod_id ORDER BY l.il_date DESC LIMIT 1), 0) AS last_rate`
    + ` FROM ${db}prod_ledger prodled LEFT JOIN ${db}account ac ON ac.code = prodled.code LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}prod_uom prduom ON prduom.uom_key = prodled.rateuom_id`
    + ` WHERE prodled.il_pos <> 'D' AND ac.a_pos <> 'D' AND prodled.il_key = ANY($1::int[])`, [linked])).rows;
  if (rows.length === 0) throw new ReportRefusal("No Record Found", "Query Was Blank");
  return pivotRates(rows.map((row) => ({ name: row.name, description: row.description, rate: row.rate, quantity: num(row.quantity), last_rate: num(row.last_rate), unit: toText(row.unit) })));
}
