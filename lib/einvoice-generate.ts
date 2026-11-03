import { createCipheriv, createDecipheriv } from "node:crypto";
import type { Client } from "pg";
import { toText } from "./master-program/legacy";
import { Loader } from "./master-program/load";
import { SYSTEM_SCHEMA } from "./master-program/session";
import type { MasterSession } from "./master-program/session";
import { planToken } from "./einvoice-token";

/**
 * Transaction > Auto Entry > Eway Bill Generate (report 147), Ctrl+I on the output grid (Report_Combine, the E Invoice upload): for each sale voucher of the grid
 * the e-invoice JSON (INV, schema 1.1) is built from the voucher, sealed with the session key and posted to the Alankit gateway; the acknowledgement no and date,
 * the IRN, the E-way bill no and the signed QR code it answers with are kept on the voucher. A voucher the gateway refuses stops the run, as on the desktop.
 */

const GATEWAY = "https://www.alankitgst.com/eInvoiceGateway/eicore/v1.03/Invoice";

type Login = Readonly<{ userName: string; password: string; subscriptionKey: string; gstin: string; token: string; sek: string; aesKey: string }>;
type Party = Readonly<{ name: string; address1: string; address2: string; city: string; pincode: string; gstNo: string; stateCode: string }>;

export type EinvoiceReply = Readonly<{ ok: boolean; done: number; message: string }>;

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const round = (value: number, places: number) => { const f = 10 ** places; return Math.sign(value) * Math.round((Math.abs(value) + 1e-9) * f) / f; };
/** The desktop writes a pin code as the number, 0 when blank. */
const pin = (value: string) => (value === "" ? 0 : Number(value) || 0);
const clean = (value: string) => value.replace(/\r?\n/g, "");
const field = Loader.field;

