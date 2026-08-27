"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { type ReportRow, useLegacyReport } from "./LegacyReportWorkflow";

const productFields = ["Product Code", "Product Name", "Product Short", "Description", "HSN Code", "UOM", "Rate", "Tax", "Group", "Opening Stock"];

type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

function readU16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function readU32(view: DataView, offset: number) { return view.getUint32(offset, true); }

function zipEntries(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer); const view = new DataView(buffer); const decoder = new TextDecoder();
  let end = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) if (readU32(view, offset) === 0x06054b50) end = offset;
  if (end < 0) throw new Error("The selected workbook is not a readable XLSX file.");
  const count = readU16(view, end + 10); let cursor = readU32(view, end + 16); const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (readU32(view, cursor) !== 0x02014b50) throw new Error("The workbook directory is invalid.");
    const method = readU16(view, cursor + 10); const compressedSize = readU32(view, cursor + 20); const nameLength = readU16(view, cursor + 28); const extraLength = readU16(view, cursor + 30); const commentLength = readU16(view, cursor + 32);
    entries.push({ name: decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength)), method, compressedSize, localOffset: readU32(view, cursor + 42) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipText(buffer: ArrayBuffer, entries: ZipEntry[], name: string) {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) return "";
  const view = new DataView(buffer); const bytes = new Uint8Array(buffer); const nameLength = readU16(view, entry.localOffset + 26); const extraLength = readU16(view, entry.localOffset + 28); const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(compressed);
  if (entry.method !== 8 || typeof DecompressionStream === "undefined") throw new Error("This browser cannot read the workbook compression format.");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function columnIndex(reference: string) {
  return reference.replace(/\d/g, "").split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function parseXlsx(file: File) {
  const buffer = await file.arrayBuffer(); const entries = zipEntries(buffer); const sharedXml = await readZipText(buffer, entries, "xl/sharedStrings.xml"); const sheetXml = await readZipText(buffer, entries, "xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("The first worksheet could not be found in the workbook.");
  const parser = new DOMParser();
  const shared = sharedXml ? Array.from(parser.parseFromString(sharedXml, "application/xml").querySelectorAll("si")).map((node) => Array.from(node.querySelectorAll("t")).map((text) => text.textContent ?? "").join("")) : [];
  const rows = Array.from(parser.parseFromString(sheetXml, "application/xml").querySelectorAll("sheetData row")).map((row) => {
    const values: string[] = [];
    row.querySelectorAll("c").forEach((cell) => {
      const index = columnIndex(cell.getAttribute("r") ?? "A1"); const type = cell.getAttribute("t"); const value = cell.querySelector("v")?.textContent ?? "";
      values[index] = type === "s" ? shared[Number(value)] ?? "" : type === "inlineStr" ? cell.querySelector("is t")?.textContent ?? "" : value;
    });
    return values.map((value) => value ?? "");
  });
  return rows.filter((row) => row.some((value) => value.trim() !== ""));
}

function parseDelimited(text: string) {
  return text.split(/\r?\n/).map((line) => line.split(line.includes("\t") ? "\t" : ",").map((value) => value.trim())).filter((row) => row.some(Boolean));
}

async function parseSpreadsheet(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return parseXlsx(file);
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseDelimited(await file.text());
  throw new Error("Choose an XLSX, CSV, or tab-delimited product worksheet.");
}

function mappedValue(row: string[], headers: string[], mapping: Record<number, string>, field: string) {
  const index = headers.findIndex((_, column) => mapping[column] === field);
  return index < 0 ? "" : (row[index] ?? "").trim();
}

type ProductImportContext = { selection: { groupKey: number; yearId: string }; groups: Array<{ key: number; label: string; products: number }> };

export function ProductExcelImportWorkflow() {
  const [fileName, setFileName] = useState(""); const [rows, setRows] = useState<string[][]>([]); const [mapping, setMapping] = useState<Record<number, string>>({}); const [message, setMessage] = useState("Loading the real product groups…"); const [busy, setBusy] = useState(false); const [context, setContext] = useState<ProductImportContext | null>(null); const [groupKey, setGroupKey] = useState<number | null>(null);
  const headers = rows[0] ?? []; const preview = rows.slice(1, 21);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/legacy/master/product?pageSize=25", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as ProductImportContext | { error?: string }; if (!response.ok || !("groups" in body)) throw new Error("error" in body && body.error ? body.error : "Product groups could not be loaded"); return body; })
      .then((body) => { setContext(body); setGroupKey(body.selection.groupKey); setMessage("Select a real Excel or CSV product worksheet to begin."); })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setMessage(error instanceof Error ? error.message : "Product groups could not be loaded"); });
    return () => controller.abort();
  }, []);
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setMessage("Reading the selected worksheet…");
    try {
      const parsed = await parseSpreadsheet(file);
      if (parsed.length < 2) throw new Error("The worksheet needs a header row and at least one product row.");
      const nextMapping = Object.fromEntries(parsed[0].map((header, index) => [index, productFields.find((field) => field.toLowerCase().includes(header.toLowerCase()) || header.toLowerCase().includes(field.toLowerCase())) ?? "Ignore"]));
      setFileName(file.name); setRows(parsed); setMapping(nextMapping); setMessage(`${(parsed.length - 1).toLocaleString("en-IN")} source rows read from ${file.name}. Review the legacy field mapping before import.`);
    } catch (error) { setFileName(""); setRows([]); setMapping({}); setMessage(error instanceof Error ? error.message : "The selected file could not be read."); }
    finally { setBusy(false); }
  };
  const importRows = () => {
    const mapped = Object.values(mapping); const required = ["Product Code", "Product Name"].filter((field) => !mapped.includes(field));
    if (required.length) return setMessage(`Map ${required.join(" and ")} before importing.`);
    if (!context || !groupKey) return setMessage("Wait for the real product group and year context.");
    const products = rows.slice(1).map((row) => {
      const name = mappedValue(row, headers, mapping, "Product Name") || mappedValue(row, headers, mapping, "Product Short");
      const description = mappedValue(row, headers, mapping, "Description") || name;
      return { prod_short: name, prod_desc: description, bill_desc: description, bar_code: mappedValue(row, headers, mapping, "Product Code"), hsn_code: mappedValue(row, headers, mapping, "HSN Code"), uom: mappedValue(row, headers, mapping, "UOM"), rate: Number(mappedValue(row, headers, mapping, "Rate")) || 0, openingStock: Number(mappedValue(row, headers, mapping, "Opening Stock")) || 0 };
    });
    if (!products.every((product) => product.prod_short)) return setMessage("Every imported row needs a Product Name or Product Short value.");
    if (!window.confirm(`Create ${products.length.toLocaleString("en-IN")} real products in the selected product group? This cannot be undone from the import screen.`)) return;
    setBusy(true); setMessage(`Creating ${products.length.toLocaleString("en-IN")} real products in one transaction…`);
    fetch("/api/legacy/import/product", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupKey, yearId: context.selection.yearId, rows: products }) })
      .then(async (response) => { const body = await response.json() as { imported?: number; error?: string }; if (!response.ok) throw new Error(body.error || "Product import could not be completed"); return body; })
      .then((body) => setMessage(`${(body.imported ?? 0).toLocaleString("en-IN")} products were created in the restored legacy database.`))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Product import could not be completed"))
      .finally(() => setBusy(false));
  };
  const clear = () => { setFileName(""); setRows([]); setMapping({}); setMessage("Select a real Excel or CSV product worksheet to begin."); };
  return <section className="legacy-utility-screen legacy-import-screen" aria-label="Product import from Excel">
    <header><strong>IMPORT DATA FROM EXCEL</strong><span>Product import</span></header>
    <main>
      <section className="legacy-import-controls"><label>Select <select value={groupKey ?? ""} disabled={!context || busy} onChange={(event) => setGroupKey(Number(event.target.value))}>{context?.groups.map((group) => <option key={group.key} value={group.key}>{group.label} ({group.products})</option>) ?? <option>Loading product groups…</option>}</select></label><label>Upload <input aria-label="Choose product Excel file" type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={onFile} /></label><label>File Name <input readOnly value={fileName} placeholder="Choose Excel File" /></label></section>
      <section className="legacy-import-body"><aside><strong>Excel Columns</strong>{headers.length ? headers.map((header, index) => <label key={`${header}-${index}`}><span>{header || `Column ${index + 1}`}</span><select value={mapping[index] ?? "Ignore"} onChange={(event) => setMapping((current) => ({ ...current, [index]: event.target.value }))}><option>Ignore</option>{productFields.map((field) => <option key={field}>{field}</option>)}</select></label>) : <p>Choose a real file to show its source columns.</p>}</aside><div className="legacy-import-preview"><header><strong>Preview from selected file</strong><span>{rows.length ? `${rows.length - 1} source rows` : "No file"}</span></header>{headers.length ? <div><table><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header || `Column ${index + 1}`}<small>{mapping[index] ?? "Ignore"}</small></th>)}</tr></thead><tbody>{preview.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, index) => <td key={index}>{row[index] ?? ""}</td>)}</tr>)}</tbody></table></div> : <p className="legacy-import-empty">The preview uses the contents of the selected local spreadsheet; no sample product rows are generated.</p>}</div></section>
    </main>
    <footer><button type="button" disabled={!rows.length || busy || !context} onClick={importRows}>Import</button><button type="button" onClick={clear}>Quit</button><span role="status">{message}</span></footer>
  </section>;
}

