import type { BillDocument } from "../entry/billDocument";
import { amountInWords } from "../entry/billHtml.ts";
import { qrDataUri } from "./qr.ts";
import type { Doc, Row } from "./template";

/**
 * The fields of a printed bill, by the names the desktop's Crystal reports read (the columns of DOCUMENT_TOP, DOCUMENT_BODY and DOCUMENT_BOTTOM that
 * SP_BILL_PRINT fills), the lists a template's repeaters can run over, and the document a template is filled from.
 */

/** A group of fields in the designer's list; `list` names the list of rows the fields belong to (they are placed inside a repeater over it). */
export type FieldGroup = Readonly<{ label: string; list?: string; fields: readonly Readonly<{ key: string; label: string }>[] }>;

const names = (keys: string): { key: string; label: string }[] => keys.split(/[\s,]+/).filter(Boolean).map((key) => ({ key, label: key }));
const numbered = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, at) => `${prefix}${from + at}`).join(" ");

export const BILL_FIELD_GROUPS: readonly FieldGroup[] = [
  { label: "Company", fields: names("CO_NAME CO_GSTNO CO_PANNO CO_TEL CO_MOBILE CO_EMAIL CO_ADDRESS1 CO_ADDRESS2 CO_ADDRESS3 CO_CITY CO_PINCODE T_EXTRA6") },
  { label: "Party (Billed to)", fields: names("PARTY_NAME PARTY_SHORT PARTY_ADD1 PARTY_ADD2 PARTY_ADD3 PARTY_CITY PARTY_PINCODE PARTY_TEL PARTY_FAX PARTY_EMAILID PARTY_MOBILE PARTY_STD PARTY_LSTNO PARTY_CSTNO PARTY_PANNO PARTY_LBTNO PARTY_GSTNO PARTY_DLICNO PARTY_DLICNO1 GST_NO STATE_NAME STATE_CODE") },
  { label: "Delivery address (Shipped to)", fields: names("ADDON_NAME ADDON_ADD1 ADDON_ADD2 ADDON_ADD3 ADDON_CITY ADDON_PINCODE ADDON_TEL ADDON_MOBILE ADDON_LSTNO ADDON_CSTNO ADDON_FAX") },
  { label: "Shipped to / Billed to, joined", fields: names("SHIPTO_NAME SHIPTO_ADDRESS SHIPTO_TEL SHIPTO_GSTIN SHIPTO_STATE SHIPTO_CODE BILLTO_ADDRESS") },
  { label: "Invoice", fields: names("DOC_TYPE INVOICE_NO INVOICE_SERIES INVOICE_FULLDOCNO INVOICE_DATE CHALLAN_NO CHALLAN_DATE YEAR_STRING T_EXTRA1 T_EXTRA2 T_EXTRA3 T_EXTRA4 T_EXTRA5 T_EXTRA8 DOC_AMOUNT CREDIT_DAYS DUE_DATE BOTTOM_MESSAGE AMOUNT_WORDS TYPE_DESC B_EXTRA1 B_EXTRA2 B_EXTRA3 B_EXTRA4 B_EXTRA5 page pages") },
  { label: "E-way bill", fields: names("EWAY_BILLNO EWAY_BILLDATE EWAY_VALID SUPPLY_TYPE SUB_SUPPLY_TYPE EWAY_DOC_TYPE TRP_MODE DISTANCE_KM EWAY_VEH_TYPE") },
  { label: "E-invoice", fields: names("EINV_ACKNO EINV_ACKDATE EINV_IRNNO EINV_STR_QRCODE EINV_QR") },
  { label: "Addons of the entry and party (heading, value)", fields: names(Array.from({ length: 30 }, (_, at) => `A_HEAD${at + 1} A_VALUE${at + 1}`).join(" ")) },
  { label: "Bottom: slab lines (a number each)", fields: names(Array.from({ length: 15 }, (_, at) => `SLAB_OPER${at + 1} SLAB_HEAD${at + 1} SLAB_PERC${at + 1} SLAB_AMT${at + 1}`).join(" ")) },
  { label: "Bottom: extra lines (tax-wise, HSN)", fields: names(numbered("B_EXTRA", 6, 20)) },
  { label: "Item rows (list: lines)", list: "lines", fields: names("SERIAL_NO PROD_SHORT PROD_DESCRIP HSN_CODE QUANTITY FACTOR FREE RATE_MODE UOM_ENTRY RATE MASTER_RATE P_VALUE NETTAMT ENT_NAT PROD_POST TRN_QTY1 TRN_QTY2 TRN_QTY3 TRN_PCS TRN_PACK TRN_WEIGHT CURRENCY_5 CURRENCY_4 PROD_GROUP ICODE_TYPE IL_ID PROD_ID TEXT_10 BAR_CODE SLAB_PERC1 SLAB_AMT1 SLAB_PERC2 SLAB_AMT2 SLAB_PERC3 SLAB_AMT3 SLAB_PERC4 SLAB_AMT4 SLAB_PERC5 SLAB_AMT5 CGST_RATE CGST_AMT CGST_DESC SGST_RATE SGST_AMT SGST_DESC " + numbered("P_LEVEL", 1, 9) + " " + numbered("P_DESC", 1, 9) + " " + Array.from({ length: 9 }, (_, at) => `PA_HEAD${at + 1} PA_VALUE${at + 1}`).join(" ")) },
  { label: "Slab lines (list: slabs)", list: "slabs", fields: names("SLAB_NO SLAB_OPER SLAB_HEAD SLAB_PERC SLAB_AMT") },
  { label: "Tax-wise lines (list: taxes)", list: "taxes", fields: names("TAX_DESC TAX_NET TAX_AMT") },
  { label: "HSN summary (list: hsn)", list: "hsn", fields: names("HSN_CODE HSN_QTY HSN_TAXABLE HSN_CGST_RATE HSN_CGST_AMT HSN_SGST_RATE HSN_SGST_AMT HSN_TAX") },
];