function aesKeyOf(login: Login): Buffer {
  const key = Buffer.from(login.aesKey.split(",").filter((part) => part.trim() !== "").map((part) => Number(part)));
  if (key.length !== 32) throw new Error("The stored e-invoice session key is not valid. Generate the e-invoice token again.");
  return key;
}
const aesDecrypt = (cipherText: string, key: Buffer) => { const decipher = createDecipheriv("aes-256-ecb", key, null); return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64")), decipher.final()]); };
const aesEncrypt = (plain: Buffer, key: Buffer) => { const cipher = createCipheriv("aes-256-ecb", key, null); return Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64"); };

/** The company's e-invoice login and token; a token that has run out must be renewed first (Utility > Get E Invoice Token). */
export async function einvoiceLogin(client: Client, session: MasterSession): Promise<Login> {
  const row = (await client.query(`SELECT einv_userid, einv_password, einv_domain, einv_systemid, einv_token, einv_sek, einv_aeskey FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $1`, [session.companyKey])).rows[0];
  const login: Login = { userName: text(row?.einv_userid), password: text(row?.einv_password), subscriptionKey: text(row?.einv_domain), gstin: text(row?.einv_systemid),
    token: text(row?.einv_token), sek: text(row?.einv_sek), aesKey: text(row?.einv_aeskey) };
  if (login.userName === "" || login.subscriptionKey === "") throw new Error("This company has no e-invoice login, so an e-invoice cannot be generated.");
  if (login.token === "" || login.sek === "" || login.aesKey === "") throw new Error("There is no e-invoice token for this company yet. Generate the e-invoice token first.");
  if ((await planToken(client, session)).kind !== "fresh") throw new Error("The e-invoice token has run out. Run Utility > Get E Invoice Token first.");
  return login;
}

/** The e-invoice JSON of one voucher (null when the voucher has no party, items or is not found). */
async function buildInvoice(loader: Loader, session: MasterSession, seller: Party, ledKey: number, code: number, distanceKm: string): Promise<{ json: string; docNo: string } | string> {
  const party = (await loader.readTable("SELECT a.name, b.address_1, b.address_2, b.city, b.pin_code, b.gst_no, c.opt_short FROM |sys.db|account a, |sys.db|address b, |sys.db|idopt_master c WHERE a.code = b.code AND b.state_id = c.idopt_key AND b.address_id = 1 AND a.code = $1", [code]))?.[0];
  if (!party) return "The party of the voucher is not found";
  const fullName = text(field(party, "name"));
  const buyer: Party = { name: fullName.includes("[") ? fullName.slice(0, fullName.indexOf("[") - 1) : fullName, address1: text(field(party, "address_1")), address2: text(field(party, "address_2")), city: text(field(party, "city")),
    pincode: text(field(party, "pin_code")), gstNo: text(field(party, "gst_no")), stateCode: text(field(party, "opt_short")) };

  const led = (await loader.readTable("SELECT led.led_key, led.amount, led.full_docno, to_char(led.doc_date, 'DD/MM/YYYY') AS doc_date, aent.txt_trans, asub.gst_no AS trans_gst, led.ent_address_id FROM |sys.db|ledger led LEFT JOIN |sys.db|addon_aentry aent ON aent.aona_ledid = led.led_key LEFT JOIN |sys.db|addon_sub asub ON asub.sub_code = aent.key_trans AND asub.sub_pos <> 'D' WHERE led.led_key = $1", [ledKey]))?.[0];
  if (!led) return "The voucher is not found";
  const items = await loader.readTable("SELECT a.prod_desc, a.hsn_code, b.factor, b.il_key, b.rate, b.il_value, ltrim(rtrim(c.uom_short)) AS ue_short, a.tax_perc, a.supply_type FROM |sys.db|product_master a, |sys.db|prod_ledger b, |sys.db|prod_uom c WHERE a.prod_pos <> 'D' AND a.prod_key = b.prod_id AND b.uomentry_id = c.uom_key AND b.il_pos <> 'D' AND b.led_id = $1 ORDER BY b.il_key", [ledKey]);
  if (!items) return "The voucher has no items";
  const totals = (await loader.readTable("SELECT a.slab_amt, b.slab_link FROM |sys.db|ledger_ext a, |sys.db|slab_master b WHERE a.slab_id = b.slab_key AND b.slab_master = 'Y' AND a.il_id IS NULL AND a.led_id = $1", [ledKey])) ?? [];
  const taxes = (await loader.readTable("SELECT a.il_id, a.slab_amt, b.slab_link, d.opt_desc FROM |sys.db|ledger_ext a, |sys.db|slab_master b, |sys.db|tax_master c, |sys.db|idopt_master d WHERE a.slab_id = b.slab_key AND b.slab_master = 'Y' AND a.tax_id = c.tax_rec AND a.il_id IS NOT NULL AND d.idopt_key = c.tax_place AND a.led_id = $1 ORDER BY b.slab_order", [ledKey])) ?? [];
  const others = (await loader.readTable("SELECT a.slab_amt, b.slab_desc FROM |sys.db|ledger_ext a, |sys.db|slab_master b WHERE a.slab_id = b.slab_key AND b.slab_active = 'Y' AND b.slab_pos <> 'P' AND b.slab_master <> 'Y' AND a.il_id IS NULL AND a.led_id = $1 ORDER BY b.slab_order", [ledKey])) ?? [];
  const discounts = (await loader.readTable("SELECT a.il_id, a.slab_amt FROM |sys.db|ledger_ext a, |sys.db|slab_master b WHERE a.slab_id = b.slab_key AND b.slab_master <> 'Y' AND b.slab_pos = 'P' AND a.il_id IS NOT NULL AND a.led_id = $1", [ledKey])) ?? [];

  let otherCharges = 0;
  let roundOff = 0;
  for (const row of others) {
    const description = text(field(row, "slab_desc")).toUpperCase();
    if (description.includes("DISCOUNT")) continue;
    if (description.includes("ROUND")) roundOff += num(field(row, "slab_amt"));
    else otherCharges += num(field(row, "slab_amt"));
  }

  // A delivery address other than the first is the ship-to.
  const addressId = text(field(led, "ent_address_id"));
  let ship: (Party & { contact: string }) | null = null;
  if (addressId !== "" && addressId !== "1") {
    const row = (await loader.readTable("SELECT b.contact, b.address_1, b.address_2, b.city, b.pin_code, b.gst_no, c.opt_short FROM |sys.db|account a, |sys.db|address b, |sys.db|idopt_master c WHERE a.code = b.code AND b.state_id = c.idopt_key AND b.address_id = $1 AND a.code = $2", [Number(addressId), code]))?.[0];
    if (row && text(field(row, "contact")) !== "") ship = { contact: text(field(row, "contact")), name: "", address1: text(field(row, "address_1")), address2: text(field(row, "address_2")), city: text(field(row, "city")), pincode: text(field(row, "pin_code")), gstNo: text(field(row, "gst_no")), stateCode: text(field(row, "opt_short")) };
  }

  const sameState = seller.stateCode === buyer.stateCode;
  const sez = taxes.length > 0 && text(field(taxes[0], "opt_desc")).toUpperCase().includes("SEZ");
  const supplyType = buyer.stateCode === "96" ? "EXPWOP" : sez ? "SEZWP" : "B2B";
  const companyName = session.companyName.trim();

  const itemList: Record<string, unknown>[] = [];
  let assessable = 0;
  items.forEach((item, index) => {
    const ilKey = num(field(item, "il_key"));
    const discount = discounts.filter((row) => num(field(row, "il_id")) === ilKey).reduce((sum, row) => sum + num(field(row, "slab_amt")), 0);
    const factor = num(field(item, "factor"));
    const value = num(field(item, "il_value"));
    let unitPrice: number; let total: number;
    if (discount > 0 && factor !== 0) { const rate = (value - discount) / factor; unitPrice = round(rate, 2); total = round(rate * factor, 2); }
    else { unitPrice = round(num(field(item, "rate")), 3); total = round(value, 2); }
    let igst = 0; let cgst = 0; let sgst = 0;
    for (const tax of taxes.filter((row) => num(field(row, "il_id")) === ilKey)) {
      const amount = round(num(field(tax, "slab_amt")), 2);
      if (!sameState) igst += amount;
      else if (text(field(tax, "slab_link")) === "0") cgst += amount;
      else sgst += amount;
    }
    assessable += total;
    const hsn = text(field(item, "hsn_code"));
    itemList.push({ SlNo: String(index + 1), PrdDesc: clean(text(field(item, "prod_desc"))), IsServc: text(field(item, "supply_type")) === "G" ? "N" : "Y", HsnCd: clean(hsn), Qty: round(factor, 3), FreeQty: 0,
      Unit: text(field(item, "ue_short")), UnitPrice: unitPrice, TotAmt: total, Discount: 0, AssAmt: total, GstRt: round(num(field(item, "tax_perc")), 1),
      IgstAmt: round(igst, 2), CgstAmt: round(cgst, 2), SgstAmt: round(sgst, 2), TotItemVal: round(total + igst + cgst + sgst, 2) });
  });

  let cgstVal = 0; let sgstVal = 0; let igstVal = 0;
  for (const row of totals) {
    const amount = round(num(field(row, "slab_amt")), 2);
    if (!sameState) igstVal += amount;
    else if (text(field(row, "slab_link")) === "0") cgstVal += amount;
    else sgstVal += amount;
  }
  const amount = num(field(led, "amount"));
  const address = (name: string, a: Party) => ({ Gstin: a.gstNo, LglNm: name, TrdNm: name, Addr1: clean(a.address1), ...(a.address2 !== "" ? { Addr2: clean(a.address2) } : {}), Loc: a.city, Pin: pin(a.pincode), Stcd: a.stateCode });

  const invoice: Record<string, unknown> = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: supplyType, RegRev: "N", EcmGstin: null, IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: text(field(led, "full_docno")), Dt: text(field(led, "doc_date")) },
    SellerDtls: address(companyName, seller),
    BuyerDtls: { ...address(buyer.name, buyer), Pos: buyer.stateCode },
  };
  if (ship) {
    invoice.DispDtls = { Nm: companyName, Addr1: clean(seller.address1), ...(seller.address2 !== "" ? { Addr2: clean(seller.address2) } : {}), Loc: seller.city, Pin: pin(seller.pincode), Stcd: seller.stateCode };
    invoice.ShipDtls = { ...(ship.gstNo !== "" ? { Gstin: ship.gstNo } : {}), LglNm: clean(ship.contact), Addr1: clean(ship.address1), Loc: ship.city, Pin: pin(ship.pincode), Stcd: ship.stateCode };
  }
  invoice.ItemList = itemList;
  invoice.ValDtls = { AssVal: round(assessable, 2), CgstVal: round(cgstVal, 2), SgstVal: round(sgstVal, 2), IgstVal: round(igstVal, 2), Discount: 0, OthChrg: round(otherCharges, 2), RndOffAmt: round(roundOff, 2),
    TotInvVal: round(amount, 2), TotInvValFc: round(amount - roundOff, 2) };
  const transport = text(field(led, "txt_trans"));
  if (transport !== "" && transport.toUpperCase() !== "NONE") invoice.EwbDtls = { TransId: clean(text(field(led, "trans_gst"))), TransName: clean(transport), Distance: num(distanceKm) };
  return { json: JSON.stringify(invoice), docNo: text(field(led, "full_docno")) };
}

