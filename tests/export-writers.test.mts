import assert from "node:assert/strict";
import test from "node:test";
import { pdf } from "../lib/export/pdf.ts";
import type { ExportTable } from "../lib/export/table.ts";
import { columnLetter, xlsx } from "../lib/export/xlsx.ts";

const table: ExportTable = {
  company: "RISHABH PLASTIC",
  title: "MASTER : ADDON SUB",
  subtitle: ["SUB MASTER: Area", "3 records"],
  columns: [
    { caption: "SR_NO", kind: "number", decimals: 0, align: "right", width: 50 },
    { caption: "* NAME", kind: "text", decimals: 0, align: "left", width: 240 },
    { caption: "OPENING BALANCE", kind: "number", decimals: 2, align: "right", width: 120 },
    { caption: "START DATE", kind: "date", decimals: 0, align: "center", width: 90 },
  ],
  rows: [
    [1, "Abohar", 1250.5, new Date(2022, 3, 20)],
    [2, "Agra & <Mathura> \"Road\"", null, null],
    [3, "Ajmer", -250, new Date(2026, 8, 21)],
  ],
  totals: [null, null, 1000.5, null],
};

/** The files inside a stored zip, read from its local headers; the CRC of each is checked. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, string>();
  const table32 = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    let check = 0xffffffff;
    for (const byte of data) check = table32[(check ^ byte) & 0xff] ^ (check >>> 8);
    assert.equal((check ^ 0xffffffff) >>> 0, crc, `CRC of ${name}`);
    files.set(name, new TextDecoder().decode(data));
    at += 30 + nameLength + size;
  }
  assert.equal(view.getUint32(at, true), 0x02014b50, "central directory follows the files");
  return files;
}

test("Excel column letters run A..Z, AA..", () => {
  assert.equal(columnLetter(1), "A");
  assert.equal(columnLetter(26), "Z");
  assert.equal(columnLetter(27), "AA");
  assert.equal(columnLetter(703), "AAA");
});

test("the workbook is a valid zip with the Office parts", () => {
  const files = unzip(xlsx(table, "Area"));
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) {
    assert.ok(files.has(part), part);
  }
});

test("the sheet keeps headings, numbers as numbers, dates as dates and a totals formula", () => {
  const sheet = unzip(xlsx(table)).get("xl/worksheets/sheet1.xml")!;
  // company, title and two subtitle lines, a blank row, then the headings on row 6
  assert.match(sheet, /<row r="6"[^>]*><c r="A6" t="inlineStr" s="3"><is><t xml:space="preserve">SR_NO<\/t>/);
  assert.match(sheet, /<c r="C7" s="9"><v>1250.5<\/v><\/c>/, "a number cell, 2 decimals style");
  assert.match(sheet, /<c r="D7" s="5"><v>44671<\/v><\/c>/, "20 Apr 2022 is Excel day 44671");
  assert.match(sheet, /Agra &amp; &lt;Mathura&gt; &quot;Road&quot;/, "text is escaped");
  assert.match(sheet, /<f>SUBTOTAL\(9,C7:C9\)<\/f><v>1000.5<\/v>/);
  assert.match(sheet, /<pane ySplit="6" topLeftCell="A7"/, "headings stay on screen");
  assert.match(sheet, /<autoFilter ref="A6:D9"\/>/);
});

test("the PDF is well formed: every cross-reference offset points at its object", () => {
  const bytes = pdf(table, { orientation: "landscape", fontSize: 8, totals: true, footer: "Printed 21/Sep/2026 10:15 by ADMIN" });
  const text = String.fromCharCode(...bytes);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
  assert.ok(text.slice(xref).startsWith("xref"));
  const entries = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  entries.forEach((offset, index) => assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj`), `object ${index + 1}`));
  assert.match(text, /\/Count 1 /);
  assert.match(text, /\(Agra & <Mathura> "Road"\) Tj/);
  assert.match(text, /\(Page 1 of 1\) Tj/);
  assert.match(text, /\(1,000.50\) Tj/, "the total, Indian grouping");
});

test("the Total label sits in the first column that is not summed", () => {
  const summedFirst: ExportTable = { ...table, totals: [6, null, 1000.5, null] };
  const sheet = unzip(xlsx(summedFirst)).get("xl/worksheets/sheet1.xml")!;
  assert.match(sheet, /<c r="B10" t="inlineStr" s="6"><is><t xml:space="preserve">Total<\/t>/);
  const text = String.fromCharCode(...pdf(summedFirst, { orientation: "landscape", fontSize: 8, totals: true, footer: "" }));
  assert.match(text, /\(Total\) Tj/);
});

test("a long list runs over several pages, each with the headings", () => {
  const rows = Array.from({ length: 120 }, (_, index) => [index + 1, `Party ${index + 1}`, index * 10, null] as const);
  const text = String.fromCharCode(...pdf({ ...table, rows }, { orientation: "portrait", fontSize: 8, totals: true, footer: "" }));
  const pages = Number(/\/Count (\d+)/.exec(text)![1]);
  assert.ok(pages >= 2, `${pages} pages`);
  assert.equal(text.match(/\(OPENING BALANCE\) Tj/g)?.length, pages);
  assert.match(text, new RegExp(`\\(Page ${pages} of ${pages}\\) Tj`));
});

test("the print preview pages match the PDF's pages, and printing sends every page", async () => {
  const { previewPages, printDocument } = await import("../lib/export/pages.ts");
  const rows = Array.from({ length: 120 }, (_, index) => [index + 1, `Party <${index + 1}> & Co`, index * 10, null] as const);
  const options = { orientation: "portrait", fontSize: 8, totals: true, footer: "Printed by <ADMIN>" } as const;
  const long = { ...table, rows, subtitle: [], titleRight: "SUB MASTER: Area", footerCenter: "120 records" };
  const pdfPages = Number(/\/Count (\d+)/.exec(String.fromCharCode(...pdf(long, options)))![1]);
  const pages = previewPages(long, options);
  assert.equal(pages.pageCount, pdfPages, "the same page breaks as the PDF");
  const first = pages.page(0);
  assert.match(first, /OPENING BALANCE/);
  assert.match(first, /Party &lt;1&gt; &amp; Co/, "text is escaped");
  assert.match(first, /Printed by &lt;ADMIN&gt;/);
  assert.match(first, /right:[^"]*">SUB MASTER: Area<\/div>/, "the group at the right of the title line");
  assert.match(first, /pv-foot-center[^>]*>120 records<\/div>/, "the count in the middle of the footer");
  assert.deepEqual(pages.find("11>"), [10, 110], "search finds rows by their shown text, any case");
  assert.match(pages.page(pages.pageCount - 1), /class="pv-total"/, "totals on the last page");
  const printed = printDocument("Report", pages, "portrait");
  assert.equal(printed.match(/<section class="pv-page"/g)?.length, pages.pageCount);
  assert.match(printed, /@page\{size:A4 portrait;margin:0\}/);
  // Each printed page is a little shorter than the sheet, so none spills onto an extra (blank) sheet.
  assert.equal(printed.match(/height:838pt/g)?.length, pages.pageCount);
  assert.doesNotMatch(printed, /height:842pt/);
});
