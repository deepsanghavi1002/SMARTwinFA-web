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

/** A row style's own cell formats, after the fixed ones: one per fill / weight / kind of cell. */
type ExtraXf = { fill: string; bold: boolean; kind: "text" | "date" | number };

function stylesXml(extras: readonly ExtraXf[] = []): string {
  const fills = [...new Set(extras.map((extra) => extra.fill).filter((fill) => fill !== ""))];
  const fillId = (fill: string) => (fill === "" ? 0 : 4 + fills.indexOf(fill));
  const extraXfs = extras.map(({ fill, bold, kind }) => {
    const font = bold ? 1 : 0;
    if (kind === "text") return `<xf numFmtId="49" fontId="${font}" fillId="${fillId(fill)}" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>`;
    if (kind === "date") return `<xf numFmtId="169" fontId="${font}" fillId="${fillId(fill)}" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>`;
    return `<xf numFmtId="${164 + kind}" fontId="${font}" fillId="${fillId(fill)}" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>`;
  });
  const formats = [0, 1, 2, 3, 4].map((places) => `<numFmt numFmtId="${164 + places}" formatCode="${places ? `#,##0.${"0".repeat(places)}` : "#,##0"}"/>`).join("");
  const numberXf = (font: number, fill: number, places: number) => `<xf numFmtId="${164 + places}" fontId="${font}" fillId="${fill}" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="6">${formats}<numFmt numFmtId="169" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF3D5A80"/><name val="Calibri"/></font></fonts>
<fills count="${4 + fills.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB9D7F7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>${fills.map((fill) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor indexed="64"/></patternFill></fill>`).join("")}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF9FB6D4"/></left><right style="thin"><color rgb="FF9FB6D4"/></right><top style="thin"><color rgb="FF9FB6D4"/></top><bottom style="thin"><color rgb="FF9FB6D4"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${17 + extraXfs.length}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
${[0, 1, 2, 3, 4].map((places) => numberXf(0, 0, places)).join("\n")}
${[0, 1, 2, 3, 4].map((places) => numberXf(1, 3, places)).join("\n")}
${extraXfs.join("\n")}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

const places = (decimals: number) => Math.max(0, Math.min(4, Math.round(decimals || 0)));

function cellXml(ref: string, value: ExportCell, style: number, formula?: string | null): string {
  if (formula) {
    // A real formula, with the worked-out value beside it so it shows before Excel recalculates.
    const f = `<f>${xml(formula)}</f>`;
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}">${f}<v>${value}</v></c>`;
    if (typeof value === "string" && value !== "") return `<c r="${ref}" s="${style}" t="str">${f}<v>${xml(value)}</v></c>`;
    return `<c r="${ref}" s="${style}">${f}</c>`;
  }
  if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (value instanceof Date) return `<c r="${ref}" s="${style}"><v>${excelDate(value)}</v></c>`;
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

/** The sheet row of the column headings: the heading lines above them (company, title ...) and a blank line. */
export function xlsxHeadRow(table: Pick<ExportTable, "company" | "title" | "titleRight" | "subtitle" | "footerCenter">): number {
  return [table.company, table.title, table.titleRight ?? "", ...table.subtitle, table.footerCenter ?? ""].filter((line) => line.trim() !== "").length + 2;
}

