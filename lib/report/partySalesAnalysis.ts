import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { isoDay, keyList } from "./priorYear";
import { num, runReportSql } from "./run";

/**
 * 305: PARTY SALE ANALYSIS (SP_FRT_RPT_PARTY_SALES_ANALYSIS; ANALYSIS > Party Sale Analysis). For each account, its sale (the first combo "SALE") or its receipts (any other)
 * month by month (Daily: day by day, Apr_1, Apr_2 ...), the total, the closing balance and the ticked addon groups. The options of the procedure:
 *  - Split (CHK_SPLIT): the two legs of the figure in a column each - sale and return (SALE_, RET_), receipt and payment (RECP_, PAY_) - and the net in the totals;
 *  - Both (CHK_BOTH): the other measure (receipts beside the sale, sale beside the receipts) after the first one;
 *  - Percent (CHK_PCT): a _PCT column after each figure, its share of the column's total;
 *  - Daily (CHK_DAILY): a column for each day; the column keeps its plain name (Apr_15) when there is one measure only.
 * Sale is the sale bills and the debit notes against them less the returns (with a sale tax slab, the bill's amount less the slab); receipts are the cash / bank
 * vouchers (books 4 and 6), credit side a receipt, debit side a payment. Accounts with no figure, no closing and no balance are left out.
 * The ledger is read once, grouped by account and day, and pivoted here: the columns are the periods x measures however many there are.
 */
