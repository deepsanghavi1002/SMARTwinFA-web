import type { Client } from "pg";
import { formatDesktopDate, toDecimal, toInt, toText } from "./master-program/legacy";
import type { MasterSession } from "./master-program/session";

/**
 * Transaction > Transport Entry (Entry_Transport.cs). A transport's freight bill is booked as an expense voucher in book 15 (series
 * ExpTrp/YY-YY, book code 23): the open bills of the transport (sale / purchase / expense ledger rows and job-work processes whose
 * trp_amount is still 0) are listed, the operator types the freight against each, and the total is saved as one expense entry with its
 * product line (Freight Charges), GST slabs, postings, outstanding and special log. A TDS amount makes a journal (book 19) that sets the
 * TDS off against the bill. Uploaded documents go to <company>_image.document_upload.
 *
 * The statements follow the desktop's btn_Ok_Click one for one; where the desktop writes '' into a number column the port writes 0.
 */

export type Option = Readonly<{ key: number; name: string }>;

export type TransportOptions = Readonly<{
  transports: Option[];
  subLedgers: Option[];
  expNatures: Option[];
  expNames: Option[];
  /** The financial year and book 15's lock window, for the entry date checks (null = no lock). */
  yearFrom: string;
  yearTo: string;
  lockFrom: string | null;
  lockUpto: string | null;
  openFrom: string | null;
  openUpto: string | null;
  admin: boolean;
}>;

export type BillRow = Readonly<{ ledId: number; processId: number; party: string; docNo: string; invNo: string; lrNo: string; docDate: string; amount: number }>;

export type TransportSave = Readonly<{
  transportKey: number;
  subLedgerKey: number;
  expNatureKey: number;
  expNameCode: number;
  reverse: boolean;
  /** dtp_EntryDate: the entry's date (yyyy-mm-dd). */
  entryDate: string;
  /** dtp_Date: the invoice date (yyyy-mm-dd). */
  invoiceDate: string;
  invoiceNo: string;
  narration: string;
  amount: number;
  tds: number;
  rows: readonly { ledId: number; processId: number; amount: number }[];
  documents: readonly { name: string; remark: string; base64: string }[];
}>;

