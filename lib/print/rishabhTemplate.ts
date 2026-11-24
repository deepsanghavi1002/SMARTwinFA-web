import type { BillDocument } from "../entry/billDocument";
import { amountInWords } from "../entry/billHtml.ts";
import { BILL_FIELD_GROUPS, docFromBillDocument } from "./billFields.ts";
import type { FieldGroup } from "./billFields.ts";
import type { Doc, El, Repeater, Row, Template, Total } from "./template";

/**
 * The Rishabh Plast "TAX INVOICE" (the client's Crystal Report, sample INV9649) as a template: where each field of the printout is, and the fields (the columns
 * SP_BILL_PRINT makes) the texts are filled from. A company that has not designed its own prints this one.
 */

/** The texts and images that belong to this format (not to the bill's data). */
export const RISHABH_TERMS = [
  "1. Interest will be recovered @24% p.a on  overdue unpaid bills.",
  "2.  No claims regarding the Quantity damages or shortages will be given unless the same notified at the time of reciveng goods.",
  "3.  Goods once sold cannot be returned and or exchanged",
  "4. We reserve to cursives the right to demand payment of this bill at any time before due date.",
  "5.  Payment are to be made at our office by A/C Payee`s cheque with 60 Days.",
] as const;
const FORMAT_VALUES: Record<string, string> = {
  FORMAT_TERMS: RISHABH_TERMS.join("\n"), BANK_NAME: "Kotak Mahindra Bank", BANK_BRANCH: "Borivali (West)", BANK_ACCOUNT: "7849275866", BANK_IFSC: "KKBK0000653",
  IMG_HEADER: "/pilot/rishabh/header.png", IMG_SIGN: "/pilot/rishabh/sign.png", IMG_FOOTLOGO: "/pilot/rishabh/footlogo.png",
};

export const RISHABH_FIELDS: readonly FieldGroup[] = [
  ...BILL_FIELD_GROUPS,
  { label: "This format: texts and images", fields: [["FORMAT_TERMS", "Terms (all lines)"], ["BANK_NAME", "Bank name"], ["BANK_BRANCH", "Bank branch"], ["BANK_ACCOUNT", "Account no"], ["BANK_IFSC", "IFSC code"], ["AMOUNT_WORDS", "Amount in words"], ["IMG_HEADER", "Header image"], ["IMG_SIGN", "Signature image"], ["IMG_FOOTLOGO", "Footer logo image"], ["TOT_PACKS", "Total packs (total)"], ["TOT_QTY", "Total quantity (total)"]].map(([key, label]) => ({ key, label })) },
  { label: "Add / less lines of this format (list: addless)", list: "addless", fields: [{ key: "ADDLESS_OPER", label: "Add / Less" }, { key: "ADDLESS_HEAD", label: "Particular" }, { key: "ADDLESS_AMT", label: "Amount" }] },
];

/** The totals this format shows. */
export const RISHABH_TOTALS: Total[] = [
  { name: "TOT_PACKS", op: "sum", field: "CURRENCY_5", list: "lines", reset: "report", decimals: 0 },
  { name: "TOT_QTY", op: "sum", field: "QUANTITY", list: "lines", reset: "report", decimals: 0 },
];

/** The document the Rishabh template is filled from: the bill's columns, this format's texts, and the add / less lines (the slabs that carry an amount, with the tax named as its tax list names it). */
export function docFromRishabhDocument(document: BillDocument): Doc {
  const base = docFromBillDocument(document);
  const taxName = base.lists.taxes?.[0]?.TAX_DESC ?? "";
  const addless: Row[] = (base.lists.slabs ?? []).filter((slab) => {
    const amount = Number(slab.SLAB_AMT) || 0;
    return slab.SLAB_OPER !== "" && slab.SLAB_OPER !== "****" && (amount !== 0 || (slab.SLAB_OPER === "Add :" && !/AMOUNT$/.test(slab.SLAB_HEAD)));
  }).map((slab) => ({
    ADDLESS_OPER: slab.SLAB_OPER, ADDLESS_HEAD: /^(IGST|CGST|SGST|UTGST) AMOUNT$/.test(slab.SLAB_HEAD) && taxName !== "" ? taxName : slab.SLAB_HEAD, ADDLESS_AMT: Number(slab.SLAB_AMT) !== 0 ? slab.SLAB_AMT : "",
  }));
  return { values: { ...base.values, ...FORMAT_VALUES, AMOUNT_WORDS: `${amountInWords(Number(document.bottom.DOC_AMOUNT) || 0).replace(/^Rupees\s+/, "INR ").replace(/Lakh/g, "Lac")}.` }, lists: { ...base.lists, addless } };
}