/** A string between two markers of the answer (the desktop reads the decrypted text this way); the decrypted answer is JSON, so it is read as such. */
function answerField(answer: Record<string, unknown>, name: string): string {
  const value = answer[name];
  return value === null || value === undefined ? "" : String(value);
}

export type PreparedInvoice = Readonly<{ ledKey: number; json: string }>;

/** The JSON of each voucher, read in one go (the gateway is called after the database work is closed). */
export async function prepareInvoices(loader: Loader, vouchers: readonly { ledKey: number; code: number; distanceKm: string }[]): Promise<PreparedInvoice[] | string> {
  const { session } = loader;
  const company = (await loader.client.query(`SELECT o_address1, o_address2, o_city, o_pincode, gst_no, state_code FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $1`, [session.companyKey])).rows[0] ?? {};
  const seller: Party = { name: session.companyName, address1: text(company.o_address1), address2: text(company.o_address2), city: text(company.o_city), pincode: text(company.o_pincode), gstNo: text(company.gst_no), stateCode: text(company.state_code) };
  const prepared: PreparedInvoice[] = [];
  for (const voucher of vouchers) {
    const built = await buildInvoice(loader, session, seller, voucher.ledKey, voucher.code, voucher.distanceKm);
    if (typeof built === "string") return `EINVOICE Error....${built}`;
    prepared.push({ ledKey: voucher.ledKey, json: built.json });
  }
  return prepared;
}