/** The parts of a column chart beside the table: the drawing that places it, and the chart reading the label and value cells (with their values stored, so it shows before Excel works it out). */
function chartParts(table: ExportTable, chart: NonNullable<ExportTable["chart"]>, sheet: string, headRow: number, columnCount: number): { name: string; data: Uint8Array }[] {
  const encoder = new TextEncoder();
  const first = headRow + 1;
  const last = headRow + Math.min(chart.count, table.rows.length);
  const book = `'${sheet.replace(/'/g, "''")}'`;
  const labelLetter = columnLetter(chart.label + 1);
  const valueLetter = columnLetter(chart.value + 1);
  const picked = table.rows.slice(0, last - headRow);
  const labels = picked.map((row, at) => `<c:pt idx="${at}"><c:v>${xml(String(row[chart.label] ?? ""))}</c:v></c:pt>`).join("");
  const values = picked.map((row, at) => `<c:pt idx="${at}"><c:v>${Number(row[chart.value]) || 0}</c:v></c:pt>`).join("");
  const heading = xml(table.columns[chart.value]?.caption ?? "");
  const text = (size: number, bold: boolean) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
  const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${xml(table.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>${book}!$${valueLetter}$${headRow}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${heading}</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:spPr><a:solidFill><a:srgbClr val="2166B8"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>
<c:dLbls><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:spPr><a:noFill/></c:spPr>${text(800, true)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>
<c:cat><c:strRef><c:f>${book}!$${labelLetter}$${first}:$${labelLetter}$${last}</c:f><c:strCache><c:ptCount val="${picked.length}"/>${labels}</c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:f>${book}!$${valueLetter}$${first}:$${valueLetter}$${last}</c:f><c:numCache><c:formatCode>#,##0</c:formatCode><c:ptCount val="${picked.length}"/>${values}</c:numCache></c:numRef></c:val></c:ser>
<c:gapWidth val="60"/><c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>
<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>${text(800, false)}<c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${text(800, false)}<c:crossAx val="111111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>
</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
  const from = columnCount + 1; // one empty column between the table and the chart
  const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>${from}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${headRow - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${from + 11}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${headRow + 22}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  const rels = (type: string, target: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;
  return [
    { name: "xl/worksheets/_rels/sheet1.xml.rels", data: encoder.encode(rels("drawing", "../drawings/drawing1.xml")) },
    { name: "xl/drawings/drawing1.xml", data: encoder.encode(drawing) },
    { name: "xl/drawings/_rels/drawing1.xml.rels", data: encoder.encode(rels("chart", "../charts/chart1.xml")) },
    { name: "xl/charts/chart1.xml", data: encoder.encode(chartXml) },
  ];
}

export function xlsx(table: ExportTable, sheetName = "Master"): Uint8Array {
  const count = Math.max(1, table.columns.length);
  const last = columnLetter(count);
  const lines = [table.company, table.title, table.titleRight ?? "", ...table.subtitle, table.footerCenter ?? ""].filter((line) => line.trim() !== "");
  const headRow = lines.length + 2;
  const rows: string[] = [];
  lines.forEach((line, index) => rows.push(`<row r="${index + 1}">${cellXml(`A${index + 1}`, line, index === 0 ? S_TITLE : index === 1 ? S_TITLE : S_SUBTITLE)}</row>`));
  rows.push(`<row r="${headRow}" ht="30" customHeight="1">${table.columns.map((column, index) => cellXml(`${columnLetter(index + 1)}${headRow}`, column.caption, S_HEAD)).join("")}</row>`);
  // Styled rows (a report's headings and subtotals) get formats of their own, numbered after the fixed 17.
  const extras: ExtraXf[] = [];
  const extraIndex = new Map<string, number>();
  const styledXf = (fill: string, bold: boolean, kind: ExtraXf["kind"]) => {
    const key = `${fill}|${bold}|${kind}`;
    let at = extraIndex.get(key);
    if (at === undefined) { at = 17 + extras.length; extras.push({ fill, bold, kind }); extraIndex.set(key, at); }
    return at;
  };
  table.rows.forEach((values, offset) => {
    const r = headRow + 1 + offset;
    const rowStyle = table.rowStyles?.[offset] ?? null;
    const fill = (rowStyle?.fill ?? "").replace(/^#/, "").toUpperCase();
    rows.push(`<row r="${r}">${table.columns.map((column, index) => {
      const kind: ExtraXf["kind"] = column.kind === "number" ? places(column.decimals) : column.kind === "date" ? "date" : "text";
      const style = rowStyle && (fill !== "" || rowStyle.bold) ? styledXf(/^[0-9A-F]{6}$/.test(fill) ? fill : "", Boolean(rowStyle.bold), kind)
        : column.kind === "number" ? S_NUMBER + places(column.decimals) : column.kind === "date" ? S_DATE : S_TEXT;
      return cellXml(`${columnLetter(index + 1)}${r}`, values[index] ?? null, style, table.formulas?.[offset]?.[index]);
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
  const chart = table.chart && table.chart.count > 0 && table.rows.length > 0 ? table.chart : undefined;
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
${chart ? '<drawing r:id="rId1"/>\n' : ""}</worksheet>`;
  const name = xml(sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Master");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$${headRow}:$${last}$${Math.max(headRow, lastData)}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'${name.replace(/'/g, "''")}'!$${headRow}:$${headRow}</definedName></definedNames>
</workbook>`;
  const encoder = new TextEncoder();
  const chartFiles = chart ? chartParts(table, chart, name, headRow, count) : [];
  return zip([
    { name: "[Content_Types].xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${chart ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' : ""}</Types>`) },
    { name: "_rels/.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: encoder.encode(stylesXml(extras)) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheet) },
    ...chartFiles,
  ]);
}
