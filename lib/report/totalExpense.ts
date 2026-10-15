import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 188 TOTAL EXPENSE (REPORT_RPI_TOTAL_EXPENSE) and 302 (the same for the Daman departments): SP_FRT_RPT_RPI_TOTAL_EXPENSE (SPECIAL > Extra Report (RP)).
 * Every expense of the period From .. Upto in one list, by book and date:
 *  - the expense (15) and debit note expense (10) vouchers: date, document, supplier invoice, the party (PARTICULARS), the expense account and its schedule,
 *    sub ledger and nature (Setup's addon of the entry), and a column for each slab of the expense book (Setup: slabs shown in the report, in their order; a
 *    master slab, the taxes: the amount before the tax (NET_AMOUNT, of the first one), the tax's name and its amount), then Amount (a debit note's is
 *    negative). From 01/04/2026 the vouchers go by item (a line for each product: SR_NO, item, quantity, rate; the amounts only on the first line);
 *  - the cash and bank (4, 6) payments, the journals (19, debit side) and the discounts (5, credit side) to the expense accounts (schedule codes 01 to 04), as
 *    NET_AMOUNT (a payment's credit side is taken off).
 *  With 302 only the lines of the factory departments (the sub ledger names of the procedure's list) are taken.
 * One read of each kind; the slabs' amounts of all the vouchers come from one read of the ledger extension (the procedure looked each up).
 * Where the procedure would fail (a voucher book of no master slab: NET_AMOUNT missing) the column is made.
 */
const DEPARTMENTS = ["Moulding Department", "Steel Department", "Pet Blow Department", "Filling Department", "Hot Stamping & Screen Printing Department", "Packing Department", "Tool Room & Mould Department", "Maintenance Department",
  "Dispatch Department", "HD Blow Department", "Welding Steel Plant", "General Factory Expenses", "Project & Development", "Research & Development Department", "Spray Printing Department", "Quality Department", "Waterfoiling H2O Department"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const style6 = (date: Date) => `${String(date.getDate()).padStart(2, "0")}-${MONTHS[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
const round2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;

export async function totalExpense(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const daman = call.reportKey === 302;
  const byItem = call.tarikh1.getTime() >= new Date(2026, 3, 1).getTime();
  const params = [desktopDate(call.from), desktopDate(call.upto)];
  const departments = (column: string) => (daman ? ` AND ${column} = ANY($3::text[])` : "");
  const extra = daman ? [DEPARTMENTS] : [];

  // The slabs of the expense book shown in the report.
  const slabs = (await runReportSql(loader, `SELECT slab_active, slab_mathop, btrim(slab_repohd) AS short, slab_key, slab_master FROM ${db}slab_master WHERE book = 15 AND slab_fromdt = $1::date AND slab_uptodt = $2::date`
    + ` AND slab_inrep = 'Y' AND slab_active <> 'N' ORDER BY slab_order`, [desktopDate(call.tarikh1), desktopDate(call.tarikh2)])).rows
    .map((row) => ({ active: toText(row.slab_active).trim(), mathop: toText(row.slab_mathop).trim(), short: toText(row.short), key: num(row.slab_key), master: toText(row.slab_master).trim() === "Y" }));

  // The columns, in the procedure's order.
  type Piece = { name: string; kind: "net" | "desc" | "amount" | "plain" | "value"; slab: number; level: "ledger" | "item" };
  const pieces: Piece[] = [];
  let firstMaster = true;
  for (const slab of slabs) {
    if (!slab.master) {
      pieces.push({ name: slab.short, kind: byItem && slab.active === "S" ? "value" : "amount", slab: slab.key, level: byItem && slab.active !== "S" && slab.mathop !== "U" ? "item" : "ledger" });
    } else {
      const level = byItem ? "item" : "ledger";
      if (firstMaster) pieces.push({ name: "NET_AMOUNT", kind: "net", slab: slab.key, level });
      firstMaster = false;
      pieces.push({ name: `${slab.short}_DESC`, kind: "desc", slab: slab.key, level }, { name: slab.short, kind: "amount", slab: slab.key, level });
    }
  }

  // The vouchers.
  const base = `FROM ${db}ledger led LEFT JOIN ${db}account ac ON ac.code = led.post_bkcode LEFT JOIN ${db}balsheet bs ON bs.bs_key = ac.bs_id LEFT JOIN ${db}addon_aentry aent ON aent.aona_ledid = led.led_key`
    + ` LEFT JOIN ${db}account pa ON pa.code = led.code AND pa.a_pos <> 'D'`
    + (byItem ? ` LEFT JOIN ${db}prod_ledger prodled ON prodled.led_id = led.led_key AND prodled.il_pos <> 'D' LEFT JOIN ${db}addon_ientry aient ON aient.aoni_il_id = prodled.il_key LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id` : "");
  const vouchers = (await runReportSql(loader, `SELECT led.led_key, led.book, led.doc_date, led.full_docno, btrim(led.doc_no1) AS doc_no1, pa.name AS party, ac.name AS expense, bs.bs_desc AS group_name,`
    + ` ${byItem ? "CASE WHEN led.book = 15 THEN coalesce(aient.txt_subled, '') ELSE aent.txt_subled END" : "aent.txt_subled"} AS sub_ledger, aent.txt_exp_nature AS nature,`
    + ` ${byItem ? "prodled.il_serial AS serial, prodled.il_key, prodmas.prod_desc AS item, prodled.quantity::numeric AS quantity, round(prodled.rate::numeric, 2) AS rate, prodled.il_value::numeric AS il_value," : ""}`
    + ` led.amount::numeric AS amount, led.narration ${base}`
    + ` WHERE led.doc_date BETWEEN $1::date AND $2::date AND led.doc_pos <> 'D' AND led.book IN (10, 15)${departments(byItem ? "aient.txt_subled" : "aent.txt_subled")}`
    + ` ORDER BY led.doc_date${byItem ? ", prodled.il_serial" : ""}`, [...params, ...extra])).rows;

  // The slabs' amounts of those vouchers (a voucher's own, or its item lines'), and the first tax of each.
  const amounts = new Map<string, { amount: number; net: number; tax: number }>();
  const taxNames = new Map<number, string>();
  const ledgerIds = [...new Set(vouchers.map((row) => num(row.led_key)))];
  if (slabs.length > 0 && ledgerIds.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT led_id, coalesce(il_id, 0) AS il, slab_id, sum(slab_amt::numeric) AS amount, sum(s_lastot::numeric - slab_amt::numeric) AS net, min(tax_id) AS tax FROM ${db}ledger_ext`
      + ` WHERE slab_id = ANY($1::int[]) AND led_id = ANY($2::int[]) GROUP BY led_id, coalesce(il_id, 0), slab_id`, [slabs.map((slab) => slab.key), ledgerIds])).rows) {
      amounts.set(`${num(row.led_id)}\u0000${num(row.il)}\u0000${num(row.slab_id)}`, { amount: num(row.amount), net: num(row.net), tax: num(row.tax) });
    }
    for (const row of (await runReportSql(loader, `SELECT tax_rec, tax_repohd FROM ${db}tax_master WHERE tax_pos <> 'D'`)).rows) taxNames.set(num(row.tax_rec), toText(row.tax_repohd));
  }

  const names = ["SMART_LED_KEY", "book", "Book_Name", "Date", "Document", ...(byItem ? ["Invoice_No"] : []), "PARTICULARS", "Expense_Name", "Group_Name", "Sub_Ledger_Name", "Exp_Nature", ...(byItem ? ["Item", "Quantity", "Rate"] : []),
    ...pieces.map((piece) => piece.name), ...(pieces.some((piece) => piece.kind === "net") ? [] : ["NET_AMOUNT"]), "Amount", "narration"];
  const table = new ResultTable();
  for (const name of names) table.addColumn(name);
  for (const name of ["Quantity", "Rate", "Amount", "NET_AMOUNT", ...pieces.filter((piece) => piece.kind !== "desc").map((piece) => piece.name)]) if (table.has(name)) table.setKind(name, "decimal");
  const blank = (values: ResultRow): ResultRow => Object.assign(Object.fromEntries(names.map((name) => [name, null])), values);

  type Line = { book: string; time: number; document: string; index: number; row: ResultRow };
  const lines: Line[] = [];
  const push = (book: string, date: Date, document: string, row: ResultRow) => lines.push({ book, time: date.getTime(), document, index: lines.length, row });
  const addLess = pieces.find((piece) => piece.name.toLowerCase() === "add_less");
  for (const row of vouchers) {
    const ledger = num(row.led_key);
    const sign = num(row.book) === 15 ? 1 : -1;
    const il = byItem ? num(row.il_key) : 0;
    const values: ResultRow = { SMART_LED_KEY: ledger, book: num(row.book), Book_Name: num(row.book) === 15 ? " Expense" : " DN Expense", Date: style6(row.doc_date as Date), Document: toText(row.full_docno), PARTICULARS: toText(row.party),
      Expense_Name: toText(row.expense), Group_Name: toText(row.group_name), Sub_Ledger_Name: row.sub_ledger === null ? null : toText(row.sub_ledger), Exp_Nature: row.nature === null ? null : toText(row.nature), Amount: sign * num(row.amount), narration: toText(row.narration) };
    if (byItem) Object.assign(values, { Invoice_No: toText(row.doc_no1), Item: row.item === null ? null : toText(row.item), Quantity: row.quantity === null ? null : num(row.quantity), Rate: row.rate === null ? null : num(row.rate) });
    for (const piece of pieces) {
      const found = amounts.get(`${ledger}\u0000${piece.level === "item" ? il : 0}\u0000${piece.slab}`);
      if (piece.kind === "value") values[piece.name] = row.il_value === null ? 0 : num(row.il_value);
      else if (piece.kind === "net") values[piece.name] = found ? round2(sign * found.net) : 0;
      else if (piece.kind === "desc") values[piece.name] = found ? taxNames.get(found.tax) ?? "" : "";
      else values[piece.name] = found ? round2(sign * found.amount) : 0;
    }
    // The amounts of an item voucher only on its first line.
    if (byItem && row.serial !== null && num(row.serial) !== 1) { values.Amount = 0; if (addLess) values[addLess.name] = 0; }
    push(toText(values.Book_Name), row.doc_date as Date, toText(row.full_docno), blank(values));
  }

  // The payments, journals and discounts to the expense accounts.
  const others = async (books: string, extraWhere: string, bookName: string, amount: string, key: string) => {
    for (const row of (await runReportSql(loader, `SELECT ${key} AS led_key, led.book, led.doc_date, led.full_docno, (SELECT name FROM ${db}account WHERE code = led.post_bkcode AND a_pos <> 'D' LIMIT 1) AS particulars, ac.name AS expense, bs.bs_desc AS group_name,`
      + ` aent.txt_subled AS sub_ledger, aent.txt_exp_nature AS nature, ${amount} AS net, led.narration FROM ${db}ledger led LEFT JOIN ${db}account ac ON ac.code = led.code LEFT JOIN ${db}balsheet bs ON ac.bs_id = bs.bs_key`
      + ` LEFT JOIN ${db}addon_aentry aent ON aent.aona_ledid = led.led_key WHERE led.doc_date BETWEEN $1::date AND $2::date AND led.doc_pos <> 'D' AND led.book IN ${books}${extraWhere}${departments("aent.txt_subled")} ORDER BY led.doc_date`, [...params, ...extra])).rows) {
      const name = bookName === "" ? (num(row.book) === 4 ? "Cash Book" : "Bank Book") : bookName;
      push(name, row.doc_date as Date, toText(row.full_docno), blank({ SMART_LED_KEY: num(row.led_key), book: num(row.book), Book_Name: name, Date: style6(row.doc_date as Date), Document: toText(row.full_docno), PARTICULARS: toText(row.particulars), Expense_Name: toText(row.expense),
        Group_Name: toText(row.group_name), Sub_Ledger_Name: row.sub_ledger === null ? null : toText(row.sub_ledger), Exp_Nature: row.nature === null ? null : toText(row.nature), NET_AMOUNT: num(row.net), narration: toText(row.narration) }));
    }
  };
  const expenseHeads = ` AND left(bs.bs_code, 2) IN ('01', '02', '03', '04')`;
  await others("(4, 6)", expenseHeads, "", "CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE -led.amount::numeric END", "led.led_key");
  await others("(19)", `${expenseHeads} AND led.ac_dbcode = 1`, "Journal", "CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE 0 END", "led.unique_key");
  await others("(5)", " AND led.ac_dbcode = 2", "Discount", "CASE WHEN led.ac_dbcode = 2 THEN -led.amount::numeric ELSE 0 END", "led.led_key");

  // By book: 10 (DN Expense), 15 (Expense), 6 (Bank), 4 (Cash), 5 (Discount), 19 (Journal).
  const rank = (line: Line) => { const at = [10, 15, 6, 4, 5, 19].indexOf(num(line.row.book)); return at < 0 ? 99 : at; };
  table.rows = lines.sort((a, b) => rank(a) - rank(b) || a.time - b.time || a.document.localeCompare(b.document, undefined, { numeric: true }) || a.index - b.index).map((line) => line.row);
  return table;
}
