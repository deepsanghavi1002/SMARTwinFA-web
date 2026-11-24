/**
 * Reads a sheet a person or an attendance device saved: a .csv, or an .xlsx (read in the browser, without a library: an .xlsx is a zip of XML
 * parts, inflated with the browser's own DecompressionStream). Returns the first sheet as rows of text.
 */

export type SheetRows = string[][];

/** One CSV line split on commas, with "quoted, values" and "" for a quote inside one. */
export function parseCsv(textValue: string): SheetRows {
  const rows: SheetRows = [];
  let row: string[] = [], cell = "", quoted = false;
  const text = textValue.charCodeAt(0) === 0xfeff ? textValue.slice(1) : textValue;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((value) => value.trim()));
}

type Entry = { name: string; method: number; size: number; offset: number };

/** The zip's central directory: every file's name, where it starts and how it is stored. */
function zipEntries(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("This is not an Excel (.xlsx) file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: Entry[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("The Excel file is damaged");
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    entries.push({ name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), method: view.getUint16(at + 10, true), size: view.getUint32(at + 20, true), offset: view.getUint32(at + 42, true) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function unzipText(bytes: Uint8Array, entry: Entry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.size);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("This Excel file uses a compression this screen cannot read");
  const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<SheetRows> {
  const bytes = new Uint8Array(buffer);
  const entries = zipEntries(bytes);
  const find = (name: string) => entries.find((entry) => entry.name === name);
  const sheets = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (sheets.length === 0) throw new Error("The Excel file has no sheet");
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");

  const shared: string[] = [];
  const sharedEntry = find("xl/sharedStrings.xml");
  if (sharedEntry) {
    for (const item of Array.from(parse(await unzipText(bytes, sharedEntry)).getElementsByTagName("si"))) {
      shared.push(Array.from(item.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
    }
  }
  const rows: SheetRows = [];
  for (const rowNode of Array.from(parse(await unzipText(bytes, sheets[0])).getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const cell of Array.from(rowNode.getElementsByTagName("c"))) {
      const at = columnIndex(cell.getAttribute("r") ?? "A1");
      const type = cell.getAttribute("t");
      const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      const value = type === "s" ? shared[Number(raw)] ?? "" : type === "inlineStr" ? Array.from(cell.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("") : raw;
      while (cells.length < at) cells.push("");
      cells[at] = value.trim();
    }
    if (cells.some((value) => value !== "")) rows.push(cells);
  }
  return rows;
}

export async function readSheet(file: File): Promise<SheetRows> {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer());
  if (/\.(csv|txt)$/i.test(file.name)) return parseCsv(await file.text());
  throw new Error("Choose an Excel (.xlsx) or CSV (.csv) file");
}

export type AttendanceImportRow = Readonly<{ code: number | null; name: string; paidDays: number; remark: string }>;

/** Finds the Code, Name, Paid Days and Remark columns by their headings (the first row that has a days heading) and returns the rows under it. */
export function attendanceFromSheet(rows: SheetRows): AttendanceImportRow[] {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headerAt = rows.findIndex((row) => row.some((value) => /^(paiddays|days|dayspaid|presentdays|present|workingdays)$/.test(norm(value))));
  if (headerAt < 0) throw new Error("No 'Paid Days' column was found in the first rows of the file");
  const head = rows[headerAt].map(norm);
  const pick = (names: string[]) => head.findIndex((value) => names.includes(value));
  const codeAt = pick(["code", "staffcode", "empcode", "employeecode", "accode", "accountcode", "id", "empid"]);
  const nameAt = pick(["name", "staffname", "empname", "employeename"]);
  const daysAt = pick(["paiddays", "days", "dayspaid", "presentdays", "present", "workingdays"]);
  const remarkAt = pick(["remark", "remarks", "note"]);
  if (codeAt < 0 && nameAt < 0) throw new Error("The file needs a Code or a Name column to match staff");
  const out: AttendanceImportRow[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const days = Number((row[daysAt] ?? "").replace(/,/g, ""));
    if ((row[daysAt] ?? "") === "" || !Number.isFinite(days)) continue;
    const code = codeAt >= 0 && /^\d+$/.test(row[codeAt] ?? "") ? Number(row[codeAt]) : null;
    out.push({ code, name: nameAt >= 0 ? row[nameAt] ?? "" : "", paidDays: days, remark: remarkAt >= 0 ? row[remarkAt] ?? "" : "" });
  }
  return out;
}