/** Posts the vouchers one by one; each answer is kept on its voucher before the next goes, and the first refusal stops the run. */
export async function sendInvoices(login: Login, prepared: readonly PreparedInvoice[], keep: (ledKey: number, ack: { ackNo: string; ackDate: string; irn: string; ewayNo: string; qrCode: string }) => Promise<void>): Promise<EinvoiceReply> {
  const sek = aesDecrypt(login.sek, aesKeyOf(login));
  let done = 0;
  for (const invoice of prepared) {
    const data = aesEncrypt(Buffer.from(Buffer.from(invoice.json, "utf8").toString("base64"), "utf8"), sek);
    let result: string;
    try {
      const response = await fetch(GATEWAY, {
        method: "POST",
        headers: { Accept: "*/*", "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${login.userName}:${login.password}`).toString("base64")}`,
          Gstin: login.gstin, user_name: login.userName, AuthToken: login.token, "Ocp-Apim-Subscription-Key": login.subscriptionKey },
        body: JSON.stringify({ Data: data }),
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      });
      result = await response.text();
    } catch (error) {
      return { ok: false, done, message: `EINVOICE Error....${error instanceof Error ? error.message : String(error)}` };
    }
    let body: { Status?: unknown; Data?: unknown } | null = null;
    try { body = JSON.parse(result); } catch { /* shown as it came */ }
    if (!body || Number(body.Status) !== 1 || typeof body.Data !== "string") return { ok: false, done, message: `EINVOICE Error....${result}` };
    let answer: Record<string, unknown>;
    try { answer = JSON.parse(aesDecrypt(body.Data, sek).toString("utf8")) as Record<string, unknown>; } catch { return { ok: false, done, message: `EINVOICE Error....${result}` }; }
    await keep(invoice.ledKey, { ackNo: answerField(answer, "AckNo"), ackDate: answerField(answer, "AckDt"), irn: answerField(answer, "Irn"), ewayNo: answerField(answer, "EwbNo"), qrCode: answerField(answer, "SignedQRCode") });
    done += 1;
  }
  return { ok: true, done, message: "E Invoice Create Successfully...." };
}

/** Keeps the acknowledgement on the voucher and its signed QR code (LEDGER, ENTRY_QRCODE). */
export async function keepAcknowledgement(client: Client, session: MasterSession, ledKey: number, ack: { ackNo: string; ackDate: string; irn: string; ewayNo: string; qrCode: string }): Promise<void> {
  const s = session.companySchema;
  await client.query(`UPDATE ${s}.ledger SET einv_ackno = $1, einv_ackdate = $2, einv_irnno = $3, eway_billno = $4 WHERE led_key = $5`, [ack.ackNo, ack.ackDate, ack.irn, ack.ewayNo, ledKey]);
  await client.query(`DELETE FROM ${s}.entry_qrcode WHERE entry_id = $1 AND entry_mode = 'L'`, [ledKey]);
  await client.query(`INSERT INTO ${s}.entry_qrcode (entry_id, entry_mode, einv_str_qrcode) VALUES ($1, 'L', $2)`, [ledKey, ack.qrCode]);
}

/** The vouchers that may still be sent: sale vouchers (book 8) that are not deleted and have no acknowledgement yet. */
export async function pendingVouchers(loader: Loader, ledKeys: readonly number[]): Promise<Set<number>> {
  const rows = (await loader.readTable("SELECT led_key FROM |sys.db|ledger WHERE led_key = ANY($1::int[]) AND doc_pos <> 'D' AND book = 8 AND coalesce(einv_ackno, '') = ''", [ledKeys])) ?? [];
  return new Set(rows.map((row) => Number(toText(field(row, "led_key")))));
}
