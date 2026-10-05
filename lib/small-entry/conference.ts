import { formatDesktopDate, formatDesktopTime, parseDesktopDate, toInt } from "../master-program/legacy";
import type { Loader } from "../master-program/load";
import { SYSTEM_SCHEMA } from "../master-program/session";
import { cellOf } from "./entrySave";
import type { EntryStatement } from "./entrySave";
import type { EditedRow, EntryOption, EntryState } from "./types";

/**
 * Small_Entry.Save_Click for Conference Order (34): the quantities typed against each product
 * become up to three sale orders (ORD-OUT), one per order date - Qty1 / Loose1 on Order Date1,
 * Qty2 / Loose2 on Date2, Qty3 / Loose3 on Date3.
 *
 * Each order is a process row numbered after the year's ODoc series, a prod_ledger line per
 * product priced from the price list on that date, and ledger_ext slabs: on each line the
 * party discount (account.a_perc), the spot discount (price list SP slab), the scheme group's
 * and the grade's party_rate discounts, the party trade discount, then IGST or CGST + SGST
 * (by the party's state against the company's); on the order the same totals, the round-off
 * to the rupee, the transport / order type addon row and the order amount. Amounts round to
 * the paisa as C# Math.Round does (a half to the even paisa); the total to the rupee away
 * from zero. The slab, book and unit numbers are the desktop's own.
 */

export const CONFERENCE_ORDER = 34;

export type ConferenceResult = Readonly<{ statements: EntryStatement[]; savedRows: Set<number>; messages: string[] }>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const amountOf = (value: unknown) => Number(String(value ?? "").replace(/,/g, "").trim()) || 0;

/** C# Math.Round(x, 2): to the paisa, a half to the even paisa. */
export function roundPaisa(value: number): number {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const whole = Math.abs(fraction - 0.5) < 1e-7 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  return whole / 100;
}

/** Math.Round(x, 0, MidpointRounding.AwayFromZero). */
export const roundRupee = (value: number) => Math.sign(value) * Math.round(Math.abs(value) + 1e-9);

const number = (value: number) => String(Number(value.toFixed(4)));

/** The quantity columns of an order date: the carton count and the loose pieces (grid columns 2/3, 4/5, 6/7). */
const GROUPS = [
  { qty: "Qty1", loose: "LOOSE_QTY1", date: "dtp_date" },
  { qty: "Qty2", loose: "LOOSE_QTY2", date: "dtp_date2" },
  { qty: "Qty3", loose: "LOOSE_QTY3", date: "dtp_date3" },
] as const;