function documentKey(row: ReportRow, index: number) { return String(row["Document Key"] ?? index); }

export function MultipleInvoicePdfWorkflow() {
  const { payload, loading, error, refresh } = useLegacyReport("document-register");
  const [query, setQuery] = useState(""); const [selected, setSelected] = useState<Set<string>>(() => new Set()); const [message, setMessage] = useState("Select the real invoice rows to include in one print job.");
  const rows = useMemo(() => (payload?.rows ?? []).filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(query.toLowerCase()))), [payload, query]);
  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const print = async () => { if (!selected.size) return setMessage("Select at least one real invoice row first."); const escape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); const selectedRows = rows.filter((row, index) => selected.has(documentKey(row, index))); const processKeys = selectedRows.map((row, index) => Number(documentKey(row, index))).filter(Number.isInteger); if (!processKeys.length) return setMessage("The selected rows do not have printable document keys."); try { const response = await fetch("/api/legacy/transaction/document-print", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ processKeys }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Print recording failed"); const popup = window.open("", "smartwinfa-invoice-print"); if (!popup) return setMessage("Print count recorded. Allow pop-ups to open the browser print/PDF dialog."); popup.document.write(`<!doctype html><title>SMARTwinFA selected invoices</title><style>body{font:12px Arial;margin:24px}.invoice{break-after:page;border-bottom:1px solid #555;padding:0 0 20px;margin:0 0 20px}h1{font-size:18px}dl{display:grid;grid-template-columns:150px 1fr;gap:6px}dt{font-weight:bold}</style><h1>Selected invoice register</h1>${selectedRows.map((row) => `<section class="invoice"><h2>${escape(row["Document No."])}</h2><dl>${Object.entries(row).map(([key,value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join("")}</dl></section>`).join("")}`); popup.document.close(); popup.focus(); popup.print(); setMessage(`${selectedRows.length} selected real invoice record(s) sent to the browser print/PDF dialog and their print counts were recorded.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Print recording failed"); } };
  return <section className="legacy-utility-screen legacy-pdf-screen" aria-label="Multiple invoice PDF"><header><strong>PARTYWISE BILL PDF</strong><span>Multiple Invoice in Single PDF</span></header>{loading && <main className="legacy-empty-state">Loading real invoice headers…</main>}{error && <main className="legacy-empty-state" role="alert">{error}</main>}{payload && <main><div className="legacy-pdf-controls"><label>Selection <select defaultValue="Account"><option>Account</option><option>Book</option><option>Date range</option></select></label><label>Format <select defaultValue="Invoice"><option>Invoice</option><option>Summary</option></select></label><input aria-label="Find real invoice" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find party, invoice or book"/><button type="button" onClick={() => setSelected(new Set(rows.map(documentKey)))}>Select shown</button></div><div className="legacy-pdf-grid"><table><thead><tr><th>Select</th><th>Date</th><th>Party</th><th>Book</th><th>Document No.</th><th>Amount</th></tr></thead><tbody>{rows.map((row, index) => { const key = documentKey(row, index); return <tr className={selected.has(key) ? "selected" : ""} key={key}><td><input aria-label={`Select document ${key}`} type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} /></td><td>{row.Date}</td><td>{row.Party}</td><td>{row.Book}</td><td>{row["Document No."]}</td><td>{row.Amount}</td></tr>; })}</tbody></table></div></main>}<footer><button type="button" onClick={print}>Print selected</button><button type="button" onClick={() => setSelected(new Set())}>Clear selection</button><button type="button" onClick={refresh}>Refresh</button><span>{selected.size.toLocaleString("en-IN")} selected · {message}</span></footer></section>;
}

