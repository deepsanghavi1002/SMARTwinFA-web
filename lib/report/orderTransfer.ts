import type { Client } from "pg";
import type { Loader } from "../master-program/load";
import type { MasterSession } from "../master-program/session";
import { transaction } from "../db";
import { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { alignSequences } from "./autoBilling";
import { num } from "./run";

/**
 * 285: RPI AUTO ORDER TRANSFER (REPORT_RPI_ORDER_TRANSFER, SP_FRT_RPT_RPI_AUTO_ORDER_TRF; TRANSACTION > Auto Entry > Rp Auto Order Transfer Generate).
 * Not a listing: the sale invoices (book 8, posted) of the dates From .. Upto that were made to the chosen company (one only, the company's account of
 * book 2 here) are made in that company as purchase orders (ORD-PURCH, series ODi, the invoice's number, date and amount; ENTRY_NO the invoice's document
 * no), with the invoice's slabs and product lines (the products matched by short name); an invoice that already has its order there (same number, this
 * company's account) is left out. The output lists the orders made there: party, document no, date and amount.
 * Web differences from the procedure: a line's own slabs go to its own line (the procedure's join gives every line of the order the slabs of all its lines);
 * a company that has no account here (book 2) or this company no account there (book 3) is refused (the procedure would write account 0).
 */
const refuse = (message: string) => new ReportRefusal(message, "Order Transfer");
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const SCHEMA = /^[a-z_][a-z0-9_]*$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function orderTransfer(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const keys = call.selectBookKey.replace(/[()]/g, "").trim();
  if (keys.includes(",")) throw refuse("Multiple Company Selection Not Allowed");
  if (keys === "" || !/^\d+$/.test(keys)) throw refuse("One Company Should Select");
  const rows = await transaction(async (client) => await writeOrders(client, loader.session, Number(keys), isoDay(call.from), isoDay(call.upto)), { timeoutMs: 600000 });
  const table = new ResultTable();
  for (const column of ["NAME", "DOC_NO", "Order_Date", "AMOUNT"]) table.addColumn(column);
  table.setKind("AMOUNT", "decimal");
  table.rows = rows.map((row) => {
    const date = row.p_date as Date;
    return { NAME: row.name, DOC_NO: row.full_docno, Order_Date: `${String(date.getDate()).padStart(2, "0")}-${MONTHS[date.getMonth()]}-${String(date.getFullYear()).slice(2)}`, AMOUNT: num(row.p_amount) };
  });
  return table;
}

export async function writeOrders(client: Client, session: MasterSession, companyKey: number, from: string, upto: string): Promise<Record<string, unknown>[]> {
  const s = session.companySchema;
  const company = (await client.query("SELECT btrim(name) AS name, lower(btrim(co_dataname)) AS schema FROM smart_system.company WHERE co_key = $1 AND co_pos <> 'D'", [companyKey])).rows[0];
  if (!company) throw refuse("The selected company is not found");
  const trf = String(company.schema);
  if (!SCHEMA.test(trf) || trf === s || (await client.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [trf])).rowCount === 0) throw refuse("The selected company's database is not available");
  const year = `'${session.yearId.replace(/'/g, "''")}'`;
  const step = async (label: string, sql: string, params: unknown[] = []) => {
    try { return await client.query(sql, params); }
    catch (error) { throw new Error(`Order transfer stopped at "${label}": ${error instanceof Error ? error.message : String(error)}`); }
  };
  const scalar = async (label: string, sql: string, params: unknown[] = []) => (await step(label, sql, params)).rows[0]?.v;

  const entAccount = Number(await scalar("company account", `SELECT code AS v FROM ${s}.account WHERE a_pos <> 'D' AND btrim(name) = $1 AND book = 2 ORDER BY code LIMIT 1`, [company.name])) || 0;
  if (!entAccount) throw refuse(`${company.name} is not an account of this company (book 2).`);
  const account = Number(await scalar("this company's account", `SELECT code AS v FROM ${trf}.account WHERE a_pos <> 'D' AND btrim(name) = btrim($1) AND book = 3 ORDER BY code LIMIT 1`, [session.companyName])) || 0;
  if (!account) throw refuse(`${session.companyName.trim()} is not an account of ${company.name} (book 3).`);
  const purchBook = Number(await scalar("purchase book", `SELECT code AS v FROM ${trf}.account WHERE book = 22 AND a_pos <> 'D' ORDER BY code LIMIT 1`)) || 0;

  await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa-entry-save'))");
  await alignSequences(client, [[`${trf}.process`, "process_key"], [`${trf}.prod_ledger`, "il_key"], [`${trf}.ledger_ext`, "ledext_key"]]);
  const top = Number(await scalar("last order key", `SELECT coalesce(max(process_key), 0) AS v FROM ${trf}.process`));

  await step("orders", `INSERT INTO ${trf}.process (stk_module, code, p_date, doc_no2, p_docseries, full_docno, p_bkdbcode, p_amount, book, stk_remark, entry_for, post_date, il_pos, year_id, entry_no, last_savedate, last_savetime, trf_processkey)`
    + ` SELECT 'ORD-PURCH', ${account}, led.doc_date, led.doc_no, 'ODi', 'ODi/' || ltrim(rtrim(led.doc_no)), 1, coalesce(led.amount::numeric, 0), 13, '', 'P', led.doc_date, 'A', ${year}, led.full_docno, now()::date, to_char(now(), 'HH24:MI:SS'), led.led_key`
    + ` FROM ${s}.ledger led WHERE led.book = 8 AND led.doc_pos = 'A' AND led.doc_posting = 'P' AND led.doc_date BETWEEN $1::date AND $2::date AND led.code = ${entAccount}`
    + ` AND NOT EXISTS (SELECT 1 FROM ${trf}.process p WHERE p.il_pos = 'A' AND btrim(p.stk_module) = 'ORD-PURCH' AND btrim(p.doc_no2) = btrim(led.doc_no) AND p.code = ${account}) ORDER BY led.doc_no, led.doc_date`, [from, upto]);
  await step("order slabs", `INSERT INTO ${trf}.ledger_ext (process_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT p.process_key, e.slab_id, e.slab_amt, e.s_lastot, 'N', 0, null::int, ${year}`
    + ` FROM ${trf}.process p, ${s}.ledger_ext e WHERE e.led_id = p.trf_processkey AND e.il_id IS NULL AND p.process_key > ${top}`);
  await step("order lines", `INSERT INTO ${trf}.prod_ledger (process_id, il_serial, doc_no1, prod_id, il_prodcd, il_billdesc, quantity, rate, master_rate, prate_id, il_value, book, book_code, rateuom_id, uomentry_id, "TYPE", il_date, stock_nat, code, il_pos, full_docno, slab_cost, cost_rate,`
    + ` inventory, stock_type, factor, trn_qty1, trn_qty2, trn_qty3, trn_pcs, trn_pack, trn_weight, ag_qty, ag_fact, order_no, pack_qty, bundle, loose_qty, il_div, year_id, dis_paisa, trn_module, trn_stkmid)`
    + ` SELECT p.process_key, l.il_serial, p.doc_no2, (SELECT prod_key FROM ${trf}.product_master WHERE prod_pos <> 'D' AND prod_short IN (SELECT prod_short FROM ${s}.product_master WHERE prod_pos <> 'D' AND prod_key = l.prod_id) ORDER BY prod_key LIMIT 1), l.il_prodcd, l.il_billdesc,`
    + ` l.quantity, l.rate, l.master_rate, 0, abs(l.il_value::numeric), 13, ${purchBook}, l.rateuom_id, l.uomentry_id, 0, p.p_date, 'A', ${account}, l.il_pos, p.full_docno, l.slab_cost, l.cost_rate, 'N', 'R', l.factor, l.trn_qty1, l.trn_qty2, l.trn_qty3, l.trn_pcs, l.trn_pack, l.trn_weight, 0, 0, l.full_docno,`
    + ` l.pack_qty, l.bundle, l.loose_qty, l.il_div, ${year}, l.prod_id, 'ORD-PURCH', 'OR' FROM ${trf}.process p, ${s}.prod_ledger l WHERE l.led_id = p.trf_processkey AND l.il_pos = 'A' AND p.process_key > ${top} ORDER BY l.il_date, l.il_serial`);
  // A line's slabs go to its own line: the invoice line (il_id) names the product and serial the order line was made from.
  await step("order line slabs", `INSERT INTO ${trf}.ledger_ext (process_id, il_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT p.process_key, t.il_key, e.slab_id, e.slab_amt, e.s_lastot, 'N', e.slab_perc, e.tax_id, ${year}`
    + ` FROM ${trf}.process p, ${s}.ledger_ext e, ${s}.prod_ledger l, ${trf}.prod_ledger t WHERE e.led_id = p.trf_processkey AND e.il_id IS NOT NULL AND l.il_key = e.il_id AND t.process_id = p.process_key AND t.dis_paisa = l.prod_id AND t.il_serial = l.il_serial AND p.process_key > ${top}`);

  return (await step("orders made", `SELECT ac.name, p.full_docno, p.p_date, p.p_amount::numeric AS p_amount FROM ${trf}.process p LEFT JOIN ${trf}.account ac ON ac.code = p.code WHERE p.process_key > ${top} ORDER BY p.process_key`)).rows;
}