export async function partySalesAnalysis(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const first = call.fcText.trim().toUpperCase();
  const isSale = first === "SALE";
  const has = (token: string) => call.checkQuery.includes(token);
  const daily = has("CHK_DAILY,");
  const percent = has("CHK_PCT,");
  const split = has("CHK_SPLIT,");
  const both = has("CHK_BOTH,");
  const needSale = isSale || both;
  const needReceipt = !isSale || both;
  const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;

  // The measures, in column order; each is a combination of the four legs (sale, return, receipt, payment).
  type Leg = [number, number, number, number];
  type Measure = { prefix: string; total: string; value: (leg: Leg) => number };
  const sale: Measure[] = split ? [{ prefix: "SALE_", total: "SALE", value: (leg) => leg[0] }, { prefix: "RET_", total: "RETURN", value: (leg) => leg[1] }] : [{ prefix: "SALE_", total: "SALE", value: (leg) => leg[0] - leg[1] }];
  const receipt: Measure[] = split ? [{ prefix: "RECP_", total: "RECEIPT", value: (leg) => leg[2] }, { prefix: "PAY_", total: "PAYMENT", value: (leg) => leg[3] }] : [{ prefix: "RECP_", total: "RECEIPT", value: (leg) => leg[2] - leg[3] }];
  const measures: Measure[] = isSale ? [...sale, ...(both ? receipt : [])] : [...receipt, ...(both ? sale : [])];
  const usePrefix = !(daily && measures.length === 1);

  const from = new Date(call.from.getFullYear(), call.from.getMonth(), call.from.getDate());
  const upto = new Date(call.upto.getFullYear(), call.upto.getMonth(), call.upto.getDate());

  // The periods: each month of the range, or each day of it.
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const periods: string[] = [];
  const taken = new Set<string>();
  const nameOf = (base: string, date: Date) => { let name = base; if (taken.has(name.toLowerCase())) name = `${base}_${String(date.getFullYear()).slice(2)}`; taken.add(name.toLowerCase()); return name; };
  if (daily) for (let day = new Date(from); day <= upto; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) periods.push(nameOf(`${months[day.getMonth()]}_${day.getDate()}`, day));
  else for (let month = new Date(from.getFullYear(), from.getMonth(), 1); month <= upto; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) periods.push(nameOf(months[month.getMonth()], month));
  const dayNumber = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const periodOf = (date: Date) => (daily ? dayNumber(date) - dayNumber(from) : (date.getFullYear() - from.getFullYear()) * 12 + date.getMonth() - from.getMonth());

  // SQL Server holds 1024 columns in a table: the procedure fails readably.
  if (periods.length * measures.length * (percent ? 2 : 1) + 20 > 1024) {
    throw new ReportRefusal(`This range needs ${periods.length} periods x ${measures.length} measures, which exceeds the 1024 column limit. Shorten the range, or turn off Both / Split / Percent.`, "Too many columns");
  }

  // The sale slab (book 8's master slab), when the sale is wanted.
  const slab = needSale ? num((await runReportSql(loader, `SELECT slab_key FROM ${db}slab_master WHERE book = 8 AND slab_master = 'Y' AND slab_active = 'Y' AND slab_link = 0 ORDER BY slab_key LIMIT 1`)).rows[0]?.slab_key) : 0;
  const amount = slab > 0 ? "(coalesce(ext.s_lastot::numeric, 0) - coalesce(ext.slab_amt::numeric, 0))" : "coalesce(led.amount::numeric, 0)";

  // The ledger lines, once: the four legs of each account for each day.
  const accounts = keyList(call.selectKey[4]);
  const books: string[] = [];
  const legs: string[] = [];
  if (needSale) {
    legs.push(`sum(round(CASE WHEN led.book = 8 OR (led.book = 11 AND led.ag_book = 8) THEN ${amount} ELSE 0 END, 2)) AS s_p`, `sum(round(CASE WHEN led.book = 16 AND led.ag_book = 8 THEN ${amount} ELSE 0 END, 2)) AS s_n`);
    books.push("(led.book = 8 OR (led.book = 16 AND led.ag_book = 8) OR (led.book = 11 AND led.ag_book = 8))");
  } else legs.push("0::numeric AS s_p", "0::numeric AS s_n");
  if (needReceipt) {
    legs.push("sum(round(CASE WHEN led.book IN (4, 6) AND led.ac_dbcode = 2 THEN led.amount::numeric ELSE 0 END, 2)) AS r_p", "sum(round(CASE WHEN led.book IN (4, 6) AND led.ac_dbcode <> 2 THEN led.amount::numeric ELSE 0 END, 2)) AS r_n");
    books.push("led.book IN (4, 6)");
  } else legs.push("0::numeric AS r_p", "0::numeric AS r_n");
  const lines = (await runReportSql(loader, `SELECT led.code, led.doc_date::date AS day, ${legs.join(", ")} FROM ${db}ledger led`
    + `${slab > 0 ? ` LEFT JOIN ${db}ledger_ext ext ON ext.led_id = led.led_key AND ext.il_id IS NULL AND ext.slab_id::int = ${slab}` : ""}`
    + ` WHERE led.doc_pos = 'A' AND led.doc_posting = 'P' AND (${books.join(" OR ")}) AND led.doc_date >= $1::date AND led.doc_date < $2::date + 1${accounts !== "" ? ` AND led.code IN ${accounts}` : ""}`
    + ` AND led.code IS NOT NULL GROUP BY led.code, led.doc_date::date`, [isoDay(from), isoDay(upto)])).rows;
  const byCode = new Map<number, { period: Map<number, Leg>; total: Leg }>();
  for (const row of lines) {
    const code = num(row.code);
    const at = periodOf(row.day as Date);
    if (at < 0 || at >= periods.length) continue;
    let entry = byCode.get(code);
    if (!entry) { entry = { period: new Map(), total: [0, 0, 0, 0] }; byCode.set(code, entry); }
    const leg: Leg = [num(row.s_p), num(row.s_n), num(row.r_p), num(row.r_n)];
    const cell = entry.period.get(at) ?? [0, 0, 0, 0];
    for (let index = 0; index < 4; index += 1) { cell[index] = r2(cell[index] + leg[index]); entry.total[index] = r2(entry.total[index] + leg[index]); }
    entry.period.set(at, cell);
  }

  // The accounts (not closed), with the closing balance and the ticked addon groups.
  const keyOf = (at: number) => call.addon[at].trim().replace(/^(adata)\.txt_/i, "adata.key_");
  let ticked = 0;
  while (ticked < 4 && keyList(call.selectKey[ticked]) !== "") ticked += 1;
  const extra: string[] = [];
  for (let at = 0; at < ticked; at += 1) if (call.headingAddon[at].trim() !== "") extra.push(call.headingAddon[at].trim());
  const headings = extra.length;
  for (let at = 0; at < ticked; at += 1) if (call.selectedAddon[at].trim() !== "") extra.push(call.selectedAddon[at].trim());
  const filters: string[] = [];
  if (accounts !== "") filters.push(`ac.code IN ${accounts}`);
  for (let at = 0; at < 4; at += 1) if (keyList(call.selectKey[at]) !== "" && call.addon[at].trim() !== "") filters.push(`${keyOf(at)} IN ${keyList(call.selectKey[at])}`);
  const order = [...Array.from({ length: headings }, (_unused, index) => String(index + 4)), "2"].join(", ");
  const result = await runReportSql(loader, `SELECT ac.code, ac.name AS "Name", round(acbal.closing::numeric, 0) AS clsg_bal${extra.map((column) => `, ${column}`).join("")}`
    + ` FROM ${db}account ac LEFT JOIN ${db}ac_balance acbal ON acbal.code = ac.code${ticked > 0 ? ` LEFT JOIN ${db}addon_data adata ON adata.code = ac.code` : ""}`
    + ` WHERE ac.a_pos <> 'D' AND ac.a_lastdate IS NULL${filters.map((filter) => ` AND ${filter}`).join("")} ORDER BY ${order}`);
  const extraColumns = result.fields.slice(3).map((field) => field.name);

  // The rows: the figures of each account, the all-zero ones left out.
  type Line = { name: string; values: number[]; totals: number[]; closing: number; row: ResultRow };
  const lineOf: Line[] = [];
  for (const record of result.rows) {
    const entry = byCode.get(num(record.code));
    const values: number[] = [];
    for (let at = 0; at < periods.length; at += 1) for (const measure of measures) values.push(entry?.period.has(at) ? r2(measure.value(entry.period.get(at) as Leg)) : 0);
    const totals = measures.map((measure) => (entry ? r2(measure.value(entry.total)) : 0));
    const closing = r2(num(record.clsg_bal));
    if (totals.every((value) => value === 0) && closing === 0 && values.every((value) => value === 0)) continue;
    lineOf.push({ name: toText(record.Name), values, totals, closing, row: record });
  }

  const table = new ResultTable();
  table.addColumn("Name");
  const columnOf: string[] = [];
  for (const period of periods) for (const measure of measures) columnOf.push(usePrefix ? `${measure.prefix}${period}` : period);
  for (const column of columnOf) { table.setKind(column, "decimal"); if (percent) table.setKind(`${column}_PCT`, "decimal"); }
  for (const measure of measures) { table.setKind(measure.total, "decimal"); if (percent) table.setKind(`${measure.total}_PCT`, "decimal"); }
  if (split && needSale) table.setKind("NET_SALE", "decimal");
  if (split && needReceipt) table.setKind("NET_RECEIPT", "decimal");
  table.setKind("Clsg_bal", "decimal");
  for (const column of extraColumns) table.addColumn(column);

  const share = (value: number, total: number) => (total === 0 ? 0 : Math.round((100 * value / total + Math.sign(value) * 1e-9) * 10000) / 10000);
  const columnTotals = columnOf.map((_column, index) => lineOf.reduce((sum, line) => sum + line.values[index], 0));
  const measureTotals = measures.map((_measure, index) => lineOf.reduce((sum, line) => sum + line.totals[index], 0));
  for (const line of lineOf) {
    const row: ResultRow = { Name: line.name };
    columnOf.forEach((column, index) => { row[column] = line.values[index]; if (percent) row[`${column}_PCT`] = share(line.values[index], columnTotals[index]); });
    measures.forEach((measure, index) => { row[measure.total] = line.totals[index]; if (percent) row[`${measure.total}_PCT`] = share(line.totals[index], measureTotals[index]); });
    const total = (name: string) => line.totals[measures.findIndex((measure) => measure.total === name)] ?? 0;
    if (split && needSale) row.NET_SALE = r2(total("SALE") - total("RETURN"));
    if (split && needReceipt) row.NET_RECEIPT = r2(total("RECEIPT") - total("PAYMENT"));
    row.Clsg_bal = line.closing;
    for (const column of extraColumns) row[column] = toText(line.row[column]);
    table.rows.push(row);
  }
  return table;
}
