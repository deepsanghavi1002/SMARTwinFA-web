import { defaultRishabhTemplate, docFromRishabhDocument, RISHABH_FIELDS } from "../print/rishabhTemplate.ts";
import { starterTemplate } from "../print/starter.ts";
import type { FieldGroup } from "../print/billFields.ts";
import type { Doc, Template } from "../print/template.ts";
import type { BillDocument } from "./billDocument.ts";

/**
 * The print formats the Print Format Designer (UTILITY menu) can open. A format is a default template, the fields its texts can be filled from, and a
 * sample document to design on; a company's own template is kept under the format's id (smart_system.print_template).
 * To add a format: write its default template and field list (as lib/print/rishabhTemplate.ts does), and add one line below.
 */
export type PrintFormat = Readonly<{
  id: string; name: string; defaultTemplate: () => Template; fields: readonly FieldGroup[]; sample: Doc;
  /** The document a saved entry's bill makes for this format's templates (and the templates companies make from it). */
  docFrom: (document: BillDocument) => Doc;
  /** A blank page with the usual fields, for a company's new format. */
  starter: () => Template;
}>;

/** A made-up bill in the shape SP_BILL_PRINT gives (the layout of the Rishabh printout INV9649), to design on. */
function sampleBillDocument(): BillDocument {
  const line = (serial: number, description: string, packs: number, qty: number, rate: number): Record<string, string> => {
    const value = (qty * rate).toFixed(2);
    return {
      SERIAL_NO: String(serial), PROD_SHORT: description, PROD_DESCRIP: description, HSN_CODE: "39241010", QUANTITY: String(qty), RATE_MODE: "PCS", RATE: String(rate), P_VALUE: value, NETTAMT: value,
      CURRENCY_5: String(packs), CGST_RATE: "18.00", CGST_AMT: (qty * rate * 0.18).toFixed(2), CGST_DESC: "IGST 18%", SGST_RATE: "0.00", SGST_AMT: "0.00",
      SLAB_PERC1: "0.00", SLAB_PERC2: "0.00", SLAB_PERC3: "0.00", SLAB_PERC4: "0.00", SLAB_PERC5: "0.00",
    };
  };
  const body = [
    line(1, "Export Satin Vintage Set 4 VTCL", 70, 420, 595), line(2, "Export Shell Wooden Set 3 VTCL", 45, 270, 751), line(3, "Export Super Falcon Set 3 VTCL", 96, 576, 720),
    line(4, "Export Shelter Mettalic Set 3 VTCL", 50, 300, 698), line(5, "Export Sefora Set 20 VTCL", 310, 620, 1166), line(6, "Export So Hot 2000 Vtcl", 23, 138, 563), line(7, "Export Sefora Wooden Set 4 VTCL", 59, 354, 778),
  ];
  const top: Record<string, string> = {
    CO_NAME: "Rishabh Plast India Private Limited", CO_GSTNO: "26AANCR2149D1ZE", CO_PANNO: "AANCR2149D",
    PARTY_NAME: "Mahavir Impex - Other", PARTY_ADD1: "668, Madhavrai", PARTY_ADD2: "Galli, Mulji", PARTY_ADD3: "Jetha Market.", PARTY_CITY: "Mumbai", PARTY_PINCODE: "400002", PARTY_MOBILE: "9833899691", PARTY_GSTNO: "27AAGFM5797A1Z4", STATE_NAME: "Maharashtra", STATE_CODE: "27",
    ADDON_NAME: "T G Terminal Ltd CFS", ADDON_ADD1: "Forbes & Co Ltd CFS", ADDON_ADD2: "Veshvi Navi Chirner Road", ADDON_ADD3: "Vaia Gavanfata Water Tank JNPT", ADDON_CITY: "Mumbai", ADDON_PINCODE: "400702", ADDON_MOBILE: "8169509937", ADDON_CSTNO: "Maharashtra", ADDON_FAX: "27",
    INVOICE_NO: "9649", INVOICE_SERIES: "DSAL/26-27", INVOICE_FULLDOCNO: "DSAL/26-27/9649", INVOICE_DATE: "04-Nov-2026", EWAY_BILLNO: "632216053871",
    EINV_ACKNO: "162626576667413", EINV_ACKDATE: "2026-11-04 15:48:00", EINV_IRNNO: "59d12255f27a4359b72f0d9d2fd8734cf8a3805abc97b0f1963c09e83ac3a643",
    A_HEAD1: "TRANSPORT", A_VALUE1: "Shri Durga Roadlines", A_HEAD2: "VEHICLE", A_VALUE2: "MH04FP5089", A_HEAD3: "LRNO", A_VALUE3: "1293/653", A_HEAD4: "LRDATE", A_VALUE4: "04-11-26",
  };
  const bottom: Record<string, string> = {
    DOC_AMOUNT: "2540323.00", BOTTOM_MESSAGE: "", SLAB_OPER1: "****", SLAB_HEAD1: "Product Amount", SLAB_AMT1: "2152816.00", SLAB_OPER7: "Add :", SLAB_HEAD7: "IGST AMOUNT", SLAB_PERC7: "18.00", SLAB_AMT7: "387506.88",
    SLAB_OPER9: "Add :", SLAB_HEAD9: "TCS @ 2%", SLAB_OPER10: "Add :", SLAB_HEAD10: "ANY ADD / LESS", SLAB_OPER11: "Add :", SLAB_HEAD11: "ROUNDING", SLAB_AMT11: "0.12", B_EXTRA15: "IGST 18%    2152816.00    387506.88",
  };
  return { top, body, bottom };
}

export const PRINT_FORMATS: readonly PrintFormat[] = [
  { id: "rishabh_invoice", name: "Rishabh Tax Invoice", defaultTemplate: defaultRishabhTemplate, fields: RISHABH_FIELDS, sample: docFromRishabhDocument(sampleBillDocument()), docFrom: docFromRishabhDocument, starter: starterTemplate },
];
