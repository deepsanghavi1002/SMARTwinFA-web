import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";

const SCHEMA = legacyCompanySchema();
type Item = { productKey: number; quantity: number; rate: number };
type Ledger = { accountCode: number; debit: number; credit: number };
export type EntryPost = { kind: "invoice" | "voucher"; book: number; date: string; partyCode: number; series?: string; documentNumber?: string; narration?: string; creditDays?: number; items?: Item[]; ledger?: Ledger[] };

const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
const money = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0;

export function validateEntryPost(raw: unknown): EntryPost {
  if (!raw || typeof raw !== "object") throw new Error("Invalid entry command");
  const input = raw as Record<string, unknown>;
  const kind = input.kind === "invoice" || input.kind === "voucher" ? input.kind : undefined;
  const book = Number(input.book); const partyCode = Number(input.partyCode);
  const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : "";
  if (!kind || !Number.isInteger(book) || !positive(partyCode) || !date) throw new Error("Entry kind, book, date and party are required");
  const items = Array.isArray(input.items) ? input.items.map((line) => ({ productKey: Number((line as Item).productKey), quantity: Number((line as Item).quantity), rate: Number((line as Item).rate) })) : [];
  const ledger = Array.isArray(input.ledger) ? input.ledger.map((line) => ({ accountCode: Number((line as Ledger).accountCode), debit: Number((line as Ledger).debit), credit: Number((line as Ledger).credit) })) : [];
  if (kind === "invoice" && (!items.length || items.some((line) => !positive(line.productKey) || !positive(line.quantity) || !money(line.rate)))) throw new Error("Each invoice line needs a product, quantity and rate");
  const debit = ledger.reduce((sum, line) => sum + (money(line.debit) ? line.debit : 0), 0);
  const credit = ledger.reduce((sum, line) => sum + (money(line.credit) ? line.credit : 0), 0);
  if (kind === "voucher" && (!ledger.length || ledger.some((line) => !positive(line.accountCode) || !money(line.debit) || !money(line.credit)) || debit <= 0 || Math.abs(debit - credit) > 0.005)) throw new Error("Voucher lines must balance to a non-zero amount");
  return { kind, book, date, partyCode, items, ledger, series: String(input.series ?? "").trim().slice(0, 20), documentNumber: String(input.documentNumber ?? "").trim().replace(/[^A-Za-z0-9/-]/g, "").slice(0, 30), narration: String(input.narration ?? "").trim().slice(0, 500), creditDays: Math.max(0, Math.min(999, Number(input.creditDays) || 0)) };
}

