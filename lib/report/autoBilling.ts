import type { Client } from "pg";
import type { Loader } from "../master-program/load";
import type { MasterSession } from "../master-program/session";
import { toText } from "../master-program/legacy";
import { transaction } from "../db";
import { repostData } from "../utility/repost";
import { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 78: RP AUTO BILLING GENERATE (REPORT_TJ_AUTO_BILL, SP_FRT_RPT_RPI_AUTOBILL; TRANSACTION > Auto Entry > Rp Auto Billing Generate). Not a listing: it
 * writes the sale invoices of the party orders that have been allotted (SALE), and then lists the invoices it made.
 *  - Lines: the ORD-OUT order lines with an allotted quantity and a lot no, not yet fully billed (ordered less billed above 0), their value being rate x
 *    allotted quantity; the line's discounts (slabs 188 / 227 / 225 / 226 / 231, each on what is left after the one before) and its tax (189) and UTGST (222).
 *  - Bills: one invoice for each party, tax %, UTGST % and lot no, dated the Upto date, numbered after the highest number of the sale book's series. The bill is
 *    the lines' value less the discounts plus the taxes and the TCS (slab 228) of its orders, rounded to a whole rupee (the difference is the ROUNDING slab).
 *  - Written for each bill: the ledger row and its postings, the slabs, the outstanding row, the transport addon of its orders, the product lines (with the
 *    link to the order line, whose billed quantity goes up and whose allotment and lot no are cleared), the stock and account balances, the log rows and the
 *    special log (the readable copy of the entry). When the party is itself a company of the same year, the ORD-PURCH order is made in that company too.
 *    Last, the postings are re-posted (SP_REPOST_DATA: account and verify blocks).
 *  - Output: the invoices made (date, number, document no, series, party, amount). Refused when the Upto date falls in the sale book's lock period.
 * The web does the writing in a transaction of its own (the report screen's reads cannot write).
 * Web differences from the procedure: only SALE is ported (PURCHASE numbers its bills on a delivery date it never sets, so it makes none); one ledger row is
 * written for each bill even when the lines of its orders differ in batch no, E-way details or delivery address (the procedure's DISTINCT would make a second
 * bill); the PRODUCT / ACCOUNT balances of lines that were not billed are not touched; licences other than 21 (SP_FRT_RPT_TJ_AUTOBILL) are not ported.
 */

const refuse = (message: string) => new ReportRefusal(message, "Auto Bill");
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const SCHEMA = /^[a-z_][a-z0-9_]*$/;
const DISCOUNTS = [[188, "dis_amt1", "dis_perc1"], [227, "dis_amt2", "dis_perc2"], [225, "dis_amt3", "dis_perc3"], [226, "dis_amt4", "dis_perc4"], [231, "dis_amt5", "dis_perc5"]] as const;
const ALL_TAKEN = (n: number) => Array.from({ length: n }, (_, index) => `dis_amt${index + 1}`).map((name) => `coalesce(${name}, 0)`).join(" - ");

export async function autoBilling(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const { session } = loader;
  const kind = call.fcText.trim().toUpperCase();
  if (kind !== "SALE") throw refuse(kind === "PURCHASE" ? "Auto bill of PURCHASE orders is not ported." : "Select SALE.");
  if (session.licence !== 21) throw refuse(session.licence === 0 || call.selectKey[0].trim() === "" ? "Minimum One Godown Should be Select" : "Auto bill of this company's licence (SP_FRT_RPT_TJ_AUTOBILL) is not ported.");
  const upto = isoDay(call.upto);
  // The sale book's lock: an entry period locked up to or beyond the Upto date.
  const locked = (await runReportSql(loader, `SELECT lock_upto FROM ${call.database}book_setup WHERE book = 8 AND book_code = 16 AND lock_upto >= $1::date AND lock_upto IS NOT NULL LIMIT 1`, [upto])).rows[0];
  if (locked) {
    const date = locked.lock_upto as Date;
    throw refuse(` Selected Date Entry Period Is Lock Upto ${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`);
  }
  const rows = await transaction(async (client) => {
    const made = await writeBills(client, session, upto);
    // Postings re-posted: SP_REPOST_DATA with the account and verify blocks (the procedure runs it after the save).
    await repostData(client, session, { account: true, outstanding: false, productRecalc: false, product: false, verify: true });
    return made;
  }, { timeoutMs: 600000 });
  const table = new ResultTable();
  for (const column of ["SELECTED_DATE", "doc_no", "full_docno", "doc_series", "name", "amount"]) table.addColumn(column);
  table.setKind("amount", "decimal");
  table.rows = rows.map((row) => ({ SELECTED_DATE: row.selected_date, doc_no: row.doc_no, full_docno: row.full_docno, doc_series: row.doc_series, name: row.name, amount: num(row.amount) }));
  return table;
}

/** A sequence found behind its table's largest key (the migrated tables' can be) is moved up before rows are added. */
export async function alignSequences(client: Client, tables: readonly (readonly [string, string])[]) {
  for (const [table, keyColumn] of tables) {
    const sequence = (await client.query("SELECT pg_get_serial_sequence($1, $2) AS sequence", [table, keyColumn])).rows[0]?.sequence as string | null;
    if (!sequence) continue;
    const top = Number((await client.query(`SELECT COALESCE(MAX(${keyColumn}), 0) AS top FROM ${table}`)).rows[0].top);
    const seen = (await client.query(`SELECT last_value, is_called FROM ${sequence}`)).rows[0];
    if (Number(seen.last_value) + (seen.is_called ? 1 : 0) <= top) await client.query("SELECT setval($1, $2, true)", [sequence, top]);
  }
}

/** The sums of an insert's columns: the column list and the select list kept side by side. */
const columnsOf = (map: readonly (readonly [string, string])[]) => `(${map.map(([column]) => (column === "type" ? '"TYPE"' : column)).join(", ")})`;
const valuesOf = (map: readonly (readonly [string, string])[]) => map.map(([, value]) => value).join(", ");

export async function writeBills(client: Client, session: MasterSession, upto: string): Promise<Record<string, unknown>[]> {
  const s = session.companySchema;
  if (!SCHEMA.test(s)) throw refuse("The company's database name is not a valid schema");
  const big = `${s}_biglog`;
  const year = q(session.yearId);
  const host = q("WEB");
  const user = Number(session.userNo) || 0;
  const step = async (label: string, sql: string, params: unknown[] = []) => {
    try { return await client.query(sql, params); }
    catch (error) { throw new Error(`Auto bill stopped at "${label}": ${error instanceof Error ? error.message : String(error)}`); }
  };
  const scalar = async (label: string, sql: string, params: unknown[] = []) => (await step(label, sql, params)).rows[0]?.v;

  await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa-entry-save'))");

  // ---- The order lines to bill ----
  const slab = (id: number, column: string, scope: "line" | "bill") => `coalesce((SELECT ${column}::numeric FROM ${s}.ledger_ext WHERE slab_id = ${id} AND ${scope === "line" ? "il_id = prodled.il_key" : "process_id = proce.process_key AND il_id IS NULL"} LIMIT 1), 0)`;
  const lineSlabs = [...DISCOUNTS.flatMap(([id, amount], index) => [`${slab(id, "slab_perc", "line")} AS dis_perc${index + 1}`, `${slab(id, "slab_amt", "line")} AS ${amount}`]),
    `coalesce((SELECT tax_id FROM ${s}.ledger_ext WHERE slab_id = 189 AND il_id = prodled.il_key LIMIT 1), 0) AS tax_id`, `${slab(189, "slab_perc", "line")} AS tax_perc`, `${slab(189, "slab_amt", "line")} AS tax_amt`,
    `coalesce((SELECT tax_id FROM ${s}.ledger_ext WHERE slab_id = 222 AND il_id = prodled.il_key LIMIT 1), 0) AS sgst_id`, `${slab(222, "slab_perc", "line")} AS sgst_perc`, `${slab(222, "slab_amt", "line")} AS sgst_amt`,
    `${slab(191, "slab_amt", "bill")} AS gross_amt`,
    ...DISCOUNTS.map(([id], index) => `${slab(id, "slab_amt", "bill")} AS tot_dis_amt${index + 1}`),
    `${slab(189, "slab_amt", "bill")} AS tot_tax_amt`, `${slab(222, "slab_amt", "bill")} AS tot_sgst_amt`, `${slab(228, "slab_perc", "bill")} AS tot_tcs_perc`, `${slab(228, "slab_amt", "bill")} AS tot_tcs_amt`, `${slab(187, "slab_amt", "bill")} AS rounding`];
  await step("order lines", `CREATE TEMP TABLE tt_autobill ON COMMIT DROP AS SELECT row_number() OVER (ORDER BY prodled.code, proce.doc_no2, proce.post_date DESC, prodled.il_serial) AS ord, prodled.*,`
    + ` proce.process_key, proce.post_date, proce.delv_date, proce.doc_no2, proce.p_amount, proce.eway_billno, proce.eway_billdate, proce.eway_valid, proce.supply_type, proce.sub_supply_type, proce.eway_doc_type, proce.trp_mode, proce.distance_km, proce.eway_veh_type, proce.ent_address_id,`
    + ` ${lineSlabs.join(", ")} FROM ${s}.prod_ledger prodled LEFT JOIN ${s}.process proce ON proce.process_key = prodled.process_id`
    + ` WHERE btrim(prodled.trn_module) = 'ORD-OUT' AND coalesce(prodled.allot_qty, 0) > 0 AND coalesce(prodled.lot_no, '') <> '' AND prodled.il_pos = 'A' AND proce.il_pos = 'A' AND prodled.quantity - coalesce(prodled.ag_qty, 0) > 0`);
  // The money columns are worked on as numbers.
  await step("numeric columns", `DO $$ DECLARE r record; BEGIN FOR r IN SELECT column_name FROM information_schema.columns WHERE table_schema LIKE 'pg\\_temp%' AND table_name = 'tt_autobill' AND data_type = 'money' LOOP EXECUTE format('ALTER TABLE tt_autobill ALTER COLUMN %I TYPE numeric USING %I::numeric', r.column_name, r.column_name); END LOOP; END $$`);
  if (Number(await scalar("count", "SELECT count(*) AS v FROM tt_autobill")) === 0) throw refuse("NO RECORD FOUND");

  await step("lines", `UPDATE tt_autobill SET il_value = round(rate * allot_qty, 2), delv_date = $1::date`, [upto]);
  for (const [index, [, amount, perc]] of DISCOUNTS.entries()) {
    await step(`discount ${index + 1}`, `UPDATE tt_autobill SET ${amount} = round(((il_value${index > 0 ? ` - ${ALL_TAKEN(index)}` : ""}) * ${perc}) / 100, 2) WHERE ${perc} > 0`);
  }
  await step("tax", `UPDATE tt_autobill SET tax_amt = round(((il_value - ${ALL_TAKEN(5)}) * tax_perc) / 100, 2) WHERE tax_perc > 0`);
  await step("utgst", `UPDATE tt_autobill SET sgst_amt = round(((il_value - ${ALL_TAKEN(5)}) * sgst_perc) / 100, 2) WHERE coalesce(sgst_perc, 0) > 0`);

  await step("work columns", `ALTER TABLE tt_autobill ADD COLUMN temp_doc_no varchar(10), ADD COLUMN temp_doc_no1 varchar(10), ADD COLUMN temp_led_id int, ADD COLUMN sale_series varchar(20), ADD COLUMN bill_date timestamp, ADD COLUMN sale_code int,`
    + ` ADD COLUMN sale_docno varchar(100), ADD COLUMN il_id int, ADD COLUMN purch_il_id int DEFAULT 0, ADD COLUMN purch_led_id int DEFAULT 0, ADD COLUMN purch_docno varchar(100)`);

  // ---- The sale book: its account, series and the highest number used ----
  const saleCode = Number(await scalar("sale book", `SELECT code AS v FROM ${s}.account WHERE book = 8 AND btrim(name) = 'SALE' AND a_pos <> 'D' AND a_short <> 'SALEDIR' ORDER BY code LIMIT 1`));
  if (!saleCode) throw refuse("The SALE book account is not found");
  const series = toText(await scalar("sale series", `SELECT bn_series AS v FROM ${s}.book_number WHERE bn_pos <> 'D' AND bn_id IN (SELECT bs_rec FROM ${s}.book_setup WHERE book_code = $1) LIMIT 1`, [saleCode])).trim();
  const last = Number(await scalar("last number", `SELECT max(nullif(regexp_replace(btrim(doc_no), '[^0-9]', '', 'g'), '')::bigint) AS v FROM ${s}.ledger WHERE book = 8 AND doc_series = $1 AND doc_pos <> 'D' AND doc_posting = 'P'`, [series])) || 0;
  await step("bill numbers", `WITH keys AS (SELECT code, tax_perc, sgst_perc, lot_no, ${last} + dense_rank() OVER (ORDER BY code, tax_perc, sgst_perc, lot_no) AS no FROM (SELECT DISTINCT code, tax_perc, sgst_perc, lot_no FROM tt_autobill) d)`
    + ` UPDATE tt_autobill t SET temp_doc_no = lpad(keys.no::text, 10), temp_doc_no1 = lpad(keys.no::text, 10), bill_date = $1::date, sale_series = $2::varchar, sale_docno = $2::varchar || '/' || keys.no, purch_docno = 'Odi/' || keys.no, sale_code = $3`
    + ` FROM keys WHERE t.code = keys.code AND t.tax_perc = keys.tax_perc AND t.sgst_perc = keys.sgst_perc AND t.lot_no IS NOT DISTINCT FROM keys.lot_no`, [upto, series, saleCode]);

  // ---- The bills' totals: the lines' sums, the rounded bill amount and the rounding ----
  await step("bill totals", `WITH b AS (SELECT temp_doc_no, sale_docno, sum(il_value) v, ${DISCOUNTS.map((_, index) => `sum(dis_amt${index + 1}) d${index + 1}`).join(", ")}, sum(tax_amt) t, sum(sgst_amt) g,`
    + ` coalesce((array_agg(tot_tcs_amt ORDER BY ord DESC))[1], 0) AS tcs FROM tt_autobill GROUP BY temp_doc_no, sale_docno),`
    + ` c AS (SELECT *, v - d1 - d2 - d3 - d4 - d5 + t + g + tcs AS amt FROM b)`
    + ` UPDATE tt_autobill x SET tot_dis_amt1 = c.d1, tot_dis_amt2 = c.d2, tot_dis_amt3 = c.d3, tot_dis_amt4 = c.d4, tot_dis_amt5 = c.d5, tot_tax_amt = c.t, tot_sgst_amt = c.g, gross_amt = c.v, p_amount = round(c.amt, 0), rounding = -(c.amt - round(c.amt, 0))`
    + ` FROM c WHERE x.temp_doc_no = c.temp_doc_no AND x.sale_docno = c.sale_docno`);
  await step("line serials", `UPDATE tt_autobill t SET il_serial = r.rnk FROM (SELECT ord, row_number() OVER (PARTITION BY sale_docno ORDER BY ord) AS rnk FROM tt_autobill) r WHERE t.ord = r.ord`);

  await alignSequences(client, [[`${s}.ledger`, "led_key"], [`${s}.ledger_ext`, "ledext_key"], [`${s}.ledger_post`, "post_key"], [`${s}.prod_ledger`, "il_key"], [`${s}.prod_link`, "plink_key"], [`${s}.outclear`, "out_key"],
    [`${s}.addon_aentry`, "aona_key"], [`${s}.log_ledger`, "lled_key"], [`${s}.log_regtrn`, "lreg_key"], [`${big}.log_entry`, "lentry_key"]]);
  const ledTop = Number(await scalar("last ledger key", `SELECT coalesce(max(led_key), 0) AS v FROM ${s}.ledger`));
  const ilTop = Number(await scalar("last product ledger key", `SELECT coalesce(max(il_key), 0) AS v FROM ${s}.prod_ledger`));
  const savedTime = "to_char(now(), 'HH24:MI:SS')";
  const stamp = "to_char(now(), 'HH24:MI:SS') || ' ' || CASE WHEN extract(hour FROM now()) >= 12 THEN 'PM' ELSE 'AM' END";

  // ---- The party as a company of the same year: the same order is made there as a purchase order ----
  const firstParty = (await step("first party", `SELECT a.name AS v FROM ${s}.account a WHERE a.a_pos <> 'D' AND a.code = (SELECT code FROM tt_autobill ORDER BY ord LIMIT 1)`)).rows[0]?.v;
  const trf = firstParty ? (await step("party company", `SELECT lower(btrim(co_dataname)) AS v FROM smart_system.company WHERE btrim(name) = btrim($1) AND co_pos <> 'D' AND co_key IN (SELECT c_id FROM smart_system.cname WHERE c_tarikh1 = $2::date AND c_tarikh2 = $3::date) LIMIT 1`,
    [toText(firstParty), isoDay(session.tarikh1), isoDay(session.tarikh2)])).rows[0]?.v as string | undefined : undefined;
  if (trf && SCHEMA.test(trf) && trf !== s) await purchaseOrders(client, session, step, scalar, { trf, year, user, savedTime });

  // ---- The ledger rows ----
  const ledgerMap: (readonly [string, string])[] = [["code", "code"], ["doc_date", "delv_date"], ["doc_no", "temp_doc_no"], ["doc_series", "sale_series"], ["full_docno", "sale_docno"], ["doc_no1", "''"], ["amount", "coalesce(p_amount, 0)"],
    ["book_amt", "coalesce(p_amount, 0)"], ["bk_dbcode", "2"], ["book", "8"], ["book_code", "sale_code"], ["ac_dbcode", "1"], ["narration", "''"], ["setoff_amt", "0"], ["ly_clearamt", "0"], ["post_bkcode", "sale_code"], ["ag_book", "0"],
    ["type", "0"], ["int_type", "0"], ["chln_date", "delv_date"], ["entry_type", "''"], ["post_date", "delv_date"], ["post_amt", "coalesce(p_amount, 0)"], ["doc_posting", "'P'"], ["doc_mode", "0"], ["doc_lock", "''"], ["doc_pos", "'A'"],
    ["prod_amt", "coalesce(gross_amt, 0)"], ["stkmdl", "''"], ["doc_remark", "coalesce(batch_no, '')"], ["entry_sty", "''"], ["year_id", year], ["entry_no", "''"], ["rev_charge", "'N'"], ["last_savedate", "now()::date"], ["last_savetime", savedTime],
    ["eway_billno", "eway_billno"], ["eway_billdate", "now()"], ["eway_valid", "eway_valid"], ["supply_type", "1"], ["sub_supply_type", "0"], ["eway_doc_type", "0"], ["trp_mode", "0"], ["distance_km", "distance_km"], ["eway_veh_type", "0"],
    ["ent_address_id", "ent_address_id"], ["user_id", String(user)]];
  await step("ledger", `INSERT INTO ${s}.ledger ${columnsOf(ledgerMap)} SELECT ${valuesOf(ledgerMap)} FROM (SELECT DISTINCT ON (sale_docno) * FROM tt_autobill ORDER BY sale_docno, ord) b ORDER BY temp_doc_no`);
  await step("bill keys", `UPDATE tt_autobill t SET temp_led_id = led.led_key FROM ${s}.ledger led WHERE led.code = t.code AND led.full_docno = t.sale_docno AND led.doc_pos = 'A' AND t.il_pos = 'A' AND led.book = 8 AND led.led_key > ${ledTop}`);
  const userName = toText(await scalar("user", `SELECT user_name AS v FROM smart_system.user_master WHERE user_no = $1`, [user]));

  await step("ledger log", `INSERT INTO ${s}.log_ledger (lled_logdate, lled_logmode, lled_loguser, lled_id, lled_code, lled_docdate, lled_fulldocno, lled_docno1, lled_amount, lled_narration, lled_docpos, year_id, lled_logtime, lled_machine_name)`
    + ` SELECT now(), 'A', ${user}, led_key, code, doc_date, full_docno, doc_no1, amount, narration, 'A', year_id, ${savedTime}, ${host} FROM ${s}.ledger WHERE led_key > ${ledTop}`);
  const dated = (column: string) => `to_char(led.${column}, 'DD/Mon/YYYY')`;
  await step("special log", `INSERT INTO ${big}.log_entry (lentry_top_bottom, lentry_items, lentry_slab, lentry_outstand, lentry_addon, lentry_einvoice, lentry_fields, lentry_mode, lentry_user, lentry_ledid, lentry_code, lentry_book, lentry_bookcode, lentry_savedate, lentry_savetime, lentry_machine_name)`
    + ` SELECT '[{"!*Led_key":"' || led.led_key || '","REGISTER":"SALE","user":"' || ${q(userName)} || '","savedate":"' || to_char(now(), 'DD/Mon/YYYY') || '","savetime":"' || ${stamp} || '","machine_name":"WEB","* Series":"' || coalesce(led.doc_series, '')`
    + ` || '","* Date":"' || ${dated("doc_date")} || '","* Number":"' || btrim(led.doc_no) || '","* Chln. Dt.":"' || ${dated("chln_date")} || '","* Chln. No.":"' || btrim(coalesce(led.doc_no1, '')) || '","* Party Name":"' || coalesce(ac.name, '')`
    + ` || '","Narration":"' || coalesce(led.narration, '') || '","Document Amount":"' || round(led.amount::numeric, 2) || '"}]', '', '', '', '', '', '', 'A', ${user}, led.led_key, led.code, led.book, led.book_code, now(), ${stamp}, 'WEB'`
    + ` FROM ${s}.ledger led LEFT JOIN ${s}.account ac ON ac.code = led.code WHERE led.led_key > ${ledTop}`);
  await step("postings (book)", `INSERT INTO ${s}.ledger_post (led_id, post_code, post_date, post_bookcd, post_book, post_amt, post_dbcode, year_id) SELECT led_key, book_code, doc_date, post_bkcode, book, amount, bk_dbcode, year_id FROM ${s}.ledger WHERE led_key > ${ledTop}`);
  await step("postings (party)", `INSERT INTO ${s}.ledger_post (led_id, post_code, post_date, post_bookcd, post_book, post_amt, post_dbcode, year_id) SELECT led_key, code, doc_date, post_bkcode, book, amount, ac_dbcode, year_id FROM ${s}.ledger WHERE led_key > ${ledTop}`);

  // The bill's slabs: (slab, amount, shown total) in the order the entry screen shows them.
  const upTo = (n: number) => ["gross_amt", ...Array.from({ length: n }, (_, index) => `tot_dis_amt${index + 1}`)];
  const left = (n: number) => upTo(n).map((name, index) => (index === 0 ? name : `- ${name}`)).join(" ");
  const billSlabs: [number, string, string][] = [[191, "gross_amt", "gross_amt"], [188, "tot_dis_amt1", left(1)], [227, "tot_dis_amt2", left(2)], [225, "tot_dis_amt3", left(3)], [226, "tot_dis_amt4", left(4)], [231, "tot_dis_amt5", left(5)],
    [189, "tot_tax_amt", `${left(5)} + tot_tax_amt`], [222, "tot_sgst_amt", `${left(5)} + tot_tax_amt + tot_sgst_amt`], [228, "tot_tcs_amt", `${left(5)} + tot_tax_amt + tot_sgst_amt + tot_tcs_amt`], [187, "rounding", "p_amount"]];
  for (const [id, amount, total] of billSlabs) {
    const condition = id === 191 ? "gross_amt > 0" : id === 187 ? "rounding <> 0" : id === 188 || id === 227 || id === 225 || id === 226 || id === 231 ? `${amount} > 0` : `${amount} <> 0`;
    await step(`slab ${id}`, `INSERT INTO ${s}.ledger_ext (led_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT DISTINCT temp_led_id, ${id}, ${amount}, ${total}, 'N', ${id === 228 ? "tot_tcs_perc" : "0"}, null::int, year_id FROM tt_autobill WHERE ${condition}`);
  }

  await step("outstanding", `INSERT INTO ${s}.outclear (out_ledid, out_date, out_fulldocno, out_entryamt, out_setoff, out_ly_setoff, out_on_acamt, out_dbcode, out_entrybook, code, ref_no, set_off, clear_pos, year_id)`
    + ` SELECT led_key, doc_date, full_docno, amount, 0, 0, 0, ac_dbcode, book, code, '', 0, 'P', year_id FROM ${s}.ledger WHERE led_key > ${ledTop}`);
  await step("unique keys", `UPDATE ${s}.ledger SET unique_key = led_key WHERE unique_key IS NULL`);

  // The orders' transport details go to the bill (one addon row for each bill).
  await step("addon", `INSERT INTO ${s}.addon_aentry (aona_accode, aona_ledid, aona_recid, key_trans, txt_trans, input_vehno, input_ordno, input_lrno, input_lrdate, key_ordtype, txt_ordtype)`
    + ` SELECT DISTINCT ON (t.temp_led_id) aent.aona_accode, t.temp_led_id, 'L', aent.key_trans, aent.txt_trans, coalesce(aent.input_vehno, ''), coalesce(aent.input_ordno, ''), coalesce(aent.input_lrno, ''), coalesce(aent.input_lrdate, ''), aent.key_ordtype, aent.txt_ordtype`
    + ` FROM ${s}.addon_aentry aent, tt_autobill t WHERE t.process_id = aent.aona_processid AND t.temp_led_id IS NOT NULL ORDER BY t.temp_led_id, t.ord`);

  await step("line serials (bill)", `UPDATE tt_autobill t SET il_serial = r.rnk FROM (SELECT ord, row_number() OVER (PARTITION BY temp_led_id ORDER BY ord) AS rnk FROM tt_autobill) r WHERE t.ord = r.ord`);
  const lineMap: (readonly [string, string])[] = [["il_serial", "il_serial"], ["doc_no1", "doc_no1"], ["prod_id", "prod_id"], ["il_prodcd", "il_prodcd"], ["il_billdesc", "il_billdesc"], ["quantity", "allot_qty"], ["rate", "rate"], ["master_rate", "master_rate"],
    ["prate_id", "0"], ["il_value", "abs(il_value)"], ["book", "8"], ["book_code", "sale_code"], ["rateuom_id", "rateuom_id"], ["uomentry_id", "uomentry_id"], ["type", "0"], ["il_date", "delv_date"], ["stock_nat", "stock_nat"], ["code", "code"], ["il_pos", "il_pos"],
    ["full_docno", "sale_docno"], ["slab_cost", "slab_cost"], ["cost_rate", "cost_rate"], ["inventory", "'Y'"], ["stock_type", "stock_type"], ["factor", "allot_qty"], ["trn_qty1", "allot_qty"], ["trn_qty2", "allot_qty"], ["trn_qty3", "trn_qty3"], ["trn_pcs", "allot_qty"],
    ["trn_pack", "(CASE WHEN coalesce(pack_qty, 0) > 0 THEN round(allot_qty / pack_qty, 0) ELSE 0 END)"], ["trn_weight", "allot_qty"], ["trn_module", "'LOUT-OINV'"], ["trn_stkmid", "'2S'"], ["link_stkmdl", "link_stkmdl"], ["ag_qty", "0"], ["ag_fact", "0"],
    ["order_no", "full_docno"], ["pack_qty", "pack_qty"], ["bundle", "allot_ctn"], ["loose_qty", "loose_qty"], ["il_div", "il_div"], ["year_id", "year_id"]];
  await step("product lines", `INSERT INTO ${s}.prod_ledger ${columnsOf(lineMap)} SELECT ${valuesOf(lineMap)} FROM tt_autobill ORDER BY post_date, ord`);
  await step("product log", `INSERT INTO ${s}.log_regtrn (lreg_logdate, lreg_logmode, lreg_loguser, lreg_id, lreg_docno1, lreg_prodid, lreg_quantity, lreg_factor, lreg_rate, lreg_value, lreg_rateuom, lreg_date, lreg_stocknat, lreg_code, lreg_pos, year_id, lreg_logtime, lreg_machine_name)`
    + ` SELECT now(), 'A', ${user}, il_key, doc_no1, prod_id, quantity, factor, rate, abs(il_value::numeric), rateuom_id, il_date, stock_nat, code, 'A', year_id, ${savedTime}, ${host} FROM ${s}.prod_ledger WHERE il_key > ${ilTop}`);

  // The order lines: billed quantity up, allotment and lot no cleared.
  await step("billed quantity", `UPDATE ${s}.prod_ledger p SET ag_qty = coalesce(p.ag_qty, 0) + coalesce(t.allot_qty, 0), ag_fact = coalesce(p.ag_fact, 0) + coalesce(t.allot_qty, 0), ag_pack = coalesce(p.ag_pack, 0) + coalesce(t.allot_ctn, 0)`
    + ` FROM tt_autobill t WHERE t.il_key = p.il_key AND (coalesce(p.ag_qty, 0) = 0 OR coalesce(p.quantity - p.ag_qty, 0) > 0)`);
  await step("billed quantity (blank)", `UPDATE ${s}.prod_ledger SET ag_qty = 0, ag_fact = 0 WHERE ag_qty IS NULL OR ag_fact IS NULL`);
  await step("product line bills", `UPDATE ${s}.prod_ledger p SET led_id = led.led_key FROM ${s}.ledger led WHERE led.full_docno = p.full_docno AND p.led_id IS NULL AND p.process_id IS NULL AND led.doc_pos <> 'D' AND led.led_key > ${ledTop}`);
  await step("line keys", `UPDATE tt_autobill t SET il_id = p.il_key, led_id = p.led_id FROM ${s}.prod_ledger p WHERE p.doc_no1 = t.doc_no1 AND p.prod_id = t.prod_id AND p.il_pos = 'A' AND t.il_pos = 'A' AND p.book = 8 AND p.il_key > ${ilTop}`);
  await step("order links", `INSERT INTO ${s}.prod_link (led_rec1, led_rec2, iled_rec1, iled_rec2, from_stkmd, to_stkmd, from_book, to_book, prod_code, plink_qty1, plink_uom1, plink_qty2, plink_uom2, plink_flag, year_id)`
    + ` SELECT DISTINCT t.process_id, p.led_id, t.il_key, p.il_key, t.trn_module, 'INVOICE', t."TYPE", 8, t.prod_id, t.allot_qty, t.uomentry_id, t.allot_qty, p.uomentry_id, 'L', t.year_id`
    + ` FROM tt_autobill t LEFT JOIN ${s}.prod_ledger p ON p.order_no = t.full_docno AND p.prod_id = t.prod_id WHERE p.process_id IS NULL AND p.il_pos = 'A' AND p.il_key > ${ilTop}`);
  for (const [id, amount, perc, base] of [[188, "dis_amt1", "dis_perc1", ["dis_amt1"]], [227, "dis_amt2", "dis_perc2", ["dis_amt1", "dis_amt2"]], [225, "dis_amt3", "dis_perc3", ["dis_amt1", "dis_amt2", "dis_amt3"]],
    [226, "dis_amt4", "dis_perc4", ["dis_amt1", "dis_amt2", "dis_amt3", "dis_amt4"]], [231, "dis_amt5", "dis_perc5", ["dis_amt1", "dis_amt2", "dis_amt3", "dis_amt4", "dis_amt5"]]] as const) {
    await step(`line slab ${id}`, `INSERT INTO ${s}.ledger_ext (led_id, il_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT DISTINCT led_id, il_id, ${id}, ${amount}, il_value - ${base.join(" - ")}, 'N', ${perc}, null::int, year_id FROM tt_autobill WHERE ${amount} > 0`);
  }
  await step("line slab 189", `INSERT INTO ${s}.ledger_ext (led_id, il_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT DISTINCT led_id, il_id, 189, tax_amt, il_value - ${ALL_TAKEN(5)} + tax_amt, 'N', tax_perc, tax_id, year_id FROM tt_autobill WHERE coalesce(tax_id, 0) > 0`);
  await step("line slab 222", `INSERT INTO ${s}.ledger_ext (led_id, il_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT DISTINCT led_id, il_id, 222, sgst_amt, il_value - ${ALL_TAKEN(5)} + tax_amt + sgst_amt, 'N', sgst_perc, sgst_id, year_id FROM tt_autobill WHERE coalesce(sgst_id, 0) > 0`);
  await step("allotment", `UPDATE ${s}.prod_ledger SET allot_qty = 0 WHERE lot_no <> '' AND il_key IN (SELECT il_key FROM tt_autobill)`);
  await step("lot no", `UPDATE ${s}.prod_ledger SET lot_no = '' WHERE il_key IN (SELECT il_key FROM tt_autobill)`);

  // ---- Balances ----
  await step("party totals", `CREATE TEMP TABLE tt_autobill_party ON COMMIT DROP AS SELECT code, sum(amount::numeric) AS amount FROM ${s}.ledger WHERE led_key > ${ledTop} GROUP BY code`);
  await step("product totals", `CREATE TEMP TABLE tt_autobill_prod ON COMMIT DROP AS SELECT prod_id, sum(quantity) AS qty, sum(factor) AS fact FROM ${s}.prod_ledger WHERE il_key > ${ilTop} GROUP BY prod_id`);
  await step("product balance", `UPDATE ${s}.prod_balance pb SET less_pcs = pb.less_pcs + t.qty, less_qty1 = pb.less_qty1 + t.qty, less_qty2 = pb.less_qty2 + t.qty, less_weight = pb.less_weight + t.qty,`
    + ` less_pack = pb.less_pack + CASE WHEN coalesce(pm.base_pack, 0) = 0 THEN t.qty ELSE round(t.qty / pm.base_pack, 0) END FROM tt_autobill_prod t, ${s}.product_master pm WHERE t.prod_id = pb.prod_id AND pm.prod_key = pb.prod_id AND pb.prec_flag = 'RP' AND pb.year_id = ${year}`);
  await step("product closing", `UPDATE ${s}.prod_balance SET clsg_pcs = open_pcs + add_pcs - less_pcs, clsg_qty1 = open_qty1 + add_qty1 - less_qty1, clsg_qty2 = open_qty2 + add_qty2 - less_qty2, clsg_qty3 = open_qty3 + add_qty3 - less_qty3, clsg_weight = open_weight + add_weight - less_weight,`
    + ` clsg_pack = open_pack + add_pack - less_pack WHERE prec_flag = 'RP' AND prod_id IN (SELECT prod_id FROM tt_autobill_prod)`);
  await step("party balance", `UPDATE ${s}.ac_balance ab SET debit = ab.debit::numeric + t.amount FROM tt_autobill_party t WHERE t.code = ab.code AND ab.a_recflag = 'AC' AND ab.year_id = ${year}`);
  await step("party closing", `UPDATE ${s}.ac_balance SET closing = opening::numeric + debit::numeric - credit::numeric WHERE a_recflag = 'AC' AND code IN (SELECT code FROM tt_autobill_party)`);
  const saleAmount = Number(await scalar("sale total", `SELECT coalesce(sum(amount::numeric), 0) AS v FROM ${s}.ledger WHERE book_code = ${saleCode} AND led_key > ${ledTop}`));
  await step("sale balance", `UPDATE ${s}.ac_balance SET debit = debit::numeric + ${saleAmount} WHERE a_recflag = 'AC' AND year_id = ${year} AND code = ${saleCode}`);
  await step("sale closing", `UPDATE ${s}.ac_balance SET closing = opening::numeric + debit::numeric - credit::numeric WHERE a_recflag = 'AC' AND year_id = ${year} AND code = ${saleCode}`);

  // ---- The invoices made, as the report lists them ----
  const made = (await step("invoices", `SELECT to_char(led.doc_date, 'DD/MM/YYYY') AS selected_date, led.doc_no, led.full_docno, led.doc_series, ac.name, led.amount::numeric AS amount FROM ${s}.ledger led LEFT JOIN ${s}.account ac ON ac.code = led.code`
    + ` WHERE led.full_docno IS NOT NULL AND led.doc_date = $1::date AND led.led_key > ${ledTop} ORDER BY led.doc_no, led.doc_date`, [upto])).rows;

  // ---- The special log: the bill's slabs, items, addon and e-invoice texts ----
  const amountOf = (column: string) => `CASE WHEN coalesce(t.${column}, 0) <> 0 THEN round(t.${column}, 2)::text ELSE '' END`;
  const slabRow = (key: string, order: number, sign: string, caption: string, perc: string, amount: string, first = false) =>
    [q(`{"!${first ? "*" : ""}Slab_key":"${key}","Slab Sr.":"${order}","+ / -":"${sign}","Particulars":"${caption}","Short / %":"`), perc, q(`","Amount":"`), amount, q(`"}`)].join(" || ");
  const tcsPerc = "CASE WHEN coalesce(t.tot_tcs_perc, 0) > 0 THEN round(t.tot_tcs_perc, 2)::text ELSE '' END";
  const less = [["188", 2, "DISCOUNT", "tot_dis_amt1"], ["227", 3, "SPOT DISCOUNT", "tot_dis_amt2"], ["225", 4, "SCH. DISCOUNT", "tot_dis_amt3"], ["226", 5, "ADDITIONAL DISCOUNT", "tot_dis_amt4"], ["231", 6, "TRADE DISCOUNT", "tot_dis_amt5"]] as const;
  const slabText = (utgst: boolean) => [q("["), slabRow("191", 1, "Add :", "Product Amount", q(""), "coalesce(round(t.gross_amt, 2)::text, '')", true),
    ...less.map(([key, order, caption, column]) => `${q(",")} || ${slabRow(key, order, "Less:", caption, q(""), amountOf(column))}`),
    ...(utgst
      ? [slabRow("189", 7, "Add :", "* CGST Code", q(""), amountOf("tot_tax_amt")), slabRow("222", 8, "Add :", "* UTGST Code", q(""), amountOf("tot_sgst_amt")), slabRow("228", 9, "Add :", "TCS @ 2%", tcsPerc, amountOf("tot_tcs_amt")),
        slabRow("190", 10, "User:", "ANY ADD / LESS", q(""), q("")), slabRow("187", 11, "User:", "ROUNDING", q(""), amountOf("rounding"))]
      : [slabRow("189", 7, "Add :", "* IGST Code", q(""), amountOf("tot_tax_amt")), slabRow("228", 9, "Add :", "TCS @ 2%", tcsPerc, amountOf("tot_tcs_amt")),
        slabRow("190", 9, "User:", "ANY ADD / LESS", q(""), q("")), slabRow("187", 10, "User:", "ROUNDING", q(""), amountOf("rounding"))]).map((part) => `${q(",")} || ${part}`),
    q("]")].join(" || ");
  const slabCase = `CASE WHEN coalesce(t.tot_sgst_amt, 0) = 0 THEN ${slabText(false)} ELSE ${slabText(true)} END`;
  await step("special log slabs", `UPDATE ${big}.log_entry lg SET lentry_slab = ${slabCase} FROM tt_autobill t WHERE t.temp_led_id = lg.lentry_ledid AND lg.lentry_mode = 'A' AND coalesce(lg.lentry_slab, '') = '' AND lg.lentry_book = 8 AND lg.lentry_ledid > ${ledTop}`);

  const ext = (id: number, column: string) => `(SELECT ${column} FROM ${s}.ledger_ext WHERE il_id = p.il_key AND slab_id = ${id} LIMIT 1)`;
  const text = (expression: string) => `coalesce(${expression}::text, '')`;
  const money = (expression: string) => `coalesce(round((${expression})::numeric, 2)::text, '')`;
  const taxName = `(SELECT btrim(tax_desc) || ' [' || tax_short || ']' FROM ${s}.ledger_ext ledext LEFT JOIN ${s}.tax_master txmst ON txmst.tax_rec = ledext.tax_id WHERE ledext.il_id = p.il_key AND ledext.slab_id = 189 LIMIT 1)`;
  const field = (name: string, expression: string) => `${q(`"${name}":"`)} || ${expression} || ${q('",')}`;
  const itemText = `'{' || CASE WHEN p.rn = 1 THEN '"!*Il_key":"' ELSE '"!Il_key":"' END || p.il_key || '",' || ${field("Item Sr.", text("p.il_serial"))} || ${field("* Product", "replace(coalesce(p.il_billdesc, ''), '\"', '\\\"')")} || ${field("* Q.Uom", text("quom.uom_short"))}`
    + ` || ${field("Box", text("p.bundle"))} || ${field("* Packing", text("p.pack_qty"))} || ${field("Loose Qty", text("p.loose_qty"))} || ${field("* Qty.", text("p.quantity"))} || ${field("R.Uom", text("ruom.uom_short"))} || ${field("* Rate", text("p.rate"))} || ${field("Value", money("p.il_value"))}`
    + ` || ${field("DISCOUNT%", text(ext(188, "slab_perc")))} || ${field("DISCOUNT", money(ext(188, "slab_amt")))} || ${field("SPOTDIS%", text(ext(227, "slab_perc")))} || ${field("SPOT_DISCOUNT", money(ext(227, "slab_amt")))}`
    + ` || ${field("SCHDIS%", text(ext(225, "slab_perc")))} || ${field("SCH_DISCOUNT", money(ext(225, "slab_amt")))} || ${field("ADDDIS%", text(ext(226, "slab_perc")))} || ${field("ADDITIONAL_DIS", money(ext(226, "slab_amt")))}`
    + ` || ${field("TRADEDIS%", text(ext(231, "slab_perc")))} || ${field("TRADE_DISCOUNT", money(ext(231, "slab_amt")))}`
    + ` || CASE WHEN coalesce((SELECT slab_amt::numeric FROM ${s}.ledger_ext WHERE il_id = p.il_key AND slab_id = 222 LIMIT 1), 0) = 0`
    + ` THEN ${q('"* IGST Code%":"')} || coalesce(${taxName}, '') || ${q('","IGST Code":"')} || ${money(ext(189, "slab_amt"))} || '"'`
    + ` ELSE ${q('"* CGST Code%":"')} || coalesce(${taxName}, '') || ${q('","CGST Code":"')} || ${money(ext(189, "slab_amt"))} || ${q('","* UTGST Code%":"')}`
    + ` || coalesce((SELECT btrim(tax_desc) || ' [' || tax_short || ']' FROM ${s}.ledger_ext ledext LEFT JOIN ${s}.tax_master txmst ON txmst.tax_rec = ledext.tax_id WHERE ledext.il_id = p.il_key AND ledext.slab_id = 222 LIMIT 1), '')`
    + ` || ${q('","UTGST Code":"')} || ${money(ext(222, "slab_amt"))} || '"' END || '}'`;
  await step("special log items", `UPDATE ${big}.log_entry lg SET lentry_items = '[' || coalesce((SELECT string_agg(${itemText}, ',' ORDER BY p.il_serial)`
    + ` FROM (SELECT prod.*, row_number() OVER (ORDER BY prod.il_serial) AS rn FROM ${s}.prod_ledger prod WHERE prod.led_id = lg.lentry_ledid AND prod.il_pos = 'A') p`
    + ` LEFT JOIN ${s}.prod_uom ruom ON ruom.uom_key = p.rateuom_id LEFT JOIN ${s}.prod_uom quom ON quom.uom_key = p.uomentry_id), '') || ']'`
    + ` WHERE lg.lentry_mode = 'A' AND coalesce(lg.lentry_items, '') = '' AND lg.lentry_book = 8 AND lg.lentry_ledid > ${ledTop}`);
  await step("special log addon", `UPDATE ${big}.log_entry SET lentry_addon = ${q('[{"!*Addon_Label":"* Transport","* Transport":"None"},{"!Addon_Label":"Vehicle No.","Vehicle No.":""},{"!Addon_Label":"Order No","Order No":""},{"!Addon_Label":"L.R.No.","L.R.No.":""},{"!Addon_Label":"L.R.Date","L.R.Date":""},{"!Addon_Label":"* Order Type","* Order Type":"NONE"},{"!Addon_Label":"Order Date","Order Date":""},{"!Addon_Label":"INVOICE NO","INVOICE NO":" "},{"!Addon_Label":"Destination","Destination":""}]')}`
    + ` WHERE lentry_mode = 'A' AND coalesce(lentry_addon, '') = '' AND lentry_book = 8 AND lentry_ledid > ${ledTop}`);
  await step("special log e-invoice", `UPDATE ${big}.log_entry SET lentry_einvoice = '[{"* Supply Type":"Supply","* Document Type":"Tax Invoice","* Transportation Mode":"Road","* Vehicle Type":"Reguler","Distance KM":"","EWAY Bill Number":"","Date":"' || to_char(now(), 'DD Mon YYYY') || '","EWAY Valid":""}]'`
    + ` WHERE lentry_mode = 'A' AND coalesce(lentry_einvoice, '') = '' AND lentry_book = 8 AND lentry_ledid > ${ledTop}`);

  return made;
}

type Step = (label: string, sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** The party being a company of the same year: the order is made there as ORD-PURCH (process, slabs, lines, log). */
async function purchaseOrders(client: Client, session: MasterSession, step: Step, scalar: (label: string, sql: string, params?: unknown[]) => Promise<unknown>,
  { trf, year, user, savedTime }: { trf: string; year: string; user: number; savedTime: string }) {
  const s = session.companySchema;
  await alignSequences(client, [[`${trf}.process`, "process_key"], [`${trf}.prod_ledger`, "il_key"], [`${trf}.ledger_ext`, "ledext_key"], [`${trf}.log_regtrn`, "lreg_key"]]);
  const purchBook = Number(await scalar("party purchase book", `SELECT code AS v FROM ${trf}.account WHERE book = 22 AND a_pos <> 'D' ORDER BY code LIMIT 1`)) || 0;
  const partyAccount = Number(await scalar("party account", `SELECT code AS v FROM ${trf}.account WHERE a_pos <> 'D' AND btrim(name) = btrim($1) AND book = 3 ORDER BY code LIMIT 1`, [session.companyName])) || 0;
  const ilTop = Number(await scalar("party last product ledger key", `SELECT coalesce(max(il_key), 0) AS v FROM ${trf}.prod_ledger`));
  const processMap: (readonly [string, string])[] = [["stk_module", "'ORD-PURCH'"], ["code", String(partyAccount)], ["p_date", "delv_date"], ["doc_no2", "temp_doc_no"], ["p_docseries", "'ODi'"], ["full_docno", "'ODi/' || ltrim(rtrim(temp_doc_no))"],
    ["p_bkdbcode", "1"], ["p_amount", "coalesce(p_amount, 0)"], ["book", "13"], ["stk_remark", "''"], ["entry_for", "'P'"], ["post_date", "delv_date"], ["il_pos", "'A'"], ["year_id", year], ["entry_no", "sale_docno"], ["last_savedate", "now()::date"], ["last_savetime", savedTime]];
  await step("party order", `INSERT INTO ${trf}.process ${columnsOf(processMap)} SELECT ${valuesOf(processMap)} FROM (SELECT DISTINCT ON (sale_docno) * FROM tt_autobill ORDER BY sale_docno, ord) b ORDER BY temp_doc_no`);
  await step("party order keys", `UPDATE tt_autobill t SET purch_led_id = p.process_key FROM ${trf}.process p WHERE p.il_pos = 'A' AND p.book = 13 AND p.entry_no = t.sale_docno`);
  const fifth = trf.includes("kanpur") ? 242 : 240;
  const slabs: [number, string, string, string][] = [[191, "gross_amt", "gross_amt", "gross_amt > 0"], [188, "tot_dis_amt1", "gross_amt - tot_dis_amt1", "tot_dis_amt1 > 0"], [227, "tot_dis_amt2", "gross_amt - tot_dis_amt1 - tot_dis_amt2", "tot_dis_amt2 > 0"],
    [225, "tot_dis_amt3", "gross_amt - tot_dis_amt1 - tot_dis_amt2 - tot_dis_amt3", "tot_dis_amt3 > 0"], [226, "tot_dis_amt4", "gross_amt - tot_dis_amt1 - tot_dis_amt2 - tot_dis_amt3 - tot_dis_amt4", "tot_dis_amt4 > 0"],
    [fifth, "tot_dis_amt5", "gross_amt - tot_dis_amt1 - tot_dis_amt2 - tot_dis_amt3 - tot_dis_amt4 - tot_dis_amt5", "tot_dis_amt5 > 0"],
    [189, "tot_tax_amt", "gross_amt - tot_dis_amt1 - tot_dis_amt2 - tot_dis_amt3 - tot_dis_amt4 - tot_dis_amt5 + tot_tax_amt", "tot_tax_amt <> 0"],
    [222, "tot_sgst_amt", "gross_amt - tot_dis_amt1 - tot_dis_amt2 - tot_dis_amt3 - tot_dis_amt4 - tot_dis_amt5 + tot_tax_amt + tot_sgst_amt", "tot_sgst_amt <> 0"],
    [228, "tot_tcs_amt", "gross_amt - tot_dis_amt1 - tot_dis_amt2 - tot_dis_amt3 - tot_dis_amt4 - tot_dis_amt5 + tot_tax_amt + tot_sgst_amt + tot_tcs_amt", "tot_tcs_amt <> 0"], [187, "rounding", "p_amount", "rounding <> 0"]];
  for (const [id, amount, total, condition] of slabs) {
    await step(`party order slab ${id}`, `INSERT INTO ${trf}.ledger_ext (process_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT DISTINCT purch_led_id, ${id}, ${amount}, ${total}, 'N', ${id === 228 ? "tot_tcs_perc" : "0"}, null::int, year_id FROM tt_autobill WHERE ${condition}`);
  }
  const lineMap: (readonly [string, string])[] = [["process_id", "purch_led_id"], ["il_serial", "il_serial"], ["doc_no1", "temp_doc_no"], ["prod_id", `(SELECT prod_key FROM ${trf}.product_master WHERE prod_pos <> 'D' AND prod_short IN (SELECT prod_short FROM ${s}.product_master WHERE prod_pos <> 'D' AND prod_key = tblprod.prod_id) ORDER BY prod_key LIMIT 1)`],
    ["il_prodcd", "il_prodcd"], ["il_billdesc", "il_billdesc"], ["quantity", "allot_qty"], ["rate", "rate"], ["master_rate", "master_rate"], ["prate_id", "0"], ["il_value", "abs(il_value)"], ["book", "13"], ["book_code", String(purchBook)], ["rateuom_id", "rateuom_id"],
    ["uomentry_id", "uomentry_id"], ["type", "0"], ["il_date", "delv_date"], ["stock_nat", "'A'"], ["code", String(partyAccount)], ["il_pos", "il_pos"], ["full_docno", "'ODi/' || ltrim(rtrim(temp_doc_no))"], ["slab_cost", "slab_cost"], ["cost_rate", "cost_rate"],
    ["inventory", "'N'"], ["stock_type", "'R'"], ["factor", "allot_qty"], ["trn_qty1", "allot_qty"], ["trn_qty2", "allot_qty"], ["trn_qty3", "trn_qty3"], ["trn_pcs", "allot_qty"],
    ["trn_pack", "(CASE WHEN coalesce(pack_qty, 0) > 0 THEN round(allot_qty / pack_qty, 0) ELSE 0 END)"], ["trn_weight", "allot_qty"], ["ag_qty", "0"], ["ag_fact", "0"], ["order_no", "full_docno"], ["pack_qty", "pack_qty"], ["bundle", "allot_ctn"],
    ["loose_qty", "loose_qty"], ["il_div", "il_div"], ["year_id", "year_id"], ["dis_paisa", "prod_id"], ["trn_module", "'ORD-PURCH'"], ["trn_stkmid", "'OR'"]];
  await step("party order lines", `INSERT INTO ${trf}.prod_ledger ${columnsOf(lineMap)} SELECT ${valuesOf(lineMap)} FROM tt_autobill tblprod ORDER BY post_date, ord`);
  await step("party order log", `INSERT INTO ${trf}.log_regtrn (lreg_logdate, lreg_logmode, lreg_loguser, lreg_id, lreg_docno1, lreg_prodid, lreg_quantity, lreg_factor, lreg_rate, lreg_value, lreg_rateuom, lreg_date, lreg_stocknat, lreg_code, lreg_pos, year_id, lreg_logtime)`
    + ` SELECT now(), 'A', ${user}, il_key, doc_no1, prod_id, quantity, factor, rate, abs(il_value::numeric), rateuom_id, il_date, stock_nat, code, 'A', year_id, ${savedTime} FROM ${trf}.prod_ledger WHERE il_key > ${ilTop}`);
  await step("party order line keys", `UPDATE tt_autobill t SET purch_il_id = p.il_key FROM ${trf}.prod_ledger p WHERE p.dis_paisa = t.prod_id AND p.il_pos = 'A' AND t.il_pos = 'A' AND p.book = 13 AND p.full_docno = t.purch_docno AND p.il_key > ${ilTop}`);
  await step("party order line serials", `UPDATE ${trf}.prod_ledger p SET il_serial = r.rnk FROM (SELECT il_key, row_number() OVER (PARTITION BY full_docno ORDER BY il_date DESC, il_key) AS rnk FROM ${trf}.prod_ledger WHERE il_pos <> 'D' AND il_key > ${ilTop}) r WHERE p.il_key = r.il_key`);
  for (const [id, amount, perc, base] of [[188, "dis_amt1", "dis_perc1", ["dis_amt1"]], [227, "dis_amt2", "dis_perc2", ["dis_amt1", "dis_amt2"]], [225, "dis_amt3", "dis_perc3", ["dis_amt1", "dis_amt2", "dis_amt3"]],
    [226, "dis_amt4", "dis_perc4", ["dis_amt1", "dis_amt2", "dis_amt3", "dis_amt4"]], [fifth, "dis_amt5", "dis_perc5", ["dis_amt1", "dis_amt2", "dis_amt3", "dis_amt4", "dis_amt5"]]] as const) {
    await step(`party order line slab ${id}`, `INSERT INTO ${trf}.ledger_ext (process_id, il_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT DISTINCT purch_led_id, purch_il_id, ${id}, ${amount}, il_value - ${base.join(" - ")}, 'N', ${perc}, null::int, year_id FROM tt_autobill WHERE ${amount} > 0`);
  }
  await step("party order line slab 189", `INSERT INTO ${trf}.ledger_ext (process_id, il_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT DISTINCT purch_led_id, purch_il_id, 189, tax_amt, il_value - ${ALL_TAKEN(5)} + tax_amt, 'N', tax_perc, tax_id, year_id FROM tt_autobill WHERE coalesce(tax_id, 0) > 0`);
  await step("party order line slab 222", `INSERT INTO ${trf}.ledger_ext (process_id, il_id, slab_id, slab_amt, s_lastot, form_recd, slab_perc, tax_id, year_id) SELECT DISTINCT purch_led_id, purch_il_id, 222, sgst_amt, il_value - ${ALL_TAKEN(5)} + tax_amt + sgst_amt, 'N', sgst_perc, sgst_id, year_id FROM tt_autobill WHERE coalesce(sgst_id, 0) > 0`);
}