export function defaultRishabhTemplate(): Template {
  const elements: El[] = [];
  let count = 0;
  const id = (prefix: string) => `${prefix}${++count}`;
  const text = (x: number, y: number, content: string, o: Partial<El> = {}) => { elements.push({ id: id("t"), kind: "text", x, y, text: content, ...o }); };
  const hline = (y: number, x1 = 18, x2 = 884) => { elements.push({ id: id("h"), kind: "hline", x: x1, y, w: x2 - x1 }); };
  const vline = (x: number, y1: number, y2: number) => { elements.push({ id: id("v"), kind: "vline", x, y: y1, h: y2 - y1 }); };
  const image = (name: string, src: string, x: number, y: number, w: number, h: number) => { elements.push({ id: name, kind: "image", x, y, w, h, src }); };
  const right = (label: string, value: string, x: number, y: number, bold = false) => { text(x, y, label, { bold: true }); text(x, y + 16, value, bold ? { bold: true } : {}); };

  image("header", "{{IMG_HEADER}}", 18, 9, 864, 124);
  text(230, 143, "Invoice issued under section 31 of CGST Act  2017 read with Rule 46 of CGST Rules 2017", { size: 7.6 });
  [165, 186].forEach((y) => hline(y));
  hline(262, 18, 528); hline(325, 18, 528);
  [455, 497, 858, 878, 900, 922, 1080, 1200].forEach((y) => hline(y));
  [224, 256, 290, 330, 366, 405, 438].forEach((y) => hline(y, 528, 884));
  vline(18, 165, 1200); vline(884, 165, 1200); vline(528, 186, 455); vline(728, 186, 455); vline(540, 1080, 1200);
  [52, 310, 352, 402, 436, 530, 590, 628, 664, 700, 738, 787].forEach((x) => vline(x, 455, 878));

  text(30, 168, "GSTIN"); text(92, 168, ":"); text(106, 168, "{{CO_GSTNO}}", { bold: true }); text(536, 168, "PAN/Income Tax"); text(662, 168, ":"); text(680, 168, "{{CO_PANNO}}", { bold: true });
  const parties = [
    { title: "Shipped To", y: 192, name: "SHIPTO_NAME", address: "SHIPTO_ADDRESS", tel: "SHIPTO_TEL", gstin: "SHIPTO_GSTIN", state: "SHIPTO_STATE", code: "SHIPTO_CODE" },
    { title: "Billed To", y: 327, name: "PARTY_NAME", address: "BILLTO_ADDRESS", tel: "PARTY_MOBILE", gstin: "PARTY_GSTNO", state: "STATE_NAME", code: "STATE_CODE" },
  ];
  for (const side of parties) {
    text(30, side.y, side.title, { bold: true });
    text(30, side.y + 22, `{{${side.name}}}`, { bold: true });
    text(30, side.y + 41, `{{${side.address}}}`, { w: 330, h: 36, wrap: true });
    text(30, side.y + 71, `Tel.:  Mob : {{${side.tel}}}`);
    text(30, side.y + 91, `GSTIN : {{${side.gstin}}}`);
    text(30, side.y + 110, "State :"); text(75, side.y + 110, `{{${side.state}}}`); text(288, side.y + 110, `Code : {{${side.code}}}`);
  }
  image("qr", "{{EINV_QR}}", 416, 199, 108, 108);
  right("Invoice No.", "{{INVOICE_FULLDOCNO}}", 543, 192); right("Dated", "{{INVOICE_DATE}}", 735, 192, true);
  text(543, 227, "Buyer`s Order No.", { bold: true }); text(735, 227, "Dated", { bold: true, size: 6.3 });
  right("E Way Bill No.", "{{EWAY_BILLNO}}", 543, 266); right("Dated", "", 735, 266);
  text(543, 298, "Supplier`s Ref./order No.", { bold: true }); text(735, 298, "Dispatch document No.", { bold: true }); text(735, 318, "{{INVOICE_FULLDOCNO}}", { bold: true });
  right("Dispatch through", "{{AD_TRANSPORT}}", 543, 334); text(735, 334, "Destination", { bold: true });
  text(543, 372, "Date & Time of Preparation", { bold: true }); text(543, 391, "{{INVOICE_DATE}}", { bold: true }); text(735, 372, "Motor Vehicle No.", { bold: true }); text(735, 391, "{{AD_VEHICLE}}");
  text(543, 410, "LR No.", { bold: true }); text(543, 428, "{{AD_LRNO}}"); text(735, 410, "Dated", { bold: true }); text(735, 428, "{{AD_LRDATE}}");

  // The item table's heads.
  text(20, 459, "SR", { bold: true }); text(20, 474, "NO.", { bold: true }); text(112, 474, "Description of Goods", { bold: true });
  text(318, 459, "No.Of", { bold: true }); text(318, 474, "Pack", { bold: true }); text(368, 474, "Qty.", { bold: true }); text(414, 474, "UOM", { bold: true }); text(468, 474, "RATE", { bold: true }); text(540, 474, "Total", { bold: true });
  text(592, 459, "Disc", { bold: true }); text(592, 474, "(%)", { bold: true }); text(634, 459, "Sch", { bold: true }); text(631, 470, "Disc", { bold: true }); text(631, 482, "(%)", { bold: true });
  text(669, 459, "Spot", { bold: true }); text(667, 470, "Disc", { bold: true }); text(667, 482, "(%)", { bold: true }); text(705, 459, "Addl", { bold: true }); text(703, 470, "Disc", { bold: true }); text(703, 482, "(%)", { bold: true });
  text(752, 459, "Trade", { bold: true }); text(754, 470, "Disc", { bold: true }); text(754, 482, "(%)", { bold: true }); text(842, 474, "Amount", { bold: true });

  // The item rows (cells are placed from the top of their row).
  const cell = (x: number, y: number, content: string, o: Partial<El> = {}) => { elements.push({ id: id("c"), kind: "text", x, y, text: content, in: "items", ...o }); };
  cell(20, 0, "{{SERIAL_NO}}", { w: 30, align: "r" }); cell(56, 0, "{{PROD_DESCRIP}}", { w: 254, h: 16 }); cell(60, 19, "HSN CODE :   {{HSN_CODE}}");
  cell(312, 0, "{{CURRENCY_5}}", { w: 36, align: "r" }); cell(352, 0, "{{QUANTITY}}", { w: 40, align: "r" }); cell(402, 0, "{{RATE_MODE}}", { w: 34 }); cell(440, 0, "{{RATE}}", { w: 70, align: "r" }); cell(518, 0, "{{P_VALUE}}", { w: 62, align: "r" });
  cell(588, 0, "{{SLAB_PERC1}}", { w: 38, align: "r" }); cell(628, 0, "{{SLAB_PERC3}}", { w: 36, align: "r" }); cell(666, 0, "{{SLAB_PERC2}}", { w: 34, align: "r" }); cell(702, 0, "{{SLAB_PERC4}}", { w: 34, align: "r" }); cell(740, 0, "{{SLAB_PERC5}}", { w: 42, align: "r" }); cell(788, 0, "{{NETTAMT}}", { w: 92, align: "r" });
  // The add / less lines and the totals (the last sheet).
  const addCell = (x: number, content: string, o: Partial<El> = {}) => { elements.push({ id: id("a"), kind: "text", x, y: 0, text: content, in: "addless", ...o }); };
  addCell(66, "{{ADDLESS_OPER}}"); addCell(110, "{{ADDLESS_HEAD}}"); addCell(788, "{{ADDLESS_AMT}}", { w: 92, align: "r", bold: true });
  text(788, 748, "{{SLAB_AMT1}}", { w: 92, align: "r", bold: true, show: "last" });
  text(176, 866, "Total :", { bold: true });
  text(312, 866, "{{TOT_PACKS}}", { w: 36, align: "r", bold: true, show: "last" }); text(352, 866, "{{TOT_QTY}}", { w: 40, align: "r", bold: true, show: "last" }); text(788, 866, "{{DOC_AMOUNT}}", { w: 92, align: "r", bold: true, show: "last" });

  // The footer.
  text(30, 887, "Amount Chargeable in Words  :"); text(196, 887, "{{AMOUNT_WORDS}}", { bold: true, show: "last" });
  text(30, 908, "Declaration :"); text(111, 908, "We declare that this invoice shows the actual price of the goods described and that all  particulas are true and correct .");
  text(30, 929, "Remark :"); text(66, 929, "{{BOTTOM_MESSAGE}}"); text(541, 929, "Terms & Condition   :", { bold: true });
  text(532, 946, "{{FORMAT_TERMS}}", { w: 345, h: 130, wrap: true, size: 6.9 });
  text(30, 1086, "Bank Detail :-", { bold: true });
  text(30, 1110, "Bank Name & Branch :"); text(203, 1110, "{{BANK_NAME}}"); text(372, 1110, "{{BANK_BRANCH}}");
  text(30, 1127, "Account No & IFSC Code :"); text(203, 1127, "{{BANK_ACCOUNT}}"); text(372, 1127, "{{BANK_IFSC}}");
  text(30, 1155, "Einv INR No.", { bold: true }); text(106, 1155, "{{EINV_IRNNO}}"); text(30, 1182, "Einv Ack", { bold: true }); text(106, 1182, "{{EINV_ACKNO}}");
  text(479, 1182, "Einv Date", { bold: true }); text(548, 1182, "{{EINV_ACKDATE}}");
  image("footlogo", "{{IMG_FOOTLOGO}}", 537, 1082, 345, 16); image("sign", "{{IMG_SIGN}}", 776, 1111, 85, 56);
  text(756, 1178, "Authorised Signatory", { bold: true, size: 8.2 });
  text(380, 1233, "SUBJECT TO DAMAN JURISDICTION"); text(369, 1252, "This is a Computer Generated Invoice"); text(842, 1233, "E. & O.E"); text(820, 1258, "Page {{page}} of {{pages}}", { bold: true });

  const repeaters: Repeater[] = [
    { name: "items", source: "lines", y: 508, pitch: 37, paginate: true },
    { name: "addless", source: "addless", y: 768, pitch: 18, ys: Array.from({ length: 10 }, (_, at) => (at === 0 ? 768 : 788 + at * 18)), show: "last" },
  ];
  return { version: 2, rowsPerPage: 6, repeaters, totals: RISHABH_TOTALS.map((total) => ({ ...total })), elements };
}
