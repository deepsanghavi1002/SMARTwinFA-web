/**
 * The data of a printed bill as the desktop's SP_BILL_PRINT makes it: three sets of columns with the same names the Crystal reports read -
 * DOCUMENT_TOP (the party, the entry's header, e-way bill, e-invoice, addons), DOCUMENT_BODY (a row for each product line) and DOCUMENT_BOTTOM (the amount, the
 * slab / tax lines, the tax-wise summary lines). The procedure fills three work tables for the user; here it is read straight from the saved entry and returned
 * in memory, so nothing is written and two people can print at once.
 *
 * Ported: the Tax Invoice / Bill path (a ledger entry of the sales books) with the licence 21 specifics (the party's closing balance up to the entry, the entry's
 * saving time and user, the delivery address of the entry, the order / quotation / indent numbers of a delivery challan). Not ported yet: the other licences'
 * branches, the Formula / Godown Transfer / voucher (cash, bank, cheque, discount, journal) documents, Debit / Credit Note nature, the cartage / labour / transport
 * items taken into the slab lines, and the HSN-wise tally of licence 82. The procedure's quirks are kept where a report may rely on them (see the slab lines).
 */

import type { Loader } from "../master-program/load";

type Row = Record<string, unknown>;
export type BillDocument = Readonly<{ top: Record<string, string>; body: Record<string, string>[]; bottom: Record<string, string> }>;
export type BillDocumentOptions = Readonly<{ ledKey: number; docType?: string; copyNo?: number; totalCopies?: number; entNat?: string }>;