export function LockUnlockWorkflow() {
  const { payload, loading, error, refresh } = useLegacyReport("lock-status");
  const [selected, setSelected] = useState(""); const [message, setMessage] = useState("Select a real book setup row to inspect its lock range.");
  const rows = payload?.rows ?? []; const current = rows.find((row, index) => String(row["Setup Key"] ?? index) === selected) ?? null;
  const change = async () => { if (!current) return; const isLocked = current["Period State"] === "Locked"; const from = isLocked ? String(current["Open From"] ?? new Date().toISOString().slice(0, 10)) : window.prompt("Lock from (YYYY-MM-DD)", new Date().toISOString().slice(0, 10)); const upto = isLocked ? String(current["Open Upto"] ?? new Date().toISOString().slice(0, 10)) : window.prompt("Lock upto (YYYY-MM-DD)", from ?? ""); if (!from || !upto) return; try { const response = await fetch("/api/legacy/transaction/book-lock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupKey: Number(current["Setup Key"]), action: isLocked ? "unlock" : "lock", from, upto }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Lock change failed"); setMessage(`${isLocked ? "Unlocked" : "Locked"} ${String(current.Book)} using the PostgreSQL book setup.`); refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Lock change failed"); } };
  return <section className="legacy-utility-screen legacy-lock-screen" aria-label="Lock unlock data"><header><strong>LOCK / UNLOCK DATA</strong><span>Period lock / unlock</span></header>{loading && <main className="legacy-empty-state">Loading live book lock state…</main>}{error && <main className="legacy-empty-state" role="alert">{error}</main>}{payload && <main><div className="legacy-lock-grid"><table><thead><tr><th>Sr. No.</th>{payload.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => { const key = String(row["Setup Key"] ?? index); return <tr className={selected === key ? "selected" : ""} key={key} onClick={() => { setSelected(key); setMessage(`Selected ${String(row.Book ?? "book")} from the live setup table.`); }}><td>{index + 1}</td>{payload.columns.map((column) => <td key={column}>{String(row[column] ?? "—")}</td>)}</tr>; })}</tbody></table></div>{current && <aside className="legacy-lock-detail"><strong>Selected period</strong><span>Book: {current.Book}</span><span>Lock range: {current["Lock From"] ?? "—"} to {current["Lock Upto"] ?? "—"}</span><span>Open range: {current["Open From"] ?? "—"} to {current["Open Upto"] ?? "—"}</span><button type="button" onClick={change}>{current["Period State"] === "Locked" ? "Unlock selected period" : "Lock selected period"}</button></aside>}</main>}<footer><button type="button" onClick={() => window.print()}>Print</button><button type="button" onClick={refresh}>Refresh</button><button type="button" onClick={() => setSelected("")}>Quit</button><span>{message}</span></footer></section>;
}