export async function postLegacyEntry(raw: unknown) {
  if (process.env.SMARTWINFA_ENTRY_WRITES !== "true") throw new Error("Entry writes are disabled in this environment");
  const entry = validateEntryPost(raw); const client = await legacyPool().connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock($1)", [600141141541150]);
    const party = await client.query(`SELECT 1 FROM ${SCHEMA}.account WHERE code=$1 AND COALESCE(a_pos,'A')<>'D'`, [entry.partyCode]);
    const book = await client.query(`SELECT 1 FROM ${SCHEMA}.book_properties WHERE book_key=$1`, [entry.book]);
    if (!party.rowCount || !book.rowCount) throw new Error("The selected party or register no longer exists");
    const year = await client.query<{ year_id: string }>(`SELECT year_id FROM ${SCHEMA}.prod_balance WHERE year_id ~ '^[0-9]{16}$' ORDER BY year_id DESC LIMIT 1`);
    const yearId = year.rows[0]?.year_id; if (!yearId) throw new Error("No active accounting year is available");
    const next = await client.query<{ key: number }>(`SELECT COALESCE(MAX(process_key),0)+1 AS key FROM ${SCHEMA}.process`);
    const documentNumber = entry.documentNumber || String(next.rows[0].key);
    const fullDocument = `${entry.series || "WEB"}-${documentNumber}`;
    const duplicate = await client.query(`SELECT 1 FROM ${SCHEMA}.process WHERE full_docno=$1 AND book=$2 AND COALESCE(il_pos,'')<>'D'`, [fullDocument, entry.book]);
    if (duplicate.rowCount) throw new Error("This document number already exists in the selected register");
    const amount = entry.kind === "invoice" ? entry.items!.reduce((sum, line) => sum + line.quantity * line.rate, 0) : entry.ledger!.reduce((sum, line) => sum + line.debit, 0);
    const process = await client.query<{ process_key: number }>(`INSERT INTO ${SCHEMA}.process(process_key,stk_module,doc_no2,book,book_code,p_date,code,il_pos,p_docseries,full_docno,p_bkdbcode,p_amount,delv_days,entry_for,stk_remark,year_id,last_savedate,last_savetime,entry_no,post_date,print_count) VALUES ($1,$2,$3,$4,$5,$6,$7,'A',$8,$9,2,$10,$11,$12,$13,$14,CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS'),$3,$6,0) RETURNING process_key`, [next.rows[0].key, entry.kind === "invoice" ? "S" : "A", documentNumber, entry.book, entry.partyCode, entry.date, entry.partyCode, entry.series, fullDocument, amount, entry.creditDays, entry.kind === "invoice" ? "P" : "A", entry.narration, yearId]);
    const ledgerLines = entry.kind === "invoice" ? [{ accountCode: entry.partyCode, debit: amount, credit: 0 }] : entry.ledger!;
    for (const line of ledgerLines) {
      const led = await client.query<{ led_key: number }>(`INSERT INTO ${SCHEMA}.ledger(led_key,code,doc_date,doc_no,doc_series,full_docno,amount,book_amt,book,book_code,bk_dbcode,ac_dbcode,narration,post_amt,doc_posting,doc_pos,prod_amt,entry_sty,year_id,credit_days,last_savedate,last_savetime,print_count) SELECT COALESCE(MAX(led_key),0)+1,$1,$2,$3,$4,$5,$6,$6,$7,$1,2,$8,$9,$6,'P','A',$10,'W',$11,$12,CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS'),0 FROM ${SCHEMA}.ledger RETURNING led_key`, [line.accountCode, entry.date, documentNumber, entry.series, fullDocument, line.debit - line.credit, entry.book, line.debit > 0 ? 1 : 2, entry.narration, entry.kind === "invoice" ? amount : 0, yearId, entry.creditDays]);
      await client.query(`INSERT INTO ${SCHEMA}.ledger_post(post_key,led_id,post_code,post_date,post_bookcd,post_book,post_amt,post_dbcode,year_id) SELECT COALESCE(MAX(post_key),0)+1,$1,$2,$3,$2,$4,$5,$6,$7 FROM ${SCHEMA}.ledger_post`, [led.rows[0].led_key, line.accountCode, entry.date, entry.book, Math.abs(line.debit - line.credit), line.debit > 0 ? 1 : 2, yearId]);
    }
    if (entry.kind === "invoice") for (const [index, line] of entry.items!.entries()) {
      const product = await client.query<{ prod_short: string; bill_desc: string | null; issuuom_id: number | null }>(`SELECT prod_short,bill_desc,issuuom_id FROM ${SCHEMA}.product_master WHERE prod_key=$1 AND COALESCE(prod_pos,'A')<>'D'`, [line.productKey]);
      if (!product.rowCount) throw new Error("A selected product no longer exists");
      await client.query(`INSERT INTO ${SCHEMA}.prod_ledger(il_key,led_id,il_serial,doc_no1,prod_id,il_prodcd,il_billdesc,quantity,rate,master_rate,il_value,book,book_code,rateuom_id,uomentry_id,type,il_date,stock_nat,code,il_pos,full_docno,inventory,factor,year_id) SELECT COALESCE(MAX(il_key),0)+1,$1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$12,1,$13,'O',$11,'A',$14,'S',1,$15 FROM ${SCHEMA}.prod_ledger`, [process.rows[0].process_key, index + 1, documentNumber, line.productKey, product.rows[0].prod_short, product.rows[0].bill_desc ?? product.rows[0].prod_short, line.quantity, line.rate, line.quantity * line.rate, entry.book, entry.partyCode, product.rows[0].issuuom_id ?? 0, entry.date, fullDocument, yearId]);
      const stock = await client.query(`UPDATE ${SCHEMA}.prod_balance SET less_pcs=COALESCE(less_pcs,0)+$1,clsg_pcs=COALESCE(clsg_pcs,0)-$1 WHERE prod_id=$2 AND year_id=$3 AND prec_flag='RP'`, [line.quantity, line.productKey, yearId]);
      if (!stock.rowCount) throw new Error("The selected product has no active stock balance");
    }
    await client.query("COMMIT"); return { source: "legacy-postgresql" as const, posted: true, processKey: process.rows[0].process_key, documentNumber: fullDocument, amount: amount.toFixed(2) };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}