const num = (value: string | undefined) => { const x = Number(String(value ?? "").replace(/[^0-9.+-]/g, "")); return Number.isFinite(x) ? x : 0; };
const fixed = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** The document a bill template is filled from: the top and bottom columns as single values, the body as the "lines" list, and the lists worked out from them. */
export function docFromBillDocument(document: BillDocument): Doc {
  const { top, body, bottom } = document;
  const values: Record<string, string> = { ...top, ...bottom };
  const join = (...parts: string[]) => parts.map((part) => part.trim()).filter(Boolean).join(" ");
  const delivery = (top.ADDON_ADD1 ?? "") !== "" || (top.ADDON_NAME ?? "") !== "";
  values.SHIPTO_NAME = delivery ? top.ADDON_NAME ?? "" : top.PARTY_NAME ?? "";
  values.SHIPTO_ADDRESS = delivery ? join(top.ADDON_ADD1 ?? "", top.ADDON_ADD2 ?? "", top.ADDON_ADD3 ?? "", top.ADDON_CITY ?? "", top.ADDON_PINCODE ?? "") : join(top.PARTY_ADD1 ?? "", top.PARTY_ADD2 ?? "", top.PARTY_ADD3 ?? "", top.PARTY_CITY ?? "", top.PARTY_PINCODE ?? "");
  values.SHIPTO_TEL = delivery ? top.ADDON_MOBILE || top.ADDON_TEL || "" : top.PARTY_MOBILE || top.PARTY_TEL || "";
  values.SHIPTO_GSTIN = delivery ? top.ADDON_LSTNO ?? "" : top.PARTY_GSTNO ?? "";
  values.SHIPTO_STATE = delivery ? top.ADDON_CSTNO ?? "" : top.STATE_NAME ?? "";
  values.SHIPTO_CODE = delivery ? top.ADDON_FAX ?? "" : top.STATE_CODE ?? "";
  values.BILLTO_ADDRESS = join(top.PARTY_ADD1 ?? "", top.PARTY_ADD2 ?? "", top.PARTY_ADD3 ?? "", top.PARTY_CITY ?? "", top.PARTY_PINCODE ?? "");
  values.EINV_QR = qrDataUri(top.EINV_STR_QRCODE ?? "");
  values.AMOUNT_WORDS = `${amountInWords(num(bottom.DOC_AMOUNT))}.`;
  // The addons of the entry by name (AD_TRANSPORT, AD_VEHICLE ...): their position in A_HEAD / A_VALUE depends on the company's addon set.
  for (let at = 1; at <= 40; at += 1) {
    const head = top[`A_HEAD${at}`];
    if (head === undefined) break;
    const name = head.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (name !== "" && values[`AD_${name}`] === undefined) values[`AD_${name}`] = top[`A_VALUE${at}`] ?? "";
  }

  const slabs: Row[] = [];
  for (let at = 1; at <= 15; at += 1) {
    const head = bottom[`SLAB_HEAD${at}`] ?? "";
    const amount = bottom[`SLAB_AMT${at}`] ?? "0.00";
    if (head !== "" || num(amount) !== 0) slabs.push({ SLAB_NO: String(at), SLAB_OPER: bottom[`SLAB_OPER${at}`] ?? "", SLAB_HEAD: head, SLAB_PERC: bottom[`SLAB_PERC${at}`] ?? "0.00", SLAB_AMT: amount });
  }
  const taxes: Row[] = [];
  for (let at = 15; at <= 20; at += 1) {
    const line = bottom[`B_EXTRA${at}`];
    if (!line) continue;
    const parts = line.split("    ");
    taxes.push({ TAX_DESC: parts[0] ?? "", TAX_NET: parts[1] ?? "", TAX_AMT: parts[2] ?? "" });
  }
  const hsn = new Map<string, { qty: number; taxable: number; cgstRate: string; cgst: number; sgstRate: string; sgst: number }>();
  for (const row of body) {
    const code = row.HSN_CODE ?? "";
    if (code === "" || num(row.QUANTITY) <= 0) continue;
    const entry = hsn.get(code) ?? { qty: 0, taxable: 0, cgstRate: row.CGST_RATE ?? "0.00", cgst: 0, sgstRate: row.SGST_RATE ?? "0.00", sgst: 0 };
    entry.qty += num(row.QUANTITY); entry.taxable += num(row.NETTAMT); entry.cgst += num(row.CGST_AMT); entry.sgst += num(row.SGST_AMT);
    hsn.set(code, entry);
  }
  const hsnRows: Row[] = [...hsn.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, e]) => ({ HSN_CODE: code, HSN_QTY: String(Math.round(e.qty * 10000) / 10000), HSN_TAXABLE: fixed(e.taxable), HSN_CGST_RATE: e.cgstRate, HSN_CGST_AMT: fixed(e.cgst), HSN_SGST_RATE: e.sgstRate, HSN_SGST_AMT: fixed(e.sgst), HSN_TAX: fixed(e.cgst + e.sgst) }));
  // The lines as printed: the rate and the discounts to two places.
  const lines: Row[] = body.map((row) => ({ ...row, RATE: fixed(num(row.RATE)), QUANTITY: String(Math.round(num(row.QUANTITY) * 10000) / 10000) }));
  return { values, lists: { lines, slabs, taxes, hsn: hsnRows } };
}
