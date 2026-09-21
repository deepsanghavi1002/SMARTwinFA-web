import type { ExportCell, ExportTable } from "./table.ts";

/**
 * A real Excel workbook (.xlsx) from a grid, written without a library: the file is a zip
 * of a few XML parts. The sheet has the company and heading on top, the column headings in
 * bold with an AutoFilter, frozen panes below the headings, numbers as numbers in their own
 * format, dates as dates, a bold totals row, and it prints landscape with the headings
 * repeated on every page.
 */

// ---- a minimal zip (stored, not compressed): enough for Office to open ------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zip(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, file.data.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, file.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) { out.set(part, at); at += part.length; }
  return out;
}

// ---- the workbook ---------------------------------------------------------------------

// XML 1.0 refuses most control characters, so they are dropped.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
const xml = (text: string) => text.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Excel's column letters: 1 → A, 27 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

/** Days since 30 Dec 1899, Excel's date serial, for a local calendar date. */
function excelDate(date: Date): number {
  return (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
}

// Cell styles (cellXfs index)
const S_TITLE = 1;
const S_SUBTITLE = 2;
const S_HEAD = 3;
const S_TEXT = 4;
const S_DATE = 5;
const S_TOTAL_LABEL = 6;
const S_NUMBER = 7; // + decimals (0..4)
const S_TOTAL = 12; // + decimals (0..4)

function stylesXml(): string {
  const formats = [0, 1, 2, 3, 4].map((places) => `<numFmt numFmtId="${164 + places}" formatCode="${places ? `#,##0.${"0".repeat(places)}` : "#,##0"}"/>`).join("");
  const numberXf = (font: number, fill: number, places: number) => `<xf numFmtId="${164 + places}" fontId="${font}" fillId="${fill}" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="6">${formats}<numFmt numFmtId="169" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF3D5A80"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB9D7F7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF9FB6D4"/></left><right style="thin"><color rgb="FF9FB6D4"/></right><top style="thin"><color rgb="FF9FB6D4"/></top><bottom style="thin"><color rgb="FF9FB6D4"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
${[0, 1, 2, 3, 4].map((places) => numberXf(0, 0, places)).join("\n")}
${[0, 1, 2, 3, 4].map((places) => numberXf(1, 3, places)).join("\n")}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

const places = (decimals: number) => Math.max(0, Math.min(4, Math.round(decimals || 0)));

function cellXml(ref: string, value: ExportCell, style: number): string {
  if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (value instanceof Date) return `<c r="${ref}" s="${style}"><v>${excelDate(value)}</v></c>`;
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

export function xlsx(table: ExportTable, sheetName = "Master"): Uint8Array {
  const count = Math.max(1, table.columns.length);
  const last = columnLetter(count);
  const lines = [table.company, table.title, table.titleRight ?? "", ...table.subtitle, table.footerCenter ?? ""].filter((line) => line.trim() !== "");
  const headRow = lines.length + 2;
  const rows: string[] = [];
  lines.forEach((line, index) => rows.push(`<row r="${index + 1}">${cellXml(`A${index + 1}`, line, index === 0 ? S_TITLE : index === 1 ? S_TITLE : S_SUBTITLE)}</row>`));
  rows.push(`<row r="${headRow}" ht="30" customHeight="1">${table.columns.map((column, index) => cellXml(`${columnLetter(index + 1)}${headRow}`, column.caption, S_HEAD)).join("")}</row>`);
  table.rows.forEach((values, offset) => {
    const r = headRow + 1 + offset;
    rows.push(`<row r="${r}">${table.columns.map((column, index) => {
      const style = column.kind === "number" ? S_NUMBER + places(column.decimals) : column.kind === "date" ? S_DATE : S_TEXT;
      return cellXml(`${columnLetter(index + 1)}${r}`, values[index] ?? null, style);
    }).join("")}</row>`);
  });
  const lastData = headRow + table.rows.length;
  if (table.totals && table.rows.length > 0) {
    const r = lastData + 1;
    // "Total" goes in the first column that is not itself summed.
    const labelColumn = Math.max(0, table.columns.findIndex((_, index) => table.totals?.[index] === null || table.totals?.[index] === undefined));
    rows.push(`<row r="${r}">${table.columns.map((column, index) => {
      const ref = `${columnLetter(index + 1)}${r}`;
      const total = table.totals?.[index];
      if (total !== null && total !== undefined) {
        // A formula keeps the total right if rows are changed in Excel; the cached value shows at once.
        const letter = columnLetter(index + 1);
        return `<c r="${ref}" s="${S_TOTAL + places(column.decimals)}"><f>SUBTOTAL(9,${letter}${headRow + 1}:${letter}${lastData})</f><v>${total}</v></c>`;
      }
      return cellXml(ref, index === labelColumn ? "Total" : "", S_TOTAL_LABEL);
    }).join("")}</row>`);
  }
  const widths = table.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(6, Math.min(80, Math.round(column.width / 6.5)))}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${last}${Math.max(headRow, lastData + (table.totals ? 1 : 0))}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths}</cols>
<sheetData>${rows.join("")}</sheetData>
<autoFilter ref="A${headRow}:${last}${Math.max(headRow, lastData)}"/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>&amp;LPrinted &amp;D &amp;T&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>
</worksheet>`;
  const name = xml(sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Master");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$${headRow}:$${last}$${Math.max(headRow, lastData)}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'${name.replace(/'/g, "''")}'!$${headRow}:$${headRow}</definedName></definedNames>
</workbook>`;
  const encoder = new TextEncoder();
  return zip([
    { name: "[Content_Types].xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: "_rels/.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: encoder.encode(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheet) },
  ]);
}