const GST_START = new Date(2017, 5, 30);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const get = (row: Row | undefined, name: string): unknown => {
  if (!row) return undefined;
  if (name in row) return row[name];
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : row[key];
};
const text = (row: Row | undefined, name: string): string => { const value = get(row, name); return value === null || value === undefined ? "" : value instanceof Date ? dateText(value) : String(value).trim(); };
const dateText = (value: unknown): string => {
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? `${String(date.getDate()).padStart(2, "0")}-${MONTHS[date.getMonth()]}-${date.getFullYear()}` : "";
};
const dateOf = (row: Row | undefined, name: string) => dateText(get(row, name));
const n = (value: unknown): number => { if (value === null || value === undefined || value === "") return 0; if (typeof value === "number") return value; const parsed = Number(String(value).replace(/[^0-9.+-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; };
const money = (value: unknown) => (Math.round(n(value) * 100) / 100).toFixed(2);
const q4 = (value: unknown) => { const x = Math.round(n(value) * 10000) / 10000; return String(x); };
const SAFE = /^[A-Za-z0-9_]{1,60}$/;

export async function billDocument(loader: Loader, options: BillDocumentOptions): Promise<BillDocument> {
  const { session } = loader;
  const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await loader.readTable(sql, params)) ?? [];
  const licence = session.licence;
  const docType = options.docType ?? "TAX INVOICE";
  const led = (await rows(`SELECT led.*, ac.name AS ac_name, ac.a_short AS ac_short, ac.credit_days AS ac_credit_days FROM |sys.db|ledger led LEFT JOIN |sys.db|account ac ON ac.code = led.code WHERE led.led_key = $1 AND led.doc_pos <> 'D'`, [options.ledKey]))[0];
  if (!led) throw new Error("The entry is not found (deleted, or not posted)");
  const partyCode = n(get(led, "code"));
  const book = n(get(led, "book"));
  const setup = (await rows(`SELECT prn_para, einvoice_req FROM |sys.db|setup LIMIT 1`))[0];
  const prnPara = text(setup, "prn_para");
  const allSlab = prnPara.includes("ALLSLAB,");
  const prnSlab = prnPara.includes("PRNSLAB,");
  const netAmt = prnPara.includes("NET_AMT,");
  const einvoiceReq = text(setup, "einvoice_req").includes("Y");
  const company = (await rows(`SELECT co_short, girno, state_code, gst_req, name, bill_name, gst_no, panno1, o_tel, o_mobile, o_emailid, o_address1, o_address2, o_address3, o_city, o_pincode FROM smart_system.company WHERE co_key = $1`, [session.companyKey]))[0];
  const companyState = text(company, "state_code");
  const gstReq = text(company, "gst_req") === "Y";
  const afterGst = (get(led, "doc_date") as Date) > GST_START;
  const date1 = session.tarikh1;
  const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  // The book the slab / addon definitions are read for: a debit / credit note or a challan reads the book of the entry it was made against.
  const addonBook = book === 16 || book === 11 ? n(get(led, "ag_book")) : book === 21 ? 8 : book === 20 ? 13 : book === 10 ? 15 : book;
  const slabBook = addonBook;

  // ---- the party's address, state, and the entry's e-way bill / e-invoice
  const party = (await rows(`SELECT a.*, o.opt_desc AS state_name, o.opt_short AS state_code FROM |sys.db|address a LEFT JOIN |sys.db|idopt_master o ON o.idopt_key = a.state_id WHERE a.code = $1 AND a.address_id = 1`, [partyCode]))[0];
  const partyState = text(party, "state_code");
  const qr = (await rows(`SELECT einv_str_qrcode FROM |sys.db|entry_qrcode WHERE entry_id = $1 AND entry_mode = 'L' LIMIT 1`, [options.ledKey]))[0];
  const yearString = `${date1.getFullYear()}${session.tarikh2.getFullYear()}`;

  // ---- licence 21: the party's closing balance up to this entry, the entry's time and user
  let closing = "";
  if (partyCode > 0 && [21, 24, 34, 42].includes(licence)) {
    const sql = licence === 34
      ? `SELECT coalesce(acbal.opening::numeric,0) + coalesce(sum(CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE -led.amount::numeric END),0) AS closing FROM |sys.db|account ac LEFT JOIN |sys.db|ac_balance acbal ON acbal.code = ac.code LEFT JOIN |sys.db|ledger led ON led.code = ac.code AND led.doc_posting = 'P' AND led.doc_pos <> 'D' AND led.doc_date <= $2 AND led.led_key <= $3 WHERE acbal.a_recflag = 'AC' AND ac.code = $1 GROUP BY acbal.opening`
      : `SELECT coalesce(acbal.opening::numeric,0) + coalesce(sum(CASE WHEN led.ac_dbcode = 1 THEN led.amount::numeric ELSE -led.amount::numeric END),0) AS closing FROM |sys.db|account ac LEFT JOIN |sys.db|ac_balance acbal ON acbal.code = ac.code LEFT JOIN |sys.db|ledger led ON led.code = ac.code AND led.doc_posting = 'P' AND led.doc_pos <> 'D' AND led.doc_date <= $2 AND led.led_key < $3 AND btrim(led.doc_no) < $4 WHERE acbal.a_recflag = 'AC' AND ac.code = $1 GROUP BY acbal.opening`;
    const found = (await rows(sql, licence === 34 ? [partyCode, get(led, "doc_date"), options.ledKey] : [partyCode, get(led, "doc_date"), options.ledKey, text(led, "doc_no")]))[0];
    if (found) { const value = n(get(found, "closing")); closing = `${value} ${value >= 0 ? "Dr." : "Cr."}`; }
  }
  let entryUser = "";
  const savedAt = text(led, "last_savetime");
  if ([14, 21, 29, 51].includes(licence)) {
    const user = (await rows(`SELECT user_name FROM smart_system.user_master WHERE user_no = $1`, [n(get(led, "user_id"))]))[0];
    entryUser = text(user, "user_name");
  }

  // ---- DOCUMENT_TOP
  const top: Record<string, string> = {
    CO_KEY: String(session.companyKey), USER_NO: String(session.userNo), DOC_TYPE: docType,
    PARTY_NAME: text(led, "ac_name"), PARTY_SHORT: text(led, "ac_short"),
    PARTY_ADD1: text(party, "address_1"), PARTY_ADD2: text(party, "address_2"), PARTY_ADD3: text(party, "address_3"), PARTY_CITY: text(party, "city"), PARTY_PINCODE: text(party, "pin_code"),
    PARTY_TEL: text(party, "tel_no"), PARTY_FAX: text(party, "telex"), PARTY_EMAILID: text(party, "e_mail"), PARTY_MOBILE: text(party, "mobile_no"), PARTY_STD: text(party, "std_code"),
    PARTY_LSTNO: text(party, "lst_no"), PARTY_CSTNO: text(party, "cst_no"), PARTY_PANNO: text(party, "pan_no"), PARTY_LBTNO: text(party, "lbt_no"), PARTY_GSTNO: text(party, "gst_no"),
    PARTY_DLICNO: text(party, "dlic_no"), PARTY_DLICNO1: text(party, "dlic_no1"), YEAR_STRING: yearString,
    INVOICE_NO: text(led, "doc_no"), INVOICE_SERIES: text(led, "doc_series"), INVOICE_FULLDOCNO: text(led, "full_docno"), INVOICE_DATE: dateOf(led, "doc_date"),
    CHALLAN_NO: text(led, "doc_no1"), CHALLAN_DATE: dateOf(led, "chln_date"),
    CO_NAME: text(company, "bill_name") || text(company, "name") || session.companyName, CO_GSTNO: text(company, "gst_no"), CO_PANNO: text(company, "panno1"), CO_TEL: text(company, "o_tel"), CO_MOBILE: text(company, "o_mobile"), CO_EMAIL: text(company, "o_emailid"),
    CO_ADDRESS1: text(company, "o_address1"), CO_ADDRESS2: text(company, "o_address2"), CO_ADDRESS3: text(company, "o_address3"), CO_CITY: text(company, "o_city"), CO_PINCODE: text(company, "o_pincode"),
    T_EXTRA1: closing !== "" && !(closing.includes("-") && licence !== 34) ? closing : "0", T_EXTRA2: "0", T_EXTRA3: "0", T_EXTRA4: "0", T_EXTRA5: "0", T_EXTRA6: text(company, "co_short") || "0",
  };
  if (afterGst) {
    const supply = ["Supply", "Import", "Export", "Job Work", "For Own Use", "Job work Returns", "Sales Return", "Others", "SKD/CKD", "Line Sales", "Recipient Not Known"];
    const docTypes = ["Tax Invoice", "Bill of Supply", "Bill of Entry", "Delivery Challan", "Credit Note"];
    Object.assign(top, {
      GST_NO: text(party, "gst_no"), STATE_NAME: text(party, "state_name"), STATE_CODE: partyState,
      EWAY_BILLNO: text(led, "eway_billno"), EWAY_BILLDATE: dateOf(led, "eway_billdate"), EWAY_VALID: text(led, "eway_valid"),
      SUPPLY_TYPE: n(get(led, "supply_type")) === 0 ? "Inward" : "Outward", SUB_SUPPLY_TYPE: supply[n(get(led, "sub_supply_type"))] ?? "Exhibition or Fairs",
      EWAY_DOC_TYPE: docTypes[n(get(led, "eway_doc_type"))] ?? "Others", TRP_MODE: ["Road", "Rail", "Air"][n(get(led, "trp_mode"))] ?? "Ship",
      DISTANCE_KM: money(get(led, "distance_km")), EWAY_VEH_TYPE: n(get(led, "eway_veh_type")) === 0 ? "Reguler" : "Over Dimensional",
      EINV_ACKNO: text(led, "einv_ackno"), EINV_ACKDATE: text(led, "einv_ackdate"), EINV_IRNNO: text(led, "einv_irnno"),
      ...(einvoiceReq ? { EINV_QRCODE: "", EINV_STR_QRCODE: text(qr, "einv_str_qrcode") } : {}),
    });
  }
  if (licence === 21 || licence === 38) top.T_EXTRA8 = savedAt;
  if (licence === 21) { top.T_EXTRA8 = savedAt; top.T_EXTRA_USER = entryUser; }

  /** The addons: a definition list (column and head of each field), read from the table the field belongs to, in the order the procedure numbers them. */
  const addonFields = async (relate: string, entryPos: string, bookFilter: boolean) => {
    const sql = `SELECT fiel_key, fiel_save, fiel_short, fiel_type FROM |sys.db|addon_fld WHERE fiel_pos <> 'D' AND fiel_relate = $1 AND fiel_entrypos = $2${bookFilter ? " AND coalesce(fiel_inbook,'') LIKE $3" : ""} ORDER BY fiel_key`;
    return (await rows(sql, bookFilter ? [relate, entryPos, `% ${addonBook},%`] : [relate, entryPos])).filter((field) => SAFE.test(text(field, "fiel_save")));
  };
  const column = (field: Row) => `${text(field, "fiel_type") === "I" ? "input_" : "txt_"}${text(field, "fiel_save")}`;
  const readAddon = async (table: string, where: string, params: unknown[], fields: Row[]): Promise<Row[]> => (fields.length === 0 ? [] : rows(`SELECT ${fields.map((field) => `coalesce(${column(field)}::text,'') AS "${column(field)}"`).join(", ")}${table === "addon_ientry" ? ", aoni_il_id AS il_id" : ""} FROM |sys.db|${table} WHERE ${where}`, params));

  // The header addons of the entry's book, then the party's addons (entry position N, in the books 2 and 3): A_HEAD1 / A_VALUE1 ...
  if (partyCode > 0) {
    let serial = 0;
    const entryFields = await addonFields("A", "L", true);
    const entryFieldsP = await addonFields("A", "P", true);
    const entryRow = (await readAddon("addon_aentry", `aona_ledid = $1`, [options.ledKey], [...entryFields, ...entryFieldsP]))[0];
    for (const field of [...entryFields, ...entryFieldsP]) { serial += 1; top[`A_HEAD${serial}`] = text(field, "fiel_short"); top[`A_VALUE${serial}`] = text(entryRow, column(field)); }
    const partyFields = (await rows(`SELECT fiel_key, fiel_save, fiel_short, fiel_type FROM |sys.db|addon_fld WHERE fiel_pos <> 'D' AND fiel_relate = 'A' AND fiel_entrypos = 'N' AND (coalesce(fiel_inbook,'') LIKE '% 2,%' OR coalesce(fiel_inbook,'') LIKE '% 3,%') ORDER BY fiel_key`)).filter((field) => SAFE.test(text(field, "fiel_save")));
    const partyRow = (await readAddon("addon_data", `code = $1`, [partyCode], partyFields))[0];
    for (const field of partyFields) { serial += 1; top[`A_HEAD${serial}`] = text(field, "fiel_short"); top[`A_VALUE${serial}`] = text(partyRow, column(field)); }
    // The delivery address the entry carries (licence 21: the party's own address of that number).
    const deliveryKey = n(get(led, "ent_address_id"));
    if (licence === 21 && deliveryKey > 1) {
      const to = (await rows(`SELECT a.*, o.opt_desc, o.opt_short FROM |sys.db|address a LEFT JOIN |sys.db|idopt_master o ON o.idopt_key = a.state_id WHERE a.address_id = $1 AND a.code = $2`, [deliveryKey, partyCode]))[0];
      Object.assign(top, { ADDON_ADD1: text(to, "address_1"), ADDON_ADD2: text(to, "address_2"), ADDON_ADD3: text(to, "address_3"), ADDON_CITY: text(to, "city"), ADDON_PINCODE: text(to, "pin_code"), ADDON_TEL: text(to, "tel_no"), ADDON_MOBILE: text(to, "mobile_no"), ADDON_NAME: text(to, "contact"), ADDON_LSTNO: text(to, "gst_no"), ADDON_CSTNO: text(to, "opt_desc"), ADDON_FAX: text(to, "opt_short") });
    }
  }
  // Licence 21 delivery challan: the order numbers it was made against.
  if ((licence === 21 || licence === 38) && book === 13) {
    const orders = (await rows(`SELECT DISTINCT p.full_docno FROM |sys.db|prod_link l JOIN |sys.db|process p ON p.process_key = l.led_rec1 WHERE p.il_pos = 'A' AND l.led_rec2 = $1`, [options.ledKey])).map((row) => text(row, "full_docno"));
    if (orders.length > 0) top.T_EXTRA2 = orders.join(",");
  }

  // ---- DOCUMENT_BODY: a row for each product line
  const lines = await rows(
    `SELECT prodled.*, prodmas.prod_short, prodmas.bill_desc, prodmas.post_short, prodmas.level_1, prodmas.level_2, prodmas.level_3, prodmas.level_4, prodmas.level_5, prodmas.level_6, prodmas.level_7, prodmas.level_8, prodmas.level_9 AS plevel9,
        prodmas.desc_1, prodmas.desc_2, prodmas.desc_3, prodmas.desc_4, prodmas.desc_5, prodmas.desc_6, prodmas.desc_7, prodmas.desc_8, prodmas.desc_9, prodmas.prod_group, prodmas.ivltype, prodmas.supply_type AS psupply, prodmas.bar_code, prodmas.hsn_code,
        pruom.uom_short AS rate_uom, uom1.uom_short AS entry_uom
       FROM |sys.db|prod_ledger prodled LEFT JOIN |sys.db|product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN |sys.db|prod_uom pruom ON pruom.uom_key = prodled.rateuom_id LEFT JOIN |sys.db|prod_uom uom1 ON uom1.uom_key = prodled.uomentry_id
      WHERE prodled.il_pos <> 'D' AND prodled.led_id = $1 ORDER BY prodled.il_serial`, [options.ledKey]);
  // The slabs of the book (the ones printed against a line: position P) and what each line carries (LEDGER_EXT rows with an IL_ID).
  const slabsP = await rows(`SELECT slab_key, slab_master, slab_short, slab_order FROM |sys.db|slab_master WHERE slab_active = 'Y' AND slab_pos = 'P' AND book = $1 AND slab_fromdt::date = $2::date AND slab_uptodt::date = $3::date ORDER BY slab_order`, [slabBook, isoDay(date1), isoDay(session.tarikh2)]);
  const itemTax = (await rows(`SELECT count(*) AS c FROM |sys.db|slab_master WHERE slab_pos = 'P' AND slab_fromdt::date = $1::date AND slab_master = 'Y' AND slab_active = 'Y' AND book = $2`, [isoDay(date1), slabBook]))[0];
  const bitItemTax = n(get(itemTax, "c")) > 0;
  const lineSlabs = await rows(`SELECT ext.il_id, ext.slab_id, ext.slab_perc::numeric AS perc, ext.slab_amt::numeric AS amt, ext.s_lastot::numeric AS lastot, tm.tax_desc FROM |sys.db|ledger_ext ext LEFT JOIN |sys.db|tax_master tm ON tm.tax_rec = ext.tax_id WHERE ext.led_id = $1 AND coalesce(ext.il_id,0) > 0`, [options.ledKey]);
  const lineAddonFields = await addonFields("P", "P", true);
  const prodAddonFields = (await rows(`SELECT fiel_key, fiel_save, fiel_short, fiel_type FROM |sys.db|addon_fld WHERE fiel_pos <> 'D' AND fiel_relate = 'P' AND fiel_entrypos = 'N' ORDER BY fiel_key`)).filter((field) => SAFE.test(text(field, "fiel_save")));
  const lineAddons = new Map((await readAddon("addon_ientry", `aoni_ledid = $1`, [options.ledKey], lineAddonFields)).map((row) => [n(get(row, "il_id")), row] as const));
  const prodIds = [...new Set(lines.map((line) => n(get(line, "prod_id"))))];
  const prodAddons = new Map((prodAddonFields.length === 0 || prodIds.length === 0 ? [] : await rows(`SELECT prod_id, ${prodAddonFields.map((field) => `coalesce(${column(field)}::text,'') AS "${column(field)}"`).join(", ")} FROM |sys.db|addon_data WHERE prod_id = ANY($1::int[])`, [prodIds])).map((row) => [n(get(row, "prod_id")), row] as const));
  const slabNumber = new Map<number, number>(); // slab key -> the number of its column (the procedure numbers every slab of the list)
  slabsP.forEach((slab, at) => slabNumber.set(n(get(slab, "slab_key")), at + 1));
  const body: Record<string, string>[] = lines.map((line, at) => {
    const ilKey = n(get(line, "il_key"));
    const bill = text(line, "bill_desc");
    const row: Record<string, string> = {
      CO_KEY: top.CO_KEY, USER_NO: top.USER_NO, DOC_TYPE: docType, SERIAL_NO: String(n(get(line, "il_serial")) || at + 1), PROD_SHORT: text(line, "prod_short"),
      PROD_DESCRIP: licence === 21 ? (bill.includes("[") ? bill.slice(0, bill.indexOf("[")).trim() : bill) : bill,
      QUANTITY: q4(get(line, "quantity")), FACTOR: q4(get(line, "factor")), FREE: "0", RATE_MODE: text(line, "rate_uom"), RATE: q4(get(line, "rate")), MASTER_RATE: q4(get(line, "master_rate")), P_VALUE: money(get(line, "il_value")),
      ENT_NAT: text(line, "stock_nat"), PROD_POST: text(line, "post_short"), TRN_QTY1: q4(get(line, "trn_qty1")), TRN_QTY2: q4(get(line, "trn_qty2")), TRN_QTY3: q4(get(line, "trn_qty3")),
      TRN_PCS: q4(get(line, "trn_pcs")), TRN_PACK: q4(get(line, "trn_pack")), TRN_WEIGHT: q4(get(line, "trn_weight")),
      P_LEVEL1: text(line, "level_1"), P_LEVEL2: text(line, "level_2"), P_LEVEL3: text(line, "level_3"), P_LEVEL4: text(line, "level_4"), P_LEVEL5: text(line, "level_5"), P_LEVEL6: text(line, "level_6"), P_LEVEL7: text(line, "level_7"), P_LEVEL8: text(line, "level_8"),
      P_LEVEL9: get(line, "il_prodcd") !== null && get(line, "il_prodcd") !== undefined ? text(line, "il_prodcd") : text(line, "plevel9"),
      P_DESC1: text(line, "desc_1"), P_DESC2: text(line, "desc_2"), P_DESC3: text(line, "desc_3"), P_DESC4: text(line, "desc_4"), P_DESC5: text(line, "desc_5"), P_DESC6: text(line, "desc_6"), P_DESC7: text(line, "desc_7"), P_DESC8: text(line, "desc_8"), P_DESC9: text(line, "desc_9"),
      PROD_GROUP: text(line, "prod_group"), ICODE_TYPE: text(line, "ivltype"), IL_ID: String(ilKey), PROD_ID: text(line, "prod_id"), TEXT_10: text(line, "psupply"), BAR_CODE: text(line, "bar_code"),
      CURRENCY_5: q4(get(line, "bundle")), CURRENCY_4: q4(get(line, "pack_qty")), UOM_ENTRY: text(line, "entry_uom"),
      ...(afterGst ? { HSN_CODE: text(line, "hsn_code") } : {}),
      SLAB_PERC1: "0.00", SLAB_AMT1: "0.00", SLAB_PERC2: "0.00", SLAB_AMT2: "0.00", SLAB_PERC3: "0.00", SLAB_AMT3: "0.00", SLAB_PERC4: "0.00", SLAB_AMT4: "0.00", SLAB_PERC5: "0.00", SLAB_AMT5: "0.00",
      CGST_RATE: "0.00", CGST_AMT: "0.00", SGST_RATE: "0.00", SGST_AMT: "0.00", NETTAMT: "0.00", SGST_DESC: "", CGST_DESC: "",
    };
    // The line's slabs: a tax (the slab list's master rows) goes to CGST_* (CGST, IGST, GST) or SGST_* (SGST, UTGST); the others to the numbered SLAB_PERCn / SLAB_AMTn.
    let nonTax = 0;
    for (const entry of lineSlabs.filter((item) => n(get(item, "il_id")) === ilKey)) {
      const slab = slabsP.find((candidate) => n(get(candidate, "slab_key")) === n(get(entry, "slab_id")));
      if (!slab) continue;
      if (text(slab, "slab_master") === "Y") {
        const short = text(slab, "slab_short").toUpperCase();
        if (short === "SGST" || short === "UTGST") Object.assign(row, { SGST_RATE: money(get(entry, "perc")), SGST_AMT: money(get(entry, "amt")), SGST_DESC: text(entry, "tax_desc") });
        else Object.assign(row, { CGST_RATE: money(get(entry, "perc")), CGST_AMT: money(get(entry, "amt")), CGST_DESC: text(entry, "tax_desc") });
      } else {
        const number = slabNumber.get(n(get(slab, "slab_key"))) ?? 0;
        if (number >= 1 && number <= 5) { row[`SLAB_PERC${number}`] = money(get(entry, "perc")); row[`SLAB_AMT${number}`] = money(get(entry, "amt")); }
        nonTax += n(get(entry, "amt"));
      }
    }
    row.NETTAMT = money(n(get(line, "il_value")) - nonTax);
    // PA_HEAD / PA_VALUE: the entry's line addons, then the product's own.
    let serial = 0;
    for (const field of lineAddonFields) { serial += 1; row[`PA_HEAD${serial}`] = text(field, "fiel_short"); row[`PA_VALUE${serial}`] = text(lineAddons.get(ilKey), column(field)); }
    for (const field of prodAddonFields) { serial += 1; row[`PA_HEAD${serial}`] = text(field, "fiel_short"); row[`PA_VALUE${serial}`] = text(prodAddons.get(n(get(line, "prod_id"))), column(field)); }
    for (let at2 = serial + 1; at2 <= 9; at2 += 1) { row[`PA_HEAD${at2}`] = ""; row[`PA_VALUE${at2}`] = ""; }
    return row;
  });

  // ---- DOCUMENT_BOTTOM
  const copies = options.totalCopies ?? 1;
  const copyNo = options.copyNo ?? 1;
  const copyName = copies === 1 ? "ORIGINAL"
    : copies === 2 ? (copyNo === 1 ? "ORIGINAL" : "DUPLICATE")
      : copies === 3 ? (licence === 28 || licence === 37 ? ["ORIGINAL", "DUPLICATE", "TRIPLICATE"][copyNo - 1] : ["ORIGINAL FOR RECEIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER"][copyNo - 1])
        : ["ORIGINAL", "DUPLICATE", "TRIPLICATE", "EXTRA COPY"][copyNo - 1];
  const creditDays = n(get(led, "credit_days")) || n(get(led, "ac_credit_days"));
  const due = (() => { const base = get(led, "doc_date") as Date; const days = n(get(led, "ac_credit_days")); if (!(base instanceof Date)) return ""; const d = new Date(base); d.setDate(d.getDate() + days); return dateText(d); })();
  const bottom: Record<string, string> = {
    CO_KEY: top.CO_KEY, USER_NO: top.USER_NO, DOC_TYPE: docType, DOC_AMOUNT: money(get(led, "amount")), CREDIT_DAYS: String(creditDays), BOTTOM_MESSAGE: text(led, "narration"),
    B_EXTRA1: session.loginName, B_EXTRA2: copyName ?? "", B_EXTRA3: options.entNat ?? "A", B_EXTRA4: text(led, "rev_charge") === "N" ? "No" : "Yes", B_EXTRA5: text(led, "full_docno"), DUE_DATE: due,
  };
  if (n(get(led, "ag_book")) > 0) bottom.TYPE_DESC = "";
  for (let at = 1; at <= 15; at += 1) { bottom[`SLAB_OPER${at}`] = ""; bottom[`SLAB_HEAD${at}`] = ""; bottom[`SLAB_PERC${at}`] = "0.00"; bottom[`SLAB_AMT${at}`] = "0.00"; }

  // The slab lines (SLAB_OPERn / HEADn / PERCn / AMTn). With the ALLSLAB option every active slab of the book is listed, with its amount (nil when the entry has none).
  if (book === 8 || book === 13 || book === 15) {
    const slabLines = allSlab
      ? await rows(`SELECT sm.slab_mathop, sm.slab_active, ${bitItemTax ? "sm.slab_desc" : "(CASE WHEN sm.slab_master = 'N' THEN sm.slab_desc ELSE tm.tax_desc END)"} AS descr, sm.slab_key, sm.slab_master, coalesce(ext.slab_amt::numeric,0) AS amt, coalesce(ext.slab_perc::numeric,0) AS perc, ${bitItemTax ? "'TAX AMOUNT'" : "tm.tax_desc"} AS taxdesc, tm.tax_desc AS tax_desc, sm.slab_pos, coalesce(ext.s_lastot::numeric,0) AS lastot, sm.slab_link
                      FROM |sys.db|slab_master sm LEFT JOIN |sys.db|ledger_ext ext ON sm.slab_key = ext.slab_id AND ext.led_id = $1 AND coalesce(ext.il_id,0) = 0 LEFT JOIN |sys.db|tax_master tm ON tm.tax_rec = ext.tax_id
                     WHERE sm.slab_active <> 'N' AND sm.book = $2${prnSlab ? " AND ext.slab_amt::numeric <> 0" : ""} ORDER BY sm.slab_order`, [options.ledKey, slabBook])
      : await rows(`SELECT sm.slab_mathop, sm.slab_active, ${bitItemTax ? "sm.slab_desc" : "(CASE WHEN sm.slab_master = 'N' THEN sm.slab_desc ELSE tm.tax_desc END)"} AS descr, sm.slab_key, sm.slab_master, ext.slab_amt::numeric AS amt, ext.slab_perc::numeric AS perc, ${bitItemTax ? "'TAX AMOUNT'" : "tm.tax_desc"} AS taxdesc, tm.tax_desc AS tax_desc, sm.slab_pos, ext.s_lastot::numeric AS lastot, sm.slab_link
                      FROM |sys.db|ledger_ext ext LEFT JOIN |sys.db|slab_master sm ON sm.slab_key = ext.slab_id LEFT JOIN |sys.db|tax_master tm ON tm.tax_rec = ext.tax_id
                     WHERE ext.led_id = $1 AND coalesce(ext.il_id,0) = 0 ORDER BY sm.slab_order`, [options.ledKey]);
    let count = 0;
    let taxTotal = 0;
    const put = (at: number, oper: string, head: string, perc: unknown, amount: unknown) => { if (at < 1 || at > 15) return; bottom[`SLAB_OPER${at}`] = oper; bottom[`SLAB_HEAD${at}`] = head; bottom[`SLAB_PERC${at}`] = money(perc); bottom[`SLAB_AMT${at}`] = money(amount); };
    for (const slab of slabLines) {
      const amount = n(get(slab, "amt"));
      const desc = text(slab, "descr");
      const pos = text(slab, "slab_pos");
      const master = text(slab, "slab_master");
      if (!(amount !== 0 || desc !== "" || (allSlab && (licence === 32 || licence === 40)))) continue;
      const planned = (afterGst && (pos === "D" || (pos === "P" && master === "N" && licence !== 4))) || !afterGst || licence === 3 || licence === 22 || licence === 88 || text(company, "girno") === "VISION" || prnSlab || allSlab;
      if (planned) count += 1;
      const mathop = text(slab, "slab_mathop");
      const oper = mathop === "A" && text(slab, "slab_active") === "S" ? "****" : mathop === "A" ? "Add :" : mathop === "L" ? "Less:" : amount >= 0 ? "Add :" : "Less:";
      const isTaxLine = (prnSlab && master === "Y") || (!afterGst && master === "Y") || (master === "Y" && allSlab);
      if (isTaxLine) {
        if (netAmt && n(get(slab, "slab_link")) === 0) {
          // (the procedure prints the NET AMOUNT after the first tax line, and the cartage / labour / transport items before it: not ported)
        }
        if (bitItemTax && (allSlab || prnSlab)) {
          const link = n(get(slab, "slab_link"));
          const head = link === 0 ? (companyState === partyState ? "CGST AMOUNT" : "IGST AMOUNT") : companyState === "26" ? "UTGST AMOUNT" : "SGST AMOUNT";
          put(count, oper, head, get(slab, "perc"), amount);
        } else put(count, oper, text(slab, "taxdesc"), get(slab, "perc"), amount);
        taxTotal += amount;
      } else if ((afterGst && (pos === "D" || (pos === "P" && master === "N"))) || !afterGst || licence === 3 || licence === 22 || licence === 88) {
        put(count, oper, desc, get(slab, "perc"), amount);
      }
    }
    if (taxTotal > 0) { bottom.SLAB_HEAD15 = "TAX TOTAL"; bottom.SLAB_AMT15 = money(taxTotal); }
    // The tax-wise lines (B_EXTRA15 ...): each tax used by the lines, its taxable amount and its tax.
    if (bitItemTax) {
      const taxes = await rows(`SELECT tm.tax_desc, sum(ext.s_lastot::numeric - ext.slab_amt::numeric - (CASE WHEN left(tm.tax_repohd,4) = 'SGST' OR left(tm.tax_repohd,5) = 'UTGST' THEN ext.slab_amt::numeric ELSE 0 END)) AS net_amt, sum(ext.slab_amt::numeric) AS tot_tax
                                  FROM |sys.db|ledger_ext ext LEFT JOIN |sys.db|tax_master tm ON tm.tax_rec = ext.tax_id WHERE ext.led_id = $1 AND coalesce(ext.tax_id,0) > 0 GROUP BY ext.tax_id, tm.tax_desc ORDER BY ext.tax_id`, [options.ledKey]);
      let at = 14;
      let wrapped = false;
      for (const tax of taxes) {
        if (at >= 20 && !wrapped) { wrapped = true; at = 4; }
        at += 1;
        bottom[`B_EXTRA${at}`] = `${text(tax, "tax_desc")}    ${money(get(tax, "net_amt"))}    ${money(get(tax, "tot_tax"))}`;
      }
    }
    // The HSN lines (B_EXTRA12): "HSN : code : Qty=n - ", up to six codes.
    if (gstReq && licence !== 82) {
      const byHsn = new Map<string, number>();
      for (const row of body) if (n(row.QUANTITY) > 0 && (row.HSN_CODE ?? "") !== "") byHsn.set(row.HSN_CODE, (byHsn.get(row.HSN_CODE) ?? 0) + n(row.QUANTITY));
      const listed = [...byHsn.entries()].slice(0, 6).map(([code, qty]) => `HSN : ${code} : Qty=${Math.round(qty * 10000) / 10000} - `).join("");
      if (listed !== "") bottom.B_EXTRA12 = listed;
    }
  }
  return { top, body, bottom };
}