const pad2 = (value: number) => String(value).padStart(2, "0");
const isoDate = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const dateOnly = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : isoDate(date);
};
const parseIso = (text: string, what: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00`).getTime())) throw new Error(`${what} is not a date`);
  return text;
};
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
/** C# Math.Round(decimal, 0): to the even neighbour at .5. */
function roundEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}
const clock12 = (now: Date) => `${now.getHours() % 12 || 12}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} ${now.getHours() < 12 ? "AM" : "PM"}`;
const logDate = (now: Date) => formatDesktopDate(now);

const options = (rows: Record<string, unknown>[]): Option[] => rows.map((row) => ({ key: toInt(row.k), name: toText(row.n) }));

export async function loadTransportOptions(client: Client, session: MasterSession): Promise<TransportOptions> {
  const schema = session.companySchema;
  const sub = async (para: number) => options((await client.query(`SELECT sub_code AS k, sub_name AS n FROM ${schema}.addon_sub WHERE sub_pos <> 'D' AND para_id = $1 ORDER BY sub_name`, [para])).rows);
  const expNames = options((await client.query(`SELECT code AS k, name AS n FROM ${schema}.account WHERE a_pos <> 'D' AND exp_flag = 'Y' ORDER BY name`)).rows);
  const lock = (await client.query(`SELECT lock_from, lock_upto, open_from, open_upto, open_user FROM ${schema}.book_setup WHERE book = 15 LIMIT 1`)).rows[0] ?? {};
  const openMine = toText(lock.open_user) !== "" && toInt(lock.open_user) === session.userNo;
  return {
    transports: await sub(8), subLedgers: await sub(49), expNatures: await sub(99), expNames,
    yearFrom: isoDate(session.tarikh1), yearTo: isoDate(session.tarikh2),
    lockFrom: dateOnly(lock.lock_from), lockUpto: dateOnly(lock.lock_upto),
    openFrom: openMine ? dateOnly(lock.open_from) : null, openUpto: openMine ? dateOnly(lock.open_upto) : null,
    admin: session.userType.toUpperCase() === "AD",
  };
}

/** The open bills of a transport between two dates (tbx_Narration_Leave's query). */
export async function loadBills(client: Client, session: MasterSession, transportKey: number, from: string, to: string): Promise<BillRow[]> {
  const schema = session.companySchema;
  const result = await client.query(
    `SELECT CASE WHEN COALESCE(proce.full_docno,'') = '' THEN COALESCE(led.led_key,0) ELSE 0 END AS led_id,
            CASE WHEN COALESCE(proce.full_docno,'') = '' THEN 0 ELSE proce.process_key END AS process_id,
            ac.name,
            CASE WHEN COALESCE(proce.full_docno,'') = '' THEN COALESCE(led.full_docno,'') ELSE COALESCE(proce.full_docno,'') END AS doc_no,
            CASE WHEN COALESCE(proce.full_docno,'') = '' THEN COALESCE(BTRIM(led.doc_no1),'') ELSE COALESCE(BTRIM(proce.entry_no),'') END AS inv_no,
            COALESCE(BTRIM(aent.input_lrno),'') AS lr_no,
            CASE WHEN COALESCE(proce.full_docno,'') = '' THEN to_char(led.doc_date,'DD-Mon-YY') ELSE to_char(proce.p_date,'DD-Mon-YY') END AS doc_date,
            CASE WHEN COALESCE(proce.full_docno,'') = '' THEN COALESCE(led.amount::numeric,0) ELSE COALESCE(proce.p_amount::numeric,0) END AS amount
       FROM ${schema}.addon_aentry aent
       LEFT JOIN ${schema}.ledger led ON led.led_key = aent.aona_ledid AND led.doc_pos = 'A' AND (led.book IN (8,13,15) OR (led.book = 11 AND led.ag_book = 13)) AND led.doc_date::date BETWEEN $2::date AND $3::date
       LEFT JOIN ${schema}.process proce ON proce.process_key = aent.aona_processid AND proce.stk_module IN ('JOB-OUT','JOB-IN','CHLN-IN','CHLN-OUT','AMD-OUT') AND proce.il_pos = 'A' AND proce.p_date::date BETWEEN $2::date AND $3::date
       LEFT JOIN ${schema}.account ac ON ac.code = aent.aona_accode
      WHERE aent.key_trans = $1
        AND ((led.led_key IS NOT NULL AND COALESCE(led.trp_amount::numeric,0) = 0) OR (proce.process_key IS NOT NULL AND COALESCE(proce.trp_amount::numeric,0) = 0))
      ORDER BY ac.name`,
    [transportKey, parseIso(from, "From date"), parseIso(to, "Upto date")],
  );
  return result.rows.map((row) => ({
    ledId: toInt(row.led_id), processId: toInt(row.process_id), party: toText(row.name), docNo: toText(row.doc_no), invNo: toText(row.inv_no),
    lrNo: toText(row.lr_no), docDate: toText(row.doc_date), amount: toDecimal(row.amount),
  }));
}

type Party = Readonly<{ code: number; stateShort: string }>;

/** The transport's account (named as its transport) with the state short of its first address. */
async function partyOf(client: Client, session: MasterSession, transportName: string): Promise<Party | null> {
  const schema = session.companySchema;
  const row = (await client.query(
    `SELECT ac.code, idopt.opt_short FROM ${schema}.account ac LEFT JOIN ${schema}.address addr ON addr.code = ac.code LEFT JOIN ${schema}.idopt_master idopt ON idopt.idopt_key = addr.state_id
      WHERE ac.name = $1 AND ac.book = 1 AND addr.address_id = 1 ORDER BY ac.code LIMIT 1`, [transportName])).rows[0];
  return row ? { code: toInt(row.code), stateShort: toText(row.opt_short) } : null;
}

async function transportName(client: Client, session: MasterSession, key: number): Promise<string> {
  const row = (await client.query(`SELECT sub_name FROM ${session.companySchema}.addon_sub WHERE sub_code = $1 AND para_id = 8 AND sub_pos <> 'D'`, [key])).rows[0];
  if (!row) throw new Error("Transport not found");
  return toText(row.sub_name);
}

/** txt_Amount_Leave: the TDS rate of the transport's account and the TDS on the amount (rounded as C# Math.Round does). */
export async function tdsFor(client: Client, session: MasterSession, transportKey: number, amount: number): Promise<{ rate: number; tds: number }> {
  const schema = session.companySchema;
  const party = await partyOf(client, session, await transportName(client, session, transportKey));
  if (!party) return { rate: 0, tds: 0 };
  let kind = "I";
  const deduct = (await client.query(`SELECT opt_desc FROM ${schema}.idopt_master WHERE idopt_key IN (SELECT type_deduct FROM ${schema}.account WHERE code = $1)`, [party.code])).rows[0];
  if (deduct) kind = toText(deduct.opt_desc).slice(0, 1).toUpperCase() === "C" ? "C" : "I";
  const chart = (await client.query(`SELECT tds_rate_individual, tds_rate_company FROM smart_setup.tds_chart WHERE tds_key IN (SELECT nature_pay FROM ${schema}.account WHERE code = $1) LIMIT 1`, [party.code])).rows[0];
  const rate = chart ? (toDecimal(chart.tds_rate_company) > 0 && kind === "C" ? toDecimal(chart.tds_rate_company) : toDecimal(chart.tds_rate_individual)) : 0;
  return { rate, tds: amount > 0 && rate > 0 ? roundEven((amount * rate) / 100) : 0 };
}

const seriesOf = (session: MasterSession) => `ExpTrp/${formatDesktopDate(session.tarikh1).slice(9, 11)}-${formatDesktopDate(session.tarikh2).slice(9, 11)}`;

/** txt_InvoiceNo_Leave: the transport already has this invoice number in the year's series. */
export async function invoiceExists(client: Client, session: MasterSession, transportKey: number, invoiceNo: string): Promise<boolean> {
  const party = await client.query(`SELECT code FROM ${session.companySchema}.account WHERE name = $1 AND book = 1 AND a_pos = 'A' LIMIT 1`, [await transportName(client, session, transportKey)]);
  if (party.rowCount === 0) return false;
  const found = await client.query(
    `SELECT 1 FROM ${session.companySchema}.ledger WHERE book = 15 AND doc_pos <> 'D' AND doc_posting = 'P' AND doc_series = $1 AND BTRIM(doc_no1) = $2 AND code = $3 LIMIT 1`,
    [seriesOf(session), invoiceNo, toInt(party.rows[0].code)]);
  return (found.rowCount ?? 0) > 0;
}

/** ValidateEntryDate: inside the year, and (except for an administrator) outside the book's lock window unless opened for this user. */
export function checkEntryDate(opts: TransportOptions, date: string): string {
  if (date < opts.yearFrom || date > opts.yearTo) return `Date Should be Allowed Only from ${opts.yearFrom} to ${opts.yearTo}`;
  if (opts.admin) return "";
  let locked = true;
  if (opts.openFrom !== null && opts.openUpto !== null && opts.openFrom <= opts.yearTo && date >= opts.openFrom && date <= opts.openUpto) locked = false;
  const lockFrom = opts.lockFrom ?? opts.yearTo;
  const lockUpto = opts.lockUpto ?? opts.yearTo;
  if (locked && (date < lockFrom || date > lockUpto)) locked = false;
  return locked ? `Period is lock from ${lockFrom} to ${lockUpto} Entry Validation: Lock Date` : "";
}

/** The JSON-ish text the desktop builds by hand: no escaping, exactly as it writes it. */
const pair = (name: string, value: string | number) => `"${name}": "${value}"`;
const obj = (...pairs: string[]) => `{${pairs.join(",")}}`;

/** Inserts with the table's key sequence first moved past the table's largest key (the migrated sequences can lag). */
class Writer {
  private readonly checked = new Set<string>();
  constructor(private readonly client: Client) {}

  private async syncSequence(table: string, keyColumn: string) {
    if (this.checked.has(table)) return;
    this.checked.add(table);
    const sequence = (await this.client.query("SELECT pg_get_serial_sequence($1, $2) AS sequence", [table, keyColumn])).rows[0]?.sequence as string | null;
    if (!sequence) return;
    const top = Number((await this.client.query(`SELECT COALESCE(MAX(${keyColumn}), 0) AS top FROM ${table}`)).rows[0].top);
    const seen = (await this.client.query(`SELECT last_value, is_called FROM ${sequence}`)).rows[0];
    if (Number(seen.last_value) + (seen.is_called ? 1 : 0) <= top) await this.client.query("SELECT setval($1, $2, true)", [sequence, top]);
  }

  /** A number is sent as numeric so it reaches a money column without a locale parse. */
  async insert(table: string, keyColumn: string, row: Record<string, string | number | null>): Promise<number> {
    await this.syncSequence(table, keyColumn);
    const names: string[] = [];
    const marks: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [name, value] of Object.entries(row)) {
      names.push(name.toLowerCase() === "type" ? '"TYPE"' : name);
      params.push(value);
      marks.push(typeof value === "number" ? `$${params.length}::numeric` : `$${params.length}`);
    }
    const result = await this.client.query(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${marks.join(", ")}) RETURNING ${keyColumn} AS key`, params);
    return Number(result.rows[0].key);
  }
}