export async function conferenceStatements(loader: Loader, entryId: number, rows: readonly EditedRow[], state: EntryState, choices: Readonly<Record<string, EntryOption>>, now = new Date()): Promise<ConferenceResult | null> {
  if (entryId !== CONFERENCE_ORDER) return null;
  const { session } = loader;
  const schema = session.companySchema;
  const statements: EntryStatement[] = [];
  const savedRows = new Set<number>();
  const messages: string[] = [];
  const read = async (sql: string, params: unknown[] = []) => (await loader.readTable(sql, params))?.[0];
  const year = quote(session.yearId);
  const dateOf = (control: string) => formatDesktopDate(parseDesktopDate(state.controls[control] ?? "") ?? now);

  const partyCode = toInt(state.firstCombo?.value);
  const party = await read(`select a.code, a.a_perc, c.opt_short, d.txt_trans, d.key_trans, d.key_schemegrp, d.txt_schemegrp, d.key_grade, d.txt_grade, d.input_party_td from ${schema}.account a left join ${schema}.address b on b.code=a.code and address_id=1 left join ${schema}.idopt_master c on c.idopt_key=b.state_id left join ${schema}.addon_data d on d.code=a.code where a.a_pos<>'D' and a.code=$1`, [partyCode]);
  if (!party) return { statements, savedRows, messages: ["The party was not found"] };
  const companyState = String((await read(`select state_code from ${SYSTEM_SCHEMA}.company where co_key=$1`, [session.companyKey]))?.state_code ?? "").trim();
  const interState = String(party.opt_short ?? "").trim() !== companyState;
  const spotDiscount = amountOf((await read(`select pl_slabperc from ${schema}.pricelist where pl_wefrom<=$1 and pl_weupto>=$1 and pl_enddate>=$1 and pl_pos<>'D' and pl_select='SP' and pl_slabperc > 0 order by pl_wefrom desc limit 1`, [dateOf("dtp_date")]))?.pl_slabperc);
  const taxCode = async (short: string, perc: number) => read(`select tax_rec, tax_perc from ${schema}.tax_master where tax_pos<>'D' and tax_short=$1 and tax_perc=$2`, [short, perc]);

  // The order series: ODoc/<first year>-<last two digits of the closing year>, numbered after its highest.
  const series = `ODoc/${session.tarikh1.getFullYear()}-${String(session.tarikh2.getFullYear()).slice(2)}`;
  const top = Number((await read(`select max(nullif(regexp_replace(doc_no2, '\\D', '', 'g'), '')::numeric) as top from ${schema}.process where stk_module='ORD-OUT' and p_docseries=$1 and il_pos<>'D'`, [series]))?.top ?? 0);
  let next = top > 0 ? top + 1 : 1;
  const saveDate = quote(formatDesktopDate(now));
  const saveTime = quote(formatDesktopTime(now));
  const slab = (process: string, line: string | null, slabId: number, amount: number, perc: number, net: number, taxId?: number) => statements.push({ sql: "", insert: {
    table: "ledger_ext",
    fields: [...(line ? ["il_id"] : []), "slab_id", "slab_amt", ...(taxId !== undefined ? ["tax_id"] : []), "slab_perc", "s_lastot", "form_recd", "process_id", "year_id"],
    values: [...(line ? [line] : []), String(slabId), number(amount), ...(taxId !== undefined ? [String(taxId)] : []), number(perc), number(net), "'N'", process, year],
  } });

  let orders = 0;
  for (const group of GROUPS) {
    const lines = rows.map((row, index) => ({ ...row, index })).filter((row) => !row.deleted && amountOf(cellOf(row.values, group.qty)) > 0);
    if (lines.length === 0) continue;
    const date = dateOf(group.date);
    const docNo = next++;
    const fullDocNo = `${series}/${docNo}`;
    const process = `order${++orders}`;
    const ref = `{{${process}}}`;
    statements.push({ sql: "", insert: { table: "process", capture: process,
      fields: ["stk_module", "doc_no2", "book", "p_date", "post_date", "code", "il_pos", "p_docseries", "full_docno", "p_bkdbcode", "p_amount", "entry_for", "stk_remark", "year_id", "last_savedate", "last_savetime", "entry_no", "ent_address_id", "user_id", "eway_billno", "eway_billdate", "eway_valid", "supply_type", "sub_supply_type", "eway_doc_type", "trp_mode", "distance_km", "eway_veh_type"],
      values: ["'ORD-OUT'", quote(String(docNo).padStart(10)), "8", quote(date), quote(date), String(partyCode), "'A'", quote(series), quote(fullDocNo), "2", "0", "'P'", "''", year, saveDate, saveTime, "''", String(toInt(choices.cmb_smallentry1?.value)), String(session.userNo), "''", quote(date), "''", "0", "0", "0", "0", "''", "0"] } });

    const totals = { product: 0, party: 0, spot: 0, scheme: 0, additional: 0, trade: 0, igst: 0, cgst: 0, sgst: 0 };
    let serial = 0;
    for (const line of lines) {
      const values = line.values;
      const productKey = toInt(cellOf(values, "item__key"));
      const itemText = (cellOf(values, "item") ?? "").replace(/\s*Stock\s*:.*$/i, "").trim();
      const product = await read(`select prod_key, bill_desc, base_pack, tax_perc, coalesce((select pl_srate from ${schema}.pricelist where prod_id=a.prod_key and pl_pos<>'D' and pl_srate>0 and pl_wefrom<=$2 and (pl_weupto>=$2 or pl_weupto is null) order by pl_wefrom desc limit 1),0) as rate, txt_prodgroup, key_prodgroup from ${schema}.product_master a left join ${schema}.addon_data b on a.prod_key=b.prod_id where prod_pos<>'D' and ${productKey > 0 ? "prod_key=$1" : "btrim(prod_desc)=$1"}`, [productKey > 0 ? productKey : itemText, date]);
      if (!product) { messages.push(`Product not found: ${itemText}`); continue; }
      const scheme = String(party.txt_schemegrp ?? "").trim() === "" ? undefined : await read(`select pr_slabperc from ${schema}.party_rate where pr_addless='L' and (pr_inputcol='R' or pr_inputcol='P') and pr_accode is null and pr_prodid=$1 and pr_aonsub in (select sub_code from ${schema}.addon_sub where rtrim(sub_name)=$2 and sub_pos='A') and pr_aonsub1 is null and pr_wefrom<=$3 and (pr_weupto>=$3 or pr_weupto is null) and pr_pos<>'D' order by pr_wefrom desc limit 1`, [product.prod_key, String(party.txt_schemegrp).trim(), date]);
      const grade = String(party.txt_grade ?? "").trim() === "" ? undefined : await read(`select pr_slabperc from ${schema}.party_rate where pr_addless='L' and (pr_inputcol='R' or pr_inputcol='P') and pr_paraselect='S' and pr_accode is null and pr_prodid is null and pr_aonsub1=$1 and pr_aonsub in (select sub_code from ${schema}.addon_sub where rtrim(sub_name)=$2 and sub_pos='A') and pr_wefrom<=$3 and (pr_weupto>=$3 or pr_weupto is null) and pr_pos<>'D' order by pr_wefrom desc limit 1`, [toInt(product.key_prodgroup), String(party.txt_grade).trim(), date]);
      const taxPerc = amountOf(product.tax_perc);
      const tax1 = interState ? await taxCode(taxPerc === 18 ? "I18" : "I12", taxPerc) : await taxCode(taxPerc === 18 ? "C9" : "C6", taxPerc === 18 ? 9 : 6);
      const tax2 = interState ? undefined : await taxCode(taxPerc === 18 ? "U9" : "U6", taxPerc === 18 ? 9 : 6);
      if ((taxPerc !== 18 && taxPerc !== 12) || !tax1 || (!interState && !tax2)) { messages.push(`No GST code for ${taxPerc}% (${String(product.bill_desc ?? itemText)})`); continue; }

      const cartons = amountOf(cellOf(values, group.qty));
      const loose = amountOf(cellOf(values, group.loose));
      const basePack = amountOf(product.base_pack);
      const factor = (basePack > 0 ? cartons * basePack : 0) + loose;
      const rate = amountOf(product.rate);
      const amount = roundPaisa(factor * rate);
      totals.product += amount;
      serial += 1;
      const lineRef = `${process}line${serial}`;
      statements.push({ sql: "", insert: { table: "prod_ledger", capture: lineRef,
        fields: ["il_serial", "code", "doc_no1", "prod_id", "il_prodcd", "il_billdesc", "quantity", "rate", "master_rate", "il_value", "book", "book_code", "rateuom_id", "uomentry_id", "type", "il_date", "stock_nat", "il_pos", "il_div", "full_docno", "order_no", "slab_cost", "cost_rate", "inventory", "stock_type", "factor", "trn_qty1", "trn_qty2", "trn_qty3", "trn_pcs", "trn_pack", "trn_weight", "trn_module", "trn_stkmid", "link_stkmdl", "ag_qty", "ag_fact", "process_id", "year_id", "ag_pack", "loose_qty", "pack_qty", "bundle"],
        values: [String(serial), String(partyCode), quote(String(docNo).padStart(10)), String(product.prod_key), "''", quote(String(product.bill_desc ?? "")), number(factor), number(rate), "0", number(amount), "8", "31", "5", "5", "23", quote(date), "'L'", "'A'", "372", quote(fullDocNo), "''", "0", "0", "'N'", "'R'", number(factor), number(factor), number(factor), number(factor), number(factor), number(cartons), number(factor), "'ORD-OUT'", "'OR'", "''", "0", "0", ref, year, "0", number(loose), number(basePack), number(cartons)] } });
      const lref = `{{${lineRef}}}`;
      let net = amount;
      const discount = (slabId: number, perc: number, total: keyof typeof totals) => {
        if (!(perc > 0)) return;
        const off = roundPaisa(net * perc / 100);
        net = roundPaisa(net - off);
        totals[total] += off;
        slab(ref, lref, slabId, off, perc, net);
      };
      discount(188, amountOf(party.a_perc), "party");
      discount(227, spotDiscount, "spot");
      discount(225, amountOf(scheme?.pr_slabperc), "scheme");
      discount(226, amountOf(grade?.pr_slabperc), "additional");
      discount(231, amountOf(party.input_party_td), "trade");
      if (interState) {
        const tax = net > 0 ? roundPaisa(net * taxPerc / 100) : roundPaisa(amount * taxPerc / 100);
        net = net > 0 ? roundPaisa(net + tax) : roundPaisa(tax + amount);
        totals.igst += tax;
        slab(ref, lref, 189, tax, taxPerc, net, toInt(tax1.tax_rec));
      } else {
        const half = amountOf(tax1.tax_perc);
        const tax = net > 0 ? roundPaisa(net * half / 100) : roundPaisa(amount * half / 100);
        net = net > 0 ? roundPaisa(net + tax) : roundPaisa(tax + amount);
        totals.cgst += tax;
        totals.sgst += tax;
        slab(ref, lref, 189, tax, half, net, toInt(tax1.tax_rec));
        net = roundPaisa(net + tax);
        slab(ref, lref, 222, tax, amountOf(tax2!.tax_perc), net, toInt(tax2!.tax_rec));
      }
      savedRows.add(line.index);
    }
    if (serial === 0) { statements.splice(statements.findIndex((s) => s.insert?.capture === process), 1); next -= 1; orders -= 1; continue; }

    // The order's totals, each with the net after it, then the round-off to the rupee.
    let net = 0;
    if (totals.product > 0) slab(ref, null, 191, totals.product, 0, totals.product);
    const after = (...parts: number[]) => roundPaisa(parts.reduce((sum, part) => sum + part, 0));
    net = after(totals.product, -totals.party);
    if (totals.party > 0) slab(ref, null, 188, totals.party, 0, net);
    if (totals.spot > 0) { net = after(totals.product, -totals.party, -totals.spot); slab(ref, null, 227, totals.spot, 0, net); }
    if (totals.scheme > 0) { net = after(totals.product, -totals.party, -totals.spot, -totals.scheme); slab(ref, null, 225, totals.scheme, 0, net); }
    if (totals.additional > 0) { net = after(totals.product, -totals.party, -totals.spot, -totals.scheme, -totals.additional); slab(ref, null, 226, totals.additional, 0, net); }
    if (totals.trade > 0) { net = after(totals.product, -totals.party, -totals.spot, -totals.scheme, -totals.additional, -totals.trade); slab(ref, null, 231, totals.trade, 0, net); }
    const discounted = [totals.product, -totals.party, -totals.spot, -totals.scheme, -totals.additional, -totals.trade];
    if (totals.igst > 0) { net = after(...discounted, totals.igst); slab(ref, null, 189, totals.igst, 0, net); }
    if (totals.cgst > 0) { net = after(...discounted, totals.cgst); slab(ref, null, 189, totals.cgst, 0, net); }
    if (totals.sgst > 0) { net = after(...discounted, totals.cgst, totals.sgst); slab(ref, null, 222, totals.sgst, 0, net); }
    const rounded = roundRupee(net);
    if (rounded !== net) slab(ref, null, 187, roundPaisa(rounded - net), 0, rounded);
    statements.push({ sql: "", insert: { table: "addon_aentry", fields: ["aona_accode", "aona_processid", "aona_recid", "key_trans", "txt_trans", "key_ordtype", "txt_ordtype"], values: [String(partyCode), ref, "'P'", String(toInt(party.key_trans)), quote(String(party.txt_trans ?? "")), String(toInt(choices.cmb_smallentry3?.value)), quote(state.controls.cmb_smallentry3 ?? "")] } });
    if (rounded > 0) statements.push({ sql: `Update process set p_amount=${number(rounded)} where process_key=${ref}` });
  }
  return { statements, savedRows, messages };
}
