import type { El, Template } from "./template";

/**
 * A blank bill page with the usual fields in place, for a company's new format: a title and the company, the party, the invoice number and date, an item table
 * (Sr, description, HSN, quantity, rate, amount), the amounts and the amount in words. The fields are the columns SP_BILL_PRINT makes; move, resize, add or
 * delete anything in the Print Format Designer.
 */
export function starterTemplate(): Template {
  const elements: El[] = [];
  let count = 0;
  const id = (prefix: string) => `${prefix}${++count}`;
  const text = (x: number, y: number, content: string, o: Partial<El> = {}) => { elements.push({ id: id("t"), kind: "text", x, y, text: content, ...o }); };
  const hline = (y: number, x1 = 18, x2 = 884) => { elements.push({ id: id("h"), kind: "hline", x: x1, y, w: x2 - x1 }); };
  const vline = (x: number, y1: number, y2: number) => { elements.push({ id: id("v"), kind: "vline", x, y: y1, h: y2 - y1 }); };
  const cell = (x: number, y: number, content: string, o: Partial<El> = {}) => { elements.push({ id: id("c"), kind: "text", x, y, text: content, in: "lines", ...o }); };

  text(0, 30, "TAX INVOICE", { w: 909, align: "c", bold: true, size: 14 });
  text(0, 62, "{{CO_NAME}}", { w: 909, align: "c", bold: true, size: 11 });
  text(0, 84, "{{CO_ADDRESS1}} {{CO_ADDRESS2}} {{CO_ADDRESS3}} {{CO_CITY}} {{CO_PINCODE}}", { w: 909, align: "c" });
  text(0, 100, "GSTIN : {{CO_GSTNO}}     PAN : {{CO_PANNO}}", { w: 909, align: "c" });
  hline(125); hline(300); hline(325); hline(1000); hline(1030);
  vline(18, 125, 1030); vline(884, 125, 1030); vline(500, 125, 300);
  text(30, 135, "Billed To", { bold: true });
  text(30, 155, "{{PARTY_NAME}}", { bold: true });
  text(30, 175, "{{BILLTO_ADDRESS}}", { w: 440, h: 50, wrap: true });
  text(30, 235, "GSTIN : {{PARTY_GSTNO}}");
  text(30, 255, "State : {{STATE_NAME}}   Code : {{STATE_CODE}}");
  text(515, 135, "Invoice No. :", { bold: true }); text(640, 135, "{{INVOICE_FULLDOCNO}}");
  text(515, 160, "Date :", { bold: true }); text(640, 160, "{{INVOICE_DATE}}");
  text(515, 185, "E-way bill :", { bold: true }); text(640, 185, "{{EWAY_BILLNO}}");
  text(515, 210, "Vehicle :", { bold: true }); text(640, 210, "{{AD_VEHICLE}}");
  text(515, 235, "Transport :", { bold: true }); text(640, 235, "{{AD_TRANSPORT}}");
  text(24, 305, "Sr", { bold: true }); text(70, 305, "Description of Goods", { bold: true }); text(470, 305, "HSN", { bold: true });
  text(575, 305, "Qty", { bold: true, w: 60, align: "r" }); text(655, 305, "Rate", { bold: true, w: 80, align: "r" }); text(790, 305, "Amount", { bold: true, w: 90, align: "r" });
  cell(24, 0, "{{SERIAL_NO}}"); cell(70, 0, "{{PROD_DESCRIP}}", { w: 390, h: 16 }); cell(470, 0, "{{HSN_CODE}}");
  cell(575, 0, "{{QUANTITY}}", { w: 60, align: "r" }); cell(655, 0, "{{RATE}}", { w: 80, align: "r" }); cell(790, 0, "{{NETTAMT}}", { w: 90, align: "r" });
  text(30, 1005, "Total quantity", { bold: true }); text(575, 1005, "{{TOT_QTY}}", { w: 60, align: "r", bold: true, show: "last" });
  text(655, 1005, "Amount", { bold: true, w: 80, align: "r" }); text(790, 1005, "{{DOC_AMOUNT}}", { w: 90, align: "r", bold: true, show: "last" });
  text(30, 1040, "Amount in words :", { bold: true }); text(160, 1040, "{{AMOUNT_WORDS}}", { show: "last" });
  text(30, 1070, "Remark : {{BOTTOM_MESSAGE}}");
  text(700, 1200, "Authorised Signatory", { bold: true });
  text(800, 1258, "Page {{page}} of {{pages}}", { bold: true });
  return {
    version: 2, rowsPerPage: 20,
    repeaters: [{ name: "lines", source: "lines", y: 330, pitch: 33, paginate: true }],
    totals: [{ name: "TOT_QTY", op: "sum", field: "QUANTITY", list: "lines", reset: "report", decimals: 0 }],
    elements,
  };
}