export type SaveResult = Readonly<{ fullDocNo: string; ledgerKey: number; finalAmount: number; warnings: string[] }>;

export async function saveTransportEntry(client: Client, session: MasterSession, input: TransportSave, now = new Date()): Promise<SaveResult> {
  const schema = session.companySchema;
  const opts = await loadTransportOptions(client, session);
  const entryDate = parseIso(input.entryDate, "Entry date");
  const invoiceDate = parseIso(input.invoiceDate, "Invoice date");
  const entryProblem = checkEntryDate(opts, entryDate);
  if (entryProblem) throw new Error(entryProblem);
  if (invoiceDate < opts.yearFrom || invoiceDate > opts.yearTo) throw new Error(`Date Should be Allowed Only from ${opts.yearFrom} to ${opts.yearTo}`);

  const gross = money(input.amount);
  if (!(gross > 0)) throw new Error("Amount Blank Not Allowed......");
  const rows = input.rows.filter((row) => row.amount > 0);
  const rowTotal = money(rows.reduce((sum, row) => sum + row.amount, 0));
  if (rowTotal !== gross) throw new Error("Entry Rows Amount Not Match Gross Amount......");
  const tds = money(input.tds);
  const reverse = input.reverse;

  const named = async (para: number, key: number, what: string) => {
    const row = (await client.query(`SELECT sub_name FROM ${schema}.addon_sub WHERE sub_code = $1 AND para_id = $2 AND sub_pos <> 'D'`, [key, para])).rows[0];
    if (!row) throw new Error(`${what} not found`);
    return toText(row.sub_name);
  };
  const transport = await transportName(client, session, input.transportKey);
  const subLedger = await named(49, input.subLedgerKey, "Sub Ledger");
  const expNature = await named(99, input.expNatureKey, "Expense Nature");
  const expAccount = (await client.query(`SELECT name FROM ${schema}.account WHERE code = $1 AND exp_flag = 'Y' AND a_pos <> 'D'`, [input.expNameCode])).rows[0];
  if (!expAccount) throw new Error("Expense account not found");
  const expName = toText(expAccount.name);

  const party = await partyOf(client, session, transport);
  if (!party) throw new Error("Transport Name Not Found In Database.....");
  const partyCode = party.code;

  await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa-transport-entry'))");
  const writer = new Writer(client);
  const series = seriesOf(session);
  const yearId = session.yearId;
  const savedOn = now;
  const narration = input.narration.replace(/[\r\n]/g, "").trim();
  const warnings: string[] = [];
  const t = `${schema}.`;

  // Next number of the series: after the highest digits of the year's ExpTrp entries.
  const top = (await client.query(
    `SELECT MAX(NULLIF(regexp_replace(doc_no, '\\D', '', 'g'), '')::numeric) AS top FROM ${t}ledger WHERE book = 15 AND doc_pos <> 'D' AND doc_posting = 'P' AND doc_series = $1`, [series])).rows[0]?.top;
  const docNo = top === null || top === undefined ? 1 : Number(top) + 1;
  const fullDocNo = `${series}/${docNo}`;

  const taxAmt = money(gross * (reverse ? 0.05 : 0.18));
  // Math.Round(x, 0, MidpointRounding.AwayFromZero)
  const final = Math.sign(gross + taxAmt) * Math.floor(Math.abs(gross + taxAmt) + 0.5);
  const half = money(taxAmt / 2);
  const interState = party.stateShort !== session.coStateCode;

  const taxRow = async (short: string) => {
    const row = (await client.query(`SELECT tax_rec, COALESCE(tax_accode,0) AS tax_accode, tax_perc FROM ${t}tax_master WHERE tax_pos <> 'D' AND tax_short = $1 LIMIT 1`, [short])).rows[0];
    if (!row) throw new Error(`Tax ${short} is not in the tax master`);
    return { rec: toInt(row.tax_rec), accode: toInt(row.tax_accode), perc: toDecimal(row.tax_perc) };
  };
  const tax3 = await taxRow(interState ? (reverse ? "RCMI" : "I18") : (reverse ? "R2.5%" : "C9"));
  const tax4 = interState ? null : await taxRow(reverse ? "RS2.5" : "U9");

  // The expense voucher.
  const bookAmount = reverse ? gross : final;
  const ledgerKey = await writer.insert(`${t}ledger`, "led_key", {
    code: partyCode, doc_date: entryDate, doc_no: String(docNo).padStart(10, " "), doc_series: series, full_docno: fullDocNo,
    doc_no1: input.invoiceNo !== "" ? input.invoiceNo.padStart(20, " ") : "",
    amount: bookAmount, book_amt: bookAmount, bk_dbcode: 1, book: 15, book_code: 23, ac_dbcode: 2, narration,
    setoff_amt: 0, ly_clearamt: 0, post_bkcode: input.expNameCode, ag_book: 0, TYPE: 0, int_type: 0, chln_date: invoiceDate, entry_type: "", post_date: entryDate,
    post_amt: bookAmount, doc_mode: 0, doc_lock: "", doc_pos: "A", doc_posting: "P", prod_amt: gross, stkmdl: "", doc_remark: "", entry_sty: "", year_id: yearId,
    currency_1: 0, entry_no: "", last_savedate: isoDate(savedOn), last_savetime: clock12(savedOn),
    rev_charge: reverse ? "Y" : "N", ent_address_id: 1, user_id: session.userNo,
  });

  // The bills now carry the freight and a link to this voucher.
  for (const row of rows) {
    if (row.ledId > 0) {
      const done = await client.query(`UPDATE ${t}ledger SET trp_amount = $1::numeric, trp_lrno = $2, trp_exp_led_id = $3 WHERE led_key = $4 AND COALESCE(trp_amount::numeric,0) = 0`, [row.amount, fullDocNo, ledgerKey, row.ledId]);
      if (done.rowCount === 0) throw new Error("A bill in the list has already been given a freight amount - load the list again");
    } else if (row.processId > 0) {
      const done = await client.query(`UPDATE ${t}process SET trp_amount = $1::numeric, trp_lrno = $2, trp_exp_led_id = $3 WHERE process_key = $4 AND COALESCE(trp_amount::numeric,0) = 0`, [row.amount, fullDocNo, ledgerKey, row.processId]);
      if (done.rowCount === 0) throw new Error("A bill in the list has already been given a freight amount - load the list again");
    }
  }

  const logEntry = "[" + obj(
    pair("!*Led_key", ledgerKey), pair("REGISTER", "EXPENSE REG."), pair("user", session.loginName), pair("savedate", logDate(savedOn)), pair("savetime", clock12(savedOn)),
    pair("machine_name", "WEB"), pair("* Series", series), pair("* Ent. Dt.", logDate(new Date(`${entryDate}T00:00:00`))), pair("* Ent. No.", docNo),
    pair("* Inv. Dt.", logDate(new Date(`${entryDate}T00:00:00`))), pair("* Inv. No.", input.invoiceNo), pair("* Party Name", transport), pair("Narration", narration),
    pair("* Reverse Entry", reverse ? "Yes" : "No"), pair("* Exp.Name", expName), pair("Document Amount", final),
  ) + "]";

  await client.query(`UPDATE ${t}ledger SET unique_key = $1 WHERE led_key = $1`, [ledgerKey]);
  await writer.insert(`${t}addon_aentry`, "aona_key", {
    aona_ledid: ledgerKey, aona_recid: "L", aona_accode: partyCode, key_subled: input.subLedgerKey, txt_subled: subLedger,
    key_exp_nature: input.expNatureKey, txt_exp_nature: expNature, key_trans: 260, txt_trans: " None", input_gatekiper: "",
  });

  const ilKey = await writer.insert(`${t}prod_ledger`, "il_key", {
    il_serial: 1, doc_no1: String(docNo).padStart(10, " "), prod_id: 5908, il_prodcd: "", il_billdesc: "Freight Charges", quantity: 1, rate: gross, master_rate: 0, prate_id: 0, il_value: gross,
    book: 15, book_code: 23, rateuom_id: 5, uomentry_id: 5, TYPE: 40, il_date: entryDate, stock_nat: "A", il_pos: "A", il_div: 460, full_docno: fullDocNo, order_no: "",
    slab_cost: 0, cost_rate: 0, inventory: "N", stock_type: "R", factor: 1, trn_qty1: 1, trn_qty2: 1, trn_qty3: 1, trn_pcs: 1, trn_pack: 1, trn_weight: 1,
    trn_module: "", link_stkmdl: "", ag_qty: 0, ag_fact: 0, led_id: ledgerKey, year_id: yearId, ag_pack: 0,
  });

  const logItems: string[] = [
    pair("!*Il_key", ilKey), pair("Item Sr.", 1), pair("* Product", "Freight Charges"), pair("* Q.Uom", "NOS"), pair("* Qty.", "1.0000"), pair("R.Uom", "NOS"),
    pair("* Rate.", gross), pair("Value", gross), pair("CASH_DIS%", ""), pair("CASH_DIS", ""),
  ];
  if (interState) {
    logItems.push(pair("* IGST Code%", reverse ? "RCMI5%" : "IGST 18% [I18]"), pair("IGST Code", taxAmt));
  } else if (reverse) {
    logItems.push(pair("* CGST Code%", "RCMC2.5%"), pair("CGST Code", half), pair("* UTGST Code%", "RCMS2.5%"), pair("UTGST Code", half));
  } else {
    logItems.push(pair("* CGST Code%", "CGST 9%"), pair("CGST Code", half), pair("* UTGST Code%", "UTGST 9%"), pair("UTGST Code", half));
  }
  logItems.push(pair("* Sub Ledger", subLedger));
  const logItemsText = `[${obj(...logItems)}]`;
  const logAddon = `[${obj(pair("!*Addon_Label", "* Transport"), pair("* Transport", " None"))},${obj(pair("!Addon_Label", "Gate Keeper Reg No."), pair("Gate Keeper Reg No.", ""))},${obj(pair("!Addon_Label", "* Expense Nature"), pair("* Expense Nature", expNature))}]`;

  await writer.insert(`${t}addon_ientry`, "aoni_key", {
    aoni_ledid: ledgerKey, aoni_il_id: ilKey, aoni_prodid: 5908, aoni_stknat: "A", aoni_entry_qty: 1, aoni_entry_uom: 5, aoni_entry_fact: 1, aoni_entry_factuom: 5,
    aoni_rep_qty: 1, aoni_clear_qty: 0, aoni_date: entryDate, aoni_rate: gross, key_subled: input.subLedgerKey, txt_subled: subLedger,
  });

  const balance = async (code: number, amount: number, debit: boolean) => {
    const column = debit ? "debit" : "credit";
    await client.query(`UPDATE ${t}ac_balance SET closing = (closing::numeric ${debit ? "+" : "-"} $1::numeric)::money, ${column} = (${column}::numeric + $1::numeric)::money WHERE code = $2 AND a_recflag = 'AC' AND year_id = $3`, [amount, code, yearId]);
  };
  const post = async (code: number, amount: number, debit: boolean) => {
    await writer.insert(`${t}ledger_post`, "post_key", { led_id: ledgerKey, post_code: code, post_date: entryDate, post_bookcd: 23, post_book: 15, post_amt: amount, post_dbcode: debit ? 1 : 2, year_id: yearId });
  };
  const slab = async (slabId: number, amount: number, lastTotal: number, il?: { taxId: number; perc: number }) => {
    await writer.insert(`${t}ledger_ext`, "ledext_key", {
      ...(il ? { il_id: ilKey } : {}), slab_id: slabId, slab_amt: amount, ...(il ? { tax_id: il.taxId } : {}), slab_perc: il ? il.perc : 0, s_lastot: lastTotal, form_recd: "N", led_id: ledgerKey, year_id: yearId,
    });
  };

  await slab(217, gross, gross);
  const slabLog: string[] = [
    obj(pair("!*Slab_key", 217), pair("Slab Sr.", 1), pair("+ / -", "Add :"), pair("Particulars", "PRODUCT AMOUNT"), pair("Short / %", ""), pair("Amount", gross)),
    obj(pair("!*Slab_key", 214), pair("Slab Sr.", 2), pair("+ / -", "Less:"), pair("Particulars", "CASH DISCOUNT"), pair("Short / %", ""), pair("Amount", "0.00")),
  ];

  if (interState) {
    const net = money(gross + taxAmt);
    await slab(215, taxAmt, net, { taxId: tax3.rec, perc: tax3.perc });
    await slab(215, taxAmt, net);
    slabLog.push(obj(pair("!*Slab_key", 215), pair("Slab Sr.", 3), pair("+ / -", "Add :"), pair("Particulars", "* IGST Code"), pair("Short / %", ""), pair("Amount", taxAmt)));
    if (tax3.accode > 0) { await post(tax3.accode, taxAmt, !reverse); await balance(tax3.accode, taxAmt, !reverse); }
  } else {
    const netHalf = money(gross + half);
    await slab(215, half, netHalf, { taxId: tax3.rec, perc: tax3.perc });
    await slab(215, half, netHalf);
    slabLog.push(obj(pair("!*Slab_key", 215), pair("Slab Sr.", 3), pair("+ / -", "Add :"), pair("Particulars", "* CGST Code"), pair("Short / %", ""), pair("Amount", half)));
    if (tax3.accode > 0) { await post(tax3.accode, half, !reverse); await balance(tax3.accode, half, !reverse); }
    const netFull = money(gross + taxAmt);
    await slab(224, half, netFull, { taxId: tax4!.rec, perc: tax4!.perc });
    await slab(224, half, netFull);
    slabLog.push(obj(pair("!*Slab_key", 224), pair("Slab Sr.", 4), pair("+ / -", "Add :"), pair("Particulars", "* UTGST"), pair("Short / %", ""), pair("Amount", half)));
    if (tax4!.accode > 0) { await post(tax4!.accode, half, !reverse); await balance(tax4!.accode, half, !reverse); }
  }
  const net = money(gross + taxAmt);

  // Outstanding of the bill and the postings of the party and the expense.
  const outstanding = reverse ? gross : final;
  await writer.insert(`${t}outclear`, "out_key", {
    out_ledid: ledgerKey, out_fulldocno: `ExpTrp/${formatDesktopDate(session.tarikh1).slice(7, 11)}-${formatDesktopDate(session.tarikh2).slice(9, 11)}/${docNo}`, out_date: entryDate,
    out_entryamt: outstanding, out_setoff: 0, out_ly_setoff: 0, out_on_acamt: 0, out_dbcode: 2, out_entrybook: 15, code: partyCode, ref_no: "", set_off: 1, clear_pos: "P", year_id: yearId,
  });
  await post(partyCode, outstanding, false);
  await balance(partyCode, outstanding, false);
  await post(input.expNameCode, gross, true);
  await balance(input.expNameCode, gross, true);
  if (reverse) {
    const control = (await client.query(`SELECT code FROM ${t}account WHERE book = 1 AND a_pos = 'A' AND a_short = 'GST_CTRL' LIMIT 1`)).rows[0];
    if (control) { await post(toInt(control.code), taxAmt, true); await balance(toInt(control.code), taxAmt, true); }
  }

  slabLog.push(obj(pair("!*Slab_key", 216), pair("Slab Sr.", 5), pair("+ / -", "User:"), pair("Particulars", "ANY ADD / LESS"), pair("Short / %", ""), pair("Amount", "")));
  const rounding = money(final - net);
  if (final !== net) await slab(213, rounding, final);
  slabLog.push(obj(pair("!*Slab_key", 213), pair("Slab Sr.", 6), pair("+ / -", "User:"), pair("Particulars", "ROUNDING"), pair("Short / %", ""), pair("Amount", rounding)));

  const writeLog = async (fields: { top: string; items: string; slab: string; outstand: string; addon: string; ledId: number; code: number; book: number; bookCode: number }) => {
    await writer.insert(`${schema}_biglog.log_entry`, "lentry_key", {
      lentry_top_bottom: fields.top, lentry_items: fields.items, lentry_slab: fields.slab, lentry_outstand: fields.outstand, lentry_addon: fields.addon, lentry_einvoice: "", lentry_fields: "",
      lentry_mode: "A", lentry_user: session.userNo, lentry_ledid: fields.ledId, lentry_processid: null, lentry_code: fields.code, lentry_book: fields.book, lentry_bookcode: fields.bookCode,
      lentry_savedate: logDate(savedOn), lentry_savetime: clock12(savedOn), lentry_machine_name: "WEB",
    });
  };
  await writeLog({ top: logEntry, items: logItemsText, slab: `[${slabLog.join(",")}]`, outstand: "", addon: logAddon, ledId: ledgerKey, code: partyCode, book: 15, bookCode: 23 });

  // TDS: a journal that sets the TDS off against this bill.
  if (tds > 0) {
    const nature = (await client.query(
      `SELECT code, name FROM ${t}account WHERE a_pos = 'A' AND a_lastdate IS NULL AND a_short IN (SELECT section_no FROM smart_setup.tds_chart WHERE tds_key IN (SELECT DISTINCT nature_pay FROM ${t}account ac LEFT JOIN ${t}int_master intmst ON intmst.code = ac.code WHERE ac.code = $1 AND intmst.tds_req = 'Y')) LIMIT 1`, [partyCode])).rows[0];
    if (!nature) {
      warnings.push("TDS was not posted: the transport's account has no TDS section with TDS required.");
    } else {
      const natureCode = toInt(nature.code);
      const natureName = toText(nature.name);
      const jvTop = (await client.query(`SELECT MAX(NULLIF(regexp_replace(doc_no, '\\D', '', 'g'), '')::numeric) AS top FROM ${t}ledger WHERE book = 19 AND doc_series = 'JV' AND doc_pos <> 'D' AND doc_posting = 'P'`)).rows[0]?.top;
      const jvNo = jvTop === null || jvTop === undefined ? 1 : Number(jvTop) + 1;
      const outRow = (await client.query(`SELECT out_key, out_fulldocno FROM ${t}outclear WHERE out_ledid = $1 ORDER BY out_key LIMIT 1`, [ledgerKey])).rows[0];
      const outKey = outRow ? toInt(outRow.out_key) : 0;
      const billText = outRow ? toText(outRow.out_fulldocno) : "";
      const jvLedger = (code: number, side: number, narrationText: string) => writer.insert(`${t}ledger`, "led_key", {
        code, doc_date: entryDate, doc_no: String(jvNo).padStart(10, " "), doc_series: "JV", full_docno: `JV/${jvNo}`, doc_no1: "          ", amount: tds, book: 19, book_code: 27,
        ac_dbcode: side, narration: narrationText, setoff_amt: 0, ly_clearamt: 0, chln_date: null, ag_book: 0, ag_bkcode: null, TYPE: 0, int_type: 0, entry_type: "", post_amt: tds,
        doc_posting: "P", doc_mode: 0, doc_lock: "", doc_pos: "A", prod_amt: 0, doc_remark: "", entry_sty: "", unique_key: null, stkmdl: "", year_id: yearId,
        last_savedate: isoDate(savedOn), last_savetime: clock12(savedOn), entry_no: "          ", post_date: entryDate, imp_ledkey: ledgerKey,
      });
      const jvKey = await jvLedger(partyCode, 1, `Setoff for Bill : ${billText}`);
      await writer.insert(`${t}addon_aentry`, "aona_key", { aona_accode: partyCode, aona_ledid: jvKey, aona_recid: "L", key_subled: 515, txt_subled: " None", key_exp_nature: input.expNatureKey, txt_exp_nature: expNature });
      await balance(partyCode, tds, true);
      await writer.insert(`${t}ledger_post`, "post_key", { led_id: jvKey, post_code: partyCode, post_date: entryDate, post_bookcd: 27, post_amt: tds, post_dbcode: 1, post_book: 19, year_id: yearId });
      await client.query(`UPDATE ${t}ledger SET unique_key = $1 WHERE led_key = $1`, [jvKey]);
      await writer.insert(`${t}outclear`, "out_key", {
        out_ledid: jvKey, out_fulldocno: `JV/${jvNo}`, out_date: entryDate, out_entryamt: tds, out_setoff: tds, out_ly_setoff: 0, out_on_acamt: 0, out_dbcode: 1, out_ag_outid: outKey,
        out_entrybook: 19, code: partyCode, ref_no: "", set_off: 1, clear_pos: "P", year_id: yearId,
      });
      await client.query(`UPDATE ${t}outclear SET out_setoff = (out_setoff::numeric + $1::numeric)::money, clear_pos = 'C' WHERE out_key = $2`, [tds, outKey]);

      const outstandLog = "[" + obj(
        pair("!*Out_key", outKey), pair("Sr.", 1), pair("Doc Number", fullDocNo), pair("Date", logDate(new Date(`${entryDate}T00:00:00`))),
        pair("Amount", outstanding), pair("Pending", outstanding), pair("Setoff Amt", tds), pair("Inputrow", 2),
      ) + "]";

      const jvKey1 = await jvLedger(natureCode, 2, "");
      await writer.insert(`${t}addon_aentry`, "aona_key", { aona_accode: natureCode, aona_ledid: jvKey1, aona_recid: "L", key_subled: 515, txt_subled: " None", key_exp_nature: input.expNatureKey, txt_exp_nature: expNature });
      await balance(natureCode, tds, false);
      await writer.insert(`${t}ledger_post`, "post_key", { led_id: jvKey1, post_code: natureCode, post_date: entryDate, post_bookcd: 27, post_amt: tds, post_dbcode: 2, post_book: 19, year_id: yearId });
      await client.query(`UPDATE ${t}ledger SET unique_key = $1 WHERE led_key = $2`, [jvKey, jvKey1]);
      await writer.insert(`${t}outclear`, "out_key", {
        out_ledid: jvKey1, out_fulldocno: `JV/${jvNo}`, out_date: entryDate, out_entryamt: tds, out_setoff: 0, out_ly_setoff: 0, out_on_acamt: 0, out_dbcode: 2, out_ag_outid: null,
        out_entrybook: 19, code: natureCode, ref_no: "", set_off: 0, clear_pos: "P", year_id: yearId,
      });

      const jvTop2 = "[" + obj(
        pair("!*Led_key", jvKey), pair("DAYBOOK", "JOURNAL BOOK"), pair("user", session.loginName), pair("savedate", logDate(savedOn)), pair("savetime", clock12(savedOn)),
        pair("machine_name", "WEB"), pair("* Series", "JV"), pair("* Ent. Dt.", logDate(new Date(`${entryDate}T00:00:00`))), pair("* Ent. No.", jvNo),
        pair("Narration", `Setoff for Bill : ${billText}`), pair("Side", ""), pair("Total Debit Amount", tds), pair("Total Credit Amount", tds),
      ) + "]";
      const jvItems = "[" + obj(pair("!*Led_key", jvKey), pair("Row Sr.", 1), pair("* Account Head", transport), pair("Debit", tds), pair("Credit", ""), pair("* Sub Ledger", " None")) + ","
        + obj(pair("!*Led_key", jvKey1), pair("Row Sr.", 2), pair("* Account Head", natureName), pair("Debit", ""), pair("Credit", tds), pair("* Sub Ledger", " None")) + "]";
      const jvAddon = `[${obj(pair("!*Addon_Label", "* Expense Nature"), pair("* Expense Nature", expNature))}]`;
      await writeLog({ top: jvTop2, items: jvItems, slab: "", outstand: outstandLog, addon: jvAddon, ledId: jvKey, code: partyCode, book: 19, bookCode: 27 });
    }
  }

  // Documents go to the company's image database.
  const files = input.documents.filter((file) => file.base64 !== "");
  if (files.length > 0) {
    const exists = (await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'document_upload'", [`${schema}_image`])).rowCount;
    if (!exists) warnings.push("Documents were not saved: the company has no image database.");
    else {
      for (const file of files) {
        const bytes = Buffer.from(file.base64, "base64");
        await client.query(
          `INSERT INTO ${schema}_image.document_upload (entry_id, document_path, entry_mode, document_remark, document_image) VALUES ($1, $2, 'L', $3, $4)`,
          [ledgerKey, file.name, file.remark === "" ? null : file.remark, bytes]);
      }
    }
  }

  return { fullDocNo, ledgerKey, finalAmount: final, warnings };
}
